import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { SandboxRuntime } from "../apps/service/src/sandbox-runtime.ts";
import { captureNativeSource, materializeNativeStage } from "../apps/service/src/native-staging.ts";
import { frameDigest } from "../apps/service/src/worker-wire.ts";
import { WorkerRequestSchema } from "../apps/service/src/worker-protocol.ts";
import { parse, type HookBinding, type SandboxExecution } from "../packages/sdk/src/index.ts";
import { nativeConfiguration } from "./fixtures/native-target.ts";
import { GeneratedFileVault } from "./fixtures/generated-vault.ts";
import { ciTime } from "./fixtures/time-scale.ts";

const configuration = await nativeConfiguration();
test("qualified SendBox contains double-forked setsid descendants after reparenting and verifies the exact VM absent on stop", { skip: !configuration, timeout: ciTime(90_000) }, async () => {
  assert.ok(configuration);
  await mkdir(".native/qualification", { recursive: true, mode: 0o700 });
  const root = await realpath(await mkdtemp(".native/qualification/descendant-containment-")), state = join(root, "state"), sourceRoot = join(root, "source");
  for (const path of [state, sourceRoot]) await mkdir(path, { mode: 0o700 });
  const runtime = new SandboxRuntime(state, () => configuration, { vault: new GeneratedFileVault(join(root, "generated-vault.json")) });
  const started = performance.now(), id = randomUUID(), nonce = randomUUID(), signal = AbortSignal.timeout(60_000);
  let passed = false, failure: unknown, observed = false, acknowledged = false, boundaries = 0;
  try {
    await runtime.probe("generated-containment");
    const source = await captureNativeSource(sourceRoot, [], { denied: [], readOnly: [] }, signal);
    const stage = await materializeNativeStage(state, { profileId: "generated-containment", sessionId: randomUUID(), turnId: randomUUID() }, source, signal);
    let execution: SandboxExecution = {
      id, profileId: stage.profileId, sessionId: stage.sessionId, projectId: "generated-containment-project", turnId: stage.turnId,
      workspaceId: stage.turnId, sourceWorkspaceId: null, stage, sourceRoot, inputDigest: source.digest,
      config: configuration, configDigest: frameDigest(configuration), image: configuration.image!,
      workerDigest: configuration.qualification!.workerDigest, launchName: `mg-${id.replaceAll("-", "").slice(0, 20)}`,
      command: runtime.workerArgv(), createdAt: new Date().toISOString(), root: "/workspace",
      createdAfter: Math.floor(Date.now() / 1000) - 2, createdBefore: Math.ceil(Date.now() / 1000) + 120,
      nativeSessionId: null, planDigest: null, signerFingerprint: null, status: "launching", cancellation: "none", cleanup: "pending",
      diagnostic: null, lastSequence: 0, workerPid: null, cliExitCode: null, resultDigest: null, revision: 0,
    };
    const leaf = `const fs=require("node:fs");let count=0;const originalParent=Number(process.argv[1]);const file="/workspace/generated-descendant.json";const timer=setInterval(()=>{const fields=fs.readFileSync("/proc/self/stat","utf8").split(") ")[1].trim().split(" ");fs.writeFileSync(file+".tmp",JSON.stringify({nonce:${JSON.stringify(nonce)},pid:process.pid,parent:process.ppid,originalParent,group:Number(fields[2]),session:Number(fields[3])}));fs.renameSync(file+".tmp",file);if(++count>=3000){clearInterval(timer);process.exit(0)}},10);`;
    const middle = `const child=require("node:child_process").spawn(process.execPath,["-e",${JSON.stringify(leaf)},String(process.pid)],{detached:true,stdio:"ignore",cwd:"/workspace"});child.unref();`;
    const launcher = `const child=require("node:child_process").spawn(process.execPath,["-e",${JSON.stringify(middle)}],{detached:true,stdio:"ignore",cwd:"/workspace"});child.unref();console.log("Generated double-fork started");`;
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const hook: HookBinding = { id: randomUUID(), revision: 0, contentDigest: "a".repeat(64), definition: {
      schemaVersion: 1, name: "generated-detached-descendant", description: "Generated VM containment fixture", trigger: "turn.start",
      command: `/usr/local/bin/node -e ${quote(launcher)}`, timeoutMs: 5000,
    } };
    const worker = runtime.launch(execution, async (changes) => { execution = { ...execution, ...changes, revision: execution.revision + 1 }; });
    let chain = Promise.resolve();
    worker.events.on("error", (error) => { failure = error; });
    worker.events.on("message", (raw, frame) => {
      chain = chain.then(async () => {
        const request = parse(WorkerRequestSchema, raw);
        assert.ok(frame);
        execution.lastSequence = frame.sequence;
        if (request.kind === "hook") {
          assert.equal(request.call.hook?.id, hook.id);
          assert.deepEqual(request.call.arguments, { command: hook.definition.command, timeoutMs: hook.definition.timeoutMs });
          worker.send({ kind: "reply", requestId: request.requestId, value: { allow: true, mode: "agent", folders: { denied: [], readOnly: [] } } });
        } else if (request.kind === "tool.complete") {
          assert.equal(request.outcome, "completed");
          worker.send({ kind: "reply", requestId: request.requestId, value: { accepted: true } });
        } else if (request.kind === "boundary") {
          boundaries++;
          const deadline = Date.now() + ciTime(5000);
          while (!observed && Date.now() < deadline) {
            signal.throwIfAborted();
            try {
              const value: unknown = JSON.parse(await readFile(join(stage.workspace, "generated-descendant.json"), "utf8"));
              if (value && typeof value === "object" && "nonce" in value && "pid" in value && "parent" in value && "originalParent" in value && "group" in value && "session" in value) {
                observed = value.nonce === nonce && Number.isSafeInteger(value.parent) && Number.isSafeInteger(value.originalParent) &&
                  Number(value.parent) > 0 && Number(value.originalParent) > 1 && value.parent !== value.originalParent &&
                  Number.isSafeInteger(value.pid) && value.pid === value.group && value.pid === value.session;
              }
            } catch (error) {
              if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
            }
            if (!observed) await new Promise((resolve) => setTimeout(resolve, 20));
          }
          assert.equal(observed, true, "The real leaf must be alive, setsid-detached and reparented away from its exact original middle process before cancellation.");
          worker.send({ kind: "stop" });
        } else if (request.kind === "ack") acknowledged = true;
        else if (request.kind === "finished") {
          assert.equal(request.outcome, "stopped");
          worker.send({ kind: "reply", requestId: request.requestId, value: { accepted: true } });
        } else assert.ok(request.kind === "output" || request.kind === "process", "No unrelated model or delegated operation may run.");
        worker.acknowledge(frame.sequence);
      }).catch((error) => { failure = error; worker.kill("SIGTERM"); });
    });
    await worker.verified;
    worker.send({ kind: "start", root: "/workspace", context: [], readOnly: false, env: "Sandbox", hooks: [hook] });
    const ended = await worker.finished;
    await chain;
    if (failure) throw failure;
    assert.equal(boundaries, 1); assert.equal(observed, true); assert.equal(acknowledged, true);
    assert.equal(ended.clean, true, "The adapter must verify the exact owned VM absent, not infer cleanup from a shell/PID exit.");
    assert.equal(ended.failure, null);
    console.log(JSON.stringify({ primitive: "actual double-fork/setsid/reparented descendant VM containment", status: "PASS", elapsedMs: performance.now() - started, inferenceCalls: 0, boundary: "verified-owned-VM-absence" }));
    passed = true;
  } finally {
    await runtime.close();
    if (passed) await rm(root, { recursive: true, force: true });
    else console.error("Generated containment evidence retained:", root);
  }
});
