import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";
import { generatedOAuthServer } from "./fixtures/oauth.ts";
import { waitFor } from "./fixture.ts";

const native = { skip: process.platform !== "darwin", timeout: 20_000 };
async function grant(sdk: MoguriSdk, f: Awaited<ReturnType<typeof remoteFixture>>, serverId: string, access: boolean) {
  const preview = (await sdk.mcp.remotePreview(f.sessionId, serverId)).preview;
  await sdk.mcp.grantRemote(f.sessionId, serverId, preview.digest, preview.settingsRevision, access, true);
  await f.probe(); await sdk.refresh();
}

test("Remote SDK discovery uses the actual SSH connector and scoped catalog, never the Local gateway or unsupported memory tools", native, async (t) => {
  const f = await remoteFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.probe(); await sdk.sessions.env(f.sessionId, "Remote");
    await assert.rejects(() => sdk.mcp.tools("builtin", "", 0, f.sessionId), { code: "remote_mcp_grant" });
    const local = t.mock.method(f.controller.platform.gateway, "operate", async () => { throw new Error("Local MCP fallback is forbidden."); });
    await grant(sdk, f, "builtin", false);
    const catalog = await sdk.mcp.tools("builtin", "", 0, f.sessionId);
    assert.deepEqual(catalog.tools.map((tool) => tool.name).sort(), ["fetch_page", "grep_logs"]);
    assert.ok(catalog.tools.every((tool) => tool.scope?.env === "Remote" && tool.scope.root === f.workspace));
    assert.equal(local.mock.calls.length, 0); assert.equal(f.requests.length, 0);
    assert.equal((await sdk.telemetry.operations()).totals.attempts, 0);
    const auth = await sdk.mcp.auth("builtin", f.sessionId);
    assert.equal(auth.state, "not-required"); assert.equal(auth.remote?.granted, true); assert.equal(auth.remote?.root, f.workspace);
    const settings = structuredClone(sdk.settings.get()!.values);
    settings.permissions.tools = [{ id: "generated-remote-mcp-deny", tool: "mcp_gateway", decision: "deny", pathPrefix: "" }];
    await sdk.settings.update(settings, sdk.settings.get()!.revision);
    await assert.rejects(() => sdk.mcp.tools("builtin", "", 0, f.sessionId), { code: "tool_denied" });
    assert.equal(local.mock.calls.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("Remote OAuth discovery forwards only separately granted access over SSH and redacts the actual returned catalog", native, async (t) => {
  const oauth = await generatedOAuthServer(), values = new Map<string, string>();
  const f = await remoteFixture({ platform: { vault: { read: async (id) => values.get(id) ?? null, write: async (id, value) => { values.set(id, value); }, remove: async (id) => { values.delete(id); } } } });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const settings = structuredClone(sdk.settings.get()!.values);
    settings.mcpServers = [{ id: "generated-remote-oauth", name: "Generated remote OAuth", enabled: true, transport: { type: "http", url: oauth.url, auth: "oauth" } }];
    await sdk.settings.update(settings, sdk.settings.get()!.revision); await f.probe(); await sdk.sessions.env(f.sessionId, "Remote");
    const login = await sdk.mcp.oauthBegin("generated-remote-oauth", f.sessionId), status = await sdk.mcp.oauthStatus(login.id!);
    assert.ok(status.url); assert.equal((await fetch(await oauth.callback(status.url))).status, 200); await sdk.refresh();
    assert.equal((await sdk.mcp.auth("generated-remote-oauth", f.sessionId)).state, "required");
    assert.equal(oauth.stats().mcpRequests, 0);
    const query = f.controller.remote.query.bind(f.controller.remote), forwarded: string[] = [];
    t.mock.method(f.controller.remote, "query", async (...args: Parameters<typeof query>) => {
      if (args[1].action === "mcp-tools") forwarded.push(JSON.stringify(args[1]));
      return query(...args);
    });
    await grant(sdk, f, "generated-remote-oauth", true);
    const catalog = await sdk.mcp.tools("generated-remote-oauth", "", 0, f.sessionId);
    assert.equal(catalog.tools[0]?.name, "oauth_echo"); assert.match(catalog.tools[0]!.description, /\[redacted\]/);
    assert.ok(forwarded.length === 1 && forwarded[0]!.includes("generated-oauth-access"));
    assert.equal(forwarded[0]!.includes("generated-oauth-refresh"), false);
    assert.equal(JSON.stringify(f.controller.events(0)).includes("generated-oauth-access"), false);
    assert.equal(JSON.stringify(f.controller.events(0)).includes("generated-oauth-refresh"), false);
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); await oauth.close(); }
});

test("a resource/authority change while actual SSH metadata is held cannot publish the old catalog", native, async (t) => {
  const f = await remoteFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  let held = false, release = () => {};
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  try {
    const settings = structuredClone(sdk.settings.get()!.values);
    settings.mcpServers = [{ id: "generated-remote-stdio", name: "Generated scoped stdio", enabled: true,
      transport: { type: "stdio", command: process.execPath, args: [resolve("tests/fixtures/mcp-echo.mjs")] } }];
    await sdk.settings.update(settings, sdk.settings.get()!.revision); await f.probe(); await sdk.sessions.env(f.sessionId, "Remote");
    await grant(sdk, f, "generated-remote-stdio", false);
    const tools = f.controller.remote.mcpTools.bind(f.controller.remote);
    t.mock.method(f.controller.remote, "mcpTools", async (...args: Parameters<typeof tools>) => { const result = await tools(...args); held = true; await barrier; return result; });
    const pending = sdk.mcp.tools("generated-remote-stdio", "", 0, f.sessionId);
    const rejected = assert.rejects(() => pending, { code: "remote_mcp_scope" });
    await waitFor(() => held);
    const changed = structuredClone(sdk.settings.get()!.values); changed.mcpServers[0]!.name = "Generated changed authority revision";
    await sdk.settings.update(changed, sdk.settings.get()!.revision); release(); await rejected;
    assert.equal(f.requests.length, 0); assert.equal((await sdk.telemetry.operations()).totals.attempts, 0);
  } finally { release(); sdk.disconnect(); await f.close(); }
});

test("service shutdown cancels the actual owned Remote discovery connector rather than leaving its stdio server running", native, async () => {
  const f = await remoteFixture(), sdk = await new MoguriSdk(f.service.connection).ready(), marker = join(f.workspace, "generated-remote-discovery-pid");
  try {
    const settings = structuredClone(sdk.settings.get()!.values);
    settings.mcpServers = [{ id: "generated-held-remote", name: "Generated held Remote stdio", enabled: true, transport: {
      type: "stdio", command: process.execPath, args: [resolve("tests/fixtures/mcp-echo.mjs"), "--hold-discovery", "--ignore-signals", "--started-marker", marker],
    } }];
    await sdk.settings.update(settings, sdk.settings.get()!.revision); await f.probe(); await sdk.sessions.env(f.sessionId, "Remote");
    await grant(sdk, f, "generated-held-remote", false);
    const rejected = assert.rejects(() => sdk.mcp.tools("generated-held-remote", "", 0, f.sessionId), /Remote|SSH|connection|closing|fetch|network/i);
    await waitFor(() => existsSync(marker));
    const pid = Number(await readFile(marker, "utf8")); assert.ok(Number.isSafeInteger(pid) && pid > 1);
    await f.service.close(); await rejected;
    await waitFor(() => { try { process.kill(pid, 0); return false; } catch (error) { if (error instanceof Error && "code" in error && error.code === "ESRCH") return true; throw error; } }, 5000);
  } finally { sdk.disconnect(); await f.close(); }
});
