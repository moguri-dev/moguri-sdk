import assert from "node:assert/strict";
import test from "node:test";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import * as protocol from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { configureGeneratedReadiness, generatedReadinessCollector } from "./fixtures/model-readiness.ts";

test("the shared inspection inventory includes an unavailable configured model without selecting it or another machine", async () => {
  const fixture = await setupFixture({ exposeModels: false, responseMode: "text", platform: { modelReadiness: { collect: generatedReadinessCollector } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const model = await configureGeneratedReadiness(sdk, fixture);
    const catalogue = sdk.models.catalogue();
    assert.ok(protocol.configuredReadinessModels(catalogue, "Local").some((entry) => entry.id === model.id));
    assert.equal(protocol.configuredReadinessModels(catalogue, "Remote").length, 0);
    const { readiness } = await sdk.models.readiness(fixture.sessionId, model.id);
    assert.equal(readiness.target.modelId, model.id);
    assert.equal(fixture.session().controls.modelId, null);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the shared readiness target binds an explicitly configured model and original session without inference or selection", async () => {
  const fixture = await setupFixture({ exposeModels: true, responseMode: "text" });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const model = await configureGeneratedReadiness(sdk, fixture);
    const { target } = await sdk.models.readinessTarget(fixture.sessionId, model.id);
    assert.equal(target.profileId, sdk.profileId);
    assert.equal(target.sessionId, fixture.sessionId);
    assert.equal(target.modelId, model.id);
    assert.equal(target.env, "Local");
    assert.equal(target.peerDigest, null);
    for (const hash of [target.rootDigest, target.buildDigest, target.endpointBindingDigest, target.modelBindingDigest]) assert.match(hash, /^[a-f0-9]{64}$/);
    assert.equal(fixture.session().controls.modelId, null);
    assert.equal(fixture.requests.length, 0);
    await assert.rejects(() => sdk.models.readinessTarget("generated-foreign-session", model.id), /session|profile/i);
    await assert.rejects(() => sdk.models.readinessTarget(fixture.sessionId, "generated-foreign-model"), /model|profile|configured/i);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the real SDK returns only generated scoped readiness and preserves the unset model and draft", async () => {
  const fixture = await setupFixture({ exposeModels: true, responseMode: "text", platform: { modelReadiness: { collect: generatedReadinessCollector } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const model = await configureGeneratedReadiness(sdk, fixture, { runtime: { kind: "llama-cpp", executablePath: "/generated/readiness/llama-cli" } });
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated unsent readiness draft.", attachments: [] });
    const { readiness } = await sdk.models.readiness(fixture.sessionId, model.id);
    assert.equal(readiness.target.profileId, sdk.profileId);
    assert.equal(readiness.target.sessionId, fixture.sessionId);
    assert.equal(readiness.target.modelId, model.id);
    assert.equal(readiness.observations.host.operatingSystem.value, "linux");
    assert.equal(readiness.observations.host.ramBytes.value, 16 * 1024 ** 3);
    assert.equal(readiness.capacity.status, "unknown");
    assert.equal(fixture.session().controls.modelId, null);
    assert.equal(fixture.session().draft.text, "Generated unsent readiness draft.");
    assert.equal(fixture.requests.length, 0);
    await assert.rejects(() => sdk.models.readiness(fixture.sessionId, model.id, "required"), /required|unknown|requirements/i);
    assert.equal(fixture.session().draft.text, "Generated unsent readiness draft.");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("required readiness refuses missing runtime/model identity even when observed resource thresholds match", async () => {
  const fixture = await setupFixture({ exposeModels: true, responseMode: "text", platform: { modelReadiness: { collect: generatedReadinessCollector } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const model = await configureGeneratedReadiness(sdk, fixture, { requirements: {
      provenance: { kind: "user-supplied-model-requirements", actor: "user", sourceDigest: "c".repeat(64), recordedAt: "2026-01-01T00:00:00.000Z" },
      operatingSystems: ["linux"], architectures: ["x64"], accelerator: "cpu", minimumRamBytes: 8 * 1024 ** 3,
      minimumFreeRamBytes: 4 * 1024 ** 3, minimumFreeDiskBytes: 1024 ** 3,
    } });
    const before = structuredClone(fixture.service.controller.snapshot());
    const { readiness } = await sdk.models.readiness(fixture.sessionId, model.id);
    for (const id of ["operating-system", "architecture", "accelerator", "ram", "free-ram", "free-disk"])
      assert.equal(readiness.evaluation.checks.find((check) => check.id === id)?.status, "pass", id);
    await assert.rejects(() => sdk.models.readiness(fixture.sessionId, model.id, "required"), /required|unknown|missing/i);
    assert.equal(readiness.capacity.status, "unknown");
    const after = fixture.service.controller.snapshot();
    assert.deepEqual(after.sessions, before.sessions);
    assert.deepEqual(after.settings, before.settings);
    assert.deepEqual(after.policy, before.policy);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

for (const outcome of ["cancel", "endpoint-change"] as const) test(`an in-flight ${outcome} cannot publish late original readiness or start inference`, async () => {
  const entered = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
  let probeSignal: AbortSignal | undefined;
  const fixture = await setupFixture({ exposeModels: true, responseMode: "text", platform: { modelReadiness: {
    collect: async (input, options) => {
      probeSignal = options.signal;
      const report = await generatedReadinessCollector(input, options);
      entered.resolve(); await finish.promise;
      return report;
    },
  } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready(), abort = new AbortController();
  let pending: Promise<unknown> | undefined;
  try {
    const model = await configureGeneratedReadiness(sdk, fixture);
    pending = sdk.models.readiness(fixture.sessionId, model.id, "informational", abort.signal);
    const rejected = assert.rejects(pending, outcome === "cancel" ? /abort|cancel/i : /changed|stale|original/i);
    await entered.promise;
    if (outcome === "cancel") {
      abort.abort();
      await waitFor(() => probeSignal?.aborted);
    } else {
      const settings = sdk.settings.get()!;
      await sdk.settings.update({ ...settings.values, localModels: settings.values.localModels.map((endpoint) => ({
        ...endpoint, runtime: { kind: "llama-cpp", executablePath: "/generated/changed/llama-cli" },
      })) }, settings.revision);
    }
    finish.resolve(); await rejected;
    assert.equal(fixture.session().controls.modelId, null);
    assert.equal(fixture.requests.length, 0);
  } finally {
    finish.resolve(); abort.abort();
    await pending?.catch(() => undefined);
    sdk.disconnect(); await fixture.close();
  }
});
