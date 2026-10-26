import { digest, type EventStore } from "./store.ts";
import { budgetWindow } from "./budgets.ts";
import { matchesRepository, repositoryCoverage } from "./repository-telemetry.ts";
import { MoguriError, type StoredEvent, type ToolCall, type Snapshot, type EventInput, type OperationEntry, type OperationOutcome,
  type OperationTotals, type ProfileStorage, type TelemetryQuery, type TelemetryResponse, type BudgetWindow } from "../../../packages/protocol/src/index.ts";

const identifier = (value: unknown): string | null => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value) ? value : null;
const validTime = (value: string): string | null => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? value : null;
const outcome = (value: string): OperationOutcome => {
  const known: OperationOutcome[] = ["completed", "failed", "denied", "stopped", "partial", "unconfirmed"];
  return known.find((item) => item === value) ?? "unknown";
};
type Provenance = Pick<OperationEntry, "actor" | "env" | "modelId" | "providerId" | "role" | "folderId" | "ownerSessionId" | "ownerTurnId" | "repository" | "repositoryDiagnostic">;
const scopedStep = (event: StoredEvent) => JSON.stringify([event.session_id, event.turn_id, event.step_id]);
const operationEvent = (event: StoredEvent) => ["tool.requested", "tool.decided", "tool.started", "tool.completed", "turn.finished"].includes(event.event_type);
export function externalOperationTurns(events: StoredEvent[], snapshot?: Snapshot): Set<string> {
  const turns = new Set<string>();
  for (const event of events) if (event.event_type === "job.started" && ["mcp.call", "tool.call"].includes(event.payload.job.kind) && event.turn_id) turns.add(event.turn_id);
  for (const job of snapshot?.jobs ?? []) if (job.kind === "mcp.call" && job.parentTurnId) turns.add(job.parentTurnId);
  return turns;
}
function provenance(events: StoredEvent[], snapshot?: Snapshot) {
  const modelSteps = new Map<string, Extract<StoredEvent, { event_type: "model.started" }>>(), externalTurns = externalOperationTurns(events, snapshot), planTurns = new Set<string>(), envs = new Map<string, OperationEntry["env"]>();
  const externalCaptures = new Map(events.flatMap((event) => event.event_type === "turn.started" && event.turn_id && event.payload.repositoryCapture ? [[event.turn_id, event.payload.repositoryCapture] as const] : []));
  for (const event of events) {
    if (event.event_type === "model.started") modelSteps.set(scopedStep(event), event);
    if (event.event_type === "turn.control_started" && event.payload.purpose === "plan.save" && event.turn_id) planTurns.add(event.turn_id);
    if (event.event_type === "turn.started" || event.event_type === "turn.control_started") if (event.turn_id) envs.set(event.turn_id, event.payload.controls.env);
  }
  for (const save of snapshot?.planSaves ?? []) planTurns.add(save.id);
  return {
    planTurns,
    describe: (event: StoredEvent): Provenance => {
      const start = modelSteps.get(scopedStep(event));
      const budget = snapshot?.budgetEntries.find((entry) => entry.id === event.step_id && entry.sessionId === event.session_id && entry.turnId === event.turn_id);
      const captured = budget ?? externalCaptures.get(event.turn_id ?? "");
      return {
        actor: externalTurns.has(event.turn_id ?? "") ? "external" : start || budget && !budget.imported ? "model" : "unknown",
        env: envs.get(event.turn_id ?? "") ?? (budget && !budget.imported ? budget.env : "unknown"),
        modelId: start?.payload.modelId ?? budget?.modelId ?? null, providerId: start?.payload.providerId ?? budget?.providerId ?? null,
        role: start?.payload.role ?? budget?.role ?? null, folderId: snapshot?.projectConfigurations.find((configuration) => configuration.projectId === event.project_id)?.folderId ?? null,
        ownerSessionId: budget?.ownerSessionId ?? event.session_id ?? null, ownerTurnId: budget?.ownerTurnId ?? event.turn_id ?? null,
        repository: captured?.repository ?? null, repositoryDiagnostic: captured?.repositoryDiagnostic ?? null,
      };
    },
  };
}
function updateOperations(events: StoredEvent[], profileId: string, existing: OperationEntry[], context: ReturnType<typeof provenance>, imported: boolean): OperationEntry[] {
  const entries = new Map(existing.map((entry) => [entry.id, entry])), changed = new Map<string, OperationEntry>();
  const approvals = new Map(existing.flatMap((entry) => entry.approvalId ? [[entry.approvalId, entry.id] as const] : [])), turns = new Map<string, Set<string>>();
  for (const entry of existing) {
    const owned = turns.get(entry.turnId ?? "") ?? new Set<string>(); owned.add(entry.id); turns.set(entry.turnId ?? "", owned);
  }
  const touch = (value: OperationEntry, event: StoredEvent) => {
    const result = changed.get(value.id) ?? { ...value, revision: value.revision + 1 };
    result.sourceEventId = event.id; result.sourceSeq = event.seq; changed.set(result.id, result); entries.set(result.id, result); return result;
  };
  const entry = (event: StoredEvent, call: ToolCall) => {
    const callHash = digest(call.id), id = digest(JSON.stringify([profileId, event.session_id, event.turn_id, event.step_id, call.id])), known = entries.get(id);
    if (known) return touch(known, event);
    if (!event.step_id) {
      const candidates = [...(turns.get(event.turn_id ?? "") ?? [])].map((id) => entries.get(id)!).filter((entry) => entry.sessionId === (event.session_id ?? null) && entry.callHash === callHash);
      if (candidates.length === 1) return touch(candidates[0]!, event);
    }
    const mcp = call.name === "mcp_gateway" && call.arguments.action === "call";
    const result: OperationEntry = {
      id, profileId, revision: 1, callHash, sessionId: event.session_id ?? null, projectId: event.project_id ?? null, turnId: event.turn_id ?? null, stepId: event.step_id ?? null,
      ...context.describe(event), family: mcp ? "mcp" : "tool",
      name: identifier(mcp ? call.arguments.tool : call.name), serverId: mcp ? identifier(call.arguments.serverId) : null,
      started: false, requestedAt: null, startedAt: null, finishedAt: null, elapsedMs: null, outcome: "pending", imported, approvalId: null,
      firstEventId: event.id, sourceEventId: event.id, sourceSeq: event.seq, timeBasis: "unknown", diagnostic: event.step_id ? null : "unlinked-source",
    };
    if (result.name === null || mcp && result.serverId === null) result.diagnostic = "invalid-identifier";
    entries.set(id, result); changed.set(id, result);
    const owned = turns.get(event.turn_id ?? "") ?? new Set<string>(); owned.add(id); turns.set(event.turn_id ?? "", owned);
    return result;
  };
  for (const event of events) {
    if (event.profile_id !== profileId || context.planTurns.has(event.turn_id ?? "")) continue;
    if (event.event_type === "tool.requested") {
      const value = entry(event, event.payload.approval.call); value.requestedAt ??= validTime(event.timestamp); value.approvalId = event.payload.approval.id; approvals.set(value.approvalId, value.id);
    } else if (event.event_type === "tool.decided" && !event.payload.allow) {
      const value = entries.get(approvals.get(event.payload.approvalId) ?? "");
      if (value) {
        const updated = touch(value, event); updated.outcome = value.started ? "unknown" : "denied"; updated.finishedAt = validTime(event.timestamp);
        if (value.started) updated.diagnostic = "inconsistent-result";
      }
    } else if (event.event_type === "tool.started") {
      const value = entry(event, event.payload.call);
      if (value.started) { value.outcome = "unknown"; value.diagnostic = "duplicate-start"; }
      else { value.started = true; value.startedAt = validTime(event.timestamp); value.outcome = "running"; }
    } else if (event.event_type === "tool.completed") {
      const value = entry(event, event.payload.call), deniedBeforeStart = value.outcome === "denied" && !value.started;
      value.outcome = value.diagnostic === "duplicate-start" ? "unknown" : deniedBeforeStart && event.payload.outcome === "stopped" ? "denied" : outcome(event.payload.outcome); value.finishedAt = validTime(event.timestamp);
      if (value.outcome === "unknown" && value.diagnostic !== "duplicate-start") value.diagnostic = "unknown-outcome";
      if (value.outcome === "completed" && event.payload.isError) { value.outcome = "unknown"; value.diagnostic = "inconsistent-result"; }
    } else if (event.event_type === "turn.finished") {
      for (const id of turns.get(event.turn_id ?? "") ?? []) {
        const value = entries.get(id)!;
        if (value.outcome === "running" || value.outcome === "pending") { const updated = touch(value, event); updated.outcome = "unconfirmed"; updated.finishedAt = null; updated.elapsedMs = null; }
      }
    }
  }
  for (const value of changed.values()) {
    value.timeBasis = value.requestedAt ? "request" : value.startedAt ? "tool-start" : value.finishedAt ? "completion-only" : "unknown";
    value.elapsedMs = null;
    if (value.startedAt && value.finishedAt && value.diagnostic !== "duplicate-start") {
      const elapsed = Date.parse(value.finishedAt) - Date.parse(value.startedAt);
      if (Number.isSafeInteger(elapsed) && elapsed >= 0) value.elapsedMs = elapsed; else value.diagnostic = "clock-regressed";
    }
  }
  return [...changed.values()];
}
export function operationProjection(source: StoredEvent[], profileId = "default"): OperationEntry[] {
  const events = source.filter((event) => event.profile_id === profileId);
  return updateOperations(events, profileId, [], provenance(events), true);
}

export function profileCipherStorage(store: EventStore, measuredAt = new Date().toISOString()): ProfileStorage {
  const ownTransaction = !store.db.isTransaction;
  if (ownTransaction) store.db.exec("BEGIN");
  try {
  const exact = `profile/${store.profileId}`, prefix = `${exact}/*`;
  const foreignScope = store.db.prepare(`SELECT count(*) AS count FROM events WHERE json_extract(data,'$.profile_id')=?
    AND (json_type(payload,'$.scope') IS NOT 'text' OR NOT(json_extract(payload,'$.scope')=? OR json_extract(payload,'$.scope') GLOB ?))`).get(store.profileId, exact, prefix)!;
  if (foreignScope.count !== 0) throw new MoguriError("storage_scope", "A retained event scope is outside its owning profile. Storage totals are unavailable; state was preserved.", 409);
  const missing = store.db.prepare(`SELECT count(*) AS count FROM events e
    LEFT JOIN retention_keys k ON k.scope=json_extract(e.payload,'$.scope')
    LEFT JOIN retention_forgotten f ON f.scope=json_extract(e.payload,'$.scope')
    WHERE json_extract(e.data,'$.profile_id')=? AND k.scope IS NULL AND f.scope IS NULL`).get(store.profileId)!;
  if (missing.count !== 0) throw new MoguriError("storage_key", "A retained event key is missing without a deletion record. Storage totals are unavailable; state was preserved.", 409);
  const missingGrant = store.db.prepare(`SELECT count(*) AS count FROM blob_payloads b LEFT JOIN retention_keys k ON k.scope=b.scope
    LEFT JOIN retention_forgotten f ON f.scope=b.scope WHERE (b.scope=? OR b.scope GLOB ?) AND k.scope IS NULL AND f.scope IS NULL`).get(exact, prefix)!;
  if (missingGrant.count !== 0) throw new MoguriError("storage_key", "A retained blob grant key is missing without a deletion record. Storage totals are unavailable; state was preserved.", 409);
  const events = store.db.prepare(`SELECT count(*) AS count,coalesce(sum(length(CAST(e.payload AS BLOB))),0) AS bytes
    FROM events e JOIN retention_keys k ON k.scope=json_extract(e.payload,'$.scope')
    WHERE json_extract(e.data,'$.profile_id')=? AND (k.scope=? OR k.scope GLOB ?)`).get(store.profileId, exact, prefix)!;
  const grants = store.db.prepare(`SELECT count(*) AS count,count(DISTINCT b.digest) AS contents,coalesce(sum(length(CAST(b.payload AS BLOB))),0) AS bytes
    FROM blob_payloads b JOIN retention_keys k ON k.scope=b.scope WHERE k.scope=? OR k.scope GLOB ?`).get(exact, prefix)!;
  const keys = store.db.prepare(`SELECT count(*) AS count,coalesce(sum(length(CAST(payload AS BLOB))),0) AS bytes
    FROM retention_keys WHERE scope=? OR scope GLOB ?`).get(exact, prefix)!;
  const number = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new MoguriError("storage_overflow", "Storage measurement exceeds safe integer precision. No rounded size was returned.", 409);
    return value;
  };
  const bytes = { events: number(events.bytes), blobGrants: number(grants.bytes), keys: number(keys.bytes), total: 0 };
  bytes.total = number(bytes.events + bytes.blobGrants + bytes.keys);
  const result: ProfileStorage = { profileId: store.profileId, measuredAt, measurement: "key-backed-retained-ciphertext", integrity: "not-verified", bytes,
    counts: { events: number(events.count), blobGrants: number(grants.count), blobContents: number(grants.contents), keys: number(keys.count) },
    physicalBytes: null, reclaimedPhysicalBytes: null };
  if (ownTransaction) store.db.exec("COMMIT");
  return result;
  } catch (error) { if (ownTransaction && store.db.isTransaction) store.db.exec("ROLLBACK"); throw error; }
}

export function operationTotals(entries: OperationEntry[]): OperationTotals {
  const totals: OperationTotals = { attempts: entries.length, started: 0, pending: 0, running: 0, completed: 0, failed: 0, denied: 0, stopped: 0, partial: 0, unconfirmed: 0, unknown: 0,
    knownResults: 0, failureRate: null, retries: null, observedWallMs: 0, elapsedSamples: 0, unmeasuredAttempts: 0 };
  for (const entry of entries) {
    totals[entry.outcome]++; if (entry.started) totals.started++;
    if (entry.elapsedMs !== null) { totals.observedWallMs += entry.elapsedMs; totals.elapsedSamples++; }
  }
  if (!Number.isSafeInteger(totals.observedWallMs)) throw new MoguriError("telemetry_overflow", "Observed lifecycle timing exceeds safe integer precision. No rounded total was returned.", 409);
  totals.knownResults = totals.completed + totals.failed; totals.failureRate = totals.knownResults ? totals.failed / totals.knownResults : null;
  totals.unmeasuredAttempts = totals.attempts - totals.elapsedSamples; return totals;
}
const recorded = (entry: OperationEntry): EventInput => ({ event_type: "operation.recorded", profile_id: entry.profileId, payload: { entry } });
const requestTime = (entry: OperationEntry): number | null => {
  const value = entry.timeBasis === "request" ? entry.requestedAt : entry.timeBasis === "tool-start" ? entry.startedAt : null;
  return value && validTime(value) ? Date.parse(value) : null;
};
export class OperationTelemetry {
  constructor(private readonly host: { snapshot(): Snapshot; events(): StoredEvent[] }, private readonly store: EventStore) {}
  legacyEvents(): EventInput[] {
    const snapshot = this.host.snapshot();
    if (snapshot.operationCoverage) return [];
    const existing = new Set(snapshot.operationEntries.map((entry) => entry.id));
    return [{ event_type: "operation.coverage_started", profile_id: snapshot.profileId, payload: { version: 1, priorHistory: "retained-events-only" } },
      ...operationProjection(this.host.events(), snapshot.profileId).filter((entry) => !existing.has(entry.id)).map(recorded)];
  }
  derived(snapshot: Snapshot, primary: StoredEvent[]): EventInput[] {
    if (!primary.some(operationEvent)) return [];
    return updateOperations(primary, snapshot.profileId, snapshot.operationEntries, provenance(primary, snapshot), false).map(recorded);
  }
  query(query: TelemetryQuery): TelemetryResponse {
    if (query.type === "telemetry.storage") return { type: query.type, storage: profileCipherStorage(this.store) };
    const snapshot = this.host.snapshot();
    const scoped = snapshot.operationEntries.filter((entry) => (query.projectId === undefined || entry.projectId === query.projectId) &&
      (query.folderId === undefined || entry.folderId === query.folderId) && (query.sessionId === undefined || entry.sessionId === query.sessionId || entry.ownerSessionId === query.sessionId) &&
      (query.turnId === undefined || entry.turnId === query.turnId || entry.ownerTurnId === query.turnId) && (query.env === undefined || entry.env === query.env) &&
      (query.providerId === undefined || entry.providerId === query.providerId) && (query.modelId === undefined || entry.modelId === query.modelId) && (query.role === undefined || entry.role === query.role) &&
      (query.family === undefined || entry.family === query.family) && (query.actor === undefined || entry.actor === query.actor) && (query.name === undefined || entry.name === query.name) &&
      (query.serverId === undefined || entry.serverId === query.serverId) && (query.outcome === undefined || entry.outcome === query.outcome));
    const bounds = budgetWindow(query.range), uncertainTimeCalls = scoped.filter((entry) => requestTime(entry) === null).length;
    const dated = scoped.filter((entry) => { const time = requestTime(entry); return bounds.from === null || time !== null && time >= bounds.from && time < bounds.to!; });
    const repositoryAccounting = repositoryCoverage(dated), entries = dated.filter((entry) => matchesRepository(entry.repository, query));
    const date = (value: number) => new Date(value).toISOString().slice(0, 10);
    const window: BudgetWindow = { from: bounds.from === null ? null : date(bounds.from), to: bounds.to === null ? null : date(bounds.to - 1), timezone: "UTC", uncertainTimeCalls, excludedUncertainTimeCalls: bounds.from === null ? 0 : uncertainTimeCalls };
    const grouped = new Map<string, OperationEntry[]>();
    for (const entry of entries) {
      const key = JSON.stringify([entry.family, entry.serverId, entry.name, entry.actor]), values = grouped.get(key) ?? []; values.push(entry); grouped.set(key, values);
    }
    if (grouped.size > 2000) throw new MoguriError("telemetry_groups", "More than 2,000 tool/server/actor groups match. Choose narrower filters; no groups were silently omitted.", 409);
    const offset = query.offset ?? 0, end = offset + (query.limit ?? 20);
    if (!Number.isSafeInteger(end)) throw new MoguriError("telemetry_page", "The requested history page exceeds safe integer precision.", 409);
    entries.sort((left, right) => right.sourceSeq - left.sourceSeq || left.id.localeCompare(right.id));
    return { type: query.type, totals: operationTotals(entries), coverage: structuredClone(snapshot.operationCoverage), window, repositoryCoverage: repositoryAccounting,
      groups: [...grouped.values()].map((entries) => ({ family: entries[0]!.family, name: entries[0]!.name, serverId: entries[0]!.serverId, actor: entries[0]!.actor, totals: operationTotals(entries) })),
      entries: structuredClone(entries.slice(offset, end)), nextOffset: end < entries.length ? end : null };
  }
}
