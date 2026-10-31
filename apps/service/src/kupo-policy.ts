import { createHash } from "node:crypto";
import { kupoEfforts, kupoModelBindingText, modelContextWindows, MoguriError, type AutomaticKupoSettings, type KupoMode, type KupoModelProfile, type ModelInfo } from "../../../packages/protocol/src/index.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export interface KupoConstraints {
  mode?: KupoMode; profileId?: string; requiresImages?: boolean; requiresTools?: boolean; now?: number;
  reviewInputBound?: number; revisionInputBound?: number;
  solverInputBound?: number;
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
export function kupoModeModel(settings: AutomaticKupoSettings, model: ModelInfo, constraints: KupoConstraints): boolean {
  if (constraints.requiresImages && !model.imageInput || constraints.requiresTools && (constraints.mode ? model.toolInput !== true : model.toolInput === false)) return false;
  if (!constraints.mode) return true;
  if (modelContextWindows(model).values[0] !== model.contextWindow) return false;
  if (!kupoEfforts(model, constraints.mode).length) return false;
  const profile = kupoProfile(settings, model, constraints);
  return constraints.mode === "balanced" || Boolean(profile && (constraints.mode !== "savings" || profile.category !== "frontier"));
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
    const aProfile = kupoProfile(settings, a, constraints), bProfile = kupoProfile(settings, b, constraints);
    const price = (profile: KupoModelProfile | null) => profile ? profile.referencePrice.inputUsdPerMillion + profile.referencePrice.outputUsdPerMillion : Infinity;
    return Number(local(b)) - Number(local(a)) || price(aProfile) - price(bProfile) || a.id.localeCompare(b.id);
  });
}
