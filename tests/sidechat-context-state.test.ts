import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("schema 66 side-context upgrade rolls back atomically and preserves original history, encrypted grants and receipts", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let reopened: EventStore | undefined;
  try {
    assert.equal(PROTOCOL_VERSION, 67);
    const original = retainedCiphertextRows(fixture.service.store.db);
    await fixture.service.close();
    const raw = new DatabaseSync(path);
    try { raw.exec("DELETE FROM retention_metadata WHERE id='side_context_schema'; PRAGMA user_version=66; CREATE TRIGGER generated_side_schema_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='side_context_schema' BEGIN SELECT RAISE(ABORT,'Generated side migration interruption'); END;"); }
    finally { raw.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated side migration interruption/);
    const interrupted = new DatabaseSync(path);
    try {
      assert.equal(interrupted.prepare("PRAGMA user_version").get()?.user_version, 66);
      assert.deepEqual(retainedCiphertextRows(interrupted), original);
      interrupted.exec("DROP TRIGGER generated_side_schema_failure");
    } finally { interrupted.close(); }
    reopened = new EventStore(path, fixture.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id='side_context_schema'").get()?.value, "1");
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    reopened.close(); reopened = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
  } finally { reopened?.close(); await fixture.close(); }
});

test("current side-context provenance cannot be missing, corrupted or relabelled as older history", async (t) => {
  for (const sql of ["DELETE FROM retention_metadata WHERE id='side_context_schema'",
    "UPDATE retention_metadata SET value='0' WHERE id='side_context_schema'", "PRAGMA user_version=66"]) await t.test(sql, async () => {
    const fixture = await setupFixture(), path = fixture.service.store.path;
    try {
      await fixture.service.close();
      const raw = new DatabaseSync(path); try { raw.exec(sql); } finally { raw.close(); }
      assert.throws(() => new EventStore(path, fixture.retentionKey), /side context.*(marker|lineage)/i);
    } finally { await fixture.close(); }
  });
});
