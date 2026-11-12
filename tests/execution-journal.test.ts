import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { ExecutionJournal, inspectExecutionJournal, inspectExecutionJournalSource, journaledForegroundSink } from "../apps/service/src/execution-journal.ts";
import { frameDigest } from "../apps/service/src/worker-wire.ts";
import { PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import type { BridgeInfo } from "../apps/service/src/remote-protocol.ts";

test("owned execution journals retain authenticated encrypted frames before delivery and advance only exact durable cursors", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-journal-"))), key = randomBytes(32), runId = randomUUID();
  const info: BridgeInfo = { protocol: PROTOCOL_VERSION, workerDigest: "a".repeat(64), nodeVersion: "26.12.0", platform: "linux", root: "/workspace" };
  const status = { runId, workerPid: 123, port: 0, acknowledged: 0, sequence: 0, status: "running" as const, cancellation: "none" as const, cleanup: "pending" as const, diagnostic: null };
  try {
    const journal = await ExecutionJournal.create(root, key, info, status);
    const request = { kind: "delta" as const, stepId: "generated-step", text: "Generated private journal text." };
    const first = await journal.append(request);
    assert.equal(first.sequence, 1);
    assert.equal((await readFile(join(root, "000000000001.bin"))).includes(Buffer.from(request.text)), false);
    const recovered = await inspectExecutionJournal(root, key, 0);
    assert.deepEqual(recovered.frames, [first]);
    assert.equal(recovered.status.sequence, 1);
    await assert.rejects(() => inspectExecutionJournal(root, randomBytes(32), 0), /identity|key|proof|auth/i);
    await assert.rejects(() => journal.acknowledge(2), /cursor/i);
    await journal.acknowledge(1);
    assert.deepEqual((await inspectExecutionJournal(root, key, 1)).frames, []);
    await assert.rejects(() => journal.acknowledge(0), /cursor/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("foreground delivery waits for the exact encrypted frame and acknowledges only after the controller cursor", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-journal-delivery-"))), key = randomBytes(32), runId = randomUUID();
  const info: BridgeInfo = { protocol: PROTOCOL_VERSION, workerDigest: "a".repeat(64), nodeVersion: "26.12.0", platform: "linux", root: "/workspace" };
  const status = { runId, workerPid: 123, port: 0, acknowledged: 0, sequence: 0, status: "running" as const, cancellation: "none" as const, cleanup: "pending" as const, diagnostic: null };
  let delivered = 0, failure: Error | undefined;
  try {
    const journal = await ExecutionJournal.create(root, key, info, status);
    const sink = journaledForegroundSink({
      send(value, callback) {
        void inspectExecutionJournal(root, key, 0).then((saved) => {
          assert.deepEqual(saved.frames[0], value); delivered++; callback?.(null);
        }).catch((error: Error) => { failure = error; callback?.(error); });
      }, end() {},
    }, journal, (error) => { failure = error; });
    const request = { kind: "delta" as const, stepId: "generated-delivery", text: "Generated persisted before delivery." };
    sink.send({ kind: "frame", sequence: 1, digest: frameDigest(request), request });
    await sink.acknowledge(1);
    if (failure) throw failure;
    assert.equal(delivered, 1);
    assert.equal((await inspectExecutionJournal(root, key, 1)).status.acknowledged, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("original snapshot journal bytes survive live-root replacement without adopting its new run or accepting missing, oversized or forged evidence", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-journal-snapshot-"))), key = randomBytes(32), runId = randomUUID();
  const directory = join(root, "journal"), info: BridgeInfo = {
    protocol: PROTOCOL_VERSION, workerDigest: "a".repeat(64), nodeVersion: "26.12.0", platform: "linux", root: "/workspace",
  };
  const status = { runId, workerPid: 123, port: 0, acknowledged: 0, sequence: 0,
    status: "running" as const, cancellation: "none" as const, cleanup: "pending" as const, diagnostic: null };
  try {
    const journal = await ExecutionJournal.create(directory, key, info, status);
    const frame = await journal.append({ kind: "finished", requestId: "generated-terminal", outcome: "partial", diagnostic: "Generated lost original ACK." });
    await journal.update({ status: "partial", cleanup: "owned-worker-stopped" });
    const files = new Map(await Promise.all((await readdir(directory)).map(async (name) => [name, await readFile(join(directory, name))] as const)));
    await rename(directory, join(root, "retained-original"));
    await ExecutionJournal.create(directory, randomBytes(32), info, { ...status, runId: randomUUID() });
    const read = async (name: string) => {
      const value = files.get(name); assert.ok(value, "Original snapshot file is missing."); return value;
    };
    const names = async () => [...files.keys()];
    const original = await inspectExecutionJournalSource(key, 0, names, read);
    assert.equal(original.status.runId, runId); assert.equal(original.status.cleanup, "owned-worker-stopped");
    assert.deepEqual(original.frames, [frame]);
    await assert.rejects(() => inspectExecutionJournal(directory, key, 0), /proof|key|identity/i);
    await assert.rejects(() => inspectExecutionJournalSource(key, 0, async () => ["status.json"], read), /missing|frame/i);
    await assert.rejects(() => inspectExecutionJournalSource(randomBytes(32), 0, names, read), /proof|key|identity/i);
    await assert.rejects(() => inspectExecutionJournalSource(key, 0, names, async () => Buffer.alloc(65537)), /bound/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const mutation of ["frame", "status", "gap"] as const) test(`owned journal rejects ${mutation} corruption without replay or a success-shaped fallback`, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-journal-corrupt-"))), key = randomBytes(32), runId = randomUUID();
  const info: BridgeInfo = { protocol: PROTOCOL_VERSION, workerDigest: "a".repeat(64), nodeVersion: "26.12.0", platform: "linux", root: "/workspace" };
  try {
    const journal = await ExecutionJournal.create(root, key, info, { runId, workerPid: null, port: 0, acknowledged: 0, sequence: 0, status: "launching", cancellation: "none", cleanup: "pending", diagnostic: null });
    await journal.append({ kind: "delta", stepId: "generated-corruption", text: "Generated exact retained content." });
    if (mutation === "gap") await unlink(join(root, "000000000001.bin"));
    else if (mutation === "frame") await writeFile(join(root, "000000000001.bin"), Buffer.alloc(32), { mode: 0o600 });
    else {
      const value: { proof: string } = JSON.parse(await readFile(join(root, "status.json"), "utf8"));
      value.proof = "0".repeat(64); await writeFile(join(root, "status.json"), JSON.stringify(value), { mode: 0o600 });
    }
    await assert.rejects(() => inspectExecutionJournal(root, key, 0));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("journal ownership is create-only and storage failure prevents subsequent appends or acknowledgements", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moguri-journal-failed-"))), key = randomBytes(32), runId = randomUUID();
  const info: BridgeInfo = { protocol: PROTOCOL_VERSION, workerDigest: "a".repeat(64), nodeVersion: "26.12.0", platform: "linux", root: "/workspace" };
  const status = { runId, workerPid: null, port: 0, acknowledged: 0, sequence: 0, status: "launching" as const, cancellation: "none" as const, cleanup: "pending" as const, diagnostic: null };
  try {
    const journal = await ExecutionJournal.create(root, key, info, status);
    await assert.rejects(() => ExecutionJournal.create(root, key, info, status), { code: "EEXIST" });
    await writeFile(join(root, "000000000001.bin"), "Generated filesystem collision.", { mode: 0o600 });
    const request = { kind: "delta" as const, stepId: "generated-failed-store", text: "Generated never-delivered content." };
    await assert.rejects(() => journal.append(request), { code: "EEXIST" });
    await assert.rejects(() => journal.append(request), { code: "EEXIST" });
    await assert.rejects(() => journal.acknowledge(0), { code: "EEXIST" });
    assert.equal(journal.status.sequence, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
