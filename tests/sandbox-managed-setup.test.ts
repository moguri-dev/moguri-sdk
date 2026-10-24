import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { test } from "node:test";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { nativeConfiguration } from "./fixtures/native-target.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { startService } from "../apps/service/src/server.ts";
import { SandboxRuntime } from "../apps/service/src/sandbox-runtime.ts";
import { GeneratedFileVault } from "./fixtures/generated-vault.ts";

const configuration = await nativeConfiguration(), distribution = process.env.MOGURI_SANDBOX_DISTRIBUTION;
test("managed engine qualification never requires Copilot or any unselected provider network", { skip: !configuration, timeout: 90_000 }, async () => {
  assert.ok(configuration);
  await mkdir(".native/qualification", { recursive: true, mode: 0o700 });
  const root = await realpath(await mkdtemp(".native/qualification/managed-engine-")), state = join(root, "state");
  await mkdir(state, { mode: 0o700 });
  const config = { ...configuration, qualification: { ...configuration.qualification!, allowCopilot: true, allowedDomains: ["github.com", "api.github.com"] } };
  let dnsReads = 0, passed = false;
  const runtime = new SandboxRuntime(state, () => config, { vault: new GeneratedFileVault(join(root, "generated-vault.json")),
    engineOnlyProbe: () => true, dns: {
      addresses: async () => { dnsReads++; throw new Error("Generated unselected Copilot provider is unreachable."); },
      aliases: async () => { dnsReads++; throw new Error("Generated provider must not be resolved during engine setup."); },
    } });
  try {
    assert.equal((await runtime.probe("generated-independent-engine")).ready, true);
    assert.equal(dnsReads, 0); passed = true;
  } finally { await runtime.close(); if (passed) await rm(root, { recursive: true, force: true }); }
});
test("actual bundled setup imports its pinned worker, qualifies the configured release and requalifies after restart without replaying installation", {
  skip: !configuration || !distribution, timeout: 120_000,
}, async () => {
  assert.ok(configuration && distribution);
  let installs = 0;
  const fixture = await setupFixture({ platform: { sandbox: { distribution, setup: { automatic: false,
    install: async () => { installs++; throw new Error("A generated qualification may not open an administrator dialog."); },
  } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const settings = structuredClone(sdk.settings.get()!);
    settings.values.sandbox = { ...configuration, qualification: { ...configuration.qualification!,
      allowedDomains: ["github.com", "api.github.com", "api.githubcopilot.com"], allowCopilot: true } };
    await sdk.settings.update(settings.values, settings.revision);
    const review = (await sdk.sandbox.setup.review()).review;
    assert.equal(review.administratorRequired, false); assert.equal(review.configuration.executable, configuration.executable);
    assert.equal(review.version, configuration.qualification!.release);
    const admitted = await sdk.sandbox.setup.apply(review), completed = await sdk.sandbox.setup.wait(admitted.id!);
    assert.equal(completed.operation.status, "completed", completed.operation.diagnostic ?? "");
    assert.equal((await sdk.sandbox.status()).sandbox.ready, true); assert.equal(installs, 0); assert.equal(fixture.requests.length, 0);
    sdk.disconnect(); await fixture.service.close();
    const reopened = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
      platform: { sandbox: { setup: { automatic: false, install: async () => { installs++; throw new Error("Original installation cannot replay."); } } } } });
    const client = await new MoguriSdk(reopened.connection).ready();
    try {
      await waitFor(() => reopened.controller.snapshot().capabilities.find((capability) => capability.env === "Sandbox")?.ready, 30_000);
      assert.equal((await client.sandbox.setup.operation(admitted.id!)).operation.status, "completed");
      const status = (await client.sandbox.setup.status()).setup;
      assert.equal(status.operation?.kind, "qualify"); assert.equal(status.operation?.automatic, true);
      assert.equal(installs, 0); assert.equal(fixture.requests.length, 0);
    } finally { client.disconnect(); await reopened.close(); }
  } finally { sdk.disconnect(); await fixture.close(); }
});
