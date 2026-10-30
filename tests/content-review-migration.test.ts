import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { EventStore } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { scriptReviewFixture } from "./fixtures/script-review.ts";
import { removeContentReviewFixtureMarkers, retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("genuine82 upgrades append both83 markers atomically and preserve ciphertext, receipts, controls and reopening", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let reopened: EventStore | undefined;
  try {
    const events = fixture.service.controller.events(0), rows = retainedCiphertextRows(fixture.service.store.db);
    await fixture.service.close();
    const raw = new DatabaseSync(path);
    removeContentReviewFixtureMarkers(raw, events);
    raw.exec("PRAGMA user_version=82; CREATE TRIGGER generated_safety_upgrade BEFORE INSERT ON retention_metadata WHEN NEW.id='repository_script_review_schema' BEGIN SELECT RAISE(ABORT,'Generated content review migration interruption'); END;");
    raw.close();
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated content review migration interruption/);
    const failed = new DatabaseSync(path);
    assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 82);
    assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id='work_item_comments_schema'").get(), undefined);
    assert.deepEqual(retainedCiphertextRows(failed), rows);
    failed.exec("DROP TRIGGER generated_safety_upgrade"); failed.close();
    reopened = new EventStore(path, fixture.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    for (const id of ["work_item_comments_schema", "repository_script_review_schema", "workflow_commands_schema", "tool_preferences_schema"]) {
      assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(id)?.value, "1");
    }
    assert.deepEqual(retainedCiphertextRows(reopened.db), rows);
    reopened.close(); reopened = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(retainedCiphertextRows(reopened.db), rows);
  } finally { reopened?.close(); await fixture.close(); }
});

test("actual83 review history cannot be relabeled as82 or manufacture a missing current marker", { skip: process.platform !== "darwin" }, async (t) => {
  for (const mode of ["downgrade", "missing"] as const) await t.test(mode, async () => {
    const fixture = await scriptReviewFixture({ unsafe: true }), path = fixture.service.store.path;
    try {
      await fixture.send("Generated genuine script review lineage."); await fixture.terminal();
      const rows = retainedCiphertextRows(fixture.service.store.db), events = fixture.service.controller.events(0);
      fixture.sdk.disconnect(); await fixture.service.close();
      const raw = new DatabaseSync(path);
      assert.throws(() => removeContentReviewFixtureMarkers(raw, events), /genuine pre-83/);
      raw.exec("DELETE FROM retention_metadata WHERE id='repository_script_review_schema'");
      if (mode === "downgrade") raw.exec("DELETE FROM retention_metadata WHERE id='work_item_comments_schema'; PRAGMA user_version=82");
      raw.close();
      assert.throws(() => new EventStore(path, fixture.retentionKey), mode === "downgrade" ? /pre-83 lineage/ : /content\/script review.*marker/);
      const preserved = new DatabaseSync(path);
      assert.deepEqual(retainedCiphertextRows(preserved), rows); preserved.close();
    } finally { await fixture.close(); }
  });
});
