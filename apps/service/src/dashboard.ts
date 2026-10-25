import { MoguriError, type DashboardQuery, type DashboardResponse, type Snapshot, type StoredEvent, type WorkCounts, type WorkspaceDashboard } from "../../../packages/protocol/src/index.ts";
import { BudgetRuntime, budgetTotals, budgetWindow } from "./budgets.ts";

const DAY = 86_400_000;
const date = (time: number) => new Date(time).toISOString().slice(0, 10);
const counts = (): WorkCounts => ({ total: 0, open: 0, inProgress: 0, completed: 0, archived: 0 });
const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

export function dashboardOverview(snapshot: Snapshot, events: StoredEvent[], budgets: BudgetRuntime, query: DashboardQuery): DashboardResponse {
  const range = query.range ?? { kind: "days", days: 7 }, bounds = budgetWindow(range);
  if (bounds.from === null || bounds.to === null) throw new MoguriError("dashboard_range", "Choose a dated dashboard range. All-time accounting remains available in detailed usage.");
  const budget = budgets.query({ type: "budget.dashboard", range, projectId: query.projectId, bucket: "day" });
  if (budget.type !== "budget.dashboard") throw new MoguriError("dashboard_accounting", "The accounting response changed type. No totals were substituted.");
  const periods = new Map(budget.periods.map((period) => [period.from, period.totals]));
  const days: WorkspaceDashboard["days"] = [];
  for (let time = bounds.from; time < bounds.to; time += DAY) days.push({
    date: date(time), totals: periods.get(date(time)) ?? budgetTotals([]), completedTurns: 0, failedTurns: 0, interruptedTurns: 0, interventions: 0, medianCompletionMs: null,
  });
  const byDay = new Map(days.map((day) => [day.date, day])), durations: number[] = [], dayDurations = new Map<string, number[]>();
  const inRange = (timestamp: string) => { const time = Date.parse(timestamp); return time >= bounds.from! && time < bounds.to!; };
  const scoped = events.filter((event) => event.profile_id === snapshot.profileId && (query.projectId === undefined || event.project_id === query.projectId));
  const starts = new Map(scoped.flatMap((event) => event.event_type === "turn.started" && event.turn_id ? [[event.turn_id, event] as const] : []));
  const velocity: WorkspaceDashboard["velocity"] = {
    completedTurns: 0, failedTurns: 0, interruptedTurns: 0, interventions: 0, medianCompletionMs: null,
    unmeasuredCompletions: 0, previousCompletedTurns: 0, completionChangePercent: null, productivityIncrease: null, coverage: "retained-agent-turns-only",
  };
  const finished = new Set<string>(), previousFrom = bounds.from - (bounds.to - bounds.from);
  for (const event of scoped) {
    if (!event.turn_id || !starts.has(event.turn_id)) continue;
    if (event.event_type === "turn.finished") {
      if (finished.has(event.turn_id)) throw new MoguriError("dashboard_duplicate_turn", "A retained agent turn has multiple terminal outcomes. Velocity is unavailable instead of double-counted.", 409);
      finished.add(event.turn_id);
      const time = Date.parse(event.timestamp);
      if (time >= previousFrom && time < bounds.from && event.payload.outcome === "completed") velocity.previousCompletedTurns++;
      if (!inRange(event.timestamp)) continue;
      const day = byDay.get(date(time))!;
      if (event.payload.outcome === "completed") {
        velocity.completedTurns++; day.completedTurns++;
        const elapsed = time - Date.parse(starts.get(event.turn_id)!.timestamp);
        if (Number.isSafeInteger(elapsed) && elapsed >= 0) {
          durations.push(elapsed);
          const values = dayDurations.get(day.date) ?? []; values.push(elapsed); dayDurations.set(day.date, values);
        } else velocity.unmeasuredCompletions++;
      } else if (event.payload.outcome === "failed") { velocity.failedTurns++; day.failedTurns++; }
      else { velocity.interruptedTurns++; day.interruptedTurns++; }
    } else if (inRange(event.timestamp) && (event.event_type === "tool.decided" && event.payload.actor === "user" ||
      event.event_type === "question.answered" && event.payload.answer.actor === "user")) {
      velocity.interventions++; byDay.get(date(Date.parse(event.timestamp)))!.interventions++;
    }
  }
  velocity.medianCompletionMs = median(durations);
  velocity.completionChangePercent = velocity.previousCompletedTurns ? (velocity.completedTurns - velocity.previousCompletedTurns) / velocity.previousCompletedTurns * 100 : null;
  for (const day of days) day.medianCompletionMs = median(dayDurations.get(day.date) ?? []);
  const work = counts(), projects = new Map<string | null, WorkspaceDashboard["projects"][number]>();
  const project = (projectId: string | null) => {
    let value = projects.get(projectId);
    if (!value) {
      value = { projectId, name: projectId === null ? "Project-free chats" : snapshot.projects.find((value) => value.id === projectId)?.name ?? `Removed project (${projectId})`,
        work: counts(), totals: budgetTotals([]), sessionIds: [] };
      projects.set(projectId, value);
    }
    return value;
  };
  for (const value of snapshot.projects) if (query.projectId === undefined || query.projectId === value.id) project(value.id);
  for (const value of budget.projects) project(value.projectId).totals = value.totals;
  for (const session of [...snapshot.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    if (query.projectId !== undefined && session.projectId !== query.projectId || session.kind === "subagent") continue;
    if (["archived", "completed"].includes(session.status) && !inRange(session.updatedAt)) continue;
    const value = project(session.projectId);
    const status = session.status === "archived" ? "archived" : session.turnId ? "inProgress" : session.status === "completed" ? "completed" : "open";
    value.sessionIds.push(session.id); value.work.total++; value.work[status]++; work.total++; work[status]++;
  }
  return { type: query.type, dashboard: { window: budget.window, work, totals: budget.totals, days,
    projects: [...projects.values()].sort((a, b) => b.work.inProgress - a.work.inProgress || b.totals.knownReportedTokens - a.totals.knownReportedTokens || a.name.localeCompare(b.name)),
    models: budget.models.map((value) => ({ ...value, name: snapshot.provider.models.find((model) => model.id === value.modelId)?.name ?? value.modelId }))
      .sort((a, b) => b.totals.knownReportedTokens - a.totals.knownReportedTokens || a.name.localeCompare(b.name)), velocity } };
}
