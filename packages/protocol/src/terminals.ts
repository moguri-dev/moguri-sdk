import { Type, type Static, type TSchema } from "typebox";
import { RemoteIdentitySchema } from "./execution.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const path = Type.String({ minLength: 1, maxLength: 4096 });
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const binding = {
  profileId: id, sessionId: id, projectId: id, workspaceId: nullable(id),
  root: path, device: Type.String({ maxLength: 40 }), inode: Type.String({ maxLength: 40 }), digest: hash,
};
export const TerminalBindingSchema = Type.Union([
  object({ ...binding, env: Type.Literal("Local") }),
  object({ ...binding, sessionId: Type.Null(), projectId: Type.Null(), workspaceId: Type.Null(), env: Type.Literal("Local") }),
  object({ ...binding, env: Type.Literal("Remote"), peerDigest: hash }),
]);
export type TerminalBinding = Static<typeof TerminalBindingSchema>;
export const RemoteTerminalBoundarySchema = object({ target: RemoteIdentitySchema, peerDigest: hash, bridgeDigest: hash, brokerDigest: hash });
export type RemoteTerminalBoundary = Static<typeof RemoteTerminalBoundarySchema>;
export const RemoteTerminalBuildSchema = object({
  command: Type.Array(path, { minItems: 2, maxItems: 8 }), bridgeDigest: hash, brokerDigest: hash, shell: path,
});
export type RemoteTerminalBuild = Static<typeof RemoteTerminalBuildSchema>;
const owner = {
  id, profileId: id, protocol: Type.Literal(1), buildDigest: hash, scopeDigest: hash,
  cleanup: Type.Union([Type.Literal("retained"), Type.Literal("pending"), Type.Literal("removed")]),
  createdAt: Type.String({ maxLength: 40 }), updatedAt: Type.String({ maxLength: 40 }), diagnostic: nullable(Type.String({ maxLength: 4096 })),
};
const status = Type.Union([Type.Literal("starting"), Type.Literal("running"), Type.Literal("stopping"), Type.Literal("stopped"), Type.Literal("unconfirmed"), Type.Literal("acknowledged")]);
const pid = nullable(Type.Integer({ minimum: 2, maximum: Number.MAX_SAFE_INTEGER }));
export const LocalTerminalOwnerSchema = object({ ...owner, directory: path, endpoint: path, pid, status,
  env: Type.Optional(Type.Literal("Local")), remote: Type.Optional(Type.Never()) });
export type LocalTerminalOwner = Static<typeof LocalTerminalOwnerSchema>;
export const PreparedRemoteTerminalOwnerSchema = object({ ...owner, directory: path, endpoint: path, pid, status, env: Type.Literal("Remote"), remote: RemoteTerminalBoundarySchema });
export type PreparedRemoteTerminalOwner = Static<typeof PreparedRemoteTerminalOwnerSchema>;
export const PreparedTerminalOwnerSchema = Type.Union([LocalTerminalOwnerSchema, PreparedRemoteTerminalOwnerSchema]);
export type PreparedTerminalOwner = Static<typeof PreparedTerminalOwnerSchema>;
export const RemoteTerminalOwnerSchema = Type.Union([
  PreparedRemoteTerminalOwnerSchema,
  object({ ...owner, directory: Type.Null(), endpoint: Type.Null(), pid: Type.Null(),
    status: Type.Union([Type.Literal("preparing"), Type.Literal("unconfirmed"), Type.Literal("stopped"), Type.Literal("acknowledged")]),
    env: Type.Literal("Remote"), remote: RemoteTerminalBoundarySchema }),
]);
export type RemoteTerminalOwner = Static<typeof RemoteTerminalOwnerSchema>;
export const TerminalOwnerSchema = Type.Union([LocalTerminalOwnerSchema, RemoteTerminalOwnerSchema]);
export type TerminalOwner = Static<typeof TerminalOwnerSchema>;
export const TerminalStateSchema = object({
  id, sessionId: nullable(id), projectId: nullable(id), workspaceId: Type.Optional(nullable(id)),
  title: Type.String({ maxLength: 160 }), pid: nullable(Type.Integer({ minimum: 2, maximum: Number.MAX_SAFE_INTEGER })),
  cols: Type.Integer({ minimum: 10, maximum: 500 }), rows: Type.Integer({ minimum: 2, maximum: 200 }),
  status: Type.Union([Type.Literal("starting"), Type.Literal("reattaching"), Type.Literal("running"), Type.Literal("stopping"), Type.Literal("closed"), Type.Literal("failed"), Type.Literal("unconfirmed"), Type.Literal("acknowledged")]),
  diagnostic: nullable(Type.String({ maxLength: 4096 })), env: Type.Optional(Type.Union([Type.Literal("Local"), Type.Literal("Remote")])), binding: Type.Optional(TerminalBindingSchema),
  ownerId: Type.Optional(id), commandId: Type.Optional(id), commandDigest: Type.Optional(hash), attachmentId: Type.Optional(id),
  launchDigest: Type.Optional(hash),
});
export type TerminalState = Static<typeof TerminalStateSchema>;
export interface RuntimeCloseOptions { preserveTerminals?: boolean }
