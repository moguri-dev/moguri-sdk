import {
  BUDGET_WARNING, isModelRole, MoguriError, projectBudgetPlan, sameBudgetRate, type BudgetEntry, type BudgetLimit, type BudgetQuery, type BudgetRate,
  type BudgetResponse, type BudgetStatus, type BudgetTotals, type Controls, type EventInput, type ModelRole, type Session,
  type Snapshot, type StoredEvent, type Usage, type UserSettings, type GlobalBudgetCapacity, type BudgetRange, type BudgetBucket, type BudgetWindow, type RepositoryCapture, type BudgetPlan, type UsageFilters,
} from "../../../packages/protocol/src/index.ts";
import { matchesRepository, repositoryCoverage } from "./repository-telemetry.ts";

interface ModelReservationInput {
  stepId: string; turnId: string; providerId: string | null; apiModelId: string; role: ModelRole;
  inputEstimate: number; maxOutputTokens: number; modelId?: string; repositoryCapture?: RepositoryCapture;
}
type PlannedReservationInput = Omit<ModelReservationInput, "stepId"> & { id: string; authorityDigest: string };
const integer = (value: number | null | undefined): value is number => value !== null && value !== undefined && Number.isSafeInteger(value) && value >= 0;
export const reportedModelUsage = (usage: Usage): usage is Usage & { totalTokens: number; outputTokens: number } =>
  usage.quality === "provider-reported" && integer(usage.totalTokens) && integer(usage.outputTokens) && usage.outputTokens <= usage.totalTokens;
export const modelOutputExceeded = (entry: BudgetEntry, usage: Usage): boolean =>
  reportedModelUsage(usage) && entry.outputLimit !== null && usage.outputTokens > entry.outputLimit;
const micros = (usd: number): number => Math.floor(usd * 1_000_000);
const price = (rate: BudgetRate, input: number, output: number): number | null => {
  const value = Math.ceil(input * rate.inputUsdPerMillion + output * rate.outputUsdPerMillion);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};
const recorded = (entry: BudgetEntry, profileId: string): EventInput => ({ event_type: "budget.recorded", profile_id: profileId, payload: { entry } });
const chargedTokens = (entry: BudgetEntry): number | null => entry.reportedTokens ?? entry.reservedTokens;
const chargedUsd = (entry: BudgetEntry): number | null => entry.status === "settled" ? entry.estimatedUsdMicros : entry.reservedUsdMicros;
const sum = <T>(entries: T[], read: (entry: T) => number | null): number | null => {
  const values = entries.map(read);
  if (values.some((value) => value === null)) return null;
  const total = values.reduce<number>((total, value) => total + value!, 0);
  return Number.isSafeInteger(total) ? total : null;
};
const category = (entries: BudgetEntry[], read: (entry: BudgetEntry) => number | null | undefined) => {
  const values = entries.map(read), known = values.filter((value): value is number => value !== null && value !== undefined);
  if (known.some((value) => !integer(value))) throw new MoguriError("telemetry_invalid", "Recorded token categories are invalid. No rounded or zero-valued telemetry was invented.", 409);
  const total = known.reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(total)) throw new MoguriError("telemetry_overflow", "Token category totals exceed safe precision.", 409);
  return { total: known.length === entries.length ? total : null, known: total };
};
const generative = (entry: BudgetEntry) => !["decision", "steering", "unknown"].includes(entry.role);
const usageMetrics = (usage?: Usage, reportedTokens?: number | null) => {
  const valid = usage !== undefined && reportedModelUsage(usage) && (reportedTokens === undefined || reportedTokens === usage.totalTokens);
  return {
    inputTokens: valid ? usage.totalTokens - usage.outputTokens : null, outputTokens: valid ? usage.outputTokens : null,
    cacheReadTokens: valid && integer(usage.cacheReadTokens) && (usage.stream !== undefined || usage.cacheReadTokens > 0) ? usage.cacheReadTokens : null,
    cacheWriteTokens: valid && integer(usage.cacheWriteTokens) ? usage.cacheWriteTokens : null,
    stream: usage?.stream ?? null, telemetryDiagnostic: usage?.telemetryDiagnostic ?? null,
  };
};
export function budgetTotals(entries: BudgetEntry[], plans: BudgetPlan[] = []): BudgetTotals {
  const reports = entries.filter((entry) => entry.reportedTokens !== null), estimates = entries.filter((entry) => entry.estimatedUsdMicros !== null), held = entries.filter((entry) => entry.status !== "settled");
  const planned = plans.filter((plan) => plan.status === "held"), plannedHeldTokens = sum(planned, (plan) => plan.tokens), plannedUsdMicros = sum(planned, (plan) => plan.usdMicros);
  const knownReportedTokens = reports.reduce((total, entry) => total + entry.reportedTokens!, 0), estimatedMicros = estimates.reduce((total, entry) => total + entry.estimatedUsdMicros!, 0);
  if (!Number.isSafeInteger(knownReportedTokens) || !Number.isSafeInteger(estimatedMicros)) throw new MoguriError("budget_overflow", "Reported accounting exceeds safe numeric precision. Totals are unavailable; no rounded success or free usage was invented.", 409);
  const knownEstimatedUsd = estimatedMicros / 1_000_000;
  const input = category(entries, (entry) => entry.inputTokens), output = category(entries, (entry) => entry.outputTokens);
  const measured = entries.filter((entry) => generative(entry) && entry.status === "settled" && integer(entry.outputTokens) &&
    entry.stream && entry.stream.outputEvents > 1 && entry.stream.streamMs !== null && Number.isFinite(entry.stream.streamMs) && entry.stream.streamMs > 0);
  const observedStreamMs = measured.reduce((total, entry) => total + entry.stream!.streamMs!, 0), observedOutputTokens = measured.reduce((total, entry) => total + entry.outputTokens!, 0);
  const first = entries.filter((entry) => generative(entry) && entry.stream?.firstOutputMs !== null && entry.stream?.firstOutputMs !== undefined);
  const firstMs = first.reduce((total, entry) => total + entry.stream!.firstOutputMs!, 0), requestMs = entries.reduce((total, entry) => total + entry.requestMs, 0);
  if (entries.some((entry) => !Number.isFinite(entry.requestMs) || entry.requestMs < 0) ||
    ![observedStreamMs, observedOutputTokens, firstMs, requestMs].every((value) => Number.isFinite(value) && value >= 0) || !Number.isSafeInteger(observedOutputTokens)) throw new MoguriError("telemetry_overflow", "Observed timing totals are invalid or exceed safe precision. No velocity was inferred.", 409);
  return {
    calls: entries.length, reportedTokens: reports.length === entries.length ? knownReportedTokens : null, knownReportedTokens,
    unknownTokenCalls: entries.length - reports.length, heldTokens: sum([sum(held, (entry) => entry.reservedTokens), plannedHeldTokens], (value) => value),
    plannedHolds: planned.length, plannedHeldTokens, plannedHeldUsd: plannedUsdMicros === null ? null : plannedUsdMicros / 1_000_000,
    unboundedTokenCalls: entries.filter((entry) => chargedTokens(entry) === null).length,
    estimatedUsd: estimates.length === entries.length ? knownEstimatedUsd : null, knownEstimatedUsd,
    heldUsd: (() => { const value = sum([sum(held, (entry) => entry.reservedUsdMicros), plannedUsdMicros], (value) => value); return value === null ? null : value / 1_000_000; })(),
    unpricedCalls: entries.filter((entry) => chargedUsd(entry) === null).length, providerReportedUsd: null, billedUsd: null,
    requestMs, inputTokens: input.total, outputTokens: output.total, knownInputTokens: input.known, knownOutputTokens: output.known,
    cacheReadTokens: category(entries, (entry) => entry.cacheReadTokens).total, cacheWriteTokens: category(entries, (entry) => entry.cacheWriteTokens).total,
    observedOutputTokensPerSecond: observedStreamMs > 0 ? observedOutputTokens * 1000 / observedStreamMs : null,
    measuredStreamCalls: measured.length, unmeasuredStreamCalls: entries.length - measured.length, observedStreamMs, observedOutputTokens,
    meanFirstOutputMs: first.length ? firstMs / first.length : null, firstOutputSamples: first.length,
  };
}
export const budgetCharges = (entries: BudgetEntry[], plans: BudgetPlan[] = []) => {
  const held = plans.filter((plan) => plan.status === "held");
  return { tokens: sum([sum(entries, chargedTokens), sum(held, (plan) => plan.tokens)], (value) => value),
    usdMicros: sum([sum(entries, chargedUsd), sum(held, (plan) => plan.usdMicros)], (value) => value) };
};
const DAY = 86_400_000;
const dateText = (value: number) => new Date(value).toISOString().slice(0, 10);
function utcDate(value: string): number {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed) || dateText(parsed) !== value) throw new MoguriError("telemetry_date", "Choose a real UTC calendar date (YYYY-MM-DD). No date was silently normalized.", 409);
  return parsed;
}
export function budgetWindow(range?: BudgetRange, now = Date.now()): { from: number | null; to: number | null } {
  if (!range || range.kind === "all") return { from: null, to: null };
  if (range.kind === "days") { const end = utcDate(dateText(now)) + DAY; return { from: end - range.days * DAY, to: end }; }
  if (range.kind === "year") {
    const from = utcDate(`${range.year}-01-01`), end = new Date(from); end.setUTCFullYear(range.year + 1);
    return { from, to: end.getTime() };
  }
  const from = utcDate(range.from), to = utcDate(range.to) + DAY;
  if (from >= to) throw new MoguriError("telemetry_range", "The UTC date range ends before it starts.", 409);
  return { from, to };
}
const callTime = (entry: BudgetEntry): number | null => {
  if (entry.imported && entry.timeBasis !== "model-start" || entry.timeBasis === "unknown" || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(entry.createdAt)) return null;
  const time = Date.parse(entry.createdAt);
  return Number.isFinite(time) && dateText(time) === entry.createdAt.slice(0, 10) ? time : null;
};
function period(time: number, bucket: Exclude<BudgetBucket, "all">): { from: string; to: string } {
  const start = new Date(time); start.setUTCHours(0, 0, 0, 0);
  if (bucket === "week") start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  if (bucket === "month") start.setUTCDate(1);
  const end = new Date(start);
  if (bucket === "month") end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCDate(end.getUTCDate() + (bucket === "week" ? 7 : 1));
  return { from: dateText(start.getTime()), to: dateText(end.getTime() - DAY) };
}
type AccountingScope = Pick<BudgetEntry, "projectId" | "folderId" | "sessionId" | "ownerSessionId" | "turnId" | "ownerTurnId" | "env" | "modelId" | "providerId" | "role">;
const matchesScope = (entry: AccountingScope, query: UsageFilters) => (query.projectId === undefined || entry.projectId === query.projectId) &&
  (query.folderId === undefined || entry.folderId === query.folderId) && (query.sessionId === undefined || entry.ownerSessionId === query.sessionId || entry.sessionId === query.sessionId) &&
  (query.turnId === undefined || entry.turnId === query.turnId || entry.ownerTurnId === query.turnId) && (query.env === undefined || entry.env === query.env) &&
  (query.modelId === undefined || entry.modelId === query.modelId) && (query.providerId === undefined || entry.providerId === query.providerId) && (query.role === undefined || entry.role === query.role);
function periods(entries: BudgetEntry[], bucket: BudgetBucket, bounds: { from: number | null; to: number | null }, plans: BudgetPlan[] = []) {
  if (bucket === "all") return entries.length || plans.length ? [{ from: bounds.from === null ? null : dateText(bounds.from), to: bounds.to === null ? null : dateText(bounds.to - DAY), totals: budgetTotals(entries, plans) }] : [];
  const dated = [...entries.map(callTime), ...plans.map((plan) => Date.parse(plan.createdAt))].reduce<{ from: number | null; to: number | null }>((values, time) => {
    return time === null ? values : { from: values.from === null ? time : Math.min(values.from, time), to: values.to === null ? time + 1 : Math.max(values.to, time + 1) };
  }, { from: null, to: null });
  const from = bounds.from ?? dated.from, to = bounds.to ?? dated.to;
  if (from !== null && to !== null) {
    const first = utcDate(period(from, bucket).from), last = utcDate(period(to - 1, bucket).from);
    const span = bucket === "month" ? (new Date(last).getUTCFullYear() - new Date(first).getUTCFullYear()) * 12 + new Date(last).getUTCMonth() - new Date(first).getUTCMonth() + 1 : (last - first) / (bucket === "week" ? 7 * DAY : DAY) + 1;
    if (span > 3660) throw new MoguriError("telemetry_periods", "This range spans more than 3,660 calendar buckets. Choose a wider bucket or a narrower range; no periods were silently dropped.", 409);
  }
  const groups = new Map<string, { from: string | null; to: string | null; entries: BudgetEntry[]; plans: BudgetPlan[] }>();
  const add = (time: number | null, value: BudgetEntry | BudgetPlan) => {
    const window = time === null ? { from: null, to: null } : period(time, bucket), key = window.from ?? "unknown";
    const group = groups.get(key) ?? { ...window, entries: [], plans: [] };
    if ("purpose" in value) group.plans.push(value); else group.entries.push(value);
    groups.set(key, group);
  };
  for (const entry of entries) add(callTime(entry), entry);
  for (const plan of plans) add(Date.parse(plan.createdAt), plan);
  return [...groups.values()].sort((left, right) => left.from === null ? right.from === null ? 0 : 1 : right.from === null ? -1 : left.from < right.from ? -1 : left.from > right.from ? 1 : 0)
    .map(({ from, to, entries, plans }) => ({ from, to, totals: budgetTotals(entries, plans) }));
}

export class BudgetRuntime {
  constructor(private readonly host: { snapshot(): Snapshot; events(): StoredEvent[]; global?: () => GlobalBudgetCapacity }) {}
  validateLimit(limit: { tokens?: number; usd?: number; basis?: "estimate" } | null): void {
    if (limit === null) return;
    if (limit.basis !== "estimate" || limit.tokens === undefined && limit.usd === undefined) throw new MoguriError("budget_policy", "Choose a token/USD limit and explicitly accept estimate-based accounting. No exact provider-billing cap is claimed.", 409);
    if (limit.tokens !== undefined && (!integer(limit.tokens) || limit.tokens < 1) || limit.usd !== undefined && (!Number.isFinite(limit.usd) || micros(limit.usd) < 1)) throw new MoguriError("budget_limit", "Use positive safe token limits and USD limits of at least one micro-dollar.");
  }
  validateControls(controls: Controls): void { if (controls.budget.kind === "limited") this.validateLimit(controls.budget); }
  validateSettings(settings: UserSettings): void {
    if (new Set(settings.budgets.rates.map((rate) => rate.modelId)).size !== settings.budgets.rates.length) throw new MoguriError("budget_rates", "Configure only one explicit current estimate per canonical model ID.");
    for (const rate of settings.budgets.rates) {
      const time = Date.parse(rate.effectiveAt);
      if (!Number.isFinite(time) || !/^\d{4}-\d{2}-\d{2}$/.test(rate.effectiveAt) || new Date(time).toISOString().slice(0, 10) !== rate.effectiveAt || time > Date.now()) throw new MoguriError("budget_rate_date", "Price estimates need a real current/past UTC effective date (YYYY-MM-DD), never an invented future price.");
    }
    for (const defaults of [settings.startup.global, settings.startup.profile]) if (defaults.budget?.kind === "limited") this.validateLimit(defaults.budget);
  }
  private session(id: string): Session {
    const session = this.host.snapshot().sessions.find((session) => session.id === id);
    if (!session) throw new MoguriError("budget_session", "Choose an existing session in this profile.", 404);
    return session;
  }
  owner(session: Session): Session {
    const seen = new Set<string>();
    while (session.kind === "subagent") {
      if (!session.parentSessionId || seen.has(session.id)) throw new MoguriError("budget_owner", "This model-created child has no valid owning session. No model charge was authorized.", 409);
      seen.add(session.id); session = this.session(session.parentSessionId);
    }
    return session;
  }
  private rate(modelId: string | null): BudgetRate | null {
    const settings = this.host.snapshot().settings.values.budgets, rate = settings.rates.find((rate) => rate.modelId === modelId);
    return rate && Date.now() - Date.parse(rate.effectiveAt) <= settings.maxPriceAgeDays * 86_400_000 ? structuredClone(rate) : null;
  }
    private owned(entries: BudgetEntry[], ownerId: string): BudgetEntry[] { return entries.filter((entry) => entry.ownerSessionId === ownerId || entry.ownerSessionId === null && ["subagent", "unknown"].includes(entry.role)); }
  private limits(owner: Session): Array<{ scope: "session" | "profile" | "global"; limit: BudgetLimit }> {
    const limits: Array<{ scope: "session" | "profile" | "global"; limit: BudgetLimit }> = [], profile = this.host.snapshot().budgetPolicy.limit;
    if (owner.controls.budget.kind === "limited") { this.validateLimit(owner.controls.budget); limits.push({ scope: "session", limit: { ...owner.controls.budget, basis: "estimate" } }); }
    if (profile) { this.validateLimit(profile); limits.push({ scope: "profile", limit: profile }); }
    const global = this.host.global?.().limit;
    if (global) { this.validateLimit(global); limits.push({ scope: "global", limit: global }); }
    return limits;
  }
  status(sessionId: string, actualModelId?: string): BudgetStatus {
    const session = this.session(sessionId), owner = this.owner(session), entries = this.host.snapshot().budgetEntries, plans = this.host.snapshot().budgetPlans,
      owned = this.owned(entries, owner.id), ownedPlans = plans.filter((plan) => plan.ownerSessionId === owner.id), limits = this.limits(owner);
    const diagnostics: string[] = [], remainingTokens: number[] = [], remainingUsd: number[] = [];
    for (const { scope, limit } of limits) {
      const scoped = scope === "session" ? owned : entries, global = scope === "global" ? this.host.global?.() : undefined;
      const charges = budgetCharges(scoped, scope === "session" ? ownedPlans : plans), tokens = global ? global.chargedTokens : charges.tokens, usd = global ? global.chargedUsdMicros : charges.usdMicros;
      if (limit.tokens !== undefined) { if (tokens === null) diagnostics.push(`${scope} has unbounded historical token usage; finite admission is blocked.`); else remainingTokens.push(Math.max(0, limit.tokens - tokens)); }
      if (limit.usd !== undefined) { if (usd === null) diagnostics.push(`${scope} has unpriced calls or planned holds; cumulative USD admission is blocked.`); else remainingUsd.push(Math.max(0, micros(limit.usd) - usd) / 1_000_000); }
    }
    const selectedModelId = actualModelId ?? session.controls.modelId, rate = this.rate(selectedModelId);
    if (limits.some(({ limit }) => limit.usd !== undefined) && !rate) diagnostics.push("The selected model needs an explicit fresh dated USD estimate; unknown pricing is not zero.");
    if (limits.length && entries.some((entry) => entry.modelId === selectedModelId && entry.outputLimitViolation)) diagnostics.push("This provider exceeded an actual forwarded output limit. Finite admission for this model is unqualified; verify the provider instead of retrying around it.");
    return { sessionId, ownerSessionId: owner.id, totals: budgetTotals(owned, ownedPlans), profileTotals: budgetTotals(entries, plans),
      limits: limits.map(({ scope, limit }) => ({ scope, tokens: limit.tokens ?? null, usd: limit.usd ?? null })),
      remainingTokens: remainingTokens.length ? Math.min(...remainingTokens) : null, remainingUsd: remainingUsd.length ? Math.min(...remainingUsd) : null,
      basis: "estimate", warning: BUDGET_WARNING, diagnostics, rate };
  }
  reserve(session: Session, input: ModelReservationInput): { event: EventInput; maxTokens: number } {
    return this.reservation(session, input);
  }
  private reservation(session: Session, input: ModelReservationInput, planned?: BudgetPlan): { event: EventInput; maxTokens: number } {
    const snapshot = this.host.snapshot(), owner = this.owner(session), limits = this.limits(owner), entries = snapshot.budgetEntries;
    if (entries.some((entry) => entry.id === input.stepId)) throw new MoguriError("budget_duplicate", "This exact model step already has an accounting reservation. It was not charged/dispatched again.", 409);
    const selectedModelId = input.modelId ?? session.controls.modelId;
    if (!integer(input.inputEstimate) || !integer(input.maxOutputTokens) || !Number.isSafeInteger(input.inputEstimate + input.maxOutputTokens) || input.maxOutputTokens < 1 || input.role === "unknown" || !selectedModelId) throw new MoguriError("budget_request", "Model accounting needs an actual role, selected model, bounded input estimate and a positive actual output limit.");
    const rate = this.rate(selectedModelId), status = this.status(session.id, selectedModelId);
    if (status.diagnostics.length) throw new MoguriError("budget_unavailable", status.diagnostics.join(" "), 409);
    const availability = limits.map(({ scope, limit }) => {
      const scoped = scope === "session" ? this.owned(entries, owner.id) : entries, global = scope === "global" ? this.host.global?.() : undefined;
      const charges = budgetCharges(scoped, snapshot.budgetPlans.filter((plan) => plan.id !== planned?.id && (scope !== "session" || plan.ownerSessionId === owner.id)));
      return { limit, tokens: limit.tokens === undefined ? null : limit.tokens - (global ? global.chargedTokens! - (planned?.tokens ?? 0) : charges.tokens!),
        usd: limit.usd === undefined ? null : micros(limit.usd) - (global ? global.chargedUsdMicros! - (planned?.usdMicros ?? 0) : charges.usdMicros!) };
    });
    const fits = (output: number) => {
      const cost = rate ? price(rate, input.inputEstimate, output) : null;
      return availability.every(({ tokens, usd }) => (tokens === null || input.inputEstimate + output <= tokens) && (usd === null || cost !== null && cost <= usd));
    };
    if (!fits(1)) throw new MoguriError("budget_exhausted", "The cumulative token/USD budget cannot reserve this request and one output token. No new model request was authorized; inspect the checkpoint or explicitly change the applicable cap.", 409);
    let low = 1, high = input.maxOutputTokens;
    while (low < high) { const middle = low + Math.ceil((high - low) / 2); if (fits(middle)) low = middle; else high = middle - 1; }
    const entry: BudgetEntry = {
      id: input.stepId, sessionId: session.id, ownerSessionId: owner.id, projectId: session.projectId, folderId: snapshot.projectConfigurations.find((configuration) => configuration.projectId === session.projectId)?.folderId ?? null,
      turnId: input.turnId, modelId: selectedModelId, providerId: input.providerId, apiModelId: input.apiModelId, role: input.role,
      env: session.controls.env, createdAt: new Date().toISOString(), imported: false, status: "reserved", inputEstimate: input.inputEstimate, outputLimit: low,
      reservedTokens: input.inputEstimate + low, reportedTokens: null, reservedUsdMicros: rate ? price(rate, input.inputEstimate, low) : null,
      estimatedUsdMicros: null, rate, requestMs: 0, outcome: "running", diagnostic: null,
      ...usageMetrics(), timeBasis: "admission", ownerTurnId: owner.id === session.id ? input.turnId : owner.turnId,
      repository: input.repositoryCapture?.repository ?? null, repositoryDiagnostic: input.repositoryCapture ? input.repositoryCapture.repositoryDiagnostic : "not-configured",
      ...(planned ? { planId: planned.id } : {}),
    };
    return { event: recorded(entry, snapshot.profileId), maxTokens: low };
  }
  plan(session: Session, input: PlannedReservationInput): { event: EventInput; plan: BudgetPlan } {
    const result = this.planBatch(session, [input]);
    return { event: result.events[0]!, plan: result.plans[0]! };
  }
  planBatch(session: Session, requested: PlannedReservationInput[]): { events: EventInput[]; plans: BudgetPlan[] } {
    if (!Array.isArray(requested) || !requested.length || requested.length > 32) throw new MoguriError("budget_plan_batch", "Plan between one and 32 complete role envelopes for one exact owning turn. No prefix was retained.", 409);
    const inputs = structuredClone(requested);
    if (new Set(inputs.map((input) => input.id)).size !== inputs.length || inputs.some((input) => input.turnId !== inputs[0]!.turnId)) throw new MoguriError("budget_plan_batch", "Each planned role needs a distinct original ID in the same owning turn. No prefix was retained.", 409);
    const original = this.host.snapshot(), snapshot = { ...original, budgetPlans: [...original.budgetPlans] }, global = this.host.global?.();
    const plans: BudgetPlan[] = [], events: EventInput[] = [];
    const prospective = new BudgetRuntime({
      snapshot: () => snapshot, events: () => this.host.events(),
      ...(global ? { global: () => {
        const added = budgetCharges([], plans);
        return { limit: global.limit, chargedTokens: sum([global.chargedTokens, added.tokens], (value) => value),
          chargedUsdMicros: sum([global.chargedUsdMicros, added.usdMicros], (value) => value) };
      } } : {}),
    });
    for (const input of inputs) {
      const next = prospective.planned(session, input);
      plans.push(next.plan); events.push(next.event); snapshot.budgetPlans.push(next.plan);
      const added = budgetCharges([], plans);
      if (added.tokens === null || added.usdMicros === null && plans.every((plan) => plan.usdMicros !== null)) throw new MoguriError("budget_overflow", "The complete planned batch exceeds safe token/price precision. No prefix or rounded capacity was retained.", 409);
    }
    return { plans, events };
  }
  private planned(session: Session, input: PlannedReservationInput): { event: EventInput; plan: BudgetPlan } {
    session = this.session(session.id);
    if (this.host.snapshot().budgetPlans.some((plan) => plan.id === input.id)) throw new MoguriError("budget_plan_duplicate", "This original planned reservation already exists. No new hold or replay was created.", 409);
    const reserved = this.reservation(session, { ...input, stepId: input.id });
    if (reserved.maxTokens !== input.maxOutputTokens || reserved.event.event_type !== "budget.recorded") throw new MoguriError("budget_plan_capacity", "The complete required wind-down bound cannot fit. No partial plan or normal request was admitted.", 409);
    const entry = reserved.event.payload.entry;
    const plan = projectBudgetPlan(undefined, {
      version: 1, id: input.id, profileId: this.host.snapshot().profileId, sessionId: session.id, ownerSessionId: entry.ownerSessionId,
      turnId: input.turnId, ownerTurnId: entry.ownerTurnId ?? null, projectId: entry.projectId, folderId: entry.folderId, env: session.controls.env, purpose: "winddown",
      role: input.role, modelId: entry.modelId, providerId: input.providerId, apiModelId: input.apiModelId, authorityDigest: input.authorityDigest,
      inputBound: input.inputEstimate, outputBound: input.maxOutputTokens, tokens: entry.reservedTokens, usdMicros: entry.reservedUsdMicros, rate: entry.rate,
      revision: 0, createdAt: entry.createdAt, updatedAt: entry.createdAt, status: "held", consumedStepId: null, release: null,
    });
    return { plan, event: { event_type: "budget.plan_recorded", profile_id: plan.profileId, payload: { plan } } };
  }
  consumePlan(session: Session, id: string, input: ModelReservationInput & { authorityDigest: string }): { events: EventInput[]; maxTokens: number } {
    session = this.session(session.id);
    this.assertHeldCapacity(session);
    const snapshot = this.host.snapshot(), plan = snapshot.budgetPlans.find((plan) => plan.id === id), owner = this.owner(session);
    if (!plan || plan.status !== "held" || plan.sessionId !== session.id || plan.ownerSessionId !== owner.id || plan.turnId !== input.turnId ||
      plan.ownerTurnId !== (owner.id === session.id ? input.turnId : owner.turnId) || plan.projectId !== session.projectId ||
      plan.folderId !== (snapshot.projectConfigurations.find((configuration) => configuration.projectId === session.projectId)?.folderId ?? null) ||
      plan.env !== session.controls.env || plan.authorityDigest !== input.authorityDigest || plan.role !== input.role || plan.providerId !== input.providerId ||
      plan.apiModelId !== input.apiModelId || plan.modelId !== (input.modelId ?? session.controls.modelId) ||
      !integer(input.inputEstimate) || !integer(input.maxOutputTokens) || input.inputEstimate > plan.inputBound || input.maxOutputTokens < plan.outputBound ||
      !sameBudgetRate(plan.rate, this.rate(plan.modelId))) throw new MoguriError("budget_plan_changed", "This exact original held plan no longer matches the current owner, scope, model, price or request bounds. No capacity was transferred.", 409);
    const reserved = this.reservation(session, { ...input, maxOutputTokens: plan.outputBound }, plan);
    if (reserved.maxTokens !== plan.outputBound) throw new MoguriError("budget_plan_capacity", "The latest policy cannot fit the complete planned final request. The hold and work were preserved.", 409);
    const consumed = projectBudgetPlan(plan, { ...plan, revision: plan.revision + 1, status: "consumed", consumedStepId: input.stepId, updatedAt: new Date().toISOString() });
    return { events: [reserved.event, { event_type: "budget.plan_recorded", profile_id: consumed.profileId, payload: { plan: consumed } }], maxTokens: reserved.maxTokens };
  }
  reservedOutput(session: Session, input: { stepId: string; turnId: string; modelId: string; providerId: string | null; apiModelId: string; role: ModelRole; inputEstimate: number; maxOutputTokens: number }): number {
    session = this.session(session.id);
    const snapshot = this.host.snapshot(), owner = this.owner(session), entry = snapshot.budgetEntries.find((entry) => entry.id === input.stepId);
    if (!entry || entry.sessionId !== session.id || entry.ownerSessionId !== owner.id || entry.env !== session.controls.env ||
      input.role === "unknown" || entry.turnId !== input.turnId || entry.role !== input.role || entry.modelId !== input.modelId ||
      entry.providerId !== input.providerId || entry.apiModelId !== input.apiModelId ||
      !integer(input.inputEstimate) || !integer(input.maxOutputTokens) || input.maxOutputTokens < 1 ||
      !integer(entry.inputEstimate) || !integer(entry.outputLimit) || entry.outputLimit < 1 ||
      input.inputEstimate > entry.inputEstimate || entry.outputLimit > input.maxOutputTokens ||
      entry.reservedTokens !== entry.inputEstimate + entry.outputLimit) throw new MoguriError("budget_reservation", "This exact role/model/session/input has no matching bounded reservation. No held capacity was borrowed or dispatched.", 409);
    if (this.host.events().some((event) => event.event_type === "model.started" && event.step_id === input.stepId)) throw new MoguriError("budget_duplicate", "The reserved model step already has a recorded dispatch. No lost-receipt request was replayed.", 409);
    if (entry.status !== "reserved") throw new MoguriError("budget_reservation", "Only an original undispatched reservation can start. Settled or unknown work was not replayed or refunded.", 409);
    const status = this.status(session.id, input.modelId), limits = this.limits(owner);
    if (status.diagnostics.length) throw new MoguriError("budget_unavailable", status.diagnostics.join(" "), 409);
    if (limits.some(({ limit }) => limit.usd !== undefined) && !sameBudgetRate(entry.rate, this.rate(input.modelId))) throw new MoguriError("budget_reservation", "The captured USD estimate changed before reserved dispatch. Review a new policy; no repricing or free call was invented.", 409);
    this.assertHeldCapacity(session);
    return entry.outputLimit;
  }
  private assertHeldCapacity(session: Session): void {
    const snapshot = this.host.snapshot(), owner = this.owner(session), limits = this.limits(owner);
    for (const { scope, limit } of limits) {
      const scoped = scope === "session" ? this.owned(snapshot.budgetEntries, owner.id) : snapshot.budgetEntries, global = scope === "global" ? this.host.global?.() : undefined;
      const charges = budgetCharges(scoped, snapshot.budgetPlans.filter((plan) => scope !== "session" || plan.ownerSessionId === owner.id)),
        tokens = global ? global.chargedTokens : charges.tokens, usd = global ? global.chargedUsdMicros : charges.usdMicros;
      if (limit.tokens !== undefined && (tokens === null || tokens > limit.tokens) ||
        limit.usd !== undefined && (usd === null || usd > micros(limit.usd))) throw new MoguriError("budget_exhausted", "The latest cumulative policy is below actual/held usage. Reserved wind-down cannot override a stricter cap; work and its hold were preserved.", 409);
    }
  }
  estimated(usage: Usage): Usage {
    const entry = this.host.snapshot().budgetEntries.find((entry) => entry.id === usage.stepId);
    const cost = entry?.rate && reportedModelUsage(usage) ?
      price(entry.rate, usage.totalTokens - usage.outputTokens, usage.outputTokens) : null;
    return { ...usage, estimatedUsd: cost === null ? null : cost / 1_000_000 };
  }
  derived(snapshot: Snapshot, primary: StoredEvent[]): EventInput[] {
    const updates = new Map<string, BudgetEntry>();
    const plannedUpdates = new Map<string, BudgetPlan>();
    for (const event of primary) if (event.event_type === "budget.recorded" && event.payload.entry.planId && !this.host.snapshot().budgetEntries.some((entry) => entry.id === event.payload.entry.id)) {
      const entry = event.payload.entry, plan = snapshot.budgetPlans.find((plan) => plan.id === entry.planId);
      const starts = primary.filter((event) => event.event_type === "model.started" && event.step_id === entry.id);
      const started = starts[0];
      if (!plan || plan.status !== "consumed" || plan.consumedStepId !== entry.id || starts.length !== 1 || !started || started.event_type !== "model.started" ||
        started.session_id !== entry.sessionId || started.turn_id !== entry.turnId || started.payload.modelId !== entry.modelId ||
        started.payload.role !== entry.role || (started.payload.providerId ?? null) !== entry.providerId || started.payload.apiModelId !== entry.apiModelId ||
        started.payload.contextEstimate !== entry.inputEstimate) throw new MoguriError("budget_plan_dispatch", "A planned hold transfers only with its exact atomically recorded model start. No request was authorized.", 409);
    }
    for (const event of primary) {
      if (event.event_type === "model.completed" || event.event_type === "model.late_usage") {
        const usage = event.payload.usage, entry = snapshot.budgetEntries.find((entry) => entry.id === usage.stepId);
        if (!entry) throw new MoguriError("budget_receipt", "This model completion has no owning accounting reservation. No free/duplicate charge was invented.", 409);
        const valid = reportedModelUsage(usage);
        const reportedTokens = valid ? usage.totalTokens : null, estimatedUsdMicros = valid && entry.rate ? price(entry.rate, usage.totalTokens! - usage.outputTokens!, usage.outputTokens!) : null;
        const outputLimitViolation = modelOutputExceeded(entry, usage);
        updates.set(entry.id, { ...entry, ...usageMetrics(usage), status: valid ? "settled" : "unknown", reportedTokens, estimatedUsdMicros, requestMs: usage.requestMs, outcome: usage.outcome, outputLimitViolation,
          diagnostic: valid ? entry.rate && estimatedUsdMicros === null ? "Reported tokens were retained, but their price exceeds safe numeric precision. USD accounting is unknown, never zero." :
            usage.totalTokens! > (entry.reservedTokens ?? 0) ? "Provider-reported usage exceeded the estimate-based reservation. Actual usage was retained; further admission rechecks the cap." : null :
            "Provider metering is missing/invalid. The complete reservation remains held, not refunded as zero." });
      }
      if (event.event_type === "turn.finished") for (const entry of snapshot.budgetEntries.filter((entry) => entry.turnId === event.turn_id && entry.status === "reserved")) {
        if (!updates.has(entry.id)) updates.set(entry.id, { ...entry, status: "unknown", outcome: event.payload.outcome, diagnostic: "The turn ended without confirmed provider usage. Its reservation remains held; no replay or refund was inferred." });
      }
      for (const plan of snapshot.budgetPlans) if (plan.status === "held" && !plannedUpdates.has(plan.id)) {
        const reason = event.event_type === "turn.finished" && event.session_id === plan.sessionId && event.turn_id === plan.turnId ? "owner-turn-finished" :
          event.event_type === "session.deleted" && event.payload.deletedSessionId === plan.sessionId ? "owner-session-deleted" :
          event.event_type === "project.removed" && event.payload.deletedProjectId === plan.projectId ? "owner-project-removed" : null;
        if (reason) plannedUpdates.set(plan.id, projectBudgetPlan(plan, { ...plan, revision: plan.revision + 1, status: "released", updatedAt: event.timestamp, release: { actor: "policy", sourceEventId: event.id, reason } }));
      }
    }
    return [...updates.values()].map((entry) => recorded(entry, snapshot.profileId)).concat([...plannedUpdates.values()].map((plan): EventInput => ({ event_type: "budget.plan_recorded", profile_id: plan.profileId, payload: { plan } })));
  }
  legacyEvents(): EventInput[] {
    const snapshot = this.host.snapshot(), history = this.host.events(), existing = new Set(snapshot.budgetEntries.map((entry) => entry.id));
    const starts = new Map(history.filter((event) => event.event_type === "model.started" && event.step_id).map((event) => [event.step_id!, event.timestamp]));
    const turns = new Map(history.filter((event) => event.event_type === "model.started" && event.step_id).map((event) => [event.step_id!, event.turn_id]));
    const sources = new Map<string, { usage: Usage; sessionId: string | null; projectId: string | null; timestamp: string }>();
    for (const session of snapshot.sessions) for (const usage of session.usage) sources.set(usage.stepId, { usage, sessionId: session.id, projectId: session.projectId, timestamp: session.createdAt });
    for (const event of history) if (event.event_type === "session.deleted" || event.event_type === "project.removed") for (const usage of event.payload.usage) {
      if (!sources.has(usage.stepId)) sources.set(usage.stepId, { usage, sessionId: event.event_type === "session.deleted" ? event.payload.deletedSessionId : null, projectId: event.project_id ?? null, timestamp: event.timestamp });
    }
    const imported = [...sources.values()].filter(({ usage }) => !existing.has(usage.stepId)).map(({ usage, sessionId, projectId, timestamp }) => {
      const session = snapshot.sessions.find((session) => session.id === sessionId);
      const linked = session && (session.kind !== "subagent" || snapshot.sessions.some((parent) => parent.id === session.parentSessionId));
      const role = isModelRole(usage.role) ? usage.role : "unknown";
      const owner = linked ? this.owner(session).id : role === "subagent" || role === "unknown" ? null : sessionId;
      const valid = usage.quality === "provider-reported" && integer(usage.totalTokens);
      return recorded({
        id: usage.stepId, sessionId, ownerSessionId: owner, projectId, folderId: null, turnId: turns.get(usage.stepId) ?? null, ownerTurnId: owner === sessionId ? turns.get(usage.stepId) ?? null : null, modelId: usage.modelId, providerId: usage.providerId ?? null, apiModelId: usage.apiModelId ?? null,
        role, env: session?.controls.env ?? "unknown", createdAt: starts.get(usage.stepId) ?? timestamp, imported: true, status: valid ? "settled" : "unknown",
        inputEstimate: usage.contextEstimate ?? null, outputLimit: null, reservedTokens: valid ? usage.totalTokens : integer(usage.contextWindow) ? usage.contextWindow : null,
        reportedTokens: valid ? usage.totalTokens : null, reservedUsdMicros: null, estimatedUsdMicros: null, rate: null, requestMs: usage.requestMs, outcome: usage.outcome,
        diagnostic: "Imported historical metering; start time/price or unknown bounds were not invented. Legacy USD remains unpriced.",
        ...usageMetrics(usage), timeBasis: starts.has(usage.stepId) ? "model-start" : "unknown",
      }, snapshot.profileId);
    });
    const upgraded = snapshot.budgetEntries.filter((entry) => entry.outputTokens === undefined || entry.timeBasis === undefined || entry.ownerTurnId === undefined).map((entry) => {
      const source = sources.get(entry.id)?.usage, started = entry.imported ? starts.get(entry.id) : undefined;
      return recorded({ ...entry, ...(entry.outputTokens === undefined ? usageMetrics(source, entry.reportedTokens) : {}), createdAt: started ?? entry.createdAt,
        timeBasis: entry.imported ? started ? "model-start" : "unknown" : "admission",
        ownerTurnId: entry.ownerTurnId !== undefined ? entry.ownerTurnId : entry.ownerSessionId === entry.sessionId ? entry.turnId : null }, snapshot.profileId);
    });
    return [...imported, ...upgraded];
  }
  query(query: BudgetQuery): BudgetResponse {
    if (query.type === "budget.status") return { type: query.type, status: this.status(query.sessionId) };
    const snapshot = this.host.snapshot(), scoped = snapshot.budgetEntries.filter((entry) => matchesScope(entry, query));
    const bounds = budgetWindow(query.range), scopedPlans = snapshot.budgetPlans.filter((plan) => matchesScope(plan, query) &&
      (bounds.from === null || Date.parse(plan.createdAt) >= bounds.from && Date.parse(plan.createdAt) < bounds.to!));
    const offset = query.offset ?? 0, end = offset + (query.limit ?? 50);
    if (query.type === "budget.plans") {
      const plans = scopedPlans.filter((plan) => query.status === undefined || plan.status === query.status).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return { type: query.type, plans: structuredClone(plans.slice(offset, end)), nextOffset: end < plans.length ? end : null,
        window: { from: bounds.from === null ? null : dateText(bounds.from), to: bounds.to === null ? null : dateText(bounds.to - DAY), timezone: "UTC", uncertainTimeCalls: 0, excludedUncertainTimeCalls: 0 } };
    }
    const uncertainTimeCalls = scoped.filter((entry) => callTime(entry) === null).length;
    const dated = scoped.filter((entry) => {
      const time = callTime(entry);
      return bounds.from === null || time !== null && time >= bounds.from && time < bounds.to!;
    });
    const repositoryAccounting = repositoryCoverage(dated), entries = dated.filter((entry) => matchesRepository(entry.repository, query));
    const window: BudgetWindow = { from: bounds.from === null ? null : dateText(bounds.from), to: bounds.to === null ? null : dateText(bounds.to - DAY), timezone: "UTC", uncertainTimeCalls, excludedUncertainTimeCalls: bounds.from === null ? 0 : uncertainTimeCalls };
    if (query.type === "budget.calls") {
      const calls = [...entries].sort((left, right) => (callTime(right) ?? -Infinity) - (callTime(left) ?? -Infinity) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
      return { type: query.type, calls: structuredClone(calls.slice(offset, end)), nextOffset: end < calls.length ? end : null, window, repositoryCoverage: repositoryAccounting };
    }
    const plans = matchesRepository(null, query) ? scopedPlans.filter((plan) => plan.status === "held") : [];
    const grouped = new Map<string, { role: ModelRole; modelId: string; providerId: string | null; entries: BudgetEntry[]; plans: BudgetPlan[] }>();
    const groupEntry = (value: BudgetEntry | BudgetPlan) => {
      const key = JSON.stringify([value.role, value.modelId, value.providerId]), group = grouped.get(key) ?? { role: value.role, modelId: value.modelId, providerId: value.providerId, entries: [], plans: [] };
      if ("purpose" in value) group.plans.push(value); else group.entries.push(value);
      grouped.set(key, group);
    };
    for (const entry of entries) groupEntry(entry);
    for (const plan of plans) groupEntry(plan);
    const prices = new Map<string, { rate: BudgetRate; entries: BudgetEntry[] }>();
    for (const entry of entries) if (entry.rate) {
      const rate = entry.rate, key = JSON.stringify([rate.modelId, rate.effectiveAt, rate.inputUsdPerMillion, rate.outputUsdPerMillion, rate.source]);
      const group = prices.get(key) ?? { rate, entries: [] }; group.entries.push(entry); prices.set(key, group);
    }
    if (prices.size > 2000) throw new MoguriError("telemetry_prices", "More than 2,000 distinct captured rates match. Choose a model or date filter; no price history was silently truncated.", 409);
    const groups = [...grouped.values()], bucket = query.bucket ?? "month";
    return { type: query.type, totals: budgetTotals(entries, plans), groups: groups.slice(offset, end).map(({ role, modelId, providerId, entries, plans }) => ({ role, modelId, providerId, totals: budgetTotals(entries, plans) })), policy: snapshot.budgetPolicy, nextOffset: end < groups.length ? end : null,
      window, bucket, periods: periods(entries, bucket, bounds, plans), pricing: [...prices.values()].map(({ rate, entries }) => ({ rate: structuredClone(rate), calls: entries.length, estimatedUsd: budgetTotals(entries).estimatedUsd })), currency: "USD", repositoryCoverage: repositoryAccounting };
  }
}
