import assert from "node:assert/strict";
import test from "node:test";
import { DraftEditor, MoguriSdk } from "../packages/sdk/src/index.ts";
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
