import { estimateTextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { MoguriError, type BudgetEntry, type EventInput, type GlobalBudgetCapacity, type SessionTelemetry, type Snapshot, type StoredEvent, type UsageEstimate } from "../../../packages/protocol/src/index.ts";
import { budgetModelGroups, budgetTotals, BudgetRuntime } from "./budgets.ts";
import { retainedTurnInfo } from "./chat-activity.ts";
import { estimateRateMicros } from "./provider-pricing.ts";
import { assistantMessage } from "./worker-protocol.ts";

export function recoverCachedUsage(snapshot: Snapshot, history: StoredEvent[], read: (digest: string) => string): EventInput[] {
  const retained = new Set(snapshot.sessions.map((session) => session.id));
  const sources = new Map(history.filter((event) => event.profile_id === snapshot.profileId && event.event_type === "model.completed" && event.step_id)
    .map((event) => [event.step_id!, event]));
  const updates: EventInput[] = [];
  for (const entry of snapshot.budgetEntries) {
    if (!entry.sessionId || !retained.has(entry.sessionId) || entry.status !== "settled" || entry.reportedTokens === null ||
      entry.inputTokens === null || entry.inputTokens === undefined || entry.outputTokens === null || entry.outputTokens === undefined ||
      entry.cacheReadTokens !== null && entry.cacheReadTokens !== undefined && entry.cacheWriteTokens !== null && entry.cacheWriteTokens !== undefined) continue;
    const source = sources.get(entry.id);
    if (!source || source.event_type !== "model.completed" || source.session_id !== entry.sessionId ||
      source.payload.usage.quality !== "provider-reported" || source.payload.usage.totalTokens !== entry.reportedTokens) continue;
    let text: string;
    try { text = read(source.payload.contextDigest); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("Missing or deleted content snapshot ")) throw error;
      console.error("Retained cache source is unavailable; original cache counts remain unknown:", source.id); continue;
    }
    const message = assistantMessage(JSON.parse(text));
    if (message.model !== entry.apiModelId || message.usage.totalTokens !== entry.reportedTokens || message.usage.output !== entry.outputTokens ||
      message.usage.input + message.usage.cacheRead + message.usage.cacheWrite !== entry.inputTokens ||
      entry.cacheReadTokens !== null && entry.cacheReadTokens !== undefined && entry.cacheReadTokens !== message.usage.cacheRead ||
      entry.cacheWriteTokens !== null && entry.cacheWriteTokens !== undefined && entry.cacheWriteTokens !== message.usage.cacheWrite) continue;
    const cacheReadTokens = entry.cacheReadTokens ?? (message.usage.cacheRead > 0 || source.payload.usage.stream?.cacheReadReported ? message.usage.cacheRead : null);
    const cacheWriteTokens = entry.cacheWriteTokens ?? (message.usage.cacheWrite > 0 || source.payload.usage.stream?.cacheWriteReported ? message.usage.cacheWrite : null);
    if (cacheReadTokens === (entry.cacheReadTokens ?? null) && cacheWriteTokens === (entry.cacheWriteTokens ?? null)) continue;
    const usage = { ...source.payload.usage, cacheReadTokens, cacheWriteTokens };
    const estimatedUsdMicros = entry.rate ? estimateRateMicros(entry.rate, entry.inputTokens, entry.outputTokens, usage) : entry.estimatedUsdMicros;
    const diagnostic = `Cache categories recovered from original retained model result ${source.id}.`;
    updates.push({ event_type: "budget.recorded", profile_id: snapshot.profileId, payload: { entry: { ...entry, cacheReadTokens, cacheWriteTokens, estimatedUsdMicros,
      telemetryDiagnostic: entry.telemetryDiagnostic ? `${entry.telemetryDiagnostic} ${diagnostic}` : diagnostic } } });
  }
  return updates;
}

function usageEstimate(entries: BudgetEntry[], outputs: Map<string, number>): UsageEstimate {
  const inputs = entries.map((entry) => entry.inputTokens ?? entry.inputEstimate);
  const generated = entries.map((entry) => entry.outputTokens ?? outputs.get(entry.id) ?? null);
  const usd = entries.map((entry, index) => entry.estimatedUsdMicros ?? (entry.rate && inputs[index] !== null && generated[index] !== null ?
    estimateRateMicros(entry.rate, inputs[index]!, generated[index]!) : null));
  const total = (values: Array<number | null>) => {
    const known = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    if (!Number.isSafeInteger(known) || known < 0) throw new MoguriError("telemetry_overflow", "Retained usage estimates exceed safe precision. No rounded or free usage was substituted.", 409);
    return { known, complete: values.every((value) => value !== null) ? known : null };
  };
  const input = total(inputs), output = total(generated), cost = total(usd);
  return { inputTokens: input.complete, outputTokens: output.complete, estimatedUsd: cost.complete === null ? null : cost.complete / 1_000_000,
    knownInputTokens: input.known, knownOutputTokens: output.known, knownEstimatedUsd: cost.known / 1_000_000,
    estimatedCalls: entries.filter((entry) => entry.inputTokens === null || entry.inputTokens === undefined || entry.outputTokens === null || entry.outputTokens === undefined).length };
}

export function retainedSessionTelemetry(snapshot: Snapshot, history: StoredEvent[], global?: () => GlobalBudgetCapacity): Record<string, SessionTelemetry> {
  const budgets = new BudgetRuntime({ snapshot: () => snapshot, events: () => history, global });
  const key = (sessionId: string, turnId: string) => JSON.stringify([sessionId, turnId]);
  const scoped = <T extends Pick<BudgetEntry, "sessionId" | "ownerSessionId" | "turnId" | "ownerTurnId">>(records: T[]) => {
    const result = new Map<string, T[]>();
    for (const record of records) for (const sessionId of new Set([record.sessionId, record.ownerSessionId])) {
      if (!sessionId) continue;
      for (const turnId of new Set([record.turnId, record.ownerTurnId])) {
        if (!turnId) continue;
        const id = key(sessionId, turnId), values = result.get(id) ?? []; values.push(record); result.set(id, values);
      }
    }
    return result;
  };
  const entries = scoped(snapshot.budgetEntries), plans = scoped(snapshot.budgetPlans.filter((plan) => plan.status === "held"));
  const events = new Map<string, StoredEvent[]>(), steps = new Map<string, StoredEvent>();
  for (const event of history) if (event.profile_id === snapshot.profileId && event.session_id) {
    if (event.step_id) steps.set(event.step_id, event);
    if (event.turn_id) { const id = key(event.session_id, event.turn_id), values = events.get(id) ?? []; values.push(event); events.set(id, values); }
  }
  const outputs = new Map(snapshot.sessions.flatMap((session) => session.messages.filter((message) => message.role === "assistant")
    .map((message): [string, number] => [message.id, estimateTextTokens(message.text + (message.reasoning ?? "") + (message.toolCalls?.length ? JSON.stringify(message.toolCalls) : ""))])));
  return Object.fromEntries(snapshot.sessions.map((session) => {
    let budget: SessionTelemetry["budget"] = null, budgetDiagnostic: string | null = null;
    try { budget = budgets.status(session.id); }
    catch (error) {
      if (!(error instanceof MoguriError) || !["budget_owner", "budget_session"].includes(error.code)) throw error;
      budgetDiagnostic = error.message;
    }
    const messagesByTurn = new Map<string, typeof session.messages>(), usageByTurn = new Map<string, typeof session.usage>();
    const visibleTurns = new Map(session.messages.filter((message) => message.role === "assistant").map((message) => [message.id, message.turnId]));
    for (const message of session.messages) if (message.turnId) {
      const values = messagesByTurn.get(message.turnId) ?? []; values.push(message); messagesByTurn.set(message.turnId, values);
    }
    for (const usage of session.usage) {
      const turnId = visibleTurns.get(usage.stepId);
      if (turnId) { const values = usageByTurn.get(turnId) ?? []; values.push(usage); usageByTurn.set(turnId, values); }
    }
    const turns = [...messagesByTurn].map(([turnId, messages]) => {
      const id = key(session.id, turnId), calls = entries.get(id) ?? [], held = plans.get(id) ?? [];
      return { ...retainedTurnInfo({ ...session, messages, usage: usageByTurn.get(turnId) ?? [] }, turnId, events.get(id) ?? [], snapshot.profileId, { totals: budgetTotals(calls, held), groups: budgetModelGroups(calls, held) }),
        estimate: usageEstimate(calls, outputs) };
    });
    const visible = new Set(session.messages.filter((message) => message.role === "assistant").map((message) => message.id));
    const last = session.usage.findLast((usage) => visible.has(usage.stepId) && usage.contextEstimate !== undefined);
    const event = last && steps.get(last.stepId);
    const estimate = budget ? usageEstimate(snapshot.budgetEntries.filter((entry) => entry.ownerSessionId === budget.ownerSessionId ||
      entry.ownerSessionId === null && ["subagent", "unknown"].includes(entry.role)), outputs) : null;
    const outputEstimate = last ? outputs.get(last.stepId) ?? null : null;
    return [session.id, { sessionId: session.id, sequence: snapshot.seq, budget, budgetDiagnostic, estimate, turns,
      context: last?.contextEstimate === undefined ? null : { stepId: last.stepId, modelId: last.modelId, estimatedTokens: last.contextEstimate + (outputEstimate ?? 0),
        window: last.contextWindow ?? null, outputEstimate, updatedAt: event?.timestamp ?? session.createdAt } }];
  }));
}

export class RetainedTelemetry {
  private cached?: { key: string; value: Record<string, SessionTelemetry> };
  snapshot(snapshot: Snapshot, history: StoredEvent[], global?: GlobalBudgetCapacity): Record<string, SessionTelemetry> {
    const key = JSON.stringify([snapshot.profileId, snapshot.seq, snapshot.settings.revision, snapshot.policy.revision, snapshot.budgetPolicy.revision,
      snapshot.provider.models.map(({ id, name, apiModelId }) => [id, name, apiModelId]), global, new Date().toISOString().slice(0, 10)]);
    if (this.cached?.key !== key) this.cached = { key, value: retainedSessionTelemetry(snapshot, history, global ? () => global : undefined) };
    return this.cached.value;
  }
}
