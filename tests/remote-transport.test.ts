import { ciTime } from "./fixtures/time-scale.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RemoteRuntime } from "../apps/service/src/remote.ts";
import { frameDigest } from "../apps/service/src/worker-wire.ts";
import { WorkerRequestSchema } from "../apps/service/src/worker-protocol.ts";
import { defaultSettings, parse, type RemoteExecution } from "../packages/protocol/src/index.ts";
import { effectiveTools } from "../apps/service/src/tools.ts";
import { fixtureProvider } from "./fixture.ts";
import { createSshTarget } from "./fixtures/ssh-target.ts";

const native = { skip: process.platform !== "darwin", timeout: ciTime(25_000) };
test("real pinned SSH runs the existing worker, inference and exact file tools without a second loop", native, async () => {
  const temporary = await mkdtemp(join(tmpdir(), "moguri-remote-worker-")), root = await realpath(temporary), ssh = await createSshTarget(root);
  const provider = await fixtureProvider({ exposeModels: true }), state = join(root, "local-state"), workspace = join(root, "approved-workspace");
  await mkdir(state, { mode: 0o700 }); await mkdir(workspace); await writeFile(join(workspace, "fixture.txt"), "generated remote original\n");
  const secrets = new Map<string, string>();
  const runtime = new RemoteRuntime(state, () => ssh.target, resolve("apps/service/src/worker.ts"), { vault: {
    read: async (id) => secrets.get(id) ?? null,
    write: async (id, token, signal) => { signal?.throwIfAborted(); secrets.set(id, token); },
    remove: async (id) => { secrets.delete(id); },
  } });
  let chain = Promise.resolve(), outcome = "", workerPid: number | null = null, failure: unknown;
  try {
    const ready = await runtime.probe(); assert.equal(ready.ready, true); assert.equal(ready.platform, "darwin");
    const execution: RemoteExecution = { id: randomUUID(), sessionId: randomUUID(), turnId: randomUUID(), projectId: null, target: ssh.target, workspace, workerDigest: ready.workerDigest!, configDigest: frameDigest(ssh.target), createdAt: new Date().toISOString(), status: "launching", cancellation: "none", cleanup: "pending", diagnostic: null, lastSequence: 0, workerPid: null };
    const worker = runtime.launch(execution, (status) => { workerPid = status.workerPid; });
    const exited = new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => { worker.kill("SIGTERM"); reject(new Error("Generated owned SSH worker did not close after its terminal exchange.")); }, 18_000);
      worker.events.once("exit", () => { clearTimeout(deadline); resolve(); }); worker.events.on("error", (error) => { failure = error; });
    });
    worker.events.on("message", (raw, frame) => {
      chain = chain.then(async () => {
        const request = parse(WorkerRequestSchema, raw);
        if ("requestId" in request) {
          if (request.kind === "boundary") {
            const prepared = await provider.provider.prepare(provider.modelId, AbortSignal.timeout(5000));
            worker.send({ kind: "reply", requestId: request.requestId, value: { ...prepared, steers: [], systemPrompt: "Generated remote transport fixture.", tools: effectiveTools(defaultSettings(), false), mode: "agent", folders: { denied: [], readOnly: [] }, maxTokens: 256 } });
          } else if (request.kind === "approval") worker.send({ kind: "reply", requestId: request.requestId, value: { allow: true, mode: "agent", folders: { denied: [], readOnly: [] } } });
          else { if (request.kind === "finished") outcome = request.outcome; worker.send({ kind: "reply", requestId: request.requestId, value: { accepted: true } }); }
        }
        if (frame) { execution.lastSequence = frame.sequence; worker.acknowledge?.(frame.sequence); }
      }).catch((error: unknown) => { failure = error; worker.kill("SIGTERM"); });
    });
    worker.send({ kind: "start", root: workspace, context: [{ role: "user", content: "generated write", timestamp: Date.now() }], readOnly: false });
    await exited; await chain;
    if (failure) throw failure;
    assert.equal(outcome, "completed");
    assert.ok(workerPid && workerPid !== process.pid);
    assert.equal(provider.requests.length, 3);
    assert.equal(await readFile(join(workspace, "fixture.txt"), "utf8"), "generated replacement\n");
    const inspection = await runtime.inspect(execution);
    assert.equal(inspection.status.status, "completed");
    assert.equal(inspection.status.cleanup, "owned-worker-stopped");
    assert.equal(inspection.status.workerPid, workerPid);
    assert.equal(inspection.frames.length, 0);
    const catalog = await runtime.catalog(provider.baseUrl, null, AbortSignal.timeout(5000));
    assert.equal(catalog.status, 200);
    assert.deepEqual(await catalog.json(), { data: [{ id: provider.modelId }] });
  } finally { await runtime.close(); await ssh.close(); await provider.close(); await rm(temporary, { recursive: true, force: true }); }
});

test("changed SSH host identity blocks before worker/model admission and never falls back locally", native, async () => {
  const temporary = await mkdtemp(join(tmpdir(), "moguri-remote-pin-")), root = await realpath(temporary), ssh = await createSshTarget(root);
  const state = join(root, "state"); await mkdir(state, { mode: 0o700 });
  const target = { ...ssh.target, hostKey: ssh.incorrectHostKey };
  const runtime = new RemoteRuntime(state, () => target, resolve("apps/service/src/worker.ts"));
  try { await assert.rejects(() => runtime.probe(), /host.key verification/i); assert.equal(runtime.readiness.ready, false); }
  finally { await runtime.close(); await ssh.close(); await rm(temporary, { recursive: true, force: true }); }
});
