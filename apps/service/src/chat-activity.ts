import {
  MAX_TEXT, MoguriError, responseText, type ActivityEntry, type ActivityQuery, type ActivityResponse, type ActivityStatus,
  type AgentTerminalRead, type AgentTerminalToolResult, type BudgetResponse, type Session, type Snapshot, type StoredEvent, type ToolCall, type TurnInfo,
} from "../../../packages/protocol/src/index.ts";
import { describeActivityCall } from "../../../packages/protocol/src/activity-labels.ts";
import { digest, type EventStore } from "./store.ts";
export { describeActivityCall };
import { textFilePage } from "./files.ts";

type Dashboard = Pick<Extract<BudgetResponse, { type: "budget.dashboard" }>, "groups" | "totals">;
interface Host {
  snapshot(): Snapshot; events(): StoredEvent[];
  turnBudget(sessionId: string, turnId: string): Dashboard;
  workflow(source: "github" | "linear", id: string): Promise<unknown>;
}
interface Source {
  entry: ActivityEntry;
  arguments(): string | null | Promise<string | null>;
  output(): string | null;
}
const json = (value: unknown): string => {
  const result = JSON.stringify(value, null, 2);
  if (result === undefined) throw new MoguriError("activity_source", "Retained activity arguments are unavailable. No substitute was shown.", 409);
  return result;
};
const validTime = (value: string | null | undefined): string | null => value && Number.isFinite(Date.parse(value)) ? value : null;
const elapsed = (start: string | null, end: string | null): number | null => {
  if (!start || !end) return null;
  const result = Date.parse(end) - Date.parse(start);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
};
const status = (value: string): ActivityStatus => {
  const known: ActivityStatus[] = ["pending", "running", "waiting_input", "completed", "failed", "denied", "stopped", "cancelled", "partial", "unconfirmed", "unknown"];
  return known.find((known) => known === value) ?? "unknown";
};
const modelStatus = (value: string): ActivityStatus => value === "stop" || value === "toolUse" ? "completed" :
  value === "length" ? "partial" : value === "error" ? "failed" : value === "aborted" ? "stopped" : status(value);
export function retainedTurnInfo(session: Session, turnId: string, history: StoredEvent[], profileId: string, budget: Dashboard): TurnInfo {
  const events = history.filter((event) => event.profile_id === profileId && event.session_id === session.id && event.turn_id === turnId);
  if (!events.length || !session.messages.some((message) => message.turnId === turnId)) throw new MoguriError("activity_turn", "Choose an original visible turn in this retained session.", 404);
  const start = events.find((event) => event.event_type === "turn.started" || event.event_type === "turn.control_started");
  const end = events.findLast((event) => event.event_type === "turn.finished");
  const messages = new Set(session.messages.filter((message) => message.turnId === turnId && message.role === "assistant").map((message) => message.id));
  const last = session.usage.findLast((usage) => messages.has(usage.stepId));
  const startedAt = validTime(start?.timestamp), finishedAt = validTime(end?.timestamp);
  return {
    sessionId: session.id, turnId, startedAt, finishedAt, durationMs: elapsed(startedAt, finishedAt),
    outcome: end?.event_type === "turn.finished" ? end.payload.outcome : session.turnId === turnId ? session.status : "unknown",
    models: budget.groups.map(({ modelId, providerId, role }) => ({ modelId, providerId, role })), usage: budget.totals,
    context: last ? { estimatedTokens: last.contextEstimate ?? null, window: last.contextWindow ?? null } : null,
    responseBytes: Buffer.byteLength(responseText(session.messages, turnId)),
  };
}

export class ChatActivity {
  constructor(private readonly host: Host, private readonly store: EventStore) {}
  async agentTerminal(sessionId: string, input: AgentTerminalRead): Promise<AgentTerminalToolResult> {
    if (input.action === "list") {
      const result = await this.query({ type: "activity.list", sessionId, toolName: "run_command", limit: input.limit ?? 20, ...(input.before ? { before: input.before } : {}) });
      if (result.type !== "activity.list") throw new MoguriError("agent_terminal_source", "The original command list changed response type. No alternate console was read.", 409);
      return { type: "agent-terminal.list", sessionId, commands: result.activity.entries.map((entry) => {
        const characters = entry.subject === null ? [] : Array.from(entry.subject);
        return { id: entry.id, turnId: entry.turnId, status: entry.status, env: entry.env, startedAt: entry.startedAt, finishedAt: entry.finishedAt, outputBytes: entry.outputBytes,
          command: entry.subject === null ? null : characters.slice(0, 160).join(""), commandClipped: characters.length > 160 };
      }), nextBefore: result.activity.nextBefore };
    }
    const result = await this.query({ type: "activity.read", sessionId, activityId: input.commandId, part: "output", toolName: "run_command", offset: input.offset ?? 0, limit: input.limit ?? 16384 });
    if (result.type !== "activity.read") throw new MoguriError("agent_terminal_source", "The original command output changed response type. No alternate console was read.", 409);
    return { type: "agent-terminal.read", sessionId, commandId: result.entry.id, status: result.entry.status, env: result.entry.env ?? "unknown", outputBasis: result.entry.outputBasis,
      output: result.content?.text ?? null, bytes: result.content?.bytes ?? null, offset: result.content?.offset ?? null, nextOffset: result.content?.nextOffset ?? null };
  }
  private session(id: string): Session {
    const session = this.host.snapshot().sessions.find((session) => session.id === id);
    if (!session) throw new MoguriError("activity_scope", "The retained session is outside this profile or was deleted. No earlier source was recovered.", 404);
    return session;
  }
  private sources(session: Session): { sources: Source[]; messageOrder: Array<{ id: string; sequence: number }> } {
    const snapshot = this.host.snapshot(), profileId = snapshot.profileId;
    const events = this.host.events().filter((event) => event.profile_id === profileId && event.session_id === session.id);
    const sources: Source[] = [], messageOrder = new Map<string, number>();
    type ToolSource = { call: ToolCall; first: StoredEvent; updatedSequence: number; result: string | null; completed: boolean; ambiguous: boolean; errorCode?: string };
    const tools = new Map<string, ToolSource>(), sourceKeys = new Map<string, string>();
    const toolKey = (turnId: string | null, stepId: string | null, callHash: string) => JSON.stringify([turnId, stepId, callHash]);
    const modelStarts = new Map<string, Extract<StoredEvent, { event_type: "model.started" }>>();
    const modelEnds = new Map<string, Extract<StoredEvent, { event_type: "model.completed" }>>();
    const modelUpdates = new Map<string, number>();
    for (const event of events) {
      if (event.event_type === "turn.started" || event.event_type === "steer.applied") messageOrder.set(event.payload.item.id, event.seq);
      if (event.event_type === "steering.applied") messageOrder.set(event.id, event.seq);
      if (event.event_type === "model.started" && event.step_id) { modelStarts.set(event.step_id, event); messageOrder.set(event.step_id, event.seq); }
      if (event.event_type === "model.completed") {
        modelEnds.set(event.payload.message.id, event);
        if (!messageOrder.has(event.payload.message.id)) messageOrder.set(event.payload.message.id, event.seq);
      }
      if (event.event_type === "routing.response_selected") {
        messageOrder.set(event.payload.sourceStepId, event.seq); modelUpdates.set(event.payload.sourceStepId, event.seq);
      }
      if (event.step_id && ["model.started", "assistant.delta", "model.completed", "model.late_usage"].includes(event.event_type)) modelUpdates.set(event.step_id, event.seq);
      if (event.event_type === "turn.finished") messageOrder.set(event.id, event.seq);
      if (event.event_type === "tool.requested" || event.event_type === "tool.started" || event.event_type === "tool.completed") {
        const call = event.event_type === "tool.requested" ? event.payload.approval.call : event.payload.call;
        const key = toolKey(event.turn_id ?? null, event.step_id ?? null, digest(call.id)), previous = tools.get(key);
        const value: ToolSource = previous ?? { call, first: event, updatedSequence: event.seq, result: null, completed: false, ambiguous: false };
        value.updatedSequence = event.seq;
        if (previous && json(previous.call) !== json(call)) value.ambiguous = true;
        if (event.event_type === "tool.completed") { value.result = event.payload.rawDigest ? this.store.blob(event.payload.rawDigest) : event.payload.text; value.completed = true; value.errorCode = event.payload.errorCode; }
        tools.set(key, value); sourceKeys.set(event.id, key);
      } else if (event.event_type === "tool.output") {
        const value = tools.get(toolKey(event.turn_id ?? null, event.step_id ?? null, digest(event.payload.callId)));
        if (value && !value.completed) {
          const combined = `${value.result ?? ""}${event.payload.text}`;
          let offset = Math.max(0, combined.length - MAX_TEXT);
          if (offset > 0 && combined.charCodeAt(offset) >= 0xdc00 && combined.charCodeAt(offset) <= 0xdfff && combined.charCodeAt(offset - 1) >= 0xd800 && combined.charCodeAt(offset - 1) <= 0xdbff) offset++;
          value.result = combined.slice(offset); value.updatedSequence = event.seq;
        }
      }
    }
    for (const operation of snapshot.operationEntries.filter((entry) => entry.sessionId === session.id)) {
      const original = tools.get(sourceKeys.get(operation.firstEventId) ?? toolKey(operation.turnId, operation.stepId, operation.callHash));
      const unambiguous = original && !original.ambiguous && operation.diagnostic !== "duplicate-start";
      const loaded = unambiguous && original.call.name === "use_skill" && original.call.arguments.action === "load" ?
        events.find((event) => event.event_type === "skill.loaded" && event.turn_id === operation.turnId &&
          event.payload.callId === original.call.id && event.payload.capabilityId === original.call.arguments.id) : undefined;
      const description = loaded?.event_type === "skill.loaded" ? { kind: "load-skill" as const, label: "Loaded skill", subject: loaded.payload.name } :
        unambiguous ? describeActivityCall(original.call, snapshot) : { kind: operation.family === "mcp" ? "mcp" as const : "tool" as const, label: "Recorded operation", subject: operation.name };
      const question = unambiguous && original.call.name === "ask_user" ? snapshot.questions.find((question) => question.sessionId === session.id &&
        question.turnId === operation.turnId && question.stepId === operation.stepId && question.callId === original.call.id && question.status === "open") : undefined;
      const output = unambiguous ? original.result : null;
      const entry: ActivityEntry = {
        id: operation.id, sessionId: session.id, turnId: operation.turnId, stepId: operation.stepId, messageId: unambiguous ? original.call.id : null,
        sequence: original?.first.seq ?? operation.sourceSeq, updatedSequence: Math.max(original?.updatedSequence ?? 0, operation.sourceSeq), source: "tool", actor: operation.actor, ...description,
        env: operation.env, ...(unambiguous ? { toolName: original.call.name } : {}),
        ...(unambiguous && original.errorCode ? { errorCode: original.errorCode } : {}),
        status: original?.ambiguous ? "unknown" : question ? "waiting_input" : operation.outcome,
        startedAt: operation.startedAt, finishedAt: operation.finishedAt, durationMs: operation.elapsedMs, durationBasis: "observed-lifecycle",
        outputBytes: output === null ? null : Buffer.byteLength(output), outputBasis: original?.completed ? "retained-utf8" : "retained-tail", hasArguments: Boolean(unambiguous), hasOutput: output !== null,
      };
      sources.push({ entry, arguments: () => unambiguous ? json(original.call.arguments) : null, output: () => output });
    }
    const ordinary = new Set(["solver", "side", "subagent", "revision", "escalation"]);
    for (const message of session.messages.filter((message) => message.role === "assistant")) {
      const start = modelStarts.get(message.id), end = modelEnds.get(message.id), usage = session.usage.find((usage) => usage.stepId === message.id);
      if (!start || !usage || !ordinary.has(usage.role) && !snapshot.routings.some((routing) => routing.sessionId === session.id &&
        routing.turnId === message.turnId && routing.selectedStepIds?.includes(message.id))) continue;
      const reasoning = message.reasoning || null, output = reasoning ?? (message.text || null), complete = Boolean(end);
      const entry: ActivityEntry = {
        id: digest(json(["public-model-activity", profileId, session.id, message.turnId, message.id])), sessionId: session.id, turnId: message.turnId,
        stepId: message.id, messageId: message.id, sequence: start.seq, updatedSequence: modelUpdates.get(message.id) ?? start.seq, source: "model", actor: "model",
        kind: reasoning ? "thought" : "model", label: reasoning ? "Thought" : complete ? "Model response" : usage.outcome === "running" ? "Generating response" : "Model response",
        subject: reasoning ? "Provider-exposed reasoning" : usage.modelId,
        status: !complete && usage.outcome === "running" && session.turnId !== message.turnId ? "unconfirmed" : modelStatus(usage.outcome),
        startedAt: validTime(start.timestamp), finishedAt: validTime(end?.timestamp),
        durationMs: complete && Number.isFinite(usage.requestMs) && usage.requestMs >= 0 ? usage.requestMs : null, durationBasis: "model-request",
        outputBytes: output === null ? null : Buffer.byteLength(output), outputBasis: "retained-utf8", hasArguments: false, hasOutput: output !== null,
      };
      sources.push({ entry, arguments: () => null, output: () => output });
    }
    for (const event of events) if (event.event_type === "skill.used" || event.event_type === "skill.loaded") {
      const used = event.payload;
      // A user-selected skill is shown as its chip on the sent chat message, not as a separate session action.
      if (used.actor === "user") continue;
      if (event.event_type === "skill.loaded" && event.payload.callId &&
        [...tools.values()].some((source) => !source.ambiguous && source.call.name === "use_skill" && source.call.arguments.action === "load" &&
          source.call.id === event.payload.callId && source.call.arguments.id === event.payload.capabilityId && source.first.turn_id === event.turn_id)) continue;
      const entry: ActivityEntry = {
        id: digest(json(["selected-skill-activity", event.id])), sessionId: session.id, turnId: event.event_type === "skill.loaded" ? event.turn_id ?? null : null, stepId: null, messageId: null,
        sequence: event.seq, updatedSequence: event.seq, source: "skill", actor: used.actor, kind: "load-skill", label: event.event_type === "skill.loaded" ? "Loaded skill" : "Load skill", subject: used.name, status: "completed",
        startedAt: validTime(used.startedAt), finishedAt: validTime(event.timestamp), durationMs: used.loadMs, durationBasis: "source-load",
        outputBytes: used.bytes, outputBasis: "loaded-source", hasArguments: true, hasOutput: true,
      };
      sources.push({ entry, arguments: () => json({ capabilityId: used.capabilityId, contentDigest: used.contentDigest }), output: () => this.store.blob(used.contentDigest) });
    }
    const appendWorkflow = (source: "github" | "linear", operation: {
      id: string; status: string; createdAt: string; updatedAt: string; resultDigest: string | null; action: string; actor: "user" | "model";
    }) => {
      const first = events.find((event) => source === "github" ? event.event_type === "github.operation_recorded" && event.payload.operation.id === operation.id :
        event.event_type === "linear.operation_recorded" && event.payload.operation.id === operation.id);
      if (!first) return;
      const latest = events.findLast((event) => source === "github" ? event.event_type === "github.operation_recorded" && event.payload.operation.id === operation.id :
        event.event_type === "linear.operation_recorded" && event.payload.operation.id === operation.id)!;
      const output = operation.resultDigest ? this.store.blob(operation.resultDigest) : null, done = operation.status !== "running";
      const creating = source === "github" ? operation.action === "github.issue.create" : operation.action === "issue.create";
      const entry: ActivityEntry = {
        id: digest(json([source, profileId, session.id, operation.id])), sessionId: session.id, turnId: null, stepId: null, messageId: null,
        sequence: first.seq, updatedSequence: latest.seq, source, actor: operation.actor, kind: creating ? "create-issue" : operation.action.startsWith("git.") ? "command" : "tool",
        label: creating ? `Create ${source === "github" ? "GitHub" : "Linear"} issue` : source === "github" ? "GitHub operation" : "Linear operation",
        subject: operation.action, status: status(operation.status), startedAt: validTime(operation.createdAt), finishedAt: done ? validTime(operation.updatedAt) : null,
        durationMs: done ? elapsed(validTime(operation.createdAt), validTime(operation.updatedAt)) : null, durationBasis: "observed-lifecycle",
        outputBytes: output === null ? null : Buffer.byteLength(output), outputBasis: "retained-utf8", hasArguments: true, hasOutput: output !== null,
      };
      sources.push({ entry, arguments: async () => json(await this.host.workflow(source, operation.id)), output: () => output });
    };
    for (const operation of snapshot.githubOperations.filter((operation) => operation.originSessionId === session.id)) appendWorkflow("github", { ...operation, action: operation.kind });
    for (const operation of snapshot.linearOperations.filter((operation) => operation.sessionId === session.id)) appendWorkflow("linear", { ...operation, actor: operation.modelSource ? "model" : "user" });
    return { sources: sources.sort((a, b) => a.entry.sequence - b.entry.sequence || a.entry.id.localeCompare(b.entry.id)),
      messageOrder: [...messageOrder].map(([id, sequence]) => ({ id, sequence })) };
  }
  private turn(session: Session, turnId: string): TurnInfo {
    const saved = this.host.snapshot().sessionTelemetry?.[session.id]?.turns.find((turn) => turn.turnId === turnId);
    if (saved) return saved;
    const budget = this.host.turnBudget(session.id, turnId);
    return retainedTurnInfo(session, turnId, this.host.events(), this.host.snapshot().profileId, budget);
  }
  async query(query: ActivityQuery): Promise<ActivityResponse> {
    const session = this.session(query.sessionId);
    if (query.type === "activity.turn") return { type: query.type, info: this.turn(session, query.turnId) };
    const { sources, messageOrder } = this.sources(session);
    if (query.type === "activity.list") {
      const scoped = query.toolName === undefined ? sources : sources.filter((source) => source.entry.toolName === query.toolName);
      const matching = scoped.filter((source) => query.before === undefined || source.entry.updatedSequence < query.before.sequence ||
        source.entry.updatedSequence === query.before.sequence && source.entry.id.localeCompare(query.before.id) < 0)
        .sort((a, b) => a.entry.updatedSequence - b.entry.updatedSequence || a.entry.id.localeCompare(b.entry.id));
      const entries = matching.slice(-(query.limit ?? 100)).map((source) => source.entry);
      const current = scoped.map((source) => source.entry).filter((entry) => entry.status === "running" || entry.status === "waiting_input");
      return { type: query.type, activity: { sessionId: session.id, sequence: this.host.snapshot().seq, entries, messageOrder,
        current: current.slice(-100), currentCount: current.length,
        nextBefore: matching.length > entries.length ? { sequence: entries[0]!.updatedSequence, id: entries[0]!.id } : null } };
    }
    if (query.tail && (query.offset !== undefined || query.part !== "output")) throw new MoguriError("activity_paging", "Tail reads require output with no byte offset. Choose one paging mode; no source was substituted.");
    const source = sources.find((source) => source.entry.id === query.activityId);
    if (!source || query.toolName !== undefined && source.entry.toolName !== query.toolName) throw new MoguriError("activity_missing", "This exact activity has no matching retained source in this session/profile. No other operation was substituted.", 404);
    const content = query.part === "arguments" ? await source.arguments() : source.output();
    if (content === null) return { type: query.type, entry: source.entry, part: query.part, content: null };
    const limit = query.limit ?? 16384;
    let offset = query.offset ?? 0;
    if (query.tail) {
      const bytes = Buffer.from(content);
      offset = Math.max(0, bytes.length - limit);
      while (offset < bytes.length && (bytes[offset]! & 0xc0) === 0x80) offset++;
    }
    const page = textFilePage(content, { offset, limit });
    return { type: query.type, entry: source.entry, part: query.part, content: { text: page.text, bytes: page.bytes, offset: page.offset, nextOffset: page.nextOffset } };
  }
}
