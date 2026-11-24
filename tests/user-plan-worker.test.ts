import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localWorker } from "../apps/service/src/worker-connection.ts";
import { parse } from "../packages/protocol/src/index.ts";
import { WorkerRequestSchema, type WorkerRequest } from "../apps/service/src/worker-protocol.ts";
import { UserPlanResultSchema } from "../apps/service/src/user-plan.ts";
import { waitFor } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

async function probe(options: { stopBeforeAuthorization?: boolean; stopAfterWrite?: boolean; readOnly?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-user-plan-worker-"));
  const worker = localWorker(fileURLToPath(new URL("../apps/service/src/worker.ts", import.meta.url)), "generated-user-plan-worker");
  const requests: WorkerRequest[] = [];
  let failure: unknown;
  const exited = new Promise<void>((resolve) => worker.events.once("exit", () => resolve()));
  worker.events.on("error", (error) => { failure = error; });
  worker.events.on("message", (raw) => {
    try {
      const request = parse(WorkerRequestSchema, raw); requests.push(request);
      if (request.kind === "boundary" || request.kind === "model.complete") throw new Error("Owned user plan work must not call a model.");
      if (request.kind === "approval") {
        assert.deepEqual(request.call, { id: "generated-user-plan-call", name: "write_file", arguments: { path: "docs/plan.md", text: "Generated actual user plan bytes.\n", expectedDigest: "absent" } });
        if (options.stopBeforeAuthorization) worker.send({ kind: "stop" });
        else worker.send({ kind: "reply", requestId: request.requestId, value: { allow: true, mode: options.readOnly ? "read-only" : "agent", folders: { denied: [], readOnly: [] } } });
      }
      if (request.kind === "user-plan.complete" && options.stopAfterWrite) worker.send({ kind: "stop" });
      if (request.kind === "user-plan.complete" || request.kind === "finished") worker.send({ kind: "reply", requestId: request.requestId, value: { accepted: true } });
    } catch (error) { failure = error; worker.kill("SIGTERM"); }
  });
  try {
    worker.send({ kind: "start", root: directory, context: [], readOnly: false, operation: { kind: "plan.save", stepId: "generated-user-plan-step", callId: "generated-user-plan-call",
      input: { path: "docs/plan.md", text: "Generated actual user plan bytes.\n", expectedDigest: "absent" } } });
    const terminal = await waitFor(() => {
      if (failure) throw failure;
      return requests.find((request) => request.kind === "finished");
    });
    await exited;
    if (failure) throw failure;
    return { directory, requests, terminal, close: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    if (worker.connected) { worker.kill("SIGTERM"); await exited; }
    await rm(directory, { recursive: true, force: true }); throw error;
  }
}

test("the actual owned worker handles one typed user plan operation without a provider, model request or context message", { timeout: ciTime(10_000) }, async () => {
  const f = await probe();
  try {
    assert.equal(f.terminal.kind === "finished" && f.terminal.outcome, "completed");
    const completion = f.requests.find((request) => request.kind === "user-plan.complete");
    assert.equal(completion?.kind, "user-plan.complete");
    if (completion?.kind !== "user-plan.complete") throw new Error("Actual owned file result is missing.");
    const result = parse(UserPlanResultSchema, completion.result);
    assert.equal(result.outcome, "completed"); assert.equal(result.fileOutcome, "written");
    assert.deepEqual(result.createdDirectories, ["docs"]);
    assert.equal(await readFile(join(f.directory, "docs/plan.md"), "utf8"), result.text);
    assert.equal(f.requests.filter((request) => request.kind === "approval").length, 1);
  } finally { await f.close(); }
});

test("actual owned user-plan cancellation before authorization creates no plan directory", { timeout: ciTime(10_000) }, async () => {
  const f = await probe({ stopBeforeAuthorization: true });
  try {
    assert.equal(f.terminal.kind === "finished" && f.terminal.outcome, "stopped");
    assert.ok(f.requests.some((request) => request.kind === "ack"));
    await assert.rejects(() => stat(join(f.directory, "docs")), { code: "ENOENT" });
  } finally { await f.close(); }
});

test("actual post-write stop is partial while a read-only authorization cannot produce an effect", { timeout: ciTime(10_000) }, async () => {
  const written = await probe({ stopAfterWrite: true });
  try {
    assert.equal(written.terminal.kind === "finished" && written.terminal.outcome, "partial");
    assert.equal(await readFile(join(written.directory, "docs/plan.md"), "utf8"), "Generated actual user plan bytes.\n");
  } finally { await written.close(); }
  const denied = await probe({ readOnly: true });
  try {
    assert.equal(denied.terminal.kind === "finished" && denied.terminal.outcome, "failed");
    await assert.rejects(() => stat(join(denied.directory, "docs")), { code: "ENOENT" });
  } finally { await denied.close(); }
});
