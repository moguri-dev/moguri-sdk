import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { EventStore } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { automaticFixture } from "./fixtures/automatic-sandbox.ts";
import { removeOwnedTransportFixtureMarkers, retainedCiphertextRows } from "./fixtures/legacy-state.ts";

const markers = ["scheduled_native_preparation_schema", "owned_model_transport_schema", "transport_finishing_schema"];
test("genuine84 upgrades all owned transport markers atomically without rewriting original ciphertext, receipts or scheduled input", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let opened: EventStore | undefined;
  try {
    await fixture.service.controller.dispatch({ id: "generated-genuine84-draft", profileId: "default",
      command: { type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated retained protocol84 input.", attachments: [] } });
    const rows = retainedCiphertextRows(fixture.service.store.db), events = fixture.service.controller.events(0);
    await fixture.service.close();
    const previous = new DatabaseSync(path); removeOwnedTransportFixtureMarkers(previous, events);
    previous.exec("PRAGMA user_version=84; CREATE TRIGGER generated_owned_transport_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='transport_finishing_schema' BEGIN SELECT RAISE(ABORT,'Generated transport migration interruption'); END;");
    previous.close();
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated transport migration interruption/);
    const preserved = new DatabaseSync(path);
    try {
      assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 84);
      for (const marker of markers) assert.equal(preserved.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker), undefined);
      assert.deepEqual(retainedCiphertextRows(preserved), rows);
      preserved.exec("DROP TRIGGER generated_owned_transport_failure");
    } finally { preserved.close(); }
    opened = new EventStore(path, fixture.retentionKey);
    assert.equal(opened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    for (const marker of [...markers, "model_failure_recovery_schema", "scheduled_prompts_schema", "kupo_modes_schema"]) {
      assert.equal(opened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker)?.value, "1");
    }
    assert.deepEqual(retainedCiphertextRows(opened.db), rows);
    opened.close(); opened = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(retainedCiphertextRows(opened.db), rows);
  } finally { opened?.close(); await fixture.close(); }
});

for (const mode of ["missing", "downgrade", "premature"] as const) {
  test(`scheduled native history rejects ${mode} transport markers before mutation`, { skip: process.platform !== "darwin" }, async (t) => {
    const fixture = await automaticFixture(t), path = fixture.service.store.path;
    try {
      await fixture.sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision,
        text: "Generated owned protocol85 preparation.", attachments: [] });
      await fixture.sdk.scheduledPrompts.create(fixture.sessionId, { kind: "delay", minutes: 5, timeZone: "UTC" });
      const rows = retainedCiphertextRows(fixture.service.store.db), events = fixture.controller.events(0);
      fixture.sdk.disconnect(); await fixture.service.close();
      const raw = new DatabaseSync(path);
      assert.throws(() => removeOwnedTransportFixtureMarkers(raw, events), /genuine pre-85/);
      if (mode === "missing") raw.exec("DELETE FROM retention_metadata WHERE id='owned_model_transport_schema'");
      else if (mode === "downgrade") raw.exec("DELETE FROM retention_metadata WHERE id IN ('scheduled_native_preparation_schema','owned_model_transport_schema','transport_finishing_schema'); PRAGMA user_version=84");
      else raw.exec("PRAGMA user_version=84");
      raw.close();
      assert.throws(() => new EventStore(path, fixture.retentionKey), mode === "missing" ? /owned model\/finishing transport.*marker/ :
        /Premature.*schema marker|pre-\d+ lineage/);
      const preserved = new DatabaseSync(path); assert.deepEqual(retainedCiphertextRows(preserved), rows); preserved.close();
    } finally { await fixture.close(); }
  });
}
