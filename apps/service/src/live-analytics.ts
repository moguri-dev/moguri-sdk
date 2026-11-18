import { LIVE_ANALYTICS_LIMITS, type AnalyticsEvent, type AnalyticsLane, type AnalyticsOverview, type AnalyticsQuery, type AnalyticsResponse,
  type AnalyticsSessionSummary, type AnalyticsStatus, type AnalyticsTotals, type Snapshot, type StoredEvent, type ToolCall } from "../../../packages/protocol/src/index.ts";

type Limits = { readonly [K in keyof typeof LIVE_ANALYTICS_LIMITS]: number };
interface Track {
  sessionId: string; startedAt: number; lastEventAt: number; firstPrompt: string;
  events: AnalyticsEvent[]; open: Map<string, AnalyticsEvent>; truncated: boolean;
}
interface Host { profileId: string; snapshot(): Snapshot; events(): StoredEvent[]; now?: () => number }

const COMMAND_TOOLS = new Set(["run_command", "command_job", "read_command_job", "run_script", "review_script", "read_agent_terminal", "bash", "shell", "exec_command", "bashoutput", "killshell"]);
const FILE_TOOLS = new Set(["read_file", "write_file", "edit_file", "list_files", "find_files", "search_files", "diff_files", "read_tool_result", "edit_document", "write_document",
  "read_document", "inspect_document", "list_documents", "search_document", "grep_logs", "find_references", "goto_definition", "read", "write", "edit", "multiedit", "glob", "grep", "ls",
  "notebookedit", "apply_patch"]);
const WEB_TOOLS = new Set(["web_fetch", "web_search", "fetch_page", "playwright", "click", "type", "take_screenshot", "render_html", "webfetch", "websearch"]);
const TRACKED = new Set<string>(["turn.started", "turn.control_started", "steer.applied", "question.answered", "model.started", "agent.step_started", "assistant.delta",
  "model.completed", "agent.message", "model.failure_recorded", "tool.started", "tool.completed", "tool.background_completed", "compaction.saved", "context.changed", "turn.finished"]);
const EDIT_TOOLS = new Set(["write_file", "edit_file", "edit_document", "write_document", "write", "edit", "multiedit", "notebookedit", "apply_patch"]);

export const toolLane = (call: Pick<ToolCall, "name" | "directMcp">): AnalyticsLane => {
  const name = call.name.toLowerCase();
  if (call.directMcp || name === "mcp_gateway" || name.startsWith("mcp__")) return "tool";
  return COMMAND_TOOLS.has(name) ? "command" : FILE_TOOLS.has(name) ? "file" : WEB_TOOLS.has(name) ? "web" : "tool";
};
const preview = (value: unknown, limit: number): string => {
  const text = (typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value) ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};
const argument = (call: ToolCall, lane: AnalyticsLane): unknown => {
  const args = call.arguments;
  if (call.directMcp) return call.directMcp.tool;
  if (lane === "command") return args.command ?? args.script ?? args.cmd ?? args.jobId;
  if (lane === "file") return args.path ?? args.file_path ?? args.pattern ?? args.query ?? args.paths;
  if (lane === "web") return args.url ?? args.query ?? args.selector;
  return args.tool ?? args.name ?? args.query ?? args.path;
};

/**
 * Live, in-memory turn analytics for running and recent sessions. Nothing here is persisted, exported,
 * added to model context or replayed. Data older than the rolling window is pruned on a short timer.
 */
export class LiveAnalytics {
  private readonly tracks = new Map<string, Track>();
  private timer: NodeJS.Timeout | null = null;
  private cpu: { at: number; usage: NodeJS.CpuUsage; percent: number | null } | null = null;
  constructor(private readonly host: Host, private readonly limits: Limits = LIVE_ANALYTICS_LIMITS) {}
  private now(): number { return this.host.now?.() ?? Date.now(); }

  start(): void {
    if (this.timer) return;
    const cutoff = this.now() - this.limits.windowMs, history = this.host.events();
    let first = history.length;
    while (first > 0 && Date.parse(history[first - 1]!.timestamp) >= cutoff) first--;
    this.observe(history.slice(first));
    this.prune();
    this.timer = setInterval(() => this.prune(), this.limits.pruneEveryMs);
    this.timer.unref();
  }
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.tracks.clear();
  }

  observe(events: readonly StoredEvent[]): void {
    for (const event of events) {
      if (event.profile_id !== this.host.profileId || !event.session_id) continue;
      if (event.event_type === "session.deleted" || event.event_type === "session.archived") { this.tracks.delete(event.session_id); continue; }
      this.ingest(event, event.session_id);
    }
    if (this.tracks.size > this.limits.sessions) this.prune();
  }

  query(query: AnalyticsQuery): AnalyticsResponse {
    if (query.type === "analytics.overview") return { type: query.type, analytics: this.overview() };
    const snapshot = this.host.snapshot(), track = this.tracks.get(query.sessionId), session = snapshot.sessions.find((value) => value.id === query.sessionId);
    if (!session || session.status === "archived" || (!track && !this.active(session))) return { type: query.type, session: null };
    const value = track ?? this.track(session.id, Date.parse(session.updatedAt));
    return { type: query.type, session: { summary: this.summary(snapshot, value), events: value.events.map((event) => ({ ...event })), truncated: value.truncated } };
  }

  overview(): AnalyticsOverview {
    this.prune();
    const snapshot = this.host.snapshot(), now = this.now();
    for (const session of snapshot.sessions) if (this.active(session) && !this.tracks.has(session.id)) this.track(session.id, Date.parse(session.updatedAt));
    const sessions = [...this.tracks.values()].map((track) => this.summary(snapshot, track))
      .sort((a, b) => Number(b.state !== "idle") - Number(a.state !== "idle") || b.lastEventAt - a.lastEventAt || a.sessionId.localeCompare(b.sessionId));
    const usage = process.cpuUsage(), at = Number(process.hrtime.bigint() / 1_000_000n);
    if (!this.cpu) this.cpu = { at, usage, percent: null };
    else if (at - this.cpu.at >= 500) {
      const used = (usage.user - this.cpu.usage.user + usage.system - this.cpu.usage.system) / 1000;
      this.cpu = { at, usage, percent: Math.max(0, Math.round(used / (at - this.cpu.at) * 1000) / 10) };
    }
    return {
      generatedAt: now, windowMs: this.limits.windowMs, pruneEveryMs: this.limits.pruneEveryMs,
      live: sessions.filter((session) => session.state !== "idle").length, working: sessions.filter((session) => session.state === "working").length,
      projects: new Set(sessions.flatMap((session) => session.projectId ? [session.projectId] : [])).size,
      serviceCpuPercent: this.cpu.percent, serviceMemoryBytes: process.memoryUsage().rss,
      mcpServers: snapshot.settings.values.mcpServers.filter((server) => server.enabled).length, sessions,
    };
  }

  /** Drops data outside the rolling window, deleted/archived sessions and anything over the caps. */
  prune(): void {
    const snapshot = this.host.snapshot(), cutoff = this.now() - this.limits.windowMs;
    const sessions = new Map(snapshot.sessions.map((session) => [session.id, session]));
    for (const [id, track] of this.tracks) {
      const session = sessions.get(id);
      if (!session || session.status === "archived") { this.tracks.delete(id); continue; }
      track.events = track.events.filter((event) => event.status === "running" || (event.end ?? event.start) >= cutoff);
      if (track.lastEventAt < cutoff && !this.active(session)) this.tracks.delete(id);
    }
    if (this.tracks.size <= this.limits.sessions) return;
    const idle = [...this.tracks.values()].filter((track) => !this.active(sessions.get(track.sessionId)!)).sort((a, b) => a.lastEventAt - b.lastEventAt);
    for (const track of idle.slice(0, this.tracks.size - this.limits.sessions)) this.tracks.delete(track.sessionId);
  }

  private active(session: Snapshot["sessions"][number]): boolean {
    return session.status !== "archived" && (session.turnId !== null || Boolean(session.pendingApproval || session.pendingQuestionId) || session.status === "waiting_input");
  }
  private track(sessionId: string, at: number): Track {
    let track = this.tracks.get(sessionId);
    if (!track) {
      track = { sessionId, startedAt: at, lastEventAt: at, firstPrompt: "", events: [], open: new Map(), truncated: false };
      this.tracks.set(sessionId, track);
    }
    return track;
  }
  private push(track: Track, event: AnalyticsEvent): void {
    track.events.push(event);
    if (event.status === "running") track.open.set(event.id, event);
    if (track.events.length <= this.limits.eventsPerSession) return;
    const index = track.events.findIndex((value) => value.status !== "running");
    const [removed] = track.events.splice(index < 0 ? 0 : index, 1);
    if (removed) track.open.delete(removed.id);
    track.truncated = true;
  }
  private finish(track: Track, key: string, at: number, status: AnalyticsStatus): AnalyticsEvent | undefined {
    const event = track.open.get(key);
    if (!event) return undefined;
    track.open.delete(key);
    event.end = Math.max(event.start, at); event.status = status;
    return event;
  }

  private ingest(event: StoredEvent, sessionId: string): void {
    const at = Date.parse(event.timestamp);
    if (!Number.isFinite(at)) return;
    if (!TRACKED.has(event.event_type)) return;
    const track = this.track(sessionId, at), limit = this.limits.previewChars, turnId = event.turn_id ?? null, step = event.step_id ?? null;
    track.lastEventAt = Math.max(track.lastEventAt, at);
    const instant = (lane: AnalyticsLane, id: string, label: string, detail = label, status: AnalyticsStatus = "ok") =>
      this.push(track, { id, lane, turnId, start: at, end: at, label: preview(label, 120), detail: preview(detail, limit), status });
    switch (event.event_type) {
      case "turn.started": {
        const text = event.payload.item.text;
        if (!track.firstPrompt) track.firstPrompt = preview(text, limit);
        instant("prompt", `prompt:${event.id}`, text || "Prompt with attachments");
        break;
      }
      case "steer.applied": instant("prompt", `steer:${event.id}`, `Steer: ${event.payload.item.text}`); break;
      case "question.answered": instant("prompt", `answer:${event.id}`, "Answered a question"); break;
      case "turn.control_started": instant("context", `control:${event.id}`, `Started ${event.payload.purpose.replace(".", " ")}`); break;
      case "compaction.saved": instant("context", `compaction:${event.id}`, "Context compacted"); break;
      case "context.changed": instant("context", `context:${event.id}`, event.payload.activeCompactionId ? "Switched to compacted context" : "Restored full context"); break;
      case "model.started": case "agent.step_started": {
        if (!step) break;
        this.finish(track, `model:${step}`, at, "stopped");
        this.push(track, { id: `model:${step}`, lane: "answer", turnId, start: at, end: null, label: "Generating", detail: "", status: "running", modelId: event.payload.modelId });
        break;
      }
      case "assistant.delta": {
        const open = step ? track.open.get(`model:${step}`) : undefined;
        if (open && open.detail.length < limit) open.detail = preview(open.detail + event.payload.text, limit);
        break;
      }
      case "model.completed": case "agent.message": {
        const message = event.payload.message, key = `model:${event.event_type === "agent.message" ? message.id : step ?? message.id}`;
        let answer = this.finish(track, key, at, "ok") ?? track.events.find((value) => value.id === key);
        if (!answer) { answer = { id: key, lane: "answer", turnId, start: at, end: at, label: "", detail: "", status: "ok" }; this.push(track, answer); }
        const calls = message.toolCalls?.length ?? 0;
        answer.label = preview(message.text || (calls ? `Requested ${calls} tool call${calls === 1 ? "" : "s"}` : "Empty response"), 120);
        answer.detail = preview(message.text, limit);
        answer.end = Math.max(answer.start, at);
        if (event.event_type === "model.completed") {
          const usage = event.payload.usage;
          answer.modelId = usage.modelId; answer.inputTokens = usage.inputTokens; answer.outputTokens = usage.outputTokens;
        }
        if (message.reasoning) {
          const id = `thinking:${key}`, existing = track.events.find((value) => value.id === id);
          if (existing) { existing.end = answer.end; existing.detail = preview(message.reasoning, limit); existing.label = preview(message.reasoning, 120); }
          else this.push(track, { id, lane: "thinking", turnId, start: answer.start, end: answer.end, label: preview(message.reasoning, 120), detail: preview(message.reasoning, limit), status: "ok",
            ...(answer.modelId ? { modelId: answer.modelId } : {}) });
        }
        break;
      }
      case "model.failure_recorded": {
        const key = `model:${event.payload.failure.sourceStepId}`, failed = this.finish(track, key, at, "failed") ?? track.events.find((value) => value.id === key);
        if (failed) { failed.status = "failed"; failed.label = "Model call failed"; }
        break;
      }
      case "tool.started": {
        const call = event.payload.call, lane = toolLane(call), mcp = Boolean(call.directMcp || call.name === "mcp_gateway" || call.name.startsWith("mcp__"));
        const target = preview(argument(call, lane), 100);
        this.push(track, { id: `tool:${call.id}`, lane, turnId, start: at, end: null, label: target ? `${call.name} ${target}` : call.name, detail: preview(call.arguments, limit),
          status: "running", tool: call.name, ...(mcp ? { mcp: true as const } : {}), ...(EDIT_TOOLS.has(call.name.toLowerCase()) ? { edit: true as const } : {}) });
        break;
      }
      case "tool.completed":
      case "tool.background_completed": {
        if (event.event_type === "tool.completed" && event.payload.outcome === "background") break;
        const done = this.finish(track, `tool:${event.payload.call.id}`, at, event.payload.isError ? "failed" : "ok");
        if (done && event.payload.text) done.detail = preview(event.payload.text, limit);
        break;
      }
      case "turn.finished": {
        const status: AnalyticsStatus = event.payload.outcome === "completed" ? "ok" : event.payload.outcome === "failed" ? "failed" : "stopped";
        for (const [key, open] of [...track.open]) if (open.turnId === turnId) this.finish(track, key, at, status === "ok" ? "stopped" : status);
        if (status !== "ok") instant("context", `finished:${event.id}`, status === "failed" ? "Turn failed" : "Turn stopped", event.payload.diagnostic ?? "", status);
        break;
      }
    }
  }

  private summary(snapshot: Snapshot, track: Track): AnalyticsSessionSummary {
    const session = snapshot.sessions.find((value) => value.id === track.sessionId);
    const project = session?.projectId ? snapshot.projects.find((value) => value.id === session.projectId) : undefined;
    const waiting = Boolean(session && (session.pendingApproval || session.pendingQuestionId || session.status === "waiting_input"));
    return {
      sessionId: track.sessionId, title: session?.titleSource === "factory" ? "New session" : session?.title ?? "Unavailable session",
      projectId: session?.projectId ?? null, projectName: project?.name ?? null,
      state: waiting ? "waiting" : session?.turnId ? "working" : "idle",
      startedAt: track.events[0]?.start ?? track.startedAt, lastEventAt: track.lastEventAt, firstPrompt: track.firstPrompt, totals: totals(track.events),
    };
  }
}

export function totals(events: readonly AnalyticsEvent[]): AnalyticsTotals {
  const result: AnalyticsTotals = { prompts: 0, answers: 0, commands: 0, mcpCalls: 0, edits: 0, failed: 0, inputTokens: 0, outputTokens: 0, unreportedCalls: 0, models: [] };
  const models = new Set<string>();
  for (const event of events) {
    if (event.lane === "prompt") result.prompts++;
    if (event.lane === "command") result.commands++;
    if (event.mcp) result.mcpCalls++;
    if (event.edit) result.edits++;
    if (event.status === "failed") result.failed++;
    if (event.lane !== "answer") continue;
    result.answers++;
    if (event.modelId) models.add(event.modelId);
    if (event.status === "running") continue;
    if (typeof event.inputTokens === "number") result.inputTokens += event.inputTokens;
    if (typeof event.outputTokens === "number") result.outputTokens += event.outputTokens;
    if (typeof event.inputTokens !== "number" || typeof event.outputTokens !== "number") result.unreportedCalls++;
  }
  result.models = [...models];
  return result;
}
