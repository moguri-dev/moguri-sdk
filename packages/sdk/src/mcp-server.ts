import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { isRecord, type MoguriSdk } from "./index.ts";

const string = { type: "string" as const, minLength: 1 };
const tools = [
  { name: "moguri_discover_mcps", description: "List enabled MCP servers in this Moguri session's approved profile/project. Does not expose credentials or every tool schema.", inputSchema: { type: "object" as const, properties: {}, additionalProperties: false } },
  { name: "moguri_find_tools", description: "Find tools on one configured MCP or the builtin script server, returning bounded descriptions and schema digests. Discovery does not authorize a call.", inputSchema: { type: "object" as const, properties: { serverId: string, query: { type: "string" }, offset: { type: "integer", minimum: 0 } }, required: ["serverId"], additionalProperties: false } },
  { name: "moguri_auth_status", description: "Check whether this MCP requires a user-configured credential. Tokens are never returned. Authentication changes require the user in Moguri.", inputSchema: { type: "object" as const, properties: { serverId: string }, required: ["serverId"], additionalProperties: false } },
  { name: "moguri_call_tool", description: "Request an exact MCP call bound to its discovered schema digest. Moguri requires a human approval in the bound session; this gateway cannot approve itself.", inputSchema: { type: "object" as const, properties: { serverId: string, tool: string, arguments: { type: "object", additionalProperties: true }, schemaDigest: { type: "string", pattern: "^[a-f0-9]{64}$" } }, required: ["serverId", "tool", "arguments", "schemaDigest"], additionalProperties: false } },
  { name: "moguri_read_result", description: "Read a bounded page of a retained result belonging to this session. Large results do not consume context until requested.", inputSchema: { type: "object" as const, properties: { resultId: string, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 32768 } }, required: ["resultId"], additionalProperties: false } },
];
export function createGatewayMcpServer(sdk: MoguriSdk, sessionId: string): Server {
  const bound = () => {
    const snapshot = sdk.getState().snapshot;
    const session = snapshot?.sessions.find((session) => session.id === sessionId);
    if (!snapshot || !session) throw new Error("The bound Moguri session is unavailable. Reconnect or choose an existing session.");
    return { snapshot, session };
  };
  const server = new Server({ name: "moguri-native-gateway", version: "0.2.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const { snapshot, session } = bound();
      const args = request.params.arguments ?? {};
      const scoped = snapshot.projectConfigurations.find((configuration) => configuration.projectId === session.projectId)?.values.mcpServers ?? [];
      const enabled = [...snapshot.settings.values.mcpServers, ...scoped].filter((server) => server.enabled && (!server.projectIds || session.projectId !== null && server.projectIds.includes(session.projectId)));
      const allowed = (id: string) => { if (id !== "builtin" && !enabled.some((server) => server.id === id)) throw new Error("MCP server is outside this session's approved scope."); };
      let result: unknown;
      switch (request.params.name) {
        case "moguri_discover_mcps":
          result = (await sdk.mcp.servers(sessionId)).servers; break;
        case "moguri_find_tools":
          allowed(String(args.serverId));
          result = await sdk.mcp.tools(String(args.serverId), String(args.query ?? ""), Number(args.offset ?? 0), sessionId); break;
        case "moguri_auth_status":
          allowed(String(args.serverId));
          result = await sdk.mcp.auth(String(args.serverId), sessionId); break;
        case "moguri_call_tool": {
          allowed(String(args.serverId));
          if (!isRecord(args.arguments)) throw new Error("Tool arguments must be an object.");
          const pending = await sdk.mcp.call(sessionId, String(args.serverId), String(args.tool), args.arguments, String(args.schemaDigest));
          if (!pending.id) throw new Error("Moguri did not acknowledge the approval request.");
          const cancel = () => { void sdk.jobs.cancel(pending.id!).catch(() => console.error("Moguri could not confirm cancellation of the gateway request.")); };
          extra.signal.addEventListener("abort", cancel, { once: true });
          try {
            const job = await sdk.jobs.wait(pending.id, { signal: extra.signal });
            if (job.status !== "completed") throw new Error(job.error ?? `MCP call ${job.status}.`);
            result = { resultId: job.id, ...await sdk.mcp.readResult(job.id) };
          } finally { extra.signal.removeEventListener("abort", cancel); }
          break;
        }
        case "moguri_read_result": {
          const job = snapshot.jobs.find((job) => job.id === args.resultId);
          if (!job || job.sessionId !== sessionId) throw new Error("This result belongs to another session.");
          result = await sdk.mcp.readResult(String(args.resultId), Number(args.offset ?? 0), Number(args.limit ?? 12000)); break;
        }
        default: throw new Error("Unknown gateway operation. User-only settings, credentials and approvals are not gateway tools.");
      }
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Gateway operation failed." }] }; }
  });
  return server;
}
export async function serveGatewayMcp(sdk: MoguriSdk, sessionId: string): Promise<void> {
  const server = createGatewayMcpServer(sdk, sessionId);
  await server.connect(new StdioServerTransport());
  const close = () => { sdk.disconnect(); void server.close(); };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}
