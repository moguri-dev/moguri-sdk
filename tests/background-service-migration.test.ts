import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { EventStore, backgroundServiceSchemaMarker, myWorkSchemaMarker } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { myWorkFixture } from "./my-work-fixture.ts";
import { removeOtlpExportFixtureMarker, retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("genuine95 inbox history upgrades background-service policy atomically without rewriting original ciphertext or grants", async () => {
  const key = Buffer.alloc(32, 0x73), f = await myWorkFixture({ retentionKey: key });
  let reopened: EventStore | undefined;
  try {
    await f.configure(f.first);
    const refresh = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(refresh.id!);
    const path = f.service.store.path;
    f.sdk.disconnect(); await f.service.close();
    const raw = new DatabaseSync(path);
    removeOtlpExportFixtureMarker(raw, f.service.controller.events(0));
    raw.prepare("DELETE FROM retention_metadata WHERE id=?").run(backgroundServiceSchemaMarker);
    raw.exec("PRAGMA user_version=95");
    assert.equal(raw.prepare("SELECT value FROM retention_metadata WHERE id=?").get(myWorkSchemaMarker)?.value, "1");
    assert.ok(raw.prepare("SELECT seq FROM events WHERE json_extract(data,'$.event_type')='my_work.refresh_recorded'").get());
    const original = retainedCiphertextRows(raw);
    raw.exec("CREATE TRIGGER generated_background_migration_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='background_service_schema' BEGIN SELECT RAISE(ABORT,'Generated background migration interruption'); END");
    raw.close();
    assert.throws(() => new EventStore(path, key), /Generated background migration interruption/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 95);
      assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id=?").get(myWorkSchemaMarker)?.value, "1");
      assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id=?").get(backgroundServiceSchemaMarker), undefined);
      assert.deepEqual(retainedCiphertextRows(failed), original);
      failed.exec("DROP TRIGGER generated_background_migration_failure");
    } finally { failed.close(); }
    reopened = new EventStore(path, key);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(backgroundServiceSchemaMarker)?.value, "1");
    assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(myWorkSchemaMarker)?.value, "1");
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    reopened.close(); reopened = new EventStore(path, key);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
  } finally { reopened?.close(); await f.close(); }
});

test("missing, corrupt and premature background policy lineage stays rejected without replacing genuine inbox provenance", async (t) => {
  for (const variant of ["missing", "corrupt", "premature", "future-history"] as const) await t.test(variant, async () => {
    const key = Buffer.alloc(32, 0x73), f = await myWorkFixture({ retentionKey: key });
    try {
      if (variant === "future-history") await f.sdk.application.configure({ keepServiceOnWindowClose: false }, 0);
      const path = f.service.store.path; f.sdk.disconnect(); await f.service.close();
      const raw = new DatabaseSync(path);
      if (variant === "missing" || variant === "future-history") raw.prepare("DELETE FROM retention_metadata WHERE id=?").run(backgroundServiceSchemaMarker);
      if (variant === "corrupt") raw.prepare("UPDATE retention_metadata SET value='0' WHERE id=?").run(backgroundServiceSchemaMarker);
      if (variant === "premature" || variant === "future-history") {
        removeOtlpExportFixtureMarker(raw, f.service.controller.events(0)); raw.exec("PRAGMA user_version=95");
      }
      const original = retainedCiphertextRows(raw); raw.close();
      assert.throws(() => new EventStore(path, key), /background service/i);
      const preserved = new DatabaseSync(path);
      try {
        assert.deepEqual(retainedCiphertextRows(preserved), original);
        assert.equal(preserved.prepare("SELECT value FROM retention_metadata WHERE id=?").get(myWorkSchemaMarker)?.value, "1");
      } finally { preserved.close(); }
    } finally { await f.close(); }
  });
});
