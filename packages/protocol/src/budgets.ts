import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const revision = Type.Integer({ minimum: 0 });
export const BUDGET_WARNING = "Budgets can interrupt a session mid-task. Usage reporting can lag, and a clean final commit is not guaranteed.";
export const ModelRoleSchema = Type.Union([
  Type.Literal("solver"), Type.Literal("side"), Type.Literal("subagent"), Type.Literal("router"), Type.Literal("critic"),
  Type.Literal("revision"), Type.Literal("escalation"), Type.Literal("decision"), Type.Literal("steering"), Type.Literal("checkpoint"), Type.Literal("unknown"),
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
export const BudgetRateSchema = object({
  modelId: id, inputUsdPerMillion: Type.Number({ minimum: 0, maximum: 1_000_000 }), outputUsdPerMillion: Type.Number({ minimum: 0, maximum: 1_000_000 }),
  effectiveAt: Type.String({ minLength: 10, maxLength: 32 }), source: Type.Literal("user-estimate"),
});
export type BudgetRate = Static<typeof BudgetRateSchema>;
export const BudgetSettingsSchema = object({ rates: Type.Array(BudgetRateSchema, { maxItems: 100 }), maxPriceAgeDays: Type.Integer({ minimum: 1, maximum: 365 }) });
export interface BudgetEntry {
  id: string; sessionId: string | null; ownerSessionId: string | null; projectId: string | null; folderId: string | null;
  turnId: string | null; modelId: string; providerId: string | null; apiModelId: string | null; role: ModelRole;
  env: "Local" | "Sandbox" | "Remote" | "unknown"; createdAt: string; imported: boolean;
  status: "reserved" | "settled" | "unknown"; inputEstimate: number | null; outputLimit: number | null;
  reservedTokens: number | null; reportedTokens: number | null; reservedUsdMicros: number | null; estimatedUsdMicros: number | null;
  rate: BudgetRate | null; requestMs: number; outcome: string; diagnostic: string | null;
  outputLimitViolation?: boolean;
}
export interface BudgetTotals {
  calls: number; reportedTokens: number | null; knownReportedTokens: number; unknownTokenCalls: number;
  heldTokens: number | null; unboundedTokenCalls: number; estimatedUsd: number | null; knownEstimatedUsd: number;
  heldUsd: number | null; unpricedCalls: number; providerReportedUsd: null; billedUsd: null; requestMs: number;
}
export interface BudgetStatus {
  sessionId: string; ownerSessionId: string; totals: BudgetTotals; profileTotals: BudgetTotals;
  limits: Array<{ scope: "session" | "profile"; tokens: number | null; usd: number | null }>;
  remainingTokens: number | null; remainingUsd: number | null;
  basis: "estimate"; warning: string; diagnostics: string[]; rate: BudgetRate | null;
}
export const BudgetCommandSchema = object({
  type: Type.Literal("budget.policy"), expectedRevision: revision, limit: Type.Union([BudgetLimitSchema, Type.Null()]), confirmRisk: Type.Literal(true),
});
export type BudgetCommand = Static<typeof BudgetCommandSchema>;
export const isBudgetCommand = (value: unknown): value is BudgetCommand => Value.Check(BudgetCommandSchema, value);
export const BudgetQuerySchema = Type.Union([
  object({ type: Type.Literal("budget.status"), sessionId: id }),
  object({ type: Type.Literal("budget.dashboard"), projectId: Type.Optional(id), folderId: Type.Optional(id), sessionId: Type.Optional(id), modelId: Type.Optional(id), providerId: Type.Optional(id), role: Type.Optional(ModelRoleSchema), offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }),
]);
export type BudgetQuery = Static<typeof BudgetQuerySchema>;
export const isBudgetQuery = (value: unknown): value is BudgetQuery => Value.Check(BudgetQuerySchema, value);
export type BudgetResponse =
  | { type: "budget.status"; status: BudgetStatus }
  | { type: "budget.dashboard"; totals: BudgetTotals; groups: Array<{ role: ModelRole; modelId: string; providerId: string | null; totals: BudgetTotals }>; policy: { revision: number; limit: BudgetLimit | null }; nextOffset: number | null };
