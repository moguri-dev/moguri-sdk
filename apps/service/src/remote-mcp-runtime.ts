import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Type, type Static } from "typebox";
import { isRecord, MoguriError, parse } from "../../../packages/protocol/src/core.ts";
import { McpServerSchema } from "../../../packages/protocol/src/config.ts";
import { McpToolInfoSchema, type McpToolInfo } from "../../../packages/protocol/src/mcp.ts";
import type { ToolCall } from "../../../packages/protocol/src/index.ts";
import { runMcpConnector } from "./mcp-process.ts";
import { frameDigest } from "./worker-wire.ts";
import { redactSecrets } from "./secret-redactor.ts";

const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
export const RemoteMcpToolsRequestSchema = Type.Object({
  server: Type.Union([McpServerSchema, Type.Null()]), helperDigest: hash,
  accessToken: Type.Optional(Type.String({ minLength: 1, maxLength: 32768 })),
}, { additionalProperties: false });
export type RemoteMcpToolsRequest = Static<typeof RemoteMcpToolsRequestSchema>;
const helperPath = () => fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./mcp-worker.ts" : "./mcp-worker.mjs", import.meta.url));
async function checkedHelper(digest: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const path = helperPath();
  if (createHash("sha256").update(await readFile(path)).digest("hex") !== digest) throw new MoguriError("remote_mcp_build", "The exact Remote MCP helper differs. Install this build; no alternate helper or Local execution was selected.", 409);
  signal.throwIfAborted(); return path;
}
export async function discoverRemoteMcp(request: RemoteMcpToolsRequest, root: string, signal: AbortSignal): Promise<McpToolInfo[]> {
  const input = parse(RemoteMcpToolsRequestSchema, request), needsAccess = input.server?.transport.type === "http" && input.server.transport.auth !== "none";
  if (needsAccess !== Boolean(input.accessToken)) throw new MoguriError("remote_mcp_credential", "MCP discovery has no correctly scoped access for its exact auth method. No anonymous or Local fallback.", 403);
  const path = await checkedHelper(input.helperDigest, signal);
  const tools = await runMcpConnector({ action: "tools", root, server: input.server, ...(input.accessToken ? { token: input.accessToken } : {}) }, path, signal);
  return parse(Type.Array(McpToolInfoSchema, { maxItems: 512 }), tools);
}
export const RemoteMcpAuthorizationSchema = Type.Object({
  kind: Type.Literal("remote-mcp"), operationId: id, scopeDigest: hash, stepId: id, callDigest: hash,
  env: Type.Literal("Remote"), root: Type.String({ minLength: 1, maxLength: 4096 }), helperDigest: hash,
  server: Type.Union([McpServerSchema, Type.Null()]), tool: Type.String({ minLength: 1, maxLength: 160 }),
  arguments: Type.Record(Type.String(), Type.Unknown()), schemaDigest: hash, reviewedDigest: hash,
  accessToken: Type.Optional(Type.String({ minLength: 1, maxLength: 32768 })),
}, { additionalProperties: false });
export type RemoteMcpAuthorization = Static<typeof RemoteMcpAuthorizationSchema>;
export const RemoteMcpExecutionResultSchema = Type.Object({
  operationId: id, scopeDigest: hash, dispatched: Type.Boolean(), accessReceived: Type.Boolean(),
  outcome: Type.Union([Type.Literal("completed"), Type.Literal("failed"), Type.Literal("stopped"), Type.Literal("partial")]),
  result: Type.Optional(Type.Unknown()), diagnostic: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
}, { additionalProperties: false });
export type RemoteMcpExecutionResult = Static<typeof RemoteMcpExecutionResultSchema>;
export async function executeRemoteMcp(raw: RemoteMcpAuthorization, expected: { call: ToolCall; stepId: string; root: string | null; env?: string },
  signal: AbortSignal, started: (pid: number) => void): Promise<RemoteMcpExecutionResult> {
  const authorization = parse(RemoteMcpAuthorizationSchema, raw), secrets = authorization.accessToken ? [authorization.accessToken] : [];
  let dispatched = false;
  try {
    signal.throwIfAborted();
    const call = expected.call;
    if (expected.env !== "Remote" || authorization.env !== expected.env || !expected.root || authorization.root !== expected.root ||
      authorization.stepId !== expected.stepId || authorization.callDigest !== frameDigest(call) || call.name !== "mcp_gateway" || call.arguments.action !== "call" ||
      authorization.tool !== call.arguments.tool || (authorization.server?.id ?? "builtin") !== call.arguments.serverId ||
      authorization.reviewedDigest !== call.arguments.schemaDigest || !isRecord(call.arguments.arguments) ||
      frameDigest(authorization.arguments) !== frameDigest(call.arguments.arguments)) throw new MoguriError("remote_mcp_authorization", "MCP authorization does not own this exact Remote tool/root/step/arguments. No connector was started.", 403);
    const needsAccess = authorization.server?.transport.type === "http" && authorization.server.transport.auth !== "none";
    if (needsAccess !== Boolean(authorization.accessToken)) throw new MoguriError("remote_mcp_credential", "The Remote MCP access token does not match its exact selected resource/auth method. No credential fallback.", 403);
    const helperPath = await checkedHelper(authorization.helperDigest, signal);
    const result = await runMcpConnector({ action: "call", server: authorization.server, root: authorization.root, tool: authorization.tool,
      arguments: authorization.arguments, schemaDigest: authorization.schemaDigest, ...(authorization.accessToken ? { token: authorization.accessToken } : {}) }, helperPath, signal,
    (pid) => { started(pid); dispatched = true; });
    const safe = redactSecrets(result, secrets);
    if (Buffer.byteLength(JSON.stringify(safe)) > 2 * 1024 * 1024) throw new MoguriError("remote_mcp_result_limit", "Remote MCP result exceeds 2 MiB. It was not silently truncated; inspect external effects.", 409);
    return { operationId: authorization.operationId, scopeDigest: authorization.scopeDigest, dispatched, accessReceived: secrets.length > 0,
      outcome: isRecord(safe) && safe.isError === true ? "failed" : "completed", result: safe, diagnostic: isRecord(safe) && safe.isError === true ? "The Remote MCP tool returned an error result." : null };
  } catch (error) {
    const diagnostic = error instanceof MoguriError ? error.message : signal.aborted ? "Remote MCP cancellation requested. No request was retried." : "Remote MCP execution failed. Inspect its exact helper, root and resource.";
    return { operationId: authorization.operationId, scopeDigest: authorization.scopeDigest, dispatched, accessReceived: secrets.length > 0,
      outcome: dispatched ? "partial" : signal.aborted ? "stopped" : "failed", diagnostic: redactSecrets(dispatched ? `${diagnostic} External effects may be partial; owned cleanup is not rollback.` : diagnostic, secrets) };
  }
}
