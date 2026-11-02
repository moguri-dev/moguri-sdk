import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";
import type { Session } from "./index.ts";
import { sessionWaiting } from "./session-controls.ts";

const id = Type.String({ minLength: 1, maxLength: 128 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const revision = Type.Integer({ minimum: 0 });
export const ModelAuthorizationChangeSchema = Type.Object({
  providerId: id, actor: Type.Literal("user"), commandId: id, commandDigest: hash,
}, { additionalProperties: false });
export const RECOVERY_DELAYS_MS = [30_000, 90_000, 120_000, 180_000] as const;
export const ModelFailureSchema = Type.Object({
  id, revision, profileId: id, sessionId: id, projectId: Type.Union([id, Type.Null()]), turnId: id, sourceStepId: id,
  requestDigest: Type.Union([hash, Type.Null()]), promptSequence: Type.Integer({ minimum: 1 }),
  failedAt: Type.String(), updatedAt: Type.String(), retryable: Type.Boolean(),
  lastRetryable: Type.Boolean(),
  status: Type.Union([Type.Literal("pending"), Type.Literal("retrying"), Type.Literal("recovered"), Type.Literal("exhausted"), Type.Literal("blocked"), Type.Literal("cancelled")]),
  attemptId: Type.Union([id, Type.Null()]), attemptStepId: Type.Union([id, Type.Null()]), attemptCount: revision,
  diagnostic: Type.String({ minLength: 1, maxLength: 4096 }),
}, { additionalProperties: false });
export type ModelFailure = Static<typeof ModelFailureSchema>;
export const RecoveryCycleSchema = Type.Object({
  id, profileId: id, revision, generation: revision, startedAt: Type.String(),
  round: Type.Integer({ minimum: 0, maximum: 4 }),
  status: Type.Union([Type.Literal("active"), Type.Literal("idle"), Type.Literal("exhausted")]),
  roundAt: Type.Union([Type.String(), Type.Null()]),
  skippedRounds: Type.Array(Type.Integer({ minimum: 0, maximum: 3 }), { maxItems: 3, uniqueItems: true }),
  targets: Type.Array(Type.Object({ failureId: id, attemptId: id }, { additionalProperties: false }), { maxItems: 10000 }),
}, { additionalProperties: false });
export type RecoveryCycle = Static<typeof RecoveryCycleSchema>;
export function recoveryDueRound(cycle: RecoveryCycle | null, now: number): number | null {
  if (!cycle || cycle.status !== "active" || cycle.round >= RECOVERY_DELAYS_MS.length) return null;
  const elapsed = now - Date.parse(cycle.startedAt);
  let due: number | null = null;
  for (let round = cycle.round; round < RECOVERY_DELAYS_MS.length; round++) if (elapsed >= RECOVERY_DELAYS_MS[round]!) due = round;
  return due;
}
export function retryFailure(session: Session, failures: readonly ModelFailure[]): ModelFailure | undefined {
  if (session.status !== "failed" || session.turnId || sessionWaiting(session)) return;
  const last = failures.findLast((failure) => failure.sessionId === session.id);
  return last?.id === session.lastModelFailureId && last?.requestDigest && last.retryable && last.lastRetryable &&
    ["pending", "exhausted", "blocked"].includes(last.status) ? last : undefined;
}
export function projectModelFailure(previous: ModelFailure | undefined, next: ModelFailure): ModelFailure {
  const transitions: Record<ModelFailure["status"], ModelFailure["status"][]> = {
    pending: ["retrying", "blocked", "cancelled", "exhausted"], retrying: ["retrying", "pending", "recovered", "blocked", "cancelled"],
    recovered: [], exhausted: ["retrying", "pending", "cancelled", "blocked"], blocked: ["retrying", "cancelled", "blocked"], cancelled: [],
  };
  if (!Value.Check(ModelFailureSchema, next) || next.revision !== (previous?.revision ?? -1) + 1 ||
    !Number.isFinite(Date.parse(next.failedAt)) || !Number.isFinite(Date.parse(next.updatedAt)) ||
    next.status === "retrying" && (!next.retryable || !next.lastRetryable || !next.requestDigest || !next.attemptId) ||
    ["pending", "exhausted"].includes(next.status) && (!next.retryable || !next.lastRetryable || !next.requestDigest) ||
    !previous && (next.attemptCount !== 0 || next.attemptId !== null || next.attemptStepId !== null || !["pending", "blocked"].includes(next.status)) ||
    previous && (!transitions[previous.status].includes(next.status) ||
      (["id", "profileId", "sessionId", "projectId", "turnId", "sourceStepId", "requestDigest", "promptSequence", "failedAt", "retryable"] as const)
        .some((key) => previous[key] !== next[key]) ||
      next.attemptCount !== previous.attemptCount + (next.status === "retrying" && previous.status !== "retrying" ? 1 : 0) ||
      previous.status === "retrying" && next.status === "retrying" && (previous.attemptId !== next.attemptId || previous.attemptStepId !== null || !next.attemptStepId))) {
    throw new MoguriError("model_recovery_corrupt", "Model recovery lost its exact original request, attempt or terminal transition. State was preserved.", 409);
  }
  return structuredClone(next);
}
export function projectRecoveryCycle(previous: RecoveryCycle | null, next: RecoveryCycle): RecoveryCycle {
  if (!Value.Check(RecoveryCycleSchema, next) || next.revision !== (previous?.revision ?? -1) + 1 ||
    !Number.isFinite(Date.parse(next.startedAt)) || next.roundAt !== null && !Number.isFinite(Date.parse(next.roundAt)) ||
    !previous && (next.generation !== 0 || next.round !== 0 || next.status !== "active") ||
    previous && (next.id !== previous.id || next.profileId !== previous.profileId || next.generation < previous.generation ||
      next.generation > previous.generation + 1 || next.generation === previous.generation &&
      (next.startedAt !== previous.startedAt || next.round < previous.round) ||
      next.generation !== previous.generation && next.round !== 0) ||
    new Set(next.targets.map((target) => target.failureId)).size !== next.targets.length ||
    new Set(next.targets.map((target) => target.attemptId)).size !== next.targets.length) {
    throw new MoguriError("model_recovery_corrupt", "Shared recovery timing or attempt ownership changed or replayed. State was preserved.", 409);
  }
  return structuredClone(next);
}
