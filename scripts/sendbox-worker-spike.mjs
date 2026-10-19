import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";
import * as pty from "node-pty";
import { JsonLineChannel } from "../apps/service/src/worker-wire.ts";
import { BridgeEnvelopeSchema } from "../apps/service/src/remote-protocol.ts";
import { parse, PROTOCOL_VERSION } from "../packages/protocol/src/index.ts";

const { values } = parseArgs({ options: { candidate: { type: "string" }, workload: { type: "string" } } });
if (process.platform !== "darwin" || !values.candidate || !values.workload) throw new Error("Use Node --import tsx on macOS with --candidate PINNED_INSTALLATION.json --workload IMAGE_QUALIFICATION.json. No automatic installation or trust change.");
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
const directory = await mkdtemp(join(root, "sendbox-worker-")), workspace = join(directory, "workspace"), config = join(directory, "sendbox.json");
await mkdir(workspace, { mode: 0o700 });
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
    commands: { default_action: "deny", log_blocked: true, allowlist: ["/usr/local/bin/node -e *", "/usr/local/bin/node /opt/moguri/dist/remote-bridge.mjs", "/usr/bin/python3.13 -c *"], denylist: [] },
    boundaries: { enabled: true, tool_calls: { servers: {} }, syscalls: { additional_denylist: [], log_blocked: true } },
    network: { default_action: "deny", allow_dns: false, max_connections: 1, allowed_domains: [], blocked_domains: [] },
    packages: { enabled: false },
  },
  secrets: [], github: { forward_auth: false, forward_copilot_auth: false, allow_private_repository_access: false, branch_protection: { enabled: false, protected_branches: [], allowed_branch_patterns: [] } },
  devcontainer: { auto_generate: false, extensions: [] }, observability: { mcp_inspection: { enabled: false } },
}, null, 2), { mode: 0o600 });
let passed = false, terminal, ended = false, done;
const started = performance.now();
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
  const input = new PassThrough(), output = new PassThrough(), channel = new JsonLineChannel(input, output, true);
  let info, failure, bootstraps = 0, diagnostics = 0;
  terminal = pty.spawn(candidate.executable, ["run", "--interactive", ...args, "--", "/usr/local/bin/node", "/opt/moguri/dist/remote-bridge.mjs"], { cwd: workspace, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME, TERM: "xterm-256color" }, cols: 100, rows: 32 });
  done = new Promise((resolve) => terminal.onExit((value) => { ended = true; resolve(value); }));
  terminal.onData((data) => input.write(data)); output.on("data", (data) => terminal.write(data));
  channel.on("error", (error) => { failure = error; });
  channel.on("diagnostic", (text) => { diagnostics += Buffer.byteLength(text); if (diagnostics > 64 * 1024) failure = new Error("Native diagnostic/echo limit exceeded."); });
  channel.on("message", (raw) => {
    try {
      const message = parse(BridgeEnvelopeSchema, raw);
      if (message.kind === "bootstrap") {
        bootstraps++;
        channel.send({ action: "probe", protocol: PROTOCOL_VERSION, workerDigest: workload.payload.files["dist/worker.mjs"], stateDir: "/tmp/moguri-generated-unused-state", root: "/workspace" });
      } else if (message.kind === "probe") info = message.info;
      else if (message.kind === "error") failure = new Error(message.message);
    } catch (error) { failure = error; }
  });
  let timer;
  try {
    const exit = await Promise.race([done, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Real SendBox foreground-PTY bootstrap timed out. Cleanup is not assumed.")), 90_000); })]);
    if (failure) throw failure;
    assert.equal(exit.exitCode, 0); assert.equal(exit.signal ?? 0, 0); assert.equal(bootstraps, 1);
    assert.equal(info?.platform, "linux"); assert.equal(info?.nodeVersion, "26.12.0");
    assert.equal(info?.workerDigest, workload.payload.files["dist/worker.mjs"]); assert.equal(info?.root, "/workspace");
  } finally { clearTimeout(timer); input.end(); channel.end(); }
  cleanup();
  const receipt = { status: "PASS", primitive: "Actual SendBox Node ELF with non-root/NNP/seccomp/no capabilities and workspace I/O, then real Moguri raw foreground-PTY bootstrap", image: workload.image, protocol: PROTOCOL_VERSION, workerDigest: info.workerDigest, candidate: { hostSha256: candidate.hostSha256, manifestSha256: candidate.manifestSha256, trustRootId: candidate.trustRootId, minimumReleaseSequence: candidate.minimumReleaseSequence }, ms: performance.now() - started, qualification: "Development candidate and bootstrap only. No provider turn, credential forwarding, large input-credit, cancellation/restart or production release qualification." };
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
    cleanup();
    if (!passed) console.error(`SendBox worker qualification FAILED. Generated diagnostics retained at ${directory}. No Sandbox readiness or Local fallback.`);
    else await rm(workspace, { recursive: true, force: true });
  }
}
