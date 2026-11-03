import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { MoguriSdk, defaultNotificationWav, encodeSpeechWav } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture } from "./fixture.ts";
import { assertCurrentSchema, retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";
import { profileFixture } from "./fixtures/profiles.ts";

test("an explicitly imported sound has its own encrypted grant across session deletion and restart", async () => {
  const fixture = await setupFixture();
  let sdk = await new MoguriSdk(fixture.service.connection).ready(), restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const audio = encodeSpeechWav(new Float32Array(1600).map((_, index) => Math.sin(index * 0.2) * 0.1));
    const result = await sdk.notifications.importSound("Generated explicit earcon", audio, "generated-sound-original-import");
    const sound = (await sdk.notifications.sound(result.id!)).sound;
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, notifications: { ...settings.values.notifications, needsInputSound: { enabled: true, id: sound.id }, soundWhileFocused: false } }, settings.revision);
    await sdk.sessions.delete(fixture.sessionId, true);
    assert.equal((await sdk.notifications.sound(sound.id)).audio, Buffer.from(audio).toString("base64"));
    assert.ok(String(fixture.service.store.db.prepare("SELECT scope FROM blob_payloads WHERE digest=?").get(sound.contentDigest)?.scope).includes("notification-sound"));
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    sdk = await new MoguriSdk(restarted.connection).ready();
    assert.equal(sdk.settings.get()!.values.notifications.soundWhileFocused, false);
    assert.equal((await sdk.notifications.sound(sound.id)).audio, Buffer.from(audio).toString("base64"));
    await assert.rejects(() => sdk.notifications.removeSound(sound.id, sound.contentDigest, true), /in use/i);
    const current = sdk.settings.get()!;
    await sdk.settings.update({ ...current.values, notifications: { ...current.values.notifications, needsInputSound: { enabled: true, id: "default" } } }, current.revision);
    await sdk.notifications.removeSound(sound.id, sound.contentDigest, true);
    await assert.rejects(() => sdk.notifications.sound(sound.id), /missing|removed/i);
    restarted.store.db.prepare("DELETE FROM receipts WHERE id='generated-sound-original-import'").run();
    await assert.rejects(() => sdk.notifications.importSound("Generated explicit earcon", audio, "generated-sound-original-import"), /deleted|receipt|recorded/i);
    assert.equal(sdk.notifications.list().length, 0);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("sound grants and choices stay profile-owned even when original PCM bytes match", async () => {
  const fixture = await profileFixture();
  try {
    const { client: beta } = await fixture.create("Generated audio Beta"), bytes = defaultNotificationWav("needs-input");
    const own = await fixture.sdk.notifications.importSound("Generated Default-only sound", bytes);
    await assert.rejects(() => beta.notifications.sound(own.id!), /missing/i);
    const other = await beta.notifications.importSound("Generated Beta-only sound", bytes);
    assert.notEqual(own.id, other.id);
    assert.deepEqual(beta.notifications.list().map((sound) => sound.id), [other.id]);
    const settings = beta.settings.get()!;
    await assert.rejects(() => beta.settings.update({ ...settings.values, notifications: { ...settings.values.notifications, completedSound: { enabled: true, id: own.id! } } }, settings.revision), /existing sound.*profile/i);
    const sound = (await fixture.sdk.notifications.sound(own.id!)).sound;
    await fixture.sdk.notifications.removeSound(sound.id, sound.contentDigest, true);
    assert.equal((await beta.notifications.sound(other.id!)).audio, Buffer.from(bytes).toString("base64"));
  } finally { await fixture.close(); }
});

test("schema-46 notification defaults migrate additively without rewriting existing preferences, ciphertext or capture choices", async () => {
  const fixture = await setupFixture({ legacySessionControlsJournal: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, notifications: { inApp: false, os: true, previewContent: true },
      voice: { ...settings.values.voice, inputDeviceId: "generated-explicit-device", pushToTalk: true } }, settings.revision);
    const before = retainedCiphertextRows(fixture.service.store.db);
    sdk.disconnect(); await writeLegacyState(fixture.service, 46);
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    assertCurrentSchema(restarted.store);
    const after = retainedCiphertextRows(restarted.store.db);
    for (let index = 0; index < before.length; index++) {
      const [table, rows] = before[index]!, actual = after[index]!;
      assert.equal(actual[0], table);
      assert.ok(Array.isArray(rows) && Array.isArray(actual[1]));
      assert.deepEqual(table === "events" ? actual[1].slice(0, rows.length) : actual[1], rows);
    }
    assert.deepEqual(restarted.controller.snapshot().settings.values.notifications, { inApp: false, os: true, previewContent: true,
      needsInputSound: { enabled: true, id: "default" }, completedSound: { enabled: true, id: "default" }, soundWhileFocused: true });
    assert.equal(restarted.controller.snapshot().settings.values.voice.inputDeviceId, "generated-explicit-device");
    assert.equal(restarted.controller.snapshot().settings.values.voice.pushToTalk, true);
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});
