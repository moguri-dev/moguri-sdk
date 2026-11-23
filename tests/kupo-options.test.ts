import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { defaultKupoSettings, KUPO_MODEL_ID, MoguriSdk, PROTOCOL_VERSION, type ModelInfo } from "../packages/sdk/src/index.ts";
import { automaticPool } from "../apps/service/src/routing.ts";
import { kupoModelOptions } from "../apps/service/src/kupo-policy.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture } from "./fixture.ts";
import { removeChatRepositoryBindingFixtureMarker, retainedCiphertextRows } from "./fixtures/legacy-state.ts";

const model: ModelInfo = {
  id: "generated-options-model", name: "Generated options model", providerId: "generated",
  apiModelId: "generated-options-api", source: "local", endpointBoundary: "loopback",
  environments: ["Local", "Remote", "Sandbox"], contextWindow: 32768, maxTokens: 512,
  thinkingLevels: ["low", "medium", "high"], kupoThinkingLevels: ["low", "medium", "high"],
  imageInput: true, toolInput: true,
};

test("Kupo carries an exact supported window and effort without changing the actual model binding", () => {
  const original = structuredClone(model);
  assert.deepEqual(kupoModelOptions(model, {
    mode: "balanced", modelOptions: { contextWindow: 24577, thinkingEffort: "high" },
  }), { contextWindow: 24577, thinkingEffort: "high" });
  assert.deepEqual(model, original);
});

test("Kupo excludes incompatible options before classifier admission instead of clamping a pool member", () => {
  const smaller = { ...model, id: "generated-small-options", contextWindow: 16384 };
  const pool = automaticPool(defaultKupoSettings(), [model, smaller], "Local", 0, {
    mode: "balanced", modelOptions: { contextWindow: 24577, thinkingEffort: "high" },
  });
  assert.deepEqual(pool.candidates.map((entry) => entry.id), [model.id]);
  assert.equal(pool.classifier, null);
  assert.equal(pool.capabilities[0]?.contextWindow, 24577);
});

test("Kupo options preserve provider-declared windows and incompatible mode effort as explicit errors", () => {
  assert.throws(() => kupoModelOptions({ ...model, supportedContextWindows: [32768, 16384] }, {
    mode: "balanced", modelOptions: { contextWindow: 24577 },
  }), /window|context/i);
  assert.throws(() => kupoModelOptions(model, {
    mode: "savings", modelOptions: { thinkingEffort: "max" },
  }), /effort|thinking/i);
  assert.throws(() => kupoModelOptions({ ...model, thinkingLevels: ["high"], kupoThinkingLevels: ["high"] }, {
    mode: "balanced", modelOptions: { thinkingEffort: "low" },
  }), /effort|thinking/i);
  assert.throws(() => kupoModelOptions({ ...model, maxTokens: 8192, kupoThinkingMinimumOutput: { high: 4096 } }, {
    modelOptions: { thinkingEffort: "high" },
  }, 512), /effort|thinking|output/i);
});

test("complete future reviews must fit the explicitly selected pool window in every Env", () => {
  for (const env of ["Local", "Remote", "Sandbox"] as const) {
    assert.throws(() => automaticPool(defaultKupoSettings(), [model], env, 15000, {
      mode: "balanced", modelOptions: { contextWindow: 16384 },
    }), /No configured model/);
  }
});

test("Kupo rejects manual effort without mutation and chooses supported thinking while preserving its exact window", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 512, contextWindow: 32768, reasoning: true });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.selectModel(fixture.sessionId, KUPO_MODEL_ID);
    const original = structuredClone(fixture.session().controls);
    await assert.rejects(() => sdk.sessions.configure(fixture.sessionId, {
      ...fixture.session().controls, modelOptions: { contextWindow: 24577, thinkingEffort: "high" },
    }), /classifier|automatic/i);
    assert.deepEqual(fixture.session().controls, original);
    assert.equal(fixture.requests.length, 0);
    await sdk.sessions.modelOptions(fixture.sessionId, { contextWindow: 24577 });
    await fixture.send("Generated exact pooled controls.");
    await fixture.terminal();
    assert.equal(fixture.session().status, "completed", fixture.session().lastError ?? "");
    assert.deepEqual(fixture.session().controls.modelOptions, { contextWindow: 24577 });
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.requests[0]?.reasoning_effort, "medium");
    assert.equal(fixture.session().usage[0]?.contextWindow, 24577);
    assert.equal(fixture.session().usage[0]?.thinkingEffort, "medium");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("SDK pool-control review is bound to the exact session and never starts inference", async () => {
  const fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 512, contextWindow: 32768, reasoning: true });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.selectModel(fixture.sessionId, KUPO_MODEL_ID);
    const { report } = await sdk.routing.options(fixture.sessionId, { contextWindow: 24577 });
    assert.equal(report.sessionId, fixture.sessionId);
    assert.equal(report.available, true);
    assert.deepEqual(report.modelIds, [fixture.modelId]);
    const manual = await sdk.routing.options(fixture.sessionId, { thinkingEffort: "high" });
    assert.equal(manual.report.available, false);
    assert.match(manual.report.diagnostic!, /classifier|automatic/i);
    assert.equal(fixture.requests.length, 0);
    const denied = await sdk.routing.options(fixture.sessionId, { contextWindow: 65536 });
    assert.equal(denied.report.available, false);
    assert.ok(denied.report.diagnostic);
    assert.deepEqual(fixture.session().controls.modelOptions, undefined);
    await assert.rejects(() => sdk.routing.options("generated-foreign-session"), /session|profile/i);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("103-compatible history upgrades without ciphertext changes and retained Kupo effort needs explicit clearing before dispatch", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ reasoning: true, contextWindow: 32768, maxOutputTokens: 512, responseMode: "text" });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  let reopened: Awaited<ReturnType<typeof startService>> | undefined, live: MoguriSdk | undefined;
  try {
    await sdk.sessions.selectModel(fixture.sessionId, KUPO_MODEL_ID);
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0,
      text: "Generated original saved upgrade draft.", attachments: [] });
    const controls = { ...fixture.session().controls, modelOptions: { contextWindow: 16384, thinkingEffort: "high" as const } };
    fixture.service.store.commit([{ event_type: "session.configured", profile_id: sdk.profileId, project_id: fixture.session().projectId,
      session_id: fixture.sessionId, payload: { controls } }]);
    sdk.disconnect(); await fixture.service.close();
    const raw = new DatabaseSync(fixture.service.store.path);
    removeChatRepositoryBindingFixtureMarker(raw, fixture.service.controller.events(0));
    raw.exec("PRAGMA user_version=103");
    const original = retainedCiphertextRows(raw); raw.close();
    const migrated = new EventStore(fixture.service.store.path, fixture.retentionKey);
    try {
      assert.equal(migrated.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
      assert.deepEqual(retainedCiphertextRows(migrated.db), original);
    } finally { migrated.close(); }
    reopened = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    live = await new MoguriSdk(reopened.connection).ready();
    const before = structuredClone(live.sessions.get(fixture.sessionId)!);
    assert.deepEqual(before.controls, controls);
    assert.equal(before.draft.text, "Generated original saved upgrade draft.");
    const report = await live.routing.options(fixture.sessionId);
    assert.equal(report.report.available, false);
    assert.match(report.report.diagnostic!, /classifier|automatic/i);
    await assert.rejects(() => live!.command({ type: "message.send", sessionId: fixture.sessionId,
      expectedRevision: before.draft.revision, delivery: "queue" }), /classifier|automatic/i);
    assert.deepEqual(live.sessions.get(fixture.sessionId)?.draft, before.draft);
    assert.deepEqual(live.sessions.get(fixture.sessionId)?.queue, before.queue);
    assert.equal(fixture.requests.length, 0);
    assert.equal(live.getState().snapshot?.budgetEntries.length, 0);
    await live.sessions.modelOptions(fixture.sessionId, { contextWindow: 16384 });
    assert.deepEqual(live.sessions.get(fixture.sessionId)?.controls.modelOptions, { contextWindow: 16384 });
    assert.equal(live.sessions.get(fixture.sessionId)?.controls.kupoMode, before.controls.kupoMode);
    assert.deepEqual(live.sessions.get(fixture.sessionId)?.draft, before.draft);
    assert.equal(fixture.requests.length, 0);
  } finally { live?.disconnect(); sdk.disconnect(); await reopened?.close(); await fixture.close(); }
});
