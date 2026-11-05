import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { setupFixture } from "./fixture.ts";
import { removeChatTitleFixtureMarkers, retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("schema89-to90 marker admission rolls back/reopens without changing original encrypted events, grants or receipts", async () => {
  const f = await setupFixture(), path = f.service.store.path;
  let current: EventStore | undefined;
  try {
    await f.service.close();
    const raw = new DatabaseSync(path);
    removeChatTitleFixtureMarkers(raw, f.service.controller.events(0));
    raw.exec("PRAGMA user_version=89");
    const before = retainedCiphertextRows(raw);
    raw.exec("CREATE TRIGGER generated_naming_migration_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='live_delivery_schema' BEGIN SELECT RAISE(ABORT,'Generated paired naming migration failure'); END");
    raw.close();
    assert.throws(() => new EventStore(path, f.retentionKey), /Generated paired naming migration failure/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 89);
      assert.equal(failed.prepare("SELECT count(*) AS count FROM retention_metadata WHERE id IN ('chat_titles_schema','live_delivery_schema')").get()?.count, 0);
      assert.deepEqual(retainedCiphertextRows(failed), before);
      assert.equal(failed.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name IN ('events_profile_sequence','events_type_sequence')").get()?.count, 2);
      failed.exec("DROP TRIGGER generated_naming_migration_failure");
    } finally { failed.close(); }
    current = new EventStore(path, f.retentionKey);
    assert.equal(current.db.prepare("PRAGMA user_version").get()?.user_version, 90);
    assert.deepEqual(retainedCiphertextRows(current.db), before);
    current.close(); current = new EventStore(path, f.retentionKey);
    assert.deepEqual(retainedCiphertextRows(current.db), before);
    assert.equal(f.requests.length, 0);
  } finally { current?.close(); await f.close(); }
});

test("current naming/live markers cannot be missing, corrupt or retrograded to89", async (t) => {
  for (const sql of [
    "DELETE FROM retention_metadata WHERE id='chat_titles_schema'",
    "UPDATE retention_metadata SET value='0' WHERE id='live_delivery_schema'",
    "PRAGMA user_version=89",
  ]) await t.test(sql, async () => {
    const f = await setupFixture();
    try {
      await f.service.close();
      const raw = new DatabaseSync(f.service.store.path); try { raw.exec(sql); } finally { raw.close(); }
      assert.throws(() => new EventStore(f.service.store.path, f.retentionKey), /chat naming\/live delivery/);
    } finally { await f.close(); }
  });
});
