import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { ModelRoleSchema, type BudgetEntry } from "./budgets.ts";
import { RoleSequenceStepSchema, validateRoleLedger } from "./role-sequences.ts";
import { LocalCandidateRecordSchema as CandidateRecordSchema, LocalCandidateRootSchema as CandidateRootSchema } from "./candidates.ts";
import { MoguriError } from "./core.ts";
import type { BudgetPlan } from "./budget-plans.ts";
import { OwnedModelTransportSchema } from "./owned-model-transports.ts";
import { SandboxPublicationSchema, SandboxPublicationDocumentSchema } from "./sandbox.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const maybeId = Type.Union([id, Type.Null()]), maybeHash = Type.Union([hash, Type.Null()]);
const timestamp = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
const diagnostic = Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()]);
const gitHash = Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }), maybeGit = Type.Union([gitHash, Type.Null()]);

export const WinddownSettingsSchema = Type.Object({
  enabled: Type.Boolean(), modelId: Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]),
  allowHosted: Type.Boolean(), outputTokens: Type.Integer({ minimum: 32, maximum: 2048 }),
  timeoutMs: Type.Integer({ minimum: 1000, maximum: 120000 }),
}, { additionalProperties: false });
export type WinddownSettings = Static<typeof WinddownSettingsSchema>;
export const defaultWinddownSettings = (): WinddownSettings => ({ enabled: false, modelId: null, allowHosted: false, outputTokens: 256, timeoutMs: 30000 });
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
export const CheckpointFileSchema = object({ path: Type.String({ minLength: 1, maxLength: 4096 }), text: Type.String({ maxLength: 128 * 1024 }),
  digest: hash, mode: Type.Union([Type.Literal("100644"), Type.Literal("100755")]) });
const files = Type.Array(CheckpointFileSchema, { minItems: 1, maxItems: 20 });
const sourcePaths = Type.Array(CheckpointFileSchema.properties.path, { minItems: 1, maxItems: 20, uniqueItems: true });
export const RemoteCheckpointRootSchema = object({ ...CandidateRootSchema.properties, env: Type.Literal("Remote") });
export const RemoteCheckpointSourceSchema = object({
  format: Type.Literal("moguri-remote-checkpoint-source"), version: Type.Literal(1), winddownId: id, sessionId: id,
  transport: OwnedModelTransportSchema, source: RemoteCheckpointRootSchema, policyDigest: hash, sourceStateDigest: hash, files,
});
export type RemoteCheckpointSource = Static<typeof RemoteCheckpointSourceSchema>;
const userReview = object({ actor: Type.Literal("user"), commandId: id, commandDigest: hash, reviewDigest: hash, inputDigest: hash, at: timestamp });
const LocalWinddownMetadataSchema = Type.Object({
  version: Type.Literal(1), turnId: Type.String({ minLength: 1, maxLength: 128 }), env: Type.Literal("Local"),
  purpose: Type.Literal("budget-wind-down"), taskDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  calls: count, callSetDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  byRole: Type.Array(Type.Object({ role: ModelRoleSchema, calls: count, knownTokens: count, unknownCalls: count }, { additionalProperties: false }), { maxItems: ModelRoleSchema.anyOf.length }),
  basis: Type.Literal("canonical-aggregate-only-no-history-or-code"),
}, { additionalProperties: false });
export const WinddownMetadataSchema = Type.Union([LocalWinddownMetadataSchema, object({
  ...LocalWinddownMetadataSchema.properties, version: Type.Literal(2), env: Type.Union([Type.Literal("Remote"), Type.Literal("Sandbox")]),
})]);
export type WinddownMetadata = Static<typeof WinddownMetadataSchema>;
export const WinddownSourceSchema = object({
  projectId: id, workspaceId: maybeId, root: Type.String({ minLength: 1, maxLength: 4096 }),
  device: Type.String({ pattern: "^[0-9]+$" }), inode: Type.String({ pattern: "^[0-9]+$" }),
});
const LocalWinddownDocumentSchema = object({
  format: Type.Literal("moguri-budget-winddown"), version: Type.Literal(1),
  sessionId: id, turnId: id, source: Type.Union([WinddownSourceSchema, Type.Null()]), taskDigest: hash,
  settings: WinddownSettingsSchema, modelJson: Type.String({ minLength: 1, maxLength: 16384 }),
  systemPrompt: Type.String({ minLength: 1, maxLength: 8192 }), inputBound: count, outputBound: Type.Integer({ minimum: 1, maximum: 2048 }),
  authorityDigest: hash, policyDigest: hash, policyJson: Type.String({ minLength: 1, maxLength: 128 * 1024 }),
});
export const WinddownDocumentSchema = Type.Union([LocalWinddownDocumentSchema, object({
  ...LocalWinddownDocumentSchema.properties, version: Type.Union([Type.Literal(2), Type.Literal(3)]), source: Type.Null(),
  env: Type.Union([Type.Literal("Remote"), Type.Literal("Sandbox")]), scopeDigest: hash,
})]);
export type WinddownDocument = Static<typeof WinddownDocumentSchema>;
const LocalWinddownRecordSchema = object({
  version: Type.Literal(1), id, profileId: id, sessionId: id, turnId: id, ownerSessionId: id, ownerTurnId: maybeId,
  projectId: maybeId, workspaceId: maybeId, folderId: maybeId, env: Type.Literal("Local"), source: Type.Union([WinddownSourceSchema, Type.Null()]),
  inputDigest: hash, authorityDigest: hash, policyDigest: hash, originId: id, revision: count, createdAt: timestamp, updatedAt: timestamp,
  status: Type.Union([Type.Literal("held"), Type.Literal("running"), Type.Literal("ready"), Type.Literal("committing"), Type.Literal("completed"),
    Type.Literal("declined"), Type.Literal("unavailable"), Type.Literal("failed"), Type.Literal("partial"), Type.Literal("unused")]),
  step: RoleSequenceStepSchema, commitDocumentDigest: maybeHash,
  commit: Type.Union([object({
    actor: Type.Literal("user"), commandId: id, commandDigest: hash, reviewDigest: hash, at: timestamp, jobId: id,
    branch: Type.String({ minLength: 1, maxLength: 200 }), base: gitHash, preparedCommit: maybeGit,
    publicationAttempted: Type.Boolean(), publishedCommit: maybeGit, resultDigest: maybeHash, cancelRequested: Type.Boolean(),
    inspection: Type.Optional(userReview),
  }), Type.Null()]), diagnostic,
});
export const WinddownRecordSchema = Type.Union([LocalWinddownRecordSchema, object({
  ...LocalWinddownRecordSchema.properties, version: Type.Union([Type.Literal(2), Type.Literal(3)]), source: Type.Null(),
  env: Type.Union([Type.Literal("Remote"), Type.Literal("Sandbox")]), scopeDigest: hash,
  transport: Type.Union([OwnedModelTransportSchema, Type.Null()]),
  remoteAcceptance: Type.Optional(userReview),
})]);
export type WinddownRecord = Static<typeof WinddownRecordSchema>;
export const unsettledWinddownCommit = (record: WinddownRecord): boolean =>
  record.version === 3 && record.status === "partial" && record.commit?.publicationAttempted === true && !record.commit.inspection;
export const activeWinddown = (record: WinddownRecord): boolean => ["held", "running", "committing"].includes(record.status) || unsettledWinddownCommit(record);
function corrupt(message: string): never { throw new MoguriError("winddown_corrupt", `${message} State was preserved; no checkpoint model, Git approval or replay was adopted.`, 409); }
export function projectWinddown(previous: WinddownRecord | undefined, value: unknown): WinddownRecord {
  if (!Value.Check(WinddownRecordSchema, value)) corrupt("Wind-down has an unsupported shape/version.");
  const next = value, step = next.step;
  if (next.commit?.inspection && (next.version !== 3 || next.status !== "partial" || !next.commit.publicationAttempted)) corrupt("Checkpoint inspection cannot invent a successful job or settle an undispatched/legacy owner.");
  if (next.version !== 1 && next.remoteAcceptance && (next.version !== 3 || next.env !== "Remote" || !next.transport || step.state !== "recorded")) corrupt("Remote source acceptance needs the exact separately reviewed completed role, not metadata or a different boundary.");
  if (next.version !== 1 && (next.transport && next.transport.env !== next.env ||
    next.version === 2 && (next.commit !== null || next.commitDocumentDigest !== null || ["committing", "completed"].includes(next.status)) ||
    ["running", "ready"].includes(next.status) && !next.transport || ["held", "unused"].includes(next.status) && next.transport !== null)) {
    corrupt("Transport finishing cannot adopt Local Git or lose its exact actual model boundary.");
  }
  if (![next.createdAt, next.updatedAt].every((value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value) ||
    step.role !== "checkpoint" || !step.providerId || next.source && (next.source.projectId !== next.projectId || next.source.workspaceId !== next.workspaceId ||
      !next.source.root.startsWith("/") || !next.source.root.isWellFormed() || next.source.root.includes("\0")) ||
    next.projectId === null && (next.source !== null || next.workspaceId !== null)) corrupt("Wind-down source, actual role, scope or timestamps disagree.");
  if (["held", "unused"].includes(next.status) && step.state !== "pending" || next.status === "running" && !["started", "recorded"].includes(step.state) ||
    ["ready", "committing", "completed", "declined"].includes(next.status) && (step.state !== "recorded" || step.outcome !== "stop" || !step.resultDigest) ||
    ["failed", "partial", "unused", "unavailable", "declined"].includes(next.status) && !next.diagnostic) corrupt("Wind-down outcome contradicts its actual role observations.");
  if (step.state === "pending" && [step.stepId, step.inputDigest, step.resultDigest, step.outcome].some((value) => value !== null) ||
    ["started", "recorded", "unconfirmed"].includes(step.state) && (!step.stepId || !step.inputDigest) ||
    step.state === "recorded" && (!step.resultDigest || !step.outcome)) corrupt("Checkpoint observation lost its original actual call/input/result.");
  if ((next.commitDocumentDigest === null) !== (next.commit === null) ||
    ["committing", "completed"].includes(next.status) && next.commit === null ||
    next.status === "completed" && (!next.commit?.publicationAttempted || !next.commit.publishedCommit || !next.commit.resultDigest || next.commit.cancelRequested || next.diagnostic !== null) ||
    next.commit?.publishedCommit && (!next.commit.publicationAttempted || next.commit.preparedCommit !== next.commit.publishedCommit)) corrupt("A commit result lacks its exact separate actual-user intent and publication evidence.");
  if (!previous) {
    if (next.revision !== 0 || next.status !== "held" || next.createdAt !== next.updatedAt || step.state !== "pending" || next.commit || next.diagnostic) corrupt("Wind-down must begin as original undispatched held capacity.");
  } else {
    const lateResult = previous.version !== 1 && previous.status === "partial" && next.status === "partial" &&
      previous.step.state === "unconfirmed" && step.state === "recorded" && previous.step.resultDigest === null && step.resultDigest !== null &&
      next.diagnostic === previous.diagnostic && step.diagnostic === previous.step.diagnostic;
    const lateInspection = previous.version === 3 && next.version === 3 && previous.status === "partial" && next.status === "partial" &&
      previous.commit?.publicationAttempted === true && !previous.commit.inspection && Boolean(next.commit?.inspection);
    if (lateInspection) {
      const { inspection: _inspection, ...commit } = next.commit!;
      if (JSON.stringify(commit) !== JSON.stringify(previous.commit) || JSON.stringify(step) !== JSON.stringify(previous.step) ||
        next.diagnostic !== previous.diagnostic) corrupt("An inspection must retain the actual original partial job, diagnostic and model/publication observations.");
    }
    const immutable = ["version", "id", "profileId", "sessionId", "turnId", "ownerSessionId", "ownerTurnId", "projectId", "workspaceId", "folderId", "env",
      "inputDigest", "authorityDigest", "policyDigest", "originId", "createdAt"] as const;
    const transitions: Record<WinddownRecord["status"], WinddownRecord["status"][]> = {
      held: ["running", "unused", "unavailable", "failed", "partial"], running: ["running", "ready", "failed", "partial"],
      ready: ["committing", "declined", "partial"], committing: ["committing", "completed", "failed", "partial"],
      completed: [], declined: [], unavailable: [], failed: [], partial: [], unused: [],
    };
    if (next.revision !== previous.revision + 1 || immutable.some((key) => next[key] !== previous[key]) || JSON.stringify(next.source) !== JSON.stringify(previous.source) ||
      !transitions[previous.status].includes(next.status) && !lateResult && !lateInspection &&
        !(previous.version === 3 && next.version === 3 && previous.status === "ready" && next.status === "ready" && !previous.remoteAcceptance && next.remoteAcceptance)) corrupt("Original ownership, held capacity or terminal work changed/replayed.");
    if (previous.version !== 1 || next.version !== 1) {
      if (previous.version === 1 || next.version === 1 || previous.scopeDigest !== next.scopeDigest ||
        previous.transport && JSON.stringify(previous.transport) !== JSON.stringify(next.transport) ||
        !previous.transport && next.transport && (previous.status !== "held" || next.status !== "running" || step.state !== "started")) {
        corrupt("Original finishing transport changed or was inferred without its exact once-only model start.");
      }
      if (previous.remoteAcceptance &&
        JSON.stringify(previous.remoteAcceptance) !== JSON.stringify(next.remoteAcceptance)) corrupt("Original actual-user Remote source acceptance changed or disappeared.");
    }
    if ((["planId", "role", "modelId", "providerId", "apiModelId", "inputBound", "outputBound"] as const).some((key) => step[key] !== previous.step[key]) ||
      (["stepId", "inputDigest", "resultDigest", "outcome"] as const).some((key) => previous.step[key] !== null && previous.step[key] !== step[key])) corrupt("Original checkpoint model/bounds or actual observations changed.");
    const oldCommit = previous.commit, commit = next.commit;
    if (oldCommit && (!commit || (["actor", "commandId", "commandDigest", "reviewDigest", "at", "jobId", "branch", "base"] as const).some((key) => oldCommit[key] !== commit[key]) ||
      (["preparedCommit", "publishedCommit", "resultDigest"] as const).some((key) => oldCommit[key] !== null && oldCommit[key] !== commit[key]) ||
      oldCommit.publicationAttempted && !commit.publicationAttempted || oldCommit.cancelRequested && !commit.cancelRequested)) corrupt("Original separate user Git approval or possible publication was erased/replaced.");
    if (oldCommit?.inspection && JSON.stringify(oldCommit.inspection) !== JSON.stringify(commit?.inspection)) corrupt("Actual-user checkpoint inspection cannot be erased or replaced.");
    if (!oldCommit?.inspection && commit?.inspection && !lateInspection) corrupt("Only a terminal original partial checkpoint may gain separate actual-user inspection.");
    if (previous.commitDocumentDigest !== null && previous.commitDocumentDigest !== next.commitDocumentDigest) corrupt("Original actual-user Git review document changed.");
  }
  return structuredClone(next);
}
export function validateWinddownLedger(records: WinddownRecord[], plans: BudgetPlan[], entries: BudgetEntry[]): void {
  validateRoleLedger(records.map((record) => ({ ...record, commandId: record.id, id: record.turnId, steps: [record.step],
    active: record.status === "held" || record.status === "running", complete: ["ready", "committing", "completed", "declined"].includes(record.status) })), plans, entries, corrupt);
}
const commitInput = {
  winddownId: id, sessionId: id, candidateIds: Type.Array(id, { maxItems: 20, uniqueItems: true }),
  nativePublicationIds: Type.Optional(Type.Array(id, { minItems: 1, maxItems: 20, uniqueItems: true })),
  remoteAccepted: Type.Optional(Type.Literal(true)),
  branch: Type.String({ minLength: 1, maxLength: 200 }), message: Type.String({ minLength: 1, maxLength: 4096 }),
};
const LocalWinddownCommitDocumentSchema = object({
  format: Type.Literal("moguri-budget-checkpoint-commit"), version: Type.Literal(1), winddownId: id, sessionId: id,
  source: CandidateRootSchema, policyDigest: hash, sourceStateDigest: hash, branch: commitInput.branch, base: gitHash, message: commitInput.message,
  candidates: Type.Array(CandidateRecordSchema, { minItems: 1, maxItems: 20 }),
  files,
});
export const WinddownCommitDocumentSchema = Type.Union([LocalWinddownCommitDocumentSchema, object({
  ...LocalWinddownCommitDocumentSchema.properties, version: Type.Literal(2), modelEnv: Type.Literal("Sandbox"), publicationEnv: Type.Literal("Local"),
  transport: OwnedModelTransportSchema,
  candidates: Type.Array(CandidateRecordSchema, { maxItems: 0 }),
  nativePublications: Type.Array(object({ publication: SandboxPublicationSchema, document: SandboxPublicationDocumentSchema }), { minItems: 1, maxItems: 20 }),
}), object({
  ...LocalWinddownCommitDocumentSchema.properties, version: Type.Literal(3), modelEnv: Type.Literal("Remote"), publicationEnv: Type.Literal("Remote"),
  transport: OwnedModelTransportSchema, source: RemoteCheckpointRootSchema, candidates: Type.Array(CandidateRecordSchema, { maxItems: 0 }),
  sourceAcceptance: userReview, acceptedSource: RemoteCheckpointSourceSchema,
})]);
export type WinddownCommitDocument = Static<typeof WinddownCommitDocumentSchema>;
const LocalWinddownCommitResultSchema = object({
  version: Type.Literal(1), winddownId: id, source: CandidateRootSchema, branch: commitInput.branch, base: gitHash, commit: gitHash,
  verified: Type.Literal(true), sourceStateDigest: hash,
  files: Type.Array(object({ path: Type.String({ minLength: 1, maxLength: 4096 }), digest: hash }), { minItems: 1, maxItems: 20 }),
});
export const WinddownCommitResultSchema = Type.Union([LocalWinddownCommitResultSchema, object({
  ...LocalWinddownCommitResultSchema.properties, version: Type.Literal(2), modelEnv: Type.Literal("Sandbox"), publicationEnv: Type.Literal("Local"),
  transport: OwnedModelTransportSchema,
}), object({
  ...LocalWinddownCommitResultSchema.properties, version: Type.Literal(3), modelEnv: Type.Literal("Remote"), publicationEnv: Type.Literal("Remote"),
  transport: OwnedModelTransportSchema, source: RemoteCheckpointRootSchema,
})]);
export type WinddownCommitResult = Static<typeof WinddownCommitResultSchema>;
export const WinddownCommitInspectionSchema = object({
  format: Type.Literal("moguri-checkpoint-inspection"), version: Type.Literal(1), winddownId: id, jobId: id,
  commitDocumentDigest: hash, reviewDigest: hash, publicationEnv: Type.Union([Type.Literal("Local"), Type.Literal("Remote")]),
  root: Type.String({ minLength: 1, maxLength: 4096 }), sourceStateDigest: hash, operationSettled: Type.Literal(true),
  preparedCommit: maybeGit, publishedCommit: maybeGit, actualCommit: maybeGit,
  result: Type.Union([WinddownCommitResultSchema, Type.Null()]),
  receipt: Type.Union([Type.String({ minLength: 1, maxLength: 512 * 1024 }), Type.Null()]),
});
export type WinddownCommitInspection = Static<typeof WinddownCommitInspectionSchema>;
export const WinddownCommandSchema = Type.Union([
  object({ type: Type.Literal("winddown.commit.reconcile"), winddownId: id, expectedRevision: count, expectedDigest: hash, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("winddown.source.accept"), winddownId: id, paths: sourcePaths,
    expectedRevision: count, expectedDigest: hash, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("winddown.stop"), winddownId: id }),
  object({ type: Type.Literal("winddown.decline"), winddownId: id, expectedRevision: count, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("winddown.commit"), ...commitInput, expectedRevision: count, expectedDigest: hash, confirm: Type.Literal(true) }),
]);
export type WinddownCommand = Static<typeof WinddownCommandSchema>;
export const WinddownQuerySchema = Type.Union([
  object({ type: Type.Literal("winddown.commit.inspect"), winddownId: id }),
  object({ type: Type.Literal("winddown.source.preview"), winddownId: id, paths: sourcePaths }),
  object({ type: Type.Literal("winddown.status"), sessionId: id }),
  object({ type: Type.Literal("winddown.read"), winddownId: id }),
  object({ type: Type.Literal("winddown.commit.preview"), ...commitInput }),
]);
export type WinddownQuery = Static<typeof WinddownQuerySchema>;
export const isWinddownCommand = (value: unknown): value is WinddownCommand => Value.Check(WinddownCommandSchema, value);
export const isWinddownQuery = (value: unknown): value is WinddownQuery => Value.Check(WinddownQuerySchema, value);
export type WinddownResponse =
  | { type: "winddown.commit.inspect"; inspection: { status: string; diagnostic: string | null; preparedCommit: string | null; publishedCommit: string | null; result: WinddownCommitResult | null;
    review: { document: WinddownCommitInspection; revision: number; digest: string; warning: string } } }
  | { type: "winddown.source.preview"; preview: { document: RemoteCheckpointSource; digest: string; revision: number; warning: string } }
  | { type: "winddown.status"; ready: boolean; modelId: string | null; inputBound: number | null; outputBound: number | null; usdReady: boolean; reason: string }
  | { type: "winddown.read"; winddown: WinddownRecord; input: WinddownDocument; roleInput: string | null; result: string | null; commitDocument: WinddownCommitDocument | null; commitInspection: WinddownCommitInspection | null }
  | { type: "winddown.commit.preview"; preview: { document: WinddownCommitDocument; digest: string; revision: number; warning: string } };
