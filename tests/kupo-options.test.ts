import assert from "node:assert/strict";
import test from "node:test";
import { defaultKupoSettings, KUPO_MODEL_ID, MoguriSdk, type ModelInfo } from "../packages/sdk/src/index.ts";
import { automaticPool } from "../apps/service/src/routing.ts";
import { kupoModelOptions } from "../apps/service/src/kupo-policy.ts";
import { setupFixture } from "./fixture.ts";

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

test("the owning automatic worker forwards exact pooled controls instead of rejecting or clearing them", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 512, contextWindow: 32768, reasoning: true });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.selectModel(fixture.sessionId, KUPO_MODEL_ID);
    await sdk.sessions.configure(fixture.sessionId, {
      ...fixture.session().controls, modelOptions: { contextWindow: 24577, thinkingEffort: "high" },
    });
    await fixture.send("Generated exact pooled controls.");
    await fixture.terminal();
    assert.equal(fixture.session().status, "completed", fixture.session().lastError ?? "");
    assert.deepEqual(fixture.session().controls.modelOptions, { contextWindow: 24577, thinkingEffort: "high" });
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.requests[0]?.reasoning_effort, "high");
    assert.equal(fixture.session().usage[0]?.contextWindow, 24577);
    assert.equal(fixture.session().usage[0]?.thinkingEffort, "high");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("SDK pool-control review is bound to the exact session and never starts inference", async () => {
  const fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 512, contextWindow: 32768, reasoning: true });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.selectModel(fixture.sessionId, KUPO_MODEL_ID);
    const { report } = await sdk.routing.options(fixture.sessionId, { contextWindow: 24577, thinkingEffort: "high" });
    assert.equal(report.sessionId, fixture.sessionId);
    assert.equal(report.available, true);
    assert.deepEqual(report.modelIds, [fixture.modelId]);
    assert.ok(report.thinkingLevels.includes("high"));
    assert.equal(fixture.requests.length, 0);
    const denied = await sdk.routing.options(fixture.sessionId, { contextWindow: 65536 });
    assert.equal(denied.report.available, false);
    assert.ok(denied.report.diagnostic);
    assert.deepEqual(fixture.session().controls.modelOptions, undefined);
    await assert.rejects(() => sdk.routing.options("generated-foreign-session"), /session|profile/i);
  } finally { sdk.disconnect(); await fixture.close(); }
});
