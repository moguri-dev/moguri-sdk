import { EventEmitter } from "node:events";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { PassThrough } from "node:stream";
import { Type } from "typebox";
import * as pty from "node-pty";
import {
  isRecord, MoguriError, parse, PROTOCOL_VERSION, type NativeStage, type SandboxConfiguration, type SandboxExecution,
  type SandboxReadiness,
} from "../../../packages/protocol/src/index.ts";
import { BridgeEnvelopeSchema, type BridgeInfo, type BridgeStatus, type ForegroundQuery } from "./remote-protocol.ts";
import { frameDigest, JsonLineChannel } from "./worker-wire.ts";
import type { ParentMessage } from "./worker-protocol.ts";
import type { WorkerConnection, WorkerConnectionEvents } from "./worker-connection.ts";
import { inspectNativeStage, captureNativeSource, materializeNativeStage } from "./native-staging.ts";
import { readNativeBoundary } from "./native-evidence.ts";
import { McpKeychain, type SecretVault } from "./gateway.ts";
import { runProgram } from "./program.ts";
import { sandboxConfiguration, sandboxRunConfiguration, type QualifiedSandboxConfiguration } from "./sandbox-policy.ts";
import { PrivateControl } from "./private-control.ts";
import { MACOS_TOOL_PATHS } from "../../../packages/client/src/host-environment.ts";
import { assertSandboxNetwork, type SandboxDns } from "./sandbox-network.ts";
import type { SandboxSetupOptions } from "./sandbox-setup.ts";

export type NativeChange = Partial<Pick<SandboxExecution, "nativeSessionId" | "planDigest" | "signerFingerprint" | "workerPid" | "status" | "cancellation" | "cleanup" | "cliExitCode" | "diagnostic">>;
export interface SandboxOptions {
  vault?: SecretVault; changed?: () => void;
  command?: string[];
  dns?: SandboxDns;
  engineOnlyProbe?: () => boolean;
  distribution?: string;
  setup?: SandboxSetupOptions;
}
export interface NativeLaunch {
  id: string; stage: NativeStage; config: SandboxConfiguration; launchName: string; createdAfter: number; createdBefore: number;
  root: string | null;
  providerProbe?: boolean;
  repositories?: SandboxExecution["repositories"];
}
interface NativeResult { exitCode: number; clean: boolean; status: BridgeStatus | null; failure: string | null }
const nativeBootstrapSchema = Type.Object({
  kind: Type.Literal("bootstrap"), protocol: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false });
export async function verifyNativeBootstrap(value: unknown, bindOriginalGuest: () => Promise<void>): Promise<void> {
  const bootstrap = parse(nativeBootstrapSchema, value);
  const mismatch = bootstrap.protocol !== PROTOCOL_VERSION ?
    `The pinned SendBox workload uses Moguri protocol ${bootstrap.protocol}, but this app requires ${PROTOCOL_VERSION}. Rebuild and review the current workload image and worker/bridge digests; changing the JSON version or reusing older pins cannot upgrade its bytes.` : null;
  try { await bindOriginalGuest(); }
  catch (error) {
    if (!mismatch) throw error;
    throw new MoguriError("sandbox_protocol_owner", `${mismatch} Original guest ownership could not be verified: ${error instanceof Error ? error.message : "native ownership verification failed"}. No provider access or alternate owner was authorized.`, 409);
  }
  if (mismatch) throw new MoguriError("sandbox_protocol", `${mismatch} No worker initialization, provider credentials or Local fallback was authorized.`, 409);
}
export function sandboxHostEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const paths = (environment.PATH || "/usr/bin:/bin:/usr/sbin:/sbin").split(delimiter).filter(Boolean);
  return { PATH: [...new Set([...paths, ...MACOS_TOOL_PATHS])].join(delimiter), HOME: environment.HOME };
}
export interface NativeConnection extends WorkerConnection {
  verified: Promise<BridgeInfo>;
  finished: Promise<NativeResult>;
  acknowledge(sequence: number): void;
  query(query: ForegroundQuery["query"], signal: AbortSignal): Promise<Extract<import("./remote-protocol.ts").BridgeEnvelope, { kind: "query-result" }>["result"]>;
}
const absent = (): SandboxReadiness => ({ ready: false, configured: false, diagnostic: "Review exact SendBox release artifacts, workload and deny-by-default network scope, then explicitly qualify native execution. No Local fallback.",
  configDigest: null, release: null, workerDigest: null, image: null });
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const stopped = (message: string): never => { throw new MoguriError("sandbox_identity", `${message} No native model access or Local fallback was authorized.`, 409); };
async function rootArtifact(path: string, expected: string): Promise<Buffer> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.mode & 0o022 || await realpath(path) !== path) stopped("Installed native artifacts must be canonical root-owned regular files without writable aliases.");
  const bytes = await readFile(path);
  if (hash(bytes) !== expected) stopped("An exact reviewed native artifact digest changed.");
  return bytes;
}
export async function verifySandboxArtifacts(value: SandboxConfiguration, cwd: string, signal: AbortSignal): Promise<QualifiedSandboxConfiguration> {
  const config = sandboxConfiguration(value), qualification = config.qualification;
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new MoguriError("sandbox_host", "This native SendBox adapter is qualified for Apple-silicon macOS only. No other provider or Local fallback was selected.", 409);
  const [, , bytes] = await Promise.all([
    rootArtifact(config.executable, qualification.hostSha256), rootArtifact(config.trustRootPath, qualification.keySha256),
    rootArtifact(join(config.bundlePath, "manifest.json"), qualification.manifestSha256),
  ]);
  let manifest: unknown;
  try {
    const envelope: unknown = JSON.parse(bytes.toString("utf8"));
    manifest = isRecord(envelope) && typeof envelope.payload === "string" ? JSON.parse(envelope.payload) : null;
  } catch { throw new MoguriError("sandbox_release", "The pinned signed release manifest is invalid. No VM was started.", 409); }
  if (!isRecord(manifest) || manifest.expected_host_version !== qualification.release || manifest.expected_guest_version !== qualification.release ||
    manifest.trust_root_id !== qualification.trustRootId || typeof manifest.release_sequence !== "number" || manifest.release_sequence < qualification.minimumReleaseSequence) stopped("The signed native host/guest release or rollback floor differs from the exact review.");
  const version = await runProgram(config.executable, ["--version"], { cwd, signal, env: sandboxHostEnvironment(), label: "Pinned SendBox release", timeoutMs: 5000, maxBytes: 4096 });
  if (version.trim() !== `sendbox ${qualification.release}`) stopped("The installed CLI does not report the exact reviewed release.");
  const image = await runProgram("container", ["image", "inspect", config.image], { cwd, signal, env: sandboxHostEnvironment(), label: "Pinned native workload image", timeoutMs: 10_000, maxBytes: 256 * 1024 });
  let inspected: unknown;
  try { inspected = JSON.parse(image); } catch { throw new MoguriError("sandbox_image", "Native image inspection returned invalid JSON. No mutable image or fallback was selected.", 409); }
  if (!Array.isArray(inspected) || inspected.length !== 1 || !isRecord(inspected[0]) || !isRecord(inspected[0].index) ||
    inspected[0].index.digest !== config.image.slice(config.image.lastIndexOf("@") + 1)) stopped("The installed workload does not match its exact immutable image digest.");
  return config;
}
interface NativeContainer { id: string; status: string }
async function nativeContainers(spec: NativeLaunch, cwd: string): Promise<NativeContainer[]> {
  const output = await runProgram("container", ["ls", "--all", "--format", "json"], { cwd, signal: AbortSignal.timeout(10_000), env: sandboxHostEnvironment(), label: "Owned native guest inspection", timeoutMs: 10_000, maxBytes: 1024 * 1024 });
  const values: unknown = JSON.parse(output);
  if (!Array.isArray(values)) throw new MoguriError("sandbox_inventory", "Native guest inventory is invalid. No process/container ownership was inferred.", 409);
  return values.filter(isRecord).flatMap((value) => {
    const configuration = isRecord(value.configuration) ? value.configuration : null;
    if (!configuration || typeof configuration.id !== "string" || !configuration.id.startsWith(`${spec.launchName}-`)) return [];
    const process = isRecord(configuration.initProcess) ? configuration.initProcess : null;
    const image = isRecord(configuration.image) ? configuration.image : null, descriptor = image && isRecord(image.descriptor) ? image.descriptor : null;
    const mounts = Array.isArray(configuration.mounts) ? configuration.mounts.filter(isRecord) : [];
    if (process?.executable !== "/opt/sendbox/bin/sendbox-guest" || !mounts.some((mount) => mount.source === spec.stage.workspace) ||
      image?.reference !== spec.config.image || descriptor?.digest !== spec.config.image?.slice(spec.config.image.lastIndexOf("@") + 1) ||
      typeof value.status !== "string") return stopped("A matching native name has a different executable, immutable image or exact mounted workspace.");
    return [{ id: configuration.id, status: value.status }];
  });
}
export class SandboxRuntime {
  readiness = absent();
  private signature: string;
  private closed = false;
  private probing = false;
  private probeDone?: Promise<void>;
  private active = new Map<string, NativeWorker>();
  private readonly vault: SecretVault;
  constructor(readonly stateDir: string, private readonly configuration: () => SandboxConfiguration, private readonly options: SandboxOptions = {}) {
    this.signature = frameDigest(configuration()); this.vault = options.vault ?? new McpKeychain("dev.moguri.profile.default.sandbox-runs");
  }
  synchronize(): void {
    const next = frameDigest(this.configuration());
    if (next !== this.signature) { this.signature = next; this.readiness = absent(); this.options.changed?.(); }
  }
  configured(): QualifiedSandboxConfiguration { return sandboxConfiguration(this.configuration()); }
  get busy(): boolean { return this.probing || this.active.size > 0; }
  assertReady(): QualifiedSandboxConfiguration {
    const config = this.configured();
    if (!this.readiness.ready || this.readiness.configDigest !== frameDigest(config)) throw new MoguriError("sandbox_unready", this.readiness.diagnostic, 409);
    return config;
  }
  workerArgv(): string[] { return [...(this.options.command ?? ["/usr/local/bin/node", "/opt/moguri/dist/remote-bridge.mjs", "--foreground"])]; }
  async probe(profileId: string, id: string = randomUUID(), requested?: AbortSignal): Promise<SandboxReadiness> {
    if (this.closed) throw new MoguriError("sandbox_closed", "Native execution is closing. No VM was launched.", 409);
    if (this.active.size || this.probing) throw new MoguriError("sandbox_busy", "Stop/wait for owned native execution or qualification before a new probe. No guest was launched.", 409);
    this.probing = true;
    let resolveProbe!: () => void;
    this.probeDone = new Promise<void>((resolve) => { resolveProbe = resolve; });
    let worker: NativeWorker | undefined;
    const abort = () => worker?.kill("SIGTERM");
    requested?.addEventListener("abort", abort, { once: true });
    this.readiness = { ...absent(), configured: true, diagnostic: "Explicit native qualification is in progress. No new turn is admitted until its exact guest and cleanup are verified." };
    try {
      requested?.throwIfAborted();
      this.options.changed?.();
      const signal = requested ? AbortSignal.any([requested, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
      const config = await verifySandboxArtifacts(this.configuration(), this.stateDir, signal), signature = frameDigest(config);
      const inputs = join(this.stateDir, "native-inputs", id), parent = join(this.stateDir, "native-stage-root");
      await mkdir(inputs, { recursive: true, mode: 0o700 }); await mkdir(parent, { recursive: true, mode: 0o700 });
      const source = await captureNativeSource(await realpath(inputs), [], { denied: [], readOnly: [] }, AbortSignal.timeout(5000));
      const stage = await materializeNativeStage(await realpath(parent), { profileId, sessionId: id, turnId: id }, source, AbortSignal.timeout(5000));
      requested?.throwIfAborted();
      worker = this.open({ id, stage, config, root: null, providerProbe: !this.options.engineOnlyProbe?.() && config.qualification.allowCopilot,
        launchName: `mg-${id.replaceAll("-", "").slice(0, 20)}`,
        createdAfter: Math.floor(Date.now() / 1000) - 2, createdBefore: Math.ceil(Date.now() / 1000) + 120 }, () => {}, true);
      const info = await worker.verified, result = await worker.finished;
      requested?.throwIfAborted();
      if (!result.clean || result.exitCode !== 0 || result.failure || this.closed || signature !== frameDigest(this.configuration())) throw new MoguriError("sandbox_probe", result.failure ?? "Native qualification did not finish under the exact current review with verified guest absence. No readiness was claimed.", 409);
      this.readiness = { ready: true, configured: true, configDigest: signature, release: config.qualification.release, workerDigest: info.workerDigest, image: config.image,
        diagnostic: `Verified pinned SendBox ${config.qualification.release} guest/worker and owned VM cleanup. Private workspace and selected-provider admission remain policy-bound.` };
      return this.readiness;
    } catch (error) {
      this.readiness = { ...absent(), configured: true, diagnostic: error instanceof MoguriError ? error.message : "Native qualification failed; cleanup/readiness is unconfirmed. No Local fallback." };
      throw error;
    } finally {
      requested?.removeEventListener("abort", abort);
      if (worker) {
        worker.kill("SIGTERM");
        const ended = await worker.finished;
        if (!ended.clean) this.readiness = { ...absent(), configured: true, diagnostic: `${this.readiness.diagnostic} Original qualification ${id} guest cleanup remains unconfirmed. Inspect its exact retained private intent; no model readiness or retry was authorized.` };
      }
      this.probing = false; resolveProbe(); this.probeDone = undefined; this.options.changed?.();
    }
  }
  launch(execution: SandboxExecution, changed: (changes: NativeChange) => void | Promise<void>): NativeConnection {
    const config = this.assertReady();
    assertSandboxNetwork(execution, config);
    if (execution.workerDigest !== config.qualification.workerDigest || execution.image !== config.image ||
      execution.stage.sessionId !== execution.sessionId || execution.stage.profileId !== execution.profileId ||
      JSON.stringify(execution.command) !== JSON.stringify(this.workerArgv())) stopped("Native execution differs from its original profile/root/release review.");
    return this.open(execution, changed, false);
  }
  private open(spec: NativeLaunch, changed: (changes: NativeChange) => void | Promise<void>, probe: boolean): NativeWorker {
    if (this.closed || this.active.has(spec.id)) throw new MoguriError("sandbox_duplicate", "This exact native run is already active or the runtime is closed. No replay.", 409);
    const worker = new NativeWorker(this.stateDir, structuredClone(spec), this.workerArgv(), this.vault, changed, probe);
    worker.events.on("error", (error) => {
      if (!this.closed) { this.readiness = { ...absent(), configured: true, diagnostic: error.message }; this.options.changed?.(); }
    });
    this.active.set(spec.id, worker); worker.events.once("exit", () => this.active.delete(spec.id)); return worker;
  }
  owns(id: string): boolean { return this.active.has(id); }
  connection(id: string): NativeConnection {
    const worker = this.active.get(id);
    if (!worker) throw new MoguriError("sandbox_inactive", "The exact native connection is no longer active. No replacement was started.", 409);
    return worker;
  }
  async key(id: string): Promise<Buffer> {
    const value = await this.vault.read(id, AbortSignal.timeout(15_000));
    if (!value || !/^[a-f0-9]{64}$/.test(value)) throw new MoguriError("sandbox_key", "Restore/unlock the original profile-owned native transport key. No replacement key or replay was used.", 409);
    return Buffer.from(value, "hex");
  }
  async reconcile(execution: SandboxExecution): Promise<NativeChange> {
    if (this.active.has(execution.id)) throw new MoguriError("sandbox_active", "Stop/wait for this exact live owner before offline reconciliation.", 409);
    const guests = await nativeContainers(execution, this.stateDir);
    if (guests.length > 1) stopped("Native inspection found ambiguous owned guest identities.");
    const sid = execution.nativeSessionId ?? guests[0]?.id.slice(execution.launchName.length + 1);
    if (!sid) throw new MoguriError("sandbox_unconfirmed", "No original native SID was recorded and no exact owned guest can bind it. Cleanup remains unconfirmed; no ownership was inferred from a PID or name alone.", 409);
    const binding = await readNativeBoundary({ stateRoot: join(homedir(), ".sendbox", "run"), sessionId: sid,
      workspace: execution.stage.workspace, image: execution.image, command: { program: execution.command[0]!, arguments: execution.command.slice(1) },
      createdAfter: execution.createdAfter, createdBefore: execution.createdBefore });
    if (execution.planDigest !== null && execution.planDigest !== binding.planDigest ||
      execution.signerFingerprint !== null && execution.signerFingerprint !== binding.signerFingerprint ||
      guests.some((guest) => guest.id !== `${execution.launchName}-${sid}`)) stopped("Native inspection changed the original guest, plan or public signer.");
    for (const guest of guests) {
      if (guest.status === "running") await runProgram("container", ["stop", "--time", "5", guest.id], { cwd: this.stateDir, signal: AbortSignal.timeout(15_000), env: sandboxHostEnvironment(), label: "Explicit exact native guest stop", timeoutMs: 15_000 });
      await runProgram("container", ["delete", guest.id], { cwd: this.stateDir, signal: AbortSignal.timeout(15_000), env: sandboxHostEnvironment(), label: "Explicit exact native guest removal", timeoutMs: 15_000 });
    }
    if ((await nativeContainers(execution, this.stateDir)).length) throw new MoguriError("sandbox_cleanup", "The original verified native guest is still present. Cleanup remains unconfirmed.", 409);
    return { nativeSessionId: sid, planDigest: binding.planDigest, signerFingerprint: binding.signerFingerprint, cleanup: "owned-guest-stopped",
      status: execution.status === "completed" ? "completed" : "partial", cancellation: execution.cancellation === "none" && !guests.length ? "none" : "unconfirmed",
      diagnostic: "Original signed native owner was inspected and exact guest absence verified. No VM/model/effect was replayed and no partial turn was upgraded." };
  }
  async close(): Promise<void> {
    this.closed = true;
    const active = [...this.active.values()];
    const probe = this.probeDone;
    for (const worker of active) worker.kill("SIGTERM");
    await Promise.all(active.map((worker) => worker.finished));
    await probe;
  }
}
class NativeWorker implements NativeConnection {
  readonly events = new EventEmitter<WorkerConnectionEvents>();
  private resolveVerified!: (value: BridgeInfo) => void;
  private rejectVerified!: (error: Error) => void;
  readonly verified = new Promise<BridgeInfo>((resolve, reject) => { this.resolveVerified = resolve; this.rejectVerified = reject; });
  private resolveFinished!: (value: NativeResult) => void;
  readonly finished = new Promise<NativeResult>((resolve) => { this.resolveFinished = resolve; });
  private terminal?: pty.IPty;
  private wire?: JsonLineChannel;
  private privateControl?: PrivateControl;
  private ready = false;
  private connectedValue = true;
  private ended = false;
  private launchAttempted = false;
  private stopping = false;
  private queue = Promise.resolve();
  private status: BridgeStatus | null = null;
  private binding: Awaited<ReturnType<typeof readNativeBoundary>> | undefined;
  private pending: Array<{ message: ParentMessage; callback?: (error: Error | null) => void }> = [];
  private queries = new Map<string, { resolve(value: Extract<import("./remote-protocol.ts").BridgeEnvelope, { kind: "query-result" }>["result"]): void; reject(error: Error): void }>();
  private deadline?: ReturnType<typeof setTimeout>;
  private escalation?: ReturnType<typeof setTimeout>;
  private forcedStop?: ReturnType<typeof setTimeout>;
  private failure?: Error;
  get connected() { return this.connectedValue; }
  constructor(private readonly stateDir: string, private readonly spec: NativeLaunch, private readonly command: string[], private readonly vault: SecretVault,
    private readonly changed: (changes: NativeChange) => void | Promise<void>, private readonly probe: boolean) {
    void this.verified.catch(() => {});
    queueMicrotask(() => { void this.boot().catch((error: unknown) => this.fail(error instanceof Error ? error : new Error("Native launch failed."))); });
  }
  private async boot(): Promise<void> {
    const config = await verifySandboxArtifacts(this.spec.config, this.stateDir, AbortSignal.timeout(20_000));
    await inspectNativeStage(this.spec.stage);
    if (this.stopping) throw new MoguriError("sandbox_stopped", "Native start was stopped before launch.", 409);
    const directory = join(this.stateDir, "native-executions", this.spec.id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, "intent.json"), JSON.stringify({ format: "moguri-native-intent", version: 1, id: this.spec.id, probe: this.probe,
      stage: this.spec.stage, config, configDigest: frameDigest(config), launchName: this.spec.launchName, providerProbe: Boolean(this.spec.providerProbe),
      createdAfter: this.spec.createdAfter, createdBefore: this.spec.createdBefore, command: this.command }), { flag: "wx", mode: 0o600 });
    const key = randomBytes(32).toString("hex");
    if (!this.probe) await this.vault.write(this.spec.id, key, AbortSignal.timeout(15_000));
    if (this.stopping) throw new MoguriError("sandbox_stopped", "Native start was stopped before the guest launch.", 409);
    const policy = join(directory, "sendbox.json");
    await writeFile(policy, JSON.stringify(sandboxRunConfiguration(config, this.spec.launchName, this.spec.stage.workspace, this.command)), { flag: "wx", mode: 0o600 });
    await runProgram(config.executable, ["policy", "validate", "--config", policy], { cwd: directory, signal: AbortSignal.timeout(5000), env: sandboxHostEnvironment(), label: "Exact native policy", timeoutMs: 5000, maxBytes: 16 * 1024 });
    if (this.stopping) throw new MoguriError("sandbox_stopped", "Native policy validation ended after stop; no guest was launched.", 409);
    const args = ["run", "--interactive", "--runtime", "apple", "--config", policy, "--image", config.image, "--bundle", config.bundlePath,
      "--trust-root", config.trustRootPath, "--trust-root-id", config.qualification.trustRootId, "--minimum-release-sequence", String(config.qualification.minimumReleaseSequence), "--", ...this.command];
    const input = new PassThrough(), output = new PassThrough(), wire = new JsonLineChannel(input, output, true);
    this.wire = wire;
    this.launchAttempted = true;
    const terminal = pty.spawn(config.executable, args, { cwd: directory, env: { ...sandboxHostEnvironment(), TERM: "xterm-256color" }, cols: 100, rows: 32 });
    this.terminal = terminal;
    terminal.onData((data) => input.write(data)); output.on("data", (data: Buffer) => terminal.write(data.toString()));
    wire.on("error", (error) => this.fail(error));
    let diagnostics = 0, initialized = false;
    wire.on("diagnostic", (text) => { diagnostics += Buffer.byteLength(text); if (diagnostics > 64 * 1024) this.fail(new Error("Native diagnostic output exceeded its bound.")); });
    wire.on("message", (raw) => {
      this.queue = this.queue.then(async () => {
        const packet = this.privateControl ? this.privateControl.decode(raw) : raw;
        if (isRecord(packet) && packet.kind === "bootstrap") {
          if (initialized || this.stopping) throw new MoguriError("sandbox_bootstrap", "Native bootstrap is duplicate or stopped. No access was sent.", 409);
          initialized = true;
          await verifyNativeBootstrap(packet, async () => {
            const guests = await nativeContainers(this.spec, directory);
            if (guests.length !== 1 || guests[0]!.status !== "running") stopped("Native bootstrap did not bind exactly one owned running guest.");
            const sid = guests[0]!.id.slice(this.spec.launchName.length + 1);
            if (!/^[a-f0-9]{32}$/.test(sid)) stopped("Native guest session identity is invalid.");
            this.binding = await readNativeBoundary({ stateRoot: join(homedir(), ".sendbox", "run"), sessionId: sid, workspace: this.spec.stage.workspace,
              image: config.image, command: { program: this.command[0]!, arguments: this.command.slice(1) },
              createdAfter: this.spec.createdAfter, createdBefore: this.spec.createdBefore });
            await this.changed({ nativeSessionId: sid, planDigest: this.binding.planDigest, signerFingerprint: this.binding.signerFingerprint });
            await writeFile(join(directory, "bootstrap-owner.json"), JSON.stringify({ id: this.spec.id, observedProtocol: packet.protocol,
              nativeSessionId: sid, planDigest: this.binding.planDigest, signerFingerprint: this.binding.signerFingerprint }), { flag: "wx", mode: 0o600 });
          });
          if (this.stopping || this.ended) throw new MoguriError("sandbox_stopped", "Native verification ended after stop. No worker start or model access was sent.", 409);
          if (!this.probe) this.privateControl = new PrivateControl(this.spec.id, Buffer.from(key, "hex"), "controller");
          wire.send({ action: this.probe ? "probe" : "start", protocol: PROTOCOL_VERSION, workerDigest: config.qualification.workerDigest,
            stateDir: `/workspace/.moguri/execution/${this.spec.id}`, root: this.spec.root,
            ...(this.spec.repositories ? { nativeRepositories: this.spec.repositories.map((entry) => ({ projectId: entry.projectId, name: entry.name, root: entry.guestRoot })) } : {}),
            ...(this.probe ? this.spec.providerProbe ? { nativeNetworkProbe: true } : {} :
              { runId: this.spec.id, key, after: 0, journal: true, sealed: true }) });
          return;
        }
        const message = parse(BridgeEnvelopeSchema, packet);
        if (message.kind === "probe" || message.kind === "ready") {
          const info = message.info, native = info.native;
          if (!this.binding || info.platform !== "linux" || info.nodeVersion !== "26.12.0" || info.workerDigest !== config.qualification.workerDigest || info.root !== this.spec.root ||
            !native || native.bridgeDigest !== config.qualification.bridgeDigest || native.uid === 0 || native.noNewPrivs !== 1 || native.seccomp !== 2 ||
            !/^0+$/.test(native.capabilities) || !native.enforcedProxy || message.kind === "ready" && message.status.runId !== this.spec.id ||
            this.probe && this.spec.providerProbe && (!native.networkProbe || native.networkProbe.url !== "https://api.githubcopilot.com" || native.networkProbe.status >= 500)) stopped("Actual guest runtime/build/process controls or explicitly reviewed cold provider networking differ from the exact native review.");
          if (JSON.stringify(native?.repositories) !== JSON.stringify(this.spec.repositories?.map((entry) => ({ projectId: entry.projectId, name: entry.name, root: entry.guestRoot })))) {
            stopped("Actual native repository roots differ from the exact captured group mapping. No first/default root or model credential was admitted.");
          }
          clearTimeout(this.deadline);
          this.ready = true; this.resolveVerified(info);
          if (message.kind === "ready") { this.status = message.status; await this.changed({ status: "running", workerPid: message.status.workerPid }); }
          for (const pending of this.pending.splice(0)) this.send(pending.message, pending.callback);
          return;
        }
        if (message.kind === "status") {
          if (message.status.runId !== this.spec.id) stopped("Native status belongs to another run.");
          this.status = message.status; return;
        }
        if (message.kind === "frame") {
          if (!this.ready || message.digest !== frameDigest(message.request)) stopped("Native worker frame identity/digest is not verified.");
          this.events.emit("message", message.request, { executionId: this.spec.id, sequence: message.sequence, digest: message.digest, env: "Sandbox" });
        } else if (message.kind === "query-result") {
          if (message.runId !== this.spec.id) stopped("Native query response belongs to a different run.");
          const pending = this.queries.get(message.requestId); this.queries.delete(message.requestId); pending?.resolve(message.result);
        } else if (message.kind === "query-error") {
          const pending = this.queries.get(message.requestId); this.queries.delete(message.requestId); pending?.reject(new MoguriError(message.code, message.message, 409));
        } else if (message.kind === "error") throw new MoguriError(message.code ?? "sandbox_worker", message.message, 409);
        else if (message.kind === "stderr") this.events.emit("stderr", message.text);
      }).catch((error: unknown) => this.fail(error instanceof Error ? error : new Error("Native framing failed.")));
    });
    this.deadline = setTimeout(() => this.fail(new MoguriError("sandbox_timeout", "Pinned native guest/worker did not become ready within 60 seconds. No fallback or replay.", 409)), 60_000);
    terminal.onExit((value) => { this.ended = true; void this.settle(value.exitCode); });
  }
  private fail(error: Error): void {
    if (!this.failure) { this.failure = error; this.rejectVerified(error); this.events.emit("error", error); }
    this.kill("SIGTERM");
    if (!this.terminal && !this.ended) { this.ended = true; void this.settle(1); }
  }
  send(message: ParentMessage, callback?: (error: Error | null) => void): void {
    if (message.kind === "stop") { this.kill("SIGTERM"); callback?.(null); return; }
    if (!this.connectedValue || this.stopping && message.kind !== "reply" && message.kind !== "control-lost") { callback?.(new Error("Owned native worker is disconnected or stopping.")); return; }
    if (!this.ready) { this.pending.push({ message, callback }); return; }
    this.sendPacket({ kind: "parent", message }, callback);
  }
  private sendPacket(value: unknown, callback?: (error: Error | null) => void): void {
    this.wire?.send(this.privateControl ? this.privateControl.encode(value) : value, callback);
  }
  acknowledge(sequence: number): void { this.sendPacket({ kind: "ack", sequence }); }
  async query(query: ForegroundQuery["query"], signal: AbortSignal) {
    signal.throwIfAborted(); if (!this.ready) await this.verified; signal.throwIfAborted();
    if (this.ended || this.stopping) throw new MoguriError("sandbox_inactive", "The exact native worker cannot serve another query. No host query or fallback was used.", 409);
    const id = randomUUID();
    return new Promise<Extract<import("./remote-protocol.ts").BridgeEnvelope, { kind: "query-result" }>["result"]>((resolve, reject) => {
      const stopped = () => { this.queries.delete(id); finish(); reject(new MoguriError("sandbox_query_stopped", "Native query stopped or exceeded its deadline. No fallback.", 409)); };
      const timer = setTimeout(stopped, 15_000);
      signal.addEventListener("abort", stopped, { once: true });
      const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", stopped); };
      this.queries.set(id, { resolve: (value) => { finish(); resolve(value); }, reject: (error) => { finish(); reject(error); } });
      this.sendPacket({ kind: "query", requestId: id, query }, (error) => { if (error) { this.queries.delete(id); finish(); reject(error); } });
    });
  }
  kill(signal: NodeJS.Signals): void {
    if (this.ended) return;
    this.stopping = true;
    if (this.ready) this.sendPacket({ kind: "parent", message: { kind: "stop" } });
    if (signal === "SIGKILL") this.terminal?.kill("SIGKILL");
    else this.escalation ??= setTimeout(() => {
      if (this.ended) return;
      this.terminal?.kill("SIGTERM");
      this.forcedStop = setTimeout(() => { if (!this.ended) this.terminal?.kill("SIGKILL"); }, 1000);
    }, 7000);
  }
  private async settle(exitCode: number): Promise<void> {
    clearTimeout(this.deadline); clearTimeout(this.escalation); clearTimeout(this.forcedStop);
    await this.queue;
    let clean = !this.launchAttempted;
    try {
      for (const guest of this.launchAttempted ? await nativeContainers(this.spec, this.stateDir) : []) {
        const sid = guest.id.slice(this.spec.launchName.length + 1);
        if (this.binding && guest.id !== `${this.spec.launchName}-${this.binding.sessionId}`) stopped("Native cleanup encountered another session identity.");
        const binding = await readNativeBoundary({ stateRoot: join(homedir(), ".sendbox", "run"), sessionId: sid,
          workspace: this.spec.stage.workspace, image: this.spec.config.image!,
          command: { program: this.command[0]!, arguments: this.command.slice(1) }, createdAfter: this.spec.createdAfter, createdBefore: this.spec.createdBefore });
        if (this.binding && (binding.planDigest !== this.binding.planDigest || binding.signerFingerprint !== this.binding.signerFingerprint)) stopped("The exact native cleanup plan or signer changed.");
        if (!this.binding) {
          this.binding = binding;
          await this.changed({ nativeSessionId: sid, planDigest: binding.planDigest, signerFingerprint: binding.signerFingerprint });
        }
        if (guest.status === "running") await runProgram("container", ["stop", "--time", "5", guest.id], { cwd: this.stateDir, signal: AbortSignal.timeout(15_000), env: sandboxHostEnvironment(), label: "Owned native VM stop", timeoutMs: 15_000 });
        await runProgram("container", ["delete", guest.id], { cwd: this.stateDir, signal: AbortSignal.timeout(15_000), env: sandboxHostEnvironment(), label: "Owned native VM removal", timeoutMs: 15_000 });
      }
      if (this.launchAttempted) clean = Boolean(this.binding) && (await nativeContainers(this.spec, this.stateDir)).length === 0;
      if (!clean) throw new MoguriError("sandbox_cleanup", "The exact owned native guest is still present. Cleanup remains unconfirmed.", 409);
    } catch (error) { this.failure ??= error instanceof Error ? error : new Error("Native cleanup is unconfirmed."); }
    this.connectedValue = false;
    for (const pending of this.queries.values()) pending.reject(new MoguriError("sandbox_disconnected", "Native control ended before this query completed. No fallback.", 409));
    this.queries.clear();
    const status = this.status;
    if (!this.probe && (!status || status.cleanup !== "owned-worker-stopped" ||
      !["completed", "stopped", "failed", "partial"].includes(status.status) ||
      exitCode !== (status.status === "completed" ? 0 : status.status === "stopped" ? 130 : status.status === "partial" ? 2 : 1))) {
      this.failure ??= new MoguriError("sandbox_terminal", "Native CLI exit, acknowledged worker outcome and cleanup do not agree. Retained work remains partial; no success was inferred.", 409);
    }
    try {
      await this.changed({ cliExitCode: exitCode, workerPid: status?.workerPid ?? null,
        status: this.failure || !status && !this.probe ? "partial" : status?.status ?? (exitCode === 0 ? "completed" : "failed"),
        cancellation: status?.cancellation ?? (this.stopping ? "unconfirmed" : "none"), cleanup: clean ? "owned-guest-stopped" : "unconfirmed",
        diagnostic: this.failure?.message ?? status?.diagnostic ?? null });
    } catch (error) {
      this.failure ??= error instanceof Error ? error : new Error("Native outcome persistence is unconfirmed.");
      this.events.emit("error", this.failure);
    }
    if (!this.ready) this.rejectVerified(this.failure ?? new MoguriError("sandbox_launch", "Native workload ended before identity verification. No model access or fallback was authorized.", 409));
    this.wire?.end();
    this.resolveFinished({ exitCode, clean, status, failure: this.failure?.message ?? null });
    this.events.emit("exit", exitCode, null);
  }
}
