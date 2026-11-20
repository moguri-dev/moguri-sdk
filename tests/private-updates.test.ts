import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { generatedApplication, generatedUpdateFeed } from "./fixtures/updates.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("a saved update token is used only for the GitHub API, stripped on asset redirects and stage exact original bundle bytes", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(); await fixture.service.close();
  const generated = await generatedApplication(join(fixture.directory, "release")), values = new Map<string, string>(), { fetcher, requests } = generatedUpdateFeed(generated);
  const vault = { read: async (id: string) => values.get(id) ?? null, write: async (id: string, value: string) => { values.set(id, value); }, remove: async (id: string) => { values.delete(id); } };
  const token = `ghp_${"g".repeat(30)}`;
  let quarantined = 0;
  const service = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
    updates: { version: "0.30.0-alpha.1", arch: "arm64", vault, fetch: fetcher, quarantine: async () => { quarantined++; } } });
  const sdk = await new MoguriSdk(service.connection).ready(), global = service.store.view("_global");
  try {
    await sdk.application.updates.setToken(token);
    assert.equal(values.get("private-github-release"), token);
    const started = await sdk.application.updates.check(false, "generated-private-update-command");
    const completed = await waitFor(() => {
      const value = service.application.updates.read(started.id!);
      if (["failed", "partial", "cancelled"].includes(value.status)) throw new Error(value.diagnostic!);
      return value.status === "ready" ? value : null;
    });
    assert.equal(completed.release?.repositoryId, 42); assert.equal(completed.release?.archiveAssetId, 202);
    assert.equal(quarantined, 1); assert.equal((await sdk.application.updates.status()).update.installable, false);
    assert.ok(requests.filter((request) => request.url.startsWith("https://api.github.com/")).every((request) => request.authorization === `Bearer ${token}`));
    assert.ok(requests.filter((request) => !request.url.startsWith("https://api.github.com/")).every((request) => request.authorization === null));
    assert.equal(JSON.stringify(global.events()).includes(token), false);
    await assert.rejects(() => sdk.application.updates.installPreview(started.id!), /unpackaged|owned.*application|unqualified/i);
    global.db.prepare("DELETE FROM receipts WHERE id='generated-private-update-command'").run();
    const count = requests.length;
    await assert.rejects(() => sdk.application.updates.check(false, "generated-private-update-command"), /retained|replay/i);
    assert.equal(requests.length, count); assert.equal(fixture.requests.length, 0);
  } finally { global.close(); sdk.disconnect(); await service.close(); await fixture.close(); }
});

test("without a saved token, updates stage exact public release bytes and never send a credential", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(); await fixture.service.close();
  const generated = await generatedApplication(join(fixture.directory, "release")), feed = generatedUpdateFeed(generated, "public");
  let quarantined = 0;
  const service = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
    updates: { version: "0.30.0-alpha.1", arch: "arm64", vault: { read: async () => null, write: async () => {}, remove: async () => {} }, fetch: feed.fetcher, quarantine: async () => { quarantined++; } } });
  const sdk = await new MoguriSdk(service.connection).ready();
  try {
    const admitted = await sdk.application.updates.check();
    const ready = await waitFor(() => {
      const value = service.application.updates.read(admitted.id!);
      if (["failed", "partial", "cancelled"].includes(value.status)) throw new Error(value.diagnostic!);
      return value.status === "ready" ? value : null;
    });
    assert.equal(ready.release?.manifest.version, generated.manifest.version); assert.equal(quarantined, 1);
    assert.match(ready.diagnostic!, /public releases without a token/);
    assert.equal((await sdk.application.updates.status()).update.credential, "missing");
    assert.deepEqual(feed.requests.map((request) => request.authorization), feed.requests.map(() => null));
    assert.ok(feed.requests.some((request) => request.url.startsWith("https://release-assets.githubusercontent.com/")));
  } finally { sdk.disconnect(); await service.close(); await fixture.close(); }
});

test("anonymous checks of a private or rate-limited upstream fail with the next step and stage nothing", { skip: process.platform !== "darwin" }, async () => {
  for (const mode of ["private", "rate-limited"] as const) {
    const fixture = await setupFixture(); await fixture.service.close();
    const generated = await generatedApplication(join(fixture.directory, "release")), feed = generatedUpdateFeed(generated, mode === "private" ? "private" : "public");
    const fetcher: typeof fetch = async (input, init) => mode === "rate-limited"
      ? (feed.requests.push({ url: String(input), authorization: null }), Response.json({ message: "API rate limit exceeded" }, { status: 403, headers: { "x-ratelimit-remaining": "0" } }))
      : feed.fetcher(input, init);
    const service = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
      updates: { version: "0.30.0-alpha.1", arch: "arm64", vault: { read: async () => null, write: async () => {}, remove: async () => {} }, fetch: fetcher, quarantine: async () => { throw new Error("Nothing may be staged."); } } });
    const sdk = await new MoguriSdk(service.connection).ready();
    try {
      const admitted = await sdk.application.updates.check();
      const failure = await waitFor(() => { const value = service.application.updates.read(admitted.id!); return value.status === "failed" ? value : null; });
      assert.equal(failure.stagedBundle, null); assert.equal(failure.release, null);
      assert.match(failure.diagnostic!, mode === "private" ? /private, save a read-only update token/ : /anonymous rate limit/);
      assert.deepEqual(feed.requests.map((request) => request.url), ["https://api.github.com/repos/mbianchidev/moguri"]);
    } finally { sdk.disconnect(); await service.close(); await fixture.close(); }
  }
});

test("foreign redirects, corrupt assets, leaked-token errors and an unreadable saved token never stage code or fall back to anonymous access", { skip: process.platform !== "darwin" }, async () => {
  for (const mode of ["redirect", "digest", "secret-error", "vault-error"] as const) {
    const fixture = await setupFixture(); await fixture.service.close();
    const generated = await generatedApplication(join(fixture.directory, "release")), feed = generatedUpdateFeed(generated), token = `ghp_${"g".repeat(30)}`;
    let quarantined = 0;
    const service = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
      updates: { version: "0.30.0-alpha.1", arch: "arm64", vault: { read: async () => { if (mode === "vault-error") throw new Error("Generated keychain failure."); return token; }, write: async () => {}, remove: async () => {} },
        quarantine: async () => { quarantined++; }, fetch: async (input, init) => {
          const url = String(input);
          if (mode === "redirect" && url.endsWith("/assets/202")) return new Response(null, { status: 302, headers: { Location: "https://generated.invalid/no-credential" } });
          if (mode === "digest" && url.startsWith("https://release-assets.githubusercontent.com/")) { const bytes = new Uint8Array(generated.archive); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1; return new Response(bytes); }
          if (mode === "secret-error") throw new Error(`Generated backend error echoed ${token}`);
          return feed.fetcher(input, init);
        } } });
    const sdk = await new MoguriSdk(service.connection).ready(), global = service.store.view("_global");
    try {
      const admitted = await sdk.application.updates.check();
      const failure = await waitFor(() => { const value = service.application.updates.read(admitted.id!); return value.status === "failed" ? value : null; });
      assert.equal(failure.stagedBundle, null); assert.equal(quarantined, 0);
      if (mode === "secret-error") assert.equal(failure.diagnostic!.includes(token), false);
      if (mode === "vault-error") assert.equal(feed.requests.length, 0);
      assert.equal(JSON.stringify(global.events()).includes(token), false); assert.equal(fixture.requests.length, 0);
    } finally { global.close(); sdk.disconnect(); await service.close(); await fixture.close(); }
  }
});

test("actual cancellation and restart retain original update work without replay, and automatic checks honor the current root flag", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(); await fixture.service.close();
  const generated = await generatedApplication(join(fixture.directory, "release")), feed = generatedUpdateFeed(generated);
  let waiting = false;
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/assets/202")) { waiting = true; return new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) reject(new DOMException("Generated owned update cancelled.", "AbortError"));
      else init?.signal?.addEventListener("abort", () => reject(new DOMException("Generated owned update cancelled.", "AbortError")), { once: true });
    }); }
    return feed.fetcher(input, init);
  };
  const options = { stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
    updates: { version: "0.30.0-alpha.1", arch: "arm64" as const, vault: { read: async () => `ghp_${"g".repeat(30)}`, write: async () => {}, remove: async () => {} }, quarantine: async () => {}, fetch: fetcher } };
  let service = await startService(options), sdk = await new MoguriSdk(service.connection).ready();
  try {
    const config = (await sdk.application.status()).configuration;
    await sdk.application.configure({ automaticUpdates: false }, config.revision);
    await assert.rejects(() => sdk.application.updates.check(true), /disabled/); assert.equal(feed.requests.length, 0);
    const admitted = await sdk.application.updates.check(false, "generated-cancelled-update"); await waitFor(() => waiting);
    await sdk.application.updates.cancel(admitted.id!);
    await waitFor(() => service.application.updates.read(admitted.id!).status === "cancelled");
    const requests = feed.requests.length;
    sdk.disconnect(); await service.close(); service = await startService(options); sdk = await new MoguriSdk(service.connection).ready();
    assert.equal((await sdk.application.updates.read(admitted.id!)).update.status, "cancelled");
    assert.equal((await sdk.application.updates.check(false, "generated-cancelled-update")).id, admitted.id);
    assert.equal(feed.requests.length, requests);
  } finally { sdk.disconnect(); await service.close(); await fixture.close(); }
});
