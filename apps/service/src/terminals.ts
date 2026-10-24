import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, realpath, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { terminalEnvironment, terminalShell } from "./terminal-shell.ts";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  MoguriError, parse, PreparedRemoteTerminalOwnerSchema, RemoteTerminalOwnerSchema, type Snapshot, type TerminalBinding, type TerminalInput, type TerminalOwner, type LocalTerminalOwner, type TerminalState, type RuntimeCloseOptions,
} from "../../../packages/protocol/src/index.ts";
import { McpKeychain, type SecretVault } from "./gateway.ts";
import { TerminalChannel } from "./terminal-channel.ts";
import { terminalOwnerScope, assertTerminalEndpoint } from "./terminal-identity.ts";
import {
  TerminalInspectSchema, TerminalOwnerInfoSchema, TerminalReadSchema, type TerminalLaunch, type TerminalOwnerInfo,
  type TerminalRead,
  type TerminalControlChannel,
} from "./terminal-protocol.ts";
import type { TerminalLaunchOptions } from "./terminal-engine.ts";
import { frameDigest } from "./worker-wire.ts";
import type { RemoteConsoles, RemoteConsoleAdmission } from "./remote-terminals.ts";

export interface TerminalOptions extends TerminalLaunchOptions { vault?: SecretVault; brokerPath?: string; defaultRoot?: string }
interface Host {
  snapshot(): Snapshot; changed(terminal: TerminalState): void; ownerChanged(owner: TerminalOwner): void;
  inputAllowed(terminal: TerminalState): void;
  remote?: RemoteConsoles;
}
interface Attached { channel: TerminalControlChannel; info: TerminalOwnerInfo; attachmentId: string }
export class TerminalManager {
  private readonly clientId = randomUUID();
  private readonly vault: SecretVault;
  private readonly brokerPath: string;
  private readonly attached = new Map<string, Attached>();
  private creating = new Map<string, Promise<TerminalOwner>>();
  private recovering = new Map<string, Promise<void>>();
  private closing = false;
  private readonly admissionAbort = new AbortController();
  private readonly admissions = new Set<Promise<TerminalState>>();
  constructor(private readonly host: Host, private readonly options: TerminalOptions = {}) {
    const profileId = host.snapshot().profileId;
    this.vault = options.vault ?? new McpKeychain(`dev.moguri.profile.${profileId}.terminal-owners`);
    this.brokerPath = options.brokerPath ?? fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./terminal-broker.ts" : "./terminal-broker.mjs", import.meta.url));
  }
  private snapshot() { return this.host.snapshot(); }
  private owner(id: string): TerminalOwner {
    const owner = this.snapshot().terminalOwners.find((owner) => owner.id === id);
    if (!owner || owner.profileId !== this.snapshot().profileId) throw new MoguriError("terminal_owner_missing", "Terminal owner is outside this profile. No alternate owner was used.", 404);
    return owner;
  }
  private terminal(id: string): TerminalState {
    const terminal = this.snapshot().terminals.find((terminal) => terminal.id === id);
    if (!terminal) throw new MoguriError("terminal_missing", "Terminal is outside this profile.", 404);
    return terminal;
  }
  private slot(owner: TerminalOwner) { return `terminal-owner-${owner.id}`; }
  private remote(): RemoteConsoles {
    if (!this.host.remote) throw new MoguriError("terminal_remote_unqualified", "Remote owner transport is unavailable. No Local endpoint, key or fallback was selected.", 409);
    return this.host.remote;
  }
  private lost(owner: TerminalOwner, diagnostic: string): void {
    const attached = this.attached.get(owner.id);
    if (attached) void Promise.resolve(attached.channel.detach()).catch(() => console.error("Terminal owner transport detach remains unconfirmed."));
    this.attached.delete(owner.id);
    this.host.ownerChanged({ ...this.owner(owner.id), status: "unconfirmed", updatedAt: new Date().toISOString(), diagnostic });
    for (const terminal of this.snapshot().terminals.filter((terminal) => terminal.ownerId === owner.id && !["closed", "failed", "acknowledged"].includes(terminal.status))) {
      this.host.changed({ ...terminal, status: "unconfirmed", diagnostic: `${diagnostic} Reconcile only the existing owner; no shell or input was replayed.` });
    }
  }
  private validate(state: TerminalState, actual: unknown): TerminalState {
    const result = parse(TerminalInspectSchema, actual);
    if (!state.binding || result.launchDigest !== state.launchDigest || result.terminal.id !== state.id || result.terminal.ownerId !== state.ownerId ||
      result.terminal.sessionId !== state.sessionId || result.terminal.projectId !== state.projectId || (result.terminal.workspaceId ?? null) !== (state.workspaceId ?? null) ||
      JSON.stringify(result.terminal.binding) !== JSON.stringify(state.binding) || result.terminal.env !== state.env || state.pid !== null && result.terminal.pid !== state.pid) {
      throw new MoguriError("terminal_receipt", "Terminal observation does not match its exact retained launch/root identity. Nothing was adopted.", 409);
    }
    return { ...state, pid: result.terminal.pid, cols: result.terminal.cols, rows: result.terminal.rows, status: result.terminal.status,
      diagnostic: result.terminal.diagnostic, attachmentId: state.ownerId ? this.attached.get(state.ownerId)?.attachmentId ?? state.attachmentId : state.attachmentId };
  }
  private async attach(owner: TerminalOwner): Promise<void> {
    if (owner.directory === null) throw new MoguriError("terminal_owner_preparing", "Remote owner preparation has no retained endpoint. No Local key/path or replacement was selected.", 409);
    const previous = this.attached.get(owner.id);
    let connected: { channel: TerminalControlChannel; info: TerminalOwnerInfo };
    if (previous) connected = { channel: previous.channel, info: await previous.channel.inspectOwner() };
    else {
      const key = await this.vault.read(this.slot(owner), AbortSignal.timeout(5000));
      if (!key) throw new MoguriError("terminal_key_missing", "The existing terminal owner key is missing. Restore its explicit secret backend or inspect its processes; no replacement was started.", 409);
      connected = owner.remote ? await this.remote().connect(parse(PreparedRemoteTerminalOwnerSchema, owner), key, this.clientId, (diagnostic) => this.lost(owner, diagnostic), AbortSignal.timeout(10_000)) :
        await TerminalChannel.connect(owner, key, this.clientId, (diagnostic) => this.lost(owner, diagnostic));
    }
    this.attached.set(owner.id, { ...connected, attachmentId: randomUUID() });
    const known = this.snapshot().terminals.filter((terminal) => terminal.ownerId === owner.id);
    const unknown = connected.info.terminalIds.filter((id) => !known.some((terminal) => terminal.id === id));
    if (unknown.length) {
      await connected.channel.detach(); this.attached.delete(owner.id);
      throw new MoguriError("terminal_orphans", "The authenticated owner reports terminals without retained user intent. Inspect that owner; nothing was adopted or replayed.", 409);
    }
    this.host.ownerChanged({ ...connected.info.owner, diagnostic: connected.info.owner.diagnostic });
    for (const terminal of known) {
      if (["closed", "failed", "acknowledged"].includes(terminal.status) && !connected.info.terminalIds.includes(terminal.id)) continue;
      if (!connected.info.terminalIds.includes(terminal.id)) {
        this.host.changed({ ...terminal, status: "unconfirmed", diagnostic: "This existing owner has no observed process for the retained intent. It was not launched again." }); continue;
      }
      const actual = await connected.channel.request({ action: "inspect", terminalId: terminal.id });
      this.host.changed(this.validate(terminal, actual));
    }
  }
  async recover(): Promise<void> {
    const legacy = this.snapshot().terminals.filter((terminal) => !terminal.ownerId && ["running", "stopping", "starting", "reattaching"].includes(terminal.status));
    for (const terminal of legacy) this.host.changed({ ...terminal, status: "unconfirmed", diagnostic: "Legacy terminal ownership cannot be authenticated. No shell/input was replayed; inspect its processes." });
    for (const owner of this.snapshot().terminalOwners.filter((owner) => !["stopped", "acknowledged"].includes(owner.status))) await this.reconcileOwner(owner.id);
  }
  reconcileOwner(id: string): Promise<void> {
    const existing = this.recovering.get(id); if (existing) return existing;
    const work = (async () => {
      const owner = this.owner(id);
      if (["stopped", "acknowledged"].includes(owner.status)) throw new MoguriError("terminal_owner_closed", "This owner is stopped or explicitly inspected. No replacement was started; use service stop for pending private cleanup.", 409);
      for (const terminal of this.snapshot().terminals.filter((terminal) => terminal.ownerId === id && !["closed", "failed", "acknowledged"].includes(terminal.status))) {
        this.host.changed({ ...terminal, status: "reattaching", diagnostic: "Inspecting the existing authenticated owner. No shell or input is being replayed." });
      }
      try { await this.attach(owner); }
      catch (error) { this.lost(owner, error instanceof MoguriError ? error.message : "Existing terminal control failed. Cleanup/input remain unconfirmed; no replay."); }
    })().finally(() => this.recovering.delete(id));
    this.recovering.set(id, work); return work;
  }
  async reconcile(id: string): Promise<TerminalState> {
    const terminal = this.terminal(id);
    if (!terminal.ownerId) throw new MoguriError("terminal_legacy", "This legacy terminal has no authenticated owner to inspect. No PID or replacement was adopted.", 409);
    const owner = this.owner(terminal.ownerId);
    if (["stopped", "acknowledged"].includes(owner.status)) throw new MoguriError("terminal_owner_closed", "This owner is already stopped or explicitly inspected. No shell was started; retry service stop for pending private-resource cleanup.", 409);
    await this.reconcileOwner(terminal.ownerId); return this.terminal(id);
  }
  private async createOwner(): Promise<TerminalOwner> {
    const buildDigest = createHash("sha256").update(await readFile(this.brokerPath)).digest("hex");
    const profileId = this.snapshot().profileId, id = randomUUID(), directory = await realpath(await mkdtemp(join(tmpdir(), "mo-")));
    const timestamp = new Date().toISOString();
    const scopeDigest = terminalOwnerScope({ id, profileId });
    let owner: LocalTerminalOwner = { id, profileId, protocol: 1, buildDigest, scopeDigest, directory, endpoint: join(directory, "control.sock"),
      pid: null, status: "starting", cleanup: "retained", createdAt: timestamp, updatedAt: timestamp, diagnostic: "User terminal owner admitted; no PTY has been started." };
    try { this.host.ownerChanged(owner); }
    catch (error) { await rmdir(directory); throw error; }
    const key = randomBytes(32).toString("base64");
    try {
      await this.vault.write(this.slot(owner), key, AbortSignal.any([this.admissionAbort.signal, AbortSignal.timeout(5000)]));
      this.admissionAbort.signal.throwIfAborted();
    }
    catch (error) {
      await this.cleanupStoppedOwner({ ...owner, status: "stopped", diagnostic: "Terminal secret storage failed before any broker or PTY launch.", updatedAt: new Date().toISOString() });
      throw new MoguriError("terminal_secret_store", "Terminal secret storage failed. No broker/shell was started; unlock the explicit secret backend.", 503);
    }
    let child: ChildProcess | undefined, connected: Awaited<ReturnType<typeof TerminalChannel.connect>> | undefined;
    let cleanupReadiness = () => {};
    try {
      this.admissionAbort.signal.throwIfAborted();
      const execArgv = this.brokerPath.endsWith(".ts") ? ["--import", createRequire(import.meta.url).resolve("tsx")] : [];
      child = fork(this.brokerPath, ["--moguri-terminal-owner", owner.id], { execArgv, detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: terminalEnvironment(directory) });
      child.on("error", () => console.error("The newly owned terminal broker reported a process startup/control failure."));
      if (!child.pid) throw new Error("Terminal broker process identity is missing.");
      const owned = child;
      owner = { ...owner, pid: child.pid, updatedAt: new Date().toISOString() };
      const ready = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new MoguriError("terminal_owner_timeout", "Terminal owner startup is unconfirmed. No PTY launch was dispatched.", 409)), 8000);
        const failed = (error: Error) => reject(error), exited = () => reject(new Error("Terminal owner exited before readiness."));
        const aborted = () => reject(this.admissionAbort.signal.reason);
        const message = (value: unknown) => {
          if (value !== null && typeof value === "object" && "kind" in value && value.kind === "terminal-owner-ready") resolve();
          else reject(new Error("Terminal owner rejected startup."));
        };
        owned.once("error", failed); owned.once("exit", exited); owned.once("message", message);
        this.admissionAbort.signal.addEventListener("abort", aborted, { once: true });
        cleanupReadiness = () => { clearTimeout(timer); owned.off("error", failed); owned.off("exit", exited); owned.off("message", message); this.admissionAbort.signal.removeEventListener("abort", aborted); };
      });
      void ready.catch((error: unknown) => console.error("Terminal owner readiness ended:", error instanceof MoguriError ? error.code : "terminal_startup"));
      this.host.ownerChanged(owner);
      child.send({ kind: "terminal-owner", owner, key }); await ready; cleanupReadiness();
      if (child.connected) child.disconnect();
      connected = await TerminalChannel.connect(owner, key, this.clientId, (diagnostic) => this.lost(owner, diagnostic), this.admissionAbort.signal);
      this.attached.set(id, { ...connected, attachmentId: randomUUID() }); this.host.ownerChanged(connected.info.owner); return connected.info.owner;
    } catch (error) {
      connected?.channel.retire(); connected?.channel.detach(); this.attached.delete(id);
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        const owned = child;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const exited = new Promise<void>((resolve) => owned.once("exit", () => resolve()));
        try { owned.kill("SIGTERM"); await Promise.race([exited, new Promise<void>((resolve) => { timer = setTimeout(resolve, 2000); })]); }
        finally { clearTimeout(timer); }
      }
      if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
        await this.cleanupStoppedOwner({ ...owner, status: "stopped", updatedAt: new Date().toISOString(), diagnostic: "The newly owned broker stopped before any PTY launch was dispatched." });
        throw new MoguriError("terminal_owner_failed", "Terminal owner startup failed before any shell was started. No input or launch was replayed.", 503);
      }
      this.host.ownerChanged({ ...owner, status: "unconfirmed", diagnostic: error instanceof MoguriError ? error.message : "Terminal owner startup/metadata is unconfirmed; no PTY launch was replayed.", updatedAt: new Date().toISOString() });
      throw new MoguriError("terminal_owner_unconfirmed", "Terminal owner startup is unconfirmed. Inspect/reconcile its retained identity before opening another shell.", 409);
    } finally {
      cleanupReadiness();
      if (child?.connected) child.disconnect();
      child?.unref();
    }
  }
  private async createRemoteOwner(admission: RemoteConsoleAdmission, recheck: () => void): Promise<TerminalOwner> {
    const profileId = this.snapshot().profileId, now = new Date().toISOString(), id = randomUUID();
    let owner = parse(RemoteTerminalOwnerSchema, { id, profileId, protocol: 1, env: "Remote", remote: admission.boundary, buildDigest: admission.boundary.brokerDigest,
      scopeDigest: "0".repeat(64), directory: null, endpoint: null, pid: null, status: "preparing", cleanup: "retained", createdAt: now, updatedAt: now,
      diagnostic: "Remote owner preparation intent retained before endpoint, broker or PTY admission." });
    owner = { ...owner, scopeDigest: terminalOwnerScope(owner) }; this.host.ownerChanged(owner);
    const key = randomBytes(32).toString("base64");
    let connected: { channel: TerminalControlChannel; info: TerminalOwnerInfo } | undefined, attempted = false;
    try {
      recheck(); owner = await this.remote().prepare(owner, this.admissionAbort.signal); this.host.ownerChanged(owner); recheck();
      await this.vault.write(this.slot(owner), key, AbortSignal.any([this.admissionAbort.signal, AbortSignal.timeout(5000)]));
      this.admissionAbort.signal.throwIfAborted(); recheck(); attempted = true;
      connected = await this.remote().connect(parse(PreparedRemoteTerminalOwnerSchema, owner), key, this.clientId, (diagnostic) => this.lost(owner, diagnostic), this.admissionAbort.signal, true);
      owner = parse(RemoteTerminalOwnerSchema, connected.info.owner); recheck(); this.host.ownerChanged(owner);
      this.attached.set(owner.id, { ...connected, attachmentId: randomUUID() }); return owner;
    } catch (error) {
      if (connected) {
        try {
          const stopped = parse(TerminalOwnerInfoSchema, await connected.channel.request({ action: "close-all" }));
          owner = parse(RemoteTerminalOwnerSchema, stopped.owner); this.host.ownerChanged(owner);
          connected.channel.retire(); await connected.channel.request({ action: "dispose" }); await connected.channel.detach(); attempted = false;
        } catch (cleanup) { console.error("New Remote terminal owner cleanup remains unconfirmed:", cleanup instanceof MoguriError ? cleanup.code : "terminal_remote_cleanup"); }
      }
      if (!attempted) {
        owner = parse(RemoteTerminalOwnerSchema, { ...owner, status: "stopped", updatedAt: new Date().toISOString(), diagnostic: "Remote owner stopped before any PTY admission; exact private cleanup is pending." });
        this.host.ownerChanged(owner); await this.cleanupStoppedOwner(owner);
        if (error instanceof MoguriError) throw error;
        throw new MoguriError("terminal_owner_failed", "Remote owner admission failed before any PTY. No broker, shell or input was replayed.", 409);
      }
      this.host.ownerChanged({ ...owner, status: "unconfirmed", updatedAt: new Date().toISOString(),
        diagnostic: error instanceof MoguriError ? error.message : "Remote broker start/receipt is unconfirmed. Restore its exact peer/key and reconcile; no replacement." });
      throw new MoguriError("terminal_owner_unconfirmed", "Remote owner start/receipt is unconfirmed. Its original key/metadata were retained; reconcile before another shell.", 409);
    }
  }
  private async cleanupStoppedOwner(owner: TerminalOwner): Promise<void> {
    if (owner.remote && !this.host.remote) throw new MoguriError("terminal_remote_unqualified", "Remote cleanup transport is unavailable. No Local key/path cleanup was attempted.", 409);
    if (owner.status !== "stopped") throw new MoguriError("terminal_unconfirmed", "Private terminal resources cannot be removed before owned groups are confirmed stopped.", 409);
    const pending: TerminalOwner = { ...owner, cleanup: "pending", updatedAt: new Date().toISOString() };
    this.host.ownerChanged(pending);
    try {
      if (await this.vault.read(this.slot(owner), AbortSignal.timeout(5000)) !== null) await this.vault.remove(this.slot(owner), AbortSignal.timeout(5000));
    } catch {
      this.host.ownerChanged({ ...pending, diagnostic: "Owned groups stopped, but explicit secret-backend cleanup is unconfirmed. Restore that backend and retry service stop." });
      throw new MoguriError("terminal_secret_cleanup", "Owned groups stopped; their private key cleanup failed. The writer lock and cleanup intent remain. Restore the explicit backend and retry stop.", 409);
    }
    if (pending.remote) {
      try { await this.remote().cleanup(parse(RemoteTerminalOwnerSchema, pending), AbortSignal.timeout(10_000)); }
      catch (error) {
        this.host.ownerChanged({ ...pending, diagnostic: error instanceof MoguriError ? error.message : "Exact Remote private cleanup remains unconfirmed; original metadata/intent were retained." });
        throw error;
      }
      this.host.ownerChanged({ ...pending, cleanup: "removed", updatedAt: new Date().toISOString() }); return;
    }
    try {
      await assertTerminalEndpoint(pending, false);
      try { await assertTerminalEndpoint(pending); await unlink(pending.endpoint); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
      await rmdir(pending.directory);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        this.host.ownerChanged({ ...pending, diagnostic: "Owned groups stopped, but private runtime-directory cleanup failed. No unrelated file was removed. Inspect the retained directory and retry stop." });
        throw new MoguriError("terminal_runtime_cleanup", "Owned groups stopped; their private runtime cleanup is incomplete. No unrelated files were recursively removed. Inspect the directory and retry stop.", 409);
      }
    }
    this.host.ownerChanged({ ...pending, cleanup: "removed", updatedAt: new Date().toISOString() });
  }
  private async readyOwner(admission: RemoteConsoleAdmission | undefined, recheck: () => void): Promise<TerminalOwner> {
    if (this.closing) throw new MoguriError("terminal_closing", "The terminal controller is closing; no new shell was admitted.", 409);
    const scope = admission ? `Remote:${admission.boundary.peerDigest}` : "Local", creating = this.creating.get(scope);
    if (creating) return creating;
    if (this.snapshot().terminalOwners.some((owner) => owner.status === "stopped" && owner.cleanup !== "removed")) throw new MoguriError("terminal_cleanup_pending", "A proven-stopped owner still has pending private-resource cleanup. Inspect its diagnostic and retry service stop before opening another owner.", 409);
    const owners = this.snapshot().terminalOwners.filter((owner) => !["stopped", "acknowledged"].includes(owner.status) &&
      (admission ? owner.remote?.peerDigest === admission.boundary.peerDigest : !owner.remote));
    if (owners.length > 1) throw new MoguriError("terminal_owner_conflict", "Multiple retained terminal owners need inspection. No owner was guessed or replaced.", 409);
    const current = owners[0];
    if (current) {
      if (admission && (current.remote?.bridgeDigest !== admission.boundary.bridgeDigest || current.remote.brokerDigest !== admission.boundary.brokerDigest)) throw new MoguriError("terminal_owner_build", "This peer already owns a retained console under a different exact helper build. No owner was replaced.", 409);
      if (current.status === "running" && this.attached.has(current.id)) return current;
      throw new MoguriError("terminal_owner_unconfirmed", "An existing terminal owner is pending/unconfirmed. Reconcile or inspect it; no replacement owner was started.", 409);
    }
    const work = (admission ? this.createRemoteOwner(admission, recheck) : this.createOwner()).finally(() => { this.creating.delete(scope); });
    this.creating.set(scope, work); return work;
  }
  open(binding: TerminalBinding, cols: number, rows: number, identity: { id: string; digest: string }, recheck: () => void,
    script?: { name: string; command: string }, remote?: RemoteConsoleAdmission): Promise<TerminalState> {
    const work = this.launchTerminal(binding, cols, rows, identity, recheck, script, remote);
    this.admissions.add(work);
    void work.then(() => this.admissions.delete(work), () => this.admissions.delete(work));
    return work;
  }
  private async launchTerminal(binding: TerminalBinding, cols: number, rows: number, identity: { id: string; digest: string }, recheck: () => void,
    script?: { name: string; command: string }, remote?: RemoteConsoleAdmission): Promise<TerminalState> {
    if (binding.env === "Remote" && (!remote || remote.boundary.peerDigest !== binding.peerDigest)) throw new MoguriError("terminal_remote_unqualified", "Remote PTY has no exact peer-bound admission. No Local broker or shell was created.", 409);
    if (binding.env === "Local" && remote) throw new MoguriError("terminal_env", "A Local terminal cannot borrow Remote owner authority.", 409);
    const duplicate = this.snapshot().terminals.find((terminal) => terminal.commandId === identity.id);
    if (duplicate) throw new MoguriError(duplicate.commandDigest === identity.digest ? "terminal_intent_exists" : "idempotency_conflict",
      "This original command already owns a terminal intent. Inspect its actual outcome; no shell was replayed.", 409);
    recheck(); const owner = await this.readyOwner(remote, recheck); recheck();
    if (this.closing) throw new MoguriError("terminal_closing", "Terminal admission was stopped before its PTY launch. No shell was replayed.", 409);
    const live = this.snapshot().terminals.filter((terminal) => !["closed", "failed", "acknowledged"].includes(terminal.status));
    if (live.length >= 16 || live.filter((terminal) => terminal.sessionId === binding.sessionId).length >= (binding.sessionId === null ? 1 : 4)) throw new MoguriError("terminal_limit", "Close or inspect existing terminals first: one global, four per session and sixteen per profile are supported.", 409);
    if (binding.sessionId === null && owner.buildDigest !== createHash("sha256").update(await readFile(this.brokerPath)).digest("hex")) throw new MoguriError("terminal_owner_upgrade", "The retained owner uses an earlier console build. Stop its known consoles explicitly before opening a global terminal; no owner was replaced.", 409);
    recheck();
    const id = randomUUID(), launch: TerminalLaunch = { executable: this.options.executable ?? (remote ? remote.launch.executable : terminalShell()),
      args: script ? ["-lc", script.command] : this.options.args ?? remote?.launch.args ?? ["-l"] };
    const title = script?.name ?? (binding.sessionId === null ? "Global terminal" : "Terminal");
    const intent: TerminalState = { id, sessionId: binding.sessionId, projectId: binding.projectId, workspaceId: binding.workspaceId,
      title, pid: null, cols, rows, status: "starting", diagnostic: "User terminal intent retained before the exact PTY launch.",
      env: binding.env, binding, ownerId: owner.id, commandId: identity.id, commandDigest: identity.digest,
      launchDigest: frameDigest([id, binding, launch, cols, rows, title]) };
    this.host.changed(intent);
    try {
      recheck();
      const result = await this.attached.get(owner.id)!.channel.request({ action: "open", intent, launch });
      const started = this.validate(intent, result); this.host.changed(started); recheck(); return started;
    } catch (error) {
      const knownFailure = error instanceof MoguriError && ["terminal_root", "terminal_root_changed", "terminal_limit", "terminal_intent", "terminal_idempotency", "terminal_owner_capacity"].includes(error.code);
      this.host.changed({ ...this.terminal(id), status: knownFailure ? "failed" : "unconfirmed",
        diagnostic: error instanceof MoguriError ? error.message : "PTY launch/result retention is unconfirmed. Inspect the existing owner; no launch was replayed." });
      throw error;
    }
  }
  async input(request: TerminalInput): Promise<void> {
    if (this.closing) throw new MoguriError("terminal_closing", "Terminal input is paused for controller shutdown/restart. Nothing was replayed.", 409);
    const terminal = this.terminal(request.terminalId);
    this.host.inputAllowed(terminal);
    if (terminal.status !== "running" || !terminal.ownerId || !terminal.binding) throw new MoguriError("terminal_unconfirmed", "Terminal is not attached/running with an exact user root. No input was replayed.", 409);
    const attached = this.attached.get(terminal.ownerId);
    if (!attached) throw new MoguriError("terminal_detached", "Reconcile the existing terminal owner before input. Nothing was replayed.", 409);
    const result = await attached.channel.request(request.action === "input" ?
      { action: "input", terminalId: terminal.id, bindingDigest: terminal.binding.digest, data: request.data } :
      { action: "resize", terminalId: terminal.id, bindingDigest: terminal.binding.digest, cols: request.cols, rows: request.rows });
    const observed = this.validate(terminal, result);
    if (request.action === "resize" && (observed.cols !== terminal.cols || observed.rows !== terminal.rows)) this.host.changed(observed);
    try { this.host.inputAllowed(terminal); }
    catch { throw new MoguriError("terminal_input_scope_changed", "Input/resize may already have been accepted in its original terminal, but current scope/policy changed. Nothing was resent.", 409); }
  }
  async read(id: string, offset: number, limit: number) {
    const terminal = this.terminal(id);
    if (!terminal.ownerId || !terminal.binding || !this.attached.has(terminal.ownerId)) {
      if (["closed", "failed", "acknowledged"].includes(terminal.status)) return { terminal: { ...terminal, diagnostic: "The volatile terminal buffer is no longer available; no transcript was persisted." }, data: "", baseOffset: 0, nextOffset: 0 };
      throw new MoguriError("terminal_unconfirmed", "Terminal owner is not attached. Inspect/reconcile its exact retained identity; no output or shell was fabricated.", 409);
    }
    let result: TerminalRead;
    try { result = parse(TerminalReadSchema, await this.attached.get(terminal.ownerId)!.channel.request({ action: "read", terminalId: id, bindingDigest: terminal.binding.digest, offset, limit })); }
    catch (error) {
      if (error instanceof MoguriError && error.code === "terminal_missing" && ["closed", "failed", "acknowledged"].includes(terminal.status)) return {
        terminal: { ...terminal, diagnostic: "This closed terminal's bounded volatile buffer expired. No transcript was persisted." }, data: "", baseOffset: 0, nextOffset: 0,
      };
      throw error;
    }
    const observed = this.validate(terminal, { terminal: result.terminal, launchDigest: terminal.launchDigest });
    if (observed.status !== terminal.status) this.host.changed(observed);
    return { ...result, terminal: observed };
  }
  async close(id: string): Promise<TerminalState> {
    let terminal = this.terminal(id);
    if (["closed", "failed", "acknowledged"].includes(terminal.status)) return terminal;
    if (!terminal.ownerId || !terminal.binding) throw new MoguriError("terminal_legacy", "Legacy terminal cleanup cannot be authenticated. Inspect its processes; no retained PID was blindly signalled.", 409);
    if (!this.attached.has(terminal.ownerId)) await this.reconcileOwner(terminal.ownerId);
    terminal = this.terminal(id);
    const attached = this.attached.get(terminal.ownerId!);
    if (!attached) throw new MoguriError("terminal_unconfirmed", "Existing terminal owner cleanup cannot be authenticated. Its key/metadata were retained.", 409);
    this.host.changed({ ...terminal, status: "stopping", diagnostic: "Stop requested for this exact authenticated user terminal." });
    const result = this.validate(terminal, await attached.channel.request({ action: "close", terminalId: id, bindingDigest: terminal.binding!.digest }));
    this.host.changed(result); return result;
  }
  async closeSession(id: string): Promise<void> {
    for (const terminal of this.snapshot().terminals.filter((terminal) => terminal.sessionId === id)) {
      const stopped = await this.close(terminal.id);
      if (stopped.status === "unconfirmed") throw new MoguriError("terminal_unconfirmed", stopped.diagnostic ?? "Terminal cleanup is unconfirmed.", 409);
      if (stopped.ownerId && stopped.binding && this.attached.has(stopped.ownerId)) {
        try { await this.attached.get(stopped.ownerId)!.channel.request({ action: "forget", terminalId: stopped.id, bindingDigest: stopped.binding.digest }); }
        catch (error) { if (!(error instanceof MoguriError && error.code === "terminal_missing")) throw error; }
      }
    }
  }
  acknowledge(id: string): void {
    const terminal = this.terminal(id);
    if (terminal.ownerId) {
      const owner = this.owner(terminal.ownerId);
      const others = this.snapshot().terminals.filter((entry) => entry.ownerId === owner.id && entry.id !== id && !["closed", "failed", "acknowledged"].includes(entry.status));
      if (!others.length && owner.status === "unconfirmed") this.host.ownerChanged({ ...owner, status: "acknowledged", updatedAt: new Date().toISOString(),
        diagnostic: "The user acknowledged inspection of all retained terminal processes. This does not prove historical cleanup." });
    }
  }
  acknowledgeOwner(id: string): TerminalOwner {
    const owner = this.owner(id);
    if (owner.status !== "unconfirmed" || this.attached.has(id)) throw new MoguriError("terminal_owner_state", "Only an unattached unconfirmed owner needs manual inspection acknowledgement. Inspect or stop its actual existing processes.", 409);
    if (this.snapshot().terminals.some((terminal) => terminal.ownerId === id && !["closed", "failed", "acknowledged"].includes(terminal.status))) {
      throw new MoguriError("terminal_owner_active", "Inspect and acknowledge each retained terminal first. Shared ownership cannot hide unconfirmed user processes.", 409);
    }
    return { ...owner, status: "acknowledged", updatedAt: new Date().toISOString(),
      diagnostic: "The user explicitly acknowledged this owner's process inspection. This is not proof of historical cleanup; its metadata and private capability remain retained." };
  }
  async closeAll(options: RuntimeCloseOptions = {}): Promise<void> {
    this.closing = true;
    this.admissionAbort.abort(new Error("Terminal controller shutdown requested."));
    const settled = await Promise.allSettled([...this.admissions]);
    for (const result of settled) if (result.status === "rejected") console.error("Terminal admission settled during shutdown:", result.reason instanceof MoguriError ? result.reason.code : "terminal_admission");
    if (options.preserveTerminals) {
      for (const [id, attached] of this.attached) {
        const current = await attached.channel.inspectOwner();
        this.host.ownerChanged(current.owner); await attached.channel.detach(); this.attached.delete(id);
      }
      return;
    }
    const active = this.snapshot().terminalOwners.filter((owner) => owner.status !== "acknowledged" && owner.cleanup !== "removed");
    for (const owner of active) {
      if (owner.remote && owner.directory === null) {
        const stopped = parse(RemoteTerminalOwnerSchema, { ...owner, status: "stopped", diagnostic: "Unprepared Remote owner never had broker authority. Exact resource cleanup requested." });
        this.host.ownerChanged(stopped); await this.cleanupStoppedOwner(stopped); continue;
      }
      if (owner.status === "stopped" && owner.cleanup === "pending") { await this.cleanupStoppedOwner(owner); continue; }
      if (!this.attached.has(owner.id)) {
        if (owner.status === "stopped") {
          try { await this.attach(owner); }
          catch (error) {
            if (!(error instanceof Error && "code" in error && ["ENOENT", "ECONNREFUSED"].includes(String(error.code)))) throw error;
            await this.cleanupStoppedOwner(owner); continue;
          }
        } else await this.reconcileOwner(owner.id);
      }
      const attached = this.attached.get(owner.id);
      if (!attached) throw new MoguriError("terminal_unconfirmed", "Terminal owner shutdown is unconfirmed; retained identity/key were not discarded.", 409);
      const stopped = parse(TerminalOwnerInfoSchema, await attached.channel.request({ action: "close-all" }));
      for (const terminal of this.snapshot().terminals.filter((terminal) => terminal.ownerId === owner.id)) {
        if (stopped.terminalIds.includes(terminal.id)) this.host.changed(this.validate(terminal, await attached.channel.request({ action: "inspect", terminalId: terminal.id })));
      }
      this.host.ownerChanged(stopped.owner);
      if (stopped.owner.status !== "stopped") throw new MoguriError("terminal_unconfirmed", stopped.owner.diagnostic ?? "Owned terminal cleanup is unconfirmed.", 409);
      attached.channel.retire();
      await attached.channel.request({ action: "dispose" }); await attached.channel.detach(); this.attached.delete(owner.id);
      await this.cleanupStoppedOwner(stopped.owner);
    }
  }
}
