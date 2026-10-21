import { randomUUID } from "node:crypto";
import { MoguriError, isRecord, parse } from "../../../packages/protocol/src/core.ts";
import type { PreparedRemoteTerminalOwner, RemoteTerminalBoundary } from "../../../packages/protocol/src/terminals.ts";
import type { RemoteRuntime, SshConnection } from "./remote.ts";
import { remoteTerminalBuild } from "./terminal-build.ts";
import { remoteTerminalPeer, terminalKey } from "./terminal-identity.ts";
import { TERMINAL_FRAME_BYTES, TerminalOwnerInfoSchema, type TerminalControlChannel, type TerminalOwnerInfo, type TerminalRequestInput } from "./terminal-protocol.ts";
import type { RemoteTerminalInit } from "./remote-terminal-protocol.ts";

const format = { format: "moguri-remote-user-console" as const, version: 1 as const };
async function checkedBoundary(boundary: RemoteTerminalBoundary, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted(); const build = await remoteTerminalBuild(); signal.throwIfAborted();
  if (remoteTerminalPeer(boundary.target) !== boundary.peerDigest || build.bridgeDigest !== boundary.bridgeDigest || build.brokerDigest !== boundary.brokerDigest) {
    throw new MoguriError("terminal_remote_build", "This exact pinned peer/console bridge/broker no longer matches its retained scope. No key or request was sent.", 409);
  }
}
export class RemoteTerminalChannel implements TerminalControlChannel {
  private pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private closed = false;
  private ready = false;
  private intentional = false;
  private detaching?: Promise<void>;
  private readonly ended: Promise<void>;
  private constructor(private readonly connection: SshConnection, private readonly owner?: PreparedRemoteTerminalOwner,
    private readonly lost: (diagnostic: string) => void = () => {}) {
    this.ended = new Promise<void>((resolve) => {
      if (connection.child.exitCode !== null || connection.child.signalCode !== null) resolve(); else connection.child.once("close", () => resolve());
    });
    const disconnected = () => this.fail(new MoguriError("terminal_remote_disconnected", `${connection.diagnostic()} Pending console input may be unconfirmed and was not replayed.`, 409));
    connection.child.once("error", disconnected); connection.child.once("exit", disconnected);
    connection.wire.on("error", (error) => this.fail(error)); connection.wire.on("close", disconnected);
    connection.wire.on("message", (raw: unknown) => {
      if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.ok !== "boolean") { this.fail(new MoguriError("terminal_remote_frame", "Invalid Remote console receipt. Nothing was adopted or resent.", 409)); return; }
      const request = this.pending.get(raw.id);
      if (!request) { this.fail(new MoguriError("terminal_remote_receipt", "Remote reply does not own a pending console request. Nothing was replayed.", 409)); return; }
      this.pending.delete(raw.id); clearTimeout(request.timer);
      if (raw.ok) request.resolve(raw.value);
      else request.reject(new MoguriError(typeof raw.code === "string" && /^[a-z_]{1,80}$/.test(raw.code) ? raw.code : "terminal_remote_failed",
        typeof raw.message === "string" ? raw.message : "Remote console operation failed or is unconfirmed; no replay.", 409));
    });
    if (connection.child.exitCode !== null || connection.child.signalCode !== null) disconnected();
  }
  static async query(runtime: RemoteRuntime, boundary: RemoteTerminalBoundary, init: RemoteTerminalInit, signal: AbortSignal): Promise<unknown> {
    await checkedBoundary(boundary, signal);
    const channel = new RemoteTerminalChannel(await runtime.connect(boundary.target, signal, TERMINAL_FRAME_BYTES));
    try { return await channel.send("bootstrap", init); } finally { await channel.detach(); }
  }
  static async connect(runtime: RemoteRuntime, owner: PreparedRemoteTerminalOwner, key: string, clientId: string,
    lost: (diagnostic: string) => void, signal: AbortSignal, start = false): Promise<{ channel: RemoteTerminalChannel; info: TerminalOwnerInfo }> {
    terminalKey(key); await checkedBoundary(owner.remote, signal);
    const lifetime = new AbortController(), aborted = () => lifetime.abort(signal.reason);
    signal.addEventListener("abort", aborted, { once: true }); if (signal.aborted) aborted();
    let channel: RemoteTerminalChannel | undefined;
    try {
      channel = new RemoteTerminalChannel(await runtime.connect(owner.remote.target, lifetime.signal, TERMINAL_FRAME_BYTES), owner, lost);
      const value = await channel.send("bootstrap", { ...format, action: start ? "start" : "attach", owner, key, clientId });
      if (!isRecord(value)) throw new MoguriError("terminal_remote_receipt", "Remote console attachment has no exact owner observation.", 409);
      const info = parse(TerminalOwnerInfoSchema, value.info); channel.validateOwner(info); signal.throwIfAborted(); channel.ready = true;
      return { channel, info };
    } catch (error) { await channel?.detach(); throw error; }
    finally { signal.removeEventListener("abort", aborted); }
  }
  private validateOwner(info: TerminalOwnerInfo): void {
    const owner = this.owner, actual = info.owner;
    if (!owner || actual.env !== "Remote" || actual.profileId !== owner.profileId || actual.id !== owner.id || actual.protocol !== owner.protocol ||
      actual.buildDigest !== owner.buildDigest || actual.scopeDigest !== owner.scopeDigest || actual.directory !== owner.directory || actual.endpoint !== owner.endpoint ||
      JSON.stringify(actual.remote) !== JSON.stringify(owner.remote) || actual.pid === null || owner.pid !== null && actual.pid !== owner.pid) {
      throw new MoguriError("terminal_remote_owner", "Remote observation does not match the exact retained owner/profile/peer/build/endpoint/PID. No Local owner was substituted.", 409);
    }
  }
  private send(id: string, value: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new MoguriError("terminal_remote_disconnected", "Remote console stream is closed. No input or request was replayed.", 409));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new MoguriError("terminal_remote_timeout", "Remote console acknowledgement is unconfirmed. Accepted bytes may have effects and were not replayed.", 409));
        void this.detach().catch(() => console.error("Remote console SSH detach remains unconfirmed."));
      }, 10_000);
      this.pending.set(id, { resolve, reject, timer }); this.connection.wire.send(value, (error) => { if (error) this.fail(error); });
    });
  }
  request(input: TerminalRequestInput): Promise<unknown> { const id = randomUUID(); return this.send(id, { ...input, id }); }
  async inspectOwner(): Promise<TerminalOwnerInfo> { const info = parse(TerminalOwnerInfoSchema, await this.request({ action: "info" })); this.validateOwner(info); return info; }
  retire(): void { this.intentional = true; }
  detach(): Promise<void> {
    this.intentional = true;
    this.detaching ??= (async () => {
      this.fail(new MoguriError("terminal_remote_detached", "Remote console controller detached, not stopped. No input was replayed.", 409));
      this.connection.wire.end();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([this.ended, new Promise<void>((resolve) => { timer = setTimeout(resolve, 2000); })]); }
      finally { clearTimeout(timer); }
      const child = this.connection.child;
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      try { await Promise.race([this.ended, new Promise<void>((resolve) => { timer = setTimeout(resolve, 1000); })]); }
      finally { clearTimeout(timer); }
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await this.ended;
    })();
    return this.detaching;
  }
  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); } this.pending.clear();
    if (this.ready && !this.intentional) this.lost(error instanceof MoguriError ? error.message : "Remote console control failed; input/cleanup remain unconfirmed and were not replayed.");
  }
}
export const remoteTerminalFormat = format;
