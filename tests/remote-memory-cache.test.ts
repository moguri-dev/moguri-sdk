import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../apps/service/src/store.ts";
import { RepositoryMemory, memoryIndexId, memoryLocator } from "../apps/service/src/memory.ts";
import { repositorySourceDigest, type SourceRecord } from "../apps/service/src/repository-source.ts";
import type { MemoryBinding, MemoryIndex } from "../packages/protocol/src/index.ts";

const binding = (profileId = "default"): MemoryBinding => ({
  profileId, projectId: "generated-project", workspaceId: null, env: "Remote", root: "/generated/nonexistent-ssh-root", device: "1", inode: "2",
  remote: { host: "generated.invalid", port: 2222, user: "generated", hostFingerprint: "SHA256:generated", peerDigest: "a".repeat(64), workerDigest: "b".repeat(64) },
});
function snapshot(scope = binding(), text = "export function generatedRemoteMemory() { return 'generated'; }\n") {
  const record: SourceRecord = { path: "fixture.ts", text, size: Buffer.byteLength(text), mtime: 1, digest: createHash("sha256").update(text).digest("hex") };
  const index: MemoryIndex = { version: 1, binding: scope, sourceDigest: repositorySourceDigest([record]), indexedFiles: 1, excludedFiles: 0, sourceBytes: record.size, indexedAt: "2026-01-01T00:00:00Z" };
  return { record, index };
}
const stored = (store: EventStore) => ({
  scopes: store.db.prepare("SELECT locator,scope_id,profile_id,project_id,workspace_id,metadata FROM memory_scopes ORDER BY locator").all(),
  files: store.db.prepare("SELECT project_id,path,digest,mtime,size FROM memory_files ORDER BY project_id,path").all(),
  chunks: store.db.prepare("SELECT id,project_id,path,digest,text FROM memory_chunks ORDER BY id").all(),
  nodes: store.db.prepare("SELECT project_id,id,path,label,kind FROM memory_graph_nodes ORDER BY project_id,id").all(),
});

test("a captured SSH index publishes typed vectors/graph metadata without statting the Remote root as Local", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-memory-cache-")), key = randomBytes(32), path = join(directory, "state.sqlite");
  let store: EventStore | undefined = new EventStore(path, key);
  try {
    const memory = new RepositoryMemory(store), source = snapshot();
    source.index.jobId = "generated-index-job";
    memory.publish(source.index, [source.record], () => {});
    const cached = memory.cached(source.index.binding)!;
    assert.deepEqual(cached.index, source.index); assert.equal(cached.scope.id, memoryIndexId(source.index.binding));
    assert.equal(memory.graph(cached.scope, "").nodes.some((node) => node.label === "generatedRemoteMemory"), true);
    assert.equal(memory.candidates(cached.scope, "generatedRemoteMemory", 6)[0]?.text, source.record.text);
    assert.deepEqual(memory.versions(cached.scope, ["fixture.ts"]), [{ path: "fixture.ts", digest: source.record.digest, mtime: source.record.mtime, size: source.record.size }]);
    assert.equal(memory.published("generated-index-job"), true); assert.equal(memory.published("generated-not-published"), false);
    store.close(); store = new EventStore(path, key);
    assert.deepEqual(new RepositoryMemory(store).cached(source.index.binding), cached);
    const other = binding(); if (other.env !== "Remote") throw new Error("Generated Remote fixture is not Remote.");
    other.remote = { ...other.remote, peerDigest: "c".repeat(64), host: "other.generated.invalid" };
    assert.equal(new RepositoryMemory(store).cached(other), null);
  } finally { store?.close(); await rm(directory, { recursive: true, force: true }); }
});

test("failed metadata publication or a last-moment authority change leaves the previous exact snapshot intact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-memory-cache-rollback-")), store = new EventStore(join(directory, "state.sqlite"), randomBytes(32));
  try {
    const memory = new RepositoryMemory(store), first = snapshot(); memory.publish(first.index, [first.record], () => {});
    const before = stored(store), replacement = snapshot({ ...binding(), inode: "3" }, "export const generatedReplacement = true;\n");
    store.db.exec(`CREATE TRIGGER generated_memory_publication BEFORE INSERT ON memory_scopes
      BEGIN SELECT RAISE(ABORT,'Generated cache publication failure'); END;`);
    assert.throws(() => memory.publish(replacement.index, [replacement.record], () => {}), /Generated cache publication failure/);
    assert.deepEqual(stored(store), before); assert.deepEqual(memory.cached(first.index.binding)!.index, first.index);
    store.db.exec("DROP TRIGGER generated_memory_publication");
    let checks = 0;
    assert.throws(() => memory.publish(replacement.index, [replacement.record], () => { if (++checks === 2) throw new Error("Generated authority revoked before commit"); }), /Generated authority revoked/);
    assert.equal(checks, 2); assert.deepEqual(stored(store), before);
    memory.publish(replacement.index, [replacement.record], () => {});
    assert.equal(memory.cached(replacement.index.binding)!.index.binding.inode, "3");
    assert.equal(store.db.prepare("SELECT count(*) AS count FROM memory_files WHERE project_id=?").get(memoryIndexId(first.index.binding))?.count, 0);
    assert.equal(store.db.prepare("SELECT count(*) AS count FROM memory_scopes").get()?.count, 1);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

test("malformed/private-profile source data cannot publish and project retention clears only its owner's Remote caches", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-memory-cache-profiles-")), path = join(directory, "state.sqlite"), key = randomBytes(32);
  const store = new EventStore(path, key, "generated-memory-key"), beta = new EventStore(path, key, "generated-memory-key", "generated-beta");
  try {
    const memory = new RepositoryMemory(store), other = new RepositoryMemory(beta), source = snapshot(), foreign = snapshot(binding("generated-beta"));
    memory.publish(source.index, [source.record], () => {}); other.publish(foreign.index, [foreign.record], () => {});
    const before = stored(store);
    assert.throws(() => memory.publish(foreign.index, [foreign.record], () => {}), { code: "memory_input" });
    assert.throws(() => memory.publish(source.index, [{ ...source.record, digest: "f".repeat(64) }], () => {}), { code: "memory_protocol" });
    assert.throws(() => memory.publish(source.index, [{ ...source.record, path: ".env" }], () => {}), { code: "memory_protocol" });
    assert.deepEqual(stored(store), before);
    store.commit([], undefined, { projects: [source.index.binding.projectId] });
    assert.equal(memory.cached(source.index.binding), null); assert.deepEqual(other.cached(foreign.index.binding)!.index, foreign.index);
    assert.equal(store.db.prepare("SELECT count(*) AS count FROM memory_files WHERE project_id=?").get(memoryIndexId(source.index.binding))?.count, 0);
    assert.equal(beta.db.prepare("SELECT count(*) AS count FROM memory_files WHERE project_id=?").get(memoryIndexId(foreign.index.binding))?.count, 1);
    beta.db.prepare("UPDATE memory_scopes SET metadata=? WHERE locator=?").run("{", memoryLocator(foreign.index.binding));
    assert.throws(() => other.cached(foreign.index.binding), { code: "memory_corrupt" });
  } finally { beta.close(); store.close(); await rm(directory, { recursive: true, force: true }); }
});
