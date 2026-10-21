import { Type, type Static, type TSchema } from "typebox";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 }), path = Type.String({ minLength: 1, maxLength: 4096 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" }), unsigned = Type.String({ pattern: "^[0-9]+$", maxLength: 40 });
const base = { profileId: id, projectId: id, root: path, device: unsigned, inode: unsigned };
export const MemoryRemotePeerSchema = object({
  peerDigest: hash, host: Type.String({ minLength: 1, maxLength: 253 }), port: Type.Integer({ minimum: 1, maximum: 65535 }), user: id,
  hostFingerprint: Type.String({ minLength: 1, maxLength: 128 }), workerDigest: hash,
});
export type MemoryRemotePeer = Static<typeof MemoryRemotePeerSchema>;
export const MemoryBindingSchema = Type.Union([
  object({ ...base, env: Type.Literal("Local"), workspaceId: Type.Union([id, Type.Null()]) }),
  object({ ...base, env: Type.Literal("Remote"), workspaceId: Type.Null(), remote: MemoryRemotePeerSchema }),
]);
export type MemoryBinding = Static<typeof MemoryBindingSchema>;
export const MemoryIndexSchema = object({
  version: Type.Literal(1), binding: MemoryBindingSchema, sourceDigest: hash,
  indexedFiles: Type.Integer({ minimum: 0, maximum: 5000 }), excludedFiles: Type.Integer({ minimum: 0, maximum: 5000 }),
  sourceBytes: Type.Integer({ minimum: 0, maximum: 64 * 1024 * 1024 }), indexedAt: Type.String({ minLength: 1, maxLength: 40 }),
});
export type MemoryIndex = Static<typeof MemoryIndexSchema>;
