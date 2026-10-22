import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { MoguriSdk, PROTOCOL_VERSION, projectEvents } from "../packages/sdk/src/index.ts";
import { retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";
import { setupFixture } from "./fixture.ts";

test("schema-37 public-workflow migration rolls back atomically without changing ciphertexts, receipts, scoped text or saved model windows", async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  let reopened: EventStore | undefined;
  try {
    await sdk.attachments.paste(f.sessionId, Array.from({ length: 51 }, (_, index) => `Generated compound migration ${index}`).join("\r\n"));
    const session = f.session();
    f.service.store.commit([{ event_type: "session.configured", profile_id: "default", project_id: session.projectId, session_id: session.id,
      payload: { controls: { ...session.controls, modelId: f.modelId, modelOptions: { contextWindow: 24576 } } } }]);
    const before = retainedCiphertextRows(f.service.store.db), path = f.service.store.path;
    sdk.disconnect(); await writeLegacyState(f.service, 37);
    const raw = new DatabaseSync(path);
    try { raw.exec(`CREATE TRIGGER generated_compound_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='compound_workflow_schema'
      BEGIN SELECT RAISE(ABORT,'Generated compound migration failure'); END;`); } finally { raw.close(); }
    assert.throws(() => new EventStore(path, f.retentionKey), /compound migration failure/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 37);
      assert.deepEqual(retainedCiphertextRows(failed), before);
      failed.exec("DROP TRIGGER generated_compound_marker");
    } finally { failed.close(); }
    reopened = new EventStore(path, f.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(reopened.db), before);
    const restored = projectEvents(reopened.events());
    assert.deepEqual(restored.compoundWorkflows, []);
    assert.equal(restored.sessions.find((session) => session.id === f.sessionId)!.controls.modelOptions?.contextWindow, 24576);
    assert.equal(reopened.blob(restored.sessions.find((session) => session.id === f.sessionId)!.draft.attachments[0]!.digest).split("\r\n").length, 51);
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); reopened?.close(); await f.close(); }
});
