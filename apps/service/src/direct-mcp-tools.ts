import { createHash } from "node:crypto";
import { Type, type Tool } from "@earendil-works/pi-ai";
import { isRecord, MoguriError, type McpToolInfo, type ToolCall } from "../../../packages/protocol/src/index.ts";

export interface DirectMcpTool {
  binding: NonNullable<ToolCall["directMcp"]>;
  description: string;
  parameters: Tool["parameters"];
}
export function directMcpTool(tool: McpToolInfo, bindingDigest: string): DirectMcpTool {
  if (tool.inputSchema.type !== "object" || tool.inputSchema.properties !== undefined && !isRecord(tool.inputSchema.properties) ||
    Buffer.byteLength(JSON.stringify(tool.inputSchema)) > 12 * 1024) throw new MoguriError("mcp_direct_schema", "This MCP leaf schema is not a bounded object schema. Its exact gateway interface remains available; no schema was truncated.", 409);
  const name = `mcp_direct_${createHash("sha256").update(JSON.stringify([bindingDigest, tool.serverId, tool.name, tool.digest])).digest("hex").slice(0, 40)}`;
  const properties = Object.fromEntries(Object.entries(tool.inputSchema.properties ?? {}).map(([name, schema]) => {
    if (!isRecord(schema)) throw new MoguriError("mcp_direct_schema", "This MCP property schema is not an object. No partial direct schema was exposed.", 409);
    return [name, Type.Unsafe(schema)];
  }));
  const parameters = { ...Type.Object(properties), ...structuredClone(tool.inputSchema) };
  return { binding: { name, serverId: tool.serverId, tool: tool.name, schemaDigest: tool.digest, bindingDigest },
    description: `[MCP direct] ${tool.serverId}/${tool.name}. Exact discovered schema; same gateway approval/root/account, not permission. ${tool.description}`.slice(0, 2000),
    parameters };
}
export const directMcpSchema = (tool: DirectMcpTool): Tool => ({ name: tool.binding.name, description: tool.description, parameters: tool.parameters });
export function resolveDirectMcpCall(call: ToolCall, definitions: readonly DirectMcpTool[]): ToolCall {
  const definition = definitions.find((definition) => definition.binding.name === call.name);
  if (!definition) {
    if (call.directMcp) throw new MoguriError("mcp_direct_source", "Direct MCP provenance must come from the captured model-facing schema, not submitted arguments.", 403);
    return call;
  }
  if (call.directMcp || call.hook) throw new MoguriError("mcp_direct_source", "A model-facing MCP leaf cannot attach its own permission/source metadata.", 403);
  const binding = definition.binding;
  return { id: call.id, name: "mcp_gateway", arguments: { action: "call", serverId: binding.serverId, tool: binding.tool,
    arguments: call.arguments, schemaDigest: binding.schemaDigest }, directMcp: structuredClone(binding) };
}
export const modelToolName = (call: ToolCall) => call.directMcp?.name ?? call.name;
