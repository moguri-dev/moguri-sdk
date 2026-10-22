import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION, projectEvents } from "../packages/sdk/src/index.ts";
import { retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";
import { winddownApiFixture } from "./fixtures/winddown-api.ts";

test("schema-40 migration preserves exact schema-39 wind-down results, all-role holds, receipts and independent ciphertext through rollback and reopen", { skip: process.platform !== "darwin", timeout: 15000 }, async () => {
  const f = await winddownApiFixture(); let reopened: EventStore | undefined;
  try {
    const checkpoint = await f.run(), before = retainedCiphertextRows(f.service.store.db), path = f.service.store.path;
    f.sdk.disconnect(); await writeLegacyState(f.service, 39);
    const raw = new DatabaseSync(path);
    try { raw.exec(`CREATE TRIGGER generated_decision_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='owned_decision_schema'
      BEGIN SELECT RAISE(ABORT,'Generated owned decision migration failure'); END;`); } finally { raw.close(); }
    assert.throws(() => new EventStore(path, f.retentionKey), /owned decision migration failure/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 39); assert.deepEqual(retainedCiphertextRows(failed), before);
      failed.exec("DROP TRIGGER generated_decision_marker");
    } finally { failed.close(); }
    reopened = new EventStore(path, f.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(reopened.db), before);
    const snapshot = projectEvents(reopened.events());
    assert.equal(snapshot.winddowns[0]?.status, "ready"); assert.equal(snapshot.winddowns[0]?.step.resultDigest, checkpoint.winddown.step.resultDigest);
    assert.equal(snapshot.decisions.length, 0); assert.equal(snapshot.settings.values.decisions.enabled, false);
    assert.ok(reopened.blob(checkpoint.winddown.step.resultDigest!).includes("Generated wind-down"));
  } finally { reopened?.close(); await f.close(); }
});
