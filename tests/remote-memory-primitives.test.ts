import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { isRecord } from "../packages/protocol/src/core.ts";
import { captureRepositorySource, RepositorySourceCapture, SOURCE_BYTES, SOURCE_FRAME_BYTES, validateRepositorySource } from "../apps/service/src/repository-source.ts";
import { RemoteRuntime } from "../apps/service/src/remote.ts";
import { MAX_WORKER_FRAME } from "../apps/service/src/worker-wire.ts";
import { createSshTarget } from "./fixtures/ssh-target.ts";
import { waitFor } from "./fixture.ts";

test("source capture reuses safe ignores/denials and preserves exact UTF-8/BOM bytes without indexing symlinks or credentials", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-source-"))), root = join(directory, "root");
  await mkdir(root); await mkdir(join(root, "nested")); await mkdir(join(root, "denied"));
  try {
    await writeFile(join(root, "kept.ts"), "\ufeffexport const generated = '日本語 🦇';\n");
    await writeFile(join(root, ".env"), "GENERATED_PROTECTED_ONLY");
    await writeFile(join(root, ".gitignore"), "ignored.ts\n");
    await writeFile(join(root, "ignored.ts"), "GENERATED_IGNORED_ONLY");
    await writeFile(join(root, "nested/.gitignore"), "private.ts\n");
    await writeFile(join(root, "nested/private.ts"), "GENERATED_NESTED_ONLY");
    await writeFile(join(root, "denied/private.ts"), "GENERATED_DENIED_ONLY");
    await writeFile(join(directory, "local-only.ts"), "GENERATED_LOCAL_FALLBACK_FORBIDDEN");
    await symlink(join(directory, "local-only.ts"), join(root, "alias.ts"));
    await writeFile(join(root, "binary.dat"), Buffer.from([0, 1, 2]));
    const capture = new RepositorySourceCapture(root, 100, ["denied"]);
    await captureRepositorySource(root, 100, ["denied"], AbortSignal.timeout(5000), async (frame) => { capture.accept(frame); });
    const result = capture.complete(), text = JSON.stringify(result);
    assert.equal(result.binding.root, root); assert.match(result.binding.inode, /^\d+$/); assert.equal(result.records.find((record) => record.path === "kept.ts")!.text, "\ufeffexport const generated = '日本語 🦇';\n");
    for (const sentinel of ["GENERATED_PROTECTED_ONLY", "GENERATED_IGNORED_ONLY", "GENERATED_NESTED_ONLY", "GENERATED_DENIED_ONLY", "GENERATED_LOCAL_FALLBACK_FORBIDDEN"]) assert.equal(text.includes(sentinel), false);
    assert.ok(result.excluded >= 1);
    const files = result.records.map(({ text: _, ...metadata }) => metadata);
    const reorderedBinding = { inode: result.binding.inode, device: result.binding.device, root: result.binding.root };
    assert.ok((await validateRepositorySource({ binding: reorderedBinding, files, denied: ["denied"] }, AbortSignal.timeout(5000))).files.every((file) => !file.stale));
    await writeFile(join(root, ".gitignore"), "kept.ts\n");
    const changed = await validateRepositorySource({ binding: result.binding, files, denied: ["denied"] }, AbortSignal.timeout(5000));
    assert.equal(changed.files.find((file) => file.path === "kept.ts")!.stale, true);
    await assert.rejects(() => validateRepositorySource({ binding: result.binding, files: [{ ...files[0]!, path: "../outside.ts" }], denied: [] }, AbortSignal.timeout(5000)), { code: "memory_path" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("malformed, duplicate, protected, denied or changed-root source frames permanently reject their partial dataset", async () => {
  const binding = { root: "/generated/source", device: "1", inode: "2" }, text = "Generated source.";
  const record = { path: "allowed.ts", mtime: 1, size: Buffer.byteLength(text), text, digest: createHash("sha256").update(text).digest("hex") };
  for (const changed of [{ path: "../outside.ts" }, { path: ".env" }, { path: "denied/file.ts" }, { digest: "f".repeat(64) }, { size: 0 }, { text: "\ud800" }]) {
    const capture = new RepositorySourceCapture(binding.root, 10, ["denied"]);
    capture.accept({ kind: "source.begin", binding });
    assert.throws(() => capture.accept({ kind: "source.file", record: { ...record, ...changed } }), { code: "memory_protocol" });
    assert.throws(() => capture.accept({ kind: "source.file", record }), { code: "memory_protocol" });
    assert.throws(() => capture.complete(), { code: "memory_incomplete" });
  }
  const capture = new RepositorySourceCapture(binding.root, 1); capture.accept({ kind: "source.begin", binding }); capture.accept({ kind: "source.file", record });
  assert.throws(() => capture.accept({ kind: "source.file", record }), { code: "memory_protocol" });
  const wrong = new RepositorySourceCapture(binding.root, 1);
  assert.throws(() => wrong.accept({ kind: "source.begin", binding: { ...binding, root: "/generated/other" } }), { code: "memory_protocol" });
});

test("capture cancellation and a replaced directory never produce a completed cache, including an empty tree", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-source-loss-"))), root = join(directory, "root");
  await mkdir(root);
  try {
    const empty = new RepositorySourceCapture(root, 10);
    await captureRepositorySource(root, 10, [], AbortSignal.timeout(5000), async (frame) => { empty.accept(frame); });
    assert.equal(empty.complete().records.length, 0);
    await writeFile(join(root, "fixture.ts"), "Generated cancelled source.");
    const abort = new AbortController(), cancelled = new RepositorySourceCapture(root, 10);
    await assert.rejects(() => captureRepositorySource(root, 10, [], abort.signal, async (frame) => { cancelled.accept(frame); if (frame.kind === "source.file") abort.abort(new Error("Generated exact source stop")); }), /Generated exact source stop/);
    assert.throws(() => cancelled.complete(), { code: "memory_incomplete" });
    const replaced = new RepositorySourceCapture(root, 10);
    await assert.rejects(() => captureRepositorySource(root, 10, [], AbortSignal.timeout(5000), async (frame) => {
      replaced.accept(frame);
      if (frame.kind === "source.begin") {
        await rename(root, join(directory, "old-root")); await mkdir(root); await writeFile(join(root, "fixture.ts"), "Generated replacement.");
      }
    }), { code: "memory_root_changed" });
    assert.throws(() => replaced.complete(), { code: "memory_incomplete" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the source receiver accepts exactly 64 MiB and rejects the next byte, false completion counters or invalid admission", () => {
  const binding = { root: "/generated/bounded-source", device: "1", inode: "2" }, text = "x".repeat(128 * 1024), fileDigest = createHash("sha256").update(text).digest("hex");
  const capture = new RepositorySourceCapture(binding.root, 1000), overflow = new RepositorySourceCapture(binding.root, 1000);
  const hash = createHash("sha256").update("moguri-repository-source-v1\0");
  capture.accept({ kind: "source.begin", binding }); overflow.accept({ kind: "source.begin", binding });
  for (let index = 0; index < SOURCE_BYTES / Buffer.byteLength(text); index++) {
    const record = { path: `generated-${index}.txt`, mtime: 1, size: Buffer.byteLength(text), text, digest: fileDigest };
    capture.accept({ kind: "source.file", record }); overflow.accept({ kind: "source.file", record });
    hash.update(JSON.stringify([record.path, record.digest, record.mtime, record.size])).update("\n");
  }
  assert.equal(capture.accept({ kind: "source.done", binding, files: 512, excluded: 0, bytes: SOURCE_BYTES, digest: hash.digest("hex") }), true);
  assert.equal(capture.complete().sourceBytes, SOURCE_BYTES);
  assert.throws(() => overflow.accept({ kind: "source.file", record: { path: "one-more.txt", mtime: 1, size: 1, text: "x", digest: createHash("sha256").update("x").digest("hex") } }), { code: "memory_protocol" });
  for (const changed of [{ files: 1 }, { excluded: 2 }, { bytes: 1 }, { digest: "f".repeat(64) }, { binding: { ...binding, inode: "3" } }]) {
    const rejected = new RepositorySourceCapture(binding.root, 1); rejected.accept({ kind: "source.begin", binding });
    assert.throws(() => rejected.accept({ kind: "source.done", binding, files: 0, excluded: 0, bytes: 0, digest: createHash("sha256").update("moguri-repository-source-v1\0").digest("hex"), ...changed }), { code: "memory_protocol" });
    assert.throws(() => rejected.complete(), { code: "memory_incomplete" });
  }
  assert.throws(() => new RepositorySourceCapture(binding.root, 0), { code: "memory_input" });
  assert.throws(() => new RepositorySourceCapture("relative-root", 1), { code: "memory_input" });
});

test("actual pinned SSH streams more than one worker frame, and control loss never completes a partial source snapshot", { skip: process.platform !== "darwin", timeout: 35_000 }, async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-remote-memory-"))), sshRoot = join(directory, "ssh"), root = join(directory, "remote");
  await mkdir(sshRoot); await mkdir(root);
  const ssh = await createSshTarget(sshRoot), target = { ...ssh.target, command: [...ssh.target.command.slice(0, -1), resolve("tests/fixtures/remote-memory-probe.ts")] };
  const runtime = new RemoteRuntime(directory, () => target, resolve("dist/worker.mjs"));
  const begin = async (stop = false) => {
    const connection = await runtime.connect(target, AbortSignal.timeout(20_000), SOURCE_FRAME_BYTES), capture = new RepositorySourceCapture(root, 1000);
    let pid = 0, frames = 0, largest = 0;
    const result = new Promise<ReturnType<RepositorySourceCapture["complete"]>>((resolve, reject) => {
      connection.wire.on("error", reject); connection.child.once("close", () => { try { resolve(capture.complete()); } catch (error) { reject(error); } });
      connection.wire.on("message", (raw: unknown) => {
        try {
          if (isRecord(raw) && raw.kind === "probe" && typeof raw.pid === "number") { pid = raw.pid; return; }
          if (isRecord(raw) && raw.kind === "error") { reject(new Error(String(raw.code))); return; }
          frames++; largest = Math.max(largest, Buffer.byteLength(JSON.stringify(raw)) + 1);
          const done = capture.accept(raw);
          if (stop && isRecord(raw) && raw.kind === "source.file") connection.child.kill("SIGKILL");
          if (done) resolve(capture.complete());
        } catch (error) { reject(error); }
      });
      connection.wire.send({ root, maxFiles: 1000, denied: [] });
    });
    return { result, get pid() { return pid; }, get frames() { return frames; }, get largest() { return largest; },
      close: () => { connection.wire.end(); connection.child.kill("SIGTERM"); } };
  };
  try {
    const text = "Generated remote source padding.\n".repeat(3900);
    for (let index = 0; index < 280; index++) await writeFile(join(root, `generated-${String(index).padStart(4, "0")}.ts`), text);
    const start = performance.now(), complete = await begin();
    try {
      const result = await complete.result;
      assert.equal(result.records.length, 280); assert.ok(result.sourceBytes > MAX_WORKER_FRAME);
      assert.ok(complete.largest <= SOURCE_FRAME_BYTES); assert.equal(complete.frames, 282);
      const connection = await runtime.connect(target, AbortSignal.timeout(8000), SOURCE_FRAME_BYTES);
      try {
        const validation = new Promise<unknown>((resolve, reject) => {
          connection.wire.on("message", resolve); connection.wire.on("error", reject);
          connection.child.once("close", () => reject(new Error("Remote source validation ended before its exact response.")));
        });
        connection.wire.send({ binding: result.binding, files: result.records.slice(0, 2).map(({ text: _, ...metadata }) => metadata), denied: [result.records[0]!.path] });
        const observed = await validation;
        assert.ok(isRecord(observed) && observed.kind === "source.validation" && Array.isArray(observed.files));
        assert.deepEqual(observed.files, [{ path: result.records[0]!.path, stale: true }, { path: result.records[1]!.path, stale: false }]);
      } finally { connection.wire.end(); connection.child.kill("SIGTERM"); }
      console.log(JSON.stringify({ primitive: "remote-repository-source-stream", ms: performance.now() - start, files: result.records.length, sourceBytes: result.sourceBytes, largestFrame: complete.largest, frameLimit: SOURCE_FRAME_BYTES, modelCalls: 0 }));
    } finally { complete.close(); }
    const lost = await begin(true);
    try {
      await assert.rejects(() => lost.result, /completion|incomplete|ended|closed/i);
      assert.ok(lost.pid > 0);
      await waitFor(() => { try { process.kill(lost.pid, 0); return false; } catch (error) { return error instanceof Error && "code" in error && error.code === "ESRCH"; } }, 8000);
    } finally { lost.close(); }
  } finally { await runtime.close(); await ssh.close(); await rm(directory, { recursive: true, force: true }); }
});
