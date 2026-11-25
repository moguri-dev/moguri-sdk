import { createHash } from "node:crypto";
import { createModels, type Api, type AuthOperationOptions, type Credential, type CredentialStore, type Model, type ModelAuth } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider, personalizeOpenRouterCatalog } from "@earendil-works/pi-ai/providers/openrouter";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { googleVertexProvider } from "@earendil-works/pi-ai/providers/google-vertex";
import { amazonBedrockProvider } from "@earendil-works/pi-ai/providers/amazon-bedrock";
import { azureProvider } from "@earendil-works/pi-ai/providers/azure";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import { mistralProvider } from "@earendil-works/pi-ai/providers/mistral";
import { groqProvider } from "@earendil-works/pi-ai/providers/groq";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import {
  hostedOptionsRequired, hostedProvider, isRecord, MoguriError, type AzureOptions, type BedrockOptions, type HostedAccountState, type HostedAuthMethod, type HostedProviderId,
  type HostedProviderOptions, type ModelInfo, type ModelOffering, type ModelProvider,
} from "../../../packages/protocol/src/index.ts";
import type { SecretVault } from "./gateway.ts";
import { kupoThinkingMinimumOutput, qualifiedKupoThinking, supportedThinking } from "./model-controls.ts";
import type { PreparedModel } from "./provider.ts";

/** pi-ai provider behind each Moguri hosted provider. ChatGPT and the OpenAI API share pi-ai's `openai` provider with separate credential slots. */
const piProviders = {
  openrouter: "openrouter", anthropic: "anthropic", openai: "openai", chatgpt: "openai", gemini: "google", vertex: "google-vertex", bedrock: "amazon-bedrock",
  azure: "azure", xai: "xai", mistral: "mistral", groq: "groq", deepseek: "deepseek",
} as const satisfies Record<HostedProviderId, string>;
const factories = {
  openrouter: openrouterProvider, anthropic: anthropicProvider, openai: openaiProvider, chatgpt: openaiProvider, gemini: googleProvider, vertex: googleVertexProvider,
  bedrock: amazonBedrockProvider, azure: azureProvider, xai: xaiProvider, mistral: mistralProvider, groq: groqProvider, deepseek: deepseekProvider,
} satisfies Record<HostedProviderId, () => unknown>;
/** Bedrock cross-Region inference profile prefixes a Region can call, besides in-Region and `global.` models. */
export function bedrockGeographies(region: string): string[] {
  if (region.startsWith("us-gov-")) return ["us-gov"];
  if (region === "ap-northeast-1" || region === "ap-northeast-3") return ["apac", "jp"];
  if (region === "ap-southeast-2" || region === "ap-southeast-4") return ["apac", "au"];
  const prefix = region.split("-")[0]!;
  return ({ us: ["us"], eu: ["eu"], ap: ["apac"], ca: ["ca", "us"], sa: ["us"], me: ["eu"], il: ["eu"], af: ["eu"], mx: ["us"] } as Record<string, string[]>)[prefix] ?? [];
}
const bedrockGeographyPrefix = /^(us-gov|us|eu|apac|jp|au|ca|global)\./;
export const bedrockEndpoint = (region: string) => `https://bedrock-runtime.${region}.amazonaws.com${region.startsWith("cn-") ? ".cn" : ""}`;
/** Only these OAuth destinations may be surfaced as sign-in links. */
const authorizeHosts: Partial<Record<HostedProviderId, string>> = { chatgpt: "auth.openai.com", openrouter: "openrouter.ai" };
export const hostedModelId = (providerId: HostedProviderId, apiModelId: string) => `hosted.${providerId}.${createHash("sha256").update(apiModelId).digest("hex").slice(0, 24)}`;
export const hostedSecretId = (providerId: HostedProviderId) => `hosted.${providerId}`;
/** pi-ai treats `sk-ant-oat` keys as Claude subscription OAuth and impersonates Claude Code; Anthropic forbids that for third-party apps. */
const subscriptionToken = (key: string) => key.includes("sk-ant-oat");
export interface HostedAccountOptions {
  /** Generated fixtures point a provider at a loopback server; product use keeps the provider's own HTTPS base URL. */
  baseUrls?: Partial<Record<HostedProviderId, string>>;
  /** The stable per-profile installation ID OpenAI receives as the agent host for Sign in with ChatGPT. */
  deviceId: () => string;
  /** Committed non-secret connection details (Bedrock region, Azure endpoint and deployments). */
  providerOptions?: () => HostedProviderOptions | undefined;
}

/** One provider's credential in the profile secret backend, restricted to the auth methods Moguri offers for it. */
class VaultCredentials implements CredentialStore {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly vault: SecretVault, private readonly id: HostedProviderId, private readonly methods: readonly HostedAuthMethod[]) {}
  private owns(providerId: string) { return providerId === piProviders[this.id]; }
  private valid(value: unknown): value is Credential {
    if (!isRecord(value) || !this.methods.includes(value.type as HostedAuthMethod)) return false;
    return value.type === "api_key" ? typeof value.key === "string" && value.key.length > 0 && !(this.id === "anthropic" && subscriptionToken(value.key)) :
      typeof value.access === "string" && typeof value.refresh === "string" && typeof value.expires === "number";
  }
  private async load(signal?: AbortSignal): Promise<Credential | undefined> {
    const secret = await this.vault.read(hostedSecretId(this.id), signal);
    if (secret === null) return undefined;
    let value: unknown;
    try { value = JSON.parse(secret); } catch { value = null; }
    if (!this.valid(value)) throw new MoguriError("hosted_secret_invalid", "The stored credential for this provider is invalid. Remove it and connect again.", 409);
    return value;
  }
  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => {});
    return next;
  }
  read(providerId: string, options?: AuthOperationOptions) { return this.owns(providerId) ? this.serialize(() => this.load(options?.signal)) : Promise.resolve(undefined); }
  async list(options?: AuthOperationOptions) {
    const credential = await this.read(piProviders[this.id], options);
    return credential ? [{ providerId: piProviders[this.id], type: credential.type }] : [];
  }
  modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>, options?: AuthOperationOptions) {
    if (!this.owns(providerId)) return Promise.reject(new MoguriError("hosted_secret_scope", "Credential scope mismatch. Nothing was stored.", 409));
    return this.serialize(async () => {
      options?.signal?.throwIfAborted();
      const current = await this.load(options?.signal), next = await fn(current);
      if (next && !this.valid(next)) throw new MoguriError("hosted_auth_method", "This provider does not accept that sign-in method in Moguri. Nothing was stored.", 409);
      if (next) await this.vault.write(hostedSecretId(this.id), JSON.stringify(next), options?.signal);
      return next ?? current;
    });
  }
  delete(providerId: string, options?: AuthOperationOptions) {
    if (!this.owns(providerId)) return Promise.resolve();
    return this.serialize(() => this.vault.remove(hostedSecretId(this.id), options?.signal));
  }
}

export class HostedAccount {
  onChange = () => {};
  private status: ModelProvider["status"] = "disconnected";
  private diagnostic: string | null = null;
  private credential: HostedAuthMethod | null = null;
  private catalog: readonly Model<Api>[] = [];
  private loginState: HostedAccountState["login"] = null;
  private loginAbort?: AbortController;
  private loginTask?: Promise<void>;
  private manual?: { resolve: (value: string) => void; reject: (error: Error) => void };
  private refreshAbort?: AbortController;
  private epoch = 0;
  private closed = false;
  private readonly models;
  private readonly store: VaultCredentials;
  private readonly piId: string;
  private readonly definition;
  private readonly methods: readonly HostedAuthMethod[];
  constructor(readonly id: HostedProviderId, vault: SecretVault, private readonly options: HostedAccountOptions) {
    this.definition = hostedProvider(id)!;
    this.methods = this.definition.methods;
    this.piId = piProviders[id];
    this.store = new VaultCredentials(vault, id, this.methods);
    // No ambient environment or files: only the credential the user stored for this exact provider is ever used.
    this.models = createModels({ credentials: this.store, authContext: { env: async () => undefined, fileExists: async () => false } });
    const provider = factories[id](), baseUrl = options.baseUrls?.[id];
    this.models.setProvider(baseUrl ? { ...provider, baseUrl } : provider);
  }
  private get name() { return this.definition.name; }
  private bedrock(): BedrockOptions {
    const options = this.options.providerOptions?.()?.bedrock;
    if (!options) throw new MoguriError("hosted_options", "Add the Amazon Bedrock key again with its AWS Region. No Region was guessed.", 409);
    return options;
  }
  private azure(): AzureOptions {
    const options = this.options.providerOptions?.()?.azure;
    if (!options) throw new MoguriError("hosted_options", "Add the Azure OpenAI key again with its endpoint and deployments. No endpoint was guessed.", 409);
    return options;
  }
  private update(): void { this.onChange(); }
  get busy(): boolean { return Boolean(this.loginTask); }
  provider(enabled: boolean): ModelProvider {
    return { id: this.id, name: this.name, source: "hosted", scope: "hosted", endpointId: null, enabled, status: this.status, diagnostic: this.diagnostic,
      account: { methods: this.methods, credential: this.credential, subscription: this.definition.subscription, login: this.loginState } };
  }
  offerings(enabled: boolean): ModelOffering[] {
    const available = enabled && this.status === "connected";
    // Pay-per-use catalogues declare real API prices; subscription accounts are not billed per token.
    return this.catalog.map((model): ModelOffering => ({ available, model: this.info(model),
      ...(!this.definition.subscription && model.cost && [model.cost.input, model.cost.output].every((value) => Number.isFinite(value) && value >= 0) ?
        { price: { inputUsdPerMillion: model.cost.input, outputUsdPerMillion: model.cost.output, basis: "provider-declared" as const } } : {}) }));
  }
  private info(model: Model<Api>): ModelInfo {
    return { id: hostedModelId(this.id, model.id), name: model.name.slice(0, 160), contextWindow: model.contextWindow, maxTokens: model.maxTokens,
      imageInput: model.input.includes("image"), thinkingLevels: supportedThinking(model), kupoThinkingLevels: qualifiedKupoThinking(model),
      kupoThinkingMinimumOutput: kupoThinkingMinimumOutput(model), providerId: this.id, source: "hosted", apiModelId: model.id, endpointBoundary: "network", environments: ["Local"] };
  }
  async refresh(caller?: AbortSignal): Promise<void> {
    if (this.loginTask) return;
    this.refreshAbort?.abort();
    const abort = new AbortController(), epoch = ++this.epoch;
    this.refreshAbort = abort;
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(20_000), ...(caller ? [caller] : [])]);
    this.status = "connecting"; this.diagnostic = `Checking the ${this.name} credential and models. No inference is running.`; this.update();
    try {
      // getAuth refreshes an expiring OAuth credential under the store lock before the stored kind is read.
      const stored = await this.models.getAuth(this.piId, { signal }) ? await this.store.read(this.piId, { signal }) ?? null : null;
      if (epoch !== this.epoch) return;
      if (!stored) {
        this.credential = null; this.catalog = []; this.status = "disconnected";
        this.diagnostic = this.methods.includes("api_key") ? `Add your ${this.name} key${this.methods.includes("oauth") ? " or sign in" : ""}. No other provider was substituted.` : `Sign in with ${this.name === "ChatGPT account" ? "ChatGPT" : this.name}.`;
        this.update(); return;
      }
      let catalog: readonly Model<Api>[] = await this.models.getAvailable(this.piId, { signal });
      // Restrict OpenRouter's catalogue to the models this key may use (GET /models/user); other providers list their maintained catalogue.
      if (this.id === "openrouter") catalog = (await personalizeOpenRouterCatalog(catalog, { credential: stored, baseUrl: this.options.baseUrls?.openrouter, signal,
        allowNetwork: true, publish: async () => true })).filter((model): model is Model<Api> => !("type" in model) || model.type === "chat");
      else if (this.id === "bedrock") {
        const allowed = bedrockGeographies(this.bedrock().region);
        catalog = catalog.filter((model) => { const prefix = bedrockGeographyPrefix.exec(model.id)?.[1]; return !prefix || prefix === "global" || allowed.includes(prefix); });
      } else if (this.id === "azure") {
        // Azure routes by the user's deployment name; each deployment borrows its served model's limits and prices.
        catalog = this.azure().deployments.map((deployment) => {
          const served = catalog.find((model) => model.id === deployment.model);
          if (!served) throw new MoguriError("hosted_azure_model", `Azure deployment ${deployment.name} names ${deployment.model}, which isn't in the Azure OpenAI catalogue. Choose a listed model; no other model was substituted.`, 409);
          return { ...served, id: deployment.name, name: `${served.name} (${deployment.name})` };
        });
      }
      if (epoch !== this.epoch) return;
      this.credential = stored.type; this.catalog = catalog; this.status = "connected";
      this.diagnostic = catalog.length ? null : `${this.name} accepted the credential but offers no chat models for it.`;
    } catch (error) {
      if (epoch !== this.epoch) return;
      console.error(`${this.name} refresh failed:`, error instanceof MoguriError ? error.code : "hosted_refresh");
      this.catalog = []; this.status = "error";
      this.diagnostic = error instanceof MoguriError ? error.message : this.credential === "oauth" || this.id === "chatgpt" ?
        `${this.name} sign-in expired, was revoked or could not be refreshed. Sign in again; no other provider was substituted.` :
        `${this.name} could not be reached or the secret backend is locked. Check the key, network and keychain, then refresh.`;
    } finally {
      if (this.refreshAbort === abort) this.refreshAbort = undefined;
      if (epoch === this.epoch) this.update();
    }
  }
  /** Validates connection options before anything is stored; Bedrock and Azure require theirs, every other provider refuses them. */
  static checkOptions(id: HostedProviderId, options: BedrockOptions | AzureOptions | undefined): HostedProviderOptions {
    const name = hostedProvider(id)?.name ?? id;
    if (!hostedOptionsRequired(id)) {
      if (options) throw new MoguriError("hosted_options", `${name} takes only an API key. Nothing was stored.`, 400);
      return {};
    }
    if (id === "bedrock" && (!options || !("region" in options))) throw new MoguriError("hosted_options", "Amazon Bedrock needs the AWS Region of its API key. Nothing was stored.", 400);
    if (id === "azure" && (!options || !("endpoint" in options))) throw new MoguriError("hosted_options", "Azure OpenAI needs its resource endpoint and at least one deployment. Nothing was stored.", 400);
    if (id === "azure") {
      const azure = options as AzureOptions, names = new Set(azure.deployments.map((deployment) => deployment.name));
      if (names.size !== azure.deployments.length) throw new MoguriError("hosted_options", "Each Azure deployment name must be listed once. Nothing was stored.", 400);
      const known = new Set(azureProvider().getModels().map((model) => model.id)), unknown = azure.deployments.find((deployment) => !known.has(deployment.model));
      if (unknown) throw new MoguriError("hosted_options", `Azure deployment ${unknown.name} names ${unknown.model}, which isn't in the Azure OpenAI catalogue. Nothing was stored.`, 400);
      return { azure: structuredClone(azure) };
    }
    return { bedrock: structuredClone(options as BedrockOptions) };
  }
  async setKey(key: string): Promise<void> {
    if (!this.methods.includes("api_key")) throw new MoguriError("hosted_auth_method", `${this.name} connects through sign-in only. No key was stored.`, 409);
    if (this.loginTask) throw new MoguriError("login_pending", `Finish or cancel the ${this.name} sign-in first.`, 409);
    if (this.id === "anthropic" && subscriptionToken(key)) {
      throw new MoguriError("hosted_subscription_token", "This is a Claude subscription token, not an Anthropic API key. Anthropic does not allow third-party apps to use Claude.ai subscriptions; create an API key in the Claude Console. Nothing was stored.", 400);
    }
    try { await this.store.modify(this.piId, async () => ({ type: "api_key", key }), { signal: AbortSignal.timeout(15_000) }); }
    catch (error) {
      if (error instanceof MoguriError) throw error;
      throw new MoguriError("hosted_secret", "The key could not be stored in the secret backend. Unlock it and retry; no plaintext fallback was used.", 503);
    }
    await this.refresh();
  }
  login(): void {
    if (!this.methods.includes("oauth")) throw new MoguriError("hosted_auth_method", `${this.name} connects with an API key only. Sign-in is not offered.`, 409);
    if (this.loginTask) throw new MoguriError("login_pending", `A ${this.name} sign-in is already in progress.`, 409);
    if (this.closed) throw new MoguriError("hosted_closed", `This ${this.name} connection was replaced. Retry the sign-in.`, 409);
    this.refreshAbort?.abort();
    const abort = new AbortController(), epoch = ++this.epoch, signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15 * 60_000)]);
    this.loginAbort = abort;
    this.status = "connecting"; this.diagnostic = null; this.loginState = null; this.update();
    this.loginTask = (async () => {
      try {
        await this.models.login(this.piId, "oauth", {
          signal,
          notify: (event) => {
            if (event.type !== "auth_url" || epoch !== this.epoch || signal.aborted) return;
            const url = new URL(event.url);
            if (url.protocol !== "https:" || url.hostname !== authorizeHosts[this.id]) throw new Error("Unexpected authorization destination.");
            this.loginState = { url: url.toString(), instructions: event.instructions?.slice(0, 500) ?? null, expiresAt: Date.now() + 15 * 60_000 };
            this.update();
          },
          prompt: (prompt) => {
            if (prompt.type !== "manual_code") return Promise.reject(new Error("Moguri only accepts the browser callback or a pasted redirect URL."));
            return new Promise<string>((resolve, reject) => {
              this.manual = { resolve, reject };
              prompt.signal?.addEventListener("abort", () => reject(new Error("Prompt closed.")), { once: true });
            });
          },
        }, { agentName: "Moguri", getDeviceId: this.options.deviceId });
        this.loginState = null; this.manual = undefined; this.loginTask = undefined;
        await this.refresh();
      } catch (error) {
        if (epoch !== this.epoch) return;
        const message = error instanceof Error ? error.message : "";
        console.error(`${this.name} sign-in failed:`, signal.aborted ? "cancelled" : "hosted_login");
        this.status = abort.signal.aborted ? "disconnected" : "error"; this.loginState = null;
        this.diagnostic = abort.signal.aborted ? `${this.name} sign-in cancelled.` : /Port \d+ is in use/.test(message) ?
          `${message.replace(/another pi session/g, "another app")} Nothing was stored.`.slice(0, 400) :
          `${this.name} sign-in failed or expired. Check the account and network, then try again. Nothing was stored.`;
        this.update();
      } finally {
        if (epoch === this.epoch) { this.loginTask = undefined; this.loginAbort = undefined; this.manual = undefined; }
      }
    })();
  }
  /** The user pastes the final redirect URL when the browser could not reach this machine's loopback callback. */
  submitCode(code: string): void {
    if (!this.manual) throw new MoguriError("hosted_login_code", `No ${this.name} sign-in is waiting for a redirect URL.`, 409);
    this.manual.resolve(code.trim());
    this.manual = undefined;
  }
  async cancel(): Promise<void> {
    const task = this.loginTask;
    if (!task) return;
    this.loginAbort?.abort();
    await task;
  }
  async remove(): Promise<void> {
    await this.cancel();
    this.epoch++; this.refreshAbort?.abort();
    try { await this.models.logout(this.piId, { signal: AbortSignal.timeout(15_000) }); }
    catch { throw new MoguriError("hosted_secret", `Could not remove the ${this.name} credential from the secret backend. Unlock it and retry.`, 503); }
    this.credential = null; this.catalog = []; this.status = "disconnected"; this.diagnostic = null; this.loginState = null; this.update();
  }
  async prepare(modelId: string, signal: AbortSignal): Promise<PreparedModel> {
    // The published entry carries the account's own limits (OpenRouter personalizes them); getAuth refreshes an expiring sign-in.
    const model = this.status === "connected" ? this.catalog.find((entry) => hostedModelId(this.id, entry.id) === modelId) : undefined;
    const auth = model ? await this.models.getAuth(this.piId, { signal }).catch(() => undefined) : undefined;
    if (!auth || !model) throw new MoguriError("model_unavailable", `The selected ${this.name} model is unavailable or its sign-in expired. Refresh or sign in again; no fallback was used.`, 409);
    const baseUrl = this.options.baseUrls?.[this.id] ?? (this.id === "bedrock" ? bedrockEndpoint(this.bedrock().region) : this.id === "azure" ? this.azure().endpoint : undefined);
    return { model: baseUrl ? { ...model, baseUrl } : model, auth: auth.auth satisfies ModelAuth };
  }
  async close(): Promise<void> { this.closed = true; this.epoch++; this.refreshAbort?.abort(); await this.cancel(); }
}
