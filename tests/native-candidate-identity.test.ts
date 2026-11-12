import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultSettings, PROTOCOL_VERSION, type CandidateRoot, type CandidateTransportRecord } from "../packages/sdk/src/index.ts";
import { candidateIdentity, executeCandidateOperation } from "../apps/service/src/candidate-worker.ts";
import type { CandidateWorkerOperation, CandidateWorkerScope } from "../apps/service/src/candidate-worker-protocol.ts";
import { nativeCandidateRootGrant } from "../apps/service/src/native-candidate-identity.ts";
import { captureNativeSource, materializeNativeStage } from "../apps/service/src/native-staging.ts";
import { EventStore, digest } from "../apps/service/src/store.ts";
import { candidateTransportHistory } from "../apps/service/src/candidate-transports.ts";
import { removeNativeCandidateIdentityFixtureMarker } from "./fixtures/legacy-state.ts";

const hash = "1".repeat(64), sourceText = "Generated native identity source.\n";
function scope(root: string): CandidateWorkerScope {
  return { env: "Sandbox", nativeRootVersion: 3, profileId: "default", sessionId: randomUUID(), projectId: randomUUID(), sourceWorkspaceId: null,
    stateRoot: join(root, ".moguri"), boundary: { env: "Sandbox", workspaceId: randomUUID(), inputDigest: hash, configurationDigest: hash, workerDigest: hash, sourceRoot: root },
    folders: { denied: [], readOnly: [] } };
}
const original: CandidateRoot = { version: 2, env: "Sandbox", projectId: "generated-project", workspaceId: null,
  root: "/workspace", device: "27", inode: "3", snapshotDigest: hash,
  boundary: { env: "Sandbox", workspaceId: "generated-private-workspace", inputDigest: hash, configurationDigest: hash, workerDigest: hash, sourceRoot: "/workspace" } };

test("native grants keep stable host-private identity across differing guest inodes but reject a replaced or foreign actual host root", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-native-identity-")));
  try {
    const source = join(directory, "source"), state = join(directory, "state");
    await mkdir(source); await mkdir(state, { mode: 0o700 }); await writeFile(join(source, "fixture.txt"), sourceText);
    const owner = { profileId: "default", sessionId: randomUUID(), turnId: randomUUID() };
    const stage = await materializeNativeStage(state, owner, await captureNativeSource(source, ["fixture.txt"], { denied: [], readOnly: [] }, AbortSignal.timeout(5000)), AbortSignal.timeout(5000));
    const boundary = { ...scope("/workspace"), sessionId: owner.sessionId };
    const operation: CandidateWorkerOperation = { kind: "candidate.operation", operationId: randomUUID(), action: "source", paths: [], scope: boundary };
    const first = await nativeCandidateRootGrant(stage, operation, { root: "/workspace", device: "27", inode: "3" });
    const second = await nativeCandidateRootGrant(stage, operation, { root: "/workspace", device: "27", inode: "2" });
    assert.deepEqual(first.private, stage.workspaceIdentity); assert.deepEqual(second.private, first.private);
    assert.notDeepEqual(first.guest, second.guest);
    await assert.rejects(() => nativeCandidateRootGrant(stage, { ...operation, scope: { ...boundary, profileId: "generated-foreign" } },
      { root: "/workspace", device: "27", inode: "3" }), { code: "candidate_native_identity" });
    await assert.rejects(() => nativeCandidateRootGrant(stage, operation, { root: "/workspace/.moguri/foreign", device: "27", inode: "3" }), { code: "candidate_native_identity" });
    await rename(stage.workspace, `${stage.workspace}-retained`);
    await mkdir(stage.workspace, { mode: 0o700 }); await writeFile(join(stage.workspace, "fixture.txt"), sourceText);
    await assert.rejects(() => nativeCandidateRootGrant(stage, operation, { root: "/workspace", device: "27", inode: "3" }), /replaced|identity|private/i);
    assert.equal(await readFile(join(`${stage.workspace}-retained`, "fixture.txt"), "utf8"), sourceText);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the native worker requires an acknowledged private-root grant and detects replacement after its real per-file attempt without writing another root", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-native-worker-identity-")));
  try {
    await writeFile(join(directory, "fixture.txt"), sourceText, { mode: 0o600 });
    const binding = scope(directory), grant = async (guest: { root: string; device: string; inode: string }) =>
      ({ version: 1 as const, root: guest.root, guest: { device: guest.device, inode: guest.inode }, private: { device: guest.device, inode: guest.inode } });
    const call = (action: object, boundary = async (_phase: string, _path: string | null) => {}) =>
      executeCandidateOperation(directory, { kind: "candidate.operation", operationId: randomUUID(), scope: binding, ...action }, AbortSignal.timeout(5000), boundary, grant);
    await assert.rejects(() => executeCandidateOperation(directory, { kind: "candidate.operation", operationId: randomUUID(), scope: binding, action: "source", paths: [] },
      AbortSignal.timeout(5000), async () => {}), /grant|identity/i);
    const source = await call({ action: "source", paths: ["fixture.txt"] });
    assert.equal(source.type, "source"); if (source.type !== "source") assert.fail();
    assert.equal(source.source.env === "Sandbox" && source.source.version, 3);
    const stage = await call({ action: "create", workspaceId: randomUUID(), source: source.source });
    assert.equal(stage.type, "created"); if (stage.type !== "created") assert.fail();
    await assert.rejects(() => call({ action: "create", workspaceId: randomUUID(), source: { ...source.source, version: 2, identityNamespace: undefined } }), /schema|historical|grant/i);
    const patch = { kind: "patch" as const, summary: "Generated replacement refusal.", edits: [{ path: "fixture.txt", baseDigest: digest(sourceText), text: "Generated proposal.\n" }] };
    await assert.rejects(() => call({ action: "write", candidateId: randomUUID(), phase: "stage", source: source.source, stage: stage.stage, patch },
      async (phase) => {
        if (phase !== "attempt") return;
        await rename(stage.stage.root, `${stage.stage.root}-retained`); await mkdir(stage.stage.root, { mode: 0o700 });
        await writeFile(join(stage.stage.root, "fixture.txt"), "Generated replacement root preserved.\n", { mode: 0o600 });
      }), /changed|replaced|identity|marker/i);
    assert.equal(await readFile(join(directory, "fixture.txt"), "utf8"), sourceText);
    assert.equal(await readFile(join(stage.stage.root, "fixture.txt"), "utf8"), "Generated replacement root preserved.\n");
    assert.equal(await readFile(join(`${stage.stage.root}-retained`, "fixture.txt"), "utf8"), sourceText);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a missing or failed exact native identity acknowledgement cannot copy source into a partially created candidate stage", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-native-grant-loss-")));
  try {
    await writeFile(join(directory, "fixture.txt"), sourceText, { mode: 0o600 });
    const binding = scope(directory), identities = candidateIdentity(binding, async (guest) => ({
      version: 1, root: guest.root, guest, private: guest,
    }));
    await assert.rejects(() => identities.capture(directory), /changed|acknowledgement/i);
    const grant = async (guest: { root: string; device: string; inode: string }) =>
      ({ version: 1 as const, root: guest.root, guest: { device: guest.device, inode: guest.inode }, private: { device: guest.device, inode: guest.inode } });
    const base = { kind: "candidate.operation" as const, operationId: randomUUID(), scope: binding };
    const source = await executeCandidateOperation(directory, { ...base, action: "source", paths: [] }, AbortSignal.timeout(5000), async () => {}, grant);
    if (source.type !== "source") assert.fail();
    const workspaceId = randomUUID(), stage = join(binding.stateRoot, "candidate-workspaces", binding.profileId, workspaceId, "workspace");
    await assert.rejects(() => executeCandidateOperation(directory, { ...base, operationId: randomUUID(), action: "create", workspaceId, source: source.source },
      AbortSignal.timeout(5000), async () => {}, async (guest) => {
        if (guest.root === stage) throw new Error("Generated grant storage failure.");
        return grant(guest);
      }), /grant storage failure/i);
    await assert.rejects(() => readFile(join(stage, "fixture.txt")), { code: "ENOENT" });
    await assert.rejects(() => readFile(join(stage, "../owner.json")), { code: "ENOENT" });
    assert.equal(await readFile(join(directory, "fixture.txt"), "utf8"), sourceText);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("genuine101 migration rollback and reopen preserve historical native VM roots, encrypted result grants and original receipts without minting identities", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-native-identity-migration-")), path = join(directory, "state.sqlite"), key = Buffer.alloc(32, 0x58);
  let store: EventStore | undefined = new EventStore(path, key);
  try {
    const id = randomUUID(), sessionId = randomUUID();
    const running: CandidateTransportRecord = { version: 1, id, ownerId: randomUUID(), ownerKind: "read", profileId: "default", sessionId,
      projectId: original.projectId, operationDigest: hash, authorityDigest: hash, boundary: original.env === "Sandbox" ? original.boundary : assert.fail(),
      launchJson: JSON.stringify({ kind: "Sandbox", execution: { id, sessionId, workspaceId: "generated-private-workspace" } }),
      observationJson: null, revision: 0, sequence: 0, status: "running", resultDigest: null, stopRequested: false, terminalAcknowledged: false, cleanupConfirmed: false, diagnostic: null };
    store.commit([{ event_type: "settings.updated", profile_id: "default", payload: { settings: defaultSettings(), revision: 3, permissionRevision: 0 } },
      { event_type: "candidate.transport_recorded", profile_id: "default", session_id: sessionId, project_id: original.projectId, payload: { transport: running } }]);
    const result = JSON.stringify({ type: "source", source: original, files: [{ path: "fixture.txt", baseDigest: digest(sourceText), text: sourceText }] });
    const resultDigest = store.putBlob(result);
    store.commit([{ event_type: "candidate.transport_recorded", profile_id: "default", session_id: sessionId, project_id: original.projectId,
      payload: { transport: { ...running, status: "completed", resultDigest, revision: 1, terminalAcknowledged: true, cleanupConfirmed: true } } }],
    { id: "generated-original-native-read", digest: hash, result: { id } });
    const before = store.db.prepare("SELECT seq,data,payload FROM events ORDER BY seq").all(), keys = store.db.prepare("SELECT scope,payload FROM retention_keys ORDER BY scope").all();
    const receipts = store.db.prepare("SELECT profile_id,id,digest,result FROM receipts ORDER BY id").all();
    removeNativeCandidateIdentityFixtureMarker(store.db, store.events());
    store.db.exec("PRAGMA user_version=101; CREATE TRIGGER generated_identity_migration BEFORE INSERT ON retention_metadata WHEN NEW.id='native_candidate_identity_schema' BEGIN SELECT RAISE(ABORT,'Generated native identity migration failure'); END;");
    store.close(); store = undefined;
    assert.throws(() => new EventStore(path, key), /Generated native identity migration failure/);
    const raw = new DatabaseSync(path);
    try {
      assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, 101);
      assert.deepEqual(raw.prepare("SELECT seq,data,payload FROM events ORDER BY seq").all(), before);
      assert.deepEqual(raw.prepare("SELECT scope,payload FROM retention_keys ORDER BY scope").all(), keys);
      raw.exec("DROP TRIGGER generated_identity_migration");
    } finally { raw.close(); }
    store = new EventStore(path, key);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(store.db.prepare("SELECT seq,data,payload FROM events ORDER BY seq").all(), before);
    assert.deepEqual(store.db.prepare("SELECT scope,payload FROM retention_keys ORDER BY scope").all(), keys);
    assert.deepEqual(store.db.prepare("SELECT profile_id,id,digest,result FROM receipts ORDER BY id").all(), receipts);
    assert.equal(store.blob(resultDigest), result);
    const retained = candidateTransportHistory(store.events())[0]!;
    assert.equal(retained.version, 1); assert.equal(retained.nativeRoots, undefined);
    assert.deepEqual(JSON.parse(store.blob(retained.resultDigest!)).source, original);
    store.db.exec("DELETE FROM retention_metadata WHERE id='native_candidate_identity_schema'"); store.close(); store = undefined;
    assert.throws(() => new EventStore(path, key), /native candidate identity.*marker|marker.*native candidate identity/i);
  } finally { store?.close(); await rm(directory, { recursive: true, force: true }); }
});

test("a forged101 downgrade cannot erase actual new native identity intent or mint its missing102 marker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-native-identity-lineage-")), path = join(directory, "state.sqlite"), key = Buffer.alloc(32, 0x59);
  let store: EventStore | undefined = new EventStore(path, key);
  const sessionId = randomUUID();
  try {
    const transport: CandidateTransportRecord = { version: 2, nativeRoots: [], id: randomUUID(), ownerId: randomUUID(), ownerKind: "read",
      profileId: "default", sessionId, projectId: original.projectId, operationDigest: hash, authorityDigest: hash,
      boundary: original.env === "Sandbox" ? original.boundary : assert.fail(), launchJson: "{}", observationJson: null,
      revision: 0, sequence: 0, status: "running", resultDigest: null, stopRequested: false, terminalAcknowledged: false, cleanupConfirmed: false, diagnostic: null };
    store.commit([{ event_type: "candidate.transport_recorded", profile_id: "default", session_id: sessionId, project_id: original.projectId, payload: { transport } }]);
    const current = store;
    assert.throws(() => removeNativeCandidateIdentityFixtureMarker(current.db, current.events()), /genuine pre-102/i);
    const before = store.db.prepare("SELECT seq,data,payload FROM events ORDER BY seq").all();
    store.db.exec("DELETE FROM retention_metadata WHERE id='native_candidate_identity_schema'; PRAGMA user_version=101;"); store.close(); store = undefined;
    assert.throws(() => new EventStore(path, key), /versioned native identity.*pre-102/i);
    const raw = new DatabaseSync(path);
    try {
      assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, 101);
      assert.deepEqual(raw.prepare("SELECT seq,data,payload FROM events ORDER BY seq").all(), before);
      assert.equal(raw.prepare("SELECT value FROM retention_metadata WHERE id='native_candidate_identity_schema'").get(), undefined);
    } finally { raw.close(); }
  } finally { store?.close(); await rm(directory, { recursive: true, force: true }); }
});
