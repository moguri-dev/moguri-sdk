import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { BudgetRateSchema, ModelRoleSchema, sameBudgetRate, type BudgetEntry } from "./budgets.ts";
import { MoguriError } from "./core.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const units = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const timestamp = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
export const BudgetPlanSchema = object({
  version: Type.Literal(1), id, profileId: id, sessionId: id, ownerSessionId: id, turnId: id, ownerTurnId: Type.Union([id, Type.Null()]),
  scopePath: Type.Optional(Type.Array(id, { minItems: 1, maxItems: 8, uniqueItems: true })),
  projectId: Type.Union([id, Type.Null()]), folderId: Type.Union([id, Type.Null()]),
  env: Type.Union([Type.Literal("Local"), Type.Literal("Remote"), Type.Literal("Sandbox")]),
  purpose: Type.Literal("winddown"), role: ModelRoleSchema, modelId: id, providerId: Type.Union([id, Type.Null()]), apiModelId: id,
  authorityDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  inputBound: units, outputBound: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), tokens: units,
  usdMicros: Type.Union([units, Type.Null()]), rate: Type.Union([BudgetRateSchema, Type.Null()]),
  revision: units, createdAt: timestamp, updatedAt: timestamp,
  status: Type.Union([Type.Literal("held"), Type.Literal("consumed"), Type.Literal("released")]),
  consumedStepId: Type.Union([id, Type.Null()]),
  release: Type.Union([object({
    actor: Type.Literal("policy"), sourceEventId: id,
    reason: Type.Union([Type.Literal("owner-turn-finished"), Type.Literal("owner-session-deleted"), Type.Literal("owner-project-removed")]),
  }), Type.Null()]),
});
export type BudgetPlan = Static<typeof BudgetPlanSchema>;
const validTime = (value: string) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function corrupt(message: string): never { throw new MoguriError("budget_plan_corrupt", `${message} State was preserved; no capacity, dispatch or refund was adopted.`, 409); }

export function projectBudgetPlan(previous: BudgetPlan | undefined, value: unknown): BudgetPlan {
  if (!Value.Check(BudgetPlanSchema, value)) corrupt("The planned reservation has an unsupported shape/version.");
  const plan = value;
  if (!validTime(plan.createdAt) || !validTime(plan.updatedAt) || plan.role === "unknown" ||
    !Number.isSafeInteger(plan.inputBound + plan.outputBound) || plan.tokens !== plan.inputBound + plan.outputBound) corrupt("Planned role, UTC observations or complete token bound is invalid.");
  if (plan.sessionId === plan.ownerSessionId && plan.ownerTurnId !== plan.turnId) corrupt("A primary plan lost its exact owning turn.");
  if (plan.scopePath && (plan.scopePath[0] !== plan.sessionId || plan.scopePath.at(-1) !== plan.ownerSessionId)) corrupt("Planned capacity lost its exact original coordination path.");
  if (plan.rate && (!/^\d{4}-\d{2}-\d{2}$/.test(plan.rate.effectiveAt) || !Number.isFinite(Date.parse(plan.rate.effectiveAt)) ||
    new Date(plan.rate.effectiveAt).toISOString().slice(0, 10) !== plan.rate.effectiveAt || plan.rate.effectiveAt > plan.createdAt.slice(0, 10))) corrupt("The captured plan price has no valid current/past admission date.");
  const cost = plan.rate ? Math.ceil(plan.inputBound * plan.rate.inputUsdPerMillion + plan.outputBound * plan.rate.outputUsdPerMillion) : null;
  if (plan.rate && (plan.rate.modelId !== plan.modelId || !Number.isSafeInteger(cost)) || plan.usdMicros !== cost) corrupt("The captured price/model and complete USD envelope disagree.");
  if (plan.status === "held" && (plan.consumedStepId !== null || plan.release !== null) ||
    plan.status === "consumed" && (plan.consumedStepId === null || plan.release !== null) ||
    plan.status === "released" && (plan.consumedStepId !== null || plan.release === null)) corrupt("Planned capacity has contradictory dispatch/release evidence.");
  if (!previous) {
    if (plan.revision !== 0 || plan.status !== "held" || plan.createdAt !== plan.updatedAt) corrupt("A plan must start with its original undispatched hold.");
  } else {
    const immutable = ["version", "id", "profileId", "sessionId", "ownerSessionId", "turnId", "ownerTurnId", "projectId", "folderId", "env", "purpose", "role",
      "modelId", "providerId", "apiModelId", "authorityDigest", "inputBound", "outputBound", "tokens", "usdMicros", "createdAt"] as const;
    if (previous.status !== "held" || plan.status === "held" || plan.revision !== previous.revision + 1 ||
      immutable.some((key) => previous[key] !== plan[key]) || JSON.stringify(previous.scopePath) !== JSON.stringify(plan.scopePath) || !sameBudgetRate(previous.rate, plan.rate)) corrupt("Original planned ownership/bounds changed or terminal capacity was replayed.");
  }
  return structuredClone(plan);
}

export function validateBudgetPlanEntries(plans: BudgetPlan[], entries: BudgetEntry[]): void {
  const byId = new Map(plans.map((plan) => [plan.id, plan])), used = new Set<string>();
  for (const entry of entries) if (entry.planId) {
    const plan = byId.get(entry.planId);
    if (!plan || plan.status !== "consumed" || plan.consumedStepId !== entry.id || used.has(plan.id) ||
      entry.sessionId !== plan.sessionId || entry.ownerSessionId !== plan.ownerSessionId || entry.turnId !== plan.turnId || (entry.ownerTurnId ?? null) !== plan.ownerTurnId ||
      JSON.stringify(entry.scopePath) !== JSON.stringify(plan.scopePath) ||
      entry.projectId !== plan.projectId || entry.folderId !== plan.folderId || entry.env !== plan.env || entry.role !== plan.role ||
      entry.modelId !== plan.modelId || entry.providerId !== plan.providerId || entry.apiModelId !== plan.apiModelId ||
      entry.inputEstimate === null || entry.outputLimit === null || !Number.isSafeInteger(entry.inputEstimate) || !Number.isSafeInteger(entry.outputLimit) ||
      entry.inputEstimate < 0 || entry.outputLimit < 1 || entry.inputEstimate > plan.inputBound || entry.outputLimit > plan.outputBound ||
      entry.reservedTokens !== entry.inputEstimate + entry.outputLimit || entry.reservedTokens > plan.tokens || !sameBudgetRate(entry.rate, plan.rate) ||
      (plan.usdMicros === null ? entry.reservedUsdMicros !== null : entry.reservedUsdMicros === null || entry.reservedUsdMicros > plan.usdMicros)) corrupt("A consumed plan must bind exactly one matching bounded actual-call reservation.");
    const cost = plan.rate ? Math.ceil(entry.inputEstimate * plan.rate.inputUsdPerMillion + entry.outputLimit * plan.rate.outputUsdPerMillion) : null;
    if (cost !== null && !Number.isSafeInteger(cost) || entry.reservedUsdMicros !== cost) corrupt("Transferred USD must match the complete actual bound and captured price, not an invented discount or zero.");
    used.add(plan.id);
  }
  if (plans.some((plan) => plan.status === "consumed" && !used.has(plan.id))) corrupt("A consumed hold has no retained actual-call reservation.");
}
