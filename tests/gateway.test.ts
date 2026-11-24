import assert from "node:assert/strict";
import { test } from "node:test";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MoguriSdk, DraftEditor, isRecord } from "../packages/sdk/src/index.ts";
import { createGatewayMcpServer } from "../packages/sdk/src/mcp-server.ts";
import { reviewNativeTools, setupFixture, waitFor } from "./fixture.ts";
import { McpGateway, type SecretVault } from "../apps/service/src/gateway.ts";
import { ciTime } from "./fixtures/time-scale.ts";

class GeneratedVault implements SecretVault {
  values = new Map<string, string>();
  async read(id: string) { return this.values.get(id) ?? null; }
  async write(id: string, value: string) { this.values.set(id, value); }
  async remove(id: string) { this.values.delete(id); }
}
test("the builtin MCP file search supports a selective README beyond the full-read envelope", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-mcp-readme-")), gateway = new McpGateway(new GeneratedVault()), signal = new AbortController().signal;
  try {
    await writeFile(join(root, "README.md"), `${"Generated README source line.\n".repeat(6000)}Generated exact crate search target.\n`);
    const tool = (await gateway.tools(null, root, signal)).find((tool) => tool.name === "grep_logs")!;
    const result = await gateway.operate({ action: "call", server: null, root, tool: tool.name, arguments: { path: "README.md", query: "exact crate search target" }, schemaDigest: tool.digest }, signal);
    assert.ok(isRecord(result)); assert.notEqual(result.isError, true);
    const content = CallToolResultSchema.parse(result).content.find((content) => content.type === "text");
    assert.ok(content?.type === "text");
    const selected = JSON.parse(content.text);
    assert.equal(selected.matches[0]?.line, 6001); assert.equal(selected.matches[0]?.text, "Generated exact crate search target.");
    const missing = await gateway.operate({ action: "call", server: null, root, tool: tool.name, arguments: { path: "README.md", query: "Generated absent section" }, schemaDigest: tool.digest }, signal);
    const missingText = CallToolResultSchema.parse(missing).content.find((content) => content.type === "text");
    assert.ok(missingText?.type === "text"); assert.deepEqual(JSON.parse(missingText.text).matches, []);
    await writeFile(join(root, "oversized.txt"), "a".repeat(1024 * 1024 + 1));
    await assert.rejects(() => gateway.operate({ action: "call", server: null, root, tool: tool.name, arguments: { path: "oversized.txt", query: "a" }, schemaDigest: tool.digest }, signal), /1024 KiB/);
  } finally { await gateway.close(); await rm(root, { recursive: true, force: true }); }
});

test("the builtin MCP file search bounds long matching lines without losing the match or hiding omissions", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-mcp-long-lines-")), gateway = new McpGateway(new GeneratedVault()), signal = new AbortController().signal;
  try {
    await writeFile(join(root, "long.txt"), `${"\u0001".repeat(350_000)}GENERATED_MATCH near the end.\n`);
    await writeFile(join(root, "many.txt"), "GENERATED_MATCH short line.\n".repeat(120));
    await writeFile(join(root, "unicode.txt"), `${"\u{1f4a0}".repeat(1500)}GENERATED_MATCH ${"\u00e9".repeat(1100)}\n`);
    await writeFile(join(root, "wide.txt"), `GENERATED_MATCH ${"\u{1f4a0}".repeat(1500)}\n`.repeat(100));
    const tool = (await gateway.tools(null, root, signal)).find((tool) => tool.name === "grep_logs")!;
    const selected = [];
    for (const path of ["long.txt", "many.txt", "unicode.txt", "wide.txt"]) {
      const result = await gateway.operate({ action: "call", server: null, root, tool: tool.name, arguments: { path, query: "GENERATED_MATCH" }, schemaDigest: tool.digest }, signal);
      const text = CallToolResultSchema.parse(result).content.find((content) => content.type === "text");
      assert.ok(text?.type === "text");
      assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 12000);
      selected.push(JSON.parse(text.text));
    }
    const [long, many, unicode, wide] = selected;
    assert.equal(long.complete, false); assert.equal(long.matches[0]?.clipped, true);
    assert.match(long.matches[0]?.text, /GENERATED_MATCH near the end/);
    assert.equal(long.matches[0]?.offset, 350_000);
    assert.equal(many.matches.length, 100); assert.equal(many.omittedRows, 20); assert.equal(many.complete, false);
    assert.ok(many.matches.every((match: { clipped: boolean }) => !match.clipped));
    assert.equal(unicode.matches[0]?.offset, 6000); assert.equal(Array.from(unicode.matches[0]?.text).length, 1000);
    assert.equal(unicode.matches[0]?.text.includes("\ufffd"), false); assert.equal(unicode.matches[0]?.clipped, true);
    assert.ok(wide.matches.length > 0 && wide.matches.length < 100); assert.equal(wide.omittedRows, 100 - wide.matches.length);
    assert.equal(wide.resultBytesBoundedAt, 12000); assert.equal(wide.complete, false);
    assert.ok(wide.matches.every((match: { text: string; clipped: boolean }) => Array.from(match.text).length === 1000 && match.clipped));
    await assert.rejects(() => gateway.operate({ action: "call", server: null, root, tool: tool.name, arguments: { path: "unicode.txt", query: "\udca0" }, schemaDigest: tool.digest }, signal), /lossless Unicode/);
  } finally { await gateway.close(); await rm(root, { recursive: true, force: true }); }
});

test("a wide builtin MCP search reaches the next model request as intact bounded JSON", async () => {
  const call = { serverId: "builtin", tool: "grep_logs", arguments: { path: "wide.txt", query: "GENERATED_MATCH" }, schemaDigest: "a".repeat(64) };
  const f = await setupFixture({ mcpCall: call }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await writeFile(join(f.project, "wide.txt"), `GENERATED_MATCH ${"\u{1f4a0}".repeat(1500)}\n`.repeat(100));
    call.schemaDigest = (await sdk.mcp.tools("builtin", "grep_logs", 0, f.sessionId)).tools[0]!.digest;
    await f.configure(); await f.send("generated mcp call with wide matching lines."); await f.terminal();
    assert.equal(f.session().status, "completed"); assert.equal(f.requests.length, 2);
    const messages = f.requests[1]?.messages;
    assert.ok(Array.isArray(messages));
    const result = messages.find((message: unknown) => isRecord(message) && message.role === "tool");
    assert.ok(isRecord(result) && typeof result.content === "string");
    const view = JSON.parse(result.content);
    assert.equal(view.truncated, false);
    const original = JSON.parse(view.content), selection = JSON.parse(original.content[0].text);
    assert.equal(selection.complete, false); assert.ok(selection.omittedRows > 0);
    assert.match(selection.matches[0]?.text, /GENERATED_MATCH/);
    assert.equal(f.session().pendingApproval, null);
  } finally { sdk.disconnect(); await f.close(); }
});

test("a real stdio MCP is discovered through the native gateway and credentials never enter settings/events", async () => {
  const vault = new GeneratedVault();
  const fixture = await setupFixture({ platform: { vault } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const settings = structuredClone(sdk.settings.get()!.values);
    settings.mcpServers = [
      { id: "generated-stdio", name: "Generated stdio", enabled: true, projectIds: [fixture.session().projectId], transport: { type: "stdio", command: process.execPath, args: [resolve("tests/fixtures/mcp-echo.mjs")] } },
      { id: "generated-auth", name: "Generated auth", enabled: true, transport: { type: "http", url: "https://generated.invalid/mcp", auth: "bearer" } },
    ];
    await sdk.settings.update(settings, sdk.settings.get()!.revision);
    const tools = await sdk.mcp.tools("generated-stdio", "echo", 0, fixture.sessionId);
    assert.equal(tools.tools[0]?.name, "echo");
    assert.equal((await sdk.mcp.auth("generated-auth")).state, "required");
    await sdk.mcp.setToken("generated-auth", "generated-secret-never-persist");
    assert.equal((await sdk.mcp.auth("generated-auth")).state, "configured");
    assert.equal(vault.values.get("generated-auth"), "generated-secret-never-persist");
    assert.equal(JSON.stringify(fixture.service.controller.events(0)).includes("generated-secret-never-persist"), false);
    assert.equal(JSON.stringify(sdk.settings.get()).includes("generated-secret-never-persist"), false);
    const marker = join(fixture.directory, "generated-policy-blocked-mcp");
    settings.mcpServers[0]!.transport = { type: "stdio", command: process.execPath, args: [resolve("tests/fixtures/mcp-echo.mjs"), "--started-marker", marker] };
    await sdk.settings.update(settings, sdk.settings.get()!.revision);
    await sdk.command({ type: "policy.set", allowedEnvs: ["Sandbox", "Remote"] });
    await assert.rejects(() => sdk.mcp.tools("generated-stdio", "", 0, fixture.sessionId), /No Local fallback/);
    assert.equal(existsSync(marker), false);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the single outward MCP exposes discovery/call/result but no user-only settings or approval tool", { skip: process.platform !== "darwin", timeout: ciTime(20_000) }, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const server = createGatewayMcpServer(sdk, fixture.sessionId);
  const caller = new Client({ name: "generated-external-agent", version: "1" });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  try {
    await reviewNativeTools(fixture, ["mcp_gateway"]);
    await server.connect(remote); await caller.connect(local);
    const tools = await caller.listTools();
    assert.equal(tools.tools.length, 7);
    assert.ok(tools.tools.some((tool) => tool.name === "moguri_find_skills"));
    assert.ok(tools.tools.some((tool) => tool.name === "moguri_read_skill"));
    assert.equal(tools.tools.some((tool) => /approve|settings|set_token/.test(tool.name)), false);
    const discovery = await caller.callTool({ name: "moguri_find_tools", arguments: { serverId: "builtin", query: "grep" } });
    const discovered = CallToolResultSchema.parse(discovery).content.find((content) => content.type === "text");
    assert.ok(discovered?.type === "text");
    const data: unknown = JSON.parse(discovered.text);
    assert.ok(isRecord(data) && Array.isArray(data.tools));
    const tool: unknown = data.tools[0];
    assert.ok(isRecord(tool) && typeof tool.digest === "string");
    const pending = caller.callTool({ name: "moguri_call_tool", arguments: { serverId: "builtin", tool: "grep_logs", arguments: { path: "fixture.txt", query: "original" }, schemaDigest: tool.digest } });
    await waitFor(() => fixture.session().pendingApproval);
    assert.equal(fixture.requests.length, 0);
    await fixture.approve();
    const result = await pending;
    assert.match(JSON.stringify(result), /generated original/);
    assert.equal(fixture.requests.length, 0);
  } finally { await caller.close(); await server.close(); sdk.disconnect(); await fixture.close(); }
});

test("permission revocation invalidates a waiting MCP request and cancellation does not execute it", { skip: process.platform !== "darwin", timeout: ciTime(20_000) }, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await reviewNativeTools(fixture, ["mcp_gateway"]);
    const tool = (await sdk.mcp.tools("builtin", "grep", 0, fixture.sessionId)).tools[0]!;
    const pending = await sdk.mcp.call(fixture.sessionId, "builtin", tool.name, { path: "fixture.txt", query: "original" }, tool.digest);
    const approval = fixture.session().pendingApproval!;
    const settings = structuredClone(sdk.settings.get()!.values);
    settings.permissions.tools = [{ id: "deny-gateway", tool: "mcp_gateway", decision: "deny", pathPrefix: "" }];
    await sdk.settings.update(settings, sdk.settings.get()!.revision);
    assert.equal((await sdk.jobs.wait(pending.id!)).status, "cancelled");
    await assert.rejects(() => sdk.command({ type: "approval.respond", sessionId: fixture.sessionId, approvalId: approval.id, allow: true }), /expired|changed|already/);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("Streamable HTTP uses only its scoped keychain credential and redacts a credential echoed by a server", async () => {
  const vault = new GeneratedVault();
  const credential = "generated-http-credential-not-personal";
  let authorized = 0;
  const http = createServer((request, response) => {
    void (async () => {
      if (request.headers.authorization !== `Bearer ${credential}`) { response.writeHead(401).end(); return; }
      authorized++;
      const server = new Server({ name: "generated-http", version: "1" }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "echo", description: `Generated secret echo ${credential}`, inputSchema: { type: "object" } }] }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      response.on("close", () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(request, response);
    })().catch(() => { if (!response.headersSent) response.writeHead(500); response.end("Generated MCP HTTP fixture failed."); });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  assert.ok(address && typeof address !== "string");
  const fixture = await setupFixture({ platform: { vault } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const settings = structuredClone(sdk.settings.get()!.values);
    settings.mcpServers = [{ id: "generated-http", name: "Generated HTTP", enabled: true, transport: { type: "http", url: `http://127.0.0.1:${address.port}/mcp`, auth: "bearer" } }];
    await sdk.settings.update(settings, sdk.settings.get()!.revision);
    await sdk.mcp.setToken("generated-http", credential);
    const tools = await sdk.mcp.tools("generated-http");
    assert.equal(tools.tools[0]?.name, "echo");
    assert.ok(authorized > 0);
    assert.equal(JSON.stringify(tools).includes(credential), false);
    assert.match(JSON.stringify(tools), /\[redacted\]/);
    assert.equal(JSON.stringify(fixture.service.controller.events(0)).includes(credential), false);
  } finally { sdk.disconnect(); await fixture.close(); http.closeAllConnections(); await new Promise<void>((resolve) => http.close(() => resolve())); }
});

test("MCP discovery bounds repeated cursors and service shutdown waits for owned connector termination", { timeout: ciTime(15_000) }, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const marker = join(fixture.directory, "generated-mcp-pid");
  try {
    let settings = structuredClone(sdk.settings.get()!.values);
    settings.mcpServers = [{ id: "generated-bounded", name: "Generated bounded", enabled: true, transport: { type: "stdio", command: process.execPath, args: [resolve("tests/fixtures/mcp-echo.mjs"), "--repeat-cursor"] } }];
    await sdk.settings.update(settings, sdk.settings.get()!.revision);
    await assert.rejects(() => sdk.mcp.tools("generated-bounded"), /repeated a cursor/);
    settings = structuredClone(sdk.settings.get()!.values);
    settings.mcpServers[0]!.transport = { type: "stdio", command: process.execPath, args: [resolve("tests/fixtures/mcp-echo.mjs"), "--hold-discovery", "--ignore-signals", "--started-marker", marker] };
    await sdk.settings.update(settings, sdk.settings.get()!.revision);
    const pending = assert.rejects(() => sdk.mcp.tools("generated-bounded"), /cancel|connector|network|fetch/i);
    await waitFor(() => existsSync(marker));
    await fixture.service.controller.platform.gateway.close();
    await pending;
    const pid = Number(await readFile(marker, "utf8"));
    await waitFor(() => { try { process.kill(pid, 0); return false; } catch (error) { if (error instanceof Error && "code" in error && error.code === "ESRCH") return true; throw error; } });
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("an external MCP approval holds the project lease against other agents and external callers", { skip: process.platform !== "darwin", timeout: ciTime(20_000) }, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await reviewNativeTools(fixture, ["mcp_gateway"]);
    await fixture.configure();
    const projectId = fixture.session().projectId;
    const second = await sdk.command({ type: "session.create", projectId, title: "Generated MCP lease waiter" });
    await sdk.command({ type: "session.configure", sessionId: second.id!, expectedRevision: 0, controls: fixture.session().controls });
    const third = await sdk.command({ type: "session.create", projectId });
    const tool = (await sdk.mcp.tools("builtin", "grep", 0, fixture.sessionId)).tools[0]!;
    const pending = await sdk.mcp.call(fixture.sessionId, "builtin", tool.name, { path: "fixture.txt", query: "original" }, tool.digest);
    await assert.rejects(() => sdk.mcp.call(third.id!, "builtin", tool.name, { path: "fixture.txt", query: "original" }, tool.digest), /owns this workspace/);
    const draft = new DraftEditor(sdk, second.id!, { revision: 0, text: "", attachments: [] });
    try { draft.edit("generated queued after MCP"); await draft.send("queue"); }
    finally { draft.dispose(); }
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.service.controller.snapshot().sessions.find((session) => session.id === second.id)?.status, "queued");
    await sdk.jobs.cancel(pending.id!);
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === second.id)?.status === "completed");
    assert.equal(fixture.requests.length, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});
