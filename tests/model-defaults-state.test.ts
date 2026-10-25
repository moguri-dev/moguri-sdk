import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { MoguriSdk, PROTOCOL_VERSION, projectEvents } from "../packages/sdk/src/index.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { setupFixture } from "./fixture.ts";
import { retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";

test("schema 54 upgrades model defaults atomically without rewriting ciphertext, receipts or existing defaults", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let store: EventStore | undefined;
  try {
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated retained model-default migration draft.", attachments: [] });
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, startup: { global: { modelId: fixture.modelId }, profile: {} } }, settings.revision);
    const before = retainedCiphertextRows(fixture.service.store.db), path = fixture.service.store.path;
    sdk.disconnect(); await writeLegacyState(fixture.service, 54);
    store = new EventStore(path, fixture.retentionKey);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.equal(store.db.prepare("SELECT value FROM retention_metadata WHERE id='model_defaults_schema'").get()?.value, "1");
    assert.deepEqual(retainedCiphertextRows(store.db), before);
    const snapshot = projectEvents(store.events());
    assert.equal(snapshot.lastModelSelection, null);
    assert.equal(snapshot.settings.values.startup.global.modelId, fixture.modelId);
    assert.equal(snapshot.sessions[0]?.draft.text, "Generated retained model-default migration draft.");
    const events = store.events(); store.close(); store = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(store.events(), events); assert.deepEqual(retainedCiphertextRows(store.db), before);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); store?.close(); await fixture.close(); }
});

test("an interrupted schema-54 model-default migration retains the old version and exact encrypted rows", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let store: EventStore | undefined;
  try {
    const before = retainedCiphertextRows(fixture.service.store.db);
    await writeLegacyState(fixture.service, 54);
    const original = new DatabaseSync(path);
    try { original.exec("CREATE TRIGGER generated_model_defaults_migration_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='model_defaults_schema' BEGIN SELECT RAISE(ABORT,'Generated model defaults migration interruption'); END"); }
    finally { original.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated model defaults migration interruption/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 54);
      assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id='model_defaults_schema'").get(), undefined);
      assert.deepEqual(retainedCiphertextRows(failed), before);
      failed.exec("DROP TRIGGER generated_model_defaults_migration_failure");
    } finally { failed.close(); }
    store = new EventStore(path, fixture.retentionKey);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(store.db), before); assert.equal(fixture.requests.length, 0);
  } finally { store?.close(); await fixture.close(); }
});

test("current model-default schemas reject missing/corrupt markers without resetting retained state", async (t) => {
  for (const sql of ["DELETE FROM retention_metadata WHERE id='model_defaults_schema'", "UPDATE retention_metadata SET value='0' WHERE id='model_defaults_schema'"]) await t.test(sql, async () => {
    const fixture = await setupFixture(), path = fixture.service.store.path;
    try {
      await fixture.service.close();
      const original = new DatabaseSync(path);
      let before: ReturnType<typeof retainedCiphertextRows>;
      try { original.exec(sql); before = retainedCiphertextRows(original); } finally { original.close(); }
      assert.throws(() => new EventStore(path, fixture.retentionKey), /Missing or invalid retained model default schema marker/);
      const failed = new DatabaseSync(path);
      try { assert.deepEqual(retainedCiphertextRows(failed), before); } finally { failed.close(); }
    } finally { await fixture.close(); }
  });
});

test("genuine remembered selections cannot be relabelled as legacy model-default history", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.selectModel(fixture.sessionId, fixture.modelId);
    const before = retainedCiphertextRows(fixture.service.store.db);
    await assert.rejects(() => writeLegacyState(fixture.service, 54), /pre-model-default history/);
    assert.equal(fixture.service.store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(fixture.service.store.db), before);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("remembered model metadata cannot acquire a foreign, model-authored or forged source owner", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.selectModel(fixture.sessionId, fixture.modelId);
    const events = fixture.service.controller.events(0), index = events.findIndex((event) => event.event_type === "model.selection_remembered");
    for (const patch of [{ actor: "model" }, { sourceSessionId: "generated-unknown-source" }, { selection: { modelId: "generated-other-model" } }]) {
      const changed = structuredClone(events);
      Object.assign(changed[index]!.payload, patch);
      assert.throws(() => projectEvents(changed), /Remembered model selection/);
    }
    const wrongRoot = structuredClone(events);
    wrongRoot[index]!.project_id = fixture.session().projectId;
    assert.throws(() => projectEvents(wrongRoot), /Remembered model selection/);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
