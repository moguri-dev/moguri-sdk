import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { digest } from "../apps/service/src/store.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";
import { reviewNativeTools, waitFor } from "./fixture.ts";

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
