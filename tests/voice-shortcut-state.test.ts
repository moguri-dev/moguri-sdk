import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { EventStore, voiceShortcutSchemaMarker } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk, PROTOCOL_VERSION, voiceShortcutMode } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { removeVoiceShortcutFixtureMarker, retainedCiphertextRows } from "./fixtures/legacy-state.ts";

for (const legacy of [false, true]) test(`genuine87 with legacy pushToTalk:${legacy} upgrades atomically to held shortcuts without rewriting saved preferences`, async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready(), path = f.service.store.path;
  let opened: EventStore | undefined;
  try {
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, voice: { ...settings.values.voice, pushToTalk: legacy } }, settings.revision);
    const rows = retainedCiphertextRows(f.service.store.db), events = f.service.controller.events(0);
    sdk.disconnect(); await f.service.close();
    const previous = new DatabaseSync(path);
    removeVoiceShortcutFixtureMarker(previous, events);
    previous.exec("PRAGMA user_version=87; CREATE TRIGGER generated_shortcut_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='voice_shortcut_schema' BEGIN SELECT RAISE(ABORT,'Generated shortcut migration interruption'); END;");
    previous.close();
    assert.throws(() => new EventStore(path, f.retentionKey), /Generated shortcut migration interruption/);
    const preserved = new DatabaseSync(path);
    assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 87);
    assert.equal(preserved.prepare("SELECT value FROM retention_metadata WHERE id=?").get(voiceShortcutSchemaMarker), undefined);
    assert.deepEqual(retainedCiphertextRows(preserved), rows);
    preserved.exec("DROP TRIGGER generated_shortcut_failure"); preserved.close();
    opened = new EventStore(path, f.retentionKey);
    assert.equal(opened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.equal(opened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(voiceShortcutSchemaMarker)?.value, "1");
    const original = opened.events().findLast((event) => event.event_type === "settings.updated");
    if (original?.event_type !== "settings.updated") assert.fail("The original settings event was lost.");
    assert.equal(original.payload.settings.voice.pushToTalk, legacy);
    assert.equal(original.payload.settings.voice.shortcutMode, undefined);
    assert.equal(voiceShortcutMode(original.payload.settings.voice), "hold");
    assert.deepEqual(retainedCiphertextRows(opened.db), rows);
    opened.close(); opened = new EventStore(path, f.retentionKey);
    assert.deepEqual(retainedCiphertextRows(opened.db), rows);
  } finally { sdk.disconnect(); opened?.close(); await f.close(); }
});

for (const mode of ["hold", "toggle"] as const) test(`an explicit ${mode} shortcut survives actual service restart without changing the old button boolean`, async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, current: MoguriSdk | undefined;
  try {
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, voice: { ...settings.values.voice, shortcutMode: mode } }, settings.revision);
    sdk.disconnect(); await f.service.close();
    restarted = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey,
      platform: { terminal: { defaultRoot: f.home, vault: f.terminalVault } } });
    current = await new MoguriSdk(restarted.connection).ready();
    assert.equal(current.settings.get()!.values.voice.shortcutMode, mode);
    assert.equal(voiceShortcutMode(current.settings.get()!.values.voice), mode);
    assert.equal(current.settings.get()!.values.voice.pushToTalk, false);
    assert.equal(f.requests.length, 0);
  } finally { current?.disconnect(); sdk.disconnect(); await restarted?.close(); await f.close(); }
});

for (const lineage of ["missing", "corrupt", "premature", "downgraded"] as const) test(`shortcut ${lineage} provenance cannot rewrite history or mint a new user choice`, async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready(), path = f.service.store.path;
  try {
    if (lineage === "downgraded") {
      const settings = sdk.settings.get()!;
      await sdk.settings.update({ ...settings.values, voice: { ...settings.values.voice, shortcutMode: "toggle" } }, settings.revision);
    }
    const rows = retainedCiphertextRows(f.service.store.db), events = f.service.controller.events(0);
    sdk.disconnect(); await f.service.close();
    const changed = new DatabaseSync(path);
    if (lineage === "missing") changed.prepare("DELETE FROM retention_metadata WHERE id=?").run(voiceShortcutSchemaMarker);
    else if (lineage === "corrupt") changed.prepare("UPDATE retention_metadata SET value='0' WHERE id=?").run(voiceShortcutSchemaMarker);
    else if (lineage === "premature") changed.exec("PRAGMA user_version=87");
    else {
      assert.throws(() => removeVoiceShortcutFixtureMarker(changed, events), /genuine pre-88/);
      changed.prepare("DELETE FROM retention_metadata WHERE id=?").run(voiceShortcutSchemaMarker);
      changed.exec("PRAGMA user_version=87");
    }
    changed.close();
    assert.throws(() => new EventStore(path, f.retentionKey), /voice shortcut.*(?:marker|pre-88)|shortcut preference history/i);
    const preserved = new DatabaseSync(path);
    try { assert.deepEqual(retainedCiphertextRows(preserved), rows); }
    finally { preserved.close(); }
  } finally { sdk.disconnect(); await f.close(); }
});
