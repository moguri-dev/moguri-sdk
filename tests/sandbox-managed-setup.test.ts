import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { nativeConfiguration } from "./fixtures/native-target.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { startService } from "../apps/service/src/server.ts";

const configuration = await nativeConfiguration(), distribution = process.env.MOGURI_SANDBOX_DISTRIBUTION;
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
