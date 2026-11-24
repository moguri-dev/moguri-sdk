import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { MoguriSdk, webAccessAllows } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture } from "./fixture.ts";
import { profileFixture } from "./fixtures/profiles.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("SDK website allowances retain original scope, reject stale writes and survive restart without requests", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined;
  try {
    const originalRevision = sdk.settings.get()!.revision;
    await sdk.webAllowlist.add("global.example.invalid", { kind: "global" });
    await sdk.webAllowlist.add("project.example.invalid", { kind: "project", projectId: fixture.session().projectId });
    await sdk.webAllowlist.add("https://session.example.invalid:8443", { kind: "session", sessionId: fixture.sessionId });
    assert.equal(sdk.webAllowlist.list(fixture.sessionId).length, 3);
    const original = structuredClone(sdk.webAllowlist.list());
    await assert.rejects(() => sdk.webAllowlist.remove(original[0]!.id, originalRevision), { code: "revision_conflict" });
    await assert.rejects(() => sdk.webAllowlist.add("global.example.invalid", { kind: "global" }), { code: "web_allowlist_rule" });
    assert.throws(() => sdk.webAllowlist.add("foreign.example.invalid", { kind: "project", projectId: "generated-foreign-project" }), { code: "web_allowlist_scope" });
    const current = sdk.settings.get()!;
    await assert.rejects(() => sdk.settings.update({ ...current.values, permissions: { ...current.values.permissions,
      webAllowlist: [...original, { id: "generated-foreign-session", site: "foreign.example.invalid", scope: { kind: "session", sessionId: "generated-foreign-session" } }] } }, current.revision), { code: "web_allowlist_scope" });
    assert.deepEqual(sdk.webAllowlist.list(), original);
    const other = await sdk.sessions.create(null, "Generated project-free website scope");
    assert.deepEqual(sdk.webAllowlist.list(other.id!).map((entry) => entry.site), ["global.example.invalid"]);
    assert.equal(fixture.requests.length, 0);
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
      platform: { terminal: { defaultRoot: fixture.home, vault: fixture.terminalVault } } });
    peer = await new MoguriSdk(restarted.connection).ready();
    assert.deepEqual(peer.webAllowlist.list(), original);
    await peer.webAllowlist.remove(original[1]!.id);
    assert.equal(peer.webAllowlist.list(fixture.sessionId).length, 2);
    assert.equal(fixture.requests.length, 0);
  } finally { peer?.disconnect(); sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("global Local allowances are profile-owned, never shared through root-owned global defaults", async () => {
  const fixture = await profileFixture();
  try {
    await fixture.sdk.webAllowlist.add("default.example.invalid", { kind: "global" });
    const { client } = await fixture.create("Generated independent web profile");
    assert.deepEqual(client.webAllowlist.list(), []);
    await client.webAllowlist.add("other.example.invalid", { kind: "global" });
    assert.deepEqual(fixture.sdk.webAllowlist.list().map((entry) => entry.site), ["default.example.invalid"]);
    assert.deepEqual(client.webAllowlist.list().map((entry) => entry.site), ["other.example.invalid"]);
    assert.equal(fixture.providers.reduce((sum, provider) => sum + provider.requests.length, 0), 0);
  } finally { await fixture.close(); }
});

test("shared service browser admission carries the exact allowed scope and removing a rule revokes dispatched work", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const owner = { sessionId: fixture.sessionId, hostId: "generated-website-owner", lease: "ac".repeat(32) };
  try {
    await sdk.webAllowlist.add("allowed.example.invalid", { kind: "session", sessionId: fixture.sessionId });
    await sdk.browser.host.attach(owner); await sdk.browser.host.control(owner, 1, true);
    const controlId = (await sdk.browser.state(fixture.sessionId)).browser.controlId!;
    const definition = (await sdk.mcp.tools("builtin", "browser_navigate", 0, fixture.sessionId)).tools.find((entry) => entry.name === "browser_navigate")!;
    const started = await sdk.mcp.call(fixture.sessionId, "builtin", definition.name, { controlId, url: "https://allowed.example.invalid/generated" }, definition.digest);
    assert.equal(fixture.session().pendingApproval, null);
    let request = (await sdk.browser.host.poll(owner, "", "")).request;
    const deadline = Date.now() + ciTime(5000);
    while (!request && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 15));
      request = (await sdk.browser.host.poll(owner, "", "")).request;
    }
    assert.ok(request);
    assert.equal(webAccessAllows(request.webAccess, "https://allowed.example.invalid/next"), true);
    assert.equal(webAccessAllows(request.webAccess, "https://unreviewed.example.invalid/next"), false);
    assert.equal(request.webAccess.unrestricted, false);
    const decision = fixture.service.controller.events(0).find((event) => event.event_type === "tool.decided");
    assert.ok(decision?.event_type === "tool.decided"); assert.equal(decision.payload.actor, "policy");
    await sdk.webAllowlist.remove(sdk.webAllowlist.list()[0]!.id);
    assert.equal((await sdk.browser.state(fixture.sessionId)).browser.controlId, null);
    const job = await sdk.jobs.wait(started.id!);
    assert.notEqual(job.status, "completed");
    await assert.rejects(() => sdk.browser.host.reply(owner, request.id, { text: "Generated stale success", outcome: "completed" }), { code: "browser_reply_stale" });
    assert.equal((await sdk.browser.host.poll(owner, "", "")).request, null);
    assert.equal(fixture.requests.length, 0);
  } finally { await sdk.browser.host.detach(owner); sdk.disconnect(); await fixture.close(); }
});

test("malformed website requests fail before consuming an approval, job or website scope", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const tool = (await sdk.tools.catalog(fixture.sessionId, "web_fetch")).tools.find((entry) => entry.name === "web_fetch")!;
    const originalJobs = fixture.service.controller.snapshot().jobs.length;
    await assert.rejects(() => sdk.tools.execute(fixture.sessionId, tool.name, { url: "not-an-absolute-website" }, tool.schemaDigest), { code: "web_destination" });
    assert.equal(fixture.session().pendingApproval, null);
    assert.equal(fixture.service.controller.snapshot().jobs.length, originalJobs);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
