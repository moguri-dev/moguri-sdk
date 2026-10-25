import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture } from "./fixture.ts";
import { retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";

const mainMarkers = [
  "workspace_entry_schema", "settings_preferences_schema", "client_voice_capture_schema", "notification_sound_schema",
  "application_preferences_schema", "state_location_schema", "private_update_schema", "session_interactions_schema", "managed_sandbox_schema",
];
const markers = (db: DatabaseSync) => db.prepare("SELECT id,value FROM retention_metadata ORDER BY id").all();

test("both retained schema lineages converge and reopen without rewriting grants, settings, drafts or receipts", async (t) => {
  const sources = [
    { name: "desktop 44", version: 44, lineage: "desktop" },
    { name: "desktop 45", version: 45, lineage: "desktop" },
    { name: "desktop 46", version: 46, lineage: "desktop" },
    { name: "main 52", version: 52, lineage: "main" },
    { name: "converged 53", version: 53, lineage: "main" },
    { name: "desktop 46 previously opened by main 52", version: 46, lineage: "desktop", partialMain: true },
  ] as const;
  for (const source of sources) await t.test(source.name, async () => {
    const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
    let store: EventStore | undefined, restarted: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined;
    try {
      const file = join(fixture.directory, "generated-retained-merge.txt"), text = "Generated original context, never replayed.";
      await writeFile(file, text);
      const attachment = await sdk.attachments.file(fixture.sessionId, file);
      const settings = sdk.settings.get()!;
      await sdk.settings.update({
        ...settings.values,
        ...(source.lineage === "desktop" ? { interactions: { confirmSessionAttachments: false, confirmTerminalClose: false },
          notifications: { inApp: settings.values.notifications.inApp, os: settings.values.notifications.os, previewContent: settings.values.notifications.previewContent } } : {
          voice: { ...settings.values.voice, inputDeviceId: "generated-audio-device", pushToTalk: true },
          retention: { ...settings.values.retention, confirmArchive: false, confirmDelete: false },
        }),
      }, settings.revision);
      await sdk.sessions.organize(fixture.sessionId, { order: 7 });
      const expectedSettings = structuredClone(sdk.settings.get()!.values), expectedDraft = structuredClone(fixture.session().draft);
      const before = retainedCiphertextRows(fixture.service.store.db), path = fixture.service.store.path;
      sdk.disconnect(); await writeLegacyState(fixture.service, source.version, source.lineage);
      if ("partialMain" in source) {
        const partial = new DatabaseSync(path);
        try {
          partial.exec("BEGIN IMMEDIATE");
          for (const id of mainMarkers.slice(3)) partial.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(id);
          partial.exec("PRAGMA user_version=52; COMMIT;");
        } finally { partial.close(); }
      }
      store = new EventStore(path, fixture.retentionKey);
      assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
      assert.deepEqual(retainedCiphertextRows(store.db), before);
      for (const id of [...mainMarkers, "desktop_interaction_schema", "session_indicators_schema"]) assert.equal(store.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(id)?.value, "1");
      store.close(); store = undefined;
      restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
      peer = await new MoguriSdk(restarted.connection).ready();
      assert.deepEqual(peer.settings.get()!.values, expectedSettings);
      assert.deepEqual(peer.getState().snapshot!.sessions.find((session) => session.id === fixture.sessionId)!.draft, expectedDraft);
      assert.equal(peer.getState().snapshot!.sessions.find((session) => session.id === fixture.sessionId)!.order, 7);
      const content = (await peer.attachments.read(fixture.sessionId, attachment.id!)).content;
      assert.ok(content.kind === "text"); assert.equal(content.text, text);
      const recovered = retainedCiphertextRows(restarted.store.db);
      for (const [table, rows] of before) {
        const actual = recovered.find(([name]) => name === table)![1];
        assert.deepEqual(table === "events" ? actual.slice(0, rows.length) : actual, rows);
      }
      const originalEvents = before.find(([table]) => table === "events")![1].length;
      assert.ok(restarted.store.events().slice(originalEvents).every((event) => event.event_type === "provider.changed"));
      assert.equal(fixture.requests.length, 0);
    } finally { sdk.disconnect(); store?.close(); peer?.disconnect(); await restarted?.close(); await fixture.close(); }
  });
});

test("schema 53 indicator migration rolls back on interruption and reopens without rewriting encrypted state", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let store: EventStore | undefined;
  try {
    const file = join(fixture.directory, "generated-indicator-retained.txt");
    await writeFile(file, "Generated retained indicator migration context.");
    await sdk.attachments.file(fixture.sessionId, file);
    await sdk.sessions.organize(fixture.sessionId, { pinned: true, order: 12 });
    const before = retainedCiphertextRows(fixture.service.store.db), path = fixture.service.store.path;
    sdk.disconnect(); await writeLegacyState(fixture.service, 53);
    const original = new DatabaseSync(path);
    try { original.exec("CREATE TRIGGER generated_indicator_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='session_indicators_schema' BEGIN SELECT RAISE(ABORT,'Generated indicator migration interruption'); END"); } finally { original.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated indicator migration interruption/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 53);
      assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id='session_indicators_schema'").get(), undefined);
      assert.deepEqual(retainedCiphertextRows(failed), before);
      failed.exec("DROP TRIGGER generated_indicator_failure");
    } finally { failed.close(); }
    store = new EventStore(path, fixture.retentionKey);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(store.db), before);
    const expected = store.events(); store.close(); store = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(store.events(), expected); assert.deepEqual(retainedCiphertextRows(store.db), before);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); store?.close(); await fixture.close(); }
});

test("current indicator schemas reject missing or corrupt markers rather than silently resetting metadata", async (t) => {
  for (const sql of ["DELETE FROM retention_metadata WHERE id='session_indicators_schema'", "UPDATE retention_metadata SET value='0' WHERE id='session_indicators_schema'"]) await t.test(sql, async () => {
    const fixture = await setupFixture(), path = fixture.service.store.path;
    try {
      await fixture.service.close();
      const original = new DatabaseSync(path);
      let before: ReturnType<typeof retainedCiphertextRows>;
      try { original.exec(sql); before = retainedCiphertextRows(original); } finally { original.close(); }
      assert.throws(() => new EventStore(path, fixture.retentionKey), /Missing or invalid retained session indicator schema marker/);
      const failed = new DatabaseSync(path);
      try { assert.deepEqual(retainedCiphertextRows(failed), before); } finally { failed.close(); }
    } finally { await fixture.close(); }
  });
});

test("convergence rolls back all markers and refuses missing or corrupt lineage instead of guessing", async (t) => {
  const cases = [
    { name: "missing main marker", version: 52, lineage: "main", sql: "DELETE FROM retention_metadata WHERE id='settings_preferences_schema'", error: /Missing retained schema marker settings_preferences_schema/ },
    { name: "missing desktop provenance", version: 46, lineage: "desktop", sql: "DELETE FROM retention_metadata WHERE id='desktop_interaction_schema'", error: /Missing retained schema marker workspace_entry_schema/ },
    { name: "invalid desktop provenance", version: 46, lineage: "desktop", sql: "UPDATE retention_metadata SET value='0' WHERE id='desktop_interaction_schema'", error: /Invalid desktop schema provenance/ },
    { name: "invalid partial main marker", version: 46, lineage: "desktop", sql: "INSERT INTO retention_metadata(id,value) VALUES ('private_update_schema','0')", error: /Invalid retained schema marker private_update_schema/ },
    { name: "failed third marker", version: 46, lineage: "desktop", sql: "CREATE TRIGGER generated_merge_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='client_voice_capture_schema' BEGIN SELECT RAISE(ABORT,'Generated merge marker failure'); END", error: /Generated merge marker failure/ },
  ] as const;
  for (const entry of cases) await t.test(entry.name, async () => {
    const fixture = await setupFixture(), path = fixture.service.store.path;
    try {
      await writeLegacyState(fixture.service, entry.version, entry.lineage);
      const original = new DatabaseSync(path);
      let before: ReturnType<typeof retainedCiphertextRows>, metadata: ReturnType<typeof markers>;
      try { original.exec(entry.sql); before = retainedCiphertextRows(original); metadata = markers(original); } finally { original.close(); }
      assert.throws(() => new EventStore(path, fixture.retentionKey), entry.error);
      const failed = new DatabaseSync(path);
      try {
        assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, entry.version);
        assert.deepEqual(markers(failed), metadata);
        assert.deepEqual(retainedCiphertextRows(failed), before);
      } finally { failed.close(); }
    } finally { await fixture.close(); }
  });
});
