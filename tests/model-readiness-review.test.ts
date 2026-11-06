import assert from "node:assert/strict";
import test from "node:test";
import { executeSlash, isRecord, ModelRuntimePreviewSchema, MoguriSdk, parse } from "../packages/sdk/src/index.ts";
import { join } from "node:path";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { configureGeneratedReadiness, generatedReviewedReadinessCollector } from "./fixtures/model-readiness.ts";

test("a real user reviews exact runtime bytes once before required readiness can observe a generated version", async () => {
  let admittedVersions = 0;
  const fixture = await setupFixture({ exposeModels: true, responseMode: "text", platform: { modelReadiness: {
    collect: async (input, options) => {
      if (options.executableReview) admittedVersions++;
      return generatedReviewedReadinessCollector(input, options);
    },
  } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const runtime = { kind: "llama-cpp" as const, executablePath: "/generated/readiness/llama-cli", modelPath: "/generated/readiness/model.gguf" };
    const model = await configureGeneratedReadiness(sdk, fixture, { runtime, requirements: {
      provenance: { kind: "user-supplied-model-requirements", actor: "user", sourceDigest: "c".repeat(64), recordedAt: "2026-01-01T00:00:00.000Z" },
      runtimeKinds: ["llama-cpp"], minimumRuntimeBuild: 9911, operatingSystems: ["linux"], architectures: ["x64"],
      accelerator: "cpu", minimumRamBytes: 8 * 1024 ** 3, modelFormat: "gguf", minimumModelBytes: 1024 ** 3,
    } });
    const { preview } = await sdk.models.runtimePreview(fixture.sessionId, model.id);
    assert.deepEqual(preview.program, { executablePath: runtime.executablePath, args: ["--version"], cwd: "/" });
    assert.equal(preview.target.sessionId, fixture.sessionId);
    assert.equal(preview.executableSha256, "a".repeat(64));
    assert.equal(admittedVersions, 0);
    await assert.rejects(() => sdk.models.reviewRuntime(fixture.sessionId, model.id, "d".repeat(64)), /preview|exact|changed/i);
    await assert.rejects(async () => fixture.service.controller.dispatch({
      id: "generated-forged-runtime-actor", profileId: sdk.profileId, command: {
        type: "model.runtime.review", sessionId: fixture.sessionId, modelId: model.id, expectedDigest: preview.digest, actor: "user",
      },
    }), /invalid|schema/i);
    const reviewed = await sdk.models.reviewRuntime(fixture.sessionId, model.id, preview.digest);
    const reviewId = reviewed.id;
    assert.ok(reviewId);
    const reviewEvent = fixture.service.controller.events(0).find((event) => event.event_type === "model.runtime_executable_reviewed");
    assert.equal(reviewEvent?.event_type, "model.runtime_executable_reviewed");
    if (reviewEvent?.event_type !== "model.runtime_executable_reviewed") throw new Error("Missing canonical generated user review.");
    assert.equal(reviewEvent.payload.review.actor, "user");
    assert.equal(reviewEvent.payload.review.reviewDigest, preview.digest);
    assert.equal(reviewEvent.session_id, fixture.sessionId);
    assert.equal(admittedVersions, 0);
    await assert.rejects(() => fixture.service.controller.platform.execute({
      type: "model.runtime.review", sessionId: fixture.sessionId, modelId: model.id, expectedDigest: preview.digest,
    }, () => ({})), /actual.user|controller|delegate/i);
    await assert.rejects(() => fixture.service.controller.platform.query({
      type: "model.readiness", sessionId: fixture.sessionId, modelId: model.id, runtimeReviewId: reviewId,
    }), /actual.user|controller|delegate/i);
    assert.equal(admittedVersions, 0);
    const { readiness } = await sdk.models.readinessWithRuntimeReview(fixture.sessionId, model.id, reviewId, "required");
    assert.equal(readiness.observations.runtime?.version.value, "build:9911@abcdef01234567");
    assert.equal(readiness.evaluation.requiredSatisfied, true);
    assert.equal(readiness.capacity.status, "unknown");
    assert.equal(admittedVersions, 1);
    await assert.rejects(() => sdk.models.readinessWithRuntimeReview(fixture.sessionId, model.id, reviewId), /consumed|already|replay/i);
    const freshMetadata = await sdk.models.readiness(fixture.sessionId, model.id);
    assert.equal(freshMetadata.readiness.observations.runtime?.version.status, "unknown");
    assert.equal(admittedVersions, 1);
    assert.equal(fixture.session().controls.modelId, null);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a consumed runtime review survives cancellation and restart without replay or a successful late report", async () => {
  const entered = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
  let probeSignal: AbortSignal | undefined, admitted = 0;
  const collect: typeof generatedReviewedReadinessCollector = async (input, options) => {
    const report = await generatedReviewedReadinessCollector(input, options);
    if (options.executableReview) {
      admitted++; probeSignal = options.signal; entered.resolve(); await finish.promise;
    }
    return report;
  };
  const fixture = await setupFixture({ exposeModels: true, responseMode: "text", platform: { modelReadiness: { collect } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready(), abort = new AbortController();
  let reopened: Awaited<ReturnType<typeof startService>> | undefined, reopenedSdk: MoguriSdk | undefined, pending: Promise<unknown> | undefined;
  try {
    const model = await configureGeneratedReadiness(sdk, fixture, { runtime: { kind: "llama-cpp", executablePath: "/generated/readiness/llama-cli" } });
    const { preview } = await sdk.models.runtimePreview(fixture.sessionId, model.id);
    const { id } = await sdk.models.reviewRuntime(fixture.sessionId, model.id, preview.digest);
    assert.ok(id);
    pending = sdk.models.readinessWithRuntimeReview(fixture.sessionId, model.id, id, "informational", abort.signal);
    const cancelled = assert.rejects(pending, /abort|cancel/i);
    await entered.promise;
    await assert.rejects(() => sdk.models.readinessWithRuntimeReview(fixture.sessionId, model.id, id), /consumed|already|replay/i);
    abort.abort(); await waitFor(() => probeSignal?.aborted); finish.resolve(); await cancelled;
    assert.equal(admitted, 1);
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "model.runtime_review_consumed").length, 1);
    sdk.disconnect(); await fixture.service.close();
    reopened = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
      platform: { modelReadiness: { collect }, terminal: { defaultRoot: fixture.home, executable: process.execPath,
        args: ["-e", "process.stdin.resume()"], vault: fixture.terminalVault } } });
    reopenedSdk = await new MoguriSdk(reopened.connection).ready();
    await reopenedSdk.models.refresh();
    const currentSdk = reopenedSdk;
    await assert.rejects(() => currentSdk.models.readinessWithRuntimeReview(fixture.sessionId, model.id, id), /consumed|already|replay/i);
    assert.equal(admitted, 1);
    assert.equal(reopened.controller.events(0).filter((event) => event.event_type === "model.runtime_review_consumed").length, 1);
    assert.equal(fixture.requests.length, 0);
  } finally {
    finish.resolve(); abort.abort(); await pending?.catch(() => undefined);
    reopenedSdk?.disconnect(); await reopened?.close(); sdk.disconnect(); await fixture.close();
  }
});

test("retained runtime review cannot authorize another session or a changed executable configuration", async () => {
  let admitted = 0;
  const fixture = await setupFixture({ exposeModels: true, responseMode: "text", platform: { modelReadiness: {
    collect: async (input, options) => { if (options.executableReview) admitted++; return generatedReviewedReadinessCollector(input, options); },
  } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const model = await configureGeneratedReadiness(sdk, fixture, { runtime: { kind: "llama-cpp", executablePath: "/generated/readiness/llama-cli" } });
    const { preview } = await sdk.models.runtimePreview(fixture.sessionId, model.id);
    const { id } = await sdk.models.reviewRuntime(fixture.sessionId, model.id, preview.digest);
    assert.ok(id);
    const other = await sdk.sessions.create(fixture.session().projectId, "Generated separate runtime owner");
    const otherId = other.id;
    assert.ok(otherId);
    await assert.rejects(() => sdk.models.readinessWithRuntimeReview(otherId, model.id, id), /exact|original|changed|review/i);
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, localModels: settings.values.localModels.map((endpoint) => ({
      ...endpoint, runtime: { kind: "llama-cpp", executablePath: "/generated/readiness/changed-llama-cli" },
    })) }, settings.revision);
    await assert.rejects(() => sdk.models.reviewRuntime(fixture.sessionId, model.id, preview.digest), /preview|exact|changed/i);
    await assert.rejects(() => sdk.models.readinessWithRuntimeReview(fixture.sessionId, model.id, id), /exact|original|changed|review/i);
    assert.equal(admitted, 0);
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "model.runtime_review_consumed").length, 0);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("restoring an allowed Env cannot revive an executable review from an older hard-policy revision", async () => {
  let admitted = 0;
  const fixture = await setupFixture({ exposeModels: true, responseMode: "text", platform: { modelReadiness: {
    collect: async (input, options) => { if (options.executableReview) admitted++; return generatedReviewedReadinessCollector(input, options); },
  } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const model = await configureGeneratedReadiness(sdk, fixture, { runtime: { kind: "llama-cpp", executablePath: "/generated/readiness/llama-cli" } });
    const { preview } = await sdk.models.runtimePreview(fixture.sessionId, model.id);
    const { id } = await sdk.models.reviewRuntime(fixture.sessionId, model.id, preview.digest);
    assert.ok(id);
    await sdk.command({ type: "policy.set", allowedEnvs: ["Sandbox"] });
    await assert.rejects(() => sdk.models.readinessWithRuntimeReview(fixture.sessionId, model.id, id), /excluded|policy|environment/i);
    await sdk.command({ type: "policy.set", allowedEnvs: ["Local", "Sandbox"] });
    await assert.rejects(() => sdk.models.readinessWithRuntimeReview(fixture.sessionId, model.id, id), /exact|review|changed/i);
    await assert.rejects(() => sdk.models.reviewRuntime(fixture.sessionId, model.id, preview.digest), /exact|preview|changed/i);
    assert.equal(admitted, 0);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("shared slash commands keep exact runtime preview, user review and one-use attempt separate", async () => {
  const fixture = await setupFixture({ exposeModels: true, responseMode: "text", platform: { modelReadiness: { collect: generatedReviewedReadinessCollector } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const model = await configureGeneratedReadiness(sdk, fixture, { runtime: { kind: "llama-cpp", executablePath: "/generated/readiness/llama-cli" } });
    const previewResult = await executeSlash(sdk, fixture.sessionId, `/model-runtime-preview ${model.id}`, "tui");
    assert.equal(previewResult.kind, "text");
    if (previewResult.kind !== "text") throw new Error("Missing shared exact runtime preview.");
    const previewBody: unknown = JSON.parse(previewResult.text);
    assert.ok(isRecord(previewBody));
    const preview = parse(ModelRuntimePreviewSchema, previewBody.preview);
    const reviewResult = await executeSlash(sdk, fixture.sessionId, `/model-runtime-review ${model.id} ${preview.digest}`, "cli");
    assert.equal(reviewResult.kind, "text");
    if (reviewResult.kind !== "text") throw new Error("Missing shared canonical user review.");
    const reviewBody: unknown = JSON.parse(reviewResult.text);
    assert.ok(isRecord(reviewBody) && typeof reviewBody.id === "string");
    const probe = await executeSlash(sdk, fixture.sessionId, `/model-runtime-probe ${model.id} ${reviewBody.id}`, "tui");
    assert.equal(probe.kind, "text");
    if (probe.kind !== "text") throw new Error("Missing shared reviewed runtime attempt.");
    assert.match(probe.text, /build:9911@abcdef01234567/);
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "model.runtime_executable_reviewed").length, 1);
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "model.runtime_review_consumed").length, 1);
    assert.equal(fixture.session().controls.modelId, null);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
