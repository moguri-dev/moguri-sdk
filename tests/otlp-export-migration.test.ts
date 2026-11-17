import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { EventStore, backgroundServiceSchemaMarker, myWorkSchemaMarker, otlpExportSchemaMarker } from "../apps/service/src/store.ts";
import { MoguriSdk, PROTOCOL_VERSION, projectEvents } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { removeSkillsRewindFixtureMarkers, retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("genuine96 state migrates export opt-in atomically with original ciphertext, draft and unknown accounting intact", async () => {
  const fixture = await setupFixture({ omitUsage: true, responseMode: "text", legacyTurnCheckpointJournal: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let reopened: EventStore | undefined;
  try {
    await fixture.configure(); await fixture.send("Generated unknown accounting retained through OTLP upgrade."); await fixture.terminal();
    const calls = fixture.service.controller.snapshot().budgetEntries;
    assert.equal(calls[0]?.status, "unknown");
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated original unsent upgrade draft.", attachments: [] });
    const path = fixture.service.store.path;
    sdk.disconnect(); await fixture.service.close();
    const raw = new DatabaseSync(path);
    removeSkillsRewindFixtureMarkers(raw, fixture.service.controller.events(0));
    raw.prepare("DELETE FROM retention_metadata WHERE id=?").run(otlpExportSchemaMarker); raw.exec("PRAGMA user_version=96");
    const original = retainedCiphertextRows(raw);
    raw.exec("CREATE TRIGGER generated_otlp_interruption BEFORE INSERT ON retention_metadata WHEN NEW.id='otlp_export_schema' BEGIN SELECT RAISE(ABORT,'Generated OTLP migration interruption'); END"); raw.close();
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated OTLP migration interruption/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 96);
      assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id=?").get(otlpExportSchemaMarker), undefined);
      assert.deepEqual(retainedCiphertextRows(failed), original);
      failed.exec("DROP TRIGGER generated_otlp_interruption");
    } finally { failed.close(); }
    reopened = new EventStore(path, fixture.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    for (const marker of [myWorkSchemaMarker, backgroundServiceSchemaMarker, otlpExportSchemaMarker]) assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker)?.value, "1");
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    const snapshot = projectEvents(reopened.events());
    assert.deepEqual(snapshot.budgetEntries, calls);
    assert.equal(snapshot.sessions[0]?.draft.text, "Generated original unsent upgrade draft.");
    assert.equal(snapshot.telemetryExport.enabled, false); assert.equal(snapshot.telemetryExport.endpoint, null);
    reopened.close(); reopened = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
  } finally { reopened?.close(); sdk.disconnect(); await fixture.close(); }
});

test("missing, corrupt, premature and falsely downgraded OTLP history are refused without state replacement", async (t) => {
  for (const kind of ["missing", "corrupt", "premature", "future-history"] as const) await t.test(kind, async () => {
    const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
    try {
      if (kind === "future-history") await sdk.telemetry.export.apply((await sdk.telemetry.export.review({ enabled: false, endpoint: null, samplingRatio: 1 })).review);
      const path = fixture.service.store.path;
      sdk.disconnect(); await fixture.service.close();
      const raw = new DatabaseSync(path);
      if (kind === "missing" || kind === "future-history") raw.prepare("DELETE FROM retention_metadata WHERE id=?").run(otlpExportSchemaMarker);
      if (kind === "corrupt") raw.prepare("UPDATE retention_metadata SET value='0' WHERE id=?").run(otlpExportSchemaMarker);
      if (kind === "premature" || kind === "future-history") {
        const events = fixture.service.controller.events(0);
        if (kind === "future-history") assert.throws(() => removeSkillsRewindFixtureMarkers(new DatabaseSync(":memory:"), events), /genuine pre-111 history/);
        // Strip later markers without the fixture's own relabel guard so the store itself must refuse the retained export history.
        removeSkillsRewindFixtureMarkers(raw, events.filter((event) => event.event_type !== "telemetry.export_configured")); raw.exec("PRAGMA user_version=96");
      }
      const original = retainedCiphertextRows(raw); raw.close();
      assert.throws(() => new EventStore(path, fixture.retentionKey), /OTLP export/i);
      const preserved = new DatabaseSync(path);
      try { assert.deepEqual(retainedCiphertextRows(preserved), original); }
      finally { preserved.close(); }
    } finally { sdk.disconnect(); await fixture.close(); }
  });
});
