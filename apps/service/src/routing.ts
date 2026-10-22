import { Value } from "typebox/value";
import {
  DEFAULT_ROUTER_PROMPT, KUPO_MODEL_ID, modelContextWindows, MoguriError, SingleRoutingPlanSchema, type Controls, type KupoSettings, type ModelInfo, type SingleRoutingPlan,
} from "../../../packages/protocol/src/index.ts";
import type { RoutingPool } from "../../../packages/protocol/src/compound.ts";
import { compoundPool } from "./compound-policy.ts";

export interface BoundedRoutingModel extends ModelInfo { maxTokens: number }
export const routingWorkingWindow = (model: ModelInfo): number => {
  try { return modelContextWindows(model).values[0] ?? 0; }
  catch (error) {
    if (!(error instanceof MoguriError && error.code === "model_context")) throw error;
    throw new MoguriError("routing_context", "A configured model has invalid working-window declarations. Refresh its capabilities; no window or model was substituted.", 409);
  }
};
export const routingModelReady = (model: ModelInfo, settings: RoutingPool, env: Controls["env"]): model is BoundedRoutingModel => model.id !== KUPO_MODEL_ID && !model.synthetic &&
  (model.environments?.includes(env) ?? env === "Local") && (model.source === "local" && model.endpointBoundary === "loopback" || settings.allowHosted) &&
  typeof model.maxTokens === "number" && Number.isSafeInteger(model.maxTokens) && model.maxTokens > 0 && Number.isSafeInteger(model.contextWindow) && model.contextWindow >= 8192 && routingWorkingWindow(model) >= 8192;

export function kupoPool(settings: RoutingPool, models: ModelInfo[], env: Controls["env"], estimatedTokens = 0) {
  if (!settings.enabled) throw new MoguriError("routing_disabled", "Explicitly configure the experimental kupo policy and eligible pool first. Fixed models remain available.", 409);
  const classifier = models.find((model) => model.id === settings.classifierModelId);
  if (!classifier || !routingModelReady(classifier, settings, env)) throw new MoguriError("routing_classifier", "The explicitly configured classifier is unavailable, incompatible with this env, or lacks hosted-data permission for a network/unknown endpoint or known output bounds. No fallback.", 409);
  const candidates = models.filter((model): model is BoundedRoutingModel => settings.approvedModelIds.includes(model.id) && routingModelReady(model, settings, env) && routingWorkingWindow(model) >= estimatedTokens + model.maxTokens + 4096);
  if (!candidates.length) throw new MoguriError("routing_pool", "No explicitly approved solver fits this env/context/privacy/output contract. No classifier request was sent.", 409);
  return { classifier: structuredClone(classifier), candidates: structuredClone(candidates) };
}
export function kupoAvailability(settings: KupoSettings, models: ModelInfo[], hardBudget: boolean): { model: ModelInfo | null; diagnostics: string[] } {
  if (!settings.enabled) return { model: null, diagnostics: ["kupo is disabled until you explicitly approve its Single policy and model pool."] };
  if (hardBudget) return { model: null, diagnostics: ["Finite kupo budgets remain unavailable until reserved wind-down and accepted-work checkpoint paths are qualified. Hard policy was not lifted."] };
  if (settings.workflow === "compound") {
    try {
      const pool = compoundPool(settings, models, "Local"), candidates = pool.candidates;
      return { model: { id: KUPO_MODEL_ID, name: "kupo Compound (reviewed alpha)", contextWindow: Math.min(...candidates.map(routingWorkingWindow)),
        maxTokens: settings.limits.proposalTokens, imageInput: false, providerId: "moguri-kupo", synthetic: true, environments: ["Local"] },
        diagnostics: [...pool.diagnostics.map((entry) => entry.message), "Compound sends require an explicit source/worktree/test review through the shared compound API. No ordinary Single fallback."] };
    } catch (error) { if (!(error instanceof MoguriError)) throw error; return { model: null, diagnostics: [error.message] }; }
  }
  const environments: Controls["env"][] = [], candidates: BoundedRoutingModel[] = [], diagnostics: string[] = [];
  for (const env of ["Local", "Remote"] as const) {
    try { const pool = kupoPool(settings, models, env); environments.push(env); candidates.push(...pool.candidates); }
    catch (error) { if (!(error instanceof MoguriError && error.code.startsWith("routing_"))) throw error; diagnostics.push(`${env}: ${error.message}`); }
  }
  if (!candidates.length) return { model: null, diagnostics };
  return { model: { id: KUPO_MODEL_ID, name: "kupo Single (alpha)", contextWindow: Math.min(...candidates.map(routingWorkingWindow)),
    maxTokens: Math.min(...candidates.map((model) => model.maxTokens)), imageInput: false, providerId: "moguri-kupo", synthetic: true, environments }, diagnostics };
}
export function routingPlan(value: unknown, candidateIds: string[], minimumConfidence: number): SingleRoutingPlan {
  if (!Value.Check(SingleRoutingPlanSchema, value) || !value.reason.trim() || Buffer.byteLength(value.reason) > 1200 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.reason)) throw new MoguriError("routing_plan", "The classifier returned an invalid Single plan. No solver, endpoint, tool or fallback was authorized.", 409);
  if (!candidateIds.includes(value.modelId) || value.modelId === KUPO_MODEL_ID) throw new MoguriError("routing_model", "Classifier advice selected a model outside the approved eligible snapshot. No endpoint was invented.", 409);
  if (value.confidence < minimumConfidence) throw new MoguriError("routing_confidence", "Classifier advice did not meet the explicitly configured threshold. No silent fallback or permission was inferred.", 409);
  return structuredClone(value);
}
export const ROUTER_PROMPT = DEFAULT_ROUTER_PROMPT;
