import { GLOBAL_PROFILE_ID, isRecord, PROFILE_ID, PROTOCOL_VERSION, type Command, type CommandEnvelope, type CommandResult, type Connection, type Snapshot, type StoredEvent } from "../../protocol/src/index.ts";

export interface ClientState { snapshot: Snapshot | null; status: "connecting" | "connected" | "disconnected"; error: string | null; events: StoredEvent[] }
function isSnapshot(value: unknown, profileId: string): value is Snapshot {
  return isRecord(value) && value.protocolVersion === PROTOCOL_VERSION && typeof value.seq === "number" &&
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
  private timer?: ReturnType<typeof setTimeout>;
  private reconnect?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private generation = 0;
  private refreshTask?: Promise<void>;
  private refreshAgain = false;
  private refreshError: unknown;
  private after = 0;
  private backoff = 300;
  constructor(public connection: Connection, protected readonly resolveConnection?: () => Promise<Connection>, readonly profileId: string = PROFILE_ID) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(profileId) || profileId === GLOBAL_PROFILE_ID) throw new ClientError("profile_scope", "Choose one explicit user profile. No Default fallback was used.");
    Object.defineProperty(this, "profileId", { writable: false, configurable: false });
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getState = () => this.state;
  private update(change: Partial<ClientState>): void { this.state = { ...this.state, ...change }; for (const listener of this.listeners) listener(); }
  async connect(): Promise<void> {
    this.disposed = false;
    const generation = ++this.generation;
    await this.refresh();
    if (this.disposed || generation !== this.generation) throw new ClientError("connection_cancelled", "This original client opening was cancelled. No replacement connection or input was used.");
    if (!this.state.snapshot && this.refreshError instanceof ClientError) throw this.refreshError;
    this.openSocket();
  }
  protected async request(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    const connection = this.connection, requestId = path === "/v1/query" && signal ? crypto.randomUUID() : null;
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
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = await fetch(`${connection.baseUrl}${path}`, {
        method: body ? "POST" : "GET", headers: { ...headers, ...(requestId ? { "X-Moguri-Query-Id": requestId } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
      });
      const result: unknown = await response.json();
      signal?.throwIfAborted();
      if (!response.ok) {
        const error = isRecord(result) && isRecord(result.error) ? result.error : undefined;
        throw new ClientError(typeof error?.code === "string" ? error.code : "request_failed", typeof error?.message === "string" ? error.message : `Service request failed (${response.status}).`);
      }
      return result;
    } catch (error) {
      const failed = cancellation ? await cancellation : null;
      if (failed) throw failed;
      throw error;
    } finally { signal?.removeEventListener("abort", cancel); }
  }
  async command(command: Command, id: string = crypto.randomUUID()): Promise<CommandResult> {
    if (this.state.status !== "connected") throw new ClientError("disconnected", "Reconnect to Moguri before changing state. Your local edit has not been sent.");
    try {
      const envelope: CommandEnvelope = { id, profileId: this.profileId, command };
      const result = await this.request("/v1/commands", envelope);
      await this.refresh();
      if (!isRecord(result)) throw new Error("Invalid command response.");
      return result as CommandResult;
    } catch (error) {
      await this.refresh();
      throw error;
    }
  }
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.refreshTask) { this.refreshAgain = true; return this.refreshTask; }
    this.refreshTask = this.performRefresh().finally(() => { this.refreshTask = undefined; });
    return this.refreshTask;
  }
  private async performRefresh(): Promise<void> {
    const generation = this.generation;
    try {
      do {
        this.refreshAgain = false;
        const snapshot = await this.request("/v1/snapshot");
        if (this.disposed || generation !== this.generation) return;
        if (!isSnapshot(snapshot, this.profileId)) {
          throw new Error("The service protocol is incompatible. Update both clients.");
        }
        const projects = new Set(snapshot.projects.map((project) => project.id));
        const sessions = new Set(snapshot.sessions.map((session) => session.id));
        this.update({ snapshot, error: null, events: this.state.events.filter((event) => (!event.project_id || projects.has(event.project_id)) && (!event.session_id || sessions.has(event.session_id))) });
        this.refreshError = undefined;
      } while (this.refreshAgain && !this.disposed && generation === this.generation);
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.refreshError = error;
      this.update({ status: "disconnected", error: error instanceof Error ? error.message : "Service connection failed." });
    }
  }
  private scheduleRefresh(): void {
    if (this.disposed || this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, 40);
  }
  private openSocket(): void {
    if (this.disposed) return;
    this.update({ status: "connecting" });
    const socket = new WebSocket(this.connection.wsUrl);
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: "authenticate", protocolVersion: PROTOCOL_VERSION, token: this.connection.token, after: this.after, profileId: this.profileId }));
    socket.onmessage = (frame) => {
      if (this.disposed || this.socket !== socket) return;
      try {
        const message: unknown = JSON.parse(String(frame.data));
        if (!isRecord(message)) throw new Error("Invalid event frame.");
        if (message.type === "ready") {
          const snapshot = message.snapshot;
          if (!isSnapshot(snapshot, this.profileId)) throw new Error("Unsupported event protocol or profile scope.");
          this.after = snapshot.seq;
          this.backoff = 300;
          this.update({ status: "connected", error: null, snapshot });
        } else if (message.type === "event" && isEvent(message.event)) {
          if (message.event.profile_id !== this.profileId) throw new Error("A foreign-profile event was rejected.");
          this.after = Math.max(this.after, message.event.seq);
          const deletedSession = message.event.event_type === "session.deleted" ? message.event.payload.deletedSessionId : null;
          const deletedProject = message.event.event_type === "project.removed" ? message.event.payload.deletedProjectId : null;
          this.update({ events: [...this.state.events.filter((event) => (!deletedSession || event.session_id !== deletedSession) && (!deletedProject || event.project_id !== deletedProject)).slice(-199), message.event] });
          if (this.state.status === "connected") this.scheduleRefresh();
        } else if (message.type === "invalidate") this.scheduleRefresh();
      } catch {
        this.update({ error: "An invalid event frame was rejected. Reconnecting to resynchronize." });
        socket.close();
      }
    };
    socket.onerror = () => { if (!this.disposed && this.socket === socket) this.update({ error: "The event connection failed. Reconnecting; unsent edits are preserved." }); };
    socket.onclose = () => {
      if (this.disposed || this.socket !== socket) return;
      this.update({ status: "disconnected" });
      this.reconnect = setTimeout(() => {
        void (async () => {
          try { if (this.resolveConnection) this.connection = await this.resolveConnection(); }
          catch { this.update({ error: "Service restart is not ready. Reconnecting without resending commands." }); }
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
    this.update({ status: "disconnected" });
  }
}
export class ClientError extends Error { constructor(readonly code: string, message: string) { super(message); } }
