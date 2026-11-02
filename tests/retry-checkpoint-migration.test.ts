import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { EventStore } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { removeRetryCheckpointFixtureMarkers, retainedCiphertextRows } from "./fixtures/legacy-state.ts";
import { envelope } from "../apps/service/src/controller.ts";

test("genuine85 migrates private retry/checkpoint markers atomically and preserves ciphertext, receipts and reopen", async () => {
  const f = await setupFixture(), path = f.service.store.path;
  let opened: EventStore | undefined;
  try {
    const rows = retainedCiphertextRows(f.service.store.db), events = f.service.controller.events(0);
    await f.service.close();
    const previous = new DatabaseSync(path); removeRetryCheckpointFixtureMarkers(previous, events);
    previous.exec("PRAGMA user_version=85; CREATE TRIGGER generated_retry_checkpoint_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='transport_checkpoint_schema' BEGIN SELECT RAISE(ABORT,'Generated protocol86 interruption'); END;");
    previous.close();
    assert.throws(() => new EventStore(path, f.retentionKey), /Generated protocol86 interruption/);
    const preserved = new DatabaseSync(path);
    assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 85);
    assert.equal(preserved.prepare("SELECT value FROM retention_metadata WHERE id='native_retry_restaging_schema'").get(), undefined);
    assert.deepEqual(retainedCiphertextRows(preserved), rows);
    preserved.exec("DROP TRIGGER generated_retry_checkpoint_failure"); preserved.close();
    opened = new EventStore(path, f.retentionKey);
    assert.equal(opened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(opened.db), rows);
    opened.close(); opened = new EventStore(path, f.retentionKey);
    assert.deepEqual(retainedCiphertextRows(opened.db), rows);
  } finally { opened?.close(); await f.close(); }
});

for (const lineage of ["missing", "premature", "downgraded"] as const) test(`native retry/checkpoint ${lineage} provenance fails without rewriting source history or grants`, async () => {
  const f = await setupFixture(), path = f.service.store.path;
  try {
    if (lineage === "downgraded") {
      const settings = structuredClone(f.service.controller.snapshot().settings.values); settings.interactions.nativeRetryRestaging = false;
      await f.service.controller.dispatch(envelope({ type: "settings.update", settings, expectedRevision: f.service.controller.snapshot().settings.revision, acknowledgePromptRisk: false }));
    }
    const rows = retainedCiphertextRows(f.service.store.db), events = f.service.controller.events(0);
    await f.service.close();
    const changed = new DatabaseSync(path);
    if (lineage === "missing") changed.prepare("DELETE FROM retention_metadata WHERE id=?").run("transport_checkpoint_schema");
    else if (lineage === "premature") changed.exec("PRAGMA user_version=85");
    else {
      assert.throws(() => removeRetryCheckpointFixtureMarkers(changed, events), /genuine|actual|retry|checkpoint/i);
      changed.exec("DELETE FROM retention_metadata WHERE id IN ('native_retry_restaging_schema','transport_checkpoint_schema'); PRAGMA user_version=85");
    }
    changed.close();
    assert.throws(() => new EventStore(path, f.retentionKey), /marker|lineage|history.*pre-86/i);
    const preserved = new DatabaseSync(path);
    try { assert.deepEqual(retainedCiphertextRows(preserved), rows); }
    finally { preserved.close(); }
  } finally { await f.close(); }
});
