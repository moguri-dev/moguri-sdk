import { Type, type Static } from "typebox";
import { BudgetRangeSchema, type BudgetTotals, type BudgetWindow } from "./budgets.ts";

export const DashboardQuerySchema = Type.Object({
  type: Type.Literal("dashboard.overview"), range: Type.Optional(BudgetRangeSchema),
  projectId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
}, { additionalProperties: false });
export type DashboardQuery = Static<typeof DashboardQuerySchema>;
export interface WorkCounts { total: number; open: number; inProgress: number; completed: number; archived: number }
export interface DashboardDay {
  date: string; totals: BudgetTotals; completedTurns: number; failedTurns: number; interruptedTurns: number; interventions: number; medianCompletionMs: number | null;
}
export interface WorkspaceDashboard {
  window: BudgetWindow; work: WorkCounts; totals: BudgetTotals; days: DashboardDay[];
  projects: { projectId: string | null; name: string; work: WorkCounts; totals: BudgetTotals; sessionIds: string[] }[];
  models: { modelId: string; name: string; totals: BudgetTotals }[];
  velocity: {
    completedTurns: number; failedTurns: number; interruptedTurns: number; interventions: number; medianCompletionMs: number | null;
    unmeasuredCompletions: number; previousCompletedTurns: number; completionChangePercent: number | null; productivityIncrease: null;
    coverage: "retained-agent-turns-only";
  };
}
export type DashboardResponse = { type: "dashboard.overview"; dashboard: WorkspaceDashboard };
