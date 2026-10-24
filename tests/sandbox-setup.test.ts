import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Header } from "tar";
import { test } from "node:test";
import { MoguriSdk, defaultSandboxManagement, type SandboxSetupOperation } from "../packages/sdk/src/index.ts";
import { generatedSandboxDistribution } from "./fixtures/sandbox-distribution.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { readSandboxDistribution, distributionConfiguration } from "../apps/service/src/sandbox-distribution.ts";
import { sandboxInstallerScript } from "../apps/service/src/sandbox-installer.ts";
import { frameDigest } from "../apps/service/src/worker-wire.ts";

const native = { skip: process.platform !== "darwin", timeout: 20_000 };
test("the bundled distribution binds exact image/package bytes and refuses corruption before execution", async () => {
  const generated = await generatedSandboxDistribution();
  try {
    const definition = await readSandboxDistribution(generated.directory, AbortSignal.timeout(5000));
    assert.equal(definition.distribution.protocol, generated.distribution.protocol);
    await writeFile(join(generated.directory, generated.distribution.worker.archive.path), "Generated changed image.");
    await assert.rejects(() => readSandboxDistribution(generated.directory, AbortSignal.timeout(5000)), /SHA-512|size/);
  } finally { await generated.close(); }
});

test("administrator installation uses a fixed side-by-side no-script package and root-private verified bytes, never a user helper", () => {
  const request = { id: "11111111-1111-4111-8111-111111111111", packagePath: "/generated/quoted ' folder/runtime.pkg",
    sha512: "1".repeat(128), version: "0.2.3", destination: "/opt/moguri/sendbox/0.2.3" };
  const script = sandboxInstallerScript(request);
  assert.match(script, /\/usr\/sbin\/installer -pkg/); assert.match(script, /\/usr\/bin\/shasum -a 512/);
  assert.match(script, /\[ ! -L '\/var\/tmp\/dev\.moguri/); assert.equal(script.includes("node "), false);
  assert.equal(script.includes("sudo "), false); assert.equal(script.includes("setup.sh"), false);
  assert.throws(() => sandboxInstallerScript({ ...request, destination: "/usr/local" }), /side-by-side/);
  assert.throws(() => sandboxInstallerScript({ ...request, version: "0.2.3; generated-command" }), /schema/);
});

test("SDK managed setup needs exact explicit review, preserves user defaults, and never imports or qualifies on stale approval", native, async (context) => {
  const generated = await generatedSandboxDistribution(); let imports = 0, installs = 0, probes = 0;
  const fixture = await setupFixture({ platform: { sandbox: { distribution: generated.directory, setup: {
    automatic: false, installed: async () => true, importImage: async () => { imports++; }, install: async () => { installs++; },
  } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  context.mock.method(fixture.service.controller.sandbox, "probe", async () => {
    probes++;
    const config = fixture.service.controller.snapshot().settings.values.sandbox;
    const readiness = { ready: true, configured: true, diagnostic: "Generated managed qualification, no VM executed.",
      configDigest: frameDigest(config), release: config.qualification!.release, workerDigest: config.qualification!.workerDigest, image: config.image };
    fixture.service.controller.sandbox.readiness = readiness; return readiness;
  });
  try {
    const review = (await sdk.sandbox.setup.review()).review;
    assert.equal(review.version, "0.2.3"); assert.equal(review.installed, true);
    assert.equal(review.management.automaticWorkspaces, true); assert.equal(review.management.automaticProviderNetwork, true);
    assert.deepEqual(review.configuration.qualification!.allowedDomains, ["github.com", "api.github.com", "api.githubcopilot.com"]);
    await assert.rejects(() => sdk.sandbox.setup.apply({ ...review, digest: "0".repeat(64) }), /review|changed/);
    assert.equal(imports, 0); assert.equal(probes, 0);
    const admitted = await sdk.sandbox.setup.apply(review), result = await sdk.sandbox.setup.wait(admitted.id!);
    assert.equal(result.operation.status, "completed"); assert.equal(result.operation.acceptance?.actor, "user");
    assert.equal(imports, 1); assert.equal(installs, 0); assert.equal(probes, 1);
    await waitFor(() => sdk.getState().snapshot!.settings.values.sandboxManagement?.enabled);
    const settings = sdk.getState().snapshot!.settings.values;
    assert.equal(settings.sandboxManagement?.enabled, true); assert.deepEqual(settings.startup.global, {});
    assert.equal(settings.sandbox.image, generated.distribution.worker.image); assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); await generated.close(); }
});

test("cancelled image admission retains a partial owned operation and does not change settings or replay installation", native, async () => {
  const generated = await generatedSandboxDistribution(), entered = Promise.withResolvers<void>(); let imports = 0;
  const fixture = await setupFixture({ platform: { sandbox: { distribution: generated.directory, setup: { automatic: false,
    installed: async () => true, importImage: async (_path, signal) => {
      imports++; entered.resolve();
      await new Promise<void>((_resolve, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
    },
  } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const review = (await sdk.sandbox.setup.review()).review, admitted = await sdk.sandbox.setup.apply(review);
    await entered.promise; await sdk.sandbox.setup.cancel(admitted.id!);
    const result = await sdk.sandbox.setup.wait(admitted.id!);
    assert.equal(result.operation.status, "partial"); assert.equal(imports, 1);
    assert.equal(sdk.getState().snapshot!.settings.values.sandboxManagement?.enabled, false);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); await generated.close(); }
});

test("public release checks use no private credential and never replace the user's configured version", native, async () => {
  const generated = await generatedSandboxDistribution(), requested: string[] = [];
  const fixture = await setupFixture({ platform: { sandbox: { distribution: generated.directory, setup: { automatic: false,
    fetch: async (input, init) => {
      requested.push(String(input)); assert.equal(new Headers(init?.headers).has("Authorization"), false);
      return Response.json([{ id: 101, tag_name: "v0.2.4", draft: false, prerelease: false, published_at: "2026-01-01T00:00:00.000Z",
        assets: [{ id: 102, name: "sendbox-0.2.4-macos-arm64.tar.gz", size: 50, digest: `sha256:${"4".repeat(64)}` }] }]);
    },
  } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const admitted = await sdk.sandbox.setup.check(), result = await sdk.sandbox.setup.wait(admitted.id!);
    assert.equal(result.operation.status, "available"); assert.equal(result.operation.release?.version, "0.2.4");
    assert.equal((await sdk.sandbox.setup.status()).setup.selectedVersion, "0.2.3");
    assert.deepEqual(requested, ["https://api.github.com/repos/mbianchidev/sendbox/releases?per_page=10"]);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); await generated.close(); }
});

test("an eligible release without a digest fails visibly rather than reporting a clean update check", native, async () => {
  const generated = await generatedSandboxDistribution();
  const fixture = await setupFixture({ platform: { sandbox: { distribution: generated.directory, setup: { automatic: false,
    fetch: async () => Response.json([{ id: 101, tag_name: "v0.2.4", draft: false, prerelease: false, published_at: "2026-01-01T00:00:00.000Z",
      assets: [{ id: 102, name: "sendbox-0.2.4-macos-arm64.tar.gz", size: 50 }] }]),
  } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const admitted = await sdk.sandbox.setup.check(), result = await sdk.sandbox.setup.wait(admitted.id!);
    assert.equal(result.operation.status, "failed"); assert.match(result.operation.diagnostic!, /SHA-256/);
  } finally { sdk.disconnect(); await fixture.close(); await generated.close(); }
});

test("a public runtime update is unpacked, signature-checked and prepared for separate review without changing the selected version", native, async () => {
  const generated = await generatedSandboxDistribution(), pair = generateKeyPairSync("ed25519");
  const key = pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32), sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
  generated.distribution.vendor.keySha256 = sha(key);
  await writeFile(join(generated.directory, "manifest.json"), JSON.stringify(generated.distribution));
  const guest = Buffer.from("Generated signed guest, never executed.");
  const payload = JSON.stringify({ schema_version: 1, domain: "dev.sendbox.guest.artifact-manifest.v1", trust_root_id: "external-release-root",
    release_sequence: 8, minimum_accepted_sequence: 1, expected_host_version: "0.2.4", expected_guest_version: "0.2.4", architecture: "aarch64",
    artifacts: [{ kind: "guest_binary", path: "bin/sendbox-guest", sha256: sha(guest), mode: 0o555, uid: 0, gid: 0 }] });
  const files = [
    { path: "sendbox", content: Buffer.from("Generated host, never executed."), mode: 0o555 },
    { path: "guest/aarch64/release-public.key", content: key, mode: 0o444 },
    { path: "guest/aarch64/bundle/manifest.json", content: Buffer.from(JSON.stringify({ payload, signature: sign(null, Buffer.from(payload), pair.privateKey).toString("hex") })), mode: 0o444 },
    { path: "guest/aarch64/bundle/bin/sendbox-guest", content: guest, mode: 0o555 },
  ];
  const blocks: Buffer[] = [];
  for (const file of files) {
    const header = new Header({ path: `sendbox-0.2.4-macos-arm64/${file.path}`, type: "File", size: file.content.length, mode: file.mode });
    header.encode(); if (!header.block) throw new Error("Generated update archive has no TAR header.");
    blocks.push(header.block, file.content, Buffer.alloc((512 - file.content.length % 512) % 512));
  }
  const archive = gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)])); let installs = 0, packages = 0;
  const fixture = await setupFixture({ platform: { sandbox: { distribution: generated.directory, setup: { automatic: false,
    fetch: async (input, init) => {
      assert.equal(new Headers(init?.headers).has("Authorization"), false);
      if (String(input).endsWith("/releases?per_page=10")) return Response.json([{ id: 101, tag_name: "v0.2.4", draft: false, prerelease: false,
        published_at: "2026-01-01T00:00:00.000Z", assets: [{ id: 102, name: "sendbox-0.2.4-macos-arm64.tar.gz", size: archive.length, digest: `sha256:${sha(archive)}` }] }]);
      assert.equal(String(input), "https://api.github.com/repos/mbianchidev/sendbox/releases/assets/102");
      return new Response(archive);
    },
    package: async (root, version, output) => {
      packages++; assert.equal(version, "0.2.4"); assert.equal((await readFile(join(root, "guest/aarch64/bundle/bin/sendbox-guest"))).equals(guest), true);
      await writeFile(output, "Generated reviewed package, never installed.", { mode: 0o600 });
    },
    install: async () => { installs++; },
  } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const admitted = await sdk.sandbox.setup.prepare("0.2.4"), result = await sdk.sandbox.setup.wait(admitted.id!);
    assert.equal(result.operation.status, "review", result.operation.diagnostic ?? "");
    const review = (await sdk.sandbox.setup.review("0.2.4")).review;
    assert.equal(review.version, "0.2.4"); assert.equal(review.configuration.qualification!.minimumReleaseSequence, 8);
    assert.equal(review.configuration.image, generated.distribution.worker.image);
    assert.equal((await stat(review.imageArchivePath)).size, generated.distribution.worker.archive.bytes);
    assert.equal((await sdk.sandbox.setup.status()).setup.selectedVersion, "0.2.3");
    assert.equal(packages, 1); assert.equal(installs, 0); assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); await generated.close(); }
});

test("recovered setup operations are partial and never replay an installer or image import", native, async () => {
  const generated = await generatedSandboxDistribution();
  const fixture = await setupFixture({ platform: { sandbox: { distribution: generated.directory, setup: { automatic: false } } } });
  try {
    const live = await new MoguriSdk(fixture.service.connection).ready(), current = live.settings.get()!;
    await live.settings.update({ ...current.values, sandbox: distributionConfiguration(generated.distribution),
      sandboxManagement: { ...defaultSandboxManagement(), enabled: true } }, current.revision);
    live.disconnect();
    const now = new Date().toISOString();
    const operation: SandboxSetupOperation = { version: 1, id: "generated-original", profileId: "default", revision: 0,
      kind: "apply", status: "installing", commandId: "generated-original-command", commandDigest: "1".repeat(64), automatic: false,
      createdAt: now, updatedAt: now, selectedVersion: "0.2.3", release: null, distributionDigest: "2".repeat(64), reviewDigest: "3".repeat(64),
      sourceDirectory: generated.directory, destination: "/opt/moguri/sendbox/0.2.3", installerSha512: "4".repeat(128), diagnostic: null,
      acceptance: { actor: "user", commandId: "generated-original-command", commandDigest: "1".repeat(64), reviewDigest: "3".repeat(64) } };
    fixture.service.store.commit([{ event_type: "sandbox.setup_recorded", profile_id: "default", payload: { operation } }]);
    await fixture.service.close();
    const { startService } = await import("../apps/service/src/server.ts");
    let installs = 0;
    const reopened = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
      platform: { sandbox: { distribution: generated.directory, setup: { automatic: false, install: async () => { installs++; } } } } });
    try {
      const sdk = await new MoguriSdk(reopened.connection).ready();
      const result = await sdk.sandbox.setup.operation(operation.id);
      assert.equal(result.operation.status, "partial"); assert.equal(result.operation.revision, 1); assert.equal(installs, 0);
      assert.equal((await sdk.sandbox.setup.status()).setup.operation?.id, operation.id);
      assert.equal(reopened.store.events().filter((event) => event.event_type === "sandbox.setup_recorded" && event.payload.operation.kind === "qualify").length, 0);
      sdk.disconnect();
    } finally { await reopened.close(); }
  } finally { await fixture.close(); await generated.close(); }
});
