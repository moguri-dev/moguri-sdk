import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import * as pty from "node-pty";
import { SandboxRuntime, nativeControlLaunch, sandboxHostEnvironment, verifyNativeBootstrap } from "../apps/service/src/sandbox-runtime.ts";
import { captureNativeSource, materializeNativeStage, inspectNativeStage } from "../apps/service/src/native-staging.ts";
import { captureSandboxResult } from "../apps/service/src/sandbox-results.ts";
import { frameDigest } from "../apps/service/src/worker-wire.ts";
import { runProgram } from "../apps/service/src/program.ts";
import { isRecord, parse, PROTOCOL_VERSION, SandboxConfigurationSchema, type SandboxExecution } from "../packages/sdk/src/index.ts";
import { nativeConfiguration } from "./fixtures/native-target.ts";
import { GeneratedFileVault } from "./fixtures/generated-vault.ts";

const configuration = await nativeConfiguration();
const legacyConfiguration = configuration && process.env.MOGURI_NATIVE_LEGACY_CONFIGURATION ?
  parse(SandboxConfigurationSchema, JSON.parse(await readFile(process.env.MOGURI_NATIVE_LEGACY_CONFIGURATION, "utf8"))) : null;
test("the private native PTY never reflects parent control after child raw-mode restoration and preserves exact argv", {
  skip: process.platform !== "darwin", timeout: 10000,
}, async (t) => {
  const marker = "GENERATED_PARENT_CONTROL_FRAME", argument = "Generated exact argument; not shell code.";
  const script = `process.stdin.setRawMode(true);process.stdout.write(JSON.stringify(process.argv[1])+"\\n");
process.stdin.on("data",()=>{process.stdout.write("GENERATED_PEER_ACK\\n");process.exit(0)});
setImmediate(()=>{process.stdin.setRawMode(false);process.stdout.write("GENERATED_RESTORED\\n")});`;
  const launch = nativeControlLaunch(process.execPath, ["-e", script, argument]);
  const terminal = pty.spawn(launch.executable, launch.args, { cwd: process.cwd(),
    env: { PATH: "/usr/bin:/bin", HOME: process.cwd(), TERM: "xterm-256color" } });
  let output = "", sent = false, ended = false;
  t.after(() => { if (!ended) terminal.kill("SIGTERM"); });
  const data = terminal.onData((chunk) => {
    output += chunk;
    if (!sent && output.includes("GENERATED_RESTORED")) { sent = true; terminal.write(`${marker}\n`); }
  });
  const outcome = await new Promise<{ exitCode: number }>((resolve) => {
    const exit = terminal.onExit((value) => { ended = true; data.dispose(); exit.dispose(); resolve(value); });
  });
  assert.equal(outcome.exitCode, 0); assert.equal(sent, true);
  assert.ok(output.includes(JSON.stringify(argument))); assert.ok(output.includes("GENERATED_PEER_ACK"));
  assert.equal(output.includes(marker), false, "A reflected parent packet cannot be mistaken for an authenticated worker frame.");
});
test("legacy native bootstrap binds the original signed guest before a precise protocol refusal, never worker initialization", async () => {
  let bound = 0;
  await assert.rejects(() => verifyNativeBootstrap({ kind: "bootstrap", protocol: PROTOCOL_VERSION - 1 }, async () => { bound++; }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "sandbox_protocol" &&
      error.message.includes(`protocol ${PROTOCOL_VERSION - 1}`) && error.message.includes(`requires ${PROTOCOL_VERSION}`));
  assert.equal(bound, 1);
  await verifyNativeBootstrap({ kind: "bootstrap", protocol: PROTOCOL_VERSION }, async () => { bound++; });
  assert.equal(bound, 2);
  await assert.rejects(() => verifyNativeBootstrap({ kind: "bootstrap", protocol: PROTOCOL_VERSION, inventedOwner: true }, async () => { bound++; }));
  assert.equal(bound, 2, "Malformed packets cannot trigger guest ownership or readiness.");
});
test("a legacy protocol cannot hide failed original-owner verification or authorize a substitute owner", async () => {
  await assert.rejects(() => verifyNativeBootstrap({ kind: "bootstrap", protocol: PROTOCOL_VERSION - 1 }, async () => {
    throw new Error("Generated signed owner changed.");
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "sandbox_protocol_owner" &&
    error.message.includes(`requires ${PROTOCOL_VERSION}`) && error.message.includes("Generated signed owner changed"));
});
test("an actual older pinned native workload fails before initialization while its signed original guest cleanup is verified", { skip: !legacyConfiguration, timeout: 90_000 }, async () => {
  assert.ok(legacyConfiguration?.qualification);
  await mkdir(".native/qualification", { recursive: true, mode: 0o700 });
  const root = await realpath(await mkdtemp(".native/qualification/native-legacy-bootstrap-")), state = join(root, "state");
  await mkdir(state, { mode: 0o700 });
  const config = { ...legacyConfiguration, qualification: { ...legacyConfiguration.qualification, allowCopilot: false, allowedDomains: [] } };
  const runtime = new SandboxRuntime(state, () => config, { vault: new GeneratedFileVault(join(root, "generated-vault.json")) });
  const id = randomUUID(); let passed = false;
  try {
    await assert.rejects(() => runtime.probe("generated-native", id), (error: unknown) => error instanceof Error && "code" in error && error.code === "sandbox_protocol");
    assert.equal(runtime.readiness.ready, false); assert.equal(runtime.owns(id), false);
    assert.doesNotMatch(runtime.readiness.diagnostic, /cleanup remains unconfirmed/);
    const owner = JSON.parse(await readFile(join(state, "native-executions", id, "bootstrap-owner.json"), "utf8"));
    assert.ok(owner.observedProtocol < PROTOCOL_VERSION); assert.match(owner.nativeSessionId, /^[a-f0-9]{32}$/);
    assert.match(owner.planDigest, /^[a-f0-9]{64}$/); assert.match(owner.signerFingerprint, /^[a-f0-9]{64}$/);
    const inventory: unknown = JSON.parse(await runProgram("container", ["ls", "--all", "--format", "json"], {
      cwd: state, env: sandboxHostEnvironment(), signal: AbortSignal.timeout(5000), timeoutMs: 5000, label: "Generated legacy guest absence",
    }));
    assert.ok(Array.isArray(inventory));
    assert.equal(inventory.filter(isRecord).some((entry) => isRecord(entry.configuration) &&
      entry.configuration.id === `mg-${id.replaceAll("-", "").slice(0, 20)}-${owner.nativeSessionId}`), false);
    passed = true;
  } finally {
    await runtime.close();
    if (passed) await rm(root, { recursive: true, force: true });
    else console.error("Generated legacy-bootstrap diagnostics retained:", root);
  }
});
test("native host tools include macOS installation paths without replacing explicit PATH order or forwarding secrets", () => {
  const environment = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: "/generated/home", GENERATED_SECRET: "generated-not-forwarded" };
  assert.deepEqual(sandboxHostEnvironment(environment), {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin", HOME: "/generated/home",
  });
  assert.equal(environment.PATH, "/usr/bin:/bin:/usr/sbin:/sbin");
  const configured = { PATH: "/generated/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin", HOME: "/generated/home" };
  assert.deepEqual(sandboxHostEnvironment(configured), configured);
  assert.equal(sandboxHostEnvironment({}).PATH, "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin");
});

test("native startup failures retain bounded CLI diagnostics without inventing guest ownership or model access", { skip: !configuration, timeout: 90_000 }, async () => {
  assert.ok(configuration);
  await mkdir(".native/qualification", { recursive: true, mode: 0o700 });
  const root = await realpath(await mkdtemp(".native/qualification/native-startup-")), state = join(root, "state");
  await mkdir(state, { mode: 0o700 });
  const marker = "GENERATED_NATIVE_PRELOAD_REFUSAL", id = randomUUID();
  const preload = `data:text/javascript;base64,${Buffer.from(`throw new Error("${marker}");`).toString("base64")}`;
  const runtime = new SandboxRuntime(state, () => configuration, {
    vault: new GeneratedFileVault(join(root, "generated-vault.json")),
    command: ["/usr/local/bin/node", "--import", preload, "/opt/moguri/dist/remote-bridge.mjs", "--foreground"],
  });
  try {
    await assert.rejects(() => runtime.probe("generated-native-startup", id), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, new RegExp(marker));
      assert.ok(error.message.length <= 4096);
      return true;
    });
    assert.equal(runtime.readiness.ready, false);
    assert.equal(runtime.owns(id), false);
    const intent = JSON.parse(await readFile(join(state, "native-executions", id, "intent.json"), "utf8"));
    assert.equal(intent.id, id);
    assert.equal(intent.probe, true);
    await assert.rejects(() => readFile(join(state, "native-executions", id, "bootstrap-owner.json")), { code: "ENOENT" });
  } finally {
    await runtime.close();
    console.error("Expected failed native-startup intent retained:", root);
  }
});

test("actual pinned SendBox adapter verifies its exact selected release, guest process controls and owned VM absence with Finder's minimal PATH and no model call", { skip: !configuration, timeout: 90_000 }, async () => {
  assert.ok(configuration);
  await mkdir(".native/qualification", { recursive: true, mode: 0o700 });
  const root = await realpath(await mkdtemp(".native/qualification/native-sdk-")), state = join(root, "state");
  await mkdir(state, { mode: 0o700 });
  const runtime = new SandboxRuntime(state, () => configuration, { vault: new GeneratedFileVault(join(root, "generated-vault.json")) });
  const originalPath = process.env.PATH;
  process.env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
  let passed = false;
  try {
    assert.equal(runtime.readiness.ready, false);
    const probeId = randomUUID(), result = await runtime.probe("generated-native", probeId);
    assert.equal(result.ready, true);
    assert.equal(result.release, configuration.qualification!.release);
    assert.equal(result.workerDigest, configuration.qualification!.workerDigest);
    assert.equal(result.image, configuration.image);
    const intent = JSON.parse(await readFile(join(state, "native-executions", probeId, "intent.json"), "utf8"));
    assert.equal(intent.format, "moguri-native-intent"); assert.equal(intent.version, 1); assert.equal(intent.probe, true);
    assert.equal(intent.configDigest, frameDigest(configuration));
    assert.ok(Number.isInteger(intent.createdAfter) && intent.createdBefore >= intent.createdAfter);
    assert.equal(intent.launchName, `mg-${probeId.replaceAll("-", "").slice(0, 20)}`);
    const owner = JSON.parse(await readFile(join(state, "native-executions", probeId, "bootstrap-owner.json"), "utf8"));
    assert.equal(owner.id, probeId); assert.equal(owner.observedProtocol, PROTOCOL_VERSION);
    assert.match(owner.nativeSessionId, /^[a-f0-9]{32}$/);
    assert.deepEqual(runtime.assertReady(), configuration);
    await assert.rejects(() => runtime.probe("generated-native", probeId), { code: "EEXIST" });
    assert.equal(runtime.owns(probeId), false, "The create-only original qualification never launches another VM on replay.");
    passed = true;
  } finally {
    try { await runtime.close(); }
    finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
    if (passed) await rm(root, { recursive: true, force: true });
    else console.error("Generated native adapter diagnostics retained:", root);
  }
});

test("actual native adapter encrypts real worker IPC, withholds model access and retains an authenticated failed after-state despite rollback", { skip: !configuration, timeout: 90_000 }, async () => {
  assert.ok(configuration);
  await mkdir(".native/qualification", { recursive: true, mode: 0o700 });
  const root = await realpath(await mkdtemp(".native/qualification/native-ipc-")), state = join(root, "state"), sourceRoot = join(root, "source");
  for (const path of [state, sourceRoot]) await mkdir(path, { mode: 0o700 });
  const runtime = new SandboxRuntime(state, () => configuration, { vault: new GeneratedFileVault(join(root, "generated-vault.json")) });
  const id = randomUUID(), sessionId = randomUUID(), signal = AbortSignal.timeout(30_000);
  let passed = false, failure: unknown;
  try {
    await runtime.probe("generated-native");
    const source = await captureNativeSource(sourceRoot, [], { denied: [], readOnly: [] }, signal);
    const stage = await materializeNativeStage(state, { profileId: "generated-native", sessionId, turnId: randomUUID() }, source, signal);
    let execution: SandboxExecution = { id, profileId: stage.profileId, sessionId, projectId: null, turnId: randomUUID(), workspaceId: stage.turnId,
      sourceWorkspaceId: null,
      stage, sourceRoot: null, inputDigest: source.digest, config: configuration, configDigest: frameDigest(configuration),
      image: configuration.image!, workerDigest: configuration.qualification!.workerDigest, launchName: `mg-${id.replaceAll("-", "").slice(0, 20)}`,
      command: runtime.workerArgv(), createdAt: new Date().toISOString(), root: null, createdAfter: Math.floor(Date.now() / 1000) - 2,
      createdBefore: Math.ceil(Date.now() / 1000) + 120, nativeSessionId: null, planDigest: null, signerFingerprint: null,
      status: "launching", cancellation: "none", cleanup: "pending", diagnostic: null, lastSequence: 0, workerPid: null, cliExitCode: null, resultDigest: null, revision: 0 };
    const worker = runtime.launch(execution, async (changes) => {
      execution = { ...execution, ...changes, revision: execution.revision + 1 };
      if (changes.nativeSessionId) {
        const values: unknown = JSON.parse(await runProgram("container", ["ls", "--all", "--format", "json"], { cwd: state, signal, timeoutMs: 5000, label: "Generated native ownership proof" }));
        assert.ok(Array.isArray(values));
        const owned = values.filter(isRecord).find((value) => isRecord(value.configuration) && value.configuration.id === `${execution.launchName}-${changes.nativeSessionId}`);
        assert.ok(owned && isRecord(owned.configuration));
        assert.ok(isRecord(owned.configuration.image) && isRecord(owned.configuration.image.descriptor));
        assert.equal(owned.configuration.image.reference, configuration.image);
        assert.equal(owned.configuration.image.descriptor.digest, configuration.image!.slice(configuration.image!.lastIndexOf("@") + 1));
      }
    });
    let boundaries = 0, terminal = false;
    worker.events.on("error", (error) => { failure = error; });
    worker.events.on("message", (request, frame) => {
      try {
        assert.ok(isRecord(request) && frame);
        execution.lastSequence = frame.sequence;
        if (request.kind === "boundary") {
          boundaries++;
          worker.send({ kind: "reply", requestId: String(request.requestId), error: "Generated denied model access. No inference was authorized." });
        } else if (request.kind === "finished") {
          assert.equal(request.outcome, "failed"); terminal = true;
          worker.send({ kind: "reply", requestId: String(request.requestId), value: { accepted: true } });
        } else assert.fail(`Unexpected model/tool access: ${String(request.kind)}`);
        worker.acknowledge(frame.sequence);
      } catch (error) { failure = error; worker.kill("SIGTERM"); }
    });
    await worker.verified;
    worker.send({ kind: "start", root: null, readOnly: false, env: "Sandbox", context: [] });
    const ended = await worker.finished;
    if (failure) throw failure;
    assert.equal(boundaries, 1); assert.equal(terminal, true);
    assert.equal(ended.clean, true); assert.equal(ended.failure, null); assert.equal(ended.exitCode, 1);
    const retained = await captureSandboxResult(execution, await runtime.key(id), []);
    assert.equal(retained.result.journal.status, "verified");
    assert.equal(retained.result.rollback, "confirmed");
    assert.equal(retained.result.exitCode, 1);
    assert.equal(retained.frames.length, 0); assert.equal(retained.more, false);
    await assert.rejects(() => inspectNativeStage(stage), /replaced/);
    passed = true;
  } finally {
    await runtime.close();
    if (passed) await rm(root, { recursive: true, force: true });
    else console.error("Generated native IPC diagnostics retained:", root);
  }
});
