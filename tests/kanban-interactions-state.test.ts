import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { EventStore } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("schema 63 upgrades Kanban interactions atomically, retaining exact ciphertext, receipts and reopening after interruption", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let store: EventStore | undefined;
  try {
    const before = retainedCiphertextRows(fixture.service.store.db);
    await fixture.service.close();
    const raw = new DatabaseSync(path);
    try {
      raw.exec("DELETE FROM retention_metadata WHERE id IN ('side_context_schema','retained_telemetry_schema','session_reliability_schema','kanban_interactions_schema'); PRAGMA user_version=63; CREATE TRIGGER generated_kanban_interactions_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='kanban_interactions_schema' BEGIN SELECT RAISE(ABORT,'Generated interaction migration interruption'); END;");
    } finally { raw.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated interaction migration interruption/);
    const interrupted = new DatabaseSync(path);
    try {
      assert.equal(interrupted.prepare("PRAGMA user_version").get()?.user_version, 63);
      assert.deepEqual(retainedCiphertextRows(interrupted), before);
      interrupted.exec("DROP TRIGGER generated_kanban_interactions_failure");
    } finally { interrupted.close(); }
    store = new EventStore(path, fixture.retentionKey);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(store.db), before);
    store.close(); store = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(retainedCiphertextRows(store.db), before);
  } finally { store?.close(); await fixture.close(); }
});

test("current interaction metadata cannot be silently repaired or relabelled as older state", async (t) => {
  for (const change of ["DELETE FROM retention_metadata WHERE id='kanban_interactions_schema'",
    "UPDATE retention_metadata SET value='0' WHERE id='kanban_interactions_schema'", "PRAGMA user_version=63"]) await t.test(change, async () => {
    const fixture = await setupFixture(), path = fixture.service.store.path;
    try {
      await fixture.service.close(); const raw = new DatabaseSync(path);
      let before: ReturnType<typeof retainedCiphertextRows>;
      try { if (change.startsWith("PRAGMA")) raw.exec("DELETE FROM retention_metadata WHERE id IN ('side_context_schema','retained_telemetry_schema')"); raw.exec(change); before = retainedCiphertextRows(raw); } finally { raw.close(); }
      assert.throws(() => new EventStore(path, fixture.retentionKey), /Kanban interactions.*(marker|lineage)/);
      const preserved = new DatabaseSync(path);
      try { assert.deepEqual(retainedCiphertextRows(preserved), before); } finally { preserved.close(); }
    } finally { await fixture.close(); }
  });
});
