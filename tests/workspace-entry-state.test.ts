import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { writeLegacyState, removePost44FixtureMarkers } from "./fixtures/legacy-state.ts";
import { profileFixture } from "./fixtures/profiles.ts";
import { setupFixture } from "./fixture.ts";
import { terminalBinding } from "../apps/service/src/terminal-identity.ts";
import { frameDigest } from "../apps/service/src/worker-wire.ts";

test("Local and Remote version-1 root bindings retain their exact pre-upgrade digest encoding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-binding-v1-"));
  try {
    const root = await realpath(directory), metadata = await lstat(root, { bigint: true });
    const scope = { profileId: "generated-profile", sessionId: "generated-session", projectId: "generated-project", workspaceId: null, root };
    const local = { ...scope, env: "Local" as const, device: String(metadata.dev), inode: String(metadata.ino) };
    const remote = { ...scope, env: "Remote" as const, peerDigest: "7".repeat(64), device: String(metadata.dev), inode: String(metadata.ino) };
    assert.equal(terminalBinding(scope).digest, frameDigest(local));
    assert.equal(terminalBinding({ ...scope, env: "Remote", peerDigest: remote.peerDigest }).digest, frameDigest(remote));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("migration 44 rolls back its marker atomically and preserves exact encrypted history and receipts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-entry-migration-")), path = join(directory, "state.sqlite"), key = randomBytes(32);
  let store: EventStore | undefined = new EventStore(path, key, "generated-entry-key");
  try {
    store.commit([{ event_type: "job.progress", profile_id: "default", payload: { jobId: "generated-old-job", progress: "Generated encrypted pre-entry state." } }]);
    const before = store.db.prepare("SELECT seq,id,payload FROM events ORDER BY seq").all();
    removePost44FixtureMarkers(store.db);
    store.db.exec(`BEGIN IMMEDIATE; DELETE FROM retention_metadata WHERE id='workspace_entry_schema'; PRAGMA user_version=43;
      CREATE TRIGGER generated_entry_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='workspace_entry_schema'
      BEGIN SELECT RAISE(ABORT,'Generated entry migration failure'); END; COMMIT;`);
    store.close(); store = undefined;
    assert.throws(() => new EventStore(path, key, "generated-entry-key"), /Generated entry migration failure/);
    const raw = new DatabaseSync(path);
    try {
      assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, 43);
      assert.deepEqual(raw.prepare("SELECT seq,id,payload FROM events ORDER BY seq").all(), before);
      assert.equal(raw.prepare("SELECT value FROM retention_metadata WHERE id='workspace_entry_schema'").get(), undefined);
      raw.exec("DROP TRIGGER generated_entry_marker");
    } finally { raw.close(); }
    store = new EventStore(path, key, "generated-entry-key");
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(store.db.prepare("SELECT seq,id,payload FROM events ORDER BY seq").all(), before);
  } finally { store?.close(); await rm(directory, { recursive: true, force: true }); }
});

test("a schema-43 session console survives upgrade without changing its owner, process or bound project", { skip: process.platform !== "darwin" }, async () => {
  const program = { executable: "/bin/sh", args: ["-c", "printf 'GENERATED_ENTRY_UPGRADE\\n'; exec cat"] };
  const fixture = await setupFixture({ platform: { terminal: program } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let service: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined;
  try {
    const opened = await sdk.terminal.open(fixture.sessionId), before = await sdk.terminal.read(opened.id!);
    sdk.disconnect(); await fixture.service.close({ preserveTerminals: true }); await writeLegacyState(fixture.service, 43);
    service = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey, platform: { terminal: { ...program, vault: fixture.terminalVault } } });
    peer = await new MoguriSdk(service.connection).ready();
    const after = await peer.terminal.read(opened.id!);
    assert.equal(after.terminal.pid, before.terminal.pid); assert.equal(after.terminal.ownerId, before.terminal.ownerId);
    assert.equal(after.terminal.projectId, fixture.session().projectId); assert.equal(after.terminal.sessionId, fixture.sessionId);
    await peer.terminal.close(opened.id!);
  } finally { sdk.disconnect(); peer?.disconnect(); await service?.close(); await fixture.close(); }
});

test("global consoles and their authentication remain profile-owned rather than cross-profile null-session singletons", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await profileFixture(() => ({ terminal: { executable: "/bin/sh", args: ["-c", "printf 'GENERATED_PROFILE_GLOBAL\\n'; exec cat"] } }));
  try {
    const other = await fixture.create("Generated console profile");
    const first = await fixture.sdk.terminal.openGlobal(fixture.directory), second = await other.client.terminal.openGlobal(fixture.directory);
    assert.notEqual(first.id, second.id);
    assert.equal(fixture.sdk.getState().snapshot!.terminals.length, 1); assert.equal(other.client.getState().snapshot!.terminals.length, 1);
    await assert.rejects(() => other.client.terminal.read(first.id!), /outside this profile/);
    assert.notEqual(fixture.sdk.getState().snapshot!.terminalOwners[0]?.id, other.client.getState().snapshot!.terminalOwners[0]?.id);
    await fixture.sdk.terminal.close(first.id!); await other.client.terminal.close(second.id!);
  } finally { await fixture.close(); }
});
