import assert from "node:assert/strict";
import test from "node:test";
import { defaultKupoSettings, DraftEditor, KUPO_MODEL_ID, MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("opening a side chat is atomic, inherits model parameters and captures real parent context without acquiring write authority", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text", reasoning: true, contextWindow: 32768 });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.refresh();
    await sdk.sessions.modelOptions(fixture.sessionId, { thinkingEffort: "low", contextWindow: 16384 });
    await sdk.sessions.autonomy(fixture.sessionId, "Autopilot");
    await fixture.send("Generated parent history sentinel."); await fixture.terminal();
    const [one, two] = await Promise.all([sdk.sessions.side(fixture.sessionId), sdk.sessions.side(fixture.sessionId)]);
    assert.equal(one.id, two.id);
    const side = fixture.service.controller.snapshot().sessions.find((session) => session.id === one.id)!;
    assert.equal(side.kind, "side"); assert.equal(side.mode, "read-only");
    assert.deepEqual(side.controls, fixture.session().controls);
    await assert.rejects(() => sdk.sessions.mode(side.id, "agent", side.revision), /question-only|read-only/i);
    const editor = new DraftEditor(sdk, side.id, side.draft);
    try { editor.edit("Generated side question."); await editor.send("queue"); } finally { editor.dispose(); }
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === side.id)?.status === "completed");
    assert.match(JSON.stringify(fixture.requests.at(-1)?.messages), /Generated parent history sentinel/);
    assert.equal(fixture.requests.at(-1)?.reasoning_effort, "low");
    assert.equal(fixture.session().controls.modelId, side.controls.modelId);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the inherited Kupo model runs in a read-only side chat through the same actual owned worker and accounting", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 128 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.routing.configure({ ...defaultKupoSettings(), enabled: true, classifierModelId: fixture.modelId, approvedModelIds: [fixture.modelId], allowHosted: true }, sdk.settings.get()!.revision);
    await sdk.sessions.selectModel(fixture.sessionId, KUPO_MODEL_ID);
    await fixture.send("Generated parent Kupo history."); await fixture.terminal(); await sdk.refresh();
    const created = await sdk.sessions.side(fixture.sessionId);
    const side = () => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)!;
    assert.equal(side().controls.modelId, KUPO_MODEL_ID);
    const editor = new DraftEditor(sdk, created.id!, side().draft);
    try { editor.edit("Generated inherited Kupo side question."); await editor.send("queue"); } finally { editor.dispose(); }
    await waitFor(() => ["completed", "partial", "failed"].includes(side().status));
    assert.equal(side().status, "completed", side().lastError ?? "");
    assert.equal(side().mode, "read-only");
    assert.equal(side().usage[0]?.role, "side");
    assert.equal(side().usage[0]?.modelId, fixture.modelId);
    assert.equal(fixture.service.controller.snapshot().routings.find((routing) => routing.sessionId === side().id)?.plan?.pattern, "single");
    assert.match(JSON.stringify(fixture.requests.at(-1)?.messages), /Generated parent Kupo history/);
    assert.equal(/write_file|edit_file|run_command/.test(JSON.stringify(fixture.requests.at(-1)?.tools)), false);
    assert.equal(fixture.requests.length, 2);
  } finally { sdk.disconnect(); await fixture.close(); }
});
