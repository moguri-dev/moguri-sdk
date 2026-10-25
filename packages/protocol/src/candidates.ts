import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";
import type { CapabilityJob } from "./platform.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const path = Type.String({ minLength: 1, maxLength: 4096 });
const unsigned = Type.String({ pattern: "^[0-9]+$", maxLength: 40 });
const nullableHash = Type.Union([hash, Type.Null()]);
const paths = Type.Array(path, { maxItems: 20, uniqueItems: true });
const timestamp = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
export const MAX_CANDIDATE_PATCH_BYTES = 32 * 1024;
export const CandidatePatchSchema = object({
  kind: Type.Literal("patch"), summary: Type.String({ minLength: 1, maxLength: 1200 }),
  edits: Type.Array(object({ path, baseDigest: Type.Union([hash, Type.Literal("absent")]), text: Type.String({ maxLength: 128 * 1024 }) }), { minItems: 1, maxItems: 20 }),
});
export type CandidatePatch = Static<typeof CandidatePatchSchema>;
export const CandidateRoleOriginSchema = object({
  sequenceId: id, sequenceInputDigest: hash, roleInputDigest: hash, resultDigest: hash, observationEventId: id,
  roleIndex: Type.Integer({ minimum: 0, maximum: 31 }),
  role: Type.Union([Type.Literal("draft"), Type.Literal("revision"), Type.Literal("escalation")]),
  stepId: id, modelId: id, providerId: id, apiModelId: id,
});
export type CandidateRoleOrigin = Static<typeof CandidateRoleOriginSchema>;
export const CandidateCompoundOriginSchema = object({
  workflowId: id, workflowInputDigest: hash, roleInputDigest: hash, resultDigest: hash, observationEventId: id,
  role: Type.Union([Type.Literal("draft"), Type.Literal("revision"), Type.Literal("escalation")]),
  stepId: id, modelId: id, providerId: id, apiModelId: id,
});
export type CandidateCompoundOrigin = Static<typeof CandidateCompoundOriginSchema>;
export interface CandidateRoleReference { roleSequenceId: string }
export const CandidateRootSchema = object({
  env: Type.Literal("Local"), projectId: id, workspaceId: Type.Union([id, Type.Null()]),
  root: path, device: unsigned, inode: unsigned, gitCommonDir: path, branch: Type.String({ minLength: 1, maxLength: 200 }),
  head: Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }),
});
export type CandidateRoot = Static<typeof CandidateRootSchema>;
export const CandidateDocumentSchema = object({
  format: Type.Literal("moguri-candidate"), version: Type.Literal(1),
  source: CandidateRootSchema, stage: CandidateRootSchema, authorityDigest: hash, patch: CandidatePatchSchema,
  roleOrigin: Type.Optional(CandidateRoleOriginSchema),
  compoundOrigin: Type.Optional(CandidateCompoundOriginSchema),
});
export type CandidateDocument = Static<typeof CandidateDocumentSchema>;
const intent = object({ commandId: id, commandDigest: hash, jobId: id, sessionId: Type.Optional(id) });
export const CandidateJobIntentSchema = object({
  candidateId: id, phase: Type.Union([Type.Literal("stage"), Type.Literal("apply")]), commandId: id, commandDigest: hash,
});
export type CandidateJobIntent = Static<typeof CandidateJobIntentSchema>;
export const CandidateRecordSchema = object({
  version: Type.Literal(1), id, profileId: id, projectId: id, originSessionId: Type.Union([id, Type.Null()]),
  generationId: Type.Optional(id), roleOrigin: Type.Optional(CandidateRoleOriginSchema),
  compoundOrigin: Type.Optional(CandidateCompoundOriginSchema),
  source: CandidateRootSchema, stage: CandidateRootSchema, documentDigest: hash, proposalDigest: hash,
  paths: Type.Array(path, { minItems: 1, maxItems: 20, uniqueItems: true }),
  revision: Type.Integer({ minimum: 0 }), status: Type.Union([
    Type.Literal("staging"), Type.Literal("staged"), Type.Literal("applying"), Type.Literal("applied"),
    Type.Literal("rejected"), Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("conflict"), Type.Literal("partial"), Type.Literal("acknowledged"),
  ]),
  createdAt: timestamp, updatedAt: timestamp, stageIntent: intent, applyIntent: Type.Union([intent, Type.Null()]),
  acceptance: Type.Union([object({
    actor: Type.Literal("user"), commandId: id, commandDigest: hash, proposalDigest: hash, reviewDigest: hash, authorityDigest: hash, at: timestamp,
  }), Type.Null()]),
  stagedPaths: paths, attemptedPaths: paths, appliedPaths: paths,
  stageAttemptedPaths: Type.Optional(paths), stopRequested: Type.Optional(Type.Boolean()),
  stageResultDigest: nullableHash, applyResultDigest: nullableHash,
  diagnostic: Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()]),
});
export type CandidateRecord = Static<typeof CandidateRecordSchema>;

const prefix = (before: readonly string[], after: readonly string[]) => before.length <= after.length && before.every((path, index) => path === after[index]);
const sameIntent = (a: CandidateRecord["stageIntent"], b: CandidateRecord["stageIntent"]) =>
  a.commandId === b.commandId && a.commandDigest === b.commandDigest && a.jobId === b.jobId && (a.sessionId ?? null) === (b.sessionId ?? null);
export const sameCandidateRoot = (a: CandidateRoot, b: CandidateRoot) => (["env", "projectId", "workspaceId", "root", "device", "inode", "gitCommonDir", "branch", "head"] as const).every((key) => a[key] === b[key]);
export const sameCandidatePatch = (a: CandidatePatch, b: CandidatePatch) => a.summary === b.summary && a.edits.length === b.edits.length &&
  a.edits.every((edit, index) => { const actual = b.edits[index]; return actual && actual.path === edit.path && actual.baseDigest === edit.baseDigest && actual.text === edit.text; });
export const sameCandidateRoleOrigin = (a: CandidateRoleOrigin | undefined, b: CandidateRoleOrigin | undefined) => a === undefined ? b === undefined :
  b !== undefined && (["sequenceId", "sequenceInputDigest", "roleInputDigest", "resultDigest", "observationEventId", "roleIndex", "role", "stepId", "modelId", "providerId", "apiModelId"] as const).every((key) => a[key] === b[key]);
const validTime = (value: string) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const relativePath = (value: string) => value.isWellFormed() && !value.startsWith("/") && !/[\\\u0000-\u001f\u007f]/.test(value) && !value.split("/").some((part) => !part || part === "." || part === "..");
const transitions: Readonly<Record<CandidateRecord["status"], readonly CandidateRecord["status"][]>> = {
  staging: ["staging", "staged", "failed", "cancelled", "conflict", "partial"],
  staged: ["applying", "rejected"],
  applying: ["applying", "applied", "failed", "cancelled", "conflict", "partial"],
  partial: ["acknowledged"], applied: [], rejected: [], failed: [], cancelled: [], conflict: [], acknowledged: [],
};
function corrupt(message: string): never { throw new MoguriError("candidate_corrupt", `${message} State was preserved; no candidate authority was adopted.`, 409); }
export function projectCandidateRecord(previous: CandidateRecord | undefined, value: unknown): CandidateRecord {
  if (!Value.Check(CandidateRecordSchema, value)) corrupt("Candidate metadata has an unsupported shape/version.");
  const next = value, { source, stage } = next;
  if (source.projectId !== next.projectId || stage.projectId !== next.projectId || stage.workspaceId === null || stage.workspaceId === source.workspaceId ||
    source.root === stage.root || source.device === stage.device && source.inode === stage.inode ||
    source.gitCommonDir !== stage.gitCommonDir || source.head !== stage.head ||
    ![source.root, stage.root, source.gitCommonDir].every((path) => path.startsWith("/") && path.isWellFormed() && !path.includes("\0"))) corrupt("Candidate roots do not identify distinct Local owned workspaces at one recorded repository base.");
  if (!next.paths.every(relativePath) || new Set(next.paths.map((path) => path.normalize("NFC").toLowerCase())).size !== next.paths.length ||
    !prefix(next.stagedPaths, next.paths) || !prefix(next.attemptedPaths, next.paths) || !prefix(next.appliedPaths, next.attemptedPaths) ||
    next.stageAttemptedPaths && (!prefix(next.stageAttemptedPaths, next.paths) || !prefix(next.stagedPaths, next.stageAttemptedPaths))) corrupt("Candidate path/effect ordering is invalid or contains aliases.");
  if (next.stageIntent.sessionId && next.stageIntent.sessionId !== next.originSessionId) corrupt("Candidate staging lost its actual origin-session owner.");
  if ([next.generationId, next.roleOrigin, next.compoundOrigin].filter(Boolean).length > 1 || next.roleOrigin?.sequenceId === next.id ||
    next.compoundOrigin?.workflowId === next.id) corrupt("Candidate model origin must be one exact independent source, not itself or conflicting assertions.");
  if (!validTime(next.createdAt) || !validTime(next.updatedAt) || next.acceptance && !validTime(next.acceptance.at)) corrupt("Candidate timestamps are not exact valid UTC observations.");
  if (["staged", "applying", "applied", "rejected"].includes(next.status) && (next.stagedPaths.length !== next.paths.length || next.stageResultDigest === null)) corrupt("Candidate readiness requires the complete retained stage result.");
  if (next.status === "staging" && next.stageResultDigest !== null ||
    next.stopRequested && ["staged", "applied"].includes(next.status) ||
    ["staging", "staged", "applying", "applied"].includes(next.status) && next.diagnostic !== null ||
    ["failed", "cancelled", "conflict", "partial", "acknowledged"].includes(next.status) && next.diagnostic === null) corrupt("Candidate outcome and its verified result/diagnostic disagree.");
  if (next.applyIntent === null) {
    if (next.acceptance !== null || next.attemptedPaths.length || next.appliedPaths.length || next.applyResultDigest !== null || ["applying", "applied"].includes(next.status)) corrupt("Candidate source effects require an actual recorded apply intent and acceptance.");
  } else {
    if (!next.acceptance || next.acceptance.commandId !== next.applyIntent.commandId || next.acceptance.commandDigest !== next.applyIntent.commandDigest ||
      next.acceptance.proposalDigest !== next.proposalDigest || next.applyIntent.commandId === next.stageIntent.commandId || next.applyIntent.jobId === next.stageIntent.jobId ||
      next.stagedPaths.length !== next.paths.length || next.stageResultDigest === null || ["staging", "staged", "rejected"].includes(next.status)) corrupt("Candidate acceptance does not bind its original complete proposal and exact apply command.");
  }
  if (next.status === "applied" && (next.appliedPaths.length !== next.paths.length || next.applyResultDigest === null) ||
    next.status !== "applied" && next.applyResultDigest !== null) corrupt("Candidate verified application cannot be fabricated from partial or unacknowledged work.");
  if (["failed", "cancelled", "conflict"].includes(next.status) && (next.applyIntent ? next.attemptedPaths.length > 0 : (next.stageAttemptedPaths?.length ?? next.stagedPaths.length) > 0)) corrupt("An operation with possible effects must remain partial, not a no-effect failure.");
  if (!previous) {
    if (next.revision !== 0 || next.status !== "staging" || next.stagedPaths.length || next.stageAttemptedPaths?.length || next.stopRequested || next.stageResultDigest !== null || next.applyIntent !== null) corrupt("A candidate must begin with its original effect-free stage intent.");
  } else {
    const previousAcceptance = previous.acceptance, acceptance = next.acceptance;
    const immutable = ["version", "id", "profileId", "projectId", "originSessionId", "generationId", "documentDigest", "proposalDigest", "createdAt"] as const;
    if (next.revision !== previous.revision + 1 || immutable.some((key) => next[key] !== previous[key]) || !sameCandidateRoot(previous.source, source) || !sameCandidateRoot(previous.stage, stage) ||
      !sameIntent(previous.stageIntent, next.stageIntent) || JSON.stringify(previous.paths) !== JSON.stringify(next.paths) ||
      !sameCandidateRoleOrigin(previous.roleOrigin, next.roleOrigin) ||
      JSON.stringify(previous.compoundOrigin) !== JSON.stringify(next.compoundOrigin) ||
      !transitions[previous.status].includes(next.status)) corrupt("Candidate revision, original ownership/base or lifecycle was changed/replayed.");
    if (!prefix(previous.stagedPaths, next.stagedPaths) || !prefix(previous.attemptedPaths, next.attemptedPaths) || !prefix(previous.appliedPaths, next.appliedPaths) ||
      previous.stageAttemptedPaths && (!next.stageAttemptedPaths || !prefix(previous.stageAttemptedPaths, next.stageAttemptedPaths)) ||
      previous.stopRequested && !next.stopRequested ||
      previous.stageResultDigest !== null && previous.stageResultDigest !== next.stageResultDigest ||
      previous.applyResultDigest !== null && previous.applyResultDigest !== next.applyResultDigest) corrupt("Candidate effects or retained results cannot be erased/replaced.");
    if (previous.applyIntent && (!next.applyIntent || !sameIntent(previous.applyIntent, next.applyIntent)) ||
      !previous.applyIntent && next.applyIntent && (previous.status !== "staged" || next.status !== "applying") ||
      previousAcceptance && (!acceptance || (["actor", "commandId", "commandDigest", "proposalDigest", "reviewDigest", "authorityDigest", "at"] as const).some((key) => previousAcceptance[key] !== acceptance[key]))) corrupt("Original candidate apply ownership/acceptance changed.");
  }
  return structuredClone(next);
}

export const CandidateStagePreviewSchema = object({ document: CandidateDocumentSchema, documentDigest: hash, digest: hash, warning: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })) });
export type CandidateStagePreview = Static<typeof CandidateStagePreviewSchema>;
export const CandidateApplyPreviewSchema = object({
  candidateId: id, sessionId: id, revision: Type.Integer({ minimum: 0 }), source: CandidateRootSchema, stage: CandidateRootSchema,
  documentDigest: hash, proposalDigest: hash, authorityDigest: hash, digest: hash,
});
export type CandidateApplyPreview = Static<typeof CandidateApplyPreviewSchema>;
export const CandidateOperationResultSchema = object({
  version: Type.Literal(1), candidateId: id, phase: Type.Union([Type.Literal("stage"), Type.Literal("apply")]),
  source: CandidateRootSchema, stage: CandidateRootSchema, readback: Type.Literal(true),
  files: Type.Array(object({ path, digest: hash, bytes: Type.Integer({ minimum: 0, maximum: 128 * 1024 }) }), { minItems: 1, maxItems: 20 }),
});
export type CandidateOperationResult = Static<typeof CandidateOperationResultSchema>;
const stageInput = { sessionId: id, stageWorkspaceId: id, patch: CandidatePatchSchema };
export const CandidateCommandSchema = Type.Union([
  object({ type: Type.Literal("candidate.stage"), ...stageInput, expectedDigest: hash, generationId: Type.Optional(id), confirm: Type.Literal(true) }),
  object({ type: Type.Literal("candidate.stage"), ...stageInput, roleSequenceId: id, expectedDigest: hash, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("candidate.stage"), ...stageInput, compoundWorkflowId: id, compoundStepId: id, expectedDigest: hash, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("candidate.apply"), candidateId: id, sessionId: id, expectedRevision: Type.Integer({ minimum: 0 }), expectedDigest: hash, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("candidate.reject"), candidateId: id, expectedRevision: Type.Integer({ minimum: 0 }), confirm: Type.Literal(true) }),
]);
export type CandidateCommand = Static<typeof CandidateCommandSchema>;
export const CandidateQuerySchema = Type.Union([
  object({ type: Type.Literal("candidate.eligibility"), sessionId: id }),
  object({ type: Type.Literal("candidate.preview"), ...stageInput, roleSequenceId: Type.Optional(id), compoundWorkflowId: Type.Optional(id), compoundStepId: Type.Optional(id) }),
  object({ type: Type.Literal("candidate.role.proposal"), sequenceId: id }),
  object({ type: Type.Literal("candidate.apply.preview"), candidateId: id, sessionId: id }),
  object({ type: Type.Literal("candidate.read"), candidateId: id }),
]);
export type CandidateQuery = Static<typeof CandidateQuerySchema>;
export const isCandidateCommand = (value: unknown): value is CandidateCommand => Value.Check(CandidateCommandSchema, value);
export const isCandidateQuery = (value: unknown): value is CandidateQuery => Value.Check(CandidateQuerySchema, value);
export type CandidateRead = { type: "candidate.read"; candidate: CandidateRecord; document: CandidateDocument; stageJob: CapabilityJob | null; applyJob: CapabilityJob | null };
export interface CandidateRoleProposalRead {
  type: "candidate.role.proposal"; document: CandidateDocument & { roleOrigin: CandidateRoleOrigin };
  sourceFiles: Array<{ path: string; baseDigest: string; text: string | null }>;
  modelSource: import("./artifacts.ts").ArtifactSource;
}
export type CandidateResponse =
  | { type: "candidate.eligibility"; eligible: boolean; diagnostic: string | null }
  | { type: "candidate.preview"; preview: CandidateStagePreview }
  | { type: "candidate.apply.preview"; preview: CandidateApplyPreview }
  | CandidateRoleProposalRead
  | CandidateRead;
