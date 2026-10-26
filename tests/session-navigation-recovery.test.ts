import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { profileFixture } from "./fixtures/profiles.ts";
import { retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";

test("detach opt-out survives service restart without crossing the immutable profile boundary", async () => {
  const fixture = await profileFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined, beta: MoguriSdk | undefined;
  try {
    const other = await fixture.create("Generated detach profile");
    const settings = fixture.sdk.settings.get()!;
    await fixture.sdk.settings.update({ ...settings.values, interactions: { ...settings.values.interactions, confirmSessionDetach: false } }, settings.revision);
    assert.equal(other.client.settings.get()!.values.interactions.confirmSessionDetach, true);
    for (const client of fixture.clients) client.disconnect();
    await fixture.service.close(); restarted = await startService(fixture.options);
    sdk = await new MoguriSdk(restarted.connection).ready(); beta = await sdk.profiles.open(other.profile.id);
    assert.equal(sdk.settings.get()!.values.interactions.confirmSessionDetach, false);
    assert.equal(beta.settings.get()!.values.interactions.confirmSessionDetach, true);
    const parent = await beta.sessions.create(null, "Generated other-profile parent");
    const child = await beta.sessions.spawn(parent.id!, "agent", "Generated other-profile child");
    await assert.rejects(() => beta!.sessions.organize(child.id!, { parentSessionId: null }), { code: "session_detach_confirmation" });
    await sdk.settings.reset("interactions", sdk.settings.get()!.revision);
    assert.equal(sdk.settings.get()!.values.interactions.confirmSessionDetach, true);
    assert.equal(beta.settings.get()!.values.interactions.confirmSessionDetach, true);
    assert.equal(fixture.providers.reduce((total, provider) => total + provider.requests.length, 0), 0);
  } finally { beta?.disconnect(); sdk?.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("a failed schema-60 migration preserves ciphertext, receipts and schema-59 settings for retry", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  try {
    await writeLegacyState(fixture.service, 59);
    const raw = new DatabaseSync(path), before = retainedCiphertextRows(raw);
    raw.exec("CREATE TRIGGER generated_navigation_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='session_navigation_schema' BEGIN SELECT RAISE(ABORT,'Generated navigation migration failure'); END");
    raw.close();
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated navigation migration failure/);
    const after = new DatabaseSync(path);
    try {
      assert.equal(after.prepare("PRAGMA user_version").get()?.user_version, 59);
      assert.equal(after.prepare("SELECT value FROM retention_metadata WHERE id='session_navigation_schema'").get(), undefined);
      assert.deepEqual(retainedCiphertextRows(after), before);
      after.exec("DROP TRIGGER generated_navigation_failure");
    } finally { after.close(); }
    const upgraded = new EventStore(path, fixture.retentionKey);
    try { assert.equal(upgraded.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION); assert.deepEqual(retainedCiphertextRows(upgraded.db), before); }
    finally { upgraded.close(); }
  } finally { await fixture.close(); }
});

test("schema-59 upgrade reattaches retained legacy consoles without creating or replaying a global UI intent", { skip: process.platform !== "darwin" }, async () => {
  const program = { executable: "/bin/sh", args: ["-c", "printf 'GENERATED_RETAINED_CONSOLE\\n'; exec cat"] };
  const fixture = await setupFixture({ platform: { terminal: program } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined;
  try {
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated navigation upgrade draft.", attachments: [] }, "generated-navigation-upgrade");
    const opened = await sdk.terminal.openGlobal(fixture.project), before = (await sdk.terminal.read(opened.id!)).terminal;
    sdk.disconnect(); await fixture.service.close({ preserveTerminals: true });
    const raw = new DatabaseSync(fixture.service.store.path);
    let retained: ReturnType<typeof retainedCiphertextRows>;
    try {
      raw.exec("BEGIN IMMEDIATE; DELETE FROM retention_metadata WHERE id IN ('project_kanban_schema','session_navigation_schema','session_github_workflows_schema','session_github_convergence_schema'); PRAGMA user_version=59; COMMIT;");
      retained = retainedCiphertextRows(raw);
    } finally { raw.close(); }
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
      platform: { terminal: { ...program, vault: fixture.terminalVault } } });
    peer = await new MoguriSdk(restarted.connection).ready();
    const after = (await peer.terminal.read(opened.id!)).terminal;
    assert.equal(restarted.store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.equal(after.pid, before.pid); assert.equal(after.ownerId, before.ownerId); assert.equal(after.sessionId, null);
    assert.deepEqual(after.binding, before.binding);
    assert.notEqual(after.attachmentId, before.attachmentId);
    assert.equal(peer.getState().snapshot!.terminals.length, 1);
    assert.equal(peer.getState().snapshot!.sessions[0]!.draft.text, "Generated navigation upgrade draft.");
    assert.equal(peer.settings.get()!.values.interactions.confirmSessionDetach, true);
    const migrated = retainedCiphertextRows(restarted.store.db);
    retained!.forEach(([table, rows], index) => assert.deepEqual(table === "events" ? migrated[index]![1].slice(0, rows.length) : migrated[index]![1], rows));
    assert.ok(restarted.store.db.prepare("SELECT id FROM receipts WHERE id='generated-navigation-upgrade'").get());
    await peer.terminal.input(opened.id!, "GENERATED_LEGACY_INSPECTION\n");
    await peer.terminal.close(opened.id!);
    assert.equal((await peer.terminal.read(opened.id!)).terminal.status, "closed");
    assert.doesNotMatch(JSON.stringify(restarted.controller.events(0)), /GENERATED_LEGACY_INSPECTION/);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); peer?.disconnect(); await restarted?.close(); await fixture.close(); }
});
