import { createHash } from "node:crypto";
import { MoguriError, isRecord, parse, type Session, type Snapshot, type EventInput, type ModelAdviceSource, TaskProgressToolSchema } from "../../../packages/protocol/src/index.ts";
import { StateSeedSchema, StateQuerySchema, StateMutationSchema, type StateSeed } from "../../../packages/protocol/src/tooling.ts";
import type { EventStore } from "./store.ts";
import type { TaskProgressRuntime } from "./task-progress.ts";
import type { TieredKnowledge } from "./knowledge.ts";
import { runDataTask } from "./data-tools.ts";

interface Host {
  snapshot(): Snapshot; scope(session: Session): string; commit(events: EventInput[]): void;
  progress: TaskProgressRuntime; knowledge: TieredKnowledge;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class SessionStateSql {
  constructor(private readonly store: EventStore, private readonly host: Host) {}
  private capture(sessionId: string) {
    const snapshot = this.host.snapshot(), session = snapshot.sessions.find((session) => session.id === sessionId);
    if (!session) throw new MoguriError("state_scope", "This state view belongs to another or deleted session.", 403);
    const plan = this.host.progress.currentPlan(sessionId);
    const records = snapshot.knowledge.filter((record) => record.tier === "Sky" ? record.sessionId === sessionId : record.tier === "Terra" && record.projectId === session.projectId && session.projectId !== null);
    const seed: StateSeed = { todos: (plan?.steps ?? []).map((step, index) => ({ id: index + 1, text: step.text, status: step.status })),
      memories: records.map((record) => ({ id: record.id, title: record.title, text: this.store.blob(record.contentDigest), tier: record.tier === "Sky" ? "Sky" : "Terra" })) };
    if (Buffer.byteLength(JSON.stringify(seed)) > 8 * 1024 * 1024) throw new MoguriError("state_limit", "The complete domain view exceeds 8 MiB. Use the existing scoped knowledge APIs; no notes were silently omitted.");
    const sourceDigest = hash([snapshot.profileId, session.id, session.turnId, this.host.scope(session), session.mode, session.pendingMode,
      snapshot.policy.revision, snapshot.settings.permissionRevision, plan, records, seed]);
    return { session, plan, seed, sourceDigest };
  }
  async execute(sessionId: string, action: "query" | "mutate", input: unknown, signal: AbortSignal, source?: ModelAdviceSource) {
    const before = this.capture(sessionId), args = action === "query" ? parse(StateQuerySchema, input) : parse(StateMutationSchema, input);
    if (action === "mutate" && (!source || !before.session.turnId || before.session.mode !== "agent" || before.session.pendingMode === "read-only")) throw new MoguriError("state_owner", "State writes require an actual writable owning model turn and its exact tool grant.", 403);
    if ("expectedDigest" in args && args.expectedDigest !== before.sourceDigest) throw new MoguriError("state_stale", "The exact todo/memory source changed. Query it again before proposing a transaction.", 409);
    const result = await runDataTask({ kind: "state_sql", arguments: args, seed: before.seed }, signal);
    signal.throwIfAborted();
    if (this.capture(sessionId).sourceDigest !== before.sourceDigest) throw new MoguriError("state_stale", "State, owner, root or policy changed during SQL evaluation. No stale data or domain write was returned.", 409);
    if (!isRecord(result)) throw new MoguriError("state_result", "The isolated SQL evaluator returned no valid domain result.");
    if (action === "query") {
      const rawText = JSON.stringify({ ...result, sourceDigest: before.sourceDigest, planTitle: before.plan?.title ?? null,
        schema: "todos(id = contiguous 1-based plan position,text,status); memories(id,title,text,tier). Mutations use canonical domain events, not raw state tables.",
        boundary: "Scoped control-plane domain projection; no filesystem database or automatic memory injection." });
      return { text: rawText.length <= 12000 ? rawText : JSON.stringify({ sourceDigest: before.sourceDigest, complete: false, preview: rawText.slice(0, 8000) }),
        rawText, rawComplete: result.complete === true, isError: false, outcome: "completed" };
    }
    if (!source || !before.session.turnId || !("statements" in args)) throw new MoguriError("state_owner", "The original model write owner is unavailable.");
    const after = parse(StateSeedSchema, result.after), oldNotes = new Map(before.seed.memories.map((record) => [record.id, record]));
    if (before.seed.memories.some((record) => !after.memories.some((next) => next.id === record.id))) throw new MoguriError("state_forget", "Memory deletion requires its separate actual-user forget review. No rows or notes were removed.", 403);
    const changed = after.memories.filter((record) => !oldNotes.has(record.id) || hash(record) !== hash(oldNotes.get(record.id)));
    if (changed.some((record) => record.tier !== "Sky" || oldNotes.get(record.id)?.tier === "Terra")) throw new MoguriError("state_promotion", "Model SQL writes only current-session Sky notes. Project/profile promotion or edits need their actual-user knowledge reviews.", 403);
    const events: EventInput[] = [];
    if (hash(before.seed.todos) !== hash(after.todos)) {
      if (after.todos.some((step, index) => step.id !== index + 1)) throw new MoguriError("state_todos", "Todo IDs are contiguous 1-based plan positions. No silent ID remapping was performed.");
      const title = args.planTitle ?? before.plan?.title;
      if (!title) throw new MoguriError("state_plan_title", "A new explicit plan needs planTitle. No task title was invented.");
      const plan = parse(TaskProgressToolSchema, { action: "plan", title, steps: after.todos.map(({ text, status }) => ({ text, status })) });
      if (plan.action !== "plan") throw new MoguriError("state_plan", "The transaction did not produce a canonical plan action.");
      events.push(this.host.progress.planEvent(sessionId, before.session.turnId, source, plan));
    }
    events.push(...this.host.knowledge.modelEvents(sessionId, source, changed, hash([before.session.turnId, source.stepId, source.callId])));
    signal.throwIfAborted();
    try { this.host.commit(events); }
    catch (error) { throw new MoguriError("tool_partial", `Domain state publication is unconfirmed: ${error instanceof Error ? error.message : "retention failed"}. Inspect actual state before retrying.`, 409); }
    return { text: JSON.stringify({ committed: true, events: events.length, todoSteps: after.todos.length, changedNotes: changed.length, sourceDigest: this.capture(sessionId).sourceDigest,
      authority: "Actual model-authored domain state, not user acceptance, permission, memory promotion or automatic injection." }), isError: false, outcome: "completed" };
  }
}
