import {
  BUDGET_WARNING, isModelRole, MoguriError, PROFILE_ID, type BudgetEntry, type BudgetLimit, type BudgetQuery, type BudgetRate,
  type BudgetResponse, type BudgetStatus, type BudgetTotals, type Controls, type EventInput, type ModelRole, type Session,
  type Snapshot, type StoredEvent, type Usage, type UserSettings,
} from "../../../packages/protocol/src/index.ts";

const integer = (value: number | null | undefined): value is number => value !== null && value !== undefined && Number.isSafeInteger(value) && value >= 0;
const micros = (usd: number): number => Math.floor(usd * 1_000_000);
const price = (rate: BudgetRate, input: number, output: number): number | null => {
  const value = Math.ceil(input * rate.inputUsdPerMillion + output * rate.outputUsdPerMillion);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};
const recorded = (entry: BudgetEntry): EventInput => ({ event_type: "budget.recorded", profile_id: PROFILE_ID, payload: { entry } });
const chargedTokens = (entry: BudgetEntry): number | null => entry.reportedTokens ?? entry.reservedTokens;
const chargedUsd = (entry: BudgetEntry): number | null => entry.status === "settled" ? entry.estimatedUsdMicros : entry.reservedUsdMicros;
const sum = (entries: BudgetEntry[], read: (entry: BudgetEntry) => number | null): number | null => {
  const values = entries.map(read);
  if (values.some((value) => value === null)) return null;
  const total = values.reduce<number>((total, value) => total + value!, 0);
  return Number.isSafeInteger(total) ? total : null;
};
export function budgetTotals(entries: BudgetEntry[]): BudgetTotals {
  const reports = entries.filter((entry) => entry.reportedTokens !== null), estimates = entries.filter((entry) => entry.estimatedUsdMicros !== null), held = entries.filter((entry) => entry.status !== "settled");
  const knownReportedTokens = reports.reduce((total, entry) => total + entry.reportedTokens!, 0), estimatedMicros = estimates.reduce((total, entry) => total + entry.estimatedUsdMicros!, 0);
  if (!Number.isSafeInteger(knownReportedTokens) || !Number.isSafeInteger(estimatedMicros)) throw new MoguriError("budget_overflow", "Reported accounting exceeds safe numeric precision. Totals are unavailable; no rounded success or free usage was invented.", 409);
  const knownEstimatedUsd = estimatedMicros / 1_000_000;
  return {
    calls: entries.length, reportedTokens: reports.length === entries.length ? knownReportedTokens : null, knownReportedTokens,
    unknownTokenCalls: entries.length - reports.length, heldTokens: sum(held, (entry) => entry.reservedTokens),
    unboundedTokenCalls: entries.filter((entry) => chargedTokens(entry) === null).length,
    estimatedUsd: estimates.length === entries.length ? knownEstimatedUsd : null, knownEstimatedUsd,
    heldUsd: (() => { const value = sum(held, (entry) => entry.reservedUsdMicros); return value === null ? null : value / 1_000_000; })(),
    unpricedCalls: entries.filter((entry) => chargedUsd(entry) === null).length, providerReportedUsd: null, billedUsd: null,
    requestMs: entries.reduce((total, entry) => total + entry.requestMs, 0),
  };
}

export class BudgetRuntime {
  constructor(private readonly host: { snapshot(): Snapshot; events(): StoredEvent[] }) {}
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
  private limits(owner: Session): Array<{ scope: "session" | "profile"; limit: BudgetLimit }> {
    const limits: Array<{ scope: "session" | "profile"; limit: BudgetLimit }> = [], profile = this.host.snapshot().budgetPolicy.limit;
    if (owner.controls.budget.kind === "limited") { this.validateLimit(owner.controls.budget); limits.push({ scope: "session", limit: { ...owner.controls.budget, basis: "estimate" } }); }
    if (profile) { this.validateLimit(profile); limits.push({ scope: "profile", limit: profile }); }
    return limits;
  }
  status(sessionId: string): BudgetStatus {
    const session = this.session(sessionId), owner = this.owner(session), entries = this.host.snapshot().budgetEntries, owned = this.owned(entries, owner.id), limits = this.limits(owner);
    const diagnostics: string[] = [], remainingTokens: number[] = [], remainingUsd: number[] = [];
    for (const { scope, limit } of limits) {
      const scoped = scope === "session" ? owned : entries, tokens = sum(scoped, chargedTokens), usd = sum(scoped, chargedUsd);
      if (limit.tokens !== undefined) { if (tokens === null) diagnostics.push(`${scope} has unbounded historical token usage; finite admission is blocked.`); else remainingTokens.push(Math.max(0, limit.tokens - tokens)); }
      if (limit.usd !== undefined) { if (usd === null) diagnostics.push(`${scope} has unpriced historical/held calls; cumulative USD admission is blocked.`); else remainingUsd.push(Math.max(0, micros(limit.usd) - usd) / 1_000_000); }
    }
    const rate = this.rate(session.controls.modelId);
    if (limits.some(({ limit }) => limit.usd !== undefined) && !rate) diagnostics.push("The selected model needs an explicit fresh dated USD estimate; unknown pricing is not zero.");
    if (limits.length && entries.some((entry) => entry.modelId === session.controls.modelId && entry.outputLimitViolation)) diagnostics.push("This provider exceeded an actual forwarded output limit. Finite admission for this model is unqualified; verify the provider instead of retrying around it.");
    return { sessionId, ownerSessionId: owner.id, totals: budgetTotals(owned), profileTotals: budgetTotals(entries),
      limits: limits.map(({ scope, limit }) => ({ scope, tokens: limit.tokens ?? null, usd: limit.usd ?? null })),
      remainingTokens: remainingTokens.length ? Math.min(...remainingTokens) : null, remainingUsd: remainingUsd.length ? Math.min(...remainingUsd) : null,
      basis: "estimate", warning: BUDGET_WARNING, diagnostics, rate };
  }
  reserve(session: Session, input: { stepId: string; turnId: string; providerId: string | null; apiModelId: string; role: ModelRole; inputEstimate: number; maxOutputTokens: number }): { event: EventInput; maxTokens: number } {
    const snapshot = this.host.snapshot(), owner = this.owner(session), limits = this.limits(owner), entries = snapshot.budgetEntries;
    if (entries.some((entry) => entry.id === input.stepId)) throw new MoguriError("budget_duplicate", "This exact model step already has an accounting reservation. It was not charged/dispatched again.", 409);
    if (!integer(input.inputEstimate) || !integer(input.maxOutputTokens) || !Number.isSafeInteger(input.inputEstimate + input.maxOutputTokens) || input.maxOutputTokens < 1 || input.role === "unknown" || !session.controls.modelId) throw new MoguriError("budget_request", "Model accounting needs an actual role, selected model, bounded input estimate and a positive actual output limit.");
    const rate = this.rate(session.controls.modelId), status = this.status(session.id);
    if (status.diagnostics.length) throw new MoguriError("budget_unavailable", status.diagnostics.join(" "), 409);
    const availability = limits.map(({ scope, limit }) => {
      const scoped = scope === "session" ? this.owned(entries, owner.id) : entries;
      return { limit, tokens: limit.tokens === undefined ? null : limit.tokens - sum(scoped, chargedTokens)!, usd: limit.usd === undefined ? null : micros(limit.usd) - sum(scoped, chargedUsd)! };
    });
    const fits = (output: number) => {
      const cost = rate ? price(rate, input.inputEstimate, output) : null;
      return availability.every(({ tokens, usd }) => (tokens === null || input.inputEstimate + output <= tokens) && (usd === null || cost !== null && cost <= usd));
    };
    if (!fits(1)) throw new MoguriError("budget_exhausted", "The cumulative token/USD budget cannot reserve this request and one output token. No new model request was authorized; inspect the checkpoint or explicitly change the applicable cap.", 409);
    let low = 1, high = input.maxOutputTokens;
    while (low < high) { const middle = Math.ceil((low + high) / 2); if (fits(middle)) low = middle; else high = middle - 1; }
    const entry: BudgetEntry = {
      id: input.stepId, sessionId: session.id, ownerSessionId: owner.id, projectId: session.projectId, folderId: snapshot.projectConfigurations.find((configuration) => configuration.projectId === session.projectId)?.folderId ?? null,
      turnId: input.turnId, modelId: session.controls.modelId, providerId: input.providerId, apiModelId: input.apiModelId, role: input.role,
      env: session.controls.env, createdAt: new Date().toISOString(), imported: false, status: "reserved", inputEstimate: input.inputEstimate, outputLimit: low,
      reservedTokens: input.inputEstimate + low, reportedTokens: null, reservedUsdMicros: rate ? price(rate, input.inputEstimate, low) : null,
      estimatedUsdMicros: null, rate, requestMs: 0, outcome: "running", diagnostic: null,
    };
    return { event: recorded(entry), maxTokens: low };
  }
  estimated(usage: Usage): Usage {
    const entry = this.host.snapshot().budgetEntries.find((entry) => entry.id === usage.stepId);
    const cost = entry?.rate && usage.quality === "provider-reported" && integer(usage.totalTokens) && integer(usage.outputTokens) && usage.outputTokens <= usage.totalTokens ?
      price(entry.rate, usage.totalTokens - usage.outputTokens, usage.outputTokens) : null;
    return { ...usage, estimatedUsd: cost === null ? null : cost / 1_000_000 };
  }
  derived(snapshot: Snapshot, primary: StoredEvent[]): EventInput[] {
    const updates = new Map<string, BudgetEntry>();
    for (const event of primary) {
      if (event.event_type === "model.completed" || event.event_type === "model.late_usage") {
        const usage = event.payload.usage, entry = snapshot.budgetEntries.find((entry) => entry.id === usage.stepId);
        if (!entry) throw new MoguriError("budget_receipt", "This model completion has no owning accounting reservation. No free/duplicate charge was invented.", 409);
        const valid = usage.quality === "provider-reported" && integer(usage.totalTokens) && integer(usage.outputTokens) && usage.outputTokens <= usage.totalTokens;
        const reportedTokens = valid ? usage.totalTokens : null, estimatedUsdMicros = valid && entry.rate ? price(entry.rate, usage.totalTokens! - usage.outputTokens!, usage.outputTokens!) : null;
        const outputLimitViolation = valid && entry.outputLimit !== null && usage.outputTokens! > entry.outputLimit;
        updates.set(entry.id, { ...entry, status: valid ? "settled" : "unknown", reportedTokens, estimatedUsdMicros, requestMs: usage.requestMs, outcome: usage.outcome, outputLimitViolation,
          diagnostic: valid ? entry.rate && estimatedUsdMicros === null ? "Reported tokens were retained, but their price exceeds safe numeric precision. USD accounting is unknown, never zero." :
            usage.totalTokens! > (entry.reservedTokens ?? 0) ? "Provider-reported usage exceeded the estimate-based reservation. Actual usage was retained; further admission rechecks the cap." : null :
            "Provider metering is missing/invalid. The complete reservation remains held, not refunded as zero." });
      }
      if (event.event_type === "turn.finished") for (const entry of snapshot.budgetEntries.filter((entry) => entry.turnId === event.turn_id && entry.status === "reserved")) {
        if (!updates.has(entry.id)) updates.set(entry.id, { ...entry, status: "unknown", outcome: event.payload.outcome, diagnostic: "The turn ended without confirmed provider usage. Its reservation remains held; no replay or refund was inferred." });
      }
    }
    return [...updates.values()].map(recorded);
  }
  legacyEvents(): EventInput[] {
    const snapshot = this.host.snapshot(), existing = new Set(snapshot.budgetEntries.map((entry) => entry.id));
    const sources = new Map<string, { usage: Usage; sessionId: string | null; projectId: string | null; timestamp: string }>();
    for (const session of snapshot.sessions) for (const usage of session.usage) sources.set(usage.stepId, { usage, sessionId: session.id, projectId: session.projectId, timestamp: session.createdAt });
    for (const event of this.host.events()) if (event.event_type === "session.deleted" || event.event_type === "project.removed") for (const usage of event.payload.usage) {
      if (!sources.has(usage.stepId)) sources.set(usage.stepId, { usage, sessionId: event.event_type === "session.deleted" ? event.payload.deletedSessionId : null, projectId: event.project_id ?? null, timestamp: event.timestamp });
    }
    return [...sources.values()].filter(({ usage }) => !existing.has(usage.stepId)).map(({ usage, sessionId, projectId, timestamp }) => {
      const session = snapshot.sessions.find((session) => session.id === sessionId);
      const linked = session && (session.kind !== "subagent" || snapshot.sessions.some((parent) => parent.id === session.parentSessionId));
      const role = isModelRole(usage.role) ? usage.role : "unknown";
      const owner = linked ? this.owner(session).id : role === "subagent" || role === "unknown" ? null : sessionId;
      const valid = usage.quality === "provider-reported" && integer(usage.totalTokens);
      return recorded({
        id: usage.stepId, sessionId, ownerSessionId: owner, projectId, folderId: null, turnId: null, modelId: usage.modelId, providerId: usage.providerId ?? null, apiModelId: usage.apiModelId ?? null,
        role, env: session?.controls.env ?? "unknown", createdAt: timestamp, imported: true, status: valid ? "settled" : "unknown",
        inputEstimate: usage.contextEstimate ?? null, outputLimit: null, reservedTokens: valid ? usage.totalTokens : integer(usage.contextWindow) ? usage.contextWindow : null,
        reportedTokens: valid ? usage.totalTokens : null, reservedUsdMicros: null, estimatedUsdMicros: null, rate: null, requestMs: usage.requestMs, outcome: usage.outcome,
        diagnostic: "Imported historical metering; start time/price or unknown bounds were not invented. Legacy USD remains unpriced.",
      });
    });
  }
  query(query: BudgetQuery): BudgetResponse {
    if (query.type === "budget.status") return { type: query.type, status: this.status(query.sessionId) };
    const entries = this.host.snapshot().budgetEntries.filter((entry) => (query.projectId === undefined || entry.projectId === query.projectId) &&
      (query.folderId === undefined || entry.folderId === query.folderId) && (query.sessionId === undefined || entry.ownerSessionId === query.sessionId || entry.sessionId === query.sessionId) &&
      (query.modelId === undefined || entry.modelId === query.modelId) && (query.providerId === undefined || entry.providerId === query.providerId) && (query.role === undefined || entry.role === query.role));
    const grouped = new Map<string, BudgetEntry[]>();
    for (const entry of entries) { const key = JSON.stringify([entry.role, entry.modelId, entry.providerId]); grouped.set(key, [...grouped.get(key) ?? [], entry]); }
    const groups = [...grouped.values()], offset = query.offset ?? 0, end = offset + (query.limit ?? 50);
    return { type: query.type, totals: budgetTotals(entries), groups: groups.slice(offset, end).map((entries) => ({ role: entries[0]!.role, modelId: entries[0]!.modelId, providerId: entries[0]!.providerId, totals: budgetTotals(entries) })), policy: this.host.snapshot().budgetPolicy, nextOffset: end < groups.length ? end : null };
  }
}
