import { Type, type Static } from "typebox";
import type { ModelInfo, ThinkingEffort } from "./index.ts";

export const KupoModeSchema = Type.Union([Type.Literal("balanced"), Type.Literal("savings"), Type.Literal("performance"), Type.Literal("dynamic")]);
export type KupoMode = Static<typeof KupoModeSchema>;
/** The three modes with fixed rules. Dynamic (D55) resolves to one of them for each classified request. */
export type ConcreteKupoMode = Exclude<KupoMode, "dynamic">;
export const concreteKupoModes = ["balanced", "savings", "performance"] as const satisfies readonly ConcreteKupoMode[];
/** Rules that apply before Dynamic has resolved a request: Balanced's, which admit every qualified model and effort. */
export const kupoRuleMode = (mode: KupoMode): ConcreteKupoMode => mode === "dynamic" ? "balanced" : mode;
export const kupoModes = [
  { id: "balanced", name: "Balanced", description: "Any qualified model and workflow; avoids frontier drafts on long tasks" },
  { id: "savings", name: "Savings", description: "Economy and standard models, local first; Single and Cascade; effort up to High" },
  { id: "performance", name: "Performance", description: "Mainly frontier models at their highest supported effort" },
  { id: "dynamic", name: "Dynamic", description: "Picks Savings, Balanced or Performance for each request" },
] as const satisfies readonly { id: KupoMode; name: string; description: string }[];
/** "Dynamic: Savings" once a request is classified; before that (or with one eligible model) Balanced's rules apply. */
export function kupoModeLabel(mode: KupoMode, resolved?: ConcreteKupoMode): string {
  const name = (id: KupoMode) => kupoModes.find((entry) => entry.id === id)!.name;
  return mode !== "dynamic" ? name(mode) : resolved ? `Dynamic: ${name(resolved)}` : "Dynamic (Balanced rules, not classified)";
}
/**
 * Model class without a reviewed profile (D55): the published output API price per million tokens. Price is
 * a class signal, not a quality score or a bill. A current reviewed profile always takes precedence.
 */
export const KUPO_ECONOMY_MAX_OUTPUT_USD = 5;
export const KUPO_FRONTIER_MIN_OUTPUT_USD = 20;
export type KupoModelCategory = "economy" | "standard" | "frontier";
export const kupoPriceCategory = (outputUsdPerMillion: number): KupoModelCategory =>
  outputUsdPerMillion <= KUPO_ECONOMY_MAX_OUTPUT_USD ? "economy" : outputUsdPerMillion >= KUPO_FRONTIER_MIN_OUTPUT_USD ? "frontier" : "standard";
export interface KupoModelClass {
  category: KupoModelCategory; basis: "reviewed-profile" | "provider-declared" | "published-price" | "local-no-api-fee";
  outputUsdPerMillion: number | null; inputUsdPerMillion: number | null; sourceUrl: string | null;
}
export const kupoCategoryRank = (category: KupoModelCategory): number => category === "economy" ? 0 : category === "standard" ? 1 : 2;
/** Automatic Kupo workflows (D56). Single always stays available; the others follow their settings and the mode. */
export type KupoWorkflowId = "single" | "cascade" | "critique" | "council";
export const kupoWorkflowIds = ["single", "cascade", "critique", "council"] as const satisfies readonly KupoWorkflowId[];
export const kupoWorkflowNames: Record<KupoWorkflowId, string> = { single: "Single", cascade: "Cascade", critique: "Critique", council: "Council" };
/** Savings uses cheap workflows, Performance never drafts with a cheaper class to escalate later, Balanced may use any. */
export const KUPO_MODE_WORKFLOWS: Record<ConcreteKupoMode, readonly KupoWorkflowId[]> = {
  savings: ["single", "cascade"], balanced: ["single", "cascade", "critique", "council"], performance: ["single", "critique", "council"],
};
/** Balanced treats a request as long when its estimated solver input exceeds this many tokens and then avoids frontier drafts. */
export const KUPO_LONG_TASK_TOKENS = 32_768;
const score = Type.Number({ minimum: 0, maximum: 1 });
export const KupoScoresSchema = Type.Object({ reasoning: score, code: score, debugging: score, tools: score }, { additionalProperties: false });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
export const KupoModelProfileInputSchema = Type.Object({
  modelId: Type.String({ minLength: 1, maxLength: 256 }),
  category: Type.Union([Type.Literal("economy"), Type.Literal("standard"), Type.Literal("frontier")]),
  costClass: Type.String({ minLength: 1, maxLength: 64 }),
  evaluationSet: hash, scores: KupoScoresSchema,
  referencePrice: Type.Object({ inputUsdPerMillion: Type.Number({ minimum: 0 }), outputUsdPerMillion: Type.Number({ minimum: 0 }),
    basis: Type.Union([Type.Literal("provider-api-equivalent"), Type.Literal("local-no-api-fee")]) }, { additionalProperties: false }),
  sourceUrl: Type.String({ minLength: 1, maxLength: 4096 }), sourceText: Type.String({ minLength: 1, maxLength: 32768 }),
  observedAt: Type.String({ minLength: 20, maxLength: 32 }), validUntil: Type.String({ minLength: 20, maxLength: 32 }),
  limitations: Type.String({ minLength: 1, maxLength: 2000 }),
}, { additionalProperties: false });
export type KupoModelProfileInput = Static<typeof KupoModelProfileInputSchema>;
export const KupoModelProfileSchema = Type.Object({
  ...KupoModelProfileInputSchema.properties, version: Type.Literal(1), id: Type.String({ minLength: 1, maxLength: 128 }),
  profileId: Type.String({ minLength: 1, maxLength: 128 }), actor: Type.Literal("user"),
  modelBindingDigest: hash, sourceDigest: hash, reviewedAt: Type.String({ minLength: 20, maxLength: 32 }),
}, { additionalProperties: false });
export type KupoModelProfile = Static<typeof KupoModelProfileSchema>;
const labId = Type.String({ minLength: 1, maxLength: 64 });
export const KupoModelCategorySchema = Type.Union([Type.Literal("economy"), Type.Literal("standard"), Type.Literal("frontier")]);
/**
 * Per-workflow settings for automatic Kupo (D56). Absent means `defaultKupoWorkflows()`: every workflow on, any labs.
 * Single always stays available. Cascade drafts with a cheaper class and escalates to a pricier one; `classes`
 * overrides a model's class or excludes it. Critique uses a critic from a different AI lab; `labPairs` (unordered)
 * narrows the allowed pairs, empty means any two different known labs. Council has `size` models from as many
 * distinct known labs (at least 3); `labs` narrows who may sit on it, empty means any.
 */
export const KupoWorkflowSettingsSchema = Type.Object({
  cascade: Type.Object({ enabled: Type.Boolean(),
    classes: Type.Optional(Type.Record(Type.String({ minLength: 1, maxLength: 256 }), Type.Union([KupoModelCategorySchema, Type.Literal("excluded")]), { maxProperties: 128 })) }, { additionalProperties: false }),
  critique: Type.Object({ enabled: Type.Boolean(), labPairs: Type.Array(Type.Tuple([labId, labId]), { maxItems: 64 }) }, { additionalProperties: false }),
  council: Type.Object({ enabled: Type.Boolean(), labs: Type.Array(labId, { maxItems: 32, uniqueItems: true }),
    size: Type.Integer({ minimum: 3, maximum: 5 }) }, { additionalProperties: false }),
}, { additionalProperties: false });
export type KupoWorkflowSettings = Static<typeof KupoWorkflowSettingsSchema>;
export const defaultKupoWorkflows = (): KupoWorkflowSettings => ({
  cascade: { enabled: true }, critique: { enabled: true, labPairs: [] }, council: { enabled: true, labs: [], size: 3 },
});
/** Whether a concrete mode may run a workflow under these settings (absent settings mean the all-on defaults). */
export function kupoWorkflowAllowed(mode: ConcreteKupoMode, workflow: KupoWorkflowId, settings?: KupoWorkflowSettings): boolean {
  return KUPO_MODE_WORKFLOWS[mode].includes(workflow) && (workflow === "single" || (settings ?? defaultKupoWorkflows())[workflow].enabled);
}
export const KupoAutomaticLimitsSchema = Type.Object({
  maxEscalations: Type.Integer({ minimum: 1, maximum: 3 }), maxRevisions: Type.Integer({ minimum: 0, maximum: 3 }),
  maxResultBytes: Type.Optional(Type.Integer({ minimum: 512, maximum: 65536 })),
}, { additionalProperties: false });
export type KupoAutomaticLimits = Static<typeof KupoAutomaticLimitsSchema>;
export const defaultKupoAutomaticLimits = (): KupoAutomaticLimits => ({ maxEscalations: 1, maxRevisions: 1 });
export const KupoCompactionSettingsSchema = Type.Object({
  enabled: Type.Boolean(), modelId: Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]),
  triggerFraction: Type.Number({ minimum: 0.5, maximum: 0.9 }), keepRecentTurns: Type.Integer({ minimum: 1, maximum: 20 }),
  maxCallsPerTurn: Type.Integer({ minimum: 1, maximum: 4 }), outputTokens: Type.Integer({ minimum: 32, maximum: 4096 }),
}, { additionalProperties: false });
export const defaultKupoCompaction = (): Static<typeof KupoCompactionSettingsSchema> => ({
  enabled: false, modelId: null, triggerFraction: 0.75, keepRecentTurns: 2, maxCallsPerTurn: 1, outputTokens: 1024,
});
export function kupoModelBindingText(model: ModelInfo): string {
  return JSON.stringify(model);
}
/**
 * What a mode can run for this session (D56): each workflow's availability with eligible Cascade/Critique pairs as
 * [draft, escalation or critic] model IDs and eligible Council models. Computed without the request's actual size,
 * so a long request can still narrow it.
 */
export interface KupoWorkflowAvailability { id: KupoWorkflowId; available: boolean; reason: string; pairs?: Array<[string, string]>; modelIds?: string[] }
export interface KupoModeAvailability { mode: KupoMode; available: boolean; reason: string; modelIds: string[]; workflows?: KupoWorkflowAvailability[] }
/** Kupo never chooses Max by default: it often degrades results, so xhigh is the ceiling for every mode (D56). */
export const KUPO_EFFORT_CEILING = "xhigh" as const;
const KUPO_MODE_EFFORTS: Record<"savings" | "performance", readonly ThinkingEffort[]> = { savings: ["low", "medium", "high"], performance: ["high", "xhigh"] };
/**
 * Mode efforts, chosen per request by task complexity and capped at xhigh. Savings stays within low through high,
 * Balanced spans minimal through xhigh, Performance uses high or xhigh and never lower.
 */
export function kupoEfforts(model: ModelInfo, requested: KupoMode, outputTokens = model.maxTokens ?? 0): Array<ThinkingEffort | "provider"> {
  const mode = kupoRuleMode(requested);
  const levels = model.kupoThinkingLevels ?? (mode === "balanced" ? model.thinkingLevels : undefined);
  if (levels === undefined) return mode === "balanced" ? ["provider"] : [];
  if (!levels.length) return mode === "performance" || Boolean(model.thinkingLevels?.length) ? [] : ["provider"];
  return levels.filter((effort) => (model.kupoThinkingMinimumOutput?.[effort] ?? 0) <= outputTokens && effort !== "max" &&
    (mode === "balanced" ? effort !== "off" : KUPO_MODE_EFFORTS[mode].includes(effort)));
}
export function kupoThinking(model: ModelInfo, requested: KupoMode, complexity: "simple" | "moderate" | "complex" | null, outputTokens?: number): Exclude<ThinkingEffort, "off"> | undefined {
  const mode = kupoRuleMode(requested);
  const allowed = kupoEfforts(model, mode, outputTokens);
  const desired: Array<Exclude<ThinkingEffort, "off"> | "provider"> = mode === "performance" ? complexity === "simple" ? ["high", "xhigh"] : ["xhigh", "high"] :
    complexity === "simple" ? ["low", "minimal", "medium", "high", "xhigh", "provider"] :
      complexity === "complex" && mode === "balanced" ? ["xhigh", "high", "medium", "low", "minimal", "provider"] :
        complexity === "complex" ? ["high", "medium", "low", "provider"] : ["medium", "high", "low", "minimal", "xhigh", "provider"];
  const selected = desired.find((effort) => allowed.includes(effort));
  return selected === "provider" ? undefined : selected;
}
