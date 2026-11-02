import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { MoguriSdk, PROTOCOL_VERSION, projectEvents } from "../packages/sdk/src/index.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { setupFixture } from "./fixture.ts";
import { removePost77FixtureMarkers, retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";

test("schema 54 upgrades model defaults atomically without rewriting ciphertext, receipts or existing defaults", async () => {
  const fixture = await setupFixture({ legacySessionControlsJournal: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
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
    for (const patch of [{ actor: "model" }, { sourceSessionId: "generated-unknown-source" }, { selection: { modelId: "generated-other-model" } },
      { selection: { modelId: fixture.modelId, preferredThinkingEffort: "max" } }]) {
      const changed = structuredClone(events);
      Object.assign(changed[index]!.payload, patch);
      assert.throws(() => projectEvents(changed), /Remembered model selection/);
    }
    const wrongRoot = structuredClone(events);
    wrongRoot[index]!.project_id = fixture.session().projectId;
    assert.throws(() => projectEvents(wrongRoot), /Remembered model selection/);
    for (const patch of [{ artifact_id: "generated-wrong-retention-owner" }, { turn_id: "generated-wrong-model-turn" }]) {
      const changed = structuredClone(events); Object.assign(changed[index]!, patch);
      assert.throws(() => projectEvents(changed), /Remembered model selection/);
    }
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

async function writePreContinuityState(service: Awaited<ReturnType<typeof setupFixture>>["service"]) {
  const events = service.store.events();
  if (events.some((event) => (event.event_type === "session.created" || event.event_type === "session.configured") &&
    event.payload.controls.preferredThinkingEffort !== undefined || event.event_type === "model.selection_remembered" &&
    event.payload.selection?.preferredThinkingEffort !== undefined)) throw new Error("Generate actual pre-continuity controls, not relabelled model preferences.");
  const path = service.store.path; await service.close();
  const db = new DatabaseSync(path);
  try { removePost77FixtureMarkers(db, events); db.exec("BEGIN IMMEDIATE; DELETE FROM retention_metadata WHERE id='model_selection_continuity_schema'; PRAGMA user_version=76; COMMIT;"); }
  finally { db.close(); }
}

test("schema 76 upgrades model continuity without rewriting encrypted history, receipts or legacy effort", async () => {
  const fixture = await setupFixture({ reasoning: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let store: EventStore | undefined;
  try {
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: fixture.modelId, modelOptions: { thinkingEffort: "high" } });
    const before = retainedCiphertextRows(fixture.service.store.db), path = fixture.service.store.path;
    const metadata = fixture.service.store.db.prepare("SELECT id,value FROM retention_metadata ORDER BY id").all();
    sdk.disconnect(); await writePreContinuityState(fixture.service);
    store = new EventStore(path, fixture.retentionKey);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(store.db.prepare("SELECT id,value FROM retention_metadata ORDER BY id").all(), metadata);
    assert.equal(store.db.prepare("SELECT value FROM retention_metadata WHERE id='model_selection_continuity_schema'").get()?.value, "1");
    assert.deepEqual(retainedCiphertextRows(store.db), before);
    const snapshot = projectEvents(store.events());
    assert.deepEqual(snapshot.sessions[0]?.controls.modelOptions, { thinkingEffort: "high" });
    assert.equal(snapshot.sessions[0]?.controls.preferredThinkingEffort, undefined);
    const events = store.events(); store.close(); store = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(store.events(), events); assert.deepEqual(retainedCiphertextRows(store.db), before);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); store?.close(); await fixture.close(); }
});

test("interrupted continuity marker insertion preserves its old version and bytes before exact recovery", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let store: EventStore | undefined;
  try {
    const before = retainedCiphertextRows(fixture.service.store.db);
    await writePreContinuityState(fixture.service);
    const raw = new DatabaseSync(path);
    try { raw.exec("CREATE TRIGGER generated_continuity_migration_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='model_selection_continuity_schema' BEGIN SELECT RAISE(ABORT,'Generated continuity marker interruption'); END"); }
    finally { raw.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated continuity marker interruption/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 76);
      assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id='model_selection_continuity_schema'").get(), undefined);
      assert.deepEqual(retainedCiphertextRows(failed), before);
      failed.exec("DROP TRIGGER generated_continuity_migration_failure");
    } finally { failed.close(); }
    store = new EventStore(path, fixture.retentionKey);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(store.db), before);
  } finally { store?.close(); await fixture.close(); }
});

test("actual retained effort preferences cannot be relabelled as pre-continuity history", async () => {
  const fixture = await setupFixture({ reasoning: true }), sdk = await new MoguriSdk(fixture.service.connection).ready(), path = fixture.service.store.path;
  try {
    fixture.provider.state.models[0]!.thinkingLevels = ["low", "high"]; fixture.provider.onChange(); await sdk.refresh();
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: fixture.modelId,
      preferredThinkingEffort: "max", modelOptions: { thinkingEffort: "high" } });
    const before = retainedCiphertextRows(fixture.service.store.db);
    sdk.disconnect(); await fixture.service.close();
    const db = new DatabaseSync(path); try { db.exec("DELETE FROM retention_metadata WHERE id='model_selection_continuity_schema'; PRAGMA user_version=76;"); } finally { db.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Premature workspace schema marker/i);
    const failed = new DatabaseSync(path); try { assert.deepEqual(retainedCiphertextRows(failed), before); } finally { failed.close(); }
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("missing, corrupt or premature continuity markers are not repaired from a version number", async (t) => {
  for (const sql of ["DELETE FROM retention_metadata WHERE id='model_selection_continuity_schema'",
    "UPDATE retention_metadata SET value='0' WHERE id='model_selection_continuity_schema'", "PRAGMA user_version=76"]) await t.test(sql, async () => {
    const fixture = await setupFixture(), path = fixture.service.store.path;
    try {
      const before = retainedCiphertextRows(fixture.service.store.db);
      await fixture.service.close();
      const raw = new DatabaseSync(path); try { raw.exec(sql); } finally { raw.close(); }
      assert.throws(() => new EventStore(path, fixture.retentionKey), sql.startsWith("PRAGMA") ? /Premature workspace schema marker/i : /model selection continuity schema marker/i);
      const preserved = new DatabaseSync(path); try { assert.deepEqual(retainedCiphertextRows(preserved), before); } finally { preserved.close(); }
    } finally { await fixture.close(); }
  });
});

test("the standalone build refuses a theme-bearing numeric downgrade without repairing either feature lineage", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  try {
    const before = retainedCiphertextRows(fixture.service.store.db);
    await fixture.service.close();
    const raw = new DatabaseSync(path);
    try { raw.exec("DELETE FROM retention_metadata WHERE id='model_selection_continuity_schema'; PRAGMA user_version=78;"); }
    finally { raw.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Premature workspace schema marker/i);
    const preserved = new DatabaseSync(path);
    try {
      assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 78);
      assert.equal(preserved.prepare("SELECT value FROM retention_metadata WHERE id='model_selection_continuity_schema'").get(), undefined);
      assert.deepEqual(retainedCiphertextRows(preserved), before);
    } finally { preserved.close(); }
  } finally { await fixture.close(); }
});
