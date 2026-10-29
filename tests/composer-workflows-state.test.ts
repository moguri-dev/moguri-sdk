import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("schema 67 composer upgrade is atomic and preserves existing ciphertext and receipts after an interrupted marker append", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let reopened: EventStore | undefined;
  try {
    assert.ok(PROTOCOL_VERSION >= 68);
    const original = retainedCiphertextRows(fixture.service.store.db);
    await fixture.service.close();
    const raw = new DatabaseSync(path);
    try { raw.exec("DELETE FROM retention_metadata WHERE id IN ('theme_catalog_schema','native_web_policy_schema','chat_home_schema','model_preferences_schema','composer_workflows_schema'); PRAGMA user_version=67; CREATE TRIGGER generated_composer_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='composer_workflows_schema' BEGIN SELECT RAISE(ABORT,'Generated composer migration interruption'); END;"); }
    finally { raw.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated composer migration interruption/);
    const interrupted = new DatabaseSync(path);
    try { assert.equal(interrupted.prepare("PRAGMA user_version").get()?.user_version, 67); assert.deepEqual(retainedCiphertextRows(interrupted), original); interrupted.exec("DROP TRIGGER generated_composer_failure"); }
    finally { interrupted.close(); }
    reopened = new EventStore(path, fixture.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    reopened.close(); reopened = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
  } finally { reopened?.close(); await fixture.close(); }
});
test("composer marker corruption or premature older-lineage markers fail without repair", async (t) => {
  for (const sql of ["DELETE FROM retention_metadata WHERE id='composer_workflows_schema'",
    "UPDATE retention_metadata SET value='0' WHERE id='composer_workflows_schema'", "PRAGMA user_version=67"]) await t.test(sql, async () => {
    const fixture = await setupFixture();
    try {
      await fixture.service.close(); const raw = new DatabaseSync(fixture.service.store.path);
      try { if (sql.startsWith("PRAGMA")) raw.exec("DELETE FROM retention_metadata WHERE id IN ('theme_catalog_schema','native_web_policy_schema','chat_home_schema','model_preferences_schema')"); raw.exec(sql); } finally { raw.close(); }
      assert.throws(() => new EventStore(fixture.service.store.path, fixture.retentionKey), /composer workflow.*(marker|lineage)/i);
    } finally { await fixture.close(); }
  });
});
