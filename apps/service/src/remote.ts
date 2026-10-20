import { EventEmitter } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, lstat, readFile, writeFile, realpath } from "node:fs/promises";
import { isIP } from "node:net";
import { isAbsolute, join } from "node:path";
import { Value } from "typebox/value";
import { isRecord, MoguriError, PROTOCOL_VERSION, type ProjectSettings, type RemoteTarget, type RemoteIdentity, type RemoteReadiness, type RemoteExecution, type Snapshot } from "../../../packages/protocol/src/index.ts";
import { McpKeychain, type SecretVault } from "./gateway.ts";
import { validateLocalEndpoints } from "./model-registry.ts";
import { BridgeEnvelopeSchema, type BridgeEnvelope, type BridgeInit, type BridgeStatus, type WorkspaceReadRequest, type WorkspaceReadResult } from "./remote-protocol.ts";
import { frameDigest, JsonLineChannel } from "./worker-wire.ts";
import type { ParentMessage } from "./worker-protocol.ts";
import type { WorkerConnection, WorkerConnectionEvents } from "./worker-connection.ts";
import type { PreparedModel } from "./provider.ts";

export function validateRemoteTarget(target: RemoteTarget | null): void {
  if (!target) return;
  if ((!isIP(target.host) && !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,251}[a-zA-Z0-9]$|^[a-zA-Z0-9]$/.test(target.host)) ||
    !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(target.user)) throw new MoguriError("remote_identity", "Use an explicit IP/DNS SSH host and login name, without shell syntax or SSH aliases.");
  if (!/^(ssh-ed25519|ecdsa-sha2-nistp(?:256|384|521)|ssh-rsa) [a-zA-Z0-9+/]+={0,2}$/.test(target.hostKey)) throw new MoguriError("remote_host_key", "Pin one complete SSH public host key (type and base64), not a fingerprint, private key or trust-on-first-use setting.");
  if (!isAbsolute(target.identityFile) || !target.stateDir.startsWith("/") ||
    [target.identityFile, target.stateDir, ...target.command].some((value) => /[\0\r\n]/.test(value))) throw new MoguriError("remote_path", "Select an absolute SSH identity/private remote state directory and explicit worker argv without control characters.");
  validateLocalEndpoints(target.models);
}
export const remoteFingerprint = (target: RemoteIdentity) => `SHA256:${createHash("sha256").update(Buffer.from(target.hostKey.split(" ")[1]!, "base64")).digest("base64").replace(/=+$/, "")}`;
export const remoteRootLease = (target: Pick<RemoteIdentity, "hostKey">, root: string | null): string | null => root === null ? null : `remote/${frameDigest({ hostKey: target.hostKey, root })}`;
export function remoteRootQuarantined(snapshot: Pick<Snapshot, "executions" | "blockedSessions" | "blockedProjects">, root: string): boolean {
  return snapshot.executions.some((execution) => remoteRootLease(execution.target, execution.workspace) === root &&
    (snapshot.blockedSessions.includes(execution.sessionId) || execution.projectId !== null && snapshot.blockedProjects.includes(execution.projectId)));
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const absentReadiness = (): RemoteReadiness => ({ ready: false, diagnostic: "Configure an explicit SSH target, pinned host key, identity and compatible Moguri worker, then probe. SSH is not SendBox isolation; no Local fallback.", configDigest: null, hostFingerprint: null, nodeVersion: null, platform: null, workerDigest: null });
interface SshConnection { child: ChildProcessWithoutNullStreams; wire: JsonLineChannel; diagnostic(): string }
export interface RemoteOptions { vault?: SecretVault; changed?: () => void }
export class RemoteRuntime {
  readiness = absentReadiness();
  private readonly vault: SecretVault;
  private signature: string;
  private probeAbort?: AbortController;
  private probes = new Set<Promise<unknown>>();
  private queries = new Map<AbortController, Promise<BridgeEnvelope>>();
  private active = new Set<RemoteWorker>();
  private closed = false;
  constructor(private readonly stateDir: string, private readonly target: () => RemoteTarget | null, private readonly workerPath: string, private readonly options: RemoteOptions = {}) {
    this.signature = frameDigest(target()); this.vault = options.vault ?? new McpKeychain("dev.moguri.profile.default.remote-runs");
  }
  synchronize(): void {
    const signature = frameDigest(this.target());
    if (signature !== this.signature) { this.signature = signature; this.probeAbort?.abort(); this.readiness = absentReadiness(); this.options.changed?.(); }
  }
  configured(): RemoteTarget {
    const target = this.target();
    if (!target) throw new MoguriError("remote_missing", "Configure an SSH target explicitly. No local machine or previous target was substituted.", 409);
    validateRemoteTarget(target); return structuredClone(target);
  }
  async workerDigest(): Promise<string> { return createHash("sha256").update(await readFile(this.workerPath)).digest("hex"); }
  private async connect(target: RemoteIdentity, signal: AbortSignal): Promise<SshConnection> {
    signal.throwIfAborted();
    const identity = await lstat(target.identityFile);
    if (!identity.isFile() || identity.isSymbolicLink() || identity.uid !== process.getuid?.() || identity.mode & 0o077) throw new MoguriError("ssh_identity", "The selected SSH private identity must be a user-owned non-symlink regular file with mode 0600 or stricter.", 409);
    const directory = join(await realpath(this.stateDir), "remote-hosts");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || metadata.mode & 0o077) throw new MoguriError("ssh_state", "The owned SSH pin directory is not private. Inspect its ownership/permissions; no ambient known_hosts fallback.", 409);
    const knownHosts = join(directory, `${frameDigest(target)}.known-hosts`);
    const key = `[${target.host}]:${target.port} ${target.hostKey}\n`;
    try { await writeFile(knownHosts, key, { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      const metadata = await lstat(knownHosts);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || metadata.mode & 0o077 || await readFile(knownHosts, "utf8") !== key) throw new MoguriError("ssh_pin", "The owned SSH pin file changed. Inspect it; verification was not disabled.", 409);
    }
    signal.throwIfAborted();
    const args = ["-T", "-F", "/dev/null", "-p", String(target.port), "-l", target.user, "-i", target.identityFile,
      "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none",
      "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile="${knownHosts.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
      "-o", "GlobalKnownHostsFile=/dev/null", "-o", "ForwardAgent=no", "-o", "ClearAllForwardings=yes",
      "-o", "ControlMaster=no", "-o", "PermitLocalCommand=no", "-o", "ProxyCommand=none", "-o", "ProxyJump=none",
      "-o", "PasswordAuthentication=no", "-o", "KbdInteractiveAuthentication=no", "-o", "ConnectTimeout=5",
      "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2",
      target.host, target.command.map(quote).join(" ")];
    const child = spawn("ssh", args, { stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    const wire = new JsonLineChannel(child.stdout, child.stdin); let stderr = "";
    child.stderr.on("data", (data: Buffer) => { stderr = (stderr + data.toString()).slice(-8192); });
    const abort = () => { child.kill("SIGTERM"); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.once("exit", () => signal.removeEventListener("abort", abort));
    return { child, wire, diagnostic: () => /REMOTE HOST IDENTIFICATION|Host key verification failed/.test(stderr) ? "SSH host-key verification failed. Verify the target's actual key; trust was not weakened." :
      /Permission denied/.test(stderr) ? "SSH public-key authentication failed. Check the explicitly selected identity and remote authorization." :
      /not found|No such file|ERR_MODULE_NOT_FOUND/.test(stderr) ? "SSH connected but the exact Moguri worker/runtime is missing. Install this build explicitly." :
      "SSH connection or remote worker ended without a confirmed outcome. Inspect the target; no operation was retried or run locally." };
  }
  async query(target: RemoteIdentity, init: BridgeInit, signal: AbortSignal): Promise<BridgeEnvelope> {
    if (this.closed) throw new MoguriError("remote_closed", "The Remote runtime is closing. No connection or fallback was started.", 409);
    const abort = new AbortController(), task = this.queryOnce(structuredClone(target), structuredClone(init), AbortSignal.any([signal, abort.signal]));
    this.queries.set(abort, task);
    try { return await task; } finally { this.queries.delete(abort); }
  }
  private async queryOnce(target: RemoteIdentity, init: BridgeInit, signal: AbortSignal): Promise<BridgeEnvelope> {
    const connection = await this.connect(target, signal);
    try {
      return await new Promise<BridgeEnvelope>((resolve, reject) => {
        const deadline = setTimeout(() => reject(new MoguriError("remote_timeout", "Remote qualification/query timed out. No fallback or duplicate worker was started.", 409)), 15_000);
        const settle = (value?: BridgeEnvelope, error?: Error) => { clearTimeout(deadline); if (error) reject(error); else if (value) resolve(value); };
        connection.child.once("error", () => settle(undefined, new MoguriError("ssh_start", "Could not start OpenSSH. Install its client explicitly.", 503)));
        connection.child.once("exit", () => settle(undefined, new MoguriError("ssh_connection", connection.diagnostic(), 409)));
        connection.wire.on("error", () => settle(undefined, new MoguriError("remote_protocol", "Remote control framing failed; no fallback or duplicate work.", 409)));
        connection.wire.on("message", (raw) => {
          if (!Value.Check(BridgeEnvelopeSchema, raw)) { settle(undefined, new MoguriError("remote_protocol", "Remote worker protocol/build is incompatible.", 409)); return; }
          if (raw.kind === "error") settle(undefined, new MoguriError(raw.code ?? "remote_bootstrap", raw.message, 409));
          else if (["probe", "catalog", "context", "workspace", "inspection"].includes(raw.kind)) settle(raw);
        });
        signal.throwIfAborted();
        connection.wire.send(init);
      });
    } finally { connection.wire.end(); connection.child.kill("SIGTERM"); }
  }
  async probe(): Promise<RemoteReadiness> {
    const target = this.configured(), signature = frameDigest(target), abort = new AbortController();
    this.probeAbort?.abort(); this.probeAbort = abort;
    const task = (async () => {
      try {
        const workerDigest = await this.workerDigest();
        const result = await this.query(target, { action: "probe", protocol: PROTOCOL_VERSION, stateDir: target.stateDir, root: null, workerDigest }, AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]));
        if (result.kind !== "probe") throw new MoguriError("remote_protocol", "Remote readiness returned the wrong response.", 409);
        if (this.closed || signature !== frameDigest(this.target()) || abort.signal.aborted) throw new MoguriError("remote_changed", "Remote configuration changed during qualification. Probe the current target.", 409);
        this.readiness = { ready: true, diagnostic: `Verified SSH host ${target.name}; ${result.info.platform}/Node ${result.info.nodeVersion}. Remote execution is not SendBox isolation.`, configDigest: signature, hostFingerprint: remoteFingerprint(target), nodeVersion: result.info.nodeVersion, platform: result.info.platform, workerDigest };
      } catch (error) {
        if (signature === frameDigest(this.target()) && !this.closed && !abort.signal.aborted) {
          this.readiness = { ...absentReadiness(), diagnostic: error instanceof MoguriError ? error.message : "Remote qualification failed. Check the pinned target, private identity and installed worker build; no Local fallback." };
          console.error("Remote qualification failed:", error instanceof MoguriError ? error.code : "remote_error");
        }
        throw error;
      } finally { this.options.changed?.(); }
      return this.readiness;
    })();
    this.probes.add(task);
    try { return await task; } finally { this.probes.delete(task); }
  }
  assertReady(): RemoteTarget {
    const target = this.configured();
    if (!this.readiness.ready || this.readiness.configDigest !== frameDigest(target)) throw new MoguriError("remote_unready", this.readiness.diagnostic, 409);
    return target;
  }
  async catalog(url: string, key: string | null, signal: AbortSignal, headers?: Record<string, string | null>): Promise<Response> {
    const target = this.assertReady(), workerDigest = this.readiness.workerDigest!;
    const result = await this.query(target, { action: "catalog", protocol: PROTOCOL_VERSION, workerDigest, root: null, stateDir: target.stateDir, catalog: { url, key, ...(headers ? { headers } : {}) } }, signal);
    if (result.kind !== "catalog") throw new MoguriError("remote_catalog", "Remote model discovery returned the wrong response.", 409);
    return new Response(Buffer.from(result.body, "base64"), { status: result.status });
  }
  async verifyCopilot(prepared: PreparedModel, signal: AbortSignal): Promise<void> {
    if (!this.assertReady().allowCopilot) throw new MoguriError("remote_copilot", "Explicitly approve scoped Copilot access on this SSH host.", 403);
    const response = await this.catalog(prepared.auth.baseUrl ?? prepared.model.baseUrl, prepared.auth.apiKey ?? null, signal, prepared.auth.headers);
    if (!response.ok) throw new MoguriError("remote_model_http", `The SSH host's model metadata request returned HTTP ${response.status}. No inference or Local fallback was attempted.`, 409);
    let value: unknown;
    try { value = await response.json(); }
    catch { throw new MoguriError("remote_model_catalog", "The SSH host's model endpoint returned invalid JSON metadata. No inference or fallback was attempted.", 409); }
    if (!isRecord(value) || !Array.isArray(value.data) || !value.data.some((model) => isRecord(model) && model.id === prepared.model.id)) throw new MoguriError("remote_model_catalog", "This selected model is not advertised from the SSH host. No inference or fallback was attempted.", 409);
  }
  async context(root: string, settings: ProjectSettings): Promise<string> {
    const target = this.assertReady();
    const result = await this.query(target, { action: "context", protocol: PROTOCOL_VERSION, workerDigest: this.readiness.workerDigest!, stateDir: target.stateDir, root, context: settings }, AbortSignal.timeout(15_000));
    if (result.kind !== "context" || result.info.root !== root) throw new MoguriError("remote_context", "Remote repository context did not match its approved workspace.", 409);
    return result.text;
  }
  async readWorkspace(root: string, requested: WorkspaceReadRequest, signal: AbortSignal): Promise<WorkspaceReadResult> {
    const target = this.assertReady(), request = structuredClone(requested), workerDigest = this.readiness.workerDigest!;
    const result = await this.query(target, { action: "workspace", protocol: PROTOCOL_VERSION, workerDigest, stateDir: target.stateDir, root, workspace: request }, signal);
    signal.throwIfAborted();
    if (this.closed || frameDigest(this.target()) !== frameDigest(target) || !this.readiness.ready) throw new MoguriError("remote_changed", "Remote configuration/readiness changed during the workspace read. No stale response or Local fallback was used.", 409);
    if (result.kind !== "workspace" || result.info.root !== root || result.info.workerDigest !== workerDigest || result.result.type !== request.query.type) throw new MoguriError("remote_workspace_read", "Remote workspace response did not match its approved root, build or requested operation.", 409);
    return result.result;
  }
  async forget(execution: RemoteExecution): Promise<void> {
    try { await this.vault.remove(execution.id, AbortSignal.timeout(15_000)); }
    catch { throw new MoguriError("remote_key_cleanup", "Remote transport-key cleanup was not confirmed. Local session records were preserved; unlock its secret backend and retry.", 503); }
  }
  launch(execution: RemoteExecution, changed: (status: BridgeStatus) => void): WorkerConnection {
    this.assertReady();
    const worker = new RemoteWorker(execution, this.vault, (signal) => this.connect(execution.target, signal), changed);
    worker.events.on("error", (error) => { if (!this.closed) { this.readiness = { ...absentReadiness(), diagnostic: error.message }; this.options.changed?.(); } });
    this.active.add(worker); worker.events.once("exit", () => this.active.delete(worker)); return worker;
  }
  owns(id: string): boolean { return [...this.active].some((worker) => worker.id === id); }
  async inspect(execution: RemoteExecution): Promise<Extract<BridgeEnvelope, { kind: "inspection" }>> {
    const key = await this.vault.read(execution.id, AbortSignal.timeout(15_000));
    if (!key) throw new MoguriError("remote_key_missing", "The remote execution's explicit transport key is unavailable. Unlock/restore its secret backend; cleanup is not assumed.", 409);
    const result = await this.query(execution.target, { action: "inspect", protocol: PROTOCOL_VERSION, workerDigest: execution.workerDigest, root: execution.workspace, stateDir: execution.target.stateDir, runId: execution.id, key, after: execution.lastSequence }, AbortSignal.timeout(15_000));
    if (result.kind !== "inspection") throw new MoguriError("remote_inspection", "The exact remote run could not be inspected. No replacement was started.", 409);
    return result;
  }
  async close(): Promise<void> {
    this.closed = true; this.probeAbort?.abort(); this.readiness = absentReadiness();
    const queries = [...this.queries.entries()];
    for (const [abort] of queries) abort.abort();
    const workers = [...this.active];
    for (const worker of workers) worker.kill("SIGTERM");
    await Promise.all(workers.map((worker) => worker.closed));
    await Promise.allSettled(queries.map(([, task]) => task));
    await Promise.allSettled(this.probes);
  }
}
class RemoteWorker implements WorkerConnection {
  readonly events = new EventEmitter<WorkerConnectionEvents>();
  readonly closed = new Promise<void>((resolve) => this.events.once("exit", () => resolve()));
  private channel?: SshConnection;
  private connectedValue = true;
  private pending: { message: ParentMessage; callback?: (error: Error | null) => void }[] = [];
  private readonly abort = new AbortController();
  private ready = false;
  get connected() { return this.connectedValue; }
  get id() { return this.execution.id; }
  constructor(private readonly execution: RemoteExecution, private readonly vault: SecretVault, connect: (signal: AbortSignal) => Promise<SshConnection>, private readonly changed: (status: BridgeStatus) => void) {
    queueMicrotask(() => { void this.boot(connect).catch((error: unknown) => {
      this.connectedValue = false;
      this.events.emit("error", error instanceof MoguriError ? error : new MoguriError("remote_launch", "Remote worker launch failed. Check the keychain, exact build and target; no Local fallback.", 409));
      this.events.emit("exit", null, null);
    }); });
  }
  private async boot(connect: (signal: AbortSignal) => Promise<SshConnection>) {
    const key = randomBytes(32).toString("hex");
    await this.vault.write(this.execution.id, key, AbortSignal.any([this.abort.signal, AbortSignal.timeout(15_000)]));
    this.abort.signal.throwIfAborted();
    const channel = await connect(this.abort.signal);
    this.channel = channel;
    const deadline = setTimeout(() => { this.events.emit("error", new MoguriError("remote_timeout", "The exact remote worker did not become ready in 15 seconds. Inspect the run before retrying.", 409)); this.kill("SIGTERM"); }, 15_000);
    channel.child.on("error", () => this.events.emit("error", new MoguriError("ssh_start", "OpenSSH could not launch the owned connection.", 503)));
    channel.wire.on("error", () => this.events.emit("error", new MoguriError("remote_protocol", "The owned SSH worker control channel failed. Cleanup is unconfirmed.", 409)));
    channel.child.once("exit", (code, signal) => { clearTimeout(deadline); this.connectedValue = false; this.events.emit("exit", code, signal); });
    channel.wire.once("close", () => channel.child.stdin.end());
    channel.wire.on("message", (raw) => {
      if (!Value.Check(BridgeEnvelopeSchema, raw)) { this.events.emit("error", new MoguriError("remote_protocol", "Invalid remote worker frame. No extra operation was admitted.", 409)); this.kill("SIGTERM"); return; }
      if (raw.kind === "error") { this.events.emit("error", new MoguriError(raw.code ?? "remote_bootstrap", raw.message, 409)); return; }
      if (raw.kind === "ready") {
        clearTimeout(deadline);
        if (raw.status.runId !== this.execution.id || raw.info.workerDigest !== this.execution.workerDigest || raw.info.root !== this.execution.workspace) { this.events.emit("error", new MoguriError("remote_identity", "Remote run/workspace identity changed.", 409)); this.kill("SIGTERM"); return; }
        this.ready = true;
        this.changed(raw.status);
        for (const value of this.pending.splice(0)) this.send(value.message, value.callback);
      } else if (raw.kind === "status") this.changed(raw.status);
      else if (raw.kind === "stderr") this.events.emit("stderr", raw.text);
      else if (raw.kind === "frame") {
        if (frameDigest(raw.request) !== raw.digest) { this.events.emit("error", new MoguriError("remote_frame", "Remote frame digest failed.", 409)); this.kill("SIGTERM"); return; }
        this.events.emit("message", raw.request, { executionId: this.execution.id, sequence: raw.sequence, digest: raw.digest });
      }
    });
    channel.wire.send({ action: "start", protocol: PROTOCOL_VERSION, workerDigest: this.execution.workerDigest, stateDir: this.execution.target.stateDir, root: this.execution.workspace, runId: this.execution.id, key, after: 0 });
  }
  send(message: ParentMessage, callback?: (error: Error | null) => void): void {
    if (!this.connectedValue) { callback?.(new Error("Owned SSH worker disconnected.")); return; }
    if (!this.channel || !this.ready) { this.pending.push({ message, callback }); return; }
    this.channel.wire.send({ kind: "parent", message }, callback);
  }
  acknowledge(sequence: number): void { this.channel?.wire.send({ kind: "ack", sequence }); }
  kill(signal: NodeJS.Signals): void { this.abort.abort(); this.channel?.child.kill(signal); }
}
