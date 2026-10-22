import assert from "node:assert/strict";
import { test } from "node:test";
import { modelContextWindows } from "../packages/protocol/src/index.ts";
import { validateModelOptions } from "../apps/service/src/model-controls.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";

test("working windows use the exact maximum and floored half, or only actual provider declarations", () => {
  assert.deepEqual(modelContextWindows({ contextWindow: 32769 }), { source: "maximum-and-half", values: [32769, 16384] });
  assert.deepEqual(modelContextWindows({ contextWindow: 16383 }), { source: "maximum-and-half", values: [16383] });
  assert.deepEqual(modelContextWindows({ contextWindow: 8192 }), { source: "maximum-and-half", values: [8192] });
  assert.deepEqual(modelContextWindows({ contextWindow: 8191 }), { source: "maximum-and-half", values: [] });
  const declared = { contextWindow: 131072, supportedContextWindows: [32768, 65536, 32768, 4096] };
  assert.deepEqual(modelContextWindows(declared), { source: "provider", values: [65536, 32768] });
  assert.throws(() => modelContextWindows({ contextWindow: 32768, supportedContextWindows: [65536] }), /declared|window/i);
  assert.throws(() => modelContextWindows({ contextWindow: Number.NaN }), /window/i);
  assert.throws(() => validateModelOptions({ contextWindow: 32768 }, { contextWindow: 24576 }), /supported|offered/i);
  assert.throws(() => validateModelOptions(declared, { contextWindow: 131072 }), /supported|offered/i);
  validateModelOptions(declared, { contextWindow: 32768 });
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
