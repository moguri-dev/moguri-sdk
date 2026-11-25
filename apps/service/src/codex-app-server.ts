import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

/**
 * Minimal newline-delimited JSON-RPC 2.0 client for a harness process. `codex app-server` omits the `jsonrpc` field;
 * ACP agents (`agy acp`, `gemini --acp`) require it. Server requests (approvals) and notifications are surfaced to the
 * owner; unanswered requests fail on exit.
 */
type Json = Record<string, unknown>;
export const isJson = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
export class CodexRpcError extends Error {
  constructor(message: string, readonly code: number | null) { super(message); }
}
export interface CodexServerRequest { id: string | number; method: string; params: Json }
export class CodexAppServer {
  readonly exit: Promise<void>;
  private readonly waiters = new Map<string | number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private counter = 0;
  private closed = false;
  onNotification: (method: string, params: Json) => void = () => {};
  onRequest: (request: CodexServerRequest) => void = (request) => this.error(request.id, -32601, `Moguri does not serve ${request.method}.`);
  constructor(readonly child: ChildProcess, private readonly wire: { label: string; jsonrpc: boolean } = { label: "Codex app-server", jsonrpc: false }) {
    this.exit = new Promise((resolve) => child.once("exit", () => resolve()));
    child.once("error", () => this.fail(`${wire.label} could not start.`));
    void this.exit.then(() => this.fail(`${wire.label} exited.`));
    createInterface({ input: child.stdout! }).on("line", (line) => {
      if (!line.trim()) return;
      let message: unknown;
      try { message = JSON.parse(line); } catch { console.error(`${wire.label} emitted a non-JSON line; it was ignored.`); return; }
      if (!isJson(message)) return;
      const id = typeof message.id === "string" || typeof message.id === "number" ? message.id : null;
      if (id !== null && typeof message.method === "string") { this.onRequest({ id, method: message.method, params: isJson(message.params) ? message.params : {} }); return; }
      if (id !== null) {
        const waiter = this.waiters.get(id);
        this.waiters.delete(id);
        if (!waiter) return;
        if (isJson(message.error)) waiter.reject(new CodexRpcError(typeof message.error.message === "string" ? message.error.message.slice(0, 2000) : `${wire.label} rejected the request.`,
          typeof message.error.code === "number" ? message.error.code : null));
        else waiter.resolve(message.result);
        return;
      }
      if (typeof message.method === "string") this.onNotification(message.method, isJson(message.params) ? message.params : {});
    });
  }
  static spawn(executable: string, cwd: string, environment: Record<string, string>): CodexAppServer {
    return new CodexAppServer(CodexAppServer.spawnWith(executable, ["app-server"], cwd, environment));
  }
  /** A harness process in its own process group, so its probe or turn can be cleaned up as a group. */
  static spawnWith(executable: string, args: string[], cwd: string, environment: Record<string, string>): ChildProcess {
    return spawn(executable, args, { cwd, env: environment, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
  }
  private write(value: Json): void { if (!this.closed && this.child.stdin?.writable) this.child.stdin.write(`${JSON.stringify(this.wire.jsonrpc ? { jsonrpc: "2.0", ...value } : value)}\n`); }
  request(method: string, params: Json): Promise<unknown> {
    if (this.closed) return Promise.reject(new CodexRpcError(`${this.wire.label} is closed.`, null));
    const id = ++this.counter;
    return new Promise((resolve, reject) => { this.waiters.set(id, { resolve, reject }); this.write({ id, method, params }); });
  }
  notify(method: string, params?: Json): void { this.write(params ? { method, params } : { method }); }
  respond(id: string | number, result: unknown): void { this.write({ id, result }); }
  error(id: string | number, code: number, message: string): void { this.write({ id, error: { code, message } }); }
  /** The documented handshake: initialize, then the `initialized` notification. Returns the server user agent. */
  async initialize(version: string): Promise<string> {
    const result = await this.request("initialize", { clientInfo: { name: "moguri", title: "Moguri", version },
      capabilities: { experimentalApi: true, optOutNotificationMethods: ["turn/diff/updated"] } });
    this.notify("initialized");
    return isJson(result) && typeof result.userAgent === "string" ? result.userAgent.slice(0, 256) : "";
  }
  private fail(message: string): void {
    this.closed = true;
    for (const waiter of this.waiters.values()) waiter.reject(new CodexRpcError(message, null));
    this.waiters.clear();
  }
  close(): void { this.child.stdin?.end(); }
}
/** Codex reports its version inside the app-server user agent, e.g. `codex_cli_rs/0.130.0 (Mac OS 15.0; arm64)`. */
export function parseCodexVersion(userAgent: string): string | null {
  const match = /\/(\d+)\.(\d+)\.(\d+)/.exec(userAgent) ?? /\b(\d+)\.(\d+)\.(\d+)\b/.exec(userAgent);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}
