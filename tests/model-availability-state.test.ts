import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("the 69-to-70 availability upgrade is atomic and never rewrites retained history, ciphertext or receipts", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let reopened: EventStore | undefined;
  try {
    assert.ok(PROTOCOL_VERSION >= 70);
    const original = retainedCiphertextRows(fixture.service.store.db);
    await fixture.service.close();
    const raw = new DatabaseSync(path);
    try { raw.exec("DELETE FROM retention_metadata WHERE id IN ('model_selection_continuity_schema','native_web_policy_schema','chat_home_schema','model_preferences_schema'); PRAGMA user_version=69; CREATE TRIGGER generated_availability_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='model_preferences_schema' BEGIN SELECT RAISE(ABORT,'Generated availability migration interruption'); END;"); }
    finally { raw.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated availability migration interruption/);
    const interrupted = new DatabaseSync(path);
    try {
      assert.equal(interrupted.prepare("PRAGMA user_version").get()?.user_version, 69);
      assert.equal(interrupted.prepare("SELECT value FROM retention_metadata WHERE id='model_preferences_schema'").get(), undefined);
      assert.deepEqual(retainedCiphertextRows(interrupted), original);
      interrupted.exec("DROP TRIGGER generated_availability_failure");
    } finally { interrupted.close(); }
    reopened = new EventStore(path, fixture.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    reopened.close(); reopened = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    assert.equal(fixture.requests.length, 0);
  } finally { reopened?.close(); await fixture.close(); }
});

test("missing, corrupt and premature availability markers fail without repairing or relabelling data", async (t) => {
  for (const sql of ["DELETE FROM retention_metadata WHERE id='model_preferences_schema'",
    "UPDATE retention_metadata SET value='0' WHERE id='model_preferences_schema'", "DELETE FROM retention_metadata WHERE id='model_selection_continuity_schema'; PRAGMA user_version=69"]) await t.test(sql, async () => {
    const fixture = await setupFixture();
    try {
      await fixture.service.close(); const raw = new DatabaseSync(fixture.service.store.path);
      let original;
      try { raw.exec(sql); original = retainedCiphertextRows(raw); } finally { raw.close(); }
      assert.throws(() => new EventStore(fixture.service.store.path, fixture.retentionKey), /model preference.*(marker|lineage)/i);
      const preserved = new DatabaseSync(fixture.service.store.path);
      try { assert.deepEqual(retainedCiphertextRows(preserved), original); } finally { preserved.close(); }
    } finally { await fixture.close(); }
  });
});

test("actual preference history cannot be relabelled as schema 69 by deleting its marker", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.models.setEnabled(fixture.modelId, false);
    sdk.disconnect(); await fixture.service.close();
    const raw = new DatabaseSync(fixture.service.store.path);
    let original;
    try { raw.exec("DELETE FROM retention_metadata WHERE id IN ('model_selection_continuity_schema','model_preferences_schema'); PRAGMA user_version=69"); original = retainedCiphertextRows(raw); }
    finally { raw.close(); }
    assert.throws(() => new EventStore(fixture.service.store.path, fixture.retentionKey), /preference history cannot be relabelled/);
    const preserved = new DatabaseSync(fixture.service.store.path);
    try { assert.deepEqual(retainedCiphertextRows(preserved), original); } finally { preserved.close(); }
  } finally { sdk.disconnect(); await fixture.close(); }
});
