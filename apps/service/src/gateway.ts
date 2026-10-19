import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AsyncEntry } from "@napi-rs/keyring";
import { isRecord, MoguriError, type McpToolInfo, type McpServerConfig } from "../../../packages/protocol/src/index.ts";
import type { McpOperation } from "./mcp-worker.ts";
import { McpOAuth, type OAuthOptions } from "./mcp-oauth.ts";
import type { McpAuthorization } from "../../../packages/protocol/src/index.ts";

export interface SecretVault { read(id: string, signal?: AbortSignal): Promise<string | null>; write(id: string, value: string, signal?: AbortSignal): Promise<void>; remove(id: string, signal?: AbortSignal): Promise<void> }
export class McpKeychain implements SecretVault {
  constructor(private readonly namespace = "dev.moguri.profile.default.mcp") {}
  private entry(id: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(id)) throw new MoguriError("secret_scope", "Invalid MCP credential namespace.");
    return new AsyncEntry(this.namespace, id, { linux: { store: "secret-service" } });
  }
  read(id: string, signal?: AbortSignal) { return this.entry(id).getPassword(signal); }
  write(id: string, value: string, signal?: AbortSignal) { return this.entry(id).setPassword(value, signal); }
  async remove(id: string, signal?: AbortSignal) { await this.entry(id).deleteCredential(signal); }
}
export class McpGateway {
  readonly oauth: McpOAuth;
  private active = new Set<AbortController>();
  private tasks = new Set<Promise<unknown>>();
  private contexts = new Map<AbortController, { task: Promise<unknown>; root: string; owner?: string }>();
  constructor(readonly vault: SecretVault = new McpKeychain(), private readonly workerPath = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./mcp-worker.ts" : "./mcp-worker.mjs", import.meta.url)), options: { oauth?: OAuthOptions; changed?: (value: McpAuthorization) => void; authorized?: (id: string) => boolean } = {}) {
    this.oauth = new McpOAuth(vault, options.changed ?? (() => {}), options.oauth, options.authorized);
  }
  get busy(): boolean { return this.active.size > 0; }
  async operate(operation: Omit<McpOperation, "token">, requested: AbortSignal, owner?: string): Promise<unknown> {
    const abort = new AbortController();
    const signal = AbortSignal.any([requested, abort.signal]);
    this.active.add(abort);
    const task = this.execute(operation, signal);
    this.tasks.add(task);
    this.contexts.set(abort, { task, root: operation.root, owner });
    try { return await task; }
    finally { this.active.delete(abort); this.tasks.delete(task); this.contexts.delete(abort); }
  }
  private async execute(operation: Omit<McpOperation, "token">, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const token = operation.server?.transport.type === "http" && operation.server.transport.auth === "bearer" ? await this.vault.read(operation.server.id, AbortSignal.any([signal, AbortSignal.timeout(15_000)])) : operation.server?.transport.type === "http" && operation.server.transport.auth === "oauth" ? await this.oauth.access(operation.server, signal) : null;
    signal.throwIfAborted();
    if (operation.server?.transport.type === "http" && operation.server.transport.auth === "bearer" && !token) throw new MoguriError("mcp_auth_required", "Configure this server's bearer credential in the OS keychain. No unauthenticated fallback was attempted.", 401);
    return new Promise((resolve, reject) => {
      const child = fork(this.workerPath, [], {
        execPath: process.execPath, execArgv: [...(this.workerPath.endsWith(".ts") ? ["--import", "tsx"] : []), "--max-old-space-size=128"],
        detached: true, stdio: ["ignore", "ignore", "pipe", "ipc"],
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
      });
      child.stderr?.resume();
      let settled = false;
      let received = false;
      let terminating = false;
      let result: unknown;
      let failure: Error | undefined;
      let force: ReturnType<typeof setTimeout> | undefined;
      let completion: ReturnType<typeof setTimeout> | undefined;
      let abandon: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => { clearTimeout(timer); clearTimeout(force); clearTimeout(completion); clearTimeout(abandon); signal.removeEventListener("abort", cancel); child.stderr?.destroy(); };
      const settle = (error?: Error) => { if (settled) return; settled = true; cleanup(); if (error) reject(error); else resolve(result); };
      const stopGroup = (kind: NodeJS.Signals) => {
        if (!child.pid) return;
        try { process.kill(-child.pid, kind); } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) console.error("Moguri MCP process-group cleanup is unconfirmed.");
        }
      };
      const fail = (error: Error) => {
        if (settled || terminating) return;
        terminating = true; failure = error; clearTimeout(completion); stopGroup("SIGTERM");
        if (!child.pid) { settle(error); return; }
        force = setTimeout(() => {
          stopGroup("SIGKILL");
          abandon = setTimeout(() => settle(error), 1000);
        }, 1000);
      };
      const cancel = () => fail(new MoguriError("mcp_cancelled", "MCP cancellation requested. Owned process-group cleanup and remote side effects may be partial."));
      const timer = setTimeout(() => fail(new MoguriError("mcp_timeout", "MCP operation exceeded its deadline. Remote effects and process cleanup are unconfirmed.")), 70_000);
      signal.addEventListener("abort", cancel, { once: true });
      child.once("error", () => fail(new MoguriError("mcp_worker", "The MCP connector could not start. Rebuild the SDK.")));
      child.once("message", (message: unknown) => {
        if (settled || terminating || received) return;
        if (!isRecord(message) || typeof message.ok !== "boolean") { fail(new MoguriError("mcp_protocol", "MCP connector returned an invalid response.")); return; }
        received = true;
        if (message.ok) result = message.result;
        else failure = new MoguriError("mcp_failed", typeof message.error === "string" ? message.error : "MCP connection or tool call failed.");
        completion = setTimeout(() => fail(new MoguriError("mcp_cleanup", "The MCP connector returned data but did not shut down. Owned process cleanup and external effects may be partial.")), 1000);
      });
      child.once("exit", (code) => {
        if (failure) settle(failure);
        else if (received && code === 0) settle();
        else settle(new MoguriError("mcp_worker", "MCP connector exited before confirming its result and shutdown. No operation was retried."));
      });
      child.send({ ...operation, ...(token ? { token } : {}) }, (error) => { if (error) fail(new MoguriError("mcp_worker", "The MCP connector IPC channel failed. No operation was retried.")); });
      if (signal.aborted) cancel();
    });
  }
  async tools(server: McpServerConfig | null, root: string, signal: AbortSignal, scripts?: McpOperation["scripts"], owner?: string): Promise<McpToolInfo[]> {
    const result = await this.operate({ action: "tools", server, root, scripts }, signal, owner);
    if (!Array.isArray(result) || !result.every((tool) => isRecord(tool) && typeof tool.name === "string" && typeof tool.digest === "string" && isRecord(tool.inputSchema))) throw new MoguriError("mcp_protocol", "MCP tool discovery returned an invalid catalog.");
    return result as McpToolInfo[];
  }
  async close(): Promise<void> { for (const abort of this.active) abort.abort(); await Promise.allSettled([...this.tasks]); await this.oauth.close(); }
  async cancelOwner(id: string): Promise<void> { const owned = [...this.contexts].filter(([, context]) => context.owner === id); for (const [abort] of owned) abort.abort(); await Promise.allSettled(owned.map(([, context]) => context.task)); }
  async cancelRoot(root: string): Promise<void> { const owned = [...this.contexts].filter(([, context]) => context.root === root); for (const [abort] of owned) abort.abort(); await Promise.allSettled(owned.map(([, context]) => context.task)); }
}
