import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import Ajv from "ajv";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { INTERNAL_MCP_TOOLS } from "./gateway-tools.ts";
import { readProjectFile } from "./files.ts";
import { fetchPage } from "./web-page.ts";
import { McpServerSchema, parse, type McpServerConfig } from "../../../packages/protocol/src/index.ts";

export interface McpOperation {
  action: "tools" | "call";
  server: McpServerConfig | null;
  token?: string;
  root: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  schemaDigest?: string;
  prepared?: unknown;
  scripts?: { id: string; name: string; description: string; path: string; digest: string }[];
}
const operationSchema = Type.Object({
  action: Type.Union([Type.Literal("tools"), Type.Literal("call")]),
  server: Type.Union([McpServerSchema, Type.Null()]), root: Type.String({ minLength: 1, maxLength: 4096 }),
  token: Type.Optional(Type.String({ maxLength: 32768 })), tool: Type.Optional(Type.String({ maxLength: 160 })),
  arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())), schemaDigest: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })),
  prepared: Type.Optional(Type.Unknown()), scripts: Type.Optional(Type.Array(Type.Object({
    id: Type.String(), name: Type.String(), description: Type.String(), path: Type.String(), digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  }), { maxItems: 64 })),
}, { additionalProperties: false });
const abort = new AbortController();
let client: Client | undefined;
const fingerprint = (tool: Tool, server: unknown) => createHash("sha256").update(JSON.stringify({ tool, server })).digest("hex");
const textResult = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }] });
async function run(operation: McpOperation): Promise<unknown> {
  client = new Client({ name: "moguri-gateway", version: "0.2.0" });
  let builtin: Server | undefined;
  if (!operation.server) {
    builtin = new Server({ name: "moguri-internal", version: "1" }, { capabilities: { tools: {} } });
    const scripts: Tool[] = (operation.scripts ?? []).map((script) => ({ name: `script.${script.id}`, description: script.description, inputSchema: { type: "object", $comment: `approved-source-sha256:${script.digest}`, properties: { arguments: { type: "object", additionalProperties: true } }, required: ["arguments"], additionalProperties: false } }));
    builtin.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...INTERNAL_MCP_TOOLS, ...scripts] }));
    builtin.setRequestHandler(CallToolRequestSchema, async (request) => {
      const args = request.params.arguments ?? {};
      if (request.params.name === "grep_logs") {
        const file = await readProjectFile(operation.root, String(args.path));
        const lines = file.text.split("\n").map((text, index) => ({ line: index + 1, text })).filter((line) => line.text.includes(String(args.query))).slice(0, 100);
        return textResult({ path: file.path, digest: file.digest, matches: lines, boundedAt: 100 });
      }
      if (request.params.name === "fetch_page") return textResult(await fetchPage(String(args.url), abort.signal));
      if (request.params.name === "search_memory" || request.params.name === "memory_graph") {
        if (operation.prepared === undefined) throw new Error("This memory tool has no authorized root-bound prepared data. No index or Local fallback was selected.");
        return textResult(operation.prepared);
      }
      const script = operation.scripts?.find((script) => `script.${script.id}` === request.params.name);
      if (!script) throw new Error("Unknown approved internal tool.");
      const child = spawn(process.execPath, [script.path], { cwd: operation.root, stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH, HOME: process.env.HOME } });
      const cancel = () => child.kill("SIGTERM");
      abort.signal.addEventListener("abort", cancel, { once: true });
      let output = "";
      let oversized = false;
      let inputFailed = false;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (data: string) => {
        if (oversized) return;
        if (Buffer.byteLength(output) + Buffer.byteLength(data) > 128 * 1024) { oversized = true; child.kill("SIGKILL"); }
        else output += data;
      });
      child.stderr.resume();
      child.stdin.on("error", () => { inputFailed = true; child.kill("SIGTERM"); });
      child.stdin.end(JSON.stringify({ arguments: args.arguments, projectRoot: operation.root }));
      try {
        const code = await new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
        if (oversized) throw new Error("Approved script exceeded the 128 KiB output limit.");
        if (inputFailed) throw new Error("Approved script did not receive its input. Inspect its stdin contract.");
        if (code !== 0) throw new Error(`Approved script exited with status ${code ?? "signal"}.`);
        return textResult(output);
      } finally { abort.signal.removeEventListener("abort", cancel); }
    });
    const [local, remote] = InMemoryTransport.createLinkedPair();
    await builtin.connect(remote);
    await client.connect(local);
  } else if (operation.server.transport.type === "stdio") {
    const transport = new StdioClientTransport({
      command: operation.server.transport.command, args: operation.server.transport.args, cwd: operation.root,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? operation.root },
      stderr: "pipe", maxBufferSize: 2 * 1024 * 1024,
    });
    if (transport.stderr instanceof Readable) transport.stderr.resume();
    await client.connect(transport);
  } else {
    await client.connect(new StreamableHTTPClientTransport(new URL(operation.server.transport.url), {
      requestInit: operation.token ? { headers: { Authorization: `Bearer ${operation.token}` } } : undefined,
      redirectPolicy: "same-origin",
      reconnectionOptions: { initialReconnectionDelay: 200, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 2, maxRetries: 0 },
    }));
  }
  try {
    const tools: Tool[] = [];
    let cursor: string | undefined;
    const cursors = new Set<string>();
    let pages = 0;
    do {
      if (++pages > 64 || cursor && cursors.has(cursor)) throw new Error("MCP discovery exceeded 64 pages or repeated a cursor. No tool was called.");
      if (cursor) cursors.add(cursor);
      const page = await client.listTools(cursor ? { cursor } : undefined, { signal: abort.signal, timeout: 15_000 });
      tools.push(...page.tools);
      cursor = page.nextCursor;
      if (tools.length > 512) throw new Error("MCP catalog exceeded 512 tools. Configure a bounded server instead.");
    } while (cursor);
    const version = client.getServerVersion();
    if (operation.action === "tools") return tools.map((tool) => ({
      serverId: operation.server?.id ?? "builtin", name: tool.name, description: (tool.description ?? "").slice(0, 2000),
      inputSchema: tool.inputSchema, digest: fingerprint(tool, version),
    }));
    const tool = tools.find((tool) => tool.name === operation.tool);
    if (!tool || fingerprint(tool, version) !== operation.schemaDigest) throw new Error("MCP tool schema or server version changed. Rediscover it and obtain a new approval.");
    const internal = INTERNAL_MCP_TOOLS.find((candidate) => candidate.name === tool.name);
    if (internal ? !Value.Check(internal.inputSchema, operation.arguments) : !new Ajv({ strict: false, allErrors: false, validateFormats: false }).validate(tool.inputSchema, operation.arguments)) {
      throw new Error("Arguments do not match the current MCP tool schema. No tool was called.");
    }
    return await client.callTool({ name: tool.name, arguments: operation.arguments }, undefined, { signal: abort.signal, timeout: 60_000 });
  } finally { await client.close(); await builtin?.close(); }
}
process.once("message", (raw: unknown) => {
  const operation: McpOperation = parse(operationSchema, raw);
  void run(operation).then((result) => {
    let data = JSON.stringify(result);
    if (data.length > 2 * 1024 * 1024) throw new Error("MCP result exceeded 2 MiB. Use a narrower tool request.");
    if (operation.token) data = data.split(operation.token).join("[redacted]");
    process.send?.({ ok: true, result: JSON.parse(data) }, () => process.disconnect?.());
  }).catch((error: unknown) => {
    let message = error instanceof Error ? error.message : "MCP operation failed.";
    if (operation.token) message = message.split(operation.token).join("[redacted]");
    process.send?.({ ok: false, error: message.slice(0, 2000) }, () => process.disconnect?.());
  });
});
process.on("disconnect", () => { abort.abort(); void client?.close(); });
process.on("SIGTERM", () => { abort.abort(); void client?.close(); });
