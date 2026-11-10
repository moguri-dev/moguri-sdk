import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { EventStore, backgroundServiceSchemaMarker, myWorkSchemaMarker, otlpExportSchemaMarker, skillsRewindSchemaMarkers } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk, PROTOCOL_VERSION, projectEvents } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { removeSkillsRewindFixtureMarkers, retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("genuine97 history upgrades both98 markers atomically without changing original95/96/97 ciphertext, owners, draft or spent/unknown accounting", async () => {
  const options = { responseMode: "text" as const, omitUsage: false, legacyTurnCheckpointJournal: true };
  const f = await setupFixture(options), sdk = await new MoguriSdk(f.service.connection).ready();
  let reopened: EventStore | undefined, restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await f.configure(); await f.send("Generated original97 spent usage."); await f.terminal();
    options.omitUsage = true; await f.send("Generated original97 unknown usage."); await f.terminal();
    const calls = structuredClone(f.service.controller.snapshot().budgetEntries);
    assert.deepEqual(calls.map((entry) => entry.status), ["settled", "unknown"]);
    await sdk.application.configure({ keepServiceOnWindowClose: false }, 0);
    await sdk.telemetry.export.apply((await sdk.telemetry.export.review({ enabled: false, endpoint: null, samplingRatio: 1 })).review);
    await sdk.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: f.session().draft.revision, text: "Generated original97 unsent draft.", attachments: [] });
    const path = f.service.store.path, events = f.service.controller.events(0);
    assert.equal(events.some((event) => event.event_type.startsWith("checkpoint.")), false);
    sdk.disconnect(); await f.service.close(); f.endLegacyCheckpointJournal();
    const raw = new DatabaseSync(path); removeSkillsRewindFixtureMarkers(raw, events); raw.exec("PRAGMA user_version=97");
    const original = retainedCiphertextRows(raw);
    for (const marker of [myWorkSchemaMarker, backgroundServiceSchemaMarker, otlpExportSchemaMarker]) assert.equal(raw.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker)?.value, "1");
    raw.exec("CREATE TRIGGER generated98_interruption BEFORE INSERT ON retention_metadata WHEN NEW.id='turn_checkpoints_schema' BEGIN SELECT RAISE(ABORT,'Generated atomic98 interruption'); END"); raw.close();
    assert.throws(() => new EventStore(path, f.retentionKey), /Generated atomic98 interruption/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 97);
      for (const marker of skillsRewindSchemaMarkers) assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker), undefined);
      assert.deepEqual(retainedCiphertextRows(failed), original); failed.exec("DROP TRIGGER generated98_interruption");
    } finally { failed.close(); }
    reopened = new EventStore(path, f.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    const snapshot = projectEvents(reopened.events());
    assert.deepEqual(snapshot.budgetEntries, calls); assert.equal(snapshot.sessions[0]?.draft.text, "Generated original97 unsent draft.");
    assert.equal(snapshot.checkpoints.length, 0);
    for (const marker of [myWorkSchemaMarker, backgroundServiceSchemaMarker, otlpExportSchemaMarker, ...skillsRewindSchemaMarkers]) assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker)?.value, "1");
    reopened.close(); reopened = undefined;
    restarted = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    const current = await new MoguriSdk(restarted.connection).ready();
    try {
      const historical = await current.checkpoints.list(f.sessionId);
      assert.equal(historical.historicalTurnsUnavailable, 2); assert.deepEqual(historical.checkpoints, []);
      assert.deepEqual(restarted.controller.snapshot().budgetEntries, calls);
      assert.equal(f.requests.length, 2, "Restart and schema upgrade never replay a model or invent a historical snapshot.");
      assert.deepEqual(retainedCiphertextRows(restarted.store.db).slice(1), original.slice(1));
    } finally { current.disconnect(); }
  } finally { reopened?.close(); sdk.disconnect(); await restarted?.close(); await f.close(); }
});

for (const variant of ["missing", "corrupt", "premature", "captured-downgrade", "pruned-downgrade"] as const) {
  test(`invalid98 ${variant} lineage fails without replacing encrypted original state`, async () => {
    const f = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(f.service.connection).ready();
    try {
      if (variant.endsWith("downgrade")) {
        await f.configure(); await f.send("Generated current98 captured history."); await f.terminal();
        if (variant === "pruned-downgrade") {
          const checkpoint = (await sdk.checkpoints.list(f.sessionId)).checkpoints[0]!;
          await sdk.checkpoints.prune(f.sessionId, checkpoint.id, checkpoint.revision);
        }
      }
      sdk.disconnect(); await f.service.close();
      const raw = new DatabaseSync(f.service.store.path);
      if (variant === "missing") raw.prepare("DELETE FROM retention_metadata WHERE id=?").run(skillsRewindSchemaMarkers[0]);
      if (variant === "corrupt") raw.prepare("UPDATE retention_metadata SET value='0' WHERE id=?").run(skillsRewindSchemaMarkers[1]);
      if (variant === "premature") raw.exec("PRAGMA user_version=97");
      if (variant.endsWith("downgrade")) raw.exec("DELETE FROM retention_metadata WHERE id IN ('local_skill_admission_schema','turn_checkpoints_schema'); PRAGMA user_version=97");
      const original = retainedCiphertextRows(raw); raw.close();
      assert.throws(() => new EventStore(f.service.store.path, f.retentionKey), /skill admission|rewind history|checkpoint/i);
      const preserved = new DatabaseSync(f.service.store.path);
      try { assert.deepEqual(retainedCiphertextRows(preserved), original); } finally { preserved.close(); }
    } finally { sdk.disconnect(); await f.close(); }
  });
}
