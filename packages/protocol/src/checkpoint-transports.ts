import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const path = Type.String({ minLength: 1, maxLength: 4096 }), nullableHash = Type.Union([hash, Type.Null()]);
export const CHECKPOINT_FILE_BYTES = 2 * 1024 * 1024;
export const CHECKPOINT_WORKSPACE_BYTES = 16 * 1024 * 1024;
export const CheckpointRootBindingSchema = object({ root: path, device: Type.String(), inode: Type.String() });
export const CheckpointGitSchema = Type.Union([Type.Null(), object({ head: Type.Union([Type.String(), Type.Null()]), indexDigest: nullableHash })]);
export const CheckpointBoundarySchema = object({
  version: Type.Literal(1), env: Type.Union([Type.Literal("Local"), Type.Literal("Remote"), Type.Literal("Sandbox")]),
  profileId: id, sessionId: id, identityDigest: hash, transportDigest: hash, sourceDigest: hash,
  peerDigest: Type.Optional(hash), workerDigest: Type.Optional(hash), workspaceId: Type.Optional(id),
  inputDigest: Type.Optional(hash), executionId: Type.Optional(id), resultDigest: Type.Optional(hash),
  nativeSessionId: Type.Optional(id), planDigest: Type.Optional(hash), signerFingerprint: Type.Optional(Type.String()),
  afterId: Type.Optional(Type.String()), liveStageDigest: Type.Optional(hash),
});
export type CheckpointBoundary = Static<typeof CheckpointBoundarySchema>;
export const TurnCheckpointFileSchema = object({
  path, digest: hash, bytes: Type.Integer({ minimum: 0, maximum: CHECKPOINT_FILE_BYTES }), mode: Type.Integer({ minimum: 0, maximum: 0o777 }),
  content: Type.String({ maxLength: Math.ceil(CHECKPOINT_FILE_BYTES / 3) * 4 }),
  identity: Type.Optional(object({ device: Type.String(), inode: Type.String(), mtimeNs: Type.String(), ctimeNs: Type.String() })),
});
export type CheckpointFile = Static<typeof TurnCheckpointFileSchema>;
export const CheckpointRootSchema = object({
  binding: CheckpointRootBindingSchema, repositoryId: Type.Union([id, Type.Null()]), key: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
  files: Type.Array(TurnCheckpointFileSchema, { maxItems: 2000 }), excluded: Type.Array(path), git: CheckpointGitSchema,
});
export type CheckpointRoot = Static<typeof CheckpointRootSchema>;
export const CheckpointWorkspaceSchema = object({
  version: Type.Literal(1), roots: Type.Array(CheckpointRootSchema, { maxItems: 100 }),
  bytes: Type.Integer({ minimum: 0, maximum: CHECKPOINT_WORKSPACE_BYTES }), digest: hash, boundary: Type.Optional(CheckpointBoundarySchema),
});
export type CheckpointWorkspace = Static<typeof CheckpointWorkspaceSchema>;
export const CheckpointCaptureSourceSchema = object({
  kind: Type.Union([Type.Literal("queue"), Type.Literal("control"), Type.Literal("retry"), Type.Literal("review"), Type.Literal("terminal")]),
  id, digest: hash,
  batchId: Type.Optional(id),
});
export type CheckpointCaptureSource = Static<typeof CheckpointCaptureSourceSchema>;
export const CheckpointCaptureSchema = object({
  version: Type.Literal(1), id, checkpointId: id, profileId: id, sessionId: id,
  turnId: Type.Union([id, Type.Null()]), phase: Type.Union([Type.Literal("before"), Type.Literal("after"), Type.Literal("current")]),
  source: CheckpointCaptureSourceSchema, identityDigest: hash, policyDigest: hash, contextDigest: hash,
  leaseRoots: Type.Array(path, { maxItems: 100 }), revision: Type.Integer({ minimum: 0 }),
  status: Type.Union([Type.Literal("capturing"), Type.Literal("captured"), Type.Literal("consumed"), Type.Literal("failed"), Type.Literal("partial")]),
  workspaceDigest: nullableHash, consumedByEventId: Type.Union([id, Type.Null()]), createdAt: Type.String(), updatedAt: Type.String(),
  storageBytes: Type.Optional(Type.Integer({ minimum: 0 })),
  forgotten: Type.Optional(Type.Boolean()),
  diagnostic: Type.Union([Type.String(), Type.Null()]),
});
export type CheckpointCapture = Static<typeof CheckpointCaptureSchema>;
export const CheckpointRestoreFileSchema = object({
  path, current: Type.Union([Type.Omit(TurnCheckpointFileSchema, ["content"]), Type.Null()]),
  target: Type.Union([TurnCheckpointFileSchema, Type.Null()]), choice: Type.Union([Type.Literal("keep-current"), Type.Literal("restore-checkpoint")]),
});
export const CheckpointRestorePlanSchema = object({
  version: Type.Literal(1), operationId: id, root: CheckpointRootBindingSchema,
  expectedWorkspaceDigest: hash, expectedGit: CheckpointGitSchema,
  files: Type.Array(CheckpointRestoreFileSchema, { maxItems: 2000 }),
});
export type CheckpointRestorePlan = Static<typeof CheckpointRestorePlanSchema>;
export const CheckpointRestorePlansSchema = Type.Array(CheckpointRestorePlanSchema, { maxItems: 100 });
export const CheckpointRestoreResultSchema = object({
  version: Type.Literal(1), operationId: id, root: CheckpointRootBindingSchema, sourceDigest: hash, verified: Type.Literal(true),
  git: CheckpointGitSchema,
  files: Type.Array(object({
    path, choice: Type.Union([Type.Literal("keep-current"), Type.Literal("restore-checkpoint")]),
    outcome: Type.Union([Type.Literal("written"), Type.Literal("removed"), Type.Literal("kept")]),
    digest: nullableHash, backup: Type.Union([path, Type.Null()]), backupDigest: nullableHash,
  }), { maxItems: 2000 }),
});
export type CheckpointRestoreResult = Static<typeof CheckpointRestoreResultSchema>;
export const checkpointRootKey = (root: CheckpointRoot): string => root.key ?? root.binding.root;
export function projectCheckpointCapture(previous: CheckpointCapture | undefined, next: CheckpointCapture): CheckpointCapture {
  const identity = ({ revision: _, status: _s, workspaceDigest: _w, consumedByEventId: _e, updatedAt: _u, diagnostic: _d, leaseRoots: _l, storageBytes: _b, ...value }: CheckpointCapture) => value;
  if (!Value.Check(CheckpointCaptureSchema, next) || !previous && (next.revision !== 0 || next.status !== "capturing" ||
    next.workspaceDigest !== null || next.consumedByEventId !== null) ||
    previous && (next.revision !== previous.revision + 1 || JSON.stringify(identity(previous)) !== JSON.stringify(identity(next)) ||
      previous.status !== "capturing" && !(previous.status === "captured" && ["consumed", "partial"].includes(next.status)) ||
      previous.workspaceDigest !== null && next.workspaceDigest !== previous.workspaceDigest ||
      previous.consumedByEventId !== null || next.status === "consumed" && !next.consumedByEventId ||
      next.status !== "consumed" && next.consumedByEventId !== null)) {
    throw new MoguriError("checkpoint_capture_corrupt", "Checkpoint capture changed its original source/owner or replayed a terminal capture.", 409);
  }
  return structuredClone(next);
}
