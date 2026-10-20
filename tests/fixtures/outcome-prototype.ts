import { digest, type EventStore } from "../../apps/service/src/store.ts";
import type { StoredEvent, ToolCall } from "../../packages/protocol/src/index.ts";

type Outcome = "running" | "completed" | "failed" | "denied" | "stopped" | "partial" | "unconfirmed" | "unknown";
interface Operation {
  id: string; profileId: string; sessionId: string | null; projectId: string | null; turnId: string | null; stepId: string | null;
  family: "tool" | "mcp"; actor: "model" | "external" | "unknown"; name: string | null; serverId: string | null;
  env: "Local" | "Remote" | "Sandbox" | "unknown"; started: boolean; requestedAt: string | null; startedAt: string | null; finishedAt: string | null;
  elapsedMs: number | null; outcome: Outcome; sourceEventIds: string[]; diagnostic: "unknown-outcome" | "clock-regressed" | "inconsistent-result" | null;
}
const identifier = (value: unknown): string | null => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value) ? value : null;
const validTime = (value: string): string | null => Number.isFinite(Date.parse(value)) ? value : null;
const outcome = (value: string): Outcome => {
  const known: Outcome[] = ["completed", "failed", "denied", "stopped", "partial", "unconfirmed"];
  return known.find((item) => item === value) ?? "unknown";
};
export function operationProjection(source: StoredEvent[], profileId = "default"): Operation[] {
  const events = source.filter((event) => event.profile_id === profileId), entries = new Map<string, Operation>();
  const modelSteps = new Set<string>(), externalTurns = new Set<string>(), planTurns = new Set<string>(), envs = new Map<string, Operation["env"]>(), approvals = new Map<string, string>(), turns = new Map<string, Operation[]>();
  for (const event of events) {
    if (event.event_type === "model.started") modelSteps.add(`${event.turn_id}\0${event.step_id}`);
    if (event.event_type === "job.started" && event.payload.job.kind === "mcp.call" && event.turn_id) externalTurns.add(event.turn_id);
    if (event.event_type === "turn.control_started" && event.payload.purpose === "plan.save" && event.turn_id) planTurns.add(event.turn_id);
    if (event.event_type === "turn.started" || event.event_type === "turn.control_started") if (event.turn_id) envs.set(event.turn_id, event.payload.controls.env);
  }
  const key = (event: StoredEvent, call: ToolCall) => digest(JSON.stringify([profileId, event.session_id, event.turn_id, event.step_id, call.id]));
  const entry = (event: StoredEvent, call: ToolCall) => {
    const id = key(event, call), known = entries.get(id);
    if (known) return known;
    const mcp = call.name === "mcp_gateway" && call.arguments.action === "call";
    const result: Operation = {
      id, profileId, sessionId: event.session_id ?? null, projectId: event.project_id ?? null, turnId: event.turn_id ?? null, stepId: event.step_id ?? null,
      family: mcp ? "mcp" : "tool", actor: externalTurns.has(event.turn_id ?? "") ? "external" : modelSteps.has(`${event.turn_id}\0${event.step_id}`) ? "model" : "unknown",
      name: identifier(mcp ? call.arguments.tool : call.name), serverId: mcp ? identifier(call.arguments.serverId) : null,
      env: envs.get(event.turn_id ?? "") ?? "unknown",
      started: false, requestedAt: null, startedAt: null, finishedAt: null, elapsedMs: null, outcome: "running", sourceEventIds: [], diagnostic: null,
    };
    entries.set(id, result);
    const owned = turns.get(event.turn_id ?? "") ?? []; owned.push(result); turns.set(event.turn_id ?? "", owned);
    return result;
  };
  for (const event of events) {
    if (planTurns.has(event.turn_id ?? "")) continue;
    if (event.event_type === "tool.requested") {
      const value = entry(event, event.payload.approval.call); value.requestedAt ??= validTime(event.timestamp); value.sourceEventIds.push(event.id); approvals.set(event.payload.approval.id, value.id);
    } else if (event.event_type === "tool.decided" && !event.payload.allow) {
      const value = entries.get(approvals.get(event.payload.approvalId) ?? "");
      if (value) { value.outcome = "denied"; value.finishedAt = validTime(event.timestamp); value.sourceEventIds.push(event.id); }
    } else if (event.event_type === "tool.started") {
      const value = entry(event, event.payload.call); value.started = true; value.startedAt ??= validTime(event.timestamp); value.requestedAt ??= value.startedAt; value.sourceEventIds.push(event.id);
    } else if (event.event_type === "tool.completed") {
      const value = entry(event, event.payload.call); value.outcome = outcome(event.payload.outcome); value.finishedAt = validTime(event.timestamp); value.sourceEventIds.push(event.id);
      if (value.outcome === "unknown") value.diagnostic = "unknown-outcome";
      if (value.outcome === "completed" && event.payload.isError) { value.outcome = "unknown"; value.diagnostic = "inconsistent-result"; }
    } else if (event.event_type === "turn.finished") {
      for (const value of turns.get(event.turn_id ?? "") ?? []) if (value.outcome === "running") { value.outcome = "unconfirmed"; value.sourceEventIds.push(event.id); }
    }
  }
  for (const value of entries.values()) if (value.startedAt && value.finishedAt) {
    const elapsed = Date.parse(value.finishedAt) - Date.parse(value.startedAt);
    if (elapsed >= 0) value.elapsedMs = elapsed; else value.diagnostic = "clock-regressed";
  }
  return [...entries.values()];
}

export function profileCipherStorage(store: EventStore) {
  const exact = `profile/${store.profileId}`, prefix = `${exact}/*`;
  const missing = store.db.prepare(`SELECT count(*) AS count FROM events e
    LEFT JOIN retention_keys k ON k.scope=json_extract(e.payload,'$.scope')
    LEFT JOIN retention_forgotten f ON f.scope=json_extract(e.payload,'$.scope')
    WHERE json_extract(e.data,'$.profile_id')=? AND k.scope IS NULL AND f.scope IS NULL`).get(store.profileId)!;
  if (missing.count !== 0) throw new Error("A retained event key is missing without a deletion record. Storage totals are unavailable; state was preserved.");
  const events = store.db.prepare(`SELECT count(*) AS count,coalesce(sum(length(CAST(e.payload AS BLOB))),0) AS bytes
    FROM events e JOIN retention_keys k ON k.scope=json_extract(e.payload,'$.scope')
    WHERE json_extract(e.data,'$.profile_id')=? AND (k.scope=? OR k.scope GLOB ?)`).get(store.profileId, exact, prefix)!;
  const grants = store.db.prepare(`SELECT count(*) AS count,count(DISTINCT b.digest) AS contents,coalesce(sum(length(CAST(b.payload AS BLOB))),0) AS bytes
    FROM blob_payloads b JOIN retention_keys k ON k.scope=b.scope WHERE k.scope=? OR k.scope GLOB ?`).get(exact, prefix)!;
  const keys = store.db.prepare(`SELECT count(*) AS count,coalesce(sum(length(CAST(payload AS BLOB))),0) AS bytes
    FROM retention_keys WHERE scope=? OR scope GLOB ?`).get(exact, prefix)!;
  const number = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Storage measurement exceeds safe integer precision. No rounded size was returned.");
    return value;
  };
  const bytes = { events: number(events.bytes), blobGrants: number(grants.bytes), keys: number(keys.bytes), total: 0 };
  bytes.total = number(bytes.events + bytes.blobGrants + bytes.keys);
  return { profileId: store.profileId, measurement: "key-backed-retained-ciphertext" as const, integrity: "not-verified" as const, bytes,
    counts: { events: number(events.count), blobGrants: number(grants.count), blobContents: number(grants.contents), keys: number(keys.count) },
    physicalBytes: null, reclaimedPhysicalBytes: null };
}
