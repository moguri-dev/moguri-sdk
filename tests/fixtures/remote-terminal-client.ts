import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import { isRecord, MoguriError, parse } from "../../packages/protocol/src/core.ts";
import { TerminalBindingSchema, PreparedTerminalOwnerSchema, type PreparedTerminalOwner, type TerminalState } from "../../packages/protocol/src/terminals.ts";
import type { RemoteTarget } from "../../packages/protocol/src/execution.ts";
import { remoteTerminalPeer, terminalOwnerScope } from "../../apps/service/src/terminal-identity.ts";
import { RemoteRuntime, type SshConnection } from "../../apps/service/src/remote.ts";
import { frameDigest } from "../../apps/service/src/worker-wire.ts";
import { TERMINAL_FRAME_BYTES, TerminalOwnerInfoSchema, TerminalInspectSchema, TerminalReadSchema, type TerminalRequestInput } from "../../apps/service/src/terminal-protocol.ts";
import { createSshTarget } from "./ssh-target.ts";
import type { RemoteConsoleInit } from "./remote-terminal-wire.ts";

const common = { format: "moguri-private-remote-console" as const, version: 1 as const };
const PrivateOwnerInfo = Type.Object({ ...TerminalOwnerInfoSchema.properties, owner: PreparedTerminalOwnerSchema }, { additionalProperties: false });
const Prepared = Type.Object({ kind: Type.Literal("prepared"), owner: PreparedTerminalOwnerSchema, binding: TerminalBindingSchema }, { additionalProperties: false });
const Attached = Type.Object({ kind: Type.Literal("attached"), info: PrivateOwnerInfo, frontPid: Type.Integer({ minimum: 2 }) }, { additionalProperties: false });
export class RemoteConsolePeer {
  private pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private closed = false;
  readonly exited: Promise<void>;
  private constructor(readonly connection: SshConnection) {
    this.exited = new Promise<void>((resolve) => connection.child.once("exit", () => resolve()));
    connection.child.once("exit", () => this.fail(new MoguriError("remote_console_lost", connection.diagnostic(), 409)));
    connection.wire.on("error", (error) => this.fail(error));
    connection.wire.on("close", () => this.fail(new MoguriError("remote_console_lost", "Remote console stream closed. Pending input is unconfirmed and was not replayed.", 409)));
    connection.wire.on("message", (raw: unknown) => {
      if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.ok !== "boolean") { this.fail(new Error("Invalid private Remote console reply.")); return; }
      const request = this.pending.get(raw.id);
      if (!request) { this.fail(new Error("Private Remote console reply has no exact pending request.")); return; }
      this.pending.delete(raw.id); clearTimeout(request.timer);
      if (raw.ok) request.resolve(raw.value);
      else request.reject(new MoguriError(typeof raw.code === "string" ? raw.code : "remote_console_failed", typeof raw.message === "string" ? raw.message : "Remote console failed without a successful receipt.", 409));
    });
  }
  static async open(runtime: RemoteRuntime, target: RemoteTarget, init: RemoteConsoleInit) {
    const peer = new RemoteConsolePeer(await runtime.connect(target, AbortSignal.timeout(30_000), TERMINAL_FRAME_BYTES));
    try { return { peer, value: await peer.send("bootstrap", init) }; }
    catch (error) { await peer.close(); throw error; }
  }
  private send(id: string, value: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new MoguriError("remote_console_closed", "This private console channel is closed. Nothing was resent.", 409));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new MoguriError("remote_console_timeout", "Private console reply timed out; pending effects/input were not replayed.", 409)), 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.connection.wire.send(value, (error) => { if (error) this.fail(error); });
    });
  }
  request(request: TerminalRequestInput): Promise<unknown> { const id = randomUUID(); return this.send(id, { ...request, id }); }
  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
  }
  async close(signal?: NodeJS.Signals): Promise<void> {
    this.fail(new MoguriError("remote_console_detached", "Detached, not stopped; no user input was replayed.", 409));
    if (signal) this.connection.child.kill(signal); else this.connection.wire.end();
    if (this.connection.child.exitCode !== null || this.connection.child.signalCode !== null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.exited, new Promise<void>((resolve) => { timer = setTimeout(resolve, 3000); })]);
      if (this.connection.child.exitCode === null && this.connection.child.signalCode === null) { this.connection.child.kill("SIGKILL"); await this.exited; }
    } finally { clearTimeout(timer); }
  }
}

export async function remoteConsoleFixture(options: { remote?: boolean } = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-private-console-"))), stateDir = join(directory, "state"), workspace = join(directory, "remote"), sshRoot = join(directory, "ssh");
  for (const path of [stateDir, workspace, sshRoot]) await mkdir(path, { mode: 0o700 });
  const ssh = await createSshTarget(sshRoot), target = { ...ssh.target, command: ssh.target.command.with(-1, resolve("tests/fixtures/remote-terminal-front.ts")) };
  const vault = { read: async () => null, write: async () => {}, remove: async () => {} };
  const runtime = new RemoteRuntime(stateDir, () => target, resolve("apps/service/src/worker.ts"), { vault }), peers = new Set<RemoteConsolePeer>();
  const key = randomBytes(32).toString("base64");
  let owner: PreparedTerminalOwner | undefined;
  const open = async (init: RemoteConsoleInit, destination = target) => {
    const result = await RemoteConsolePeer.open(runtime, destination, init); peers.add(result.peer); return result;
  };
  const dispose = async (peer: RemoteConsolePeer) => {
    const stopped = parse(PrivateOwnerInfo, await peer.request({ action: "dispose" })); owner = stopped.owner;
    await peer.close(); return stopped;
  };
  const cleanup = async () => {
    if (!owner) throw new Error("No exact private owner remains for cleanup.");
    const cleaned = await open({ ...common, action: "cleanup", owner });
    if (!isRecord(cleaned.value) || cleaned.value.removed !== true) throw new Error("Exact private Remote runtime cleanup was not observed.");
    await cleaned.peer.close(); owner = undefined;
  };
  const close = async () => {
    try {
      for (const peer of peers) await peer.close(); peers.clear();
      if (owner) {
        if (owner.status !== "stopped") {
          const attached = await open({ ...common, action: "attach", owner, key, clientId: randomUUID() });
          await dispose(attached.peer);
        }
        await cleanup();
      }
    } finally { await runtime.close(); await ssh.close(); await rm(directory, { recursive: true, force: true }); }
  };
  try {
    const prepared = await open({ ...common, action: "prepare", profileId: "generated-profile", projectId: "generated-project", sessionId: "generated-session", ownerId: randomUUID(), root: workspace });
    let intent = parse(Prepared, prepared.value); owner = intent.owner; await prepared.peer.close();
    if (options.remote) {
      const peerDigest = remoteTerminalPeer(target), previous = intent.binding;
      const bridgeDigest = createHash("sha256").update(await readFile(resolve("tests/fixtures/remote-terminal-front.ts"))).digest("hex");
      const remote = { target: { id: target.id, name: target.name, host: target.host, port: target.port, user: target.user, hostKey: target.hostKey,
        identityFile: target.identityFile, stateDir: target.stateDir, command: target.command }, peerDigest, bridgeDigest, brokerDigest: intent.owner.buildDigest };
      const scoped = { ...intent.owner, env: "Remote" as const, remote };
      const identity = { profileId: previous.profileId, sessionId: previous.sessionId, projectId: previous.projectId, workspaceId: previous.workspaceId,
        root: previous.root, env: "Remote" as const, peerDigest, device: previous.device, inode: previous.inode };
      intent = parse(Prepared, { ...intent, owner: { ...scoped, scopeDigest: terminalOwnerScope(scoped) }, binding: { ...identity, digest: frameDigest(identity) } });
      owner = intent.owner;
    }
    const started = await open({ ...common, action: "start", owner: intent.owner, key, clientId: randomUUID() });
    const initial = parse(Attached, started.value); owner = initial.info.owner;
    const attach = async (options: { owner?: PreparedTerminalOwner; key?: string; target?: RemoteTarget } = {}) => {
      const result = await open({ ...common, action: "attach", owner: options.owner ?? owner!, key: options.key ?? key, clientId: randomUUID() }, options.target);
      const attached = parse(Attached, result.value);
      return { peer: result.peer, info: attached.info, frontPid: attached.frontPid };
    };
    const launch = { executable: "/bin/sh", args: ["-c", "printf 'GENERATED_REMOTE_CONSOLE_READY\\n'; pwd; exec cat"] };
    const terminal = (): TerminalState => {
      const id = randomUUID(), binding = intent.binding;
      return { id, sessionId: binding.sessionId, projectId: binding.projectId, workspaceId: null, title: "Generated private SSH console", pid: null,
        cols: 80, rows: 24, status: "starting", diagnostic: null, env: binding.env, binding, ownerId: owner!.id, commandId: randomUUID(),
        commandDigest: frameDigest({ id, action: "generated-private-open" }), launchDigest: frameDigest([id, binding, launch, 80, 24, "Generated private SSH console"]) };
    };
    const read = (peer: RemoteConsolePeer, state: TerminalState) => peer.request({ action: "read", terminalId: state.id, bindingDigest: intent.binding.digest, offset: 0, limit: 65536 }).then((value) => parse(TerminalReadSchema, value));
    const openTerminal = (peer: RemoteConsolePeer, state = terminal()) => peer.request({ action: "open", intent: state, launch }).then((value) => ({ intent: state, ...parse(TerminalInspectSchema, value) }));
    return { directory, workspace, ssh, target, runtime, key, owner, intent, launch, peer: started.peer, frontPid: initial.frontPid, open, attach, terminal, read, openTerminal, dispose, cleanup, close };
  } catch (error) { await close(); throw error; }
}
