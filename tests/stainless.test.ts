import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, realpath, rm, symlink, utimes, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright-core";
import { executeStainlessCommand, MoguriSdk, PROTOCOL_VERSION, STAINLESS_TESTED_BUILDS, playwrightBrowserNote, type Session } from "../packages/sdk/src/index.ts";
import { StainlessIntegration } from "../apps/service/src/stainless.ts";
import { runOwnedPlaywright } from "../apps/service/src/playwright-data.ts";
import { toolWebTarget } from "../apps/service/src/permissions.ts";
import { EventStore, stainlessIntegrationSchemaMarker } from "../apps/service/src/store.ts";
import { setupFixture } from "./fixture.ts";
import { generatedStainless } from "./fixtures/stainless.ts";
import { removeStainlessIntegrationFixtureMarker } from "./fixtures/legacy-state.ts";

const skip = process.platform !== "darwin";
const session = (env: Session["controls"]["env"]) => ({ id: "generated-session", controls: { env } }) as Session;
async function folder() { return realpath(await mkdtemp(join(tmpdir(), "moguri-stainless-test-"))); }
async function page(body = "Generated Stainless page"): Promise<{ url: string; server: Server }> {
  const server = createServer((request, response) => {
    if (request.url === "/missing") { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<main>${body}</main><script>console.log("generated-console");fetch("/missing")</script>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Generated page did not start.");
  return { url: `http://127.0.0.1:${address.port}/`, server };
}

test("detection reads only Info.plist and distinguishes missing, invalid, untested and tested bundles", { skip }, async () => {
  const root = await folder();
  try {
    const empty = new StainlessIntegration(() => ({ enabled: true, appPath: null }), { applications: [join(root, "none")] });
    assert.equal((await empty.status()).availability, "missing");
    const exact = new StainlessIntegration(() => ({ enabled: true, appPath: join(root, "Elsewhere.app") }), { applications: [root] });
    await generatedStainless(root);
    const missing = await exact.status();
    assert.equal(missing.availability, "missing"); assert.match(missing.diagnostic, /Nothing else was searched/);

    const untested = await new StainlessIntegration(() => ({ enabled: true, appPath: null }), { applications: [root] }).status();
    assert.equal(untested.availability, "found"); assert.equal(untested.tested, false); assert.equal(untested.automation, "needs_check");
    assert.deepEqual({ version: untested.installation?.version, build: untested.installation?.build, chromium: untested.installation?.chromium },
      { version: "0.0.0-generated", build: 1, chromium: "999.0.0.1" });
    assert.equal((await new StainlessIntegration(() => ({ enabled: false, appPath: null }), { applications: [root] }).status()).automation, "off");

    const tested = join(root, "tested"), build = STAINLESS_TESTED_BUILDS[0]!;
    await generatedStainless(tested, { version: build.version, build: build.build, chromium: build.chromium });
    const ready = await new StainlessIntegration(() => ({ enabled: true, appPath: join(tested, "Stainless.app") })).status();
    assert.equal(ready.tested, true); assert.equal(ready.automation, "ready");

    const foreign = join(root, "foreign");
    await generatedStainless(foreign, { bundleId: "org.generated.other" });
    const wrong = await new StainlessIntegration(() => ({ enabled: true, appPath: join(foreign, "Stainless.app") })).status();
    assert.equal(wrong.availability, "invalid"); assert.match(wrong.diagnostic, /is not Stainless/);

    const linked = join(root, "linked"), app = await generatedStainless(linked), executable = join(app, "Contents/MacOS/Stainless");
    await rename(executable, join(linked, "real-stainless")); await symlink(join(linked, "real-stainless"), executable);
    const symlinked = await new StainlessIntegration(() => ({ enabled: true, appPath: app })).status();
    assert.equal(symlinked.availability, "invalid"); assert.match(symlinked.diagnostic, /regular Stainless executable/);
    assert.equal((await new StainlessIntegration(() => ({ enabled: true, appPath: null }), { platform: "linux" }).status()).supported, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a compatibility check launches one owned headless instance, gates agent use and expires when the bundle changes", { skip, timeout: 90_000 }, async () => {
  const root = await folder();
  try {
    const app = await generatedStainless(root), integration = new StainlessIntegration(() => ({ enabled: true, appPath: app }));
    assert.equal(await integration.agentExecutable(), undefined, "an untested build needs a passing check first");
    const first = integration.check(), second = integration.check();
    assert.equal(first, second, "concurrent checks share one launch");
    const checked = await first;
    assert.equal(checked.check?.outcome, "passed", checked.check?.diagnostic ?? "");
    assert.equal(checked.automation, "ready"); assert.ok(checked.check!.reportedVersion);
    assert.equal(await integration.agentExecutable(), join(app, "Contents/MacOS/Stainless"));

    const later = new Date(Date.now() + 5000);
    await utimes(join(app, "Contents/MacOS/Stainless"), later, later);
    assert.equal((await integration.status()).automation, "needs_check", "a replaced executable does not inherit the earlier check");

    const broken = join(root, "broken"), failing = await generatedStainless(broken, { executable: "fail" });
    const failingIntegration = new StainlessIntegration(() => ({ enabled: true, appPath: failing }));
    const failed = await failingIntegration.check();
    assert.equal(failed.check?.outcome, "failed"); assert.equal(failed.automation, "incompatible"); assert.ok(failed.check?.diagnostic);
    assert.equal(await failingIntegration.agentExecutable(), undefined);
    await assert.rejects(() => new StainlessIntegration(() => ({ enabled: false, appPath: app })).check(), { code: "stainless_disabled" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Open in Stainless hands one URL to the exact bundle and refuses Remote, Sandbox, off and unsafe URLs", { skip }, async () => {
  const root = await folder(), opened: [string, string][] = [];
  try {
    const app = await generatedStainless(root);
    let enabled = false;
    const integration = new StainlessIntegration(() => ({ enabled, appPath: app }), { open: async (path, url) => { opened.push([path, url]); } });
    await assert.rejects(() => integration.open(session("Local"), "http://127.0.0.1:3000/"), { code: "stainless_disabled" });
    enabled = true;
    await assert.rejects(() => integration.open(session("Remote"), "http://127.0.0.1:3000/"), { code: "stainless_env" });
    await assert.rejects(() => integration.open(session("Sandbox"), "http://127.0.0.1:3000/"), { code: "stainless_env" });
    await assert.rejects(() => integration.open(session("Local"), "http://user:secret@127.0.0.1:3000/"), { code: "stainless_url" });
    await assert.rejects(() => integration.open(session("Local"), "http://example.com/"), { code: "stainless_url" });
    await assert.rejects(() => integration.open(undefined, "http://127.0.0.1:3000/"), { code: "session_missing" });
    assert.deepEqual(opened, []);
    await integration.open(session("Local"), "http://127.0.0.1:3000/preview");
    assert.deepEqual(opened, [[app, "http://127.0.0.1:3000/preview"]]);
    const failing = new StainlessIntegration(() => ({ enabled: true, appPath: app }), { open: async () => { throw new Error("generated open failure"); } });
    await assert.rejects(() => failing.open(session("Local"), "http://127.0.0.1:3000/"), { code: "stainless_open" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("owned playwright never launches Stainless without a service-resolved executable and applies website scope to it", async () => {
  const temporary = await folder();
  try {
    await assert.rejects(() => runOwnedPlaywright(temporary, { launch: { kind: "stainless", url: "http://127.0.0.1:9/" }, actions: [{ action: "snapshot" }] }, temporary,
      { version: 1, unrestricted: false, sites: [], origins: ["http://127.0.0.1:9"] }), { code: "stainless_unavailable" });
    await assert.rejects(() => runOwnedPlaywright(temporary, { launch: { kind: "stainless", url: "http://127.0.0.1:9/", executable: "/bin/sh" }, actions: [{ action: "snapshot" }] }, temporary));
    assert.equal(toolWebTarget({ id: "generated", name: "playwright", arguments: { launch: { kind: "stainless", url: "https://generated.example/" }, actions: [] } }), "https://generated.example/");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("an approved model playwright batch launches the configured Stainless and returns bounded diagnostics", { skip, timeout: 90_000 }, async () => {
  const root = await folder(), { url, server } = await page("GENERATED_STAINLESS_MARKER");
  const fixture = await setupFixture({ toolCalls: [{ name: "playwright", args: { launch: { kind: "stainless", url }, actions: [{ action: "snapshot" }, { action: "diagnostics" }] } },
    { name: "playwright", args: { launch: { kind: "stainless", url }, actions: [{ action: "snapshot" }] } }] });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const app = await generatedStainless(root);
    await fixture.configure();
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, integrations: { ...settings.values.integrations!, stainless: { enabled: true, appPath: app } } }, settings.revision);
    assert.equal((await sdk.stainless.check()).automation, "ready");
    await fixture.send("Generated Stainless browser check.");
    await fixture.approve();
    await waitForCompleted(fixture, 1);
    const off = sdk.settings.get()!;
    await sdk.settings.update({ ...off.values, integrations: { ...off.values.integrations!, stainless: { enabled: false, appPath: app } } }, off.revision);
    await fixture.approve();
    const settled = await fixture.terminal();
    const completed = fixture.service.controller.events(0).filter((event) => event.event_type === "tool.completed" && event.payload.call.name === "playwright");
    assert.equal(completed.length, 2, settled.lastError ?? "");
    const [first, second] = completed.map((event) => event.event_type === "tool.completed" ? event.payload : null);
    assert.equal(first?.outcome, "completed", first?.text ?? "");
    assert.match(first!.text, /GENERATED_STAINLESS_MARKER/); assert.match(first!.text, /generated-console/); assert.match(first!.text, /"status":404/);
    assert.match(first!.text, /disposable profile/);
    assert.equal(second?.isError, true); assert.match(second!.text, /Stainless is not turned on/);
  } finally { sdk.disconnect(); await fixture.close(); server.close(); await rm(root, { recursive: true, force: true }); }
});

test("while Stainless is on, a chromium launch runs in Stainless or fails before launching; off keeps the requested Chromium", { skip, timeout: 90_000 }, async () => {
  const root = await folder(), { url, server } = await page("GENERATED_DEFAULT_MARKER"), requests: string[] = [];
  server.on("request", (request) => requests.push(request.url ?? ""));
  try {
    const app = await generatedStainless(root), stainless = join(app, "Contents/MacOS/Stainless");
    const requested = join(await generatedStainless(join(root, "requested"), { executable: "fail" }), "Contents/MacOS/Stainless");
    const access = { version: 1 as const, unrestricted: false, sites: [], origins: [new URL(url).origin] };
    const input = (executable: string) => ({ launch: { kind: "chromium", executable, url }, actions: [{ action: "snapshot" }] });
    const profile = async (name: string) => { const path = join(root, name); await mkdir(path, { mode: 0o700 }); return path; };
    await assert.rejects(() => runOwnedPlaywright(root, input(requested), "/generated-never-used", access, undefined, true),
      (error: Error & { code?: string }) => error.code === "stainless_unavailable" && /no other Chromium was used instead/.test(error.message));
    assert.deepEqual(requests, [], "a Stainless that is on but not ready fails before any launch or page request");
    const ran = await runOwnedPlaywright(root, input(requested), await profile("default"), access, stainless, true);
    assert.equal(ran.outcome, "completed", ran.diagnostic ?? ""); assert.equal(ran.browser, "Stainless"); assert.ok(ran.reportedVersion);
    assert.match(String(ran.stainlessDefault), /instead of the requested executable/); assert.match(JSON.stringify(ran.observations), /GENERATED_DEFAULT_MARKER/);
    const off = await runOwnedPlaywright(root, input(chromium.executablePath()), await profile("off"), access, stainless);
    assert.equal(off.outcome, "completed", off.diagnostic ?? ""); assert.equal(off.browser, "Chromium");
    assert.equal(off.reportedVersion, undefined); assert.equal(off.stainlessDefault, undefined);
    const call = { name: "playwright", arguments: input(requested) };
    assert.match(playwrightBrowserNote(call, { enabled: true, appPath: null }) ?? "", /Stainless is on, so this runs in a new headless Stainless/);
    assert.match(playwrightBrowserNote(call, { enabled: false, appPath: null }) ?? "", /exact Chromium executable/);
    assert.equal(playwrightBrowserNote({ name: "playwright", arguments: { launch: { kind: "electron", executable: requested, entry: "." } } }, { enabled: true, appPath: null }), null);
  } finally { server.close(); await rm(root, { recursive: true, force: true }); }
});

test("an approved model chromium batch uses a ready Stainless by default, refuses a Stainless that is not ready and is unchanged when off", { skip, timeout: 120_000 }, async () => {
  const root = await folder(), { url, server } = await page("GENERATED_MODEL_DEFAULT_MARKER");
  const requested = join(await generatedStainless(join(root, "requested"), { executable: "fail" }), "Contents/MacOS/Stainless");
  const batch = (executable: string) => ({ name: "playwright", args: { launch: { kind: "chromium", executable, url }, actions: [{ action: "snapshot" }] } });
  const fixture = await setupFixture({ toolCalls: [batch(requested), batch(requested), batch(chromium.executablePath())] });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const stainless = async (enabled: boolean, appPath: string) => {
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, integrations: { ...settings.values.integrations!, stainless: { enabled, appPath } } }, settings.revision);
  };
  try {
    const build = STAINLESS_TESTED_BUILDS[0]!;
    const ready = await generatedStainless(join(root, "ready"), { version: build.version, build: build.build, chromium: build.chromium });
    const untested = await generatedStainless(join(root, "untested"));
    await fixture.configure();
    await stainless(true, ready);
    assert.equal((await sdk.stainless.status()).automation, "ready");
    await fixture.send("Generated default Stainless browser check.");
    await fixture.approve();
    await waitForCompleted(fixture, 1);
    await stainless(true, untested);
    assert.equal((await sdk.stainless.status()).automation, "needs_check");
    await fixture.approve();
    await waitForCompleted(fixture, 2);
    await stainless(false, untested);
    await fixture.approve();
    const settled = await fixture.terminal();
    const completed = fixture.service.controller.events(0).flatMap((event) => event.event_type === "tool.completed" && event.payload.call.name === "playwright" ? [event.payload] : []);
    assert.equal(completed.length, 3, settled.lastError ?? "");
    const [ranStainless, refused, unchanged] = completed;
    assert.equal(ranStainless?.outcome, "completed", ranStainless?.text ?? "");
    assert.match(ranStainless!.text, /"browser":"Stainless"/); assert.match(ranStainless!.text, /GENERATED_MODEL_DEFAULT_MARKER/);
    assert.equal(refused?.isError, true); assert.match(refused!.text, /Stainless is turned on .* not installed and ready/);
    assert.equal(unchanged?.outcome, "completed", unchanged?.text ?? ""); assert.match(unchanged!.text, /"browser":"Chromium"/);
  } finally { sdk.disconnect(); await fixture.close(); server.close(); await rm(root, { recursive: true, force: true }); }
});
async function waitForCompleted(fixture: Awaited<ReturnType<typeof setupFixture>>, count: number) {
  for (let attempt = 0; attempt < 600; attempt++) {
    if (fixture.service.controller.events(0).filter((event) => event.event_type === "tool.completed" && event.payload.call.name === "playwright").length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The generated Stainless tool call did not complete.");
}

test("SDK, settings and the shared /stainless command keep Stainless off by default and validate locations", { skip }, async () => {
  const root = await folder(), opened: string[] = [];
  const fixture = await setupFixture({ platform: { stainless: { applications: [join(root, "none")], open: async (_app, url) => { opened.push(url); } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const initial = await sdk.stainless.status();
    assert.equal(initial.enabled, false); assert.equal(initial.availability, "missing"); assert.equal(initial.automation, "off");
    const settings = sdk.settings.get()!;
    await assert.rejects(() => sdk.settings.update({ ...settings.values, integrations: { ...settings.values.integrations!, stainless: { enabled: true, appPath: "relative/Stainless.app" } } }, settings.revision), /exact absolute Stainless.app/);
    const app = await generatedStainless(root);
    await sdk.settings.update({ ...settings.values, integrations: { ...settings.values.integrations!, stainless: { enabled: true, appPath: app } } }, settings.revision);
    const status = await executeStainlessCommand(sdk, "status");
    assert.ok("summary" in status); assert.match(status.summary, /untested/);
    await assert.rejects(() => executeStainlessCommand(sdk, "open"), /Choose the session/);
    await assert.rejects(() => executeStainlessCommand(sdk, "open", fixture.sessionId), /Give a preview URL/);
    await assert.rejects(() => executeStainlessCommand(sdk, "launch"), /Use status, check, or open/);
    assert.deepEqual(await executeStainlessCommand(sdk, "open http://127.0.0.1:4173/", fixture.sessionId), { opened: "http://127.0.0.1:4173/", sessionId: fixture.sessionId });
    assert.deepEqual(opened, ["http://127.0.0.1:4173/"]);
    assert.equal(fixture.requests.length, 0, "no Stainless action calls a model");
  } finally { sdk.disconnect(); await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

for (const change of ["upgrade", "missing", "premature", "history"] as const) {
  test(`Stainless integration schema ${change} preserves original state`, { timeout: 30_000 }, async () => {
    const f = await setupFixture();
    try {
      if (change === "history") {
        const sdk = await new MoguriSdk(f.service.connection).ready();
        const settings = sdk.settings.get()!;
        await sdk.settings.update({ ...settings.values, integrations: { ...settings.values.integrations!, stainless: { enabled: true, appPath: null } } }, settings.revision);
        sdk.disconnect();
      }
      await f.service.close();
      const path = f.service.store.path, raw = new DatabaseSync(path);
      try {
        if (change === "history") assert.throws(() => removeStainlessIntegrationFixtureMarker(new DatabaseSync(":memory:"), f.service.controller.events(0)), /genuine pre-111 history/);
        else if (change === "upgrade") removeStainlessIntegrationFixtureMarker(raw, f.service.controller.events(0));
        raw.exec(change === "missing" ? `DELETE FROM retention_metadata WHERE id='${stainlessIntegrationSchemaMarker}'` :
          change === "history" ? `DELETE FROM retention_metadata WHERE id='${stainlessIntegrationSchemaMarker}'; PRAGMA user_version=110` : "PRAGMA user_version=110");
      } finally { raw.close(); }
      if (change === "upgrade") {
        const reopened = new EventStore(path, f.retentionKey);
        try {
          assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
          assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(stainlessIntegrationSchemaMarker)?.value, "1");
        } finally { reopened.close(); }
        return;
      }
      assert.throws(() => new EventStore(path, f.retentionKey),
        change === "missing" ? /Missing or invalid Stainless integration schema marker/ : change === "premature" ? /Premature Stainless integration schema marker/ : /pre-111 lineage/);
    } finally { await f.close(); }
  });
}
