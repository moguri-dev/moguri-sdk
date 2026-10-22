import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";
import { successfulRoleEntry } from "./role-sequences.ts";
import type { BudgetEntry } from "./budgets.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const name = Type.String({ pattern: "^[A-Za-z][A-Za-z0-9_-]{0,63}$" }), text = Type.String({ minLength: 1, maxLength: 4096 });
const probability = Type.Number({ minimum: 0, maximum: 1 });
export const DecisionQuestionSchema = Type.Union([
  object({ type: Type.Literal("noul"), instructions: text, criteria: Type.Optional(object({ true: text, false: text })) }),
  object({ type: Type.Literal("choice"), instructions: text, criteria: Type.Record(name, text, { minProperties: 1, maxProperties: 32, additionalProperties: false }) }),
  object({ type: Type.Literal("score"), instructions: text, criteria: Type.Array(text, { minItems: 1, maxItems: 10 }) }),
]);
export const DecisionQuestionsSchema = Type.Record(name, DecisionQuestionSchema, { minProperties: 1, maxProperties: 16, additionalProperties: false });
export type DecisionQuestions = Static<typeof DecisionQuestionsSchema>;
const distribution = Type.Record(Type.String({ maxLength: 64 }), probability, { minProperties: 1, maxProperties: 32 });
export const DecisionAnswerSchema = Type.Union([
  object({ type: Type.Literal("noul"), noul: probability }),
  object({ type: Type.Literal("choice"), choice: name, confidence: probability, probabilities: distribution }),
  object({ type: Type.Literal("score"), score: Type.Number({ minimum: 0, maximum: 9 }), confidence: probability, legend: Type.Record(Type.String({ maxLength: 2 }), text), probabilities: distribution }),
]);
export const DecisionAnswersSchema = Type.Record(name, DecisionAnswerSchema, { minProperties: 1, maxProperties: 16, additionalProperties: false });
export const DecisionAdviceSchema = object({ answers: DecisionAnswersSchema });
export type DecisionAdvice = Static<typeof DecisionAdviceSchema>;
const id = Type.String({ minLength: 1, maxLength: 128 });
export const DecisionSettingsSchema = object({
  enabled: Type.Boolean(), provider: Type.Union([Type.Literal("bounded-model"), Type.Literal("jev")]), modelId: Type.Union([id, Type.Null()]),
  allowHosted: Type.Boolean(), outputTokens: Type.Integer({ minimum: 32, maximum: 4096 }), timeoutMs: Type.Integer({ minimum: 1000, maximum: 60000 }),
  maxCallsPerTurn: Type.Integer({ minimum: 1, maximum: 16 }), minimumConfidence: probability, minimumProbability: probability,
  reviewDelegatedTools: Type.Boolean(),
  technicalQuestions: Type.Array(object({ id, kind: Type.Literal("technical-choice"), question: Type.String({ minLength: 1, maxLength: 16384 }),
    choices: Type.Array(Type.String({ minLength: 1, maxLength: 240 }), { minItems: 2, maxItems: 8, uniqueItems: true }) }), { maxItems: 32 }),
  steering: Type.Boolean(), steeringChoices: Type.Array(object({ id: name, text: Type.String({ minLength: 1, maxLength: 1024 }) }), { maxItems: 6 }),
});
export type DecisionSettings = Static<typeof DecisionSettingsSchema>;
export const defaultDecisionSettings = (): DecisionSettings => ({ enabled: false, provider: "bounded-model", modelId: null, allowHosted: false,
  outputTokens: 512, timeoutMs: 15000, maxCallsPerTurn: 4, minimumConfidence: 0.9, minimumProbability: 0.9,
  reviewDelegatedTools: true, technicalQuestions: [], steering: false, steeringChoices: [] });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" }), maybeId = Type.Union([id, Type.Null()]), maybeHash = Type.Union([hash, Type.Null()]);
const revision = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }), time = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
const diagnostic = Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()]);
export const DecisionSourceSchema = Type.Union([
  object({ kind: Type.Literal("tool"), parentStepId: id, callId: id, approvalId: id, argumentsDigest: hash, delegationId: id }),
  object({ kind: Type.Literal("question"), parentStepId: id, callId: id, questionId: id, questionRevision: revision, delegationId: id }),
  object({ kind: Type.Literal("steering"), parentStepId: id, boundaryId: id, queueRevision: revision, delegationId: id }),
]);
export type DecisionSource = Static<typeof DecisionSourceSchema>;
export const DecisionDocumentSchema = object({
  format: Type.Literal("moguri-owned-decision"), version: Type.Literal(1), sessionId: id, turnId: id, source: DecisionSourceSchema,
  root: Type.Union([object({ root: Type.String({ minLength: 1, maxLength: 4096 }), device: Type.String({ pattern: "^[0-9]+$", maxLength: 40 }), inode: Type.String({ pattern: "^[0-9]+$", maxLength: 40 }) }), Type.Null()]),
  state: Type.String({ maxLength: 65536 }), questions: DecisionQuestionsSchema, settings: DecisionSettingsSchema,
  modelJson: Type.String({ minLength: 1, maxLength: 16384 }), systemPrompt: Type.String({ minLength: 1, maxLength: 8192 }),
  inputBound: revision, outputBound: Type.Integer({ minimum: 1, maximum: 4096 }),
  bindingDigest: hash, policyDigest: hash, policyJson: Type.String({ minLength: 1, maxLength: 128 * 1024 }),
});
export type DecisionDocument = Static<typeof DecisionDocumentSchema>;
export const DecisionRecordSchema = object({
  version: Type.Literal(1), id, profileId: id, sessionId: id, turnId: id, ownerSessionId: id, ownerTurnId: maybeId,
  projectId: maybeId, workspaceId: maybeId, env: Type.Literal("Local"), kind: Type.Union([Type.Literal("tool"), Type.Literal("question"), Type.Literal("steering")]),
  source: DecisionSourceSchema, sourceDigest: hash, bindingDigest: hash, policyDigest: hash, inputDigest: hash,
  modelId: id, providerId: id, apiModelId: id, role: Type.Union([Type.Literal("decision"), Type.Literal("steering")]), inputBound: revision, outputBound: revision,
  revision, createdAt: time, updatedAt: time,
  status: Type.Union([Type.Literal("pending"), Type.Literal("running"), Type.Literal("ready"), Type.Literal("applied"), Type.Literal("rejected"), Type.Literal("failed"), Type.Literal("partial")]),
  stepId: maybeId, actualInputDigest: maybeHash, resultDigest: maybeHash, adviceDigest: maybeHash,
  modelOutcome: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
  workerOutcome: Type.Union([Type.Literal("completed"), Type.Literal("stopped"), Type.Literal("failed"), Type.Literal("partial"), Type.Null()]),
  cancellation: Type.Union([Type.Literal("none"), Type.Literal("requested"), Type.Literal("acknowledged"), Type.Literal("unconfirmed")]),
  cleanup: Type.Union([Type.Literal("pending"), Type.Literal("owned-worker-stopped"), Type.Literal("unconfirmed")]),
  applied: Type.Union([object({ actor: Type.Literal("decision-provider"), choice: name, effectDigest: hash, at: time }), Type.Null()]), diagnostic,
});
export type DecisionRecord = Static<typeof DecisionRecordSchema>;
export const activeDecision = (record: DecisionRecord) => ["pending", "running", "ready"].includes(record.status);
function corrupt(message: string): never { throw new MoguriError("decision_corrupt", `${message} State was preserved; no decision, human actor, permission or replay was adopted.`, 409); }
export function projectDecision(previous: DecisionRecord | undefined, value: unknown): DecisionRecord {
  if (!Value.Check(DecisionRecordSchema, value)) corrupt("Owned decision has an unsupported shape/version.");
  const next = value;
  if (next.kind !== next.source.kind || next.role !== (next.kind === "steering" ? "steering" : "decision") ||
    ![next.createdAt, next.updatedAt].every((value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value) ||
    next.projectId === null && next.workspaceId !== null || next.outputBound < 1 || !Number.isSafeInteger(next.inputBound + next.outputBound)) corrupt("Decision source, actual role, bounds or observations disagree.");
  if ((next.stepId === null) !== (next.actualInputDigest === null) || next.stepId === null && (next.resultDigest !== null || next.adviceDigest !== null || next.modelOutcome !== null) ||
    (next.resultDigest === null) !== (next.modelOutcome === null) || next.adviceDigest !== null && next.resultDigest === null ||
    ["ready", "applied"].includes(next.status) && (!next.stepId || !next.resultDigest || !next.adviceDigest || next.modelOutcome !== "stop" ||
      next.workerOutcome !== "completed" || next.cleanup !== "owned-worker-stopped" || next.cancellation !== "none" || next.diagnostic !== null) ||
    next.status === "applied" && !next.applied || next.status !== "applied" && next.applied !== null ||
    ["rejected", "failed", "partial"].includes(next.status) && !next.diagnostic) corrupt("Decision outcome contradicts actual bounded result, worker cleanup or applied actor.");
  if (!previous) {
    if (next.revision !== 0 || next.status !== "pending" || next.createdAt !== next.updatedAt || next.stepId || next.workerOutcome || next.cancellation !== "none" ||
      next.cleanup !== "pending" || next.diagnostic) corrupt("A decision must begin with exact undispatched original request intent.");
  } else {
    const immutable = ["version", "id", "profileId", "sessionId", "turnId", "ownerSessionId", "ownerTurnId", "projectId", "workspaceId", "env", "kind",
      "sourceDigest", "bindingDigest", "policyDigest", "inputDigest", "modelId", "providerId", "apiModelId", "role", "inputBound", "outputBound", "createdAt"] as const;
    if (!activeDecision(previous) || next.revision !== previous.revision + 1 || immutable.some((key) => previous[key] !== next[key]) ||
      JSON.stringify(previous.source) !== JSON.stringify(next.source) ||
      (["stepId", "actualInputDigest", "resultDigest", "adviceDigest", "modelOutcome", "workerOutcome"] as const).some((key) => previous[key] !== null && previous[key] !== next[key]) ||
      previous.cancellation !== "none" && next.cancellation === "none" ||
      previous.cleanup !== "pending" && previous.cleanup !== next.cleanup) corrupt("Original decision owner/request/model, observations or terminal work changed/replayed.");
    if (next.stepId !== null && previous.stepId === null && (previous.status !== "pending" || next.status !== "running") ||
      next.status === "applied" && previous.status !== "ready") corrupt("A decision call or effect lacks its exact serial original boundary.");
  }
  return structuredClone(next);
}
export function validateDecisionLedger(records: DecisionRecord[], entries: BudgetEntry[]): void {
  const used = new Set<string>();
  for (const record of records) {
    if (record.stepId === null) continue;
    const entry = entries.find((entry) => entry.id === record.stepId);
    if (used.has(record.stepId) || !entry || entry.sessionId !== record.sessionId || entry.turnId !== record.turnId || entry.ownerSessionId !== record.ownerSessionId ||
      (entry.ownerTurnId ?? null) !== record.ownerTurnId || entry.projectId !== record.projectId || entry.env !== "Local" || entry.role !== record.role ||
      entry.modelId !== record.modelId || entry.providerId !== record.providerId || entry.apiModelId !== record.apiModelId ||
      entry.inputEstimate === null || entry.inputEstimate > record.inputBound || entry.outputLimit !== record.outputBound ||
      ["ready", "applied"].includes(record.status) && !successfulRoleEntry(entry)) corrupt("Actual decision has no matching original bounded profile-owned model entry.");
    used.add(record.stepId);
  }
}
export const DecisionQuerySchema = Type.Union([
  object({ type: Type.Literal("decisions.status"), sessionId: id }),
  object({ type: Type.Literal("decisions.read"), decisionId: id }),
]);
export type DecisionQuery = Static<typeof DecisionQuerySchema>;
export const isDecisionQuery = (value: unknown): value is DecisionQuery => Value.Check(DecisionQuerySchema, value);
export const DecisionCommandSchema = object({ type: Type.Literal("decisions.stop"), decisionId: id });
export type DecisionCommand = Static<typeof DecisionCommandSchema>;
export const isDecisionCommand = (value: unknown): value is DecisionCommand => Value.Check(DecisionCommandSchema, value);
export type DecisionResponse =
  | { type: "decisions.status"; ready: boolean; provider: DecisionSettings["provider"]; modelId: string | null; reason: string; outputBound: number | null }
  | { type: "decisions.read"; decision: DecisionRecord; input: DecisionDocument; result: string | null; advice: DecisionAdvice | null };
