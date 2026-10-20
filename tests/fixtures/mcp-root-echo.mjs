import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const server = new Server({ name: "generated-root-echo", version: "1" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "root_echo", description: "Generated actual MCP root witness",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } }] }));
server.setRequestHandler(CallToolRequestSchema, async (request) => ({ content: [{ type: "text", text: JSON.stringify({
  text: request.params.arguments.text, root: process.cwd(), pid: process.pid, parentPid: process.ppid, marker: await readFile(join(process.cwd(), "fixture.txt"), "utf8"),
}) }] }));
await server.connect(new StdioServerTransport());
