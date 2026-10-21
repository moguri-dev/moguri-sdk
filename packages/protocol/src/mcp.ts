import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const revision = Type.Integer({ minimum: 0 }), path = Type.String({ minLength: 1, maxLength: 4096 });
const nullable = <T extends TSchema>(value: T) => Type.Union([value, Type.Null()]);
export const RemoteMcpGrantSchema = object({
  serverId: id, peerDigest: hash, resourceDigest: hash, forwardAccess: Type.Boolean(),
});
export type RemoteMcpGrant = Static<typeof RemoteMcpGrantSchema>;
export interface McpServerInfo {
  id: string; name: string; transport: "builtin" | "stdio" | "http"; env: "Local" | "Remote" | "Sandbox";
  state: "configured" | "review-required" | "access-required" | "unready"; diagnostic: string;
  remote?: { granted: boolean; forwardAccess: boolean; root: string; hostFingerprint: string };
}
export const McpToolInfoSchema = object({
  serverId: id, name: Type.String({ minLength: 1, maxLength: 160 }), description: Type.String({ maxLength: 2000 }),
  inputSchema: Type.Record(Type.String(), Type.Unknown()), digest: hash,
  scope: Type.Optional(object({ env: Type.Literal("Remote"), root: path, peerDigest: hash, resourceDigest: hash, helperDigest: hash })),
});
export type McpToolInfo = Static<typeof McpToolInfoSchema>;
export const RemoteMcpPreviewSchema = object({
  sessionId: id, projectId: id, root: path, peerDigest: hash, resourceDigest: hash, digest: hash,
  settingsRevision: revision, permissionRevision: revision, policyRevision: revision, projectRevision: revision,
  host: object({ name: Type.String({ maxLength: 120 }), host: Type.String({ maxLength: 253 }), port: Type.Integer({ minimum: 1, maximum: 65535 }), user: id, fingerprint: Type.String({ maxLength: 128 }) }),
  server: object({ id, name: Type.String({ maxLength: 120 }), transport: Type.Union([Type.Literal("builtin"), Type.Literal("stdio"), Type.Literal("http")]),
    resource: Type.String({ maxLength: 16384 }), auth: Type.Union([Type.Literal("none"), Type.Literal("bearer"), Type.Literal("oauth")]) }),
  granted: Type.Boolean(), forwardAccess: Type.Boolean(), warning: Type.String({ maxLength: 4096 }),
});
export type RemoteMcpPreview = Static<typeof RemoteMcpPreviewSchema>;
export const RemoteMcpCallSchema = object({
  id, profileId: id, sessionId: id, projectId: id, turnId: id, stepId: id, callId: id,
  actor: Type.Union([Type.Literal("model"), Type.Literal("external")]),
  commandId: nullable(id), commandDigest: nullable(hash), jobId: nullable(id), executionId: nullable(id),
  revision, env: Type.Literal("Remote"), root: path, hostFingerprint: Type.String({ maxLength: 128 }),
  peerDigest: hash, resourceDigest: hash, scopeDigest: hash, helperDigest: hash,
  serverId: id, tool: Type.String({ minLength: 1, maxLength: 160 }), argumentsDigest: hash, intentDigest: hash,
  accessForwarded: nullable(Type.Boolean()), resultDigest: nullable(hash),
  phase: Type.Union([Type.Literal("intent"), Type.Literal("authorized"), Type.Literal("dispatched"), Type.Literal("result-retained"), Type.Literal("settled")]),
  status: Type.Union([Type.Literal("waiting_input"), Type.Literal("running"), Type.Literal("completed"), Type.Literal("denied"),
    Type.Literal("failed"), Type.Literal("stopped"), Type.Literal("partial"), Type.Literal("unconfirmed")]),
  createdAt: Type.String({ maxLength: 40 }), updatedAt: Type.String({ maxLength: 40 }), diagnostic: nullable(Type.String({ maxLength: 4096 })),
});
export type RemoteMcpCall = Static<typeof RemoteMcpCallSchema>;
export const RemoteMcpCommandSchema = Type.Union([
  object({ type: Type.Literal("mcp.remote.grant"), sessionId: id, serverId: id, expectedDigest: hash, expectedRevision: revision, forwardAccess: Type.Boolean(), confirmReview: Type.Literal(true) }),
  object({ type: Type.Literal("mcp.remote.revoke"), sessionId: id, serverId: id, expectedRevision: revision, confirmReview: Type.Literal(true) }),
]);
export type RemoteMcpCommand = Static<typeof RemoteMcpCommandSchema>;
export const isRemoteMcpCommand = (value: unknown): value is RemoteMcpCommand => Value.Check(RemoteMcpCommandSchema, value);
export const RemoteMcpQuerySchema = Type.Union([
  object({ type: Type.Literal("mcp.remote.preview"), sessionId: id, serverId: id }),
  object({ type: Type.Literal("mcp.remote.calls"), sessionId: id }),
  object({ type: Type.Literal("mcp.remote.call"), sessionId: id, operationId: id }),
]);
export type RemoteMcpQuery = Static<typeof RemoteMcpQuerySchema>;
export const isRemoteMcpQuery = (value: unknown): value is RemoteMcpQuery => Value.Check(RemoteMcpQuerySchema, value);
export type RemoteMcpResponse =
  | { type: "mcp.remote.preview"; preview: RemoteMcpPreview }
  | { type: "mcp.remote.calls"; calls: RemoteMcpCall[] }
  | { type: "mcp.remote.call"; call: RemoteMcpCall; result: unknown | null };
