import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { EventStore, repositoryManagementSchemaMarkers } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { removeRepositoryManagementFixtureMarkers, retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("genuine protocol90 upgrades both repository markers atomically without changing original ciphertext, receipts or grants", async () => {
  const f = await setupFixture();
  let reopened: EventStore | undefined;
  try {
    await f.service.close();
    const raw = new DatabaseSync(f.service.store.path);
    removeRepositoryManagementFixtureMarkers(raw, f.service.controller.events(0)); raw.exec("PRAGMA user_version=90");
    const before = retainedCiphertextRows(raw);
    raw.exec("CREATE TRIGGER generated_repository_migration_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='repository_remote_changes_schema' BEGIN SELECT RAISE(ABORT,'Generated repository migration interruption'); END");
    raw.close();
    assert.throws(() => new EventStore(f.service.store.path, f.retentionKey), /Generated repository migration interruption/);
    const failed = new DatabaseSync(f.service.store.path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 90);
      assert.equal(failed.prepare("SELECT count(*) AS count FROM retention_metadata WHERE id IN ('repository_import_batches_schema','repository_remote_changes_schema')").get()?.count, 0);
      assert.deepEqual(retainedCiphertextRows(failed), before);
      failed.exec("DROP TRIGGER generated_repository_migration_failure");
    } finally { failed.close(); }
    reopened = new EventStore(f.service.store.path, f.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    for (const marker of repositoryManagementSchemaMarkers) assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker)?.value, "1");
    assert.deepEqual(retainedCiphertextRows(reopened.db), before);
    reopened.close(); reopened = new EventStore(f.service.store.path, f.retentionKey);
    assert.deepEqual(retainedCiphertextRows(reopened.db), before);
  } finally { reopened?.close(); await f.close(); }
});

test("missing, corrupt or prematurely retained repository markers fail closed without relabeling existing state", async (t) => {
  for (const sql of [
    "DELETE FROM retention_metadata WHERE id='repository_import_batches_schema'",
    "UPDATE retention_metadata SET value='0' WHERE id='repository_remote_changes_schema'",
    "PRAGMA user_version=90",
  ]) await t.test(sql, async () => {
    const f = await setupFixture();
    try {
      await f.service.close();
      const raw = new DatabaseSync(f.service.store.path);
      try { raw.exec(sql); } finally { raw.close(); }
      assert.throws(() => new EventStore(f.service.store.path, f.retentionKey), /repository management/);
    } finally { await f.close(); }
  });
});
