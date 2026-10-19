import { createServer, type Server } from "node:http";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthClientInformationFullSchema, OAuthClientInformationSchema, OAuthTokensSchema, type OAuthClientInformationMixed, type OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { isRecord, MoguriError, type McpAuthorization, type McpServerConfig } from "../../../packages/protocol/src/index.ts";
import type { SecretVault } from "./gateway.ts";

interface Bundle {
  version: 1; resource: string; client?: OAuthClientInformationMixed; tokens?: OAuthTokens;
  redirectUri?: string; obtainedAt?: number;
  authorizationId?: string;
}
interface Pending {
  value: McpAuthorization; url: string | null; state: string; verifier: string; callback: Server;
  abort: AbortController; timer?: ReturnType<typeof setTimeout>; completion?: Promise<void>;
  cleanupUnconfirmed?: boolean;
}
export interface OAuthOptions { fetch?: typeof fetch; ttlMs?: number; now?: () => number }
export class McpOAuth {
  private pending = new Map<string, Pending>();
  private refreshes = new Map<string, Promise<string>>();
  private starting = new Map<string, { value: McpAuthorization; abort: AbortController; done: Promise<string> }>();
  constructor(private readonly vault: SecretVault, private readonly changed: (value: McpAuthorization) => void, private readonly options: OAuthOptions = {}, private readonly authorized: (id: string) => boolean = () => false) {}
  private now() { return this.options.now?.() ?? Date.now(); }
  busy(serverId: string): boolean { return this.starting.has(serverId) || [...this.pending.values()].some((entry) => entry.value.serverId === serverId && ["waiting", "exchanging"].includes(entry.value.state)); }
  private resource(server: McpServerConfig): string {
    if (server.transport.type !== "http" || server.transport.auth !== "oauth") throw new MoguriError("mcp_oauth", "Choose an HTTP MCP with OAuth authentication.");
    return new URL(server.transport.url).href;
  }
  key(server: McpServerConfig): string { return `oauth-${createHash("sha256").update(`${server.id}\0${this.resource(server)}`).digest("hex")}`; }
  private endpoint(input: string | URL): URL {
    let url: URL;
    try { url = new URL(input); } catch { throw new MoguriError("mcp_oauth_endpoint", "OAuth requires a valid HTTPS or explicit loopback HTTP URL."); }
    if (url.username || url.password || url.hash || url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) throw new MoguriError("mcp_oauth_endpoint", "OAuth endpoints require HTTPS or explicit loopback HTTP, without URL credentials.");
    return url;
  }
  private callbackUrl(input: string): URL {
    let url: URL;
    try { url = new URL(input); } catch { throw new MoguriError("mcp_oauth_callback", "Use a valid fixed loopback redirect URI."); }
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/oauth/callback" || !url.port || url.username || url.password || url.search || url.hash) throw new MoguriError("mcp_oauth_callback", "Use an exact http://127.0.0.1:PORT/oauth/callback redirect with a fixed available loopback port.");
    return url;
  }
  private async load(server: McpServerConfig, signal: AbortSignal): Promise<Bundle> {
    let text: string | null;
    try { text = await this.vault.read(this.key(server), signal); }
    catch { throw new MoguriError("secret_store", "OAuth keychain access failed. Unlock the configured secret backend; no plaintext fallback exists.", 503); }
    if (!text) return { version: 1, resource: this.resource(server) };
    try {
      const value: unknown = JSON.parse(text);
      if (!isRecord(value) || value.version !== 1 || value.resource !== this.resource(server) || value.redirectUri !== undefined && typeof value.redirectUri !== "string" || value.obtainedAt !== undefined && typeof value.obtainedAt !== "number" || value.authorizationId !== undefined && typeof value.authorizationId !== "string") throw new Error("Invalid bundle");
      const client = value.client ? OAuthClientInformationFullSchema.safeParse(value.client) : null;
      return { version: 1, resource: value.resource, ...(value.client ? { client: client?.success ? client.data : OAuthClientInformationSchema.parse(value.client) } : {}), ...(value.tokens ? { tokens: OAuthTokensSchema.parse(value.tokens) } : {}), ...(typeof value.redirectUri === "string" ? { redirectUri: value.redirectUri } : {}), ...(typeof value.obtainedAt === "number" ? { obtainedAt: value.obtainedAt } : {}), ...(typeof value.authorizationId === "string" ? { authorizationId: value.authorizationId } : {}) };
    } catch { throw new MoguriError("mcp_oauth_state", "Stored OAuth state is invalid. Preserve diagnostics and reconnect explicitly; no credential was guessed.", 409); }
  }
  private async save(server: McpServerConfig, bundle: Bundle, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const text = JSON.stringify(bundle);
    if (Buffer.byteLength(text) > 64 * 1024) throw new MoguriError("mcp_oauth_limit", "OAuth credential metadata exceeded its 64 KiB bound.");
    try { await this.vault.write(this.key(server), text, signal); }
    catch { throw new MoguriError("secret_store", "OAuth credentials could not be stored in the configured secret backend. No plaintext fallback was used.", 503); }
    signal.throwIfAborted();
  }
  private provider(server: McpServerConfig, bundle: Bundle, signal: AbortSignal, pending?: Pending): OAuthClientProvider {
    const provider: OAuthClientProvider = {
      redirectUrl: bundle.redirectUri,
      clientMetadata: { client_name: "Moguri", redirect_uris: bundle.redirectUri ? [bundle.redirectUri] : [], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" },
      state: () => { if (!pending) throw new MoguriError("mcp_auth_required", "OAuth login is required. Start it explicitly in MCP settings.", 401); return pending.state; },
      clientInformation: () => { if (!pending && !bundle.client) throw new MoguriError("mcp_auth_required", "The OAuth client must be registered through an explicit login.", 401); return bundle.client; },
      saveClientInformation: async (client) => { signal.throwIfAborted(); if (!pending && !bundle.client) throw new MoguriError("mcp_auth_required", "Start OAuth login explicitly.", 401); bundle.client = client; await this.save(server, bundle, signal); },
      tokens: () => bundle.tokens,
      saveTokens: async (tokens) => {
        signal.throwIfAborted();
        if (tokens.token_type.toLowerCase() !== "bearer" || tokens.access_token.length > 32768) throw new MoguriError("mcp_oauth_tokens", "This MCP returned an unsupported token type or oversized access token.");
        bundle.tokens = tokens; bundle.obtainedAt = this.now();
        if (pending) bundle.authorizationId = pending.value.id;
        else await this.save(server, bundle, signal);
      },
      saveCodeVerifier: (verifier) => { if (!pending) throw new MoguriError("mcp_auth_required", "OAuth refresh could not complete. Reconnect explicitly.", 401); pending.verifier = verifier; },
      codeVerifier: () => { if (!pending?.verifier) throw new MoguriError("mcp_oauth_state", "This OAuth callback has no owned PKCE verifier.", 409); return pending.verifier; },
      redirectToAuthorization: (url) => { if (!pending) throw new MoguriError("mcp_auth_required", "OAuth refresh needs a new explicit login.", 401); pending.url = this.endpoint(url).href; pending.value.authorizationUrlReady = true; },
      invalidateCredentials: async (scope) => {
        if (scope === "all" || scope === "client") delete bundle.client;
        if (scope === "all" || scope === "tokens" || scope === "client") { delete bundle.tokens; delete bundle.obtainedAt; }
        if (scope === "verifier" && pending) pending.verifier = "";
        await this.save(server, bundle, signal);
      },
    };
    return provider;
  }
  private fetcher(signal: AbortSignal): typeof fetch {
    return (input, init) => { this.endpoint(input instanceof Request ? input.url : input); return (this.options.fetch ?? fetch)(input, { ...init, redirect: "error", signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(20_000)]) }); };
  }
  async status(server: McpServerConfig): Promise<{ configured: boolean; expiresAt: number | null }> {
    const bundle = await this.load(server, AbortSignal.timeout(15_000));
    return { configured: Boolean(bundle.tokens?.access_token && bundle.authorizationId && this.authorized(bundle.authorizationId)), expiresAt: bundle.tokens?.expires_in !== undefined && bundle.obtainedAt !== undefined ? bundle.obtainedAt + bundle.tokens.expires_in * 1000 : null };
  }
  async access(server: McpServerConfig, signal: AbortSignal): Promise<string> {
    if (this.busy(server.id)) throw new MoguriError("mcp_oauth_busy", "Finish or cancel this MCP's explicit OAuth login before using its tools.", 409);
    const key = this.key(server);
    const active = this.refreshes.get(key); if (active) return active;
    const task = (async () => {
      const bundle = await this.load(server, signal);
      if (!bundle.tokens?.access_token || !bundle.authorizationId || !this.authorized(bundle.authorizationId)) throw new MoguriError("mcp_auth_required", "This MCP requires an explicit OAuth login. Open MCP settings; no anonymous fallback was used.", 401);
      const expires = bundle.tokens.expires_in !== undefined && bundle.obtainedAt !== undefined ? bundle.obtainedAt + bundle.tokens.expires_in * 1000 : null;
      if (expires === null || expires - this.now() > 30_000) return bundle.tokens.access_token;
      if (!bundle.tokens.refresh_token) throw new MoguriError("mcp_auth_required", "The OAuth grant expired. Reconnect explicitly.", 401);
      try {
        const result = await auth(this.provider(server, bundle, signal), { serverUrl: bundle.resource, fetchFn: this.fetcher(signal) });
        if (result !== "AUTHORIZED" || !bundle.tokens?.access_token) throw new Error("Authorization required");
        return bundle.tokens.access_token;
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (error instanceof MoguriError) throw error;
        throw new MoguriError("mcp_auth_required", "OAuth refresh failed or was revoked. Reconnect explicitly; no tool call was retried.", 401);
      }
    })().finally(() => this.refreshes.delete(key));
    this.refreshes.set(key, task); return task;
  }
  private transition(pending: Pending, state: McpAuthorization["state"], diagnostic: string | null = null) {
    pending.value = { ...pending.value, state, diagnostic, authorizationUrlReady: state === "waiting" && Boolean(pending.url) }; this.changed({ ...pending.value });
  }
  async begin(server: McpServerConfig, scope: { projectId: string | null; sessionId: string | null }): Promise<string> {
    if (this.busy(server.id)) throw new MoguriError("mcp_oauth_busy", "An OAuth login for this MCP is already pending. Finish or cancel it first.", 409);
    const abort = new AbortController();
    const value: McpAuthorization = { id: randomUUID(), serverId: server.id, ...scope, state: "waiting", expiresAt: this.now() + (this.options.ttlMs ?? 600_000), diagnostic: null };
    const done = this.beginLogin(server, value, abort);
    this.starting.set(server.id, { value, abort, done });
    this.changed({ ...value });
    try { return await done; }
    catch (error) {
      if (abort.signal.aborted && !this.pending.has(value.id)) {
        this.changed({ ...value, state: "cancelled", diagnostic: "OAuth setup cancelled before a callback was admitted." });
        throw new MoguriError("mcp_oauth_cancelled", "OAuth setup cancelled before a callback was admitted.", 409);
      }
      else if (!this.pending.has(value.id)) this.changed({ ...value, state: "failed", diagnostic: "OAuth setup failed. Check the secret backend, callback port and registered client." });
      throw error;
    } finally { this.starting.delete(server.id); }
  }
  private async beginLogin(server: McpServerConfig, value: McpAuthorization, abort: AbortController): Promise<string> {
    const bundle = await this.load(server, abort.signal);
    abort.signal.throwIfAborted();
    let port = 0;
    if (bundle.redirectUri) {
      const previous = this.callbackUrl(bundle.redirectUri);
      port = Number(previous.port);
    }
    const callback = createServer();
    try { await new Promise<void>((resolve, reject) => { callback.once("error", reject); callback.listen(port, "127.0.0.1", () => { callback.off("error", reject); resolve(); }); }); }
    catch { throw new MoguriError("mcp_oauth_callback", "The OAuth callback port is unavailable. Cancel another login or clear this OAuth connection and reconnect explicitly.", 409); }
    const address = callback.address();
    if (!address || typeof address === "string") { callback.close(); throw new MoguriError("mcp_oauth_callback", "The owned OAuth callback could not bind."); }
    if (abort.signal.aborted) { callback.close(); throw new MoguriError("mcp_oauth_cancelled", "OAuth setup cancelled.", 409); }
    bundle.redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
    delete bundle.tokens; delete bundle.obtainedAt; delete bundle.authorizationId;
    const pending: Pending = {
      value,
      url: null, state: randomBytes(32).toString("base64url"), verifier: "", callback, abort,
    };
    this.pending.set(pending.value.id, pending);
    for (const [id, previous] of [...this.pending].slice(0, -128)) if (!["waiting", "exchanging"].includes(previous.value.state)) this.pending.delete(id);
    const close = () => { clearTimeout(pending.timer); pending.verifier = ""; pending.url = null; callback.removeAllListeners("request"); if (abort.signal.aborted) callback.closeAllConnections(); callback.close(); };
    callback.on("request", (request, response) => {
      let url: URL;
      try { url = new URL(request.url ?? "/", bundle.redirectUri); }
      catch { response.writeHead(400).end("Invalid OAuth callback URL."); return; }
      const state = url.searchParams.get("state") ?? "";
      if (request.method !== "GET" || request.headers.host !== `127.0.0.1:${address.port}` || url.origin !== `http://127.0.0.1:${address.port}` || url.pathname !== "/oauth/callback" || !["waiting"].includes(pending.value.state) || pending.value.expiresAt !== null && this.now() >= pending.value.expiresAt || Buffer.byteLength(state) !== Buffer.byteLength(pending.state) || !timingSafeEqual(Buffer.from(state), Buffer.from(pending.state))) { response.writeHead(400, { "Content-Type": "text/plain" }).end("Invalid or expired OAuth callback."); return; }
      const code = url.searchParams.get("code");
      if (!code || code.length > 8192 || url.searchParams.has("error")) { response.writeHead(400).end("OAuth authorization was not completed."); this.transition(pending, "failed", "Authorization was denied or returned an invalid callback."); close(); return; }
      this.transition(pending, "exchanging");
      pending.completion = (async () => {
        let storing = false;
        try {
          const result = await auth(this.provider(server, bundle, abort.signal, pending), { serverUrl: bundle.resource, authorizationCode: code, fetchFn: this.fetcher(abort.signal) });
          abort.signal.throwIfAborted();
          if (result !== "AUTHORIZED") throw new Error("Authorization incomplete");
          storing = true;
          await this.save(server, bundle, abort.signal);
          abort.signal.throwIfAborted();
          this.transition(pending, "connected");
          response.writeHead(200, { "Content-Type": "text/plain", "Content-Security-Policy": "default-src 'none'", "Cache-Control": "no-store" }).end("MCP authorization complete. Return to Moguri.");
        } catch {
          if (storing) {
            delete bundle.tokens; delete bundle.obtainedAt; delete bundle.authorizationId;
            try { await this.save(server, bundle, AbortSignal.timeout(15_000)); }
            catch {
              pending.cleanupUnconfirmed = true;
              console.error("MCP OAuth credential cleanup is unconfirmed; this grant cannot be used without a durable connected decision.");
              this.transition(pending, "failed", "Credential storage/cleanup is unconfirmed. Clear this OAuth connection explicitly before reconnecting.");
            }
          }
          if (!abort.signal.aborted && !pending.cleanupUnconfirmed) this.transition(pending, "failed", "OAuth token exchange failed. Check the configured issuer/client and start a new login.");
          if (!response.headersSent) response.writeHead(400).end("OAuth exchange was not completed.");
        } finally { close(); }
      })();
    });
    pending.timer = setTimeout(() => { abort.abort(); this.transition(pending, "expired", "OAuth login expired. Start a new explicit login."); close(); }, this.options.ttlMs ?? 600_000);
    pending.timer.unref();
    this.changed({ ...pending.value });
    try {
      await this.save(server, bundle, abort.signal);
      const result = await auth(this.provider(server, bundle, abort.signal, pending), { serverUrl: bundle.resource, fetchFn: this.fetcher(abort.signal) });
      if (result !== "REDIRECT" || !pending.url) throw new Error("Missing authorization URL");
      this.changed({ ...pending.value });
      return pending.value.id;
    } catch {
      if (abort.signal.aborted) { close(); throw new MoguriError("mcp_oauth_cancelled", "OAuth login was cancelled or expired. Start again explicitly.", 409); }
      abort.abort(); this.transition(pending, "failed", "OAuth discovery or client registration failed. Check this server's OAuth metadata or configure a registered client.");
      close(); throw new MoguriError("mcp_oauth_failed", pending.value.diagnostic!, 409);
    }
  }
  get(id: string): { authorization: McpAuthorization; url: string | null } {
    const pending = this.pending.get(id);
    if (!pending) {
      const starting = [...this.starting.values()].find((entry) => entry.value.id === id);
      if (starting) return { authorization: { ...starting.value }, url: null };
      throw new MoguriError("mcp_oauth_missing", "This login is no longer active. Restart never replays OAuth callbacks.", 404);
    }
    return { authorization: { ...pending.value }, url: pending.url };
  }
  async cancel(id: string): Promise<void> {
    const pending = this.pending.get(id);
    if (!pending) {
      const starting = [...this.starting.values()].find((entry) => entry.value.id === id);
      if (starting) { starting.abort.abort(); await Promise.allSettled([starting.done]); return; }
      throw new MoguriError("mcp_oauth_missing", "This login no longer exists.", 404);
    }
    const active = ["waiting", "exchanging"].includes(pending.value.state);
    if (active) { pending.abort.abort(); clearTimeout(pending.timer); pending.callback.removeAllListeners("request"); pending.callback.closeAllConnections(); pending.callback.close(); }
    await pending.completion;
    if (pending.cleanupUnconfirmed) throw new MoguriError("mcp_oauth_partial", "OAuth credential cleanup is unconfirmed. Clear the connection explicitly; the unconfirmed grant is blocked.", 409);
    if (active) { pending.verifier = ""; pending.url = null; this.transition(pending, "cancelled", "OAuth login cancelled. No callback or token exchange is replayed."); }
  }
  async clear(server: McpServerConfig): Promise<void> {
    const starting = this.starting.get(server.id);
    if (starting) { starting.abort.abort(); await Promise.allSettled([starting.done]); }
    for (const pending of this.pending.values()) if (pending.value.serverId === server.id) {
      try { await this.cancel(pending.value.id); }
      catch (error) { if (!(error instanceof MoguriError && error.code === "mcp_oauth_partial")) throw error; }
    }
    if (await this.vault.read(this.key(server), AbortSignal.timeout(15_000)) !== null) await this.vault.remove(this.key(server), AbortSignal.timeout(15_000));
    for (const pending of this.pending.values()) if (pending.value.serverId === server.id) pending.cleanupUnconfirmed = false;
  }
  async setClient(server: McpServerConfig, clientId: string, issuer: string, clientSecret?: string, redirectUri?: string): Promise<void> {
    const starting = this.starting.get(server.id);
    if (starting) { starting.abort.abort(); await Promise.allSettled([starting.done]); }
    for (const pending of this.pending.values()) if (pending.value.serverId === server.id) await this.cancel(pending.value.id);
    this.endpoint(issuer);
    const bundle = await this.load(server, AbortSignal.timeout(15_000));
    if (redirectUri) bundle.redirectUri = this.callbackUrl(redirectUri).href;
    bundle.client = { client_id: clientId, issuer, ...(clientSecret ? { client_secret: clientSecret } : {}) }; delete bundle.tokens; delete bundle.obtainedAt; delete bundle.authorizationId;
    await this.save(server, bundle, AbortSignal.timeout(15_000));
  }
  async cancelScope(projectId: string | null, sessionId?: string): Promise<void> {
    const starting = [...this.starting.values()].filter((entry) => sessionId ? entry.value.sessionId === sessionId : entry.value.projectId === projectId);
    for (const entry of starting) entry.abort.abort();
    await Promise.allSettled(starting.map((entry) => entry.done));
    for (const pending of this.pending.values()) if (sessionId ? pending.value.sessionId === sessionId : pending.value.projectId === projectId) await this.cancel(pending.value.id);
  }
  async close(): Promise<void> {
    for (const entry of this.starting.values()) entry.abort.abort();
    await Promise.allSettled([...this.starting.values()].map((entry) => entry.done));
    await Promise.all([...this.pending.keys()].map((id) => this.cancel(id))); this.pending.clear();
  }
}
