import { Type } from "typebox";
import { MoguriError, ToolCallSchema, type McpServerConfig, type RemoteMcpPreview, type RemoteTarget } from "../../../packages/protocol/src/index.ts";
import { RemoteTargetSchema } from "../../../packages/protocol/src/execution.ts";
import { McpServerSchema } from "../../../packages/protocol/src/config.ts";
import { frameDigest } from "./worker-wire.ts";
import { remoteFingerprint } from "./remote.ts";

export interface RemoteMcpScope {
  profileId: string; sessionId: string; projectId: string; root: string; target: RemoteTarget; workerDigest: string;
  settingsRevision: number; permissionRevision: number; policyRevision: number; projectRevision: number;
  mode: "agent" | "read-only"; pendingMode: "agent" | "read-only" | null;
}
const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" }), revision = Type.Integer({ minimum: 0 });
const mode = Type.Union([Type.Literal("agent"), Type.Literal("read-only")]);
export const RemoteMcpIntentSchema = Type.Object({
  format: Type.Literal("moguri-remote-mcp-intent"), version: Type.Literal(1),
  scope: Type.Object({
    profileId: id, sessionId: id, projectId: id, root: Type.String({ minLength: 1, maxLength: 4096 }), target: RemoteTargetSchema, workerDigest: hash,
    settingsRevision: revision, permissionRevision: revision, policyRevision: revision, projectRevision: revision, mode, pendingMode: Type.Union([mode, Type.Null()]),
  }, { additionalProperties: false }),
  call: ToolCallSchema, server: Type.Union([McpServerSchema, Type.Null()]), helperDigest: hash, schemaDigest: hash, requiresAccess: Type.Boolean(),
}, { additionalProperties: false });
export const remoteMcpPeer = (target: Pick<RemoteTarget, "host" | "port" | "user" | "hostKey">) => frameDigest(["moguri-remote-mcp-peer-v1", target.host, target.port, target.user, target.hostKey]);
export function mcpResource(server: McpServerConfig | null) {
  if (!server) return { id: "builtin", name: "Moguri foundational tools", transport: "builtin" as const, auth: "none" as const,
    resource: "Remote grep_logs/fetch_page and opt-in search_memory/memory_graph for the captured SSH repository, with actual-host source checks. No transferred Local script or implicit host path.",
    digest: frameDigest(["moguri-mcp-resource-v1", "builtin", ["grep_logs", "fetch_page", "search_memory", "memory_graph"]]) };
  const transport = server.transport;
  let resource: string;
  if (transport.type === "http") {
    const url = new URL(transport.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw new MoguriError("mcp_resource", "Remote MCP requires an exact credential-free HTTP(S) resource URL without a fragment.", 409);
    resource = url.href;
  } else resource = `${transport.command} ${JSON.stringify(transport.args)}`;
  if (resource.length > 16384) throw new MoguriError("mcp_resource_limit", "This Remote MCP resource is too large for exact bounded review. Reduce its configured argv before granting access.", 409);
  return { id: server.id, name: server.name, transport: transport.type, auth: transport.type === "http" ? transport.auth : "none" as const,
    resource, digest: frameDigest(["moguri-mcp-resource-v1", server.id, transport]) };
}
export function remoteMcpPreview(scope: RemoteMcpScope, server: McpServerConfig | null, helperDigest: string): RemoteMcpPreview {
  const resource = mcpResource(server), peerDigest = remoteMcpPeer(scope.target), resourceDigest = resource.digest;
  const grant = scope.target.mcpGrants?.find((grant) => grant.serverId === resource.id && grant.peerDigest === peerDigest && grant.resourceDigest === resourceDigest);
  return {
    sessionId: scope.sessionId, projectId: scope.projectId, root: scope.root, peerDigest, resourceDigest,
    digest: frameDigest(["moguri-remote-mcp-scope-v1", scope, resourceDigest, helperDigest]),
    settingsRevision: scope.settingsRevision, permissionRevision: scope.permissionRevision, policyRevision: scope.policyRevision, projectRevision: scope.projectRevision,
    host: { name: scope.target.name, host: scope.target.host, port: scope.target.port, user: scope.target.user, fingerprint: remoteFingerprint(scope.target) },
    server: { id: resource.id, name: resource.name, transport: resource.transport, resource: resource.resource, auth: resource.auth },
    granted: Boolean(grant), forwardAccess: grant?.forwardAccess === true,
    warning: "This is execution on the selected SSH host, not SendBox isolation. Remote stdio uses that host's command/cwd and may have its own account. Access forwarding is a separate peer/resource/profile grant; bearer values may be long-lived API keys and the host can retain received access. Refresh credentials never leave their backend. No Local or anonymous fallback.",
  };
}
export function requireRemoteMcpGrant(preview: RemoteMcpPreview): void {
  if (!preview.granted) throw new MoguriError("remote_mcp_grant", "Review and explicitly grant this exact MCP resource on the pinned SSH peer first. Selecting Remote or a Local server is not authorization.", 403);
  if (preview.server.auth !== "none" && !preview.forwardAccess) throw new MoguriError("remote_mcp_credential", "This authenticated MCP resource has no explicit peer-bound access-token forwarding grant. No Local token or anonymous fallback was used.", 403);
}
