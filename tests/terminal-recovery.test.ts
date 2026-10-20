import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { stopMoguriService } from "../packages/sdk/src/node.ts";
import { executeSlash } from "../packages/sdk/src/slash.ts";
import { startService } from "../apps/service/src/server.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { TerminalChannel } from "../apps/service/src/terminal-channel.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { writeLegacyState } from "./fixtures/legacy-state.ts";
import { profileFixture } from "./fixtures/profiles.ts";

const native = { skip: process.platform !== "darwin" };
const program = { executable: "/bin/sh", args: ["-c", "printf 'GENERATED_RECOVERY_READY\\n'; exec cat"] };

test("schema-23 marker failure preserves exact schema-22 ciphertext and restarts without deleting user state", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-terminal-migration-")), path = join(root, "state.sqlite"), key = randomBytes(32);
  let store: EventStore | undefined = new EventStore(path, key, "generated-terminal-key");
  try {
    store.commit([{ event_type: "job.progress", profile_id: "default", payload: { jobId: "generated-source", progress: "Generated encrypted terminal migration source." } }]);
    const before = store.db.prepare("SELECT seq,id,payload FROM events ORDER BY seq").all();
    store.db.exec(`BEGIN IMMEDIATE; DELETE FROM retention_metadata WHERE id='terminal_ownership_schema'; PRAGMA user_version=22;
      CREATE TRIGGER generated_terminal_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='terminal_ownership_schema'
      BEGIN SELECT RAISE(ABORT,'Generated terminal marker failure'); END; COMMIT;`);
    store.close(); store = undefined;
    assert.throws(() => new EventStore(path, key, "generated-terminal-key"), /Generated terminal marker failure/);
    const raw = new DatabaseSync(path);
    try {
      assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, 22);
      assert.deepEqual(raw.prepare("SELECT seq,id,payload FROM events ORDER BY seq").all(), before);
      raw.exec("DROP TRIGGER generated_terminal_marker");
    } finally { raw.close(); }
    store = new EventStore(path, key, "generated-terminal-key");
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(store.db.prepare("SELECT seq,id,payload FROM events ORDER BY seq").all(), before);
  } finally { store?.close(); await rm(root, { recursive: true, force: true }); }
});

test("a missing explicit key or non-private endpoint cannot replace an owner; restoration reattaches its exact original process", native, async () => {
  const fixture = await setupFixture({ platform: { terminal: program } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined;
  let restore: { id: string; value: string; directory: string } | undefined;
  try {
    const opened = await sdk.terminal.open(fixture.sessionId), before = await sdk.terminal.read(opened.id!), owner = sdk.getState().snapshot!.terminalOwners[0]!;
    const slot = `terminal-owner-${owner.id}`, key = await fixture.terminalVault.read(slot);
    assert.ok(key); restore = { id: slot, value: key, directory: owner.directory };
    await assert.rejects(() => TerminalChannel.connect(owner, key, randomUUID()), { code: "terminal_owner_busy" });
    sdk.disconnect(); await fixture.service.close({ preserveTerminals: true }); await writeLegacyState(fixture.service, 22);
    await fixture.terminalVault.remove(slot);
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey, platform: { terminal: { vault: fixture.terminalVault } } });
    peer = await new MoguriSdk(restarted.connection).ready();
    assert.equal(peer.getState().snapshot!.terminals[0]?.status, "unconfirmed");
    await assert.rejects(() => peer!.terminal.open(fixture.sessionId), { code: "terminal_owner_unconfirmed" });
    assert.equal(peer.getState().snapshot!.terminalOwners.length, 1);
    await fixture.terminalVault.write(slot, key); await chmod(owner.directory, 0o755);
    await peer.terminal.reconcile(opened.id!);
    assert.equal(peer.getState().snapshot!.terminals[0]?.status, "unconfirmed");
    assert.match(peer.getState().snapshot!.terminalOwners[0]!.diagnostic!, /private|canonical|user-owned/);
    await chmod(owner.directory, 0o700); await peer.terminal.reconcile(opened.id!);
    const after = await peer.terminal.read(opened.id!);
    assert.equal(after.terminal.pid, before.terminal.pid); assert.equal(after.terminal.status, "running");
    assert.notEqual(after.terminal.attachmentId, before.terminal.attachmentId);
    await peer.terminal.input(opened.id!, "GENERATED_AFTER_KEY_RESTORATION\n"); await peer.terminal.close(opened.id!);
    assert.equal(fixture.requests.length, 0);
  } finally {
    if (restore) { await fixture.terminalVault.write(restore.id, restore.value); await chmod(restore.directory, 0o700); }
    sdk.disconnect(); peer?.disconnect(); await restarted?.close(); await fixture.close();
  }
});

test("a retained launch with failed running-state publication is inspected, not launched a second time", native, async (t) => {
  const fixture = await setupFixture({ platform: { terminal: program } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const commit = fixture.service.store.commit.bind(fixture.service.store);
    let failed = false;
    const mock = t.mock.method(fixture.service.store, "commit", (...args: Parameters<typeof commit>) => {
      if (!failed && args[0].some((event) => event.event_type === "terminal.changed" && event.payload.terminal.status === "running")) { failed = true; throw new Error("Generated terminal metadata failure"); }
      return commit(...args);
    });
    await assert.rejects(() => sdk.terminal.open(fixture.sessionId)); mock.mock.restore();
    await sdk.refresh();
    const terminal = sdk.getState().snapshot!.terminals[0]!;
    assert.equal(terminal.status, "unconfirmed"); assert.equal(terminal.pid, null);
    await sdk.terminal.reconcile(terminal.id);
    const actual = await sdk.terminal.read(terminal.id);
    assert.equal(actual.terminal.status, "running"); assert.ok(actual.terminal.pid);
    assert.equal(sdk.getState().snapshot!.terminals.length, 1); assert.equal(sdk.getState().snapshot!.terminalOwners.length, 1);
    await sdk.terminal.close(terminal.id);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("shutdown cancels a pending secret-store admission before any owner process or PTY is started", native, async () => {
  let held = false;
  const fixture = await setupFixture({ platform: { terminal: { ...program, vault: {
    read: async () => null, remove: async () => {},
    write: async (_id, _value, signal) => {
      held = true;
      await new Promise<void>((_resolve, reject) => {
        if (!signal) { reject(new Error("Generated admission needs an abort signal")); return; }
        if (signal.aborted) { reject(signal.reason); return; }
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  } } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const pending = sdk.terminal.open(fixture.sessionId), rejected = assert.rejects(() => pending);
    await waitFor(() => held); await fixture.service.close(); await rejected;
    const state = fixture.service.controller.snapshot();
    assert.equal(state.terminals.length, 0); assert.equal(state.terminalOwners.length, 1);
    assert.equal(state.terminalOwners[0]?.pid, null); assert.equal(state.terminalOwners[0]?.status, "stopped");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a changed root inode cannot receive old terminal input but the captured process can still be stopped", native, async () => {
  const fixture = await setupFixture({ platform: { terminal: program } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const opened = await sdk.terminal.open(fixture.sessionId);
    await rename(fixture.project, join(fixture.directory, "original-root")); await mkdir(fixture.project);
    await assert.rejects(() => sdk.terminal.input(opened.id!, "GENERATED_FORBIDDEN_ROOT_INPUT\n"), { code: "terminal_root_changed" });
    await assert.rejects(() => sdk.terminal.resize(opened.id!, 90, 30), { code: "terminal_root_changed" });
    await sdk.terminal.close(opened.id!); assert.equal((await sdk.terminal.read(opened.id!)).terminal.status, "closed");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("SDK cancellation and attachment changes discard unsent input chunks instead of crossing controller epochs", native, async (t) => {
  const fixture = await setupFixture({ platform: { terminal: program } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const opened = await sdk.terminal.open(fixture.sessionId), manager = fixture.service.controller.platform.sessions.terminals;
    const original = manager.input.bind(manager), abort = new AbortController();
    let submitted = 0;
    const cancelled = t.mock.method(manager, "input", async (...args: Parameters<typeof original>) => { submitted++; await original(...args); abort.abort(); });
    await assert.rejects(() => sdk.terminal.input(opened.id!, "x".repeat(32768), abort.signal), { name: "AbortError" });
    assert.equal(submitted, 1); cancelled.mock.restore();
    const epoch = t.mock.method(manager, "input", async (...args: Parameters<typeof original>) => { submitted++; await original(...args); await manager.reconcile(opened.id!); await sdk.refresh(); });
    await assert.rejects(() => sdk.terminal.input(opened.id!, "y".repeat(32768)), { code: "terminal_input_stopped" });
    assert.equal(submitted, 2); epoch.mock.restore(); await sdk.terminal.close(opened.id!);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("shared CLI/TUI console commands inspect exact session ownership and never implicitly open a terminal", native, async () => {
  const fixture = await setupFixture({ platform: { terminal: program } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    assert.equal((await executeSlash(sdk, fixture.sessionId, "/terminals", "tui")).kind, "text");
    assert.equal(sdk.getState().snapshot!.terminals.length, 0);
    const opened = await sdk.terminal.open(fixture.sessionId);
    const child = await sdk.sessions.spawn(fixture.sessionId, "side");
    await assert.rejects(() => executeSlash(sdk, child.id!, `/terminals close ${opened.id}`, "tui"), { code: "terminal_scope" });
    for (const client of ["cli", "tui"] as const) {
      assert.equal((await executeSlash(sdk, fixture.sessionId, `/terminals read ${opened.id}`, client)).kind, "text");
      assert.equal((await executeSlash(sdk, fixture.sessionId, `/terminals reconcile ${opened.id}`, client)).kind, "text");
    }
    await executeSlash(sdk, fixture.sessionId, `/terminals close ${opened.id}`, "tui");
    assert.equal((await sdk.terminal.read(opened.id!)).terminal.status, "closed"); assert.equal(sdk.getState().snapshot!.terminals.length, 1);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("failed private-key cleanup keeps the registry/writer lock and an explicit stop retry removes only proven-stopped resources", native, async (t) => {
  const secrets = new Map<string, string>();
  let rejectRemove = true;
  const fixture = await setupFixture({ platform: { terminal: { ...program, vault: {
    read: async (id) => secrets.get(id) ?? null, write: async (id, value) => { secrets.set(id, value); },
    remove: async (id) => { if (rejectRemove) throw new Error("Generated secret-backend cleanup failure"); secrets.delete(id); },
  } } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const gateway = fixture.service.controller.platform.gateway, remote = fixture.service.controller.remote;
    const gatewayClose = t.mock.method(gateway, "close", gateway.close.bind(gateway)), remoteClose = t.mock.method(remote, "close", remote.close.bind(remote));
    await sdk.terminal.open(fixture.sessionId);
    await assert.rejects(() => stopMoguriService(join(fixture.directory, "state")), /shutdown is unconfirmed/);
    await lstat(join(fixture.directory, "state/connection.json")); await lstat(join(fixture.directory, "state/service.lock"));
    const stopped = fixture.service.controller.snapshot().terminalOwners[0]!;
    assert.equal(stopped.status, "stopped"); assert.equal(stopped.cleanup, "pending"); assert.equal(secrets.size, 1);
    assert.equal(gatewayClose.mock.calls.length, 1); assert.equal(remoteClose.mock.calls.length, 1);
    const denied = await fetch(`${fixture.service.connection.baseUrl}/v1/commands`, { method: "POST",
      headers: { Authorization: `Bearer ${fixture.service.connection.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: randomUUID(), profileId: "default", command: { type: "terminal.open", sessionId: fixture.sessionId, cols: 80, rows: 24 } }) });
    assert.equal(denied.status, 503); assert.equal((await denied.json()).error.code, "shutting_down");
    rejectRemove = false; await stopMoguriService(join(fixture.directory, "state"));
    assert.equal(fixture.service.controller.snapshot().terminalOwners[0]?.cleanup, "removed"); assert.equal(secrets.size, 0);
    await assert.rejects(() => lstat(stopped.directory), { code: "ENOENT" });
  } finally { rejectRemove = false; sdk.disconnect(); await fixture.close(); }
});

test("runtime cleanup never recursively removes an unrelated file and can retry after explicit inspection", native, async () => {
  const fixture = await setupFixture({ platform: { terminal: program } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let sentinel: string | undefined;
  try {
    await sdk.terminal.open(fixture.sessionId);
    const owner = sdk.getState().snapshot!.terminalOwners[0]!;
    sentinel = join(owner.directory, "generated-unrelated-file");
    await writeFile(sentinel, "Generated unrelated bytes must survive cleanup.\n");
    await assert.rejects(() => fixture.service.close(), { code: "terminal_runtime_cleanup" });
    assert.equal(await readFile(sentinel, "utf8"), "Generated unrelated bytes must survive cleanup.\n");
    assert.equal(fixture.service.controller.snapshot().terminalOwners[0]?.cleanup, "pending");
    await unlink(sentinel); sentinel = undefined;
    await fixture.service.close(); assert.equal(fixture.service.controller.snapshot().terminalOwners[0]?.cleanup, "removed");
  } finally { if (sentinel) await unlink(sentinel); sdk.disconnect(); await fixture.close(); }
});

test("opposite concurrent lifecycle operations are not both accepted as the same shutdown", native, async (t) => {
  const fixture = await setupFixture({ platform: { terminal: program } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let held = false, release = () => {}, restarted: Awaited<ReturnType<typeof startService>> | undefined;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  try {
    await sdk.terminal.open(fixture.sessionId);
    const manager = fixture.service.controller.platform.sessions.terminals, close = manager.closeAll.bind(manager);
    t.mock.method(manager, "closeAll", async (...args: Parameters<typeof close>) => { held = true; await barrier; return close(...args); });
    const request = (action: string) => fetch(`${fixture.service.connection.baseUrl}/v1/lifecycle`, { method: "POST",
      headers: { Authorization: `Bearer ${fixture.service.connection.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    assert.equal((await request("restart")).status, 200); await waitFor(() => held);
    const conflict = await request("stop"); assert.equal(conflict.status, 409); assert.equal((await conflict.json()).error.code, "lifecycle_conflict");
    release(); sdk.disconnect(); await fixture.service.close({ preserveTerminals: true });
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey, platform: { terminal: { vault: fixture.terminalVault } } });
    assert.equal(restarted.controller.snapshot().terminals[0]?.status, "running");
  } finally { release(); sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("profile-isolated owners recover eagerly and ordinary stop covers a profile no client reopened", native, async () => {
  const fixture = await profileFixture(() => ({ terminal: program }));
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const { client: beta } = await fixture.create("Generated terminal Beta"), projectRoot = join(fixture.directory, "generated-beta-project");
    await mkdir(projectRoot);
    const project = await beta.command({ type: "project.add", path: projectRoot }), session = await beta.sessions.create(project.id!);
    const opened = await beta.terminal.open(session.id!), owner = beta.getState().snapshot!.terminalOwners[0]!;
    await assert.rejects(() => fixture.sdk.terminal.read(opened.id!), { code: "terminal_missing" });
    assert.equal(fixture.sdk.getState().snapshot!.terminalOwners.length, 0);
    assert.equal(JSON.stringify(fixture.sdk.getState()).includes(owner.directory), false);
    for (const client of fixture.clients) client.disconnect();
    await fixture.service.close({ preserveTerminals: true });
    restarted = await startService(fixture.options);
    await restarted.close();
    assert.equal(fixture.vaults.get(beta.profileId)?.size, 0);
    await assert.rejects(() => lstat(owner.directory), { code: "ENOENT" });
    await waitFor(() => { try { process.kill(owner.pid!, 0); return false; } catch (error) { if (error instanceof Error && "code" in error && error.code === "ESRCH") return true; throw error; } });
    assert.equal(fixture.providers.reduce((total, provider) => total + provider.requests.length, 0), 0);
  } finally { await restarted?.close(); await fixture.close(); }
});

test("a new broker whose PID publication fails is stopped through its owned child handle before any PTY launch", native, async (t) => {
  const fixture = await setupFixture({ platform: { terminal: program } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const commit = fixture.service.store.commit.bind(fixture.service.store);
    let failed = false;
    const mock = t.mock.method(fixture.service.store, "commit", (...args: Parameters<typeof commit>) => {
      if (!failed && args[0].some((event) => event.event_type === "terminal.owner_changed" && event.payload.owner.status === "starting" && event.payload.owner.pid !== null)) {
        failed = true; throw new Error("Generated new broker PID retention failure");
      }
      return commit(...args);
    });
    await assert.rejects(() => sdk.terminal.open(fixture.sessionId), { code: "terminal_owner_failed" }); mock.mock.restore();
    const state = fixture.service.controller.snapshot(), owner = state.terminalOwners[0]!;
    assert.equal(state.terminals.length, 0); assert.equal(owner.status, "stopped"); assert.equal(owner.cleanup, "removed");
    assert.ok(owner.pid); assert.throws(() => process.kill(owner.pid!, 0), { code: "ESRCH" });
    await assert.rejects(() => lstat(owner.directory), { code: "ENOENT" });
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a partially failed secret write removes its exact generated key without spawning a broker or shell", native, async () => {
  const secrets = new Map<string, string>();
  const fixture = await setupFixture({ platform: { terminal: { ...program, vault: {
    read: async (id) => secrets.get(id) ?? null, write: async (id, value) => { secrets.set(id, value); throw new Error("Generated secret write reported failure after retention"); },
    remove: async (id) => { secrets.delete(id); },
  } } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await assert.rejects(() => sdk.terminal.open(fixture.sessionId), { code: "terminal_secret_store" });
    assert.equal(secrets.size, 0);
    const state = fixture.service.controller.snapshot();
    assert.equal(state.terminals.length, 0); assert.equal(state.terminalOwners[0]?.pid, null); assert.equal(state.terminalOwners[0]?.cleanup, "removed");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("an empty owner remains inspectable when root authority changes before the first PTY intent", native, async () => {
  const secrets = new Map<string, string>();
  let held = false, release = () => {};
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const fixture = await setupFixture({ platform: { terminal: { ...program, vault: {
    read: async (id) => secrets.get(id) ?? null, write: async (id, value) => { secrets.set(id, value); held = true; await barrier; },
    remove: async (id) => { secrets.delete(id); },
  } } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined;
  let restore: { id: string; key: string } | undefined;
  try {
    const opening = sdk.terminal.open(fixture.sessionId), rejected = assert.rejects(() => opening, { code: "terminal_env" });
    await waitFor(() => held); await sdk.command({ type: "policy.set", allowedEnvs: ["Remote"] }); release(); await rejected;
    await sdk.refresh();
    const owner = sdk.getState().snapshot!.terminalOwners[0]!;
    assert.equal(sdk.getState().snapshot!.terminals.length, 0); assert.equal(owner.status, "running");
    const slot = `terminal-owner-${owner.id}`, key = secrets.get(slot)!; assert.ok(key); restore = { id: slot, key };
    sdk.disconnect(); await fixture.service.close({ preserveTerminals: true }); secrets.delete(slot);
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey, platform: { terminal: { vault: fixture.terminalVault } } });
    peer = await new MoguriSdk(restarted.connection).ready();
    assert.equal(peer.getState().snapshot!.terminalOwners[0]?.status, "unconfirmed");
    const list = await executeSlash(peer, fixture.sessionId, "/terminals", "tui");
    assert.ok(list.kind === "text"); assert.match(list.text, new RegExp(owner.id));
    secrets.set(slot, key); await peer.terminal.reconcileOwner(owner.id);
    assert.equal(peer.getState().snapshot!.terminalOwners[0]?.status, "running");
    assert.equal(peer.getState().snapshot!.terminalOwners[0]?.pid, owner.pid); assert.equal(peer.getState().snapshot!.terminals.length, 0);
    await assert.rejects(() => peer!.terminal.acknowledgeOwner(owner.id, true), { code: "terminal_owner_state" });
    assert.equal(fixture.requests.length, 0);
  } finally { release(); if (restore) secrets.set(restore.id, restore.key); sdk.disconnect(); peer?.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("an admitted starting terminal blocks project relocation and artifact publication before its actual PTY launch", native, async (t) => {
  const fixture = await setupFixture({ platform: { terminal: program } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let held = false, release = () => {};
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const request = TerminalChannel.prototype.request;
  try {
    const projectId = fixture.session().projectId, destination = join(fixture.directory, "generated-relocation"); await mkdir(destination);
    await sdk.artifacts.create(fixture.sessionId, { kind: "decision", name: "Generated console-owned root decision", text: "Generated independently retained bytes." });
    t.mock.method(TerminalChannel.prototype, "request", async function (this: TerminalChannel, input: Parameters<typeof request>[0]) {
      if (input.action === "open") { held = true; await barrier; }
      return request.call(this, input);
    });
    const opening = sdk.terminal.open(fixture.sessionId);
    await waitFor(() => held);
    assert.equal(fixture.service.controller.snapshot().terminals[0]?.status, "starting");
    const configuration = (await sdk.projects.configuration(projectId)).configuration;
    await assert.rejects(() => sdk.projects.relocate(projectId, destination, configuration.revision), { code: "project_busy" });
    const preview = (await sdk.artifacts.materializePreview(projectId)).preview;
    await assert.rejects(() => sdk.artifacts.materialize(projectId, preview.digest), { code: "workspace_busy" });
    release(); const terminal = await opening; await sdk.terminal.close(terminal.id!);
  } finally { release(); sdk.disconnect(); await fixture.close(); }
});
