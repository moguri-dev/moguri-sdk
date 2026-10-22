import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { preparedTerminalOwner, terminalOwnerScope } from "../apps/service/src/terminal-identity.ts";
import { frameDigest } from "../apps/service/src/worker-wire.ts";
import { MoguriSdk, parse, projectEvents, TerminalOwnerSchema, type EventInput, type TerminalOwner, type TerminalState } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { writeLegacyState, assertCurrentSchema } from "./fixtures/legacy-state.ts";

const hash = "a".repeat(64), other = "b".repeat(64);
const remote = {
  target: { id: "generated-console", name: "Generated Remote console", host: "127.0.0.1", port: 2222, user: "generated",
    hostKey: "ssh-ed25519 Z2VuZXJhdGVkLXJlYWQtb25seS1wdWJsaWM=", identityFile: "/generated/identity", stateDir: "/generated/state", command: ["/generated/node", "/generated/terminal-bridge"] },
  peerDigest: hash, bridgeDigest: hash, brokerDigest: hash,
};
const preparing = (): TerminalOwner => {
  const owner: TerminalOwner = { id: randomUUID(), profileId: "default", env: "Remote", remote, protocol: 1, buildDigest: hash, scopeDigest: hash,
    directory: null, endpoint: null, pid: null, status: "preparing", cleanup: "retained", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", diagnostic: null };
  return { ...owner, scopeDigest: terminalOwnerScope(owner) };
};
const ownerEvent = (owner: TerminalOwner): Extract<EventInput, { event_type: "terminal.owner_changed" }> => ({ event_type: "terminal.owner_changed", profile_id: owner.profileId, payload: { owner } });
const terminalEvent = (terminal: TerminalState): Extract<EventInput, { event_type: "terminal.changed" }> => ({ event_type: "terminal.changed", profile_id: "default", project_id: terminal.projectId, session_id: terminal.sessionId, payload: { terminal } });

test("schema-25 Remote owner preparation is explicit and cannot become a Local endpoint or change observed owner identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-remote-owner-")), store = new EventStore(join(directory, "state.sqlite"), randomBytes(32));
  try {
    const intent = parse(TerminalOwnerSchema, preparing()); store.commit([ownerEvent(intent)]);
    assert.throws(() => preparedTerminalOwner(intent), { code: "terminal_owner_preparing" });
    assert.throws(() => parse(TerminalOwnerSchema, { ...intent, env: "Local" }), { code: "invalid_request" });
    const prepared = preparedTerminalOwner(parse(TerminalOwnerSchema, { ...intent, status: "starting", directory: "/generated/mo-123456789abc", endpoint: "/generated/mo-123456789abc/control.sock" }));
    store.commit([ownerEvent(prepared)]); store.commit([ownerEvent({ ...prepared, pid: 9001, status: "running" })]);
    const history = store.events(), observed = projectEvents(history).terminalOwners[0]!;
    assert.equal(observed.env, "Remote"); assert.equal(observed.pid, 9001);
    for (const changed of [{ pid: 9002 }, { directory: "/generated/mo-different" }, { scopeDigest: other }, { remote: { ...remote, peerDigest: other } },
      { remote: { ...remote, target: { ...remote.target, port: 2223 } } }]) {
      const next = parse(TerminalOwnerSchema, { ...observed, ...changed });
      const synthetic = { ...history.at(-1)!, ...ownerEvent(next), id: randomUUID(), seq: history.at(-1)!.seq + 1 };
      assert.throws(() => projectEvents([...history, synthetic]), { code: "terminal_owner_corrupt" });
    }
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

test("Remote terminal projection requires the original owner/peer and cannot rewrite binding bytes, env or command under the same digest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-remote-terminal-")), store = new EventStore(join(directory, "state.sqlite"), randomBytes(32));
  try {
    const owner = parse(TerminalOwnerSchema, { ...preparing(), status: "running", pid: 9001, directory: "/generated/mo-123456789abc", endpoint: "/generated/mo-123456789abc/control.sock" });
    store.commit([ownerEvent(owner)]);
    const binding = { env: "Remote" as const, profileId: "default", projectId: "generated-project", sessionId: "generated-session", workspaceId: null,
      root: "/generated/remote-root", device: "generated-device", inode: "generated-inode", peerDigest: hash, digest: hash };
    const terminal: TerminalState = { id: randomUUID(), sessionId: binding.sessionId, projectId: binding.projectId, workspaceId: null, title: "Generated Remote terminal",
      pid: null, cols: 80, rows: 24, status: "starting", diagnostic: null, env: "Remote", binding, ownerId: owner.id, commandId: randomUUID(), commandDigest: hash, launchDigest: hash };
    store.commit([terminalEvent(terminal)]);
    const history = store.events();
    for (const changed of [{ env: "Local" as const }, { binding: { ...binding, peerDigest: other } }, { binding: { ...binding, root: "/generated/changed-root" } }, { commandId: randomUUID() }]) {
      const synthetic = { ...history.at(-1)!, ...terminalEvent({ ...terminal, ...changed }), id: randomUUID(), seq: history.at(-1)!.seq + 1 };
      assert.throws(() => projectEvents([...history, synthetic]), { code: "terminal_corrupt" });
    }
    assert.equal(projectEvents(history).terminals[0]?.env, "Remote");
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

test("unready Remote owner reconciliation preserves nullable preparation without any Local filesystem or key fallback", { skip: process.platform !== "darwin" }, async () => {
  let reads = 0;
  const f = await setupFixture({ platform: { terminal: { vault: { read: async () => { reads++; throw new Error("No Local key read for a Remote owner."); }, write: async () => {}, remove: async () => {} } } } });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const owner = preparing(); f.service.store.commit([ownerEvent(owner)]); f.service.controller.refreshProfile(); await sdk.refresh();
    await sdk.terminal.reconcileOwner(owner.id); await sdk.refresh();
    const retained = sdk.getState().snapshot!.terminalOwners[0]!;
    assert.equal(retained.status, "unconfirmed"); assert.equal(retained.directory, null); assert.equal(retained.endpoint, null);
    assert.match(retained.diagnostic ?? "", /Remote owner preparation/); assert.equal(reads, 0);
    await sdk.terminal.acknowledgeOwner(owner.id, true);
  } finally { sdk.disconnect(); await f.close(); }
});

test("schema-24 Local console state migrates without replacing the original owner/PTY or ciphertext", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const program = { executable: "/bin/sh", args: ["-c", "printf 'GENERATED_SCHEMA24_OWNER\\n'; exec cat"] };
  const f = await setupFixture({ platform: { terminal: program } }), sdk = await new MoguriSdk(f.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const opened = await sdk.terminal.open(f.sessionId), before = await sdk.terminal.read(opened.id!), owner = sdk.getState().snapshot!.terminalOwners[0]!;
    sdk.disconnect(); await f.service.close({ preserveTerminals: true }); await writeLegacyState(f.service, 24);
    const raw = new DatabaseSync(f.service.store.path);
    const events = raw.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), keys = raw.prepare("SELECT scope,payload FROM retention_keys ORDER BY scope").all();
    raw.close();
    restarted = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey, platform: { terminal: { ...program, vault: f.terminalVault } } });
    const current = await new MoguriSdk(restarted.connection).ready();
    try {
      assertCurrentSchema(restarted.store);
      const after = await current.terminal.read(opened.id!);
      assert.equal(after.terminal.pid, before.terminal.pid); assert.equal(after.terminal.ownerId, owner.id);
      assert.equal(current.getState().snapshot!.terminalOwners[0]?.pid, owner.pid); assert.equal(after.terminal.env, "Local");
      assert.deepEqual(restarted.store.db.prepare("SELECT seq,id,data,payload FROM events WHERE seq<=? ORDER BY seq").all(Number(events.at(-1)!.seq)), events);
      assert.deepEqual(restarted.store.db.prepare("SELECT scope,payload FROM retention_keys ORDER BY scope").all(), keys);
      assert.equal(frameDigest(after.terminal.binding), frameDigest(before.terminal.binding));
      await current.terminal.close(opened.id!); assert.equal(f.requests.length, 0);
    } finally { current.disconnect(); }
  } finally { sdk.disconnect(); await restarted?.close(); await f.close(); }
});

test("schema-25 marker failure leaves exact schema-24 metadata/ciphertext usable without deleting state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-console-migration-")), path = join(directory, "state.sqlite"), key = randomBytes(32);
  let store: EventStore | undefined = new EventStore(path, key);
  try {
    store.commit([{ event_type: "job.progress", profile_id: "default", payload: { jobId: "generated-schema24", progress: "Generated exact encrypted source." } }]);
    const before = store.db.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all();
    store.db.exec(`BEGIN IMMEDIATE; DROP TABLE memory_scopes; DELETE FROM retention_metadata WHERE id IN ('remote_memory_schema','remote_terminal_schema','remote_repository_schema','candidate_workflow_schema','candidate_execution_schema','budget_planning_schema','candidate_generation_schema','role_sequence_schema','candidate_role_schema','model_evidence_schema','owned_role_contract_schema','paste_file_schema','native_execution_schema','compound_workflow_schema','budget_winddown_schema','owned_decision_schema','task_progress_schema','document_attachment_schema'); PRAGMA user_version=24;
      CREATE TRIGGER generated_remote_terminal_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='remote_terminal_schema'
      BEGIN SELECT RAISE(ABORT,'Generated console migration interruption'); END; COMMIT;`);
    store.close(); store = undefined;
    assert.throws(() => new EventStore(path, key), /Generated console migration interruption/);
    const raw = new DatabaseSync(path);
    try {
      assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, 24);
      assert.deepEqual(raw.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), before);
      raw.exec("DROP TRIGGER generated_remote_terminal_marker");
    } finally { raw.close(); }
    store = new EventStore(path, key); assertCurrentSchema(store);
    assert.deepEqual(store.db.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), before);
  } finally { store?.close(); await rm(directory, { recursive: true, force: true }); }
});
