import assert from "node:assert/strict";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { resolveReleaseRepository } from "../apps/service/src/updates.ts";
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

test("updates follow GitHub's single ID redirect and stage releases that name the pre-transfer repository", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(); await fixture.service.close();
  const generated = await generatedApplication(join(fixture.directory, "release")), token = `ghp_${"g".repeat(30)}`;
  generated.manifest = { ...generated.manifest, repository: "mbianchidev/moguri" }; generated.manifestBytes = Buffer.from(JSON.stringify(generated.manifest));
  const feed = generatedUpdateFeed(generated, "private", "mbianchidev/moguri");
  const service = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
    updates: { version: "0.30.0-alpha.1", arch: "arm64", vault: { read: async () => token, write: async () => {}, remove: async () => {} }, fetch: feed.fetcher, quarantine: async () => {} } });
  const sdk = await new MoguriSdk(service.connection).ready();
  try {
    const admitted = await sdk.application.updates.check();
    const ready = await waitFor(() => {
      const value = service.application.updates.read(admitted.id!);
      if (["failed", "partial", "cancelled"].includes(value.status)) throw new Error(value.diagnostic!);
      return value.status === "ready" ? value : null;
    });
    assert.equal(ready.release?.repositoryId, 42); assert.equal(ready.release?.manifest.repository, "mbianchidev/moguri");
    assert.deepEqual(feed.requests.slice(0, 3).map((request) => request.url), [feed.original, feed.base, `${feed.base}/releases?per_page=10`]);
    assert.ok(feed.requests.filter((request) => request.url.startsWith("https://api.github.com/")).every((request) => request.authorization === `Bearer ${token}`));
    assert.ok(feed.requests.filter((request) => !request.url.startsWith("https://api.github.com/")).every((request) => request.authorization === null));
  } finally { sdk.disconnect(); await service.close(); await fixture.close(); }
});

test("release repository resolution rejects foreign redirects and unknown names without forwarding the token", async () => {
  const token = `ghp_${"g".repeat(30)}`, original = "https://api.github.com/repos/moguri-dev/moguri";
  const cases: Array<{ name: string; location?: string | null; fullName?: string; id?: number }> = [
    { name: "another repository path", location: "https://api.github.com/repos/generated-owner/generated-fork" },
    { name: "another origin", location: "https://generated.invalid/repositories/42" },
    { name: "a query on the alias", location: "https://api.github.com/repositories/42?generated=1" },
    { name: "a redirect without a location", location: null },
    { name: "a mismatched repository ID", location: "https://api.github.com/repositories/42", id: 43 },
    { name: "an unknown repository name", fullName: "generated-owner/moguri-fork" },
  ];
  for (const entry of cases) {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input); requests.push({ url, authorization: new Headers(init?.headers).get("Authorization") });
      if (url === original && entry.location !== undefined) return new Response(null, { status: 301, headers: entry.location ? { Location: entry.location } : {} });
      return Response.json({ id: entry.id ?? 42, full_name: entry.fullName ?? "mbianchidev/moguri", private: true });
    };
    await assert.rejects(() => resolveReleaseRepository(fetcher, token, AbortSignal.timeout(5_000)), /known Moguri release repository|somewhere other than its own repository ID/, entry.name);
    assert.ok(requests.every((request) => request.url.startsWith("https://api.github.com/")), entry.name);
  }
  const moved = await resolveReleaseRepository(async (input) => String(input) === original
    ? new Response(null, { status: 301, headers: { Location: "https://api.github.com/repositories/42" } })
    : Response.json({ id: 42, full_name: "MBianchiDev/Moguri", private: false }), null, AbortSignal.timeout(5_000));
  assert.deepEqual(moved, { id: 42, fullName: "MBianchiDev/Moguri", base: "https://api.github.com/repositories/42" });
});

test("a Homebrew-managed app reports newer releases without downloading and never replaces itself", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(); await fixture.service.close();
  const generated = await generatedApplication(join(fixture.directory, "release")), feed = generatedUpdateFeed(generated, "public");
  const installed = await generatedApplication(join(fixture.directory, "Applications"), "0.30.0-alpha.1"), prefix = join(fixture.directory, "homebrew");
  const service = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
    updates: { version: "0.30.0-alpha.1", arch: "arm64", installationRoot: await realpath(installed.root), homebrewPrefixes: [prefix],
      vault: { read: async () => null, write: async () => {}, remove: async () => {} }, fetch: feed.fetcher, quarantine: async () => {} } });
  const sdk = await new MoguriSdk(service.connection).ready();
  const settled = (id: string, status: string) => waitFor(() => {
    const value = service.application.updates.read(id);
    if (["failed", "partial", "cancelled"].includes(value.status)) throw new Error(value.diagnostic!);
    return value.status === status ? value : null;
  });
  try {
    const before = await sdk.application.updates.check(false, "generated-before-homebrew");
    await settled(before.id!, "ready");
    assert.deepEqual([(await sdk.application.updates.status()).update.manager, (await sdk.application.updates.status()).update.installable], [null, true]);
    await mkdir(join(prefix, "Caskroom", "moguri"), { recursive: true });
    await assert.rejects(() => sdk.application.updates.installPreview(before.id!), /brew upgrade --cask moguri/);
    const status = (await sdk.application.updates.status()).update;
    assert.equal(status.manager, "homebrew"); assert.equal(status.installable, false); assert.match(status.diagnostic!, /brew upgrade --cask moguri/);
    const requests = feed.requests.length, after = await sdk.application.updates.check(false, "generated-homebrew-check");
    const reported = await settled(after.id!, "completed");
    assert.match(reported.diagnostic!, new RegExp(`Moguri ${generated.manifest.version} is available.*brew upgrade --cask moguri.*Nothing was downloaded`));
    assert.equal(reported.stagedBundle, null);
    assert.deepEqual(feed.requests.slice(requests).map((request) => request.url), [feed.original, `${feed.base}/releases?per_page=10`]);
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
      assert.deepEqual(feed.requests.map((request) => request.url), ["https://api.github.com/repos/moguri-dev/moguri"]);
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
