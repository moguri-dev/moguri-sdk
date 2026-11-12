import { Type, type Static } from "typebox";
import { CandidateBoundarySchema, CandidateOperationResultSchema, CandidatePatchSchema, CandidateRootSchema } from "../../../packages/protocol/src/candidates.ts";

const hash = Type.String({ pattern: "^[a-f0-9]{64}$" }), id = Type.String({ minLength: 1, maxLength: 128 });
const path = Type.String({ minLength: 1, maxLength: 4096 });
export const CandidateWorkerScopeSchema = Type.Object({
  env: Type.Union([Type.Literal("Remote"), Type.Literal("Sandbox")]), profileId: id, sessionId: id, projectId: id,
  sourceWorkspaceId: Type.Union([id, Type.Null()]), boundary: CandidateBoundarySchema, stateRoot: path,
  nativeRootVersion: Type.Optional(Type.Literal(3)),
  folders: Type.Object({ denied: Type.Array(path, { maxItems: 100 }), readOnly: Type.Array(path, { maxItems: 100 }) }, { additionalProperties: false }),
}, { additionalProperties: false, anyOf: [
  Type.Object({ env: Type.Literal("Remote"), nativeRootVersion: Type.Optional(Type.Never()) }),
  Type.Object({ env: Type.Literal("Sandbox"), nativeRootVersion: Type.Literal(3) }),
] });
export type CandidateWorkerScope = Static<typeof CandidateWorkerScopeSchema>;
const base = { kind: Type.Literal("candidate.operation"), operationId: id, scope: CandidateWorkerScopeSchema };
export const CandidateWorkerOperationSchema = Type.Union([
  Type.Object({ ...base, action: Type.Literal("source"), paths: Type.Array(path, { maxItems: 20, uniqueItems: true }) }, { additionalProperties: false }),
  Type.Object({ ...base, action: Type.Literal("create"), workspaceId: Type.String({ format: "uuid" }), source: CandidateRootSchema }, { additionalProperties: false }),
  Type.Object({ ...base, action: Type.Literal("inspect"), source: CandidateRootSchema, stage: CandidateRootSchema,
    paths: Type.Array(path, { maxItems: 20, uniqueItems: true }), clean: Type.Boolean() }, { additionalProperties: false }),
  Type.Object({ ...base, action: Type.Literal("state"), source: CandidateRootSchema, stage: CandidateRootSchema, patch: CandidatePatchSchema }, { additionalProperties: false }),
  Type.Object({ ...base, action: Type.Literal("write"), candidateId: id, phase: Type.Union([Type.Literal("stage"), Type.Literal("apply")]),
    source: CandidateRootSchema, stage: CandidateRootSchema, patch: CandidatePatchSchema }, { additionalProperties: false }),
]);
export type CandidateWorkerOperation = Static<typeof CandidateWorkerOperationSchema>;
export type CandidateWorkerAction<T = CandidateWorkerOperation> = T extends CandidateWorkerOperation ? Omit<T, "kind" | "operationId" | "scope"> : never;
const files = Type.Array(Type.Object({ path, baseDigest: Type.Union([hash, Type.Literal("absent")]),
  text: Type.Union([Type.String({ maxLength: 128 * 1024 }), Type.Null()]) }, { additionalProperties: false }), { maxItems: 20 });
export const CandidateWorkerResultSchema = Type.Union([
  Type.Object({ type: Type.Literal("source"), source: CandidateRootSchema, files }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("created"), source: CandidateRootSchema, stage: CandidateRootSchema }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("inspected"), source: CandidateRootSchema, stage: CandidateRootSchema, files, stageFiles: files }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("state"), digest: hash }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("written"), result: CandidateOperationResultSchema }, { additionalProperties: false }),
]);
export type CandidateWorkerResult = Static<typeof CandidateWorkerResultSchema>;
