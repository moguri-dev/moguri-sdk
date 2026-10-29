import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("schema 65 telemetry upgrade rolls back atomically and preserves original ciphertext, receipts and accounting", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let reopened: EventStore | undefined;
  try {
    assert.ok(PROTOCOL_VERSION >= 66, "The required retained-snapshot API must not reuse a healthy older service protocol.");
    const original = retainedCiphertextRows(fixture.service.store.db);
    await fixture.service.close();
    const raw = new DatabaseSync(path);
    try { raw.exec("DELETE FROM retention_metadata WHERE id IN ('theme_catalog_schema','native_web_policy_schema','chat_home_schema','model_preferences_schema','composer_workflows_schema','side_context_schema','retained_telemetry_schema'); PRAGMA user_version=65; CREATE TRIGGER generated_telemetry_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='retained_telemetry_schema' BEGIN SELECT RAISE(ABORT,'Generated telemetry migration interruption'); END;"); }
    finally { raw.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated telemetry migration interruption/);
    const interrupted = new DatabaseSync(path);
    try {
      assert.equal(interrupted.prepare("PRAGMA user_version").get()?.user_version, 65);
      assert.deepEqual(retainedCiphertextRows(interrupted), original);
      interrupted.exec("DROP TRIGGER generated_telemetry_failure");
    } finally { interrupted.close(); }
    reopened = new EventStore(path, fixture.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id='retained_telemetry_schema'").get()?.value, "1");
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    reopened.close(); reopened = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
  } finally { reopened?.close(); await fixture.close(); }
});

test("current telemetry provenance cannot be missing, corrupt or relabelled as older history", async (t) => {
  for (const sql of ["DELETE FROM retention_metadata WHERE id='retained_telemetry_schema'",
    "UPDATE retention_metadata SET value='0' WHERE id='retained_telemetry_schema'", "PRAGMA user_version=65"]) await t.test(sql, async () => {
    const fixture = await setupFixture(), path = fixture.service.store.path;
    try {
      await fixture.service.close();
      const raw = new DatabaseSync(path); try { if (sql.startsWith("PRAGMA")) raw.exec("DELETE FROM retention_metadata WHERE id IN ('theme_catalog_schema','native_web_policy_schema','chat_home_schema','model_preferences_schema','composer_workflows_schema','side_context_schema')"); raw.exec(sql); } finally { raw.close(); }
      assert.throws(() => new EventStore(path, fixture.retentionKey), /retained telemetry.*(marker|lineage)/i);
    } finally { await fixture.close(); }
  });
});
