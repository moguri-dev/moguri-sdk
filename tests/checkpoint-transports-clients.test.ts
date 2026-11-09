import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { digest } from "../apps/service/src/store.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";
import { reviewNativeTools, waitFor } from "./fixture.ts";

test("SDK cancellation reaches the actual service-owned SSH rewind review and releases only its original reader", { skip: process.platform !== "darwin", timeout: 30000 }, async (t) => {
  const f = await remoteFixture({ respond: () => ({ text: "Generated review cancellation source." }) }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.probe(); await f.select(); await f.send("Generated completed review target."); await f.terminal();
    const checkpoint = await waitFor(() => f.controller.snapshot().checkpoints.find((checkpoint) => checkpoint.terminal?.afterDigest));
    const read = f.controller.remote.readWorkspace.bind(f.controller.remote), started = Promise.withResolvers<void>();
    t.mock.method(f.controller.remote, "readWorkspace", async (...args: Parameters<typeof read>) => {
      const result = await read(...args);
      if (args[1].query.type === "checkpoint.capture") {
        started.resolve(); args[2].throwIfAborted();
        await new Promise<never>((_resolve, reject) => args[2].addEventListener("abort", () => reject(args[2].reason), { once: true }));
      }
      return result;
    });
    const abort = new AbortController(), budget = structuredClone(f.controller.snapshot().budgetEntries), calls = f.requests.length;
    const rejected = assert.rejects(() => sdk.checkpoints.preview(f.sessionId, checkpoint.id, "workspace", abort.signal), /Generated review cancellation|cancel/i);
    await started.promise; abort.abort(new Error("Generated review cancellation.")); await rejected;
    await waitFor(() => f.controller.snapshot().checkpointCaptures.find((capture) => capture.phase === "current" && capture.status === "failed"));
    assert.equal(f.controller.snapshot().rewinds.length, 0); assert.equal(f.controller.platform.checkpoints.capturing(f.sessionId), false);
    assert.deepEqual(f.controller.snapshot().budgetEntries, budget); assert.equal(f.requests.length, calls);
  } finally { sdk.disconnect(); await f.close(); }
});

test("an actual stopped pre-admission SSH capture can be pruned through the shared CLI/TUI grammar without admitting or replaying its prompt", { skip: process.platform !== "darwin", timeout: 30000 }, async (t) => {
  const f = await remoteFixture({ respond: () => ({ text: "Generated undispatched source." }) }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.probe(); await f.select();
    const read = f.controller.remote.readWorkspace.bind(f.controller.remote), started = Promise.withResolvers<void>();
    t.mock.method(f.controller.remote, "readWorkspace", async (...args: Parameters<typeof read>) => {
      const result = await read(...args);
      if (args[1].query.type === "checkpoint.capture") {
        started.resolve(); args[2].throwIfAborted();
        await new Promise<never>((_resolve, reject) => args[2].addEventListener("abort", () => reject(args[2].reason), { once: true }));
      }
      return result;
    });
    await f.send("Generated source cancelled before actual turn admission."); await started.promise;
    await sdk.command({ type: "session.stop", sessionId: f.sessionId });
    const capture = await waitFor(() => f.controller.snapshot().checkpointCaptures.find((capture) => capture.sessionId === f.sessionId &&
      ["failed", "partial"].includes(capture.status)));
    assert.equal(f.controller.snapshot().checkpoints.length, 0); assert.equal(f.requests.length, 0);
    assert.equal(f.controller.snapshot().budgetEntries.length, 0);
    const result = await sdk.slash(f.sessionId, `/rewind prune-capture ${capture.id} ${capture.revision} confirm-delete`, "cli");
    assert.equal(result.kind, "text");
    assert.equal(f.controller.snapshot().checkpointCaptures.find((entry) => entry.id === capture.id)?.forgotten, true);
    await assert.rejects(() => sdk.checkpoints.pruneCapture(f.sessionId, capture.id, capture.revision + 1), /already|pruned|changed/i);
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("shared Remote turns capture real pre-admission and post-worker boundaries and restore only the pinned peer", { skip: process.platform !== "darwin", timeout: 60000 }, async () => {
  const fixture = await remoteFixture({ toolCall: { name: "write_file", args: { path: "fixture.txt", text: "Generated owned Remote turn edit.", expectedDigest: digest("generated actual remote source\n") } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await reviewNativeTools(fixture, ["write_file"]); await fixture.probe(); await fixture.select();
    await fixture.send("Generated end-to-end Remote checkpointed write."); await fixture.approve(); await fixture.terminal();
    const checkpoint = await waitFor(() => fixture.controller.snapshot().checkpoints.find((checkpoint) => checkpoint.sessionId === fixture.sessionId &&
      checkpoint.beforeCaptureId && checkpoint.terminal?.afterDigest));
    const captured = await sdk.checkpoints.read(fixture.sessionId, checkpoint.id);
    assert.equal(captured.before?.boundary?.env, "Remote"); assert.equal(captured.after?.boundary?.env, "Remote");
    const source = fixture.controller.events(0);
    const before = source.find((event) => event.event_type === "checkpoint.capture_recorded" && event.payload.capture.id === checkpoint.beforeCaptureId && event.payload.capture.status === "captured")!;
    const admitted = source.find((event) => event.id === checkpoint.admissionEventId)!;
    assert.ok(before.seq < admitted.seq);
    await writeFile(join(fixture.workspace, "unrelated.txt"), "Generated unrelated peer file.");
    const { preview } = await sdk.checkpoints.preview(fixture.sessionId, checkpoint.id, "workspace");
    assert.deepEqual(preview.blockers, []); assert.equal(preview.files.length, 1);
    const calls = fixture.requests.length, budget = structuredClone(fixture.controller.snapshot().budgetEntries);
    const restored = await sdk.checkpoints.apply(fixture.sessionId, checkpoint.id, "workspace", preview.digest);
    assert.equal(await readFile(join(fixture.workspace, "fixture.txt"), "utf8"), "generated actual remote source\n");
    assert.equal(await readFile(join(fixture.workspace, "unrelated.txt"), "utf8"), "Generated unrelated peer file.");
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(fixture.requests.length, calls); assert.deepEqual(fixture.controller.snapshot().budgetEntries, budget);
    const inspected = await sdk.checkpoints.inspect(fixture.sessionId, restored.id!);
    assert.equal(inspected.operationSettled, true); assert.equal(inspected.record.remoteExecution?.cleanup, "owned-worker-stopped");
    assert.equal(inspected.effects[0]?.backupDigest, digest("Generated owned Remote turn edit."));
  } finally { sdk.disconnect(); await fixture.close(); }
});
