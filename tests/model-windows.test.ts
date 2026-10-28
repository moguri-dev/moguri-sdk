import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultKupoSettings, modelContextWindows } from "../packages/protocol/src/index.ts";
import { validateModelOptions } from "../apps/service/src/model-controls.ts";
import { kupoAvailability, kupoPool } from "../apps/service/src/routing.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { ownedSequenceFixture } from "./fixtures/owned-sequence-api.ts";
import { candidateGenerationFixture } from "./fixtures/candidate-generation-api.ts";

test("working windows use the exact maximum and floored half, or only actual provider declarations", () => {
  assert.deepEqual(modelContextWindows({ contextWindow: 32769 }), { source: "maximum-and-half", values: [32769, 16384] });
  assert.deepEqual(modelContextWindows({ contextWindow: 16383 }), { source: "maximum-and-half", values: [16383] });
  assert.deepEqual(modelContextWindows({ contextWindow: 8192 }), { source: "maximum-and-half", values: [8192] });
  assert.deepEqual(modelContextWindows({ contextWindow: 8191 }), { source: "maximum-and-half", values: [] });
  const declared = { contextWindow: 131072, supportedContextWindows: [32768, 65536, 32768, 4096] };
  assert.deepEqual(modelContextWindows(declared), { source: "provider", values: [65536, 32768] });
  assert.throws(() => modelContextWindows({ contextWindow: 32768, supportedContextWindows: [65536] }), /declared|window/i);
  assert.throws(() => modelContextWindows({ contextWindow: Number.NaN }), /window/i);
  assert.doesNotThrow(() => validateModelOptions({ contextWindow: 32768 }, { contextWindow: 24576 }));
  assert.doesNotThrow(() => validateModelOptions({ contextWindow: 32768 }, { contextWindow: 8192 }));
  for (const contextWindow of [8191, 32769, Number.NaN, Number.POSITIVE_INFINITY, 24576.5]) {
    assert.throws(() => validateModelOptions({ contextWindow: 32768 }, { contextWindow }), /supported|offered|window|context/i);
  }
  assert.throws(() => validateModelOptions(declared, { contextWindow: 131072 }), /supported|offered/i);
  validateModelOptions(declared, { contextWindow: 32768 });
});

test("pool eligibility and its synthetic capacity use the actual declared default window with request headroom", () => {
  const model = { id: "generated-window-model", name: "Generated declared windows", contextWindow: 131072, supportedContextWindows: [8192],
    imageInput: false, maxTokens: 128, source: "local" as const, endpointBoundary: "loopback" as const };
  const policy = { ...defaultKupoSettings(), enabled: true, classifierModelId: model.id, approvedModelIds: [model.id] };
  assert.throws(() => kupoPool(policy, [model], "Local", 4000), /fits|context/);
  assert.equal(kupoPool(policy, [model], "Local", 3000).candidates.length, 1);
  assert.equal(kupoAvailability(policy, [model], false).model?.contextWindow, 8192);
});

test("owned-role preview reserves complete future context against the declared window, not the theoretical maximum", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await ownedSequenceFixture({ contextWindow: 131072, supportedContextWindows: [8192] });
  try {
    await assert.rejects(() => fixture.execution.preview(fixture.input), /whole future role context|working context/i);
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.control.snapshot().budgetPlans.length, 0);
  } finally { await fixture.close(); }
});

test("generation preview refuses a declared window too small for the exact reviewed instructions before a paid call", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await candidateGenerationFixture(undefined, { contextWindow: 131072, supportedContextWindows: [8192] });
  try {
    const settings = structuredClone(fixture.sdk.settings.get()!.values);
    settings.systemPrompt = "Generated long reviewed system instructions. ".repeat(1200);
    await fixture.sdk.command({ type: "settings.update", settings, expectedRevision: fixture.sdk.settings.get()!.revision, acknowledgePromptRisk: true });
    await assert.rejects(() => fixture.sdk.candidates.generatePreview(fixture.sessionId, fixture.workspace.id, fixture.input), /working context/);
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});

test("SDK context choices bind provider windows, reject stale values and record the actual request window", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ contextWindow: 131072, supportedContextWindows: [32768, 65536] });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.refresh();
    const initial = (await sdk.sessions.context(fixture.sessionId)).context;
    assert.deepEqual(initial.windows, { source: "provider", values: [65536, 32768] });
    assert.equal(initial.contextWindow, 65536);
    await sdk.sessions.modelOptions(fixture.sessionId, { contextWindow: 32768 });
    await assert.rejects(() => sdk.sessions.modelOptions(fixture.sessionId, { contextWindow: 16384 }), /not offered|supported/i);
    assert.equal(fixture.session().controls.modelOptions?.contextWindow, 32768);
    await fixture.send("Generated supported working-window request.");
    assert.equal((await fixture.terminal()).status, "completed");
    assert.equal(fixture.session().usage[0]?.contextWindow, 32768);
    fixture.provider.state.models[0]!.supportedContextWindows = [65536];
    fixture.provider.onChange();
    const retained = fixture.session().messages.length;
    await assert.rejects(() => fixture.send("Generated stale-window request."), /not offered|supported/i);
    assert.equal(fixture.session().messages.length, retained);
    assert.equal(fixture.session().draft.text, "Generated stale-window request.");
    assert.equal(fixture.requests.length, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});
