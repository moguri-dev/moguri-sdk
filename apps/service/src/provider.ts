import { AsyncEntry } from "@napi-rs/keyring";
import { createModels, type AuthOperationOptions, type Credential, type CredentialStore, type Model, type Api, type ModelAuth } from "@earendil-works/pi-ai";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { isRecord, MoguriError, PROFILE_ID, type ProviderState, type ModelEvidenceReport, type ModelWindowCapability } from "../../../packages/protocol/src/index.ts";
import { kupoThinkingMinimumOutput, qualifiedKupoThinking, supportedThinking } from "./model-controls.ts";
import { readCopilotModelEvidence } from "./model-evidence.ts";

export interface PreparedModel { model: Model<Api> & Pick<ModelWindowCapability, "supportedContextWindows">; auth: ModelAuth }
export interface ProviderAdapter {
  state: ProviderState;
  onChange: () => void;
  refresh(): Promise<void>;
  login(): void;
  cancel(): Promise<void>;
  logout(): Promise<void>;
  prepare(modelId: string, signal: AbortSignal): Promise<PreparedModel>;
  evidence?(modelId: string, signal: AbortSignal): Promise<ModelEvidenceReport>;
}
export class KeyringCredentials implements CredentialStore {
  constructor(private readonly profileId: string = PROFILE_ID) {}
  private chain: Promise<unknown> = Promise.resolve();
  private entry(providerId: string): AsyncEntry {
    if (providerId !== "github-copilot") throw new Error("Unsupported secret namespace.");
    return new AsyncEntry(`dev.moguri.profile.${this.profileId}`, providerId, { linux: { store: "secret-service" } });
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
  private readonly evidenceReads = new Set<AbortController>();
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
        models: models.map((model) => ({ id: model.id, name: model.name, contextWindow: model.contextWindow, maxTokens: model.maxTokens, endpointBoundary: "network" as const, imageInput: model.input.includes("image"), thinkingLevels: supportedThinking(model), kupoThinkingLevels: qualifiedKupoThinking(model), kupoThinkingMinimumOutput: kupoThinkingMinimumOutput(model) })),
        login: null, diagnostic: auth && models.length === 0 ? "No enabled, compatible Copilot models. Enable a model in your GitHub Copilot account, then reconnect." : null,
      });
    } catch {
      if (epoch !== this.epoch) return;
      this.update({ status: "error", models: [], login: null, diagnostic: "Copilot access or OS keychain access failed. Unlock the keychain, check your network/account policy, then reconnect." });
    }
  }
  async evidence(modelId: string, caller: AbortSignal): Promise<ModelEvidenceReport> {
    if (this.signingOut || this.loginTask || this.state.status !== "connected" || !this.state.models.some((model) => model.id === modelId)) {
      throw new MoguriError("model_evidence_unavailable", "Explicitly connect and select an actual current Copilot model before inspecting its declared metadata. No model or account was substituted.", 409);
    }
    if (this.evidenceReads.size >= 4) throw new MoguriError("model_evidence_busy", "Four owned catalogue reads are already active. Wait for one to settle; no extra request was sent.", 429);
    const abort = new AbortController(), deadline = AbortSignal.timeout(10_000), signal = AbortSignal.any([caller, abort.signal, deadline]), epoch = this.epoch;
    this.evidenceReads.add(abort);
    try {
      signal.throwIfAborted();
      const auth = await this.models.getAuth("github-copilot", { signal }), available = await this.models.getAvailable("github-copilot", { signal });
      signal.throwIfAborted();
      if (!auth || !available.some((model) => model.id === modelId)) throw new MoguriError("model_evidence_unavailable", "This exact Copilot account no longer advertises the selected supported model. Refresh models; no fallback was used.", 409);
      const report = await readCopilotModelEvidence(modelId, auth.auth.baseUrl, auth.auth.apiKey, signal);
      signal.throwIfAborted();
      if (epoch !== this.epoch || this.signingOut || this.state.status !== "connected" || !this.state.models.some((model) => model.id === modelId)) {
        throw new MoguriError("model_evidence_stale", "Copilot account/model scope changed during inspection. No old-account report was published.", 409);
      }
      return report;
    } catch (error) {
      if (signal.aborted) {
        const timedOut = !abort.signal.aborted && (deadline.aborted || caller.aborted && caller.reason instanceof Error && caller.reason.name === "TimeoutError");
        throw new MoguriError(timedOut ? "model_evidence_timeout" : "model_evidence_cancelled",
          "The owned catalogue read stopped or exceeded its deadline. No report, inference or approval was published.", timedOut ? 408 : 409);
      }
      if (error instanceof MoguriError) throw error;
      console.error("Copilot declared model inspection failed: model_evidence_network");
      throw new MoguriError("model_evidence_network", "The exact Copilot catalogue could not be read. Check access/network and inspect explicitly again; no fallback or raw diagnostics were exposed.", 502);
    } finally { this.evidenceReads.delete(abort); }
  }
  private abortEvidence(): void { for (const read of this.evidenceReads) read.abort(); }
  login(): void {
    if (this.loginTask || this.signingOut) throw new MoguriError("login_pending", "A Copilot account change is already in progress.", 409);
    this.abortEvidence();
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
    this.abortEvidence();
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
