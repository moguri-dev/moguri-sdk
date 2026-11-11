import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { appendFileSync, writeFileSync } from "node:fs";
const marker = process.argv.indexOf("--started-marker");
if (marker >= 0) writeFileSync(process.argv[marker + 1], String(process.pid));
if (process.argv.includes("--ignore-signals")) process.on("SIGTERM", () => {});
const server = new Server({ name: "generated-echo", version: "1" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (process.argv.includes("--hold-discovery")) return new Promise(() => {});
  if (process.argv.includes("--repeat-cursor")) return { tools: [], nextCursor: "generated-repeated-cursor" };
  return { tools: [{ name: "echo", description: "Generated fixture echo", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } }] };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const marker = process.argv.indexOf("--call-marker");
  if (marker >= 0) appendFileSync(process.argv[marker + 1], "generated call\n");
  if (process.argv.includes("--drop-call")) process.exit(17);
  if (process.argv.includes("--hold-call")) return new Promise(() => {});
  return { content: [{ type: "text", text: `generated: ${request.params.arguments.text}` }] };
});
await server.connect(new StdioServerTransport());
