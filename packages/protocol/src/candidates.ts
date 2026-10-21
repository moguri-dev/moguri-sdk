import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const path = Type.String({ minLength: 1, maxLength: 4096 });
const unsigned = Type.String({ pattern: "^[0-9]+$", maxLength: 40 });
const nullableHash = Type.Union([hash, Type.Null()]);
const paths = Type.Array(path, { maxItems: 20, uniqueItems: true });
const timestamp = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
export const CandidatePatchSchema = object({
  kind: Type.Literal("patch"), summary: Type.String({ minLength: 1, maxLength: 1200 }),
  edits: Type.Array(object({ path, baseDigest: Type.Union([hash, Type.Literal("absent")]), text: Type.String({ maxLength: 128 * 1024 }) }), { minItems: 1, maxItems: 20 }),
});
export type CandidatePatch = Static<typeof CandidatePatchSchema>;
export const CandidateRootSchema = object({
  env: Type.Literal("Local"), projectId: id, workspaceId: Type.Union([id, Type.Null()]),
  root: path, device: unsigned, inode: unsigned, gitCommonDir: path, branch: Type.String({ minLength: 1, maxLength: 200 }),
  head: Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }),
});
export type CandidateRoot = Static<typeof CandidateRootSchema>;
export const CandidateDocumentSchema = object({
  format: Type.Literal("moguri-candidate"), version: Type.Literal(1),
  source: CandidateRootSchema, stage: CandidateRootSchema, authorityDigest: hash, patch: CandidatePatchSchema,
});
export type CandidateDocument = Static<typeof CandidateDocumentSchema>;
const intent = object({ commandId: id, commandDigest: hash, jobId: id });
export const CandidateJobIntentSchema = object({
  candidateId: id, phase: Type.Union([Type.Literal("stage"), Type.Literal("apply")]), commandId: id, commandDigest: hash,
});
export type CandidateJobIntent = Static<typeof CandidateJobIntentSchema>;
export const CandidateRecordSchema = object({
  version: Type.Literal(1), id, profileId: id, projectId: id, originSessionId: Type.Union([id, Type.Null()]),
  source: CandidateRootSchema, stage: CandidateRootSchema, documentDigest: hash, proposalDigest: hash,
  paths: Type.Array(path, { minItems: 1, maxItems: 20, uniqueItems: true }),
  revision: Type.Integer({ minimum: 0 }), status: Type.Union([
    Type.Literal("staging"), Type.Literal("staged"), Type.Literal("applying"), Type.Literal("applied"),
    Type.Literal("rejected"), Type.Literal("failed"), Type.Literal("conflict"), Type.Literal("partial"), Type.Literal("acknowledged"),
  ]),
  createdAt: timestamp, updatedAt: timestamp, stageIntent: intent, applyIntent: Type.Union([intent, Type.Null()]),
  acceptance: Type.Union([object({
    actor: Type.Literal("user"), commandId: id, commandDigest: hash, proposalDigest: hash, reviewDigest: hash, authorityDigest: hash, at: timestamp,
  }), Type.Null()]),
  stagedPaths: paths, attemptedPaths: paths, appliedPaths: paths,
  stageResultDigest: nullableHash, applyResultDigest: nullableHash,
  diagnostic: Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()]),
});
export type CandidateRecord = Static<typeof CandidateRecordSchema>;

const prefix = (before: readonly string[], after: readonly string[]) => before.length <= after.length && before.every((path, index) => path === after[index]);
const sameIntent = (a: CandidateRecord["stageIntent"], b: CandidateRecord["stageIntent"]) =>
  a.commandId === b.commandId && a.commandDigest === b.commandDigest && a.jobId === b.jobId;
const sameRoot = (a: CandidateRoot, b: CandidateRoot) => (["env", "projectId", "workspaceId", "root", "device", "inode", "gitCommonDir", "branch", "head"] as const).every((key) => a[key] === b[key]);
const validTime = (value: string) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const relativePath = (value: string) => value.isWellFormed() && !value.startsWith("/") && !/[\\\u0000-\u001f\u007f]/.test(value) && !value.split("/").some((part) => !part || part === "." || part === "..");
const transitions: Readonly<Record<CandidateRecord["status"], readonly CandidateRecord["status"][]>> = {
  staging: ["staging", "staged", "failed", "conflict", "partial"],
  staged: ["applying", "rejected"],
  applying: ["applying", "applied", "failed", "conflict", "partial"],
  partial: ["acknowledged"], applied: [], rejected: [], failed: [], conflict: [], acknowledged: [],
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
    !prefix(next.stagedPaths, next.paths) || !prefix(next.attemptedPaths, next.paths) || !prefix(next.appliedPaths, next.attemptedPaths)) corrupt("Candidate path/effect ordering is invalid or contains aliases.");
  if (!validTime(next.createdAt) || !validTime(next.updatedAt) || next.acceptance && !validTime(next.acceptance.at)) corrupt("Candidate timestamps are not exact valid UTC observations.");
  if (["staged", "applying", "applied", "rejected"].includes(next.status) && (next.stagedPaths.length !== next.paths.length || next.stageResultDigest === null)) corrupt("Candidate readiness requires the complete retained stage result.");
  if (next.status === "staging" && next.stageResultDigest !== null ||
    ["staging", "staged", "applying", "applied"].includes(next.status) && next.diagnostic !== null ||
    ["failed", "conflict", "partial", "acknowledged"].includes(next.status) && next.diagnostic === null) corrupt("Candidate outcome and its verified result/diagnostic disagree.");
  if (next.applyIntent === null) {
    if (next.acceptance !== null || next.attemptedPaths.length || next.appliedPaths.length || next.applyResultDigest !== null || ["applying", "applied"].includes(next.status)) corrupt("Candidate source effects require an actual recorded apply intent and acceptance.");
  } else {
    if (!next.acceptance || next.acceptance.commandId !== next.applyIntent.commandId || next.acceptance.commandDigest !== next.applyIntent.commandDigest ||
      next.acceptance.proposalDigest !== next.proposalDigest || next.applyIntent.commandId === next.stageIntent.commandId || next.applyIntent.jobId === next.stageIntent.jobId ||
      next.stagedPaths.length !== next.paths.length || next.stageResultDigest === null || ["staging", "staged", "rejected"].includes(next.status)) corrupt("Candidate acceptance does not bind its original complete proposal and exact apply command.");
  }
  if (next.status === "applied" && (next.appliedPaths.length !== next.paths.length || next.applyResultDigest === null) ||
    next.status !== "applied" && next.applyResultDigest !== null) corrupt("Candidate verified application cannot be fabricated from partial or unacknowledged work.");
  if (["failed", "conflict"].includes(next.status) && (next.applyIntent ? next.attemptedPaths.length > 0 : next.stagedPaths.length > 0)) corrupt("An operation with possible effects must remain partial, not a no-effect failure.");
  if (!previous) {
    if (next.revision !== 0 || next.status !== "staging" || next.stagedPaths.length || next.stageResultDigest !== null || next.applyIntent !== null) corrupt("A candidate must begin with its original effect-free stage intent.");
  } else {
    const previousAcceptance = previous.acceptance, acceptance = next.acceptance;
    const immutable = ["version", "id", "profileId", "projectId", "originSessionId", "documentDigest", "proposalDigest", "createdAt"] as const;
    if (next.revision !== previous.revision + 1 || immutable.some((key) => next[key] !== previous[key]) || !sameRoot(previous.source, source) || !sameRoot(previous.stage, stage) ||
      !sameIntent(previous.stageIntent, next.stageIntent) || JSON.stringify(previous.paths) !== JSON.stringify(next.paths) ||
      !transitions[previous.status].includes(next.status)) corrupt("Candidate revision, original ownership/base or lifecycle was changed/replayed.");
    if (!prefix(previous.stagedPaths, next.stagedPaths) || !prefix(previous.attemptedPaths, next.attemptedPaths) || !prefix(previous.appliedPaths, next.appliedPaths) ||
      previous.stageResultDigest !== null && previous.stageResultDigest !== next.stageResultDigest ||
      previous.applyResultDigest !== null && previous.applyResultDigest !== next.applyResultDigest) corrupt("Candidate effects or retained results cannot be erased/replaced.");
    if (previous.applyIntent && (!next.applyIntent || !sameIntent(previous.applyIntent, next.applyIntent)) ||
      !previous.applyIntent && next.applyIntent && (previous.status !== "staged" || next.status !== "applying") ||
      previousAcceptance && (!acceptance || (["actor", "commandId", "commandDigest", "proposalDigest", "reviewDigest", "authorityDigest", "at"] as const).some((key) => previousAcceptance[key] !== acceptance[key]))) corrupt("Original candidate apply ownership/acceptance changed.");
  }
  return structuredClone(next);
}
