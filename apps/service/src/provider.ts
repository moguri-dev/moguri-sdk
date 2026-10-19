import { AsyncEntry } from "@napi-rs/keyring";
import { createModels, type AuthOperationOptions, type Credential, type CredentialStore, type Model, type Api, type ModelAuth } from "@earendil-works/pi-ai";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { isRecord, MoguriError, type ProviderState } from "../../../packages/protocol/src/index.ts";
import { supportedThinking } from "./model-controls.ts";

export interface PreparedModel { model: Model<Api>; auth: ModelAuth }
export interface ProviderAdapter {
  state: ProviderState;
  onChange: () => void;
  refresh(): Promise<void>;
  login(): void;
  cancel(): Promise<void>;
  logout(): Promise<void>;
  prepare(modelId: string, signal: AbortSignal): Promise<PreparedModel>;
}
export class KeyringCredentials implements CredentialStore {
  private chain: Promise<unknown> = Promise.resolve();
  private entry(providerId: string): AsyncEntry {
    if (providerId !== "github-copilot") throw new Error("Unsupported secret namespace.");
    return new AsyncEntry("dev.moguri.profile.default", providerId, { linux: { store: "secret-service" } });
  }
  private async load(providerId: string, signal?: AbortSignal): Promise<Credential | undefined> {
    const secret = await this.entry(providerId).getPassword(signal);
    if (secret === null) return undefined;
    let credential: unknown;
    try { credential = JSON.parse(secret); } catch { throw new Error("Moguri's keychain entry is invalid. Sign out and reconnect."); }
    if (!isRecord(credential) || credential.type !== "oauth" || typeof credential.refresh !== "string" ||
      typeof credential.access !== "string" || typeof credential.expires !== "number" ||
      !Array.isArray(credential.availableModelIds) || !credential.availableModelIds.every((id) => typeof id === "string")) {
      throw new Error("Moguri's keychain entry is invalid. Sign out and reconnect.");
    }
    return credential as Credential;
  }
  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = this.chain.then(run, run);
    this.chain = next;
    return next;
  }
  read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    return this.serialize(() => this.load(providerId, options?.signal));
  }
  async list(options?: AuthOperationOptions) {
    const credential = await this.read("github-copilot", options);
    return credential ? [{ providerId: "github-copilot", type: credential.type }] : [];
  }
  modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>, options?: AuthOperationOptions): Promise<Credential | undefined> {
    return this.serialize(async () => {
      options?.signal?.throwIfAborted();
      const current = await this.load(providerId, options?.signal);
      const next = await fn(current);
      options?.signal?.throwIfAborted();
      if (next) await this.entry(providerId).setPassword(JSON.stringify(next), options?.signal);
      return next ?? current;
    });
  }
  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.serialize(async () => { await this.entry(providerId).deleteCredential(options?.signal); });
  }
}

export class CopilotAdapter implements ProviderAdapter {
  state: ProviderState = { status: "disconnected", models: [], login: null, diagnostic: null };
  onChange = () => {};
  private readonly models;
  private loginAbort?: AbortController;
  private loginTask?: Promise<void>;
  private epoch = 0;
  private signingOut = false;
  constructor(credentials: CredentialStore = new KeyringCredentials()) {
    this.models = createModels({
      credentials,
      authContext: { env: async () => undefined, fileExists: async () => false },
    });
    this.models.setProvider(githubCopilotProvider());
  }
  private update(state: ProviderState): void { this.state = state; this.onChange(); }
  async refresh(): Promise<void> {
    if (this.loginTask || this.signingOut) throw new MoguriError("login_pending", "Finish the active Copilot account change before refreshing.", 409);
    await this.loadState(this.epoch, AbortSignal.timeout(15_000));
  }
  private async loadState(epoch: number, signal: AbortSignal): Promise<void> {
    try {
      const auth = await this.models.getAuth("github-copilot", { signal });
      const models = auth ? await this.models.getAvailable("github-copilot", { signal }) : [];
      if (epoch !== this.epoch) return;
      signal.throwIfAborted();
      this.update({
        status: auth ? "connected" : "disconnected",
        models: models.map((model) => ({ id: model.id, name: model.name, contextWindow: model.contextWindow, imageInput: model.input.includes("image"), thinkingLevels: supportedThinking(model) })),
        login: null, diagnostic: auth && models.length === 0 ? "No enabled, compatible Copilot models. Enable a model in your GitHub Copilot account, then reconnect." : null,
      });
    } catch {
      if (epoch !== this.epoch) return;
      this.update({ status: "error", models: [], login: null, diagnostic: "Copilot access or OS keychain access failed. Unlock the keychain, check your network/account policy, then reconnect." });
    }
  }
  login(): void {
    if (this.loginTask || this.signingOut) throw new MoguriError("login_pending", "A Copilot account change is already in progress.", 409);
    const abort = new AbortController();
    const epoch = ++this.epoch;
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15 * 60_000)]);
    this.loginAbort = abort;
    this.update({ status: "connecting", models: [], login: null, diagnostic: null });
    this.loginTask = (async () => {
      try {
        await this.models.login("github-copilot", "oauth", {
          signal,
          prompt: async (prompt) => {
            if (prompt.type === "text" && prompt.message.includes("Enterprise")) return "";
            throw new Error("This checkpoint supports github.com device authorization only.");
          },
          notify: (event) => {
            if (event.type === "device_code" && epoch === this.epoch && !signal.aborted) {
              const url = new URL(event.verificationUri);
              if (url.protocol !== "https:" || url.hostname !== "github.com") throw new Error("Unexpected GitHub authorization destination.");
              this.update({
                ...this.state,
                login: { code: event.userCode, url: url.toString(), expiresAt: Date.now() + (event.expiresInSeconds ?? 900) * 1000 },
              });
            }
          },
        }, { agentName: "Moguri" });
        await this.loadState(epoch, signal);
      } catch {
        if (epoch === this.epoch) this.update({
          status: abort.signal.aborted ? "disconnected" : "error", models: [], login: null,
          diagnostic: abort.signal.aborted ? "Copilot sign-in cancelled." : "Copilot sign-in failed or expired. Check your subscription, organization policy, network and OS keychain, then try again.",
        });
      } finally {
        this.loginTask = undefined;
        this.loginAbort = undefined;
      }
    })();
  }
  async cancel(): Promise<void> {
    if (!this.loginTask) return;
    this.epoch++;
    this.loginAbort?.abort();
    await this.loginTask;
    this.update({ status: "disconnected", models: [], login: null, diagnostic: "Copilot sign-in cancelled. Sign out to remove any authorization that already completed." });
  }
  async logout(): Promise<void> {
    if (this.signingOut) throw new MoguriError("provider_busy", "Copilot sign-out is already in progress.", 409);
    this.signingOut = true;
    this.epoch++;
    this.update({ status: "connecting", models: [], login: null, diagnostic: null });
    try {
      await this.cancel();
      await this.models.logout("github-copilot");
      this.update({ status: "disconnected", models: [], login: null, diagnostic: null });
    } catch {
      this.update({ status: "error", models: [], login: null, diagnostic: "Could not remove the credential from the OS keychain. Unlock it and retry sign-out." });
      throw new MoguriError("secret_store", this.state.diagnostic!, 503);
    } finally { this.signingOut = false; }
  }
  async prepare(modelId: string, signal: AbortSignal): Promise<PreparedModel> {
    const auth = await this.models.getAuth("github-copilot", { signal });
    const available = await this.models.getAvailable("github-copilot", { signal });
    const model = available.find((model) => model.id === modelId);
    if (!auth || !model) throw new MoguriError("model_unavailable", "The selected Copilot model is unavailable. Reconnect and explicitly select an available model.", 409);
    return { model, auth: auth.auth };
  }
}
