import { createHash } from "node:crypto";
import { defaultKupoWorkflows, kupoEfforts, kupoModelBindingText, kupoPriceCategory, kupoRuleMode, MODEL_LABS, modelContextWindows, MoguriError, type AutomaticKupoSettings, type KupoMode, type KupoModelCategory, type KupoModelClass, type KupoModelProfile, type KupoWorkflowSettings, type ModelInfo, type ModelOptions, type ModelPrice, type ProviderPriceCatalog } from "../../../packages/protocol/src/index.ts";
import { validateModelOptions } from "./model-controls.ts";
import { publishedPrice } from "./provider-pricing.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export interface KupoConstraints {
  mode?: KupoMode; profileId?: string; requiresImages?: boolean; requiresTools?: boolean; now?: number;
  reviewInputBound?: number; revisionInputBound?: number;
  solverInputBound?: number;
  modelOptions?: ModelOptions;
  /** Effective published price catalogues used to class models without a reviewed profile (D55). */
  priceCatalogs?: ProviderPriceCatalog[];
  /** Prices a pay-per-use provider (OpenRouter style) declares for its offered models, keyed by offered model ID (D56). */
  declaredPrices?: Record<string, ModelPrice>;
  /** A Council revision reads every reviewer's complete critique (D56), so it has its own escaped input bound. */
  councilRevisionInputBound?: number;
}
export function kupoModelOptions(model: ModelInfo, constraints: KupoConstraints, outputTokens = model.maxTokens): ModelOptions & { contextWindow: number } {
  validateModelOptions(model, constraints.modelOptions);
  const contextWindow = constraints.modelOptions?.contextWindow ?? modelContextWindows(model).values[0];
  if (contextWindow === undefined) throw new MoguriError("routing_context", "This exact model has no qualified working window. No context was discarded.", 409);
  if (constraints.mode === "performance" && contextWindow !== model.contextWindow) {
    throw new MoguriError("routing_context", "Performance requires this model's actual maximum context. Clear or change the explicit window; it was not clamped.", 409);
  }
  const thinkingEffort = constraints.modelOptions?.thinkingEffort;
  if (thinkingEffort !== undefined && ((model.kupoThinkingMinimumOutput?.[thinkingEffort] ?? 0) > (outputTokens ?? 0) ||
    model.kupoThinkingLevels !== undefined && !model.kupoThinkingLevels.includes(thinkingEffort) ||
    constraints.mode && !kupoEfforts(model, constraints.mode, outputTokens).includes(thinkingEffort))) {
    throw new MoguriError("routing_effort", "The exact thinking effort is unsupported by this mode or complete output bound. No replacement effort was selected.", 409);
  }
  return { contextWindow, ...(thinkingEffort !== undefined ? { thinkingEffort } : {}) };
}
export function kupoWorkingWindow(model: ModelInfo, constraints: KupoConstraints): number {
  return kupoModelOptions(model, constraints).contextWindow;
}
export function kupoBindingReady(model: ModelInfo, constraints: KupoConstraints, outputTokens = model.maxTokens): boolean {
  if (constraints.requiresImages && !model.imageInput || constraints.requiresTools && (constraints.mode ? model.toolInput !== true : model.toolInput === false)) return false;
  try { kupoModelOptions(model, constraints, outputTokens); }
  catch (error) { if (!(error instanceof MoguriError)) throw error; return false; }
  return true;
}
export function validateKupoProfiles(settings: AutomaticKupoSettings): void {
  const profiles = settings.modelProfiles ?? [];
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length || new Set(profiles.map((profile) => profile.modelId)).size !== profiles.length) {
    throw new MoguriError("routing_profile", "Reviewed model profiles need unique IDs and one exact active binding per model.", 409);
  }
  for (const profile of profiles) {
    let url: URL;
    try { url = new URL(profile.sourceUrl); }
    catch { throw new MoguriError("routing_profile", "A reviewed model profile needs its actual credential-free HTTPS source URL.", 409); }
    if (url.protocol !== "https:" || url.username || url.password || !profile.sourceText.trim() || !profile.sourceText.isWellFormed() ||
      !profile.limitations.trim() || !profile.limitations.isWellFormed() || hash(profile.sourceText) !== profile.sourceDigest ||
      ![profile.observedAt, profile.reviewedAt, profile.validUntil].every((time) => Number.isFinite(Date.parse(time)) && new Date(time).toISOString() === time) ||
      Date.parse(profile.validUntil) <= Date.parse(profile.observedAt)) throw new MoguriError("routing_profile", "Model evaluation/price evidence lost its exact source, dates, digest or reviewed limitations. No class or quality was inferred.", 409);
  }
}
export function kupoProfile(settings: AutomaticKupoSettings, model: ModelInfo, constraints: KupoConstraints): KupoModelProfile | null {
  const now = constraints.now ?? Date.now(), profile = settings.modelProfiles?.find((profile) => profile.modelId === model.id);
  if (!profile || profile.profileId !== constraints.profileId || profile.modelBindingDigest !== hash(kupoModelBindingText(model)) ||
    Date.parse(profile.observedAt) > now || Date.parse(profile.reviewedAt) > now || Date.parse(profile.validUntil) <= now ||
    now - Date.parse(profile.observedAt) > 30 * 86400_000) return null;
  if (profile.referencePrice.basis === "local-no-api-fee" && (model.source !== "local" || model.endpointBoundary !== "loopback" ||
    profile.referencePrice.inputUsdPerMillion !== 0 || profile.referencePrice.outputUsdPerMillion !== 0)) {
    throw new MoguriError("routing_price", "No-API-fee evidence applies only to the exact execution-host loopback model, never a network endpoint or a replacement for configured usage/rates.", 409);
  }
  return profile;
}
/**
 * A model's class (D55, D56): its current reviewed profile, else execution-host loopback models as no-API-fee economy,
 * else the output price its pay-per-use provider declares, else its exact published output API price. Unpriced network
 * models stay unclassed; no family or name is guessed.
 */
export function kupoClass(settings: AutomaticKupoSettings, model: ModelInfo, constraints: KupoConstraints): KupoModelClass | null {
  const profile = kupoProfile(settings, model, constraints);
  if (profile) return { category: profile.category, basis: "reviewed-profile", inputUsdPerMillion: profile.referencePrice.inputUsdPerMillion,
    outputUsdPerMillion: profile.referencePrice.outputUsdPerMillion, sourceUrl: profile.sourceUrl };
  if (model.source === "local" && model.endpointBoundary === "loopback") return { category: "economy", basis: "local-no-api-fee", inputUsdPerMillion: 0, outputUsdPerMillion: 0, sourceUrl: null };
  const declared = constraints.declaredPrices?.[model.id];
  if (declared?.basis === "provider-declared" && Number.isFinite(declared.outputUsdPerMillion) && declared.outputUsdPerMillion >= 0) {
    return { category: kupoPriceCategory(declared.outputUsdPerMillion), basis: "provider-declared", inputUsdPerMillion: declared.inputUsdPerMillion,
      outputUsdPerMillion: declared.outputUsdPerMillion, sourceUrl: null };
  }
  const published = constraints.priceCatalogs ? publishedPrice(model, constraints.priceCatalogs) : null;
  return published ? { category: kupoPriceCategory(published.price.outputUsdPerMillion), basis: "published-price", inputUsdPerMillion: published.price.inputUsdPerMillion,
    outputUsdPerMillion: published.price.outputUsdPerMillion, sourceUrl: published.catalog.sourceUrl } : null;
}
export function kupoModeModel(settings: AutomaticKupoSettings, model: ModelInfo, constraints: KupoConstraints): boolean {
  if (!kupoBindingReady(model, constraints)) return false;
  if (!constraints.mode) return true;
  if (modelContextWindows(model).values[0] !== model.contextWindow) return false;
  if (!kupoEfforts(model, constraints.mode).length) return false;
  const mode = kupoRuleMode(constraints.mode);
  if (mode === "balanced") return true;
  const modelClass = kupoClass(settings, model, constraints);
  return Boolean(modelClass && (mode !== "savings" || modelClass.category !== "frontier"));
}
/**
 * A model's Cascade class (D56): its current reviewed profile, else the user's override in `workflows.cascade.classes`,
 * else its ordinary class. `excluded` always removes the model from Cascade. Unclassed models never join a class pair.
 */
export function kupoCascadeClass(settings: AutomaticKupoSettings, model: ModelInfo, constraints: KupoConstraints): KupoModelCategory | null {
  const override = settings.workflows?.cascade.classes?.[model.id];
  if (override === "excluded") return null;
  const profile = kupoProfile(settings, model, constraints);
  return profile ? profile.category : override ?? kupoClass(settings, model, constraints)?.category ?? null;
}
export function validateKupoWorkflows(settings: AutomaticKupoSettings): KupoWorkflowSettings {
  const workflows = settings.workflows ?? defaultKupoWorkflows();
  const lab = (id: string) => id !== "unknown" && Object.hasOwn(MODEL_LABS, id);
  const pairs = workflows.critique.labPairs.map(([a, b]) => [a, b].sort().join("\0"));
  if (workflows.critique.labPairs.some(([a, b]) => a === b || !lab(a) || !lab(b)) || new Set(pairs).size !== pairs.length) {
    throw new MoguriError("routing_workflows", "Critique lab pairs need two different known AI labs and no duplicate pair. Nothing was saved or inferred.", 409);
  }
  if (workflows.council.labs.some((id) => !lab(id))) throw new MoguriError("routing_workflows", "Council labs must be known AI labs. Nothing was saved or inferred.", 409);
  return workflows;
}
export function kupoCascadePair(draft: KupoModelProfile | null, escalation: KupoModelProfile | null): boolean {
  if (!draft || !escalation || draft.modelId === escalation.modelId || draft.evaluationSet !== escalation.evaluationSet) return false;
  const scores = ["reasoning", "code", "debugging", "tools"] as const;
  return scores.every((score) => escalation.scores[score] >= draft.scores[score]) &&
    scores.some((score) => escalation.scores[score] > draft.scores[score]) &&
    escalation.referencePrice.inputUsdPerMillion >= draft.referencePrice.inputUsdPerMillion &&
    escalation.referencePrice.outputUsdPerMillion >= draft.referencePrice.outputUsdPerMillion;
}
export function orderKupoModels<T extends ModelInfo>(settings: AutomaticKupoSettings, models: T[], constraints: KupoConstraints): T[] {
  if (constraints.mode !== "savings") return models;
  return models.slice().sort((a, b) => {
    const local = (model: ModelInfo) => model.source === "local" && model.endpointBoundary === "loopback";
    const price = (model: ModelInfo) => { const modelClass = kupoClass(settings, model, constraints);
      return modelClass?.inputUsdPerMillion != null && modelClass.outputUsdPerMillion != null ? modelClass.inputUsdPerMillion + modelClass.outputUsdPerMillion : Infinity; };
    return Number(local(b)) - Number(local(a)) || price(a) - price(b) || a.id.localeCompare(b.id);
  });
}
