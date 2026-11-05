import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { LocalCandidateRootSchema as CandidateRootSchema, sameCandidateRoot, type CandidateDocument } from "./candidates.ts";
import { MoguriError } from "./core.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const maybeHash = Type.Union([hash, Type.Null()]);
const maybeId = Type.Union([id, Type.Null()]);
const revision = Type.Integer({ minimum: 0 });
const timestamp = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
export const CandidateGenerationInputSchema = object({
  task: Type.String({ minLength: 1, maxLength: 4096 }),
  files: Type.Array(object({
    path: Type.String({ minLength: 1, maxLength: 4096 }),
    baseDigest: Type.Union([hash, Type.Literal("absent")]),
  }), { minItems: 1, maxItems: 20 }),
});
export type CandidateGenerationInput = Static<typeof CandidateGenerationInputSchema>;
export const CandidateGenerationDocumentSchema = object({
  format: Type.Literal("moguri-candidate-generation"), version: Type.Literal(1),
  source: CandidateRootSchema, stage: CandidateRootSchema, authorityDigest: hash,
  task: Type.String({ minLength: 1, maxLength: 4096 }),
  files: Type.Array(object({
    path: Type.String({ minLength: 1, maxLength: 4096 }), baseDigest: Type.Union([hash, Type.Literal("absent")]),
    text: Type.Union([Type.String({ maxLength: 128 * 1024 }), Type.Null()]),
  }), { minItems: 1, maxItems: 20 }),
  modelId: id, modelBindingDigest: hash, systemPrompt: Type.String({ minLength: 1, maxLength: 96 * 1024 }),
  estimatedInputTokens: Type.Integer({ minimum: 0 }), maxOutputTokens: Type.Integer({ minimum: 1, maximum: 8192 }),
});
export type CandidateGenerationDocument = Static<typeof CandidateGenerationDocumentSchema>;
export const CandidateGenerationRecordSchema = object({
  version: Type.Literal(1), id, profileId: id, projectId: id, sessionId: id,
  commandId: id, commandDigest: hash, inputDigest: hash, modelId: id, modelBindingDigest: hash,
  source: CandidateRootSchema, stage: CandidateRootSchema, authorityDigest: hash,
  revision, status: Type.Union([Type.Literal("running"), Type.Literal("proposed"), Type.Literal("stopped"), Type.Literal("failed"), Type.Literal("partial")]),
  createdAt: timestamp, updatedAt: timestamp, stopRequested: Type.Boolean(),
  stepId: maybeId, providerId: maybeId, apiModelId: maybeId,
  resultDigest: maybeHash, proposalDocumentDigest: maybeHash,
  diagnostic: Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()]),
});
export type CandidateGenerationRecord = Static<typeof CandidateGenerationRecordSchema>;
const validTime = (value: string) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function corrupt(message: string): never { throw new MoguriError("candidate_generation_corrupt", `${message} State was preserved; no model call, proposal or permission was adopted.`, 409); }
export function projectCandidateGeneration(previous: CandidateGenerationRecord | undefined, value: unknown): CandidateGenerationRecord {
  if (!Value.Check(CandidateGenerationRecordSchema, value)) corrupt("Generation metadata has an unsupported shape/version.");
  const next = value;
  if (next.source.projectId !== next.projectId || next.stage.projectId !== next.projectId || next.stage.workspaceId === null ||
    next.source.workspaceId === next.stage.workspaceId || next.source.root === next.stage.root ||
    next.source.device === next.stage.device && next.source.inode === next.stage.inode ||
    next.source.gitCommonDir !== next.stage.gitCommonDir || next.source.head !== next.stage.head ||
    ![next.source.root, next.stage.root, next.source.gitCommonDir].every((path) => path.startsWith("/") && path.isWellFormed() && !path.includes("\0")) ||
    !validTime(next.createdAt) || !validTime(next.updatedAt)) corrupt("Generation lost its original distinct Local source/staging base or valid observations.");
  if ((next.stepId === null) !== (next.providerId === null) || (next.stepId === null) !== (next.apiModelId === null) ||
    next.stepId === null && (next.resultDigest !== null || next.proposalDocumentDigest !== null) ||
    next.proposalDocumentDigest !== null && next.resultDigest === null) corrupt("Generation result has no owning actual model step.");
  if (next.status === "proposed" && (!next.stepId || !next.resultDigest || !next.proposalDocumentDigest || next.diagnostic !== null || next.stopRequested) ||
    ["stopped", "failed", "partial"].includes(next.status) && next.diagnostic === null) corrupt("Generation outcome does not match its actual result, stop or diagnostic.");
  if (!previous) {
    if (next.revision !== 0 || next.status !== "running" || next.stopRequested || next.stepId || next.resultDigest || next.proposalDocumentDigest || next.diagnostic) corrupt("Generation must begin with its original no-dispatch intent.");
  } else {
    const immutable = ["version", "id", "profileId", "projectId", "sessionId", "commandId", "commandDigest", "inputDigest", "modelId", "modelBindingDigest", "authorityDigest", "createdAt"] as const;
    if (previous.status !== "running" || next.revision !== previous.revision + 1 || immutable.some((key) => previous[key] !== next[key]) ||
      !sameCandidateRoot(previous.source, next.source) || !sameCandidateRoot(previous.stage, next.stage) ||
      previous.stopRequested && !next.stopRequested ||
      (["stepId", "providerId", "apiModelId", "resultDigest", "proposalDocumentDigest"] as const).some((key) => previous[key] !== null && previous[key] !== next[key])) corrupt("Original generation ownership, model, intent or observed result changed/replayed.");
  }
  return structuredClone(next);
}
export interface CandidateGenerationPreview {
  digest: string; inputDigest: string; modelId: string; modelBindingDigest: string; source: Static<typeof CandidateRootSchema>; stage: Static<typeof CandidateRootSchema>;
  estimatedInputTokens: number; maxOutputTokens: number; systemPrompt: string; warning: string;
}
export const CandidateGenerationCommandSchema = Type.Union([
  object({ type: Type.Literal("candidate.generate"), sessionId: id, stageWorkspaceId: id, input: CandidateGenerationInputSchema, expectedDigest: hash, confirmCost: Type.Literal(true) }),
  object({ type: Type.Literal("candidate.generation.stop"), generationId: id }),
]);
export type CandidateGenerationCommand = Static<typeof CandidateGenerationCommandSchema>;
export const isCandidateGenerationCommand = (value: unknown): value is CandidateGenerationCommand => Value.Check(CandidateGenerationCommandSchema, value);
export const CandidateGenerationQuerySchema = Type.Union([
  object({ type: Type.Literal("candidate.generation.preview"), sessionId: id, stageWorkspaceId: id, input: CandidateGenerationInputSchema }),
  object({ type: Type.Literal("candidate.generation.read"), generationId: id }),
]);
export type CandidateGenerationQuery = Static<typeof CandidateGenerationQuerySchema>;
export const isCandidateGenerationQuery = (value: unknown): value is CandidateGenerationQuery => Value.Check(CandidateGenerationQuerySchema, value);
export type CandidateGenerationResponse =
  | { type: "candidate.generation.preview"; preview: CandidateGenerationPreview }
  | { type: "candidate.generation.read"; generation: CandidateGenerationRecord; input: CandidateGenerationDocument; proposal: CandidateDocument | null; text: string | null };
