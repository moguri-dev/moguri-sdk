import { type OperationEntry, type RetainedToolSource, type StoredEvent } from "../../../packages/protocol/src/index.ts";
import { digest } from "./store.ts";

type Completed = Extract<StoredEvent, { event_type: "tool.completed" }>;
export interface PublicToolResult { source: RetainedToolSource; event: Completed }
export function publicToolResults(history: readonly StoredEvent[], operations: readonly OperationEntry[], profileId: string, sessionId: string): PublicToolResult[] {
  const events = history.filter((event) => event.profile_id === profileId && event.session_id === sessionId);
  const publicTurns = new Set(events.filter((event) => event.event_type === "turn.started").map((event) => event.turn_id));
  const privateTurns = new Set(events.filter((event) => event.event_type === "turn.control_started").map((event) => event.turn_id));
  const completions = new Map<string, Completed>(), ambiguous = new Set<string>();
  const identity = (event: StoredEvent, callId: string) => JSON.stringify([event.turn_id, event.step_id, callId]);
  const originals = new Map<string, string>();
  for (const event of events) {
    if (event.event_type !== "tool.requested" && event.event_type !== "tool.started" && event.event_type !== "tool.completed") continue;
    const call = event.event_type === "tool.requested" ? event.payload.approval.call : event.payload.call;
    if (call.hook || !event.turn_id || !event.step_id || !publicTurns.has(event.turn_id) || privateTurns.has(event.turn_id)) continue;
    const key = identity(event, call.id), original = JSON.stringify(call);
    if (originals.has(key) && originals.get(key) !== original) ambiguous.add(key);
    originals.set(key, original);
    if (event.event_type === "tool.completed") completions.set(key, event);
  }
  const byOperation = new Map(operations.filter((entry) => entry.profileId === profileId && entry.sessionId === sessionId)
    .map((entry) => [JSON.stringify([entry.turnId, entry.stepId, entry.callHash]), entry]));
  return [...completions.entries()].flatMap(([key, event]) => {
    const operation = byOperation.get(JSON.stringify([event.turn_id, event.step_id, digest(event.payload.call.id)]));
    if (ambiguous.has(key) || !operation || operation.diagnostic === "duplicate-start" || !event.turn_id || !event.step_id) return [];
    const source: RetainedToolSource = { operationId: operation.id, sessionId, turnId: event.turn_id,
      stepId: event.step_id, callId: event.payload.call.id, revision: operation.revision };
    return [{ source, event }];
  });
}
