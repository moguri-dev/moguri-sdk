import test from "node:test";
import assert from "node:assert/strict";
import { BrowserBroker } from "../apps/service/src/browser.ts";
import { BROWSER_MCP_TOOLS, MoguriSdk, browserUrl, type Snapshot, type WebAccess } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { startService } from "../apps/service/src/server.ts";
import { join } from "node:path";
import { profileFixture } from "./fixtures/profiles.ts";
const generatedWebAccess: WebAccess = { version: 1, unrestricted: false, sites: ["example.invalid"], origins: [] };
const generatedPage = "https://example.invalid/generated";

async function setupBrowser(timeout = 1000) {
  const fixture = await setupFixture();
  let snapshot: Snapshot = fixture.service.controller.snapshot();
  const broker = new BrowserBroker(() => snapshot, timeout);
  const owner = { sessionId: fixture.sessionId, hostId: "generated-browser-host", lease: "ab".repeat(32) };
  broker.command({ type: "browser.host.attach", ...owner });
  const poll = () => {
    const result = broker.query({ type: "browser.host.poll", ...owner, url: "https://example.invalid/generated", title: "Generated private title" });
    if (result.type !== "browser.host.poll") throw new Error("Generated browser poll returned another response.");
    return result;
  };
  const enable = (sequence = 1) => {
    poll();
    broker.command({ type: "browser.host.control", ...owner, sequence, enabled: true });
    return broker.state(owner.sessionId).controlId!;
  };
  return { fixture, broker, owner, poll, enable, change: (change: (snapshot: Snapshot) => Snapshot) => { snapshot = change(snapshot); broker.synchronize(); },
    close: async () => { broker.close(); await fixture.close(); } };
}

test("browser control starts off and status discloses no private page data until enabled", async () => {
  const owned = await setupBrowser();
  try {
    owned.poll();
    assert.equal(owned.broker.state(owned.owner.sessionId).controlId, null);
    const result = await owned.broker.call(owned.owner.sessionId, "browser_status", {}, new AbortController().signal);
    const status = JSON.parse(result.text);
    assert.equal(status.url, null); assert.equal(status.title, ""); assert.equal(status.available, true);
    const denied = await owned.broker.call(owned.owner.sessionId, "browser_navigate", { controlId: "generated-stale", url: "https://example.invalid/" }, new AbortController().signal);
    assert.equal(denied.outcome, "failed");
    const controlId = owned.enable();
    const visible = JSON.parse((await owned.broker.call(owned.owner.sessionId, "browser_status", {}, new AbortController().signal)).text);
    assert.equal(visible.controlId, controlId); assert.equal(visible.title, "Generated private title");
  } finally { await owned.close(); }
});

test("off/on invalidates old approved calls and a reordered old enable cannot restore control", async () => {
  const owned = await setupBrowser();
  try {
    const old = owned.enable();
    owned.broker.command({ type: "browser.host.control", ...owned.owner, sequence: 3, enabled: false });
    assert.throws(() => owned.broker.command({ type: "browser.host.control", ...owned.owner, sequence: 2, enabled: true }), { code: "browser_control_stale" });
    assert.equal(owned.broker.state(owned.owner.sessionId).controlId, null);
    const current = owned.enable(4); assert.notEqual(current, old);
    const stale = await owned.broker.call(owned.owner.sessionId, "browser_navigate", { controlId: old, url: "https://example.invalid/" }, new AbortController().signal);
    assert.equal(stale.outcome, "failed");
    assert.equal(owned.poll().type, "browser.host.poll");
    assert.equal("request" in owned.poll() && owned.poll().request, null);
  } finally { await owned.close(); }
});

test("cancellation distinguishes undispatched work from possibly dispatched effects and never replays", async () => {
  const owned = await setupBrowser();
  try {
    const controlId = owned.enable();
    for (const dispatched of [false, true]) {
      const abort = new AbortController();
      const pending = owned.broker.call(owned.owner.sessionId, "browser_navigate", { controlId, url: "https://example.invalid/" }, abort.signal, generatedWebAccess);
      const delivered = dispatched ? owned.poll() : null;
      abort.abort();
      assert.equal((await pending).outcome, dispatched ? "partial" : "cancelled");
      const polled = owned.poll();
      assert.ok("request" in polled); assert.equal(polled.request, null);
      if (delivered && "request" in delivered && delivered.request) assert.throws(() => owned.broker.command({
        type: "browser.host.reply", ...owned.owner, requestId: delivered.request!.id, result: { text: "Generated late success", outcome: "completed" },
      }), { code: "browser_reply_stale" });
    }
  } finally { await owned.close(); }
});

test("turning off cancels a pending read and prevents late success or cross-owner results", async () => {
  const owned = await setupBrowser();
  try {
    const controlId = owned.enable();
    const pending = owned.broker.call(owned.owner.sessionId, "browser_snapshot", { controlId, expectedUrl: generatedPage }, new AbortController().signal, generatedWebAccess);
    const polled = owned.poll(); assert.ok("request" in polled && polled.request);
    const request = polled.request;
    assert.throws(() => owned.broker.command({ type: "browser.host.reply", ...owned.owner, lease: "cd".repeat(32),
      requestId: request.id, result: { text: "Generated wrong owner", outcome: "completed" } }), { code: "browser_owner" });
    owned.broker.command({ type: "browser.host.control", ...owned.owner, sequence: 2, enabled: false });
    assert.equal((await pending).outcome, "cancelled");
    assert.throws(() => owned.broker.command({ type: "browser.host.reply", ...owned.owner, requestId: request.id,
      result: { text: "Generated late success", outcome: "completed" } }), { code: "browser_reply_stale" });
  } finally { await owned.close(); }
});

test("scope, mode, Env and allowed-Env changes revoke an exact browser instead of falling back", async () => {
  for (const reason of ["mode", "env", "policy", "workspace", "session"] as const) {
    const owned = await setupBrowser();
    try {
      owned.enable();
      owned.change((snapshot) => reason === "policy" ? { ...snapshot, policy: { ...snapshot.policy, allowedEnvs: ["Remote"] } } :
        { ...snapshot, sessions: reason === "session" ? [] : snapshot.sessions.map((session) => session.id !== owned.owner.sessionId ? session :
          reason === "mode" ? { ...session, mode: "read-only" } : reason === "env" ? { ...session, controls: { ...session.controls, env: "Remote" } } : { ...session, workspaceId: "generated-other-root" }) });
      if (reason === "session") assert.throws(() => owned.broker.state(owned.owner.sessionId), { code: "browser_scope" });
      else assert.equal(owned.broker.state(owned.owner.sessionId).controlId, null);
      assert.throws(() => owned.broker.command({ type: "browser.host.control", ...owned.owner, sequence: 2, enabled: true }));
    } finally { await owned.close(); }
  }
});

test("expired heartbeats, closure and a fresh service do not restore a control grant", async (context) => {
  const owned = await setupBrowser();
  try {
    const snapshot = owned.fixture.service.controller.snapshot();
    context.mock.timers.enable({ apis: ["Date"], now: 100000 });
    const broker = new BrowserBroker(() => snapshot);
    broker.command({ type: "browser.host.attach", ...owned.owner });
    broker.command({ type: "browser.host.control", ...owned.owner, sequence: 1, enabled: true });
    context.mock.timers.tick(7999);
    assert.equal(broker.state(owned.owner.sessionId).available, true);
    context.mock.timers.tick(2);
    assert.equal(broker.state(owned.owner.sessionId).available, false);
    broker.query({ type: "browser.host.poll", ...owned.owner, url: "", title: "" });
    assert.equal(broker.state(owned.owner.sessionId).controlId, null);
    broker.close();
    context.mock.timers.reset();
    const controlId = owned.enable();
    const pending = owned.broker.call(owned.owner.sessionId, "browser_navigate", { controlId, url: "https://example.invalid/" }, new AbortController().signal, generatedWebAccess);
    owned.poll(); owned.broker.close();
    assert.equal((await pending).outcome, "partial");
    const restarted = new BrowserBroker(() => snapshot);
    assert.equal(restarted.state(owned.owner.sessionId).available, false);
    assert.equal(restarted.state(owned.owner.sessionId).controlId, null);
    assert.throws(() => restarted.query({ type: "browser.host.poll", ...owned.owner, url: "", title: "" }), { code: "browser_owner" });
    restarted.close();
  } finally { context.mock.timers.reset(); await owned.close(); }
});

test("browser schemas refuse executable URLs, extra arguments and oversized output", async () => {
  const owned = await setupBrowser();
  try {
    const controlId = owned.enable();
    for (const url of ["file:///generated", "javascript:alert(1)", "http://example.invalid/", "https://generated:secret@example.invalid/"]) assert.throws(() => browserUrl(url));
    assert.throws(() => browserUrl(`https://example.invalid/${"\u20ac".repeat(1000)}`), /canonical browser URL exceeds/);
    await assert.rejects(() => owned.broker.call(owned.owner.sessionId, "browser_navigate", { controlId, url: "https://example.invalid/", javascript: "generated()" }, new AbortController().signal), { code: "browser_arguments" });
    const pending = owned.broker.call(owned.owner.sessionId, "browser_snapshot", { controlId, expectedUrl: generatedPage }, new AbortController().signal, generatedWebAccess);
    const polled = owned.poll(); assert.ok("request" in polled && polled.request);
    const request = polled.request;
    assert.throws(() => owned.broker.command({ type: "browser.host.reply", ...owned.owner, requestId: request.id, result: { text: "\u20ac".repeat(6000), outcome: "completed" } }), { code: "browser_output" });
    owned.broker.cancelSession(owned.owner.sessionId); assert.equal((await pending).outcome, "cancelled");
  } finally { await owned.close(); }
});

test("SDK builtin navigate discovery and exact approved browser dispatch use the shared service without model inference", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const owner = { sessionId: fixture.sessionId, hostId: "generated-sdk-browser", lease: "ef".repeat(32) };
  let attached = false;
  try {
    const discovered = await sdk.query({ type: "mcp.tools", sessionId: fixture.sessionId, serverId: "builtin", query: "navigate", offset: 0 });
    const navigate = discovered.tools.find((tool) => tool.name === "browser_navigate"); assert.ok(navigate);
    assert.equal(BROWSER_MCP_TOOLS.length, 8);
    await sdk.browser.host.attach(owner); attached = true; await sdk.browser.host.control(owner, 1, true);
    const controlId = (await sdk.browser.state(fixture.sessionId)).browser.controlId!;
    const args = { controlId, url: "https://example.invalid/generated" };
    const job = await sdk.command({ type: "mcp.call", sessionId: fixture.sessionId, serverId: "builtin", tool: navigate.name, arguments: args, schemaDigest: navigate.digest });
    assert.ok(fixture.session().pendingApproval); assert.equal(fixture.requests.length, 0);
    const notStarted = await sdk.browser.host.poll(owner, "", ""); assert.equal(notStarted.request, null);
    await fixture.approve();
    let request = (await sdk.browser.host.poll(owner, "", "")).request;
    const deadline = Date.now() + 5000;
    while (!request && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 15));
      request = (await sdk.browser.host.poll(owner, "", "")).request;
    }
    assert.ok(request); assert.equal(request.tool, "browser_navigate"); assert.deepEqual(request.arguments, args);
    await sdk.browser.host.reply(owner, request.id, { text: '{"source":"untrusted-browser-result","generated":true}', outcome: "completed" });
    const completed = await waitFor(() => fixture.service.controller.snapshot().jobs.find((entry) => entry.id === job.id && entry.status === "completed"));
    assert.ok(completed.resultDigest); assert.equal(fixture.requests.length, 0);
    const result = await sdk.query({ type: "result.read", resultId: completed.id, offset: 0, limit: 32768 });
    assert.equal(JSON.parse(result.text).outcome, "completed");
    await sdk.browser.host.control(owner, 2, false);
    assert.equal((await sdk.browser.state(fixture.sessionId)).browser.controlId, null);
  } finally { try { if (attached) await sdk.browser.host.detach(owner); } finally { sdk.disconnect(); await fixture.close(); } }
});

test("actual service restart preserves history but never restores a native browser lease or enabled control", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined;
  const owner = { sessionId: fixture.sessionId, hostId: "generated-restart-browser", lease: "ac".repeat(32) };
  try {
    await sdk.browser.host.attach(owner); await sdk.browser.host.control(owner, 1, true);
    const before = fixture.service.controller.events(0);
    assert.ok((await sdk.browser.state(fixture.sessionId)).browser.controlId);
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    peer = await new MoguriSdk(restarted.connection).ready();
    assert.deepEqual(restarted.controller.events(0).slice(0, before.length), before);
    assert.equal((await peer.browser.state(fixture.sessionId)).browser.available, false);
    assert.equal((await peer.browser.state(fixture.sessionId)).browser.controlId, null);
    await assert.rejects(() => peer!.browser.host.poll(owner, "", ""), { code: "browser_owner" });
    assert.equal(fixture.requests.length, 0);
  } finally { peer?.disconnect(); sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("project-free browser discovery and profile-isolated native leases use the same SDK API", async () => {
  const fixture = await profileFixture();
  try {
    const session = await fixture.sdk.sessions.create(null, "Generated project-free browser");
    const owner = { sessionId: session.id!, hostId: "generated-rootless-browser", lease: "bc".repeat(32) };
    await fixture.sdk.browser.host.attach(owner); await fixture.sdk.browser.host.control(owner, 1, true);
    const tools = await fixture.sdk.query({ type: "mcp.tools", serverId: "builtin", sessionId: session.id!, query: "navigate", offset: 0 });
    assert.ok(tools.tools.some((tool) => tool.name === "browser_navigate"));
    const { client } = await fixture.create("Generated browser isolation");
    await assert.rejects(() => client.browser.state(session.id!), { code: "browser_scope" });
    await assert.rejects(() => client.browser.host.poll(owner, "", ""), { code: "browser_owner" });
    await fixture.sdk.browser.host.detach(owner);
  } finally { await fixture.close(); }
});
