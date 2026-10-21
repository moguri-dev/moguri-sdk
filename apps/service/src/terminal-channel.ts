import { randomBytes, randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { isRecord, MoguriError, parse } from "../../../packages/protocol/src/core.ts";
import type { TerminalOwner, PreparedTerminalOwner } from "../../../packages/protocol/src/terminals.ts";
import { JsonLineChannel } from "./worker-wire.ts";
import { assertTerminalEndpoint, preparedTerminalOwner, terminalProof, validTerminalProof } from "./terminal-identity.ts";
import { TERMINAL_FRAME_BYTES, TerminalOwnerInfoSchema, type TerminalOwnerInfo, type TerminalRequestInput } from "./terminal-protocol.ts";

export class TerminalChannel {
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private closed = false;
  private intentional = false;
  private ready = false;
  private resolveReady!: (info: TerminalOwnerInfo) => void;
  private rejectReady!: (error: Error) => void;
  private readonly started: Promise<TerminalOwnerInfo>;
  private readonly wire: JsonLineChannel;
  private readonly timer: ReturnType<typeof setTimeout>;
  private nonce: string | null = null;
  private observedPid: number | null = null;
  private readonly clientNonce = randomBytes(32).toString("hex");
  private constructor(private readonly socket: Socket, private readonly owner: PreparedTerminalOwner, private readonly key: string,
    private readonly clientId: string, private readonly lost: (diagnostic: string) => void) {
    this.started = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.wire = new JsonLineChannel(socket, socket, false, TERMINAL_FRAME_BYTES);
    this.timer = setTimeout(() => this.fail(new MoguriError("terminal_auth_timeout", "Terminal authentication timed out. No shell or input was replayed.", 409)), 5000);
    this.wire.on("error", (error) => this.fail(error));
    this.wire.on("close", () => this.fail(new MoguriError("terminal_disconnected", "Terminal control connection was lost. Pending input may be unconfirmed and was not replayed.", 409)));
    socket.on("error", (error) => this.fail(error));
    this.wire.on("message", (value) => this.message(value));
  }
  static async connect(owner: TerminalOwner, key: string, clientId: string,
    lost: (diagnostic: string) => void = () => {}, signal?: AbortSignal): Promise<{ channel: TerminalChannel; info: TerminalOwnerInfo }> {
    signal?.throwIfAborted();
    const prepared = preparedTerminalOwner(owner); await assertTerminalEndpoint(prepared);
    signal?.throwIfAborted();
    const channel = new TerminalChannel(createConnection(prepared.endpoint), prepared, key, clientId, lost);
    const abort = () => channel.fail(new MoguriError("terminal_connection_stopped", "Terminal connection was stopped. No input was replayed.", 409));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try { const info = await channel.started; return { channel, info }; }
    finally { signal?.removeEventListener("abort", abort); }
  }
  request(input: TerminalRequestInput): Promise<unknown> {
    if (this.closed || !this.ready) return Promise.reject(new MoguriError("terminal_disconnected", "Terminal owner is not attached. No request or input was replayed.", 409));
    return new Promise((resolve, reject) => {
      const id = randomUUID(), timer = setTimeout(() => this.fail(new MoguriError("terminal_request_timeout", "Terminal control outcome is unconfirmed. No request or input was replayed.", 409)), 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.wire.send({ ...input, id }, (error) => { if (error) this.fail(error); });
    });
  }
  async inspectOwner(): Promise<TerminalOwnerInfo> {
    const info = parse(TerminalOwnerInfoSchema, await this.request({ action: "info" }));
    this.validateOwner(info);
    return info;
  }
  private validateOwner(info: TerminalOwnerInfo): void {
    if (info.owner.id !== this.owner.id || info.owner.profileId !== this.owner.profileId || info.owner.pid !== this.observedPid ||
      info.owner.protocol !== this.owner.protocol || info.owner.scopeDigest !== this.owner.scopeDigest || info.owner.buildDigest !== this.owner.buildDigest ||
      info.owner.directory !== this.owner.directory || info.owner.endpoint !== this.owner.endpoint) {
      throw new MoguriError("terminal_owner_changed", "The authenticated owner metadata does not match its retained identity.", 409);
    }
  }
  detach(): void {
    this.intentional = true; this.fail(new MoguriError("terminal_detached", "Terminal controller detached. No input was replayed.", 409));
  }
  retire(): void { this.intentional = true; }
  private message(value: unknown): void {
    try {
      if (!isRecord(value)) throw new MoguriError("terminal_frame", "Invalid terminal owner control frame.", 409);
      if (!this.ready) {
        if (value.type === "challenge" && value.protocol === this.owner.protocol && value.ownerId === this.owner.id &&
          value.profileId === this.owner.profileId && value.scopeDigest === this.owner.scopeDigest && value.buildDigest === this.owner.buildDigest &&
          typeof value.pid === "number" && Number.isSafeInteger(value.pid) && value.pid > 1 && (this.owner.pid === null || value.pid === this.owner.pid) &&
          typeof value.nonce === "string" && /^[a-f0-9]{64}$/.test(value.nonce)) {
          this.nonce = value.nonce;
          this.observedPid = value.pid;
          this.wire.send({ type: "authenticate", clientId: this.clientId, clientNonce: this.clientNonce,
            scopeDigest: this.owner.scopeDigest, proof: terminalProof(this.key, "client", this.nonce, this.owner.scopeDigest, this.clientId) });
          return;
        }
        if (value.type !== "ready" || !this.nonce ||
          !validTerminalProof(value.proof, terminalProof(this.key, "server", `${this.nonce}:${this.clientNonce}`, this.owner.scopeDigest, this.clientId))) {
          throw new MoguriError(value.code === "owner_busy" ? "terminal_owner_busy" : "terminal_authentication", value.code === "owner_busy" ?
            "Another authenticated controller owns this terminal process. No takeover or input was attempted." : "Terminal owner identity/authentication was rejected. Nothing was adopted.", 409);
        }
        const info = parse(TerminalOwnerInfoSchema, value.info);
        this.validateOwner(info);
        this.ready = true; clearTimeout(this.timer); this.resolveReady(info); return;
      }
      if (typeof value.id !== "string") throw new MoguriError("terminal_receipt", "Terminal reply has no owning request identity.", 409);
      const pending = this.pending.get(value.id);
      if (!pending) throw new MoguriError("terminal_receipt", "Terminal reply does not own a pending request. No work was replayed.", 409);
      this.pending.delete(value.id); clearTimeout(pending.timer);
      if (value.ok === true) pending.resolve(value.value);
      else pending.reject(new MoguriError(typeof value.code === "string" && /^[a-z_]{1,80}$/.test(value.code) ? value.code : "terminal_failed",
        typeof value.message === "string" ? value.message : "Terminal operation failed or is unconfirmed. No input was replayed.", 409));
    } catch (error) { this.fail(error instanceof Error ? error : new Error("Terminal control validation failed.")); }
  }
  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.timer); this.rejectReady(error);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.socket.destroy();
    if (this.ready && !this.intentional) this.lost(error instanceof MoguriError ? error.message : "Terminal transport failed. Input/cleanup are unconfirmed; no replay.");
  }
}
