import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";
import type { Session } from "./index.ts";

/** Protocol 115 store marker for continuing chats interrupted by a quit, restart or crash (D51). */
export const INTERRUPTED_SESSIONS_SCHEMA = "interrupted_sessions_schema";
const id = Type.String({ minLength: 1, maxLength: 128 });
export const SessionInterruptionSchema = Type.Object({
  /** `shutdown`: an explicit quit or service restart stopped the work; `restart`: the service found it still running after an unclean stop. */
  cause: Type.Union([Type.Literal("shutdown"), Type.Literal("restart")]),
  /** The ordinary agent turn that was running, or null when only queued prompts were waiting. */
  turnId: Type.Union([id, Type.Null()]),
  /** Queued prompts that were waiting to run (not already held by the user). Continue releases exactly these. */
  queuedItemIds: Type.Array(id, { maxItems: 100, uniqueItems: true }),
  at: Type.String({ minLength: 20, maxLength: 32 }),
}, { additionalProperties: false });
export type SessionInterruption = Static<typeof SessionInterruptionSchema>;
export interface InterruptedSessionEventPayloads {
  "session.interruption_recorded": { interruption: SessionInterruption | null; actor: "service" | "user" };
}
export const InterruptedSessionCommandSchema = Type.Union([
  /** Continue one interrupted chat: release its waiting prompts and, when a turn was running, queue the built-in continue workflow first. */
  Type.Object({ type: Type.Literal("session.continue"), sessionId: id }, { additionalProperties: false }),
  /** Forget the interruption without continuing; the chat keeps its held prompts and paused state. */
  Type.Object({ type: Type.Literal("session.interruption.dismiss"), sessionId: id }, { additionalProperties: false }),
]);
export type InterruptedSessionCommand = Static<typeof InterruptedSessionCommandSchema>;
export const ContinueInterruptedSchema = Type.Union([Type.Literal("ask"), Type.Literal("always")]);
export type ContinueInterrupted = Static<typeof ContinueInterruptedSchema>;

/** Chats that a quit, restart or crash interrupted and that the user has not continued, dismissed or moved on from. */
export const interruptedSessions = (sessions: readonly Session[]): Session[] =>
  sessions.filter((session) => session.interruption && session.status !== "archived");
export function describeInterruption(interruption: SessionInterruption): string {
  const queued = interruption.queuedItemIds.length, prompts = `${queued} queued prompt${queued === 1 ? "" : "s"}`;
  const cause = interruption.cause === "shutdown" ? "when Moguri quit" : "when Moguri restarted";
  return interruption.turnId ? `Stopped mid-turn ${cause}${queued ? `, with ${prompts} waiting` : ""}` : `${prompts} waiting ${cause}`;
}
/** Validates a recorded interruption against the session it describes at that moment in the event stream. */
export function projectInterruption(session: Pick<Session, "id" | "turnId" | "queue" | "interruption" | "status">, value: SessionInterruption | null): SessionInterruption | undefined {
  if (value === null) {
    if (!session.interruption) throw new MoguriError("interruption_corrupt", "Only a recorded interruption can be dismissed. State was preserved.", 409);
    return undefined;
  }
  const queued = new Map(session.queue.map((item) => [item.id, item]));
  if (!Value.Check(SessionInterruptionSchema, value) || !Number.isFinite(Date.parse(value.at)) || session.status === "archived" ||
    value.turnId !== null && value.turnId !== session.turnId || !value.turnId && !value.queuedItemIds.length ||
    value.queuedItemIds.some((itemId) => { const item = queued.get(itemId); return !item || item.held || item.delivery === "steer"; })) {
    throw new MoguriError("interruption_corrupt", "An interruption lost its exact running turn or waiting prompts. No work was replayed.", 409);
  }
  return structuredClone(value);
}
