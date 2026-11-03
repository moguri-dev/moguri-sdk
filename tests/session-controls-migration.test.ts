import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { EventStore, sessionControlsSchemaMarkers } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { removeSessionControlsFixtureMarkers, retainedCiphertextRows } from "./fixtures/legacy-state.ts";
import { envelope } from "../apps/service/src/controller.ts";

test("genuine86 upgrades all five session/tool markers atomically without rewriting ciphertext, receipts or grants", async () => {
  const f = await setupFixture(), path = f.service.store.path;
  let opened: EventStore | undefined;
  try {
    const rows = retainedCiphertextRows(f.service.store.db), events = f.service.controller.events(0);
    await f.service.close();
    const previous = new DatabaseSync(path);
    removeSessionControlsFixtureMarkers(previous, events);
    previous.exec("PRAGMA user_version=86; CREATE TRIGGER generated_session_controls_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='language_app_tools_schema' BEGIN SELECT RAISE(ABORT,'Generated protocol87 interruption'); END;");
    previous.close();
    assert.throws(() => new EventStore(path, f.retentionKey), /Generated protocol87 interruption/);
    const preserved = new DatabaseSync(path);
    assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 86);
    for (const marker of sessionControlsSchemaMarkers) assert.equal(preserved.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker), undefined);
    assert.deepEqual(retainedCiphertextRows(preserved), rows);
    preserved.exec("DROP TRIGGER generated_session_controls_failure"); preserved.close();
    opened = new EventStore(path, f.retentionKey);
    assert.equal(opened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    for (const marker of sessionControlsSchemaMarkers) assert.equal(opened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker)?.value, "1");
    assert.deepEqual(retainedCiphertextRows(opened.db), rows);
    opened.close(); opened = new EventStore(path, f.retentionKey);
    assert.deepEqual(retainedCiphertextRows(opened.db), rows);
  } finally { opened?.close(); await f.close(); }
});

for (const lineage of ["missing", "corrupt", "premature", "downgraded"] as const) test(`session/tool ${lineage} provenance fails closed without rewriting original history`, async () => {
  const f = await setupFixture(), path = f.service.store.path;
  try {
    if (lineage === "downgraded") {
      const settings = structuredClone(f.service.controller.snapshot().settings.values);
      await f.service.controller.dispatch(envelope({ type: "settings.update", settings,
        expectedRevision: f.service.controller.snapshot().settings.revision, acknowledgePromptRisk: false }));
    }
    const rows = retainedCiphertextRows(f.service.store.db), events = f.service.controller.events(0);
    await f.service.close();
    const changed = new DatabaseSync(path);
    if (lineage === "missing") changed.prepare("DELETE FROM retention_metadata WHERE id=?").run("chat_outputs_schema");
    else if (lineage === "corrupt") changed.prepare("UPDATE retention_metadata SET value='0' WHERE id=?").run("voice_lifecycle_schema");
    else if (lineage === "premature") changed.exec("PRAGMA user_version=86");
    else {
      assert.throws(() => removeSessionControlsFixtureMarkers(changed, events), /genuine pre-87/);
      for (const marker of sessionControlsSchemaMarkers) changed.prepare("DELETE FROM retention_metadata WHERE id=?").run(marker);
      changed.exec("PRAGMA user_version=86");
    }
    changed.close();
    assert.throws(() => new EventStore(path, f.retentionKey), /marker|lineage|history.*pre-87/i);
    const preserved = new DatabaseSync(path);
    try { assert.deepEqual(retainedCiphertextRows(preserved), rows); }
    finally { preserved.close(); }
  } finally { await f.close(); }
});
