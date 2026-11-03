import { GLOBAL_PROFILE_ID, isRecord, PROFILE_ID, PROTOCOL_VERSION, QUERY_TIMEOUT_MS, QUERY_REPLY_GRACE_MS, type Command, type CommandEnvelope, type CommandResult, type Connection, type Snapshot, type StoredEvent } from "../../protocol/src/index.ts";

export interface ClientState { snapshot: Snapshot | null; status: "connecting" | "connected" | "disconnected"; error: string | null; events: StoredEvent[] }
export interface ClientRequestTiming {
  operation: "session.create" | "draft.save" | "message.send" | "snapshot" | "query" | "other";
  generation: number;
  headersMs: number | null;
  bodyMs: number | null;
  totalMs: number;
  status: number | null;
  completed: boolean;
}
function isSnapshot(value: unknown, profileId: string): value is Snapshot {
  return isRecord(value) && value.protocolVersion === PROTOCOL_VERSION && typeof value.seq === "number" && Number.isSafeInteger(value.seq) && value.seq >= 0 &&
    value.profileId === profileId &&
    Array.isArray(value.projects) && Array.isArray(value.sessions) && isRecord(value.provider) && isRecord(value.policy) && isRecord(value.sessionTelemetry);
}
function isEvent(value: unknown): value is StoredEvent {
  return isRecord(value) && typeof value.seq === "number" && value.schema_version === 1 && typeof value.event_type === "string" && isRecord(value.payload);
}
export class MoguriClient {
  private state: ClientState = { snapshot: null, status: "connecting", error: null, events: [] };
  private listeners = new Set<() => void>();
  private socket?: WebSocket;
  private readySocket?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private reconnect?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private generation = 0;
  private refreshTask?: Promise<void>;
  private refreshAgain = false;
  private refreshError: unknown;
  private after = 0;
  private backoff = 300;
  private requestTimings: ClientRequestTiming[] = [];
  constructor(public connection: Connection, protected readonly resolveConnection?: () => Promise<Connection>, readonly profileId: string = PROFILE_ID) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(profileId) || profileId === GLOBAL_PROFILE_ID) throw new ClientError("profile_scope", "Choose one explicit user profile. No Default fallback was used.");
    Object.defineProperty(this, "profileId", { writable: false, configurable: false });
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getState = () => this.state;
  getRequestTimings = (): ClientRequestTiming[] => structuredClone(this.requestTimings);
  private update(change: Partial<ClientState>): void { this.state = { ...this.state, ...change }; for (const listener of this.listeners) listener(); }
  async connect(): Promise<void> {
    this.disposed = false;
    const generation = ++this.generation;
    await this.refresh();
    if (this.disposed || generation !== this.generation) throw new ClientError("connection_cancelled", "This original client opening was cancelled. No replacement connection or input was used.");
    if (!this.state.snapshot && this.refreshError instanceof ClientError && !(this.refreshError.status !== undefined &&
      (this.refreshError.status >= 500 || [408, 429].includes(this.refreshError.status)))) throw this.refreshError;
    this.openSocket();
  }
  protected async request(path: string, body?: unknown, signal?: AbortSignal, connection = this.connection): Promise<unknown> {
    signal?.throwIfAborted();
    const began = performance.now(), generation = this.generation;
    const command = isRecord(body) && isRecord(body.command) ? body.command.type : null;
    const operation: ClientRequestTiming["operation"] = path === "/v1/snapshot" ? "snapshot" : path === "/v1/query" ? "query" :
      command === "session.create" || command === "draft.save" || command === "message.send" ? command : "other";
    let headersMs: number | null = null, bodyMs: number | null = null, status: number | null = null, completed = false;
    const requestId = path === "/v1/query" ? crypto.randomUUID() : null;
    const deadline = AbortSignal.timeout(requestId ? QUERY_TIMEOUT_MS + QUERY_REPLY_GRACE_MS : 20_000);
    const requested = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const headers = { Authorization: `Bearer ${connection.token}`, "X-Moguri-Profile": this.profileId, ...(body ? { "Content-Type": "application/json" } : {}) };
    let cancellation: Promise<ClientError | null> | undefined;
    const cancel = () => {
      if (!requestId || cancellation) return;
      cancellation = (async () => {
        try {
          const response = await fetch(`${connection.baseUrl}/v1/query-cancel`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ requestId }), signal: AbortSignal.timeout(5000) });
          const result: unknown = await response.json();
          if (!response.ok || !isRecord(result) || result.requested !== true) throw new Error("The original query cancellation was not acknowledged.");
          return null;
        } catch {
          return new ClientError("query_cancellation_failed", "The reply was discarded, but query cancellation could not be confirmed. Its source read may finish before its deadline. No result was applied.");
        }
      })();
    };
    requested.addEventListener("abort", cancel, { once: true });
    try {
      const response = await fetch(`${connection.baseUrl}${path}`, {
        method: body ? "POST" : "GET", headers: { ...headers, ...(requestId ? { "X-Moguri-Query-Id": requestId } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: requested,
      });
      headersMs = performance.now() - began; status = response.status;
      const result: unknown = await response.json();
      bodyMs = performance.now() - began - headersMs;
      signal?.throwIfAborted();
      if (!response.ok) {
        const error = isRecord(result) && isRecord(result.error) ? result.error : undefined;
        throw new ClientError(typeof error?.code === "string" ? error.code : "request_failed", typeof error?.message === "string" ? error.message : `Service request failed (${response.status}).`, response.status);
      }
      completed = true; return result;
    } catch (error) {
      const failed = cancellation ? await cancellation : null;
      if (failed) throw failed;
      if (requestId && deadline.aborted && !signal?.aborted) throw new ClientError("query_timeout", "This source read exceeded its service deadline and delivery allowance. No state was changed or source operation replayed. Inspect the selected source and retry the read explicitly.");
      throw error;
    } finally {
      requested.removeEventListener("abort", cancel);
      this.requestTimings.push({ operation, generation, headersMs, bodyMs, totalMs: performance.now() - began, status, completed });
      if (this.requestTimings.length > 50) this.requestTimings.splice(0, this.requestTimings.length - 50);
    }
  }
  async commandReceipt(command: Command, id: string): Promise<{ status: "committed"; result: CommandResult } | { status: "pending" | "unknown" }> {
    return this.readReceipt({ id, profileId: this.profileId, command }, this.connection);
  }
  private async readReceipt(envelope: CommandEnvelope, connection: Connection): Promise<{ status: "committed"; result: CommandResult } | { status: "pending" | "unknown" }> {
    const value = await this.request("/v1/command-receipt", envelope, undefined, connection);
    if (!isRecord(value) || !["committed", "pending", "unknown"].includes(String(value.status)) ||
      value.status === "committed" && !isRecord(value.result)) throw new ClientError("command_receipt", "The exact original command receipt was not valid. No write was retried.");
    return value as { status: "committed"; result: CommandResult } | { status: "pending" | "unknown" };
  }
  private async synchronizeCommand(): Promise<void> {
    await this.refreshTask;
    if (!this.disposed) await this.refresh();
  }
  async command(command: Command, id: string = crypto.randomUUID()): Promise<CommandResult> {
    if (this.state.status !== "connected") throw new ClientError("disconnected", "Reconnect to Moguri before changing state. Your local edit has not been sent.");
    const connection = this.connection, envelope: CommandEnvelope = { id, profileId: this.profileId, command: structuredClone(command) };
    let result: unknown;
    try {
      result = await this.request("/v1/commands", envelope, undefined, connection);
      if (!isRecord(result)) throw new Error("Invalid command response.");
    } catch (error) {
      if (error instanceof ClientError && error.code !== "request_failed") { await this.synchronizeCommand(); throw error; }
      let receipt: Awaited<ReturnType<MoguriClient["readReceipt"]>> | undefined;
      try {
        const current = this.connection;
        if (current === connection || connection.storeId && current.storeId === connection.storeId) receipt = await this.readReceipt(envelope, current);
      } catch (inspection) {
        console.error("Moguri could not inspect the original command receipt:", inspection instanceof ClientError ? inspection.code : "transport_unavailable");
      }
      if (receipt?.status === "committed") result = receipt.result;
      else {
        await this.synchronizeCommand();
        throw new ClientError(receipt?.status === "pending" ? "command_pending" : "command_outcome_unknown",
          `Command ${id} ${receipt?.status === "pending" ? "is still pending in its original service" : "has no confirmed outcome"}. No write was resent. Inspect its exact command receipt before another attempt; local edits are preserved.`);
      }
    }
    await this.synchronizeCommand();
    return result as CommandResult;
  }
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.refreshTask) { this.refreshAgain = true; return this.refreshTask; }
    this.refreshTask = this.performRefresh().finally(() => {
      this.refreshTask = undefined;
      if (this.refreshAgain) { this.refreshAgain = false; this.scheduleRefresh(); }
    });
    return this.refreshTask;
  }
  private async performRefresh(): Promise<void> {
    const generation = this.generation, connection = this.connection;
    try {
      const snapshot = await this.request("/v1/snapshot", undefined, undefined, connection);
      if (this.disposed || generation !== this.generation || connection !== this.connection) return;
      if (!isSnapshot(snapshot, this.profileId)) throw new Error("The service protocol is incompatible. Update both clients.");
      const projects = new Set(snapshot.projects.map((project) => project.id));
      const sessions = new Set(snapshot.sessions.map((session) => session.id));
      if (this.state.snapshot && snapshot.seq < this.state.snapshot.seq) { this.refreshAgain = true; return; }
      this.after = Math.max(this.after, snapshot.seq);
      this.update({ snapshot, error: this.readySocket === this.socket ? null : this.state.error,
        ...(this.readySocket === this.socket && this.socket?.readyState === WebSocket.OPEN ? { status: "connected" as const } : {}),
        events: this.state.events.filter((event) => (!event.project_id || projects.has(event.project_id)) && (!event.session_id || sessions.has(event.session_id))) });
      this.refreshError = undefined;
    } catch (error) {
      if (this.disposed || generation !== this.generation || connection !== this.connection) return;
      this.refreshError = error;
      this.update({ status: "disconnected", error: error instanceof Error ? error.message : "Service connection failed." });
      if (this.readySocket === this.socket && this.socket?.readyState === WebSocket.OPEN) this.scheduleRefresh(300);
    }
  }
  private scheduleRefresh(delay = 40): void {
    if (this.disposed || this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, delay);
  }
  private openSocket(): void {
    if (this.disposed) return;
    this.update({ status: "connecting" });
    const connection = this.connection, socket = new WebSocket(connection.wsUrl);
    this.socket = socket;
    socket.onopen = () => {
      if (this.disposed || this.socket !== socket) { socket.close(); return; }
      socket.send(JSON.stringify({ type: "authenticate", protocolVersion: PROTOCOL_VERSION, token: connection.token, after: this.after, profileId: this.profileId }));
    };
    socket.onmessage = (frame) => {
      if (this.disposed || this.socket !== socket) return;
      try {
        const message: unknown = JSON.parse(String(frame.data));
        if (!isRecord(message)) throw new Error("Invalid event frame.");
        if (message.type === "ready") {
          const snapshot = message.snapshot;
          if (!isSnapshot(snapshot, this.profileId)) throw new Error("Unsupported event protocol or profile scope.");
          this.after = Math.max(this.after, snapshot.seq);
          this.backoff = 300;
          this.readySocket = socket;
          this.update({ status: "connected", error: null,
            snapshot: this.state.snapshot && this.state.snapshot.seq > snapshot.seq ? this.state.snapshot : snapshot });
        } else if (message.type === "event" && isEvent(message.event)) {
          if (message.event.profile_id !== this.profileId) throw new Error("A foreign-profile event was rejected.");
          this.after = Math.max(this.after, message.event.seq);
          const deletedSession = message.event.event_type === "session.deleted" ? message.event.payload.deletedSessionId : null;
          const deletedProject = message.event.event_type === "project.removed" ? message.event.payload.deletedProjectId : null;
          this.update({ events: [...this.state.events.filter((event) => (!deletedSession || event.session_id !== deletedSession) && (!deletedProject || event.project_id !== deletedProject)).slice(-199), message.event] });
          this.scheduleRefresh();
        } else if (message.type === "invalidate") this.scheduleRefresh();
      } catch {
        this.update({ error: "An invalid event frame was rejected. Reconnecting to resynchronize." });
        socket.close();
      }
    };
    socket.onerror = () => { if (!this.disposed && this.socket === socket) this.update({ error: "The event connection failed. Reconnecting; unsent edits are preserved." }); };
    socket.onclose = (event) => {
      if (this.disposed || this.socket !== socket) return;
      this.readySocket = undefined;
      this.update({ status: "disconnected", error: event.code === 1008 ?
        "Moguri's event service rejected authentication or protocol/profile negotiation (close 1008). Verify the matching app/service and selected profile; saved data was preserved." :
        event.code === 1013 ? "Moguri's event stream requested replay recovery (close 1013). Reconnecting from the last verified snapshot/event cursor; no commands were resent." :
        this.state.error ?? `The Moguri event connection closed (code ${event.code}). Reconnecting without resending commands; unsent edits are preserved.` });
      this.reconnect = setTimeout(() => {
        void (async () => {
          try {
            if (this.resolveConnection) {
              const connection = await this.resolveConnection();
              if (this.disposed || this.socket !== socket) return;
              if (this.connection.storeId && connection.storeId !== this.connection.storeId) throw new ClientError("connection_scope", "The discovered service owns different retained state. Reopen the original store explicitly; no input or mutation was resent.");
              if (connection !== this.connection) { this.generation++; this.connection = connection; }
            }
          }
          catch (error) { this.update({ error: error instanceof ClientError ? error.message : "Service restart is not ready. Reconnecting without resending commands." }); }
          if (this.disposed || this.socket !== socket) return;
          this.openSocket();
        })();
      }, this.backoff);
      this.backoff = Math.min(this.backoff * 2, 5000);
    };
  }
  disconnect(): void {
    this.disposed = true;
    this.generation++; this.refreshAgain = false;
    clearTimeout(this.timer);
    clearTimeout(this.reconnect);
    this.socket?.close();
    this.readySocket = undefined;
    this.update({ status: "disconnected" });
  }
}
export class ClientError extends Error { constructor(readonly code: string, message: string, readonly status?: number) { super(message); } }
