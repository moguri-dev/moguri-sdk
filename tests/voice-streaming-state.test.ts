import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("protocol 70 dictation repair advances only metadata and recovers without rewriting original model preferences or encrypted state", async (t) => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), path = fixture.service.store.path;
  let reopened: EventStore | undefined;
  try {
    assert.ok(PROTOCOL_VERSION >= 71);
    await sdk.models.setEnabled(fixture.modelId, false);
    const original = retainedCiphertextRows(fixture.service.store.db);
    sdk.disconnect(); await fixture.service.close();
    const raw = new DatabaseSync(path);
    try { raw.exec("DELETE FROM retention_metadata WHERE id IN ('model_selection_continuity_schema','native_web_policy_schema','chat_home_schema'); PRAGMA user_version=70"); } finally { raw.close(); }
    const exec = DatabaseSync.prototype.exec;
    const fault = t.mock.method(DatabaseSync.prototype, "exec", function (this: DatabaseSync, sql: string) {
      if (/PRAGMA user_version=71/.test(sql)) throw new Error("Generated dictation metadata interruption");
      return exec.call(this, sql);
    });
    try { assert.throws(() => new EventStore(path, fixture.retentionKey), /dictation metadata interruption/); }
    finally { fault.mock.restore(); }
    const interrupted = new DatabaseSync(path);
    try {
      assert.equal(interrupted.prepare("PRAGMA user_version").get()?.user_version, 70);
      assert.deepEqual(retainedCiphertextRows(interrupted), original);
    } finally { interrupted.close(); }
    reopened = new EventStore(path, fixture.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    reopened.close(); reopened = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); reopened?.close(); await fixture.close(); }
});
