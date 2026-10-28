import assert from "node:assert/strict";
import test from "node:test";
import { DraftEditor, MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";

test("streamed dictation replaces only its original composer span and preserves typing around it", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    editor.edit("Before after"); await editor.flush();
    const dictation = editor.startDictation(7, 7);
    dictation.update("Generated");
    assert.equal(editor.getState().text, "Before Generated after");
    editor.edit(`Prefix ${editor.getState().text}`);
    dictation.update("Generated partial");
    assert.equal(editor.getState().text, "Prefix Before Generated partial after");
    editor.edit(`${editor.getState().text} suffix`);
    dictation.update("Generated final.");
    dictation.update("Generated final.");
    await editor.flush();
    assert.equal(fixture.session().draft.text, "Prefix Before Generated final. after suffix");
    assert.equal(fixture.requests.length, 0);
    dictation.close();
    assert.throws(() => dictation.update("Late result"), /original|closed|dictation/i);
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});

test("editing the active dictated span or receiving a foreign draft cannot be overwritten by later recognition", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    const dictation = editor.startDictation();
    dictation.update("Generated original");
    editor.edit("Generated user correction");
    assert.throws(() => dictation.update("Generated later recognition"), /edited|changed|preserved/i);
    assert.equal(editor.getState().text, "Generated user correction");
    await editor.flush();
    const next = editor.startDictation();
    editor.receive({ ...fixture.session().draft, revision: fixture.session().draft.revision + 1, text: "Generated other client." });
    assert.throws(() => next.update("Must not overwrite another client."), /changed|conflict|preserved/i);
    assert.equal(editor.getState().text, "Generated other client.");
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});
