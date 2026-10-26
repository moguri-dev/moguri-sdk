import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { defaultSingleKupoSettings, MoguriSdk, PROTOCOL_VERSION, projectEvents } from "../packages/sdk/src/index.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { setupFixture } from "./fixture.ts";
import { retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("schema 58 upgrades Kupo atomically while preserving ciphertext, receipts and explicit legacy policy", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let store: EventStore | undefined;
  try {
    const policy = { ...defaultSingleKupoSettings(), classifierModelId: fixture.modelId };
    await sdk.routing.configure(policy, sdk.settings.get()!.revision);
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated retained Kupo migration draft.", attachments: [] });
    const before = retainedCiphertextRows(fixture.service.store.db), path = fixture.service.store.path;
    sdk.disconnect(); await fixture.service.close();
    const legacy = new DatabaseSync(path);
    try { legacy.exec("DELETE FROM retention_metadata WHERE id='automatic_kupo_schema'; PRAGMA user_version=58"); } finally { legacy.close(); }
    store = new EventStore(path, fixture.retentionKey);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.equal(store.db.prepare("SELECT value FROM retention_metadata WHERE id='automatic_kupo_schema'").get()?.value, "1");
    assert.deepEqual(retainedCiphertextRows(store.db), before);
    const state = projectEvents(store.events());
    assert.deepEqual(state.settings.values.kupo, policy);
    assert.equal(state.sessions[0]?.draft.text, "Generated retained Kupo migration draft.");
    const events = store.events(); store.close(); store = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(store.events(), events);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); store?.close(); await fixture.close(); }
});

test("an interrupted automatic Kupo migration leaves schema 58 and all retained bytes unchanged", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let store: EventStore | undefined;
  try {
    const before = retainedCiphertextRows(fixture.service.store.db); await fixture.service.close();
    const legacy = new DatabaseSync(path);
    try { legacy.exec("DELETE FROM retention_metadata WHERE id='automatic_kupo_schema'; PRAGMA user_version=58; CREATE TRIGGER generated_kupo_migration_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='automatic_kupo_schema' BEGIN SELECT RAISE(ABORT,'Generated Kupo migration interruption'); END"); } finally { legacy.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated Kupo migration interruption/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 58);
      assert.deepEqual(retainedCiphertextRows(failed), before);
      failed.exec("DROP TRIGGER generated_kupo_migration_failure");
    } finally { failed.close(); }
    store = new EventStore(path, fixture.retentionKey);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(store.db), before);
  } finally { store?.close(); await fixture.close(); }
});

test("automatic Kupo state rejects missing or corrupt current schema markers without resetting data", async (t) => {
  for (const sql of ["DELETE FROM retention_metadata WHERE id='automatic_kupo_schema'", "UPDATE retention_metadata SET value='0' WHERE id='automatic_kupo_schema'"]) await t.test(sql, async () => {
    const fixture = await setupFixture(), path = fixture.service.store.path;
    try {
      await fixture.service.close();
      const current = new DatabaseSync(path);
      let before: ReturnType<typeof retainedCiphertextRows>;
      try { current.exec(sql); before = retainedCiphertextRows(current); } finally { current.close(); }
      assert.throws(() => new EventStore(path, fixture.retentionKey), /automatic Kupo schema marker/);
      const failed = new DatabaseSync(path);
      try { assert.deepEqual(retainedCiphertextRows(failed), before); } finally { failed.close(); }
    } finally { await fixture.close(); }
  });
});

test("actual automatic routing ownership cannot be relabelled as schema 58", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 128 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.selectModel(fixture.sessionId, "kupo"); await fixture.send("Generated actual retained automatic route."); await fixture.terminal();
    const path = fixture.service.store.path; sdk.disconnect(); await fixture.service.close();
    const legacy = new DatabaseSync(path);
    try { legacy.exec("DELETE FROM retention_metadata WHERE id='automatic_kupo_schema'; PRAGMA user_version=58"); } finally { legacy.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Automatic Kupo history/);
  } finally { sdk.disconnect(); await fixture.close(); }
});
