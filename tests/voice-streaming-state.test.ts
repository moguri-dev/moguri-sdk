import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { defaultModelPreferences, MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { removePost77FixtureMarkers, retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("protocol 70 dictation repair advances only metadata and recovers without rewriting original model preferences or encrypted state", async (t) => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), path = fixture.service.store.path;
  let reopened: EventStore | undefined;
  try {
    assert.ok(PROTOCOL_VERSION >= 71);
    const settings = structuredClone(fixture.service.controller.snapshot().settings);
    delete settings.values.voice.enabled; delete settings.values.voice.standby;
    settings.values.modelPreferences = { ...defaultModelPreferences(),
      disabledModels: [fixture.service.controller.snapshot().provider.models.find((model) => model.id === fixture.modelId)!.apiModelId ?? fixture.modelId] };
    fixture.service.store.commit([{ event_type: "settings.updated", profile_id: "default", payload: {
      settings: settings.values, revision: settings.revision + 1, permissionRevision: settings.permissionRevision,
    } }]);
    fixture.service.controller.refreshProfile(); await sdk.refresh();
    const original = retainedCiphertextRows(fixture.service.store.db);
    sdk.disconnect(); await fixture.service.close();
    const raw = new DatabaseSync(path);
    try { removePost77FixtureMarkers(raw, fixture.service.controller.events(0)); raw.exec("DELETE FROM retention_metadata WHERE id IN ('model_selection_continuity_schema','native_web_policy_schema','chat_home_schema'); PRAGMA user_version=70"); } finally { raw.close(); }
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
