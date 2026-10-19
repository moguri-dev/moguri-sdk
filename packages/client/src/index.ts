import { isRecord, PROFILE_ID, PROTOCOL_VERSION, type Command, type CommandEnvelope, type CommandResult, type Connection, type Snapshot, type StoredEvent } from "../../protocol/src/index.ts";

export interface ClientState { snapshot: Snapshot | null; status: "connecting" | "connected" | "disconnected"; error: string | null; events: StoredEvent[] }
function isSnapshot(value: unknown): value is Snapshot {
  return isRecord(value) && value.protocolVersion === PROTOCOL_VERSION && typeof value.seq === "number" &&
    Array.isArray(value.projects) && Array.isArray(value.sessions) && isRecord(value.provider) && isRecord(value.policy);
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
  private refreshTask?: Promise<void>;
  private refreshAgain = false;
  private after = 0;
  private backoff = 300;
  constructor(public connection: Connection, private readonly resolveConnection?: () => Promise<Connection>) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getState = () => this.state;
  private update(change: Partial<ClientState>): void { this.state = { ...this.state, ...change }; for (const listener of this.listeners) listener(); }
  async connect(): Promise<void> {
    this.disposed = false;
    await this.refresh();
    this.openSocket();
  }
  protected async request(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.connection.baseUrl}${path}`, {
      method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${this.connection.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      const error = isRecord(result) && isRecord(result.error) ? result.error : undefined;
      throw new ClientError(typeof error?.code === "string" ? error.code : "request_failed", typeof error?.message === "string" ? error.message : `Service request failed (${response.status}).`);
    }
    return result;
  }
  async command(command: Command, id: string = crypto.randomUUID()): Promise<CommandResult> {
    if (this.state.status !== "connected") throw new ClientError("disconnected", "Reconnect to Moguri before changing state. Your local edit has not been sent.");
    try {
      const envelope: CommandEnvelope = { id, profileId: PROFILE_ID, command };
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
    if (this.refreshTask) { this.refreshAgain = true; return this.refreshTask; }
    this.refreshTask = this.performRefresh().finally(() => { this.refreshTask = undefined; });
    return this.refreshTask;
  }
  private async performRefresh(): Promise<void> {
    try {
      do {
        this.refreshAgain = false;
        const snapshot = await this.request("/v1/snapshot");
        if (!isSnapshot(snapshot)) {
          throw new Error("The service protocol is incompatible. Update both clients.");
        }
        const projects = new Set(snapshot.projects.map((project) => project.id));
        const sessions = new Set(snapshot.sessions.map((session) => session.id));
        this.update({ snapshot, error: null, events: this.state.events.filter((event) => (!event.project_id || projects.has(event.project_id)) && (!event.session_id || sessions.has(event.session_id))) });
      } while (this.refreshAgain && !this.disposed);
    } catch (error) {
      this.update({ status: "disconnected", error: error instanceof Error ? error.message : "Service connection failed." });
    }
  }
  private scheduleRefresh(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, 40);
  }
  private openSocket(): void {
    if (this.disposed) return;
    this.update({ status: "connecting" });
    const socket = new WebSocket(this.connection.wsUrl);
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: "authenticate", protocolVersion: PROTOCOL_VERSION, token: this.connection.token, after: this.after }));
    socket.onmessage = (frame) => {
      try {
        const message: unknown = JSON.parse(String(frame.data));
        if (!isRecord(message)) throw new Error("Invalid event frame.");
        if (message.type === "ready") {
          const snapshot = message.snapshot;
          if (!isSnapshot(snapshot)) throw new Error("Unsupported event protocol.");
          this.after = snapshot.seq;
          this.backoff = 300;
          this.update({ status: "connected", error: null, snapshot });
        } else if (message.type === "event" && isEvent(message.event)) {
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
    socket.onerror = () => this.update({ error: "The event connection failed. Reconnecting; unsent edits are preserved." });
    socket.onclose = () => {
      if (this.disposed) return;
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
    clearTimeout(this.timer);
    clearTimeout(this.reconnect);
    this.socket?.close();
    this.update({ status: "disconnected" });
  }
}
export class ClientError extends Error { constructor(readonly code: string, message: string) { super(message); } }
