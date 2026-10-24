import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { MoguriSdk, defaultNotificationWav } from "../packages/sdk/src/index.ts";
import { waitForStorageRelocation } from "../packages/sdk/src/node.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("a reviewed whole-store relocation preserves encrypted data and original resources while retiring old writers", async () => {
  const fixture = await setupFixture(), source = join(fixture.directory, "state"), destination = join(fixture.directory, "moved-state"), locatorDirectory = join(fixture.directory, "private-location");
  await fixture.service.close();
  const secrets = new Map<string, string>(), vault = { read: async (key: string) => secrets.get(key) ?? null, write: async (key: string, value: string) => { secrets.set(key, value); }, remove: async (key: string) => { secrets.delete(key); } };
  const options = { stateDir: source, provider: fixture.provider, retentionKey: fixture.retentionKey, storage: { locatorDirectory, explicitOverride: false },
    platform: { vault }, profiles: { provider: () => fixture.provider, platform: () => ({ vault }) } };
  const service = await startService(options);
  let sdk = await new MoguriSdk(service.connection).ready(), moved: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated retained relocation draft.", attachments: [] }, "generated-before-move");
    const sound = await sdk.notifications.importSound("Generated independent move sound", defaultNotificationWav("completed"));
    const createdProfile = await sdk.profiles.create("Generated moved Beta"), profile = await sdk.profiles.wait(createdProfile.id!);
    const beta = await sdk.profiles.open(profile.id), betaSession = await beta.sessions.create(null, "Generated independently moved chat");
    await beta.command({ type: "draft.save", sessionId: betaSession.id!, expectedRevision: 0, text: "Generated Beta-owned relocation draft.", attachments: [] }); beta.disconnect();
    const originalProjectPath = sdk.getState().snapshot!.projects[0]!.path;
    const keyId = service.store.db.prepare("SELECT value FROM retention_metadata WHERE id='key_id'").get()?.value;
    const review = (await sdk.application.storage.preview(destination)).review;
    const accepted = await sdk.application.storage.relocate(destination, review.digest, true);
    await waitForStorageRelocation(locatorDirectory, accepted.id, review.keyId);
    sdk.disconnect();
    await assert.rejects(() => startService(options), /retired|authoritative|relocat/i);
    moved = await startService({ ...options, stateDir: destination });
    sdk = await new MoguriSdk(moved.connection).ready();
    assert.equal(sdk.getState().snapshot!.sessions[0]!.draft.text, "Generated retained relocation draft.");
    assert.equal((await sdk.notifications.sound(sound.id!)).sound.name, "Generated independent move sound");
    assert.equal(moved.store.db.prepare("SELECT value FROM retention_metadata WHERE id='key_id'").get()?.value, keyId);
    assert.ok(moved.store.db.prepare("SELECT id FROM receipts WHERE id='generated-before-move'").get());
    assert.equal((await sdk.application.storage.status()).storage.resourceBase, review.resourceBase);
    assert.equal((await sdk.application.storage.status()).storage.operation?.status, "completed");
    const movedBeta = await sdk.profiles.open(profile.id);
    assert.equal(movedBeta.getState().snapshot!.sessions[0]!.draft.text, "Generated Beta-owned relocation draft."); movedBeta.disconnect();
    assert.equal(sdk.getState().snapshot!.projects[0]!.path, originalProjectPath);
    await assert.rejects(() => sdk.application.storage.relocate(destination, review.digest, true, accepted.id), /already.*intent|replay/i);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await moved?.close(); await service.close(); await fixture.close(); }
});

test("explicit overrides, changed destination bytes and changed profile sets cannot authorize a move or delete destination data", async () => {
  const fixture = await setupFixture(), source = join(fixture.directory, "state"), locatorDirectory = join(fixture.directory, "location"), destination = join(fixture.directory, "destination");
  await fixture.service.close();
  let service = await startService({ stateDir: source, provider: fixture.provider, retentionKey: fixture.retentionKey, storage: { locatorDirectory, explicitOverride: true } });
  let sdk = await new MoguriSdk(service.connection).ready();
  try {
    await assert.rejects(() => sdk.application.storage.preview(destination), /MOGURI_STATE_DIR/);
    sdk.disconnect(); await service.close();
    service = await startService({ stateDir: source, provider: fixture.provider, retentionKey: fixture.retentionKey, storage: { locatorDirectory, explicitOverride: false } });
    sdk = await new MoguriSdk(service.connection).ready();
    const review = (await sdk.application.storage.preview(destination)).review;
    const profile = await sdk.profiles.create("Generated post-review profile"); await sdk.profiles.wait(profile.id!);
    await assert.rejects(() => sdk.application.storage.relocate(destination, review.digest, true), /changed.*[Rr]eview|[Rr]eview.*current/i);
    const refreshed = (await sdk.application.storage.preview(destination)).review;
    await mkdir(destination, { mode: 0o700 }); await writeFile(join(destination, "generated.keep"), "Generated destination bytes.");
    await assert.rejects(() => sdk.application.storage.relocate(destination, refreshed.digest, true), /empty.*private|destination/i);
    assert.equal(await readFile(join(destination, "generated.keep"), "utf8"), "Generated destination bytes.");
    assert.equal((await sdk.application.storage.status()).storage.operation, null);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await service.close(); await fixture.close(); }
});

test("altered target bytes cannot become a writer before first acknowledgement and cannot fall back to a retired source", async () => {
  const fixture = await setupFixture(), source = join(fixture.directory, "state"), destination = join(fixture.directory, "changed-target"), locatorDirectory = join(fixture.directory, "location");
  await fixture.service.close();
  const options = { stateDir: source, provider: fixture.provider, retentionKey: fixture.retentionKey, storage: { locatorDirectory, explicitOverride: false } }, service = await startService(options);
  const sdk = await new MoguriSdk(service.connection).ready();
  try {
    const review = (await sdk.application.storage.preview(destination)).review, started = await sdk.application.storage.relocate(destination, review.digest, true);
    await waitForStorageRelocation(locatorDirectory, started.id, started.keyId); sdk.disconnect();
    const target = join(destination, "state.sqlite"), original = await readFile(target);
    await writeFile(target, Buffer.concat([original, Buffer.from([0x67])]), { mode: 0o600 });
    await assert.rejects(() => startService({ ...options, stateDir: destination }), /changed before.*acknowledgement/i);
    await assert.rejects(() => startService(options), /retired|authoritative/i);
    assert.equal((await readFile(target)).length, original.length + 1);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await service.close(); await fixture.close(); }
});

test("a destination changed after admission is retained as partial and source restart never replays the copy", async () => {
  const fixture = await setupFixture(), source = join(fixture.directory, "state"), destination = join(fixture.directory, "partial-target"), locatorDirectory = join(fixture.directory, "location");
  await fixture.service.close();
  const options = { stateDir: source, provider: fixture.provider, retentionKey: fixture.retentionKey, storage: { locatorDirectory, explicitOverride: false } }, service = await startService(options);
  const sdk = await new MoguriSdk(service.connection).ready(), release = Promise.withResolvers<void>(), close = service.profiles.close.bind(service.profiles);
  service.profiles.close = (options) => close(options).then(() => release.promise);
  let reopened: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const review = (await sdk.application.storage.preview(destination)).review, accepted = await sdk.application.storage.relocate(destination, review.digest, true);
    await mkdir(destination, { mode: 0o700 }); await writeFile(join(destination, "generated-race.keep"), "Generated exact competing bytes.");
    release.resolve();
    await assert.rejects(() => waitForStorageRelocation(locatorDirectory, accepted.id, accepted.keyId), /changed|retained|empty/i);
    await waitFor(() => service.application.storage.status().operation?.status === "partial");
    sdk.disconnect(); await service.close();
    reopened = await startService(options);
    const current = await new MoguriSdk(reopened.connection).ready();
    try {
      assert.equal((await current.application.storage.status()).storage.operation?.status, "partial");
      await assert.rejects(() => current.application.storage.relocate(destination, review.digest, true, accepted.id), /retained intent|replay/i);
      assert.equal(await readFile(join(destination, "generated-race.keep"), "utf8"), "Generated exact competing bytes.");
      assert.equal(fixture.requests.length, 0);
    } finally { current.disconnect(); }
  } finally { release.resolve(); sdk.disconnect(); await reopened?.close(); await service.close(); await fixture.close(); }
});
