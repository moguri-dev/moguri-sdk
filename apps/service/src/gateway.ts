import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { AsyncEntry } from "@napi-rs/keyring";
import { isRecord, MoguriError, type McpToolInfo, type McpServerConfig } from "../../../packages/protocol/src/index.ts";
import type { McpOperation } from "./mcp-worker.ts";
import { McpOAuth, type OAuthOptions } from "./mcp-oauth.ts";
import { runMcpConnector } from "./mcp-process.ts";
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
  async workerDigest(): Promise<string> { return createHash("sha256").update(await readFile(this.workerPath)).digest("hex"); }
  async accessToken(server: McpServerConfig | null, signal: AbortSignal): Promise<string | null> {
    signal.throwIfAborted();
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
    const token = server?.transport.type === "http" && server.transport.auth === "bearer" ? await this.vault.read(server.id, bounded) :
      server?.transport.type === "http" && server.transport.auth === "oauth" ? await this.oauth.access(server, signal) : null;
    signal.throwIfAborted();
    if (server?.transport.type === "http" && server.transport.auth === "bearer" && !token) throw new MoguriError("mcp_auth_required", "Configure this server's bearer credential in the OS keychain. No unauthenticated fallback was attempted.", 401);
    return token;
  }
  async operate(operation: Omit<McpOperation, "token">, requested: AbortSignal, owner?: string, guard?: () => void): Promise<unknown> {
    const abort = new AbortController();
    const signal = AbortSignal.any([requested, abort.signal]);
    this.active.add(abort);
    const task = this.execute(operation, signal, guard);
    this.tasks.add(task);
    this.contexts.set(abort, { task, root: operation.root, owner });
    try { return await task; }
    finally { this.active.delete(abort); this.tasks.delete(task); this.contexts.delete(abort); }
  }
  private async execute(operation: Omit<McpOperation, "token">, signal: AbortSignal, guard?: () => void): Promise<unknown> {
    signal.throwIfAborted();
    guard?.();
    const token = await this.accessToken(operation.server, signal);
    signal.throwIfAborted();
    guard?.();
    return runMcpConnector({ ...operation, ...(token ? { token } : {}) }, this.workerPath, signal);
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
