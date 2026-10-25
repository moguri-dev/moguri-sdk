import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { EventStore } from "../apps/service/src/store.ts";
import { MoguriSdk, PROTOCOL_VERSION, projectEvents } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";

test("schema 55 upgrades browser protocol metadata without rewriting history, receipts or remembered model choices", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let store: EventStore | undefined;
  try {
    await sdk.sessions.selectModel(fixture.sessionId, fixture.modelId);
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated retained browser-upgrade draft.", attachments: [] });
    const before = retainedCiphertextRows(fixture.service.store.db), path = fixture.service.store.path;
    sdk.disconnect(); await writeLegacyState(fixture.service, 55);
    store = new EventStore(path, fixture.retentionKey);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.equal(store.db.prepare("SELECT value FROM retention_metadata WHERE id='browser_control_schema'").get()?.value, "1");
    assert.deepEqual(retainedCiphertextRows(store.db), before);
    const snapshot = projectEvents(store.events());
    assert.equal(snapshot.lastModelSelection?.modelId, fixture.modelId);
    assert.equal(snapshot.sessions[0]?.draft.text, "Generated retained browser-upgrade draft.");
    const events = store.events(); store.close(); store = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(store.events(), events); assert.deepEqual(retainedCiphertextRows(store.db), before);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); store?.close(); await fixture.close(); }
});

test("an interrupted schema-55 browser upgrade rolls back its marker and preserves exact encrypted state", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let store: EventStore | undefined;
  try {
    const before = retainedCiphertextRows(fixture.service.store.db);
    await writeLegacyState(fixture.service, 55);
    const original = new DatabaseSync(path);
    try { original.exec("CREATE TRIGGER generated_browser_migration_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='browser_control_schema' BEGIN SELECT RAISE(ABORT,'Generated browser migration interruption'); END"); }
    finally { original.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated browser migration interruption/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 55);
      assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id='browser_control_schema'").get(), undefined);
      assert.deepEqual(retainedCiphertextRows(failed), before);
      failed.exec("DROP TRIGGER generated_browser_migration_failure");
    } finally { failed.close(); }
    store = new EventStore(path, fixture.retentionKey);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(store.db), before);
  } finally { store?.close(); await fixture.close(); }
});

test("current browser protocol metadata rejects missing or corrupt markers without resetting state", async (context) => {
  for (const sql of ["DELETE FROM retention_metadata WHERE id='browser_control_schema'", "UPDATE retention_metadata SET value='0' WHERE id='browser_control_schema'"]) {
    await context.test(sql, async () => {
      const fixture = await setupFixture(), path = fixture.service.store.path;
      try {
        await fixture.service.close();
        const original = new DatabaseSync(path);
        let before: ReturnType<typeof retainedCiphertextRows>;
        try { original.exec(sql); before = retainedCiphertextRows(original); } finally { original.close(); }
        assert.throws(() => new EventStore(path, fixture.retentionKey), /Missing or invalid browser control schema marker/);
        const failed = new DatabaseSync(path);
        try { assert.deepEqual(retainedCiphertextRows(failed), before); } finally { failed.close(); }
      } finally { await fixture.close(); }
    });
  }
});
