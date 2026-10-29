import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { removePost77FixtureMarkers, retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("schema 68 tuning qualification upgrades only metadata, preserves encrypted state and recovers after an interrupted advance", async (t) => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let reopened: EventStore | undefined;
  try {
    assert.ok(PROTOCOL_VERSION >= 69);
    const original = retainedCiphertextRows(fixture.service.store.db);
    await fixture.service.close();
    const raw = new DatabaseSync(path);
    try { removePost77FixtureMarkers(raw, fixture.service.controller.events(0)); raw.exec("DELETE FROM retention_metadata WHERE id IN ('model_selection_continuity_schema','native_web_policy_schema','chat_home_schema','model_preferences_schema'); PRAGMA user_version=68"); } finally { raw.close(); }
    const exec = DatabaseSync.prototype.exec;
    const fault = t.mock.method(DatabaseSync.prototype, "exec", function (this: DatabaseSync, sql: string) {
      if (/PRAGMA user_version=69/.test(sql)) throw new Error("Generated model-tuning metadata interruption");
      return exec.call(this, sql);
    });
    try { assert.throws(() => new EventStore(path, fixture.retentionKey), /model-tuning metadata interruption/); }
    finally { fault.mock.restore(); }
    const interrupted = new DatabaseSync(path);
    try {
      assert.equal(interrupted.prepare("PRAGMA user_version").get()?.user_version, 68);
      assert.deepEqual(retainedCiphertextRows(interrupted), original);
    } finally { interrupted.close(); }
    reopened = new EventStore(path, fixture.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    reopened.close(); reopened = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    assert.equal(fixture.requests.length, 0);
  } finally { reopened?.close(); await fixture.close(); }
});
