import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { createServer } from "node:http";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { generatedOAuthServer } from "./fixtures/oauth.ts";
import type { SecretVault } from "../apps/service/src/gateway.ts";
import { startService } from "../apps/service/src/server.ts";

class Vault implements SecretVault {
  values = new Map<string, string>();
  async read(id: string) { return this.values.get(id) ?? null; }
  async write(id: string, value: string) { this.values.set(id, value); }
  async remove(id: string) { this.values.delete(id); }
}
test("MCP OAuth uses exact PKCE/state/resource exchange, refreshes grants and keeps secrets outside events/clients", { timeout: 20_000 }, async () => {
  const server = await generatedOAuthServer(), vault = new Vault();
  let now = Date.now();
  const fixture = await setupFixture({ platform: { vault, oauth: { now: () => now } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, mcpServers: [{ id: "generated-oauth", name: "Generated OAuth", enabled: true, transport: { type: "http", url: server.url, auth: "oauth" } }] }, settings.revision);
    await assert.rejects(() => sdk.mcp.tools("generated-oauth", "", 0, fixture.sessionId), /explicit OAuth/);
    const login = await sdk.mcp.oauthBegin("generated-oauth", fixture.sessionId);
    const state = await sdk.mcp.oauthStatus(login.id!);
    assert.equal(state.authorization.state, "waiting"); assert.ok(state.url);
    const callback = await server.callback(state.url);
    const wrong = new URL(callback); wrong.searchParams.set("state", "generated-wrong-state");
    assert.equal((await fetch(wrong)).status, 400);
    assert.equal((await sdk.mcp.oauthStatus(login.id!)).authorization.state, "waiting");
    assert.equal((await fetch(callback)).status, 200);
    await waitFor(() => sdk.getState().snapshot?.oauthAuthorizations.some((value) => value.id === login.id && value.state === "connected"));
    assert.equal((await sdk.mcp.auth("generated-oauth")).method, "oauth");
    const tools = await sdk.mcp.tools("generated-oauth", "", 0, fixture.sessionId);
    assert.equal(tools.tools[0]?.name, "oauth_echo");
    assert.match(tools.tools[0]!.description, /\[redacted\]/);
    const call = await sdk.mcp.call(fixture.sessionId, "generated-oauth", "oauth_echo", {}, tools.tools[0]!.digest);
    await fixture.approve();
    assert.equal((await sdk.jobs.wait(call.id!)).status, "completed");
    assert.match((await sdk.mcp.readResult(call.id!)).text, /Generated OAuth tool response \[redacted\]/);
    now += 61_000;
    await sdk.mcp.tools("generated-oauth", "", 0, fixture.sessionId);
    assert.equal(server.stats().refreshes, 1);
    assert.equal(server.stats().exchanges, 1);
    const exposed = JSON.stringify({ events: fixture.service.controller.events(0), snapshot: sdk.getState().snapshot });
    assert.equal(exposed.includes("generated-oauth-access"), false);
    assert.equal(exposed.includes("generated-oauth-refresh"), false);
    assert.ok([...vault.values.values()].some((text) => text.includes("generated-oauth-refresh")));
    await sdk.mcp.oauthClear("generated-oauth", fixture.sessionId);
    assert.equal((await sdk.mcp.auth("generated-oauth")).state, "required");
    assert.equal(vault.values.size, 0); assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); await server.close(); }
});

test("cancelled/expired OAuth never accepts a late callback or falls back to anonymous tools", { timeout: 20_000 }, async () => {
  const server = await generatedOAuthServer(), vault = new Vault();
  const fixture = await setupFixture({ platform: { vault, oauth: { ttlMs: 100 } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, mcpServers: [{ id: "generated-oauth", name: "Generated OAuth", enabled: true, transport: { type: "http", url: server.url, auth: "oauth" } }] }, settings.revision);
    const login = await sdk.mcp.oauthBegin("generated-oauth", fixture.sessionId);
    const url = (await sdk.mcp.oauthStatus(login.id!)).url!;
    const callback = await server.callback(url);
    await sdk.mcp.oauthCancel(login.id!);
    assert.equal((await sdk.mcp.oauthStatus(login.id!)).authorization.state, "cancelled");
    await assert.rejects(() => fetch(callback));
    const next = await sdk.mcp.oauthBegin("generated-oauth", fixture.sessionId);
    await waitFor(() => sdk.getState().snapshot?.oauthAuthorizations.some((state) => state.id === next.id && state.state === "expired"));
    assert.equal((await sdk.mcp.oauthStatus(next.id!)).url, null);
    await assert.rejects(() => sdk.mcp.tools("generated-oauth", "", 0, fixture.sessionId), /explicit OAuth/);
    assert.equal(server.stats().exchanges, 0); assert.equal(server.stats().mcpRequests, 0);
  } finally { sdk.disconnect(); await fixture.close(); await server.close(); }
});

test("cancellation during a late native credential write scrubs tokens before acknowledging cancellation", { timeout: 20_000 }, async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  class HeldVault extends Vault {
    writing?: AbortSignal;
    override async write(id: string, value: string, signal?: AbortSignal) {
      if (value.includes("access_token")) { this.writing = signal; await gate; }
      await super.write(id, value);
    }
  }
  const server = await generatedOAuthServer(), vault = new HeldVault(), fixture = await setupFixture({ platform: { vault } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, mcpServers: [{ id: "generated-oauth", name: "Generated OAuth", enabled: true, transport: { type: "http", url: server.url, auth: "oauth" } }] }, settings.revision);
    const login = await sdk.mcp.oauthBegin("generated-oauth", fixture.sessionId);
    const callback = await server.callback((await sdk.mcp.oauthStatus(login.id!)).url!);
    const result = fetch(callback).then((response) => response.status, () => 0);
    await waitFor(() => vault.writing);
    const cancel = sdk.mcp.oauthCancel(login.id!);
    await waitFor(() => vault.writing?.aborted);
    release(); await cancel; await result;
    assert.equal((await sdk.mcp.oauthStatus(login.id!)).authorization.state, "cancelled");
    assert.equal((await sdk.mcp.auth("generated-oauth")).state, "required");
    assert.equal([...vault.values.values()].some((value) => value.includes("access_token")), false);
    assert.equal(fixture.requests.length, 0);
  } finally { release(); sdk.disconnect(); await fixture.close(); await server.close(); }
});
test("refresh revocation stops before an MCP request and a connected global grant survives origin/project removal and restart", { timeout: 20_000 }, async () => {
  const server = await generatedOAuthServer(), vault = new Vault();
  let now = Date.now(), runtime: Awaited<ReturnType<typeof startService>> | undefined;
  const fixture = await setupFixture({ platform: { vault, oauth: { now: () => now } } });
  let sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, mcpServers: [{ id: "generated-oauth", name: "Generated OAuth", enabled: true, transport: { type: "http", url: server.url, auth: "oauth" } }] }, settings.revision);
    const login = await sdk.mcp.oauthBegin("generated-oauth", fixture.sessionId);
    await fetch(await server.callback((await sdk.mcp.oauthStatus(login.id!)).url!));
    await waitFor(() => sdk.getState().snapshot?.oauthAuthorizations.some((authorization) => authorization.state === "connected"));
    const projectId = fixture.session().projectId;
    await sdk.sessions.delete(fixture.sessionId, true);
    await sdk.projects.remove(projectId, true, 0);
    assert.equal((await sdk.mcp.auth("generated-oauth")).state, "configured");
    sdk.disconnect(); await fixture.service.close();
    runtime = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey, platform: { vault, oauth: { now: () => now } } });
    sdk = await new MoguriSdk(runtime.connection).ready();
    await sdk.mcp.tools("generated-oauth");
    const requests = server.stats().mcpRequests;
    now += 61_000; server.revoke();
    await assert.rejects(() => sdk.mcp.tools("generated-oauth"), /refresh|login|Reconnect/i);
    assert.equal(server.stats().mcpRequests, requests);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await runtime?.close(); await fixture.close(); await server.close(); }
});
test("project removal clears historical OAuth resources, while restart never replays a pending callback", { timeout: 20_000 }, async () => {
  const first = await generatedOAuthServer(), second = await generatedOAuthServer(), vault = new Vault(), fixture = await setupFixture({ platform: { vault } });
  let runtime: Awaited<ReturnType<typeof startService>> | undefined;
  let sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const projectId = fixture.session().projectId, id = `p-${projectId.slice(0, 8)}-oauth`;
    const config = (await sdk.projects.configuration(projectId)).configuration;
    await sdk.projects.configure(projectId, { ...config.values, mcpServers: [{ id, name: "Generated project OAuth", enabled: true, projectIds: [projectId], transport: { type: "http", url: first.url, auth: "oauth" } }] }, config.revision);
    const login = await sdk.mcp.oauthBegin(id, fixture.sessionId);
    await fetch(await first.callback((await sdk.mcp.oauthStatus(login.id!)).url!));
    await waitFor(() => sdk.getState().snapshot?.oauthAuthorizations.some((authorization) => authorization.state === "connected"));
    const updated = (await sdk.projects.configuration(projectId)).configuration;
    await sdk.projects.configure(projectId, { ...updated.values, mcpServers: [{ id, name: "Generated changed resource", enabled: true, projectIds: [projectId], transport: { type: "http", url: second.url, auth: "oauth" } }] }, updated.revision);
    assert.equal((await sdk.mcp.auth(id, fixture.sessionId)).state, "required");
    const pending = await sdk.mcp.oauthBegin(id, fixture.sessionId);
    const url = (await sdk.mcp.oauthStatus(pending.id!)).url!;
    sdk.disconnect(); await fixture.service.close();
    runtime = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey, platform: { vault } });
    sdk = await new MoguriSdk(runtime.connection).ready();
    assert.equal((await sdk.mcp.oauthStatus(pending.id!)).url, null);
    assert.notEqual((await sdk.mcp.oauthStatus(pending.id!)).authorization.state, "connected");
    await assert.rejects(() => fetch(new URL(url).searchParams.get("redirect_uri")!));
    await sdk.projects.remove(projectId, true, updated.revision + 1);
    assert.equal(vault.values.size, 0);
    assert.equal(second.stats().exchanges, 0);
  } finally { sdk.disconnect(); await runtime?.close(); await fixture.close(); await first.close(); await second.close(); }
});

test("pre-registered confidential clients use a fixed owned callback and never put their secret in events", { timeout: 20_000 }, async () => {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address(); if (!address || typeof address === "string") throw new Error("Generated loopback port missing.");
  const redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const oauth = await generatedOAuthServer({ registration: false }), vault = new Vault(), fixture = await setupFixture({ platform: { vault } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, mcpServers: [{ id: "generated-static", name: "Generated static OAuth", enabled: true, transport: { type: "http", url: oauth.url, auth: "oauth" } }] }, settings.revision);
    oauth.registerClient("generated-registered", redirectUri, "generated-confidential-secret");
    await sdk.mcp.oauthClient("generated-static", "generated-registered", oauth.origin, "generated-confidential-secret", fixture.sessionId, redirectUri);
    const login = await sdk.mcp.oauthBegin("generated-static", fixture.sessionId);
    const state = await sdk.mcp.oauthStatus(login.id!);
    assert.equal(new URL(state.url!).searchParams.get("redirect_uri"), redirectUri);
    assert.equal((await fetch(await oauth.callback(state.url!))).status, 200);
    await waitFor(() => sdk.getState().snapshot?.oauthAuthorizations.some((entry) => entry.state === "connected"));
    await sdk.mcp.tools("generated-static", "", 0, fixture.sessionId);
    assert.equal(JSON.stringify(fixture.service.controller.events(0)).includes("generated-confidential-secret"), false);
    assert.equal(JSON.stringify(sdk.getState().snapshot).includes("generated-confidential-secret"), false);
  } finally { sdk.disconnect(); await fixture.close(); await oauth.close(); }
});
test("OAuth keychain failure is explicit and admits neither a browser link nor an MCP fallback", async () => {
  const oauth = await generatedOAuthServer(), fixture = await setupFixture({ platform: { vault: {
    read: async () => { throw new Error("Generated locked keychain."); }, write: async () => { throw new Error("Generated locked keychain."); }, remove: async () => { throw new Error("Generated locked keychain."); },
  } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, mcpServers: [{ id: "generated-locked", name: "Generated locked OAuth", enabled: true, transport: { type: "http", url: oauth.url, auth: "oauth" } }] }, settings.revision);
    await assert.rejects(() => sdk.mcp.oauthBegin("generated-locked", fixture.sessionId), /keychain access failed/);
    assert.equal(fixture.service.controller.snapshot().oauthAuthorizations.at(-1)?.state, "failed");
    assert.equal((await sdk.mcp.oauthStatus(fixture.service.controller.snapshot().oauthAuthorizations.at(-1)!.id)).url, null);
    await assert.rejects(() => sdk.mcp.tools("generated-locked", "", 0, fixture.sessionId), /keychain access failed/);
    assert.equal(oauth.stats().mcpRequests, 0);
  } finally { sdk.disconnect(); await fixture.close(); await oauth.close(); }
});
test("unconfirmed token cleanup stays unusable until explicit clear, which also releases shutdown ownership", { timeout: 20_000 }, async () => {
  class UncertainVault extends Vault {
    uncertain = false;
    override async write(id: string, value: string) {
      if (this.uncertain) throw new Error("Generated unconfirmed cleanup.");
      await super.write(id, value);
      if (value.includes("access_token")) { this.uncertain = true; throw new Error("Generated unacknowledged native write."); }
    }
  }
  const oauth = await generatedOAuthServer(), vault = new UncertainVault(), fixture = await setupFixture({ platform: { vault } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, mcpServers: [{ id: "generated-uncertain", name: "Generated uncertain OAuth", enabled: true, transport: { type: "http", url: oauth.url, auth: "oauth" } }] }, settings.revision);
    const login = await sdk.mcp.oauthBegin("generated-uncertain", fixture.sessionId);
    assert.equal((await fetch(await oauth.callback((await sdk.mcp.oauthStatus(login.id!)).url!))).status, 400);
    await waitFor(() => sdk.getState().snapshot?.oauthAuthorizations.find((entry) => entry.id === login.id)?.state === "failed");
    assert.match((await sdk.mcp.oauthStatus(login.id!)).authorization.diagnostic!, /cleanup is unconfirmed/);
    assert.ok([...vault.values.values()].some((value) => value.includes("access_token")));
    await assert.rejects(() => sdk.mcp.tools("generated-uncertain", "", 0, fixture.sessionId), /explicit OAuth login/);
    assert.equal(oauth.stats().mcpRequests, 0);
    await sdk.mcp.oauthClear("generated-uncertain", fixture.sessionId);
    assert.equal(vault.values.size, 0);
    assert.equal((await sdk.mcp.oauthStatus(login.id!)).authorization.state, "cleared");
  } finally { sdk.disconnect(); await fixture.close(); await oauth.close(); }
});
test("cancelling OAuth during keychain setup creates no callback or late registration", { timeout: 20_000 }, async () => {
  class SetupVault extends Vault {
    override async read(_id: string, signal?: AbortSignal): Promise<string | null> {
      return new Promise((_resolve, reject) => { if (signal?.aborted) reject(signal.reason); else signal?.addEventListener("abort", () => reject(signal.reason), { once: true }); });
    }
  }
  const oauth = await generatedOAuthServer(), fixture = await setupFixture({ platform: { vault: new SetupVault() } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, mcpServers: [{ id: "generated-setup", name: "Generated setup cancellation", enabled: true, transport: { type: "http", url: oauth.url, auth: "oauth" } }] }, settings.revision);
    const begin = sdk.mcp.oauthBegin("generated-setup", fixture.sessionId).then(() => "", (error: unknown) => error instanceof Error ? error.message : "Generated unknown error");
    const login = await waitFor(() => sdk.getState().snapshot?.oauthAuthorizations.find((entry) => entry.serverId === "generated-setup"));
    assert.equal((await sdk.mcp.oauthStatus(login.id)).url, null);
    await sdk.mcp.oauthCancel(login.id);
    assert.match(await begin, /cancelled before a callback/);
    assert.equal((await sdk.mcp.oauthStatus(login.id)).authorization.state, "cancelled");
    assert.deepEqual(oauth.stats(), { exchanges: 0, refreshes: 0, mcpRequests: 0 });
  } finally { sdk.disconnect(); await fixture.close(); await oauth.close(); }
});
