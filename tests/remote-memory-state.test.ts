import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EventStore } from "../apps/service/src/store.ts";
import { RepositoryMemory } from "../apps/service/src/memory.ts";
import { MemoryBindingSchema, MemoryIndexSchema, PROTOCOL_VERSION, parse, projectEvents, type CapabilityJob } from "../packages/protocol/src/index.ts";

const root = { profileId: "default", projectId: "generated-project", root: "/generated/source", device: "1", inode: "2" };
const remote = { peerDigest: "a".repeat(64), host: "generated.invalid", port: 2222, user: "generated", hostFingerprint: "SHA256:generated", workerDigest: "b".repeat(64) };
test("memory bindings distinguish exact Local/worktree identity from a Remote peer and never infer the missing environment", () => {
  const local = parse(MemoryBindingSchema, { ...root, env: "Local", workspaceId: null });
  const ssh = parse(MemoryBindingSchema, { ...root, env: "Remote", workspaceId: null, remote });
  assert.equal(local.env, "Local"); assert.equal(ssh.env, "Remote");
  assert.throws(() => parse(MemoryBindingSchema, { ...root, workspaceId: null }), { code: "invalid_request" });
  assert.throws(() => parse(MemoryBindingSchema, { ...local, remote }), { code: "invalid_request" });
  assert.throws(() => parse(MemoryBindingSchema, { ...root, env: "Remote", workspaceId: null }), { code: "invalid_request" });
  assert.throws(() => parse(MemoryBindingSchema, { ...ssh, workspaceId: "generated-local-worktree" }), { code: "invalid_request" });
  assert.throws(() => parse(MemoryBindingSchema, { ...ssh, inode: 2 }), { code: "invalid_request" });
  const index = { version: 1, binding: ssh, sourceDigest: "c".repeat(64), indexedFiles: 1, excludedFiles: 0, sourceBytes: 10, indexedAt: "2026-01-01T00:00:00Z" };
  assert.equal(parse(MemoryIndexSchema, index).binding.env, "Remote");
  assert.throws(() => parse(MemoryIndexSchema, { ...index, sourceBytes: 64 * 1024 * 1024 + 1 }), { code: "invalid_request" });
});

test("memory job projection retains one immutable original command and cannot move it to another root or job", () => {
  const store = new EventStore(":memory:");
  try {
    const target = { profileId: "default", projectId: root.projectId, root: root.root, env: "Remote" as const, workspaceId: null, remote };
    const job: CapabilityJob = { id: "generated-index", projectId: target.projectId, sessionId: "generated-session", workspaceId: null, parentTurnId: null,
      kind: "memory.index", status: "running", progress: "Starting", resultDigest: null, error: null,
      memory: { commandId: "generated-original", commandDigest: "c".repeat(64), authorityDigest: "d".repeat(64), target } };
    store.commit([{ event_type: "job.started", profile_id: "default", project_id: job.projectId, session_id: job.sessionId, payload: { job } }]);
    const history = store.events(), event = history.at(-1)!;
    for (const altered of [
      { ...job, id: "generated-second-job" },
      { ...job, memory: { ...job.memory!, target: { ...target, root: "/generated/other-root" } } },
      { ...job, memory: { ...job.memory!, commandDigest: "f".repeat(64) } },
    ]) assert.throws(() => projectEvents([...history, { ...event, event_type: "job.started", seq: event.seq + 1, id: randomUUID(), payload: { job: altered } }]), { code: "memory_corrupt" });
  } finally { store.close(); }
});

test("schema-27 scope migration rolls back exactly and preserves schema-26 ciphertext, original receipts and usable Local vectors", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-memory-migration-"))), project = join(directory, "project"), path = join(directory, "state.sqlite"), key = randomBytes(32);
  await mkdir(project); await writeFile(join(project, "fixture.ts"), "export function generatedMemoryMigration() { return 'generated'; }\n");
  let store: EventStore | undefined = new EventStore(path, key);
  try {
    store.commit([{ event_type: "job.progress", profile_id: "default", payload: { jobId: "generated-memory-original", progress: "Generated retained migration source." } }],
      { id: randomUUID(), digest: "d".repeat(64), result: { id: "generated-memory-original", revision: 1 } });
    const memory = new RepositoryMemory(store);
    await memory.index({ id: "generated-old-index", path: project }, 10, AbortSignal.timeout(5000), () => {});
    const before = {
      events: store.db.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(),
      keys: store.db.prepare("SELECT scope,payload FROM retention_keys ORDER BY scope").all(),
      receipts: store.db.prepare("SELECT profile_id,id,digest,result FROM receipts ORDER BY profile_id,id").all(),
      files: store.db.prepare("SELECT project_id,path,digest,mtime,size FROM memory_files ORDER BY project_id,path").all(),
      chunks: store.db.prepare("SELECT id,project_id,path,digest,text FROM memory_chunks ORDER BY id").all(),
    };
    store.db.exec(`BEGIN IMMEDIATE; DROP TABLE memory_scopes; DELETE FROM retention_metadata WHERE id IN ('remote_memory_schema','candidate_workflow_schema','candidate_execution_schema','budget_planning_schema','candidate_generation_schema','role_sequence_schema','candidate_role_schema','model_evidence_schema','owned_role_contract_schema','paste_file_schema','native_execution_schema','compound_workflow_schema','budget_winddown_schema','owned_decision_schema','task_progress_schema','document_attachment_schema','desktop_interaction_schema'); PRAGMA user_version=26;
      CREATE TRIGGER generated_remote_memory_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='remote_memory_schema'
      BEGIN SELECT RAISE(ABORT,'Generated scoped memory migration failure'); END; COMMIT;`);
    store.close(); store = undefined;
    assert.throws(() => new EventStore(path, key), /Generated scoped memory migration failure/);
    const raw = new DatabaseSync(path);
    try {
      assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, 26);
      assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE name='memory_scopes'").get(), undefined);
      assert.deepEqual(raw.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), before.events);
      assert.deepEqual(raw.prepare("SELECT scope,payload FROM retention_keys ORDER BY scope").all(), before.keys);
      raw.exec("DROP TRIGGER generated_remote_memory_marker");
    } finally { raw.close(); }
    store = new EventStore(path, key); assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.equal(store.db.prepare("SELECT count(*) AS count FROM memory_scopes").get()?.count, 0);
    assert.deepEqual(store.db.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), before.events);
    assert.deepEqual(store.db.prepare("SELECT scope,payload FROM retention_keys ORDER BY scope").all(), before.keys);
    assert.deepEqual(store.db.prepare("SELECT profile_id,id,digest,result FROM receipts ORDER BY profile_id,id").all(), before.receipts);
    assert.deepEqual(store.db.prepare("SELECT project_id,path,digest,mtime,size FROM memory_files ORDER BY project_id,path").all(), before.files);
    assert.deepEqual(store.db.prepare("SELECT id,project_id,path,digest,text FROM memory_chunks ORDER BY id").all(), before.chunks);
    const hits = await new RepositoryMemory(store).search({ id: "generated-old-index", path: project }, "generatedMemoryMigration", 6);
    assert.equal(hits.length, 1); assert.equal(hits[0]!.stale, false); assert.match(hits[0]!.text, /generatedMemoryMigration/);
  } finally { store?.close(); await rm(directory, { recursive: true, force: true }); }
});
