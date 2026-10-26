import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import type { ModelStreamObservation } from "./model.ts";
import { RepositoryFiltersSchema, type RepositoryAttribution, type RepositoryDiagnostic, type RepositoryCoverage } from "./repositories.ts";
import type { BudgetPlan } from "./budget-plans.ts";
import { ProviderRateSourceSchema } from "./pricing.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const revision = Type.Integer({ minimum: 0 });
export const BUDGET_WARNING = "Budgets can interrupt a session mid-task. Usage reporting can lag, and a clean final commit is not guaranteed.";
export const ModelRoleSchema = Type.Union([
  Type.Literal("solver"), Type.Literal("draft"), Type.Literal("side"), Type.Literal("subagent"), Type.Literal("router"), Type.Literal("critic"),
  Type.Literal("revision"), Type.Literal("escalation"), Type.Literal("decision"), Type.Literal("steering"), Type.Literal("checkpoint"), Type.Literal("compaction"), Type.Literal("unknown"),
]);
export type ModelRole = Static<typeof ModelRoleSchema>;
export const isModelRole = (value: unknown): value is ModelRole => Value.Check(ModelRoleSchema, value);
const limits = { tokens: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000_000_000 })), usd: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 1_000_000_000 })) };
export const BudgetLimitSchema = object({ ...limits, basis: Type.Literal("estimate") });
export type BudgetLimit = Static<typeof BudgetLimitSchema>;
export const SessionBudgetSchema = Type.Union([
  object({ kind: Type.Literal("unlimited") }),
  object({ kind: Type.Literal("limited"), ...limits, basis: Type.Optional(Type.Literal("estimate")) }),
]);
const rateFields = {
  modelId: id, inputUsdPerMillion: Type.Number({ minimum: 0, maximum: 1_000_000 }), outputUsdPerMillion: Type.Number({ minimum: 0, maximum: 1_000_000 }),
  effectiveAt: Type.String({ minLength: 10, maxLength: 32 }),
};
export const UserBudgetRateSchema = object({ ...rateFields, source: Type.Literal("user-estimate") });
export const BudgetRateSchema = Type.Union([UserBudgetRateSchema,
  object({ ...rateFields, source: Type.Literal("provider-api-equivalent"), pricing: ProviderRateSourceSchema })]);
export type BudgetRate = Static<typeof BudgetRateSchema>;
export const sameBudgetRate = (a: BudgetRate | null, b: BudgetRate | null): boolean => a === null || b === null ? a === b :
  (["modelId", "inputUsdPerMillion", "outputUsdPerMillion", "effectiveAt", "source"] as const).every((key) => a[key] === b[key]) &&
  (a.source !== "provider-api-equivalent" || b.source === "provider-api-equivalent" && JSON.stringify(a.pricing) === JSON.stringify(b.pricing));
export const BudgetSettingsSchema = object({ rates: Type.Array(UserBudgetRateSchema, { maxItems: 100 }), maxPriceAgeDays: Type.Integer({ minimum: 1, maximum: 365 }),
  providerEstimates: Type.Optional(Type.Boolean()), useProviderRatesForLimits: Type.Optional(Type.Boolean()) });
export interface BudgetEntry {
  id: string; sessionId: string | null; ownerSessionId: string | null; projectId: string | null; folderId: string | null;
  planId?: string;
  scopePath?: string[];
  turnId: string | null; modelId: string; providerId: string | null; apiModelId: string | null; role: ModelRole;
  env: "Local" | "Sandbox" | "Remote" | "unknown"; createdAt: string; imported: boolean;
  status: "reserved" | "settled" | "unknown"; inputEstimate: number | null; outputLimit: number | null;
  reservedTokens: number | null; reportedTokens: number | null; reservedUsdMicros: number | null; estimatedUsdMicros: number | null;
  rate: BudgetRate | null; requestMs: number; outcome: string; diagnostic: string | null;
  outputLimitViolation?: boolean;
  inputTokens?: number | null; outputTokens?: number | null; cacheReadTokens?: number | null; cacheWriteTokens?: number | null;
  stream?: ModelStreamObservation | null; telemetryDiagnostic?: string | null;
  timeBasis?: "admission" | "model-start" | "unknown";
  ownerTurnId?: string | null;
  repository?: RepositoryAttribution | null;
  repositoryDiagnostic?: RepositoryDiagnostic | null;
}
export interface BudgetTotals {
  calls: number; reportedTokens: number | null; knownReportedTokens: number; unknownTokenCalls: number;
  plannedHolds: number; plannedHeldTokens: number | null; plannedHeldUsd: number | null;
  heldTokens: number | null; unboundedTokenCalls: number; estimatedUsd: number | null; knownEstimatedUsd: number;
  heldUsd: number | null; unpricedCalls: number; providerReportedUsd: null; billedUsd: null; requestMs: number;
  inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null;
  knownInputTokens: number; knownOutputTokens: number;
  observedOutputTokensPerSecond: number | null; measuredStreamCalls: number; unmeasuredStreamCalls: number;
  observedStreamMs: number; observedOutputTokens: number; meanFirstOutputMs: number | null; firstOutputSamples: number;
}
export interface BudgetStatus {
  sessionId: string; ownerSessionId: string; totals: BudgetTotals; profileTotals: BudgetTotals;
  limits: Array<{ scope: "session" | "profile" | "global"; sessionId?: string; tokens: number | null; usd: number | null }>;
  remainingTokens: number | null; remainingUsd: number | null;
  basis: "estimate"; warning: string; diagnostics: string[]; rate: BudgetRate | null;
}
export interface GlobalBudgetCapacity { limit: BudgetLimit | null; chargedTokens: number | null; chargedUsdMicros: number | null }
export const BudgetCommandSchema = object({
  type: Type.Literal("budget.policy"), expectedRevision: revision, limit: Type.Union([BudgetLimitSchema, Type.Null()]), confirmRisk: Type.Literal(true),
});
export type BudgetCommand = Static<typeof BudgetCommandSchema>;
export const isBudgetCommand = (value: unknown): value is BudgetCommand => Value.Check(BudgetCommandSchema, value);
const date = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
export const BudgetRangeSchema = Type.Union([
  object({ kind: Type.Literal("all") }),
  object({ kind: Type.Literal("days"), days: Type.Union([Type.Literal(7), Type.Literal(30), Type.Literal(60), Type.Literal(90), Type.Literal(365)]) }),
  object({ kind: Type.Literal("year"), year: Type.Integer({ minimum: 1970, maximum: 9999 }) }),
  object({ kind: Type.Literal("custom"), from: date, to: date }),
]);
export type BudgetRange = Static<typeof BudgetRangeSchema>;
export const BudgetBucketSchema = Type.Union([Type.Literal("day"), Type.Literal("week"), Type.Literal("month"), Type.Literal("all")]);
export type BudgetBucket = Static<typeof BudgetBucketSchema>;
const planFilters = {
  projectId: Type.Optional(id), folderId: Type.Optional(id), sessionId: Type.Optional(id), turnId: Type.Optional(id),
  modelId: Type.Optional(id), providerId: Type.Optional(id), role: Type.Optional(ModelRoleSchema),
  env: Type.Optional(Type.Union([Type.Literal("Local"), Type.Literal("Remote"), Type.Literal("Sandbox"), Type.Literal("unknown")])),
  range: Type.Optional(BudgetRangeSchema),
};
const dashboardFilters = { ...RepositoryFiltersSchema.properties, ...planFilters };
export const UsageFiltersSchema = object(dashboardFilters);
export type UsageFilters = Static<typeof UsageFiltersSchema>;
const page = { offset: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) };
export const BudgetQuerySchema = Type.Union([
  object({ type: Type.Literal("budget.status"), sessionId: id }),
  object({ type: Type.Literal("budget.plans"), ...planFilters, ...page, status: Type.Optional(Type.Union([Type.Literal("held"), Type.Literal("consumed"), Type.Literal("released")])) }),
  object({ type: Type.Literal("budget.dashboard"), ...dashboardFilters, ...page, bucket: Type.Optional(BudgetBucketSchema) }),
  object({ type: Type.Literal("budget.calls"), ...dashboardFilters, ...page }),
]);
export type BudgetQuery = Static<typeof BudgetQuerySchema>;
export const isBudgetQuery = (value: unknown): value is BudgetQuery => Value.Check(BudgetQuerySchema, value);
export interface BudgetWindow {
  from: string | null; to: string | null; timezone: "UTC"; uncertainTimeCalls: number; excludedUncertainTimeCalls: number;
}
export type BudgetResponse =
  | { type: "budget.status"; status: BudgetStatus }
  | { type: "budget.plans"; plans: BudgetPlan[]; nextOffset: number | null; window: BudgetWindow }
  | { type: "budget.dashboard"; totals: BudgetTotals; groups: Array<{ role: ModelRole; modelId: string; providerId: string | null; totals: BudgetTotals }>; policy: { revision: number; limit: BudgetLimit | null }; nextOffset: number | null;
      projects: Array<{ projectId: string | null; totals: BudgetTotals }>; models: Array<{ modelId: string; totals: BudgetTotals }>;
      window: BudgetWindow; bucket: BudgetBucket; periods: Array<{ from: string | null; to: string | null; totals: BudgetTotals }>;
      pricing: Array<{ rate: BudgetRate; calls: number; estimatedUsd: number | null }>; currency: "USD"; repositoryCoverage: RepositoryCoverage }
  | { type: "budget.calls"; calls: BudgetEntry[]; nextOffset: number | null; window: BudgetWindow; repositoryCoverage: RepositoryCoverage };
