import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rename, rmdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { directMcpTool, directMcpSchema, modelToolName, resolveDirectMcpCall } from "../apps/service/src/direct-mcp-tools.ts";
import { MoguriSdk, isRecord, type McpToolInfo } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor, type GeneratedProviderOptions } from "./fixture.ts";
import { startService } from "../apps/service/src/server.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("direct MCP preserves the actual leaf schema and explicit canonical binding without accepting submitted provenance", () => {
  const tool: McpToolInfo = { serverId: "generated-server", name: "echo", description: "Generated typed echo.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false }, digest: "a".repeat(64) };
  const definition = directMcpTool(tool, "b".repeat(64)), schema = directMcpSchema(definition);
  assert.match(schema.name, /^mcp_direct_[a-f0-9]{40}$/);
  assert.deepEqual(JSON.parse(JSON.stringify(schema.parameters)), tool.inputSchema);
  const call = resolveDirectMcpCall({ id: "generated-call", name: schema.name, arguments: { text: "Generated request." } }, [definition]);
  assert.equal(call.name, "mcp_gateway"); assert.equal(modelToolName(call), schema.name);
  assert.deepEqual(call.arguments, { action: "call", serverId: tool.serverId, tool: tool.name, schemaDigest: tool.digest, arguments: { text: "Generated request." } });
  assert.throws(() => resolveDirectMcpCall({ ...call, name: "mcp_gateway" }, [definition]), { code: "mcp_direct_source" });
  assert.notEqual(directMcpTool(tool, "c".repeat(64)).binding.name, schema.name);
  assert.notEqual(directMcpTool({ ...tool, digest: "d".repeat(64) }, "b".repeat(64)).binding.name, schema.name);
  assert.throws(() => directMcpTool({ ...tool, inputSchema: { type: "object", properties: { text: false } } }, "b".repeat(64)), { code: "mcp_direct_schema" });
  assert.throws(() => directMcpTool({ ...tool, inputSchema: { type: "object", description: "x".repeat(13000) } }, "b".repeat(64)), { code: "mcp_direct_schema" });
});

for (const mode of ["allow", "deny", "stale", "root", "dispatch-root"] as const) test(`the actual worker uses a provider-visible MCP leaf with ${mode} source/approval`, { skip: process.platform !== "darwin", timeout: ciTime(20000) }, async (t) => {
  const allow = mode === "allow";
  let directName = "", leafExposed = false;
  const options: GeneratedProviderOptions = {
    respond: (request) => {
      const messages = Array.isArray(request.messages) ? request.messages.filter(isRecord) : [];
      const results = messages.filter((message) => message.role === "tool");
      if (!results.length) return { tool: { name: "mcp_gateway", args: { action: "tools", serverId: "generated-direct" } } };
      if (results.length === 1) {
        const body: unknown = JSON.parse(String(results[0]!.content));
        if (!isRecord(body) || !Array.isArray(body.tools) || !isRecord(body.tools[0]) || typeof body.tools[0].directName !== "string") throw new Error("Generated actual discovery did not expose a direct MCP identity.");
        directName = body.tools[0].directName;
        return { tool: { name: "discover_tools", args: { query: directName } } };
      }
      if (results.length === 2) {
        const tools = Array.isArray(request.tools) ? request.tools.filter(isRecord) : [];
        const leaf = tools.find((tool) => isRecord(tool.function) && tool.function.name === directName);
        if (!leaf || !isRecord(leaf.function) || !isRecord(leaf.function.parameters) || !isRecord(leaf.function.parameters.properties)) throw new Error("Generated model did not receive the actual direct leaf schema.");
        leafExposed = Object.hasOwn(leaf.function.parameters.properties, "text") && !Object.hasOwn(leaf.function.parameters.properties, "serverId");
        return { tool: { name: directName, args: { text: "Generated direct result." } } };
      }
      return { text: "Generated direct MCP task complete." };
    },
  };
  const f = await setupFixture(options), sdk = await new MoguriSdk(f.service.connection).ready();
  const marker = join(f.directory, "generated-direct-calls");
  let reopened: Awaited<ReturnType<typeof startService>> | undefined, next: MoguriSdk | undefined;
  try {
    await f.configure(); await sdk.refresh();
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, mcpServers: [{ id: "generated-direct", name: "Generated direct MCP", enabled: true,
      transport: { type: "stdio", command: process.execPath, args: [resolve("tests/fixtures/mcp-echo.mjs"), "--call-marker", marker] } }] }, settings.revision);
    if (allow) await sdk.sessions.autonomy(f.sessionId, "Autopilot");
    await f.send("Generated direct MCP original task.");
    if (!allow) {
      for (let count = 0; count < 5; count++) {
        const approval = await waitFor(() => f.session().pendingApproval);
        const direct = Boolean(approval.call.directMcp);
        if (direct && mode === "stale") {
          const current = sdk.settings.get()!;
          await sdk.settings.update({ ...current.values, mcpServers: current.values.mcpServers.map((server) => ({ ...server, enabled: false })) }, current.revision);
        } else if (direct && mode === "root") {
          const original = `${f.project}-original`;
          await rename(f.project, original);
          try {
            await mkdir(f.project);
            try { await assert.rejects(() => sdk.approvals.respond(f.sessionId, approval.id, true), { code: "mcp_direct_stale" }); }
            finally { await rmdir(f.project); }
          } finally { await rename(original, f.project); }
          await sdk.approvals.respond(f.sessionId, approval.id, false);
        } else if (direct && mode === "dispatch-root") {
          const gateway = f.service.controller.platform.gateway, access = gateway.accessToken.bind(gateway);
          let entered = false, release!: () => void;
          const gate = new Promise<void>((resolve) => { release = resolve; });
          t.mock.method(gateway, "accessToken", async (...args: Parameters<typeof gateway.accessToken>) => { entered = true; await gate; return access(...args); });
          await sdk.approvals.respond(f.sessionId, approval.id, true);
          await waitFor(() => entered);
          const original = `${f.project}-original`;
          await rename(f.project, original);
          try {
            await mkdir(f.project);
            try { release(); await f.terminal(); }
            finally { release(); await rmdir(f.project); }
          } finally { await rename(original, f.project); }
        } else await sdk.approvals.respond(f.sessionId, approval.id, !direct);
        if (direct) break;
      }
    }
    await f.terminal();
    assert.equal(f.session().status, mode === "dispatch-root" ? "partial" : "completed"); assert.equal(leafExposed, true);
    assert.equal(existsSync(marker), allow);
    if (allow) {
      assert.equal(await readFile(marker, "utf8"), "generated call\n");
      const result = await waitFor(() => f.service.controller.events(0).find((event) => event.event_type === "tool.completed" && event.payload.call.directMcp));
      assert.equal(result.event_type === "tool.completed" && result.payload.call.directMcp?.name, directName);
      assert.equal(result.event_type === "tool.completed" && result.payload.call.arguments.serverId, "generated-direct");
      await sdk.refresh();
      const sources = await sdk.tools.results(f.sessionId);
      const source = sources.sources.find((source) => source.callId === (result.event_type === "tool.completed" ? result.payload.call.id : ""));
      assert.ok(source);
      assert.match((await sdk.tools.resultById(f.sessionId, source.operationId)).text, /Generated direct result/);
      const foreign = await sdk.sessions.create(null);
      await assert.rejects(() => sdk.tools.resultById(foreign.id!, source.operationId), { code: "tool_result_scope" });
      sdk.disconnect(); await f.service.close();
      reopened = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
      next = await new MoguriSdk(reopened.connection).ready();
      const retained = (await next.tools.results(f.sessionId)).sources.find((entry) => entry.operationId === source.operationId);
      assert.deepEqual(retained, source);
      assert.match((await next.tools.resultById(f.sessionId, source.operationId, { expectedDigest: source.digest, expectedRevision: source.revision })).text, /Generated direct result/);
      assert.equal(await readFile(marker, "utf8"), "generated call\n", "reopen and source reads cannot repeat the connector");
    } else assert.equal(f.service.controller.events(0).some((event) => event.event_type === "tool.started" && event.payload.call.directMcp), mode === "dispatch-root");
  } finally { sdk.disconnect(); next?.disconnect(); await reopened?.close(); await f.close(); }
});

test("a real direct MCP leaf uses the pinned SSH worker, original remote result and metering without controller execution", { skip: process.platform !== "darwin", timeout: ciTime(30000) }, async (t) => {
  let name = "";
  const f = await remoteFixture({ respond: (request) => {
    const results = Array.isArray(request.messages) ? request.messages.filter(isRecord).filter((message) => message.role === "tool") : [];
    if (!results.length) return { tool: { name: "mcp_gateway", args: { action: "tools", serverId: "builtin", query: "grep_logs" } } };
    if (results.length === 1) {
      const value: unknown = JSON.parse(String(results[0]!.content));
      const selected = isRecord(value) && Array.isArray(value.tools) ? value.tools.filter(isRecord).find((tool) => tool.name === "grep_logs") : undefined;
      if (!selected || typeof selected.directName !== "string") throw new Error("Generated Remote discovery has no exact direct grep leaf.");
      name = selected.directName;
      return { tool: { name: "discover_tools", args: { query: name } } };
    }
    if (results.length === 2) return { tool: { name, args: { path: "fixture.txt", query: "remote source" } } };
    return { text: "Generated Remote direct MCP complete." };
  } }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.probe(); await sdk.sessions.env(f.sessionId, "Remote");
    const preview = (await sdk.mcp.remotePreview(f.sessionId, "builtin")).preview;
    await sdk.mcp.grantRemote(f.sessionId, "builtin", preview.digest, preview.settingsRevision, false, true);
    await f.probe(); await sdk.refresh(); await f.select();
    const local = t.mock.method(f.controller.platform.gateway, "operate", async () => { throw new Error("Generated direct SSH operation must not execute on the Local gateway."); });
    await f.send("Generated direct MCP on the captured Remote."); await f.terminal();
    assert.equal(f.session().status, "completed", f.session().lastError ?? "");
    assert.equal(local.mock.calls.length, 0); assert.equal(f.requests.length, 4);
    const call = (await sdk.mcp.remoteCalls(f.sessionId)).calls[0]!;
    assert.equal(call.status, "completed"); assert.equal(call.root, f.workspace); assert.equal(call.actor, "model"); assert.equal(call.accessForwarded, false);
    assert.match(JSON.stringify((await sdk.mcp.remoteCall(f.sessionId, call.id)).result), /generated actual remote source/);
    const leaf = f.controller.events(0).find((event) => event.event_type === "tool.completed" && event.payload.call.directMcp?.name === name);
    assert.ok(leaf);
    assert.equal((await sdk.budgets.dashboard({ sessionId: f.sessionId })).totals.knownReportedTokens, 168);
  } finally { sdk.disconnect(); await f.close(); }
});
