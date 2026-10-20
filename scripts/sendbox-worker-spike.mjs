import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";
import * as pty from "node-pty";
import { JsonLineChannel } from "../apps/service/src/worker-wire.ts";
import { BridgeEnvelopeSchema } from "../apps/service/src/remote-protocol.ts";
import { parse, PROTOCOL_VERSION } from "../packages/protocol/src/index.ts";
import { tools, validateTool } from "../apps/service/src/tools.ts";
import { assistantMessage } from "../apps/service/src/worker-protocol.ts";
import { readNativeRollback } from "../apps/service/src/native-evidence.ts";
import { captureNativeSource, assertNativeSource, inspectNativeStage, materializeNativeStage } from "../apps/service/src/native-staging.ts";
import sharp from "sharp";

const { values } = parseArgs({ options: { candidate: { type: "string" }, workload: { type: "string" }, turn: { type: "boolean" }, network: { type: "boolean" }, stop: { type: "string" } } });
if (process.platform !== "darwin" || !values.candidate || !values.workload) throw new Error("Use Node --import tsx on macOS with --candidate PINNED_INSTALLATION.json --workload IMAGE_QUALIFICATION.json. No automatic installation or trust change.");
if (values.stop && (!values.turn || values.network || !["model", "command", "control"].includes(values.stop))) throw new Error("Use --turn --stop model|command|control for an offline generated cancellation primitive, without --network.");
const expectedOutcome = values.stop && values.stop !== "model" ? "partial" : values.stop === "model" ? "stopped" : "completed";
const candidate = JSON.parse(await readFile(values.candidate, "utf8")), workload = JSON.parse(await readFile(values.workload, "utf8"));
const hash = (content) => createHash("sha256").update(content).digest("hex");
for (const [path, expected] of [[candidate.executable, candidate.hostSha256], [candidate.key, candidate.keySha256], [join(candidate.bundle, "manifest.json"), candidate.manifestSha256]]) {
  if (typeof path !== "string" || !path.startsWith("/") || typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("The installation descriptor needs exact absolute paths and recorded SHA-256 identities.");
  const metadata = await lstat(path);
  assert.ok(metadata.isFile() && metadata.uid === 0 && !(metadata.mode & 0o022) && await realpath(path) === path, "Candidate artifacts must remain regular canonical root-owned files, not user-writable substitutes.");
  assert.equal(hash(await readFile(path)), expected, "Installed candidate identity changed. No VM was launched.");
}
assert.equal(workload.status, "PASS"); assert.equal(workload.payload.protocol, PROTOCOL_VERSION);
assert.match(workload.image, /^.+@sha256:[a-f0-9]{64}$/);
assert.match(workload.payload.files["dist/worker.mjs"], /^[a-f0-9]{64}$/);
assert.ok(typeof candidate.trustRootId === "string" && candidate.trustRootId && Number.isSafeInteger(candidate.minimumReleaseSequence) && candidate.minimumReleaseSequence > 0);
const manifest = JSON.parse(JSON.parse(await readFile(join(candidate.bundle, "manifest.json"), "utf8")).payload);
assert.equal(manifest.trust_root_id, candidate.trustRootId); assert.ok(manifest.release_sequence >= candidate.minimumReleaseSequence);
const inventory = () => JSON.parse(execFileSync("container", ["ls", "--all", "--format", "json"], { encoding: "utf8", timeout: 10_000 }));
const before = inventory(), beforeIds = new Set(before.map((vm) => vm.configuration.id));
const root = resolve(".native/qualification"); await mkdir(root, { recursive: true, mode: 0o700 });
const directory = await mkdtemp(join(root, "sendbox-worker-")), sourceRoot = join(directory, "source"), stateRoot = join(directory, "stage-state"), config = join(directory, "sendbox.json");
const runId = randomUUID(), key = randomBytes(32).toString("hex"), sourceSignal = new AbortController().signal;
await mkdir(sourceRoot, { mode: 0o700 }); await mkdir(stateRoot, { mode: 0o700 });
await writeFile(join(sourceRoot, "generated.txt"), "Generated real guest worker original.\n", { mode: 0o600 });
const source = await captureNativeSource(sourceRoot, ["generated.txt"], { denied: [], readOnly: [] }, sourceSignal);
const stage = await materializeNativeStage(stateRoot, { profileId: "generated-native-qualification", sessionId: randomUUID(), turnId: runId }, source, sourceSignal);
const workspace = (await inspectNativeStage(stage)).workspace;
if (values.turn) await cp("scripts/worker-image/generated-provider.mjs", join(workspace, "generated-provider.mjs"));
if (values.stop) await writeFile(join(workspace, "generated-mode.json"), JSON.stringify({ stop: values.stop === "control" ? "model" : values.stop }), { mode: 0o600 });
const fixtureDigest = values.turn ? hash(await readFile(join(workspace, "generated-provider.mjs"))) : null;
const pixels = values.turn ? await sharp(randomBytes(1024 * 1024 * 3), { raw: { width: 1024, height: 1024, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer() : null;
const startMessage = { kind: "start", root: "/workspace", context: [{ role: "user", timestamp: Date.now(), content: [{ type: "text", text: "Generated image and exact read/write qualification." }, ...(pixels ? [{ type: "image", mimeType: "image/png", data: pixels.toString("base64") }] : [])] }], readOnly: false };
const name = `mgw-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
const ownedVms = () => inventory().filter((vm) => {
  const configuration = vm.configuration;
  return !beforeIds.has(configuration.id) && configuration.id.startsWith(`${name}-`) &&
    configuration.initProcess.executable === "/opt/sendbox/bin/sendbox-guest" &&
    configuration.mounts.some((mount) => mount.source === workspace);
});
const cleanup = () => {
  for (const vm of ownedVms()) {
    const id = vm.configuration.id;
    if (vm.status === "running") execFileSync("container", ["stop", "--time", "5", id], { stdio: "pipe", timeout: 15_000 });
    execFileSync("container", ["delete", id], { stdio: "pipe", timeout: 15_000 });
  }
  assert.deepEqual(ownedVms(), [], "Owned native guest remains. Inspect before claiming cleanup.");
};
const args = ["--runtime", "apple", "--config", config, "--image", workload.image, "--bundle", candidate.bundle, "--trust-root", candidate.key, "--trust-root-id", candidate.trustRootId, "--minimum-release-sequence", String(candidate.minimumReleaseSequence)];
const nativeCode = `const fs=require("node:fs");const status=fs.readFileSync("/proc/self/status","utf8");const p=require("/opt/moguri/payload.json");const field=name=>status.match(new RegExp("^"+name+":\\\\s*(.+)$","m"))?.[1];if(process.getuid()===0||field("NoNewPrivs")!=="1"||field("Seccomp")!=="2"||!/^0+$/.test(field("CapEff")??"x"))throw Error("Native Node boundary controls failed");const thread=new(require("node:worker_threads").Worker)('require("node:worker_threads").parentPort.postMessage("GENERATED_WORKER_THREAD_READY")',{eval:true});let message;thread.on("message",value=>message=value);thread.on("error",error=>{throw error;});thread.on("exit",code=>{if(code!==0||message!=="GENERATED_WORKER_THREAD_READY")throw Error("Normal Node worker thread did not complete");fs.writeFileSync("/workspace/generated-node.txt","GENERATED_NODE_WORKSPACE_READY");if(fs.readFileSync("/workspace/generated-node.txt","utf8")!=="GENERATED_NODE_WORKSPACE_READY")throw Error("Wrong workspace");fs.unlinkSync("/workspace/generated-node.txt");console.log("GENERATED_MOGURI_NODE_BOUNDARY_READY");console.log(JSON.stringify({uid:process.getuid(),node:process.versions.node,protocol:p.protocol,nnp:field("NoNewPrivs"),seccomp:field("Seccomp"),capabilities:field("CapEff")}));});`;
const threadCode = `import ctypes,json,os,resource
libc=ctypes.CDLL(None,use_errno=True)
thread=ctypes.c_ulong()
callback=ctypes.CFUNCTYPE(ctypes.c_void_p,ctypes.c_void_p)(lambda argument:None)
result=libc.pthread_create(ctypes.byref(thread),None,callback,None)
if result==0: libc.pthread_join(thread,None)
libc.syscall(435,ctypes.c_void_p(),ctypes.c_size_t(0))
status=open("/proc/self/status").read().splitlines()
print(json.dumps({"uid":os.getuid(),"pthreadCode":result,"pthreadError":os.strerror(result),"clone3Errno":ctypes.get_errno(),"nprocLimit":resource.getrlimit(resource.RLIMIT_NPROC),"status":[line for line in status if line.startswith(("NoNewPrivs:","Seccomp:","CapEff:"))]}))
if result!=0: raise RuntimeError("Real sandbox pthread_create failed; do not disable hardening or claim Node readiness")
`;
await writeFile(config, JSON.stringify({
  name, project_path: workspace, runtime: { provider: "apple" },
  resources: { cpus: 2, memory_mb: 2048, disk_size_mb: 2048 },
  policy: {
    commands: { default_action: "deny", log_blocked: true, allowlist: ["/usr/local/bin/node -e *", "/usr/local/bin/node /opt/moguri/dist/remote-bridge.mjs --foreground", "/usr/local/bin/node --import /workspace/generated-provider.mjs /opt/moguri/dist/remote-bridge.mjs --foreground", "/usr/bin/python3.13 -c *"], denylist: [] },
    boundaries: { enabled: true, tool_calls: { servers: {} }, syscalls: { additional_denylist: [], log_blocked: true } },
    network: { default_action: "deny", allow_dns: Boolean(values.network), max_connections: values.network ? 3 : 1, allowed_domains: values.network ? ["api.githubcopilot.com"] : [], blocked_domains: [] },
    packages: { enabled: false },
  },
  secrets: [], github: { forward_auth: false, forward_copilot_auth: false, allow_private_repository_access: false, branch_protection: { enabled: false, protected_branches: [], allowed_branch_patterns: [] } },
  devcontainer: { auto_generate: false, extensions: [] }, observability: { mcp_inspection: { enabled: false } },
}, null, 2), { mode: 0o600 });
let passed = false, terminal, ended = false, done;
const transport = { bootstraps: 0, kinds: [], diagnostics: [], frames: 0, outcomes: [], stopRequested: false, cancellationAck: false, stopStartedAt: null, stopMs: null, finalStatus: null, cliExit: null, nativeSessionId: null };
const started = performance.now();
const createdAfter = Math.floor(Date.now() / 1000) - 2;
try {
  execFileSync(candidate.executable, ["policy", "validate", "--config", config], { encoding: "utf8", timeout: 10_000 });
  const run = async (program, argv, filename) => {
    try {
      const text = execFileSync(candidate.executable, ["run", "--json", ...args, "--", program, ...argv], { encoding: "utf8", timeout: 90_000, maxBuffer: 2 * 1024 * 1024 });
      await writeFile(join(directory, filename), text, { mode: 0o600 });
      const events = text.trim().split("\n").map((line) => JSON.parse(line)), result = events.filter((event) => event.event === "result");
      assert.equal(result.length, 1); assert.equal(result[0].execution, "persistent_guest"); assert.equal(result[0].ok, true); assert.equal(result[0].exit_code, 0);
      const streams = { stdout: [], stderr: [] };
      for (const event of events) {
        if (event.event === "result") continue;
        assert.equal(event.event, "output"); assert.equal(event.encoding, "hex");
        assert.ok(event.stream === "stdout" || event.stream === "stderr"); assert.match(event.data, /^(?:[a-f0-9]{2})*$/);
        streams[event.stream].push(Buffer.from(event.data, "hex"));
      }
      return { stdout: Buffer.concat(streams.stdout).toString("utf8"), stderr: Buffer.concat(streams.stderr).toString("utf8") };
    } catch (error) {
      if (typeof error.stdout === "string") await writeFile(join(directory, filename), error.stdout, { mode: 0o600 });
      throw error;
    }
  };
  const threading = await run("/usr/bin/python3.13", ["-c", threadCode], "thread-result.jsonl");
  const threadInfo = JSON.parse(threading.stdout);
  assert.equal(threadInfo.pthreadCode, 0); assert.equal(threadInfo.clone3Errno, 38); assert.ok(threadInfo.uid > 0);
  for (const expected of [/^NoNewPrivs:\s*1$/, /^Seccomp:\s*2$/, /^CapEff:\s*0+$/]) assert.ok(threadInfo.status.some((line) => expected.test(line)));
  const plain = await run("/usr/local/bin/node", ["-e", nativeCode], "node-result.jsonl"), lines = plain.stdout.trimEnd().split("\n");
  assert.equal(lines[0], "GENERATED_MOGURI_NODE_BOUNDARY_READY");
  const controls = JSON.parse(lines[1]); assert.ok(controls.uid > 0); assert.equal(controls.nnp, "1"); assert.equal(controls.seccomp, "2"); assert.match(controls.capabilities, /^0+$/);
  assert.equal(controls.node, "26.12.0"); assert.equal(controls.protocol, PROTOCOL_VERSION); assert.equal(lines.length, 2);
  if (values.network) {
    const code = `if(process.env.NODE_USE_ENV_PROXY!=="1"||!process.env.HTTPS_PROXY||!process.env.ALL_PROXY)throw Error("Missing enforced native proxy environment");fetch("https://api.githubcopilot.com/models",{redirect:"error",signal:AbortSignal.timeout(10000)}).then(response=>{console.log(JSON.stringify({endpoint:"api.githubcopilot.com/models",status:response.status,proxy:true,credentials:false}));if(![401,403].includes(response.status))throw Error("Unexpected unauthenticated model metadata status");}).catch(error=>{console.error(error.message);process.exitCode=1;});`;
    const response = JSON.parse((await run("/usr/local/bin/node", ["-e", code], "network-result.jsonl")).stdout);
    assert.ok(response.status === 401 || response.status === 403); assert.equal(response.proxy, true); assert.equal(response.credentials, false);
  }
  const input = new PassThrough(), output = new PassThrough(), channel = new JsonLineChannel(input, output, true);
  const stop = async () => {
    if (transport.stopRequested) return;
    transport.stopRequested = true;
    await writeFile(join(sourceRoot, "generated.txt"), "Generated concurrent source edit.\n");
    transport.stopStartedAt = performance.now(); channel.send({ kind: "parent", message: { kind: values.stop === "control" ? "control-lost" : "stop" } });
  };
  let info, failure, retention = null, bootstraps = 0, diagnostics = 0, finished = false, modelCalls = 0, toolCalls = 0, sequence = 0, queue = Promise.resolve();
  const main = values.turn ? ["/usr/local/bin/node", "--import", "/workspace/generated-provider.mjs", "/opt/moguri/dist/remote-bridge.mjs", "--foreground"] : ["/usr/local/bin/node", "/opt/moguri/dist/remote-bridge.mjs", "--foreground"];
  const priorMain = new Set(ownedVms().map((vm) => vm.configuration.id));
  terminal = pty.spawn(candidate.executable, ["run", "--interactive", ...args, "--", ...main], { cwd: workspace, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME, TERM: "xterm-256color" }, cols: 100, rows: 32 });
  done = new Promise((resolve) => terminal.onExit((value) => { ended = true; resolve(value); }));
  terminal.onData((data) => input.write(data)); output.on("data", (data) => terminal.write(data));
  channel.on("error", (error) => { failure = error; });
  channel.on("diagnostic", (text) => {
    diagnostics += Buffer.byteLength(text);
    transport.diagnostics.push(text.replaceAll(key, "[generated transport key withheld]").slice(0, 1024)); transport.diagnostics = transport.diagnostics.slice(-12);
    if (diagnostics > 64 * 1024) failure = new Error("Native diagnostic/echo limit exceeded.");
  });
  channel.on("message", (raw) => {
    try {
      const message = parse(BridgeEnvelopeSchema, raw);
      transport.kinds.push(message.kind); transport.kinds = transport.kinds.slice(-40);
      if (message.kind === "bootstrap") {
        bootstraps++; transport.bootstraps = bootstraps;
        const active = ownedVms().filter((vm) => !priorMain.has(vm.configuration.id) && vm.status === "running");
        assert.equal(active.length, 1, "Cannot bind the foreground workload to one owned native session.");
        transport.nativeSessionId = active[0].configuration.id.slice(name.length + 1);
        assert.match(transport.nativeSessionId, /^[a-f0-9]{32}$/);
        channel.send({ action: values.turn ? "start" : "probe", protocol: PROTOCOL_VERSION, workerDigest: workload.payload.files["dist/worker.mjs"], stateDir: `/tmp/moguri-generated-${runId}`, root: "/workspace", ...(values.turn ? { runId, key, after: 0 } : {}) });
      } else if (message.kind === "probe") info = message.info;
      else if (message.kind === "ready" && values.turn) {
        info = message.info; assert.equal(message.status.runId, runId);
        channel.send({ kind: "parent", message: startMessage });
      } else if (message.kind === "status") {
        transport.finalStatus = { status: message.status.status, cancellation: message.status.cancellation, cleanup: message.status.cleanup };
      } else if (message.kind === "frame" && values.turn) {
        queue = queue.then(async () => {
          assert.equal(message.sequence, ++sequence); assert.equal(hash(Buffer.from(JSON.stringify(message.request))), message.digest);
          transport.frames = sequence;
          const request = message.request, reply = (value) => channel.send({ kind: "parent", message: { kind: "reply", requestId: request.requestId, value } });
          if (request.kind === "boundary") {
            reply({ model: { id: "generated-native", name: "Generated fetch fixture, no real network", provider: "moguri-local", api: "openai-completions", baseUrl: "https://generated.native.invalid/v1", reasoning: false, input: ["text", "image"], contextWindow: 65536, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
              auth: { apiKey: "moguri-keyless", headers: { Authorization: null } }, steers: [], systemPrompt: "Generated qualification only. Use exactly the declared fixture tools.", tools: tools.filter((tool) => values.stop === "model" || values.stop === "control" ? false : values.stop === "command" ? tool.name === "run_command" : tool.name === "read_file" || tool.name === "write_file"), mode: "agent", folders: { denied: [], readOnly: [] }, maxTokens: 1024 });
          } else if (request.kind === "approval") {
            validateTool(request.call);
            if (values.stop === "command") {
              assert.equal(request.call.name, "run_command"); assert.equal(request.call.arguments.command, "printf 'Generated native partial command.\\n' > generated-command.txt; sleep 30 & printf 'GENERATED_NATIVE_COMMAND_READY=%s\\n' \"$!\"; wait"); assert.equal(request.call.arguments.timeoutMs, 30_000);
            } else {
              assert.ok(request.call.name === "read_file" || request.call.name === "write_file"); assert.equal(request.call.arguments.path, "generated.txt");
              if (request.call.name === "write_file") assert.equal(request.call.arguments.text, "Generated real guest worker replacement.\n");
            }
            toolCalls++; reply({ allow: true, mode: "agent", folders: { denied: [], readOnly: [] } });
          } else if (request.kind === "model.complete") {
            const model = assistantMessage(request.message);
            modelCalls++; if (values.stop !== "control") reply({ accepted: true }); transport.outcomes.push({ kind: "model", stopReason: model.stopReason, usageReported: request.usageReported });
          } else if (request.kind === "tool.complete") {
            reply({ accepted: true }); transport.outcomes.push({ kind: "tool", outcome: request.outcome, isError: request.isError });
          } else if (request.kind === "finished") {
            if (values.stop !== "control") reply({ accepted: true }); finished = true; transport.outcomes.push({ kind: "finished", outcome: request.outcome, diagnostic: request.diagnostic });
          } else if (request.kind === "ack") transport.cancellationAck = true;
          else if (request.kind === "delta" && (values.stop === "model" || values.stop === "control") && request.text.includes("GENERATED_NATIVE_MODEL_PENDING")) await stop();
          else if (request.kind === "output" && values.stop === "command" && request.text.includes("GENERATED_NATIVE_COMMAND_READY")) await stop();
          channel.send({ kind: "ack", sequence: message.sequence });
        }).catch((error) => { failure = error; channel.send({ kind: "parent", message: { kind: "stop" } }); });
      }
      else if (message.kind === "error") { transport.outcomes.push({ kind: "error", code: message.code, message: message.message }); failure = new Error(message.message); }
    } catch (error) { failure = error; }
  });
  let timer;
  try {
    const exit = await Promise.race([done, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Real SendBox foreground-PTY worker timed out. Cleanup is not assumed.")), 90_000); })]);
    transport.cliExit = exit.exitCode;
    if (transport.stopStartedAt !== null) transport.stopMs = performance.now() - transport.stopStartedAt;
    await queue;
    if (failure) throw failure;
    assert.equal(exit.exitCode, expectedOutcome === "partial" ? 2 : expectedOutcome === "stopped" ? 130 : 0);
    assert.equal(exit.signal ?? 0, 0); assert.equal(bootstraps, 1);
    assert.equal(info?.platform, "linux"); assert.equal(info?.nodeVersion, "26.12.0");
    assert.equal(info?.workerDigest, workload.payload.files["dist/worker.mjs"]); assert.equal(info?.root, "/workspace");
    if (values.turn) {
      assert.equal(finished, true); assert.equal(modelCalls, values.stop ? 1 : 3); assert.equal(toolCalls, values.stop === "model" || values.stop === "control" ? 0 : values.stop === "command" ? 1 : 2);
      assert.equal(transport.outcomes.findLast((outcome) => outcome.kind === "finished")?.outcome, expectedOutcome);
      if (values.stop) {
        assert.equal(transport.stopRequested, true); assert.equal(transport.cancellationAck, true);
        assert.ok(transport.stopMs < 10_000, "Native cancellation exceeded its measured 10-second qualification bound.");
        assert.deepEqual(transport.finalStatus, { status: expectedOutcome, cancellation: "acknowledged", cleanup: "owned-worker-stopped" });
      }
      assert.ok(transport.outcomes.filter((outcome) => outcome.kind === "tool").every((outcome) => values.stop === "command" ? outcome.isError && outcome.outcome === "partial" : !outcome.isError && outcome.outcome === "completed"));
      assert.equal(await readFile(join(workspace, "generated.txt"), "utf8"), values.stop ? "Generated real guest worker original.\n" : "Generated real guest worker replacement.\n");
      let provider;
      if (values.stop) {
        if (!process.env.HOME) throw new Error("Native retained evidence needs the exact original host HOME; no state-root fallback.");
        const expected = { stateRoot: join(process.env.HOME, ".sendbox", "run"), sessionId: transport.nativeSessionId, workspace, image: workload.image, exitCode: exit.exitCode,
          file: "generated-provider-proof.json", command: { program: main[0], arguments: main.slice(1) }, createdAfter, createdBefore: Math.ceil(Date.now() / 1000) + 2,
          maxBytes: 64 * 1024, baseline: { "generated-provider.mjs": fixtureDigest } };
        const retained = await readNativeRollback(expected);
        assert.equal(retained.added, true); assert.equal(retained.rollback, "confirmed");
        await assert.rejects(() => lstat(join(workspace, expected.file)), { code: "ENOENT" });
        provider = JSON.parse(retained.content);
        retention = { sessionId: retained.sessionId, signerFingerprint: retained.signerFingerprint, planDigest: retained.planDigest, auditDigest: retained.auditDigest,
          beforeId: retained.beforeId, afterId: retained.afterId, afterBinding: retained.afterBinding, rollback: retained.rollback,
          files: [{ path: expected.file, digest: retained.digest, bytes: retained.content.length }] };
        if (values.stop === "command") {
          const partial = await readNativeRollback({ ...expected, file: "generated-command.txt" });
          assert.equal(partial.added, true); assert.equal(partial.content.toString("utf8"), "Generated native partial command.\n");
          await assert.rejects(() => lstat(join(workspace, "generated-command.txt")), { code: "ENOENT" });
          retention.files.push({ path: "generated-command.txt", digest: partial.digest, bytes: partial.content.length });
        }
      } else provider = JSON.parse(await readFile(join(workspace, "generated-provider-proof.json"), "utf8"));
      assert.ok(provider.uid > 0); assert.equal(provider.requests.length, values.stop ? 1 : 3); assert.equal(provider.transport, "generated-fetch-fixture-not-network"); assert.equal(provider.enforcedProxy, true);
      assert.equal(provider.runId, runId);
      if (values.stop === "model" || values.stop === "control") {
        assert.equal(provider.cancelled, true);
        const completed = transport.outcomes.find((outcome) => outcome.kind === "model");
        assert.equal(completed.stopReason, "aborted"); assert.equal(completed.usageReported, false);
      }
      for (const request of provider.requests) { assert.equal(request.authorization, false); assert.deepEqual(request.images, [{ bytes: pixels.length, digest: hash(pixels) }]); }
      assert.ok(Buffer.byteLength(JSON.stringify(startMessage)) > 1024 * 1024);
    }
  } finally { clearTimeout(timer); input.end(); channel.end(); }
  assert.equal(await readFile(join(sourceRoot, "generated.txt"), "utf8"), values.stop ? "Generated concurrent source edit.\n" : "Generated real guest worker original.\n");
  if (values.stop) {
    await assert.rejects(() => assertNativeSource(source, sourceSignal), /reviewed source changed/i);
    await assert.rejects(() => inspectNativeStage(stage), /workspace was replaced/);
  } else await assertNativeSource(source, sourceSignal);
  cleanup();
  const receipt = { status: "PASS", primitive: values.stop ? `Actual native ${values.stop} cancellation with acknowledged ${expectedOutcome} worker and verified owned VM absence` : values.turn ? "Actual Moguri worker fork/IPC and maintained pi-ai loop with generated fetch fixture, exact approved read/write and >1 MiB image through real SendBox foreground PTY" : "Actual SendBox Node ELF with non-root/NNP/seccomp/no capabilities and workspace I/O, then real Moguri raw foreground-PTY bootstrap", sourceStaging: { digest: source.digest, separateMount: workspace !== sourceRoot, sourceEditPreserved: Boolean(values.stop), changedBaseRejected: Boolean(values.stop), replacedExecutionBindingRejected: Boolean(values.stop), publication: "none" }, stopMode: values.stop ?? null, stopRequested: transport.stopRequested, cancellationAck: transport.cancellationAck, stopMs: transport.stopMs, workerStatus: transport.finalStatus, cliExit: transport.cliExit, nativeSessionId: transport.nativeSessionId, retention, fixtureDigest, unauthenticatedMetadataEgress: Boolean(values.network), generatedImageBytes: pixels?.length ?? 0, startFrameBytes: values.turn ? Buffer.byteLength(JSON.stringify(startMessage)) : 0, modelCalls, toolCalls, image: workload.image, protocol: PROTOCOL_VERSION, workerDigest: info.workerDigest, candidate: { hostSha256: candidate.hostSha256, manifestSha256: candidate.manifestSha256, trustRootId: candidate.trustRootId, minimumReleaseSequence: candidate.minimumReleaseSequence }, ms: performance.now() - started, qualification: "Development candidate/worker primitive with generated model fetch only; optional real egress is credential-free metadata, never inference. No real credentials, paid inference, SDK/controller lifecycle/restart, real provider-completion guarantee or production release qualification." };
  await writeFile(join(directory, "qualification.json"), JSON.stringify(receipt, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...receipt, directory }, null, 2)); passed = true;
} finally {
  try {
    if (terminal && !ended) {
      try { process.kill(terminal.pid, "SIGTERM"); }
      catch (error) { if (error.code !== "ESRCH") console.error("Owned SendBox CLI cleanup is unconfirmed:", error.code); }
      if (done) {
        let escalation, deadline;
        try {
          await Promise.race([done, new Promise((_resolve, reject) => {
            escalation = setTimeout(() => {
              if (!ended) {
                try { process.kill(terminal.pid, "SIGKILL"); }
                catch (error) { if (error.code !== "ESRCH") console.error("Owned SendBox CLI escalation is unconfirmed:", error.code); }
              }
            }, 5000);
            deadline = setTimeout(() => reject(new Error("Owned SendBox CLI did not settle. Inspect its VM; no cleanup claim.")), 10_000);
          })]);
        } finally { clearTimeout(escalation); clearTimeout(deadline); }
      }
    }
  } finally {
    await writeFile(join(directory, "transport-diagnostic.json"), JSON.stringify(transport, null, 2), { mode: 0o600 });
    cleanup();
    if (!passed) console.error(`SendBox worker qualification FAILED. Generated diagnostics retained at ${directory}. No Sandbox readiness or Local fallback.`);
    else await rm(workspace, { recursive: true, force: true });
  }
}
