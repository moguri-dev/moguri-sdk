import { createHash } from "node:crypto";
import type { Model } from "@earendil-works/pi-ai";
import { agentHarnessName, agentHarnessOf, hostedProviderOfModel, type HostedProviderId, defaultModelPreferences, modelCatalogue, selectableModels, isRecord, ModelEvidenceReportSchema, MoguriError, parse, type Controls, type LocalEndpoint, type ModelInfo, type ModelOffering, type ModelPreferences, type ModelProvider, type ProviderConnection, type ProviderState } from "../../../packages/protocol/src/index.ts";
import { McpKeychain, type SecretVault } from "./gateway.ts";
import type { PreparedModel, ProviderAdapter } from "./provider.ts";
import { HostedAccount, hostedSecretId, type HostedAccountOptions } from "./hosted-providers.ts";

/** An external agent harness (Claude Code, Codex): selectable sessions, never direct model access. */
export interface AgentHarnessProvider {
  readonly id: string; readonly enabled: boolean; readonly current: unknown; onChange: () => void;
  provider(enabled: boolean): ModelProvider; offerings(enabled: boolean): ModelOffering[];
  synchronize(): void; refresh(signal?: AbortSignal): Promise<void>; close(): Promise<void>;
}

export interface ModelRegistryOptions {
  vault?: SecretVault; fetch?: typeof fetch; idPrefix?: () => string; environments?: Controls["env"][];
  additional?: ModelRegistry; includeCopilot?: boolean; copilotEnvironments?: () => Controls["env"][];
  localEnvironments?: (endpoint: LocalEndpoint) => Controls["env"][];
  preferences?: () => ModelPreferences; scope?: "local" | "remote"; nested?: boolean; ready?: () => boolean;
  agents?: AgentHarnessProvider[];
  /** Hosted providers the user connected (OpenRouter, Anthropic API, OpenAI API, ChatGPT). Only these ever read the secret backend. */
  hosted?: Partial<HostedAccountOptions> & { providers?: () => readonly HostedProviderId[] };
}
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
export const localModelId = (endpointId: string, modelId: string, prefix = "local") => `${prefix}.${endpointId}.${createHash("sha256").update(modelId).digest("hex").slice(0, 24)}`;
export function localEndpointUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value.endsWith("/") ? value : `${value}/`); }
  catch { throw new MoguriError("local_model_url", "Use a valid local-model API base URL."); }
  if (url.username || url.password || url.search || url.hash || url.protocol !== "https:" && !(url.protocol === "http:" && loopbackHosts.has(url.hostname))) throw new MoguriError("local_model_url", "Local model endpoints require HTTPS or explicit loopback HTTP, without credentials, query or fragment.");
  return url;
}
export const modelEndpointBoundary = (value: string): "loopback" | "network" => loopbackHosts.has(localEndpointUrl(value).hostname) ? "loopback" : "network";
/** Header names that carry credentials; their values must come from the secret backend, never plain settings. */
const sensitiveHeader = /^(?:authorization|proxy-authorization|cookie|set-cookie)$|key|token|secret|password|session|signature|credential/i;
const reservedHeader = /^(?:host|content-length|content-type|connection|transfer-encoding|accept-encoding|upgrade|te|trailer|keep-alive)$/i;
export function endpointHeaders(endpoint: LocalEndpoint, key: string | null): Record<string, string> {
  return { ...endpoint.headers, ...(key ? endpoint.auth === "header" ? { [endpoint.authHeader!]: key } : { Authorization: `Bearer ${key}` } : {}) };
}
export function validateLocalEndpoints(endpoints: LocalEndpoint[], options: { remote?: boolean } = {}): void {
  if (new Set(endpoints.map((endpoint) => endpoint.id)).size !== endpoints.length) throw new MoguriError("local_model_id", "Local endpoint IDs must be unique.");
  for (const endpoint of endpoints) {
    localEndpointUrl(endpoint.baseUrl);
    if (options.remote && (endpoint.auth === "header" || endpoint.headers || endpoint.discovery === false)) {
      throw new MoguriError("remote_model_options", "SSH model endpoints support no auth or a bearer key with discovery. Custom headers and explicit-only models are Local endpoint options.");
    }
    if ((endpoint.auth === "header") !== (endpoint.authHeader !== undefined)) throw new MoguriError("local_model_auth", "Header authentication needs exactly one header name, and only header authentication may set one.");
    if (endpoint.authHeader && reservedHeader.test(endpoint.authHeader)) throw new MoguriError("local_model_auth", "Choose a credential header name, not a transport header.");
    const names = Object.keys(endpoint.headers ?? {}).map((name) => name.toLowerCase());
    if (names.some((name) => sensitiveHeader.test(name))) throw new MoguriError("local_model_headers", "Credential headers (authorization, keys, tokens, cookies, secrets) belong in the secret backend. Use header authentication instead.");
    if (names.some((name) => reservedHeader.test(name)) || new Set(names).size !== names.length ||
      endpoint.authHeader && names.includes(endpoint.authHeader.toLowerCase())) throw new MoguriError("local_model_headers", "Use unique custom header names that do not override transport or authentication headers.");
    if (new Set(endpoint.models.map((model) => model.id)).size !== endpoint.models.length || endpoint.models.some((model) => model.maxTokens >= model.contextWindow)) throw new MoguriError("local_model_limits", "Use unique model IDs and an output limit strictly smaller than each declared context window.");
  }
}
export class ModelRegistry implements ProviderAdapter {
  state: ProviderState;
  onChange = () => {};
  private readonly vault: SecretVault;
  private local = new Map<string, { connection: ProviderConnection; models: ModelInfo[] }>();
  private discovery = new AbortController();
  private task?: Promise<void>;
  private localPending = false;
  private refreshing?: { signature: string; task: Promise<void> };
  private epoch = 0;
  private signature: string;
  private closed = false;
  private copilotDiscoveryFailure?: string;
  constructor(private readonly copilot: ProviderAdapter, private readonly endpoints: () => LocalEndpoint[], private readonly options: ModelRegistryOptions = {}) {
    this.vault = options.vault ?? new McpKeychain("dev.moguri.profile.default.models");
    this.signature = this.configurationSignature();
    this.state = { ...copilot.state };
    copilot.onChange = () => { this.copilotDiscoveryFailure = undefined; this.publish(); };
    if (options.additional) options.additional.onChange = () => this.publish();
    for (const agent of options.agents ?? []) agent.onChange = () => this.publish();
    this.syncHosted(false);
    this.publish(false);
  }
  private get prefix() { return this.options.idPrefix?.() ?? "local"; }
  private readonly hosted = new Map<HostedProviderId, HostedAccount>();
  /** The account for a provider the user is connecting now; it joins the persisted list when the command commits. */
  hostedAccount(id: HostedProviderId): HostedAccount {
    if (!this.options.hosted) throw new MoguriError("hosted_unavailable", "Hosted providers are configured only in a profile's Local model registry.", 409);
    let account = this.hosted.get(id);
    if (!account) {
      const options = this.options.hosted;
      account = new HostedAccount(id, this.vault, { baseUrls: options.baseUrls, providerOptions: options.providerOptions, deviceId: options.deviceId ?? (() => { throw new Error("No installation ID is configured."); }) });
      account.onChange = () => this.publish();
      this.hosted.set(id, account);
    }
    return account;
  }
  private syncHosted(refresh: boolean): void {
    if (!this.options.hosted || this.closed) return;
    const desired = new Set(this.options.hosted.providers?.() ?? []);
    for (const id of desired) if (!this.hosted.has(id)) { const account = this.hostedAccount(id); if (refresh) void account.refresh().catch(() => {}); }
    for (const [id, account] of this.hosted) if (!desired.has(id) && !account.busy) { this.hosted.delete(id); void account.close(); this.publish(); }
  }
  get discovering(): boolean { return Boolean(this.refreshing || this.localPending || this.options.additional?.discovering); }
  private get preferences() { return this.options.preferences?.() ?? defaultModelPreferences(); }
  private enabled(id: string) { return !this.preferences.disabledProviders.includes(id); }
  private configurationSignature() { return JSON.stringify({ endpoints: this.endpoints().map((endpoint) => ({ ...endpoint, enabled: endpoint.enabled && this.enabled(`${this.prefix}.${endpoint.id}`) })), prefix: this.prefix, ready: this.options.ready?.() ?? true }); }
  private modelId(endpointId: string, modelId: string) { return localModelId(endpointId, modelId, this.prefix); }
  private publish(notify = true) {
    if (this.closed) return;
    const local = [...this.local.values()], providers: ModelProvider[] = [];
    const offerings: ModelOffering[] = [];
    if (this.options.includeCopilot !== false) {
      providers.push({ id: "github-copilot", name: "GitHub Copilot", source: "copilot", scope: "copilot", endpointId: null,
        enabled: this.enabled("github-copilot"), status: this.copilotDiscoveryFailure ? "error" : this.copilot.state.status, diagnostic: this.copilotDiscoveryFailure ?? this.copilot.state.diagnostic });
      offerings.push(...this.copilot.state.models.map((model) => ({ available: !this.copilotDiscoveryFailure && this.copilot.state.status === "connected", model: {
        ...model, providerId: model.providerId ?? "github-copilot", source: model.source ?? "copilot" as const, apiModelId: model.apiModelId ?? model.id,
        endpointBoundary: model.endpointBoundary ?? "network" as const, environments: this.options.copilotEnvironments?.() ?? ["Local"] } })));
    }
    for (const endpoint of this.endpoints()) {
      const id = `${this.prefix}.${endpoint.id}`, entry = this.local.get(endpoint.id), enabled = endpoint.enabled && this.enabled(id);
      providers.push({ id, name: endpoint.name, source: "local", scope: this.options.scope ?? "local", endpointId: endpoint.id, enabled,
        status: enabled ? entry?.connection.status ?? "disconnected" : "disconnected",
        diagnostic: enabled ? this.options.ready && !this.options.ready() ? "Probe the exact configured SSH peer before model discovery." : entry?.connection.diagnostic ?? "Refresh this configured endpoint before selecting a model." : "Provider disabled. Its configuration and credentials were retained." });
      for (const model of endpoint.models) {
        const modelId = this.modelId(endpoint.id, model.id), advertised = entry?.models.find((value) => value.id === modelId);
        const info: ModelInfo = { ...model, id: modelId, providerId: id, source: "local", apiModelId: model.id, endpointBoundary: modelEndpointBoundary(endpoint.baseUrl),
          thinkingLevels: [], kupoThinkingLevels: [], environments: this.options.localEnvironments?.(endpoint) ?? this.options.environments ?? ["Local"] };
        offerings.push({ model: advertised ? { ...advertised, environments: info.environments } : info, available: enabled && entry?.connection.status === "connected" && Boolean(advertised) });
      }
    }
    // An opted-out harness adds nothing to the inventory, preserving existing catalogues.
    for (const account of this.hosted.values()) {
      const enabled = this.enabled(account.id);
      providers.push(account.provider(enabled));
      offerings.push(...account.offerings(enabled));
    }
    for (const agent of this.options.agents ?? []) {
      if (!agent.enabled) continue;
      const enabled = this.enabled(agent.id);
      providers.push(agent.provider(enabled));
      offerings.push(...agent.offerings(enabled));
    }
    if (this.options.additional?.state.catalogue) {
      providers.push(...this.options.additional.state.catalogue.providers);
      offerings.push(...this.options.additional.state.catalogue.models.flatMap((entry) => entry.offerings));
    }
    const catalogue = modelCatalogue(providers, offerings, this.preferences);
    const models = this.options.preferences && !this.options.nested ? selectableModels(catalogue) :
      offerings.filter((entry) => entry.available && providers.some((provider) => provider.id === entry.model.providerId && provider.enabled)).map((entry) => entry.model);
    this.state = { ...this.copilot.state, status: models.length ? "connected" : this.copilotDiscoveryFailure ? "error" : this.copilot.state.status,
      ...(this.copilotDiscoveryFailure ? { diagnostic: this.copilotDiscoveryFailure } : {}), models, connections: providers, catalogue };
    if (!models.length && local.some((entry) => entry.connection.status === "error")) this.state = { ...this.state, status: this.copilot.state.status === "connecting" ? "connecting" : "error", diagnostic: "No usable model is available. Inspect the configured endpoint and Copilot connection diagnostics." };
    if (notify) this.onChange();
  }
  private endpoint(id: string): LocalEndpoint {
    const endpoint = this.endpoints().find((endpoint) => endpoint.id === id && endpoint.enabled && this.enabled(`${this.prefix}.${endpoint.id}`));
    if (!endpoint) throw new MoguriError("local_model_missing", "This local endpoint is no longer enabled. No other provider was selected.", 409);
    return endpoint;
  }
  // A header-auth key is also bound to its header name, so changing where the secret is sent requires entering it again.
  private key(endpoint: LocalEndpoint) { return `local-${createHash("sha256").update(`${this.prefix === "local" ? "" : `${this.prefix}\0`}${endpoint.id}\0${localEndpointUrl(endpoint.baseUrl).href}${endpoint.auth === "header" ? `\0header\0${endpoint.authHeader!.toLowerCase()}` : ""}`).digest("hex")}`; }
  private async credential(endpoint: LocalEndpoint, signal: AbortSignal): Promise<string | null> {
    if (endpoint.auth === "none") return null;
    let key: string | null;
    try { key = await this.vault.read(this.key(endpoint), signal); }
    catch { throw new MoguriError("local_model_secret", "The local-model secret backend is unavailable. Unlock it; no plaintext or ambient fallback exists.", 503); }
    signal.throwIfAborted();
    if (!key) throw new MoguriError("local_model_auth", "Store this endpoint's credential explicitly in its profile secret backend.", 401);
    return key;
  }
  private async inspect(endpoint: LocalEndpoint, signal: AbortSignal): Promise<{ models: ModelInfo[]; key: string | null }> {
    const key = await this.credential(endpoint, signal);
    const configured = (ids: Set<string>) => endpoint.models.filter((model) => ids.has(model.id)).map((model) => ({
      id: this.modelId(endpoint.id, model.id), name: model.name, contextWindow: model.contextWindow, maxTokens: model.maxTokens, imageInput: model.imageInput, ...(model.toolInput !== undefined ? { toolInput: model.toolInput } : {}),
      providerId: `${this.prefix}.${endpoint.id}`, source: "local" as const, apiModelId: model.id, endpointBoundary: modelEndpointBoundary(endpoint.baseUrl), thinkingLevels: [], kupoThinkingLevels: [], environments: this.options.environments ?? ["Local"],
    }));
    // Explicit-only endpoints serve exactly the configured IDs; nothing is listed, guessed or probed.
    if (endpoint.discovery === false) return { models: configured(new Set(endpoint.models.map((model) => model.id))), key };
    const response = await (this.options.fetch ?? fetch)(new URL("models", localEndpointUrl(endpoint.baseUrl)), { headers: endpointHeaders(endpoint, key), redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
    if (!response.ok) throw new MoguriError("local_model_http", `Local model discovery returned HTTP ${response.status}. Check the exact endpoint and credential; no inference or fallback occurred.`, 409);
    if (!response.body) throw new MoguriError("local_model_catalog", "The configured endpoint returned no model catalog.");
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 256 * 1024) { await reader.cancel(); throw new MoguriError("local_model_catalog", "The configured model catalog exceeded 256 KiB."); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    let catalog: unknown;
    try { catalog = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new MoguriError("local_model_catalog", "The configured endpoint returned an invalid JSON catalog."); }
    if (!isRecord(catalog) || !Array.isArray(catalog.data) || catalog.data.length > 512 || !catalog.data.every((entry) => isRecord(entry) && typeof entry.id === "string")) throw new MoguriError("local_model_catalog", "Expect a bounded OpenAI-compatible data array with model IDs.");
    const models = configured(new Set(catalog.data.filter(isRecord).map((entry) => String(entry.id))));
    if (!models.length) throw new MoguriError("local_model_catalog", "None of this endpoint's explicitly configured models is advertised. Check IDs and limits; no model was guessed.");
    return { models, key };
  }
  synchronize(): void {
    this.options.additional?.synchronize();
    for (const agent of this.options.agents ?? []) agent.synchronize();
    this.syncHosted(true);
    const signature = this.configurationSignature();
    if (signature === this.signature || this.closed) { this.publish(false); return; }
    this.signature = signature;
    void this.refreshLocal();
  }
  private refreshLocal(requested?: AbortSignal): Promise<void> {
    this.discovery.abort(); this.discovery = new AbortController();
    this.localPending = true;
    const epoch = ++this.epoch, signal = requested ? AbortSignal.any([requested, this.discovery.signal]) : this.discovery.signal;
    this.local.clear();
    const endpoints = this.endpoints().filter((endpoint) => endpoint.enabled && this.enabled(`${this.prefix}.${endpoint.id}`) && (this.options.ready?.() ?? true));
    for (const endpoint of endpoints) this.local.set(endpoint.id, { models: [], connection: { id: `${this.prefix}.${endpoint.id}`, name: endpoint.name, source: "local", status: "connecting", diagnostic: null } });
    this.publish();
    const task = Promise.all(endpoints.map(async (endpoint) => {
      try {
        const result = await this.inspect(endpoint, signal);
        if (epoch !== this.epoch || this.closed) return;
        const missing = endpoint.models.length - result.models.length;
        this.local.set(endpoint.id, { models: result.models, connection: { id: `${this.prefix}.${endpoint.id}`, name: endpoint.name, source: "local", status: "connected", diagnostic: missing ? `${missing} configured models are unavailable. Only advertised models are selectable.` : null } });
      } catch (error) {
        if (epoch !== this.epoch || this.closed) return;
        const diagnostic = error instanceof MoguriError ? error.message : "Local model discovery failed or timed out. Check the configured server; no scan, inference or fallback was attempted.";
        console.error("Local model discovery failed:", endpoint.id, diagnostic);
        this.local.set(endpoint.id, { models: [], connection: { id: `${this.prefix}.${endpoint.id}`, name: endpoint.name, source: "local", status: "error", diagnostic } });
      }
      this.publish();
    })).then(() => { if (epoch === this.epoch && !this.closed) { this.localPending = false; this.publish(); } });
    this.task = task; return task;
  }
  private refreshSignature(): string {
    return JSON.stringify([this.configurationSignature(), this.enabled("github-copilot"), (this.options.agents ?? []).map((agent) => [this.enabled(agent.id), agent.current]), [...this.hosted.keys()].map((id) => [id, this.enabled(id)]), this.options.additional?.refreshSignature()]);
  }
  private async waitForRefresh(task: Promise<void>, signal?: AbortSignal): Promise<void> {
    if (!signal) return task;
    signal.throwIfAborted();
    let cancel!: () => void;
    const stopped = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(signal.reason);
      signal.addEventListener("abort", cancel, { once: true });
    });
    try { await Promise.race([task, stopped]); }
    finally { signal.removeEventListener("abort", cancel); }
  }
  async refresh(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.closed) throw new MoguriError("model_registry_closed", "This profile's model discovery is closed. No other owner or provider was selected.", 503);
    const active = this.refreshing;
    if (active) {
      await this.waitForRefresh(active.task, signal);
      signal?.throwIfAborted();
      if (this.closed) throw new MoguriError("model_registry_closed", "This profile closed during model discovery. No other owner or provider was selected.", 503);
      if (this.refreshSignature() !== active.signature) return this.refresh(signal);
      return;
    }
    const operation = { signature: this.refreshSignature(), task: Promise.resolve().then(() => this.refreshCurrent(signal)) };
    this.refreshing = operation;
    try { await operation.task; }
    finally { if (this.refreshing === operation) { this.refreshing = undefined; this.publish(); } }
  }
  private async refreshCurrent(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.closed) throw new MoguriError("model_registry_closed", "This profile closed before discovery started. No account or endpoint was read.", 503);
    const copilot = async () => {
      if (this.options.includeCopilot === false || !this.enabled("github-copilot")) return;
      this.copilotDiscoveryFailure = undefined;
      try { await this.copilot.refresh(signal); }
      catch (error) {
        if (!this.closed && !signal?.aborted) {
          this.copilotDiscoveryFailure = "Configured Copilot discovery failed. Inspect the account/network; no prior model or alternate provider was substituted.";
          this.publish();
        }
        throw error;
      }
    };
    await Promise.all([copilot(), this.refreshLocal(signal), this.options.additional?.refresh(signal), ...(this.options.agents ?? []).map((agent) => agent.refresh(signal)), ...[...this.hosted.values()].map((account) => account.refresh(signal))]);
  }
  login(): void {
    if (!this.enabled("github-copilot")) throw new MoguriError("provider_disabled", "Enable GitHub Copilot in this profile's provider list before signing in. No account or model was substituted.", 409);
    this.copilot.login();
  }
  async cancel(): Promise<void> { await this.copilot.cancel(); }
  async logout(): Promise<void> { await this.copilot.logout(); }
  async evidence(id: string, signal: AbortSignal): Promise<import("../../../packages/protocol/src/index.ts").ModelEvidenceReport> {
    signal.throwIfAborted();
    const selected = this.state.models.find((model) => model.id === id);
    if (this.closed || !selected || selected.synthetic || selected.source !== "copilot" || selected.providerId !== "github-copilot" ||
      (selected.apiModelId ?? selected.id) !== selected.id || !this.copilot.evidence) {
      throw new MoguriError("model_evidence_unavailable", "This model has no supported authenticated Copilot evidence reader. Local/Remote family declarations stay unknown; no name prefix, endpoint or account was guessed.", 409);
    }
    const binding = JSON.stringify(selected), report = parse(ModelEvidenceReportSchema, await this.copilot.evidence(selected.id, signal));
    signal.throwIfAborted();
    if (this.closed || JSON.stringify(this.state.models.find((model) => model.id === id)) !== binding || report.modelId !== selected.id || report.apiModelId !== selected.id) {
      throw new MoguriError("model_evidence_stale", "Exact model/provider scope changed during inspection or the report names another model. No evidence was adopted.", 409);
    }
    return report;
  }
  /** D76. The kind of this profile's stored hosted credential and, for an API key only, the key. OAuth tokens are never returned. Service-internal. */
  async hostedCredential(id: HostedProviderId, signal: AbortSignal): Promise<{ type: "api_key"; key: string } | { type: "oauth" } | null> {
    const secret = await this.vault.read(hostedSecretId(id), signal);
    if (secret === null) return null;
    let value: unknown;
    try { value = JSON.parse(secret); } catch { value = null; }
    if (isRecord(value) && value.type === "api_key" && typeof value.key === "string" && value.key) return { type: "api_key", key: value.key };
    if (isRecord(value) && value.type === "oauth") return { type: "oauth" };
    throw new MoguriError("hosted_secret_invalid", "The source profile's stored credential for this provider is invalid. Nothing was copied.", 409);
  }
  /** D76. A configured endpoint's stored key in this profile's secret backend, or null. Service-internal. */
  endpointToken(endpoint: LocalEndpoint, signal: AbortSignal): Promise<string | null> { return this.vault.read(this.key(endpoint), signal); }
  /** D76. Stores or removes a key for an endpoint being imported, before its configuration is committed. */
  async storeEndpointToken(endpoint: LocalEndpoint, token: string | null, signal: AbortSignal): Promise<void> {
    if (token) await this.vault.write(this.key(endpoint), token, signal); else await this.vault.remove(this.key(endpoint), signal);
  }
  async token(id: string, token?: string): Promise<void> {
    const endpoint = this.endpoint(id);
    if (endpoint.auth === "none") throw new MoguriError("local_model_auth", "Set this endpoint's explicit authentication method before storing a credential.");
    try { if (token) await this.vault.write(this.key(endpoint), token, AbortSignal.timeout(15_000)); else await this.vault.remove(this.key(endpoint), AbortSignal.timeout(15_000)); }
    catch { throw new MoguriError("local_model_secret", "The local-model credential could not be changed. Check the secret backend; no plaintext fallback was used.", 503); }
    await this.refreshLocal();
  }
  async prepare(id: string, signal: AbortSignal): Promise<PreparedModel> {
    signal.throwIfAborted();
    const harness = agentHarnessOf(id);
    if (harness) throw new MoguriError("agent_harness_model", `${agentHarnessName(harness)} runs inside your installed ${harness === "claude-agent" ? "Claude Code" : "Codex"}. It cannot serve as a direct Moguri model, router, critic, helper or decision role; no provider was substituted.`, 409);
    const selected = this.state.models.find((model) => model.id === id), preference = JSON.stringify(this.preferences);
    if (this.closed || !selected) throw new MoguriError("model_unavailable", "This model or provider is disabled, unselected or unavailable in this profile. Choose an enabled source explicitly; no fallback occurred.", 409);
    const binding = JSON.stringify(selected);
    const check = (prepared: PreparedModel): PreparedModel => {
      signal.throwIfAborted();
      if (prepared.model.id !== (selected.apiModelId ?? selected.id)) throw new MoguriError("model_identity", "The prepared API identity differs from the exact selected source. No inference or provider substitution was authorized.", 409);
      if (this.closed || JSON.stringify(this.preferences) !== preference || JSON.stringify(this.state.models.find((model) => model.id === id)) !== binding) throw new MoguriError("model_changed", "Model availability or its exact source changed during preparation. No inference was started or provider substituted.", 409);
      return prepared;
    };
    if (this.options.additional?.state.models.some((model) => model.id === id)) return check(await this.options.additional.prepare(id, signal));
    const hosted = hostedProviderOfModel(id);
    if (hosted) {
      const account = this.hosted.get(hosted);
      if (!account || selected.source !== "hosted") throw new MoguriError("model_unavailable", "This hosted provider is no longer connected in this profile. Connect it again; no fallback occurred.", 409);
      return check(await account.prepare(id, signal));
    }
    if (!id.startsWith(`${this.prefix}.`)) return check(await this.copilot.prepare(id, signal));
    const info = this.state.models.find((model) => model.id === id && model.source === "local");
    if (!info?.providerId) throw new MoguriError("model_unavailable", "The selected local model is unavailable. Recheck its endpoint; no provider was substituted.", 409);
    const endpoint = this.endpoint(info.providerId.slice(this.prefix.length + 1)), signature = JSON.stringify(endpoint), epoch = this.epoch;
    const inspected = await this.inspect(endpoint, signal);
    signal.throwIfAborted();
    if (epoch !== this.epoch || JSON.stringify(this.endpoint(endpoint.id)) !== signature) throw new MoguriError("model_changed", "Local model configuration changed during admission. No inference was started.", 409);
    const configuration = endpoint.models.find((model) => this.modelId(endpoint.id, model.id) === id);
    if (!configuration || !inspected.models.some((model) => model.id === id)) throw new MoguriError("model_unavailable", "The selected local model stopped being advertised. No fallback was used.", 409);
    const model: Model<"openai-completions"> = {
      id: configuration.id, name: configuration.name, provider: "moguri-local", api: "openai-completions", baseUrl: localEndpointUrl(endpoint.baseUrl).href,
      reasoning: false, input: configuration.imageInput ? ["text", "image"] : ["text"], contextWindow: configuration.contextWindow, maxTokens: configuration.maxTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
    };
    const headers = { ...endpoint.headers, ...(endpoint.auth === "header" && inspected.key ? { [endpoint.authHeader!]: inspected.key } : {}) };
    // Header auth keeps the key as apiKey only so the worker redacts it; Authorization itself is removed.
    return check({ model, auth: inspected.key && endpoint.auth === "bearer" ? { apiKey: inspected.key, ...(endpoint.headers ? { headers } : {}) } :
      { apiKey: inspected.key ?? "moguri-keyless", headers: { Authorization: null, ...headers } } });
  }
  async close(): Promise<void> { this.closed = true; this.epoch++; this.discovery.abort(); await this.task; await this.options.additional?.close(); await Promise.all((this.options.agents ?? []).map((agent) => agent.close())); await Promise.all([...this.hosted.values()].map((account) => account.close())); await (this.copilot.close?.() ?? this.copilot.cancel()); }
}
