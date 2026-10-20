import { Type, type Static, type TSchema } from "typebox";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const path = Type.String({ minLength: 1, maxLength: 4096 });
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
export const TerminalBindingSchema = object({
  profileId: id, sessionId: id, projectId: id, workspaceId: nullable(id), env: Type.Literal("Local"),
  root: path, device: Type.String({ maxLength: 40 }), inode: Type.String({ maxLength: 40 }), digest: hash,
});
export type TerminalBinding = Static<typeof TerminalBindingSchema>;
export const TerminalOwnerSchema = object({
  id, profileId: id, protocol: Type.Literal(1), buildDigest: hash, scopeDigest: hash,
  directory: path, endpoint: path, pid: nullable(Type.Integer({ minimum: 2, maximum: Number.MAX_SAFE_INTEGER })),
  status: Type.Union([Type.Literal("starting"), Type.Literal("running"), Type.Literal("stopping"), Type.Literal("stopped"), Type.Literal("unconfirmed"), Type.Literal("acknowledged")]),
  cleanup: Type.Union([Type.Literal("retained"), Type.Literal("pending"), Type.Literal("removed")]),
  createdAt: Type.String({ maxLength: 40 }), updatedAt: Type.String({ maxLength: 40 }), diagnostic: nullable(Type.String({ maxLength: 4096 })),
});
export type TerminalOwner = Static<typeof TerminalOwnerSchema>;
export const TerminalStateSchema = object({
  id, sessionId: id, projectId: id, workspaceId: Type.Optional(nullable(id)),
  title: Type.String({ maxLength: 160 }), pid: nullable(Type.Integer({ minimum: 2, maximum: Number.MAX_SAFE_INTEGER })),
  cols: Type.Integer({ minimum: 10, maximum: 500 }), rows: Type.Integer({ minimum: 2, maximum: 200 }),
  status: Type.Union([Type.Literal("starting"), Type.Literal("reattaching"), Type.Literal("running"), Type.Literal("stopping"), Type.Literal("closed"), Type.Literal("failed"), Type.Literal("unconfirmed"), Type.Literal("acknowledged")]),
  diagnostic: nullable(Type.String({ maxLength: 4096 })), env: Type.Optional(Type.Literal("Local")), binding: Type.Optional(TerminalBindingSchema),
  ownerId: Type.Optional(id), commandId: Type.Optional(id), commandDigest: Type.Optional(hash), attachmentId: Type.Optional(id),
  launchDigest: Type.Optional(hash),
});
export type TerminalState = Static<typeof TerminalStateSchema>;
export interface RuntimeCloseOptions { preserveTerminals?: boolean }
