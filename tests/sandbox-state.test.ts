import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { MoguriSdk, PROTOCOL_VERSION, projectEvents } from "../packages/sdk/src/index.ts";
import { retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";
import { setupFixture } from "./fixture.ts";

test("schema-36 native migration rolls back atomically and preserves exact ciphertext, receipts, scoped files and unsupported windows", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let reopened: EventStore | undefined;
  try {
    const session = fixture.session(), text = Array.from({ length: 51 }, (_, index) => `Generated retained native migration ${index}`).join("\r\n");
    await sdk.command({ type: "draft.paste", sessionId: session.id, expectedRevision: 0, text: "", attachments: [], pastedText: text, start: 0, end: 0 });
    fixture.service.store.commit([{ event_type: "session.configured", profile_id: "default", project_id: session.projectId, session_id: session.id,
      payload: { controls: { ...session.controls, modelId: fixture.modelId, modelOptions: { contextWindow: 24576 } } } }]);
    const before = retainedCiphertextRows(fixture.service.store.db), path = fixture.service.store.path;
    sdk.disconnect(); await writeLegacyState(fixture.service, 36);
    const raw = new DatabaseSync(path);
    try { raw.exec(`CREATE TRIGGER generated_native_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='native_execution_schema'
      BEGIN SELECT RAISE(ABORT,'Generated native marker interruption'); END;`); } finally { raw.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /native marker interruption/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 36);
      assert.deepEqual(retainedCiphertextRows(failed), before);
      failed.exec("DROP TRIGGER generated_native_marker");
    } finally { failed.close(); }
    reopened = new EventStore(path, fixture.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(reopened.db), before);
    const restored = projectEvents(reopened.events()).sessions.find((value) => value.id === session.id)!;
    assert.equal(restored.controls.modelOptions?.contextWindow, 24576);
    const file = restored.draft.attachments[0]!;
    assert.equal(file.kind, "paste_file"); assert.equal(reopened.blob(file.digest), text);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); reopened?.close(); await fixture.close(); }
});
