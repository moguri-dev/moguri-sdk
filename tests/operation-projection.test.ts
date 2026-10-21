import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EventStore, digest } from "../apps/service/src/store.ts";
import { OperationTelemetry, operationProjection, operationTotals } from "../apps/service/src/operation-telemetry.ts";
import { PROTOCOL_VERSION, parse, projectEvents, TelemetryQuerySchema, type EventInput, type OperationEntry, type Snapshot, type StoredEvent } from "../packages/protocol/src/index.ts";

const meta = { profile_id: "default", session_id: "generated-session", project_id: "generated-project", turn_id: "generated-turn", step_id: "generated-step" };
const call = { id: "generated-call", name: "read_file", arguments: { path: "GENERATED_PRIVATE_SENTINEL.txt" } };
const scope = (events: StoredEvent[]): Snapshot => ({ protocolVersion: PROTOCOL_VERSION, seq: events.at(-1)?.seq ?? 0, profileId: "default", ...projectEvents(events),
  provider: { status: "disconnected", models: [], login: null, diagnostic: null }, capabilities: [] });
const inputs: EventInput[] = [
  { ...meta, event_type: "model.started", payload: { modelId: "generated-model", providerId: "generated-provider", role: "solver" } },
  { ...meta, event_type: "tool.started", payload: { call } },
  { ...meta, event_type: "tool.completed", payload: { call, text: "GENERATED_PRIVATE_SENTINEL", isError: false, outcome: "completed" } },
];
test("operation dates, scope filters, pagination and known-result denominators preserve incomplete and unknown history", () => {
  const store = new EventStore(":memory:");
  try {
    const events = store.commit(inputs), base = operationProjection(events)[0]!;
    const make = (index: number, changes: Partial<OperationEntry>): OperationEntry => ({ ...base, id: digest(`generated-entry-${index}`), sourceSeq: index + 1,
      env: "Local", projectId: "generated-project", folderId: "generated-folder", startedAt: "2024-01-02T00:00:00.000Z", finishedAt: "2024-01-02T00:00:01.000Z", elapsedMs: 1000, timeBasis: "tool-start", ...changes });
    const entries = [make(0, {}), make(1, { outcome: "failed" }), make(2, { outcome: "partial" }), make(3, { outcome: "unconfirmed", startedAt: null, finishedAt: null, elapsedMs: null, timeBasis: "unknown" }),
      make(4, { family: "mcp", name: "generated_tool", serverId: "generated-server", actor: "external", modelId: null, providerId: null, role: null })];
    const snapshot = { ...scope(events), operationEntries: entries }, runtime = new OperationTelemetry({ snapshot: () => snapshot, events: () => events }, store);
    const result = runtime.query({ type: "telemetry.operations", range: { kind: "custom", from: "2024-01-01", to: "2024-01-03" }, limit: 1, offset: 1 });
    assert.equal(result.type, "telemetry.operations"); if (result.type !== "telemetry.operations") return;
    assert.equal(result.totals.attempts, 4); assert.equal(result.window.excludedUncertainTimeCalls, 1);
    assert.equal(result.totals.knownResults, 3); assert.equal(result.totals.failureRate, 1 / 3);
    assert.equal(result.entries.length, 1); assert.equal(result.nextOffset, 2);
    const all = runtime.query({ type: "telemetry.operations" }); assert.equal(all.type, "telemetry.operations");
    if (all.type === "telemetry.operations") { assert.equal(all.totals.attempts, 5); assert.equal(all.totals.unconfirmed, 1); }
    for (const filters of [{ folderId: "not-this-folder" }, { sessionId: "another-session" }, { modelId: "another-model" }, { role: "critic" as const }, { env: "Remote" as const }]) {
      const empty = runtime.query({ type: "telemetry.operations", ...filters });
      assert.equal(empty.type, "telemetry.operations"); if (empty.type === "telemetry.operations") { assert.equal(empty.totals.attempts, 0); assert.equal(empty.totals.failureRate, null); }
    }
    const external = runtime.query({ type: "telemetry.operations", actor: "external", family: "mcp", name: "generated_tool", serverId: "generated-server" });
    assert.equal(external.type, "telemetry.operations"); if (external.type === "telemetry.operations") assert.equal(external.totals.attempts, 1);
    assert.throws(() => runtime.query({ type: "telemetry.operations", range: { kind: "custom", from: "2024-02-30", to: "2024-03-02" } }), /real UTC calendar date/);
    assert.throws(() => runtime.query({ type: "telemetry.operations", range: { kind: "custom", from: "2024-03-02", to: "2024-03-01" } }), /ends before/);
    assert.throws(() => parse(TelemetryQuerySchema, { type: "telemetry.storage", projectId: "generated-project" }), /protocol schema/);
  } finally { store.close(); }
});

test("retained-only backfill is idempotent and late exact outcomes update one independent entry rather than replaying effects", () => {
  const store = new EventStore(":memory:");
  try {
    store.commit(inputs.slice(0, 2));
    const runtime = new OperationTelemetry({ snapshot: () => scope(store.events()), events: () => store.events() }, store);
    store.commit(runtime.legacyEvents());
    assert.equal(runtime.legacyEvents().length, 0);
    let snapshot = scope(store.events()); assert.equal(snapshot.operationEntries.length, 1); assert.equal(snapshot.operationEntries[0]?.imported, true);
    store.commit([{ ...meta, event_type: "turn.finished", payload: { outcome: "partial", diagnostic: "GENERATED_PRIVATE_SENTINEL" } }], undefined, undefined,
      (primary) => runtime.derived(scope([...store.events(), ...primary]), primary));
    snapshot = scope(store.events()); assert.equal(snapshot.operationEntries[0]?.outcome, "unconfirmed"); assert.equal(snapshot.operationEntries[0]?.elapsedMs, null);
    const prior = snapshot.operationEntries[0]!;
    store.commit(inputs.slice(2), undefined, undefined, (primary) => runtime.derived(scope([...store.events(), ...primary]), primary));
    snapshot = scope(store.events()); assert.equal(snapshot.operationEntries.length, 1); assert.equal(snapshot.operationEntries[0]?.outcome, "completed");
    assert.equal(snapshot.operationEntries[0]?.id, prior.id); assert.ok(snapshot.operationEntries[0]!.revision > prior.revision);
    assert.equal(JSON.stringify(snapshot.operationEntries).includes("GENERATED_PRIVATE_SENTINEL"), false);
    assert.equal(store.events().filter((event) => event.event_type === "tool.started").length, 1);
    assert.equal(operationTotals(snapshot.operationEntries).knownResults, 1);
    assert.throws(() => projectEvents([...store.events(), ...store.commit([{ event_type: "operation.recorded", profile_id: "default", payload: { entry: { ...prior, profileId: "generated-foreign" } } }])]), /outside its owning profile/);
  } finally { store.close(); }
});

test("schema-21 marker failure preserves exact schema-20 ciphertext and can be retried without deleting state", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-operation-migration-")), path = join(root, "state.sqlite"), key = randomBytes(32);
  let store: EventStore | undefined = new EventStore(path, key, "generated-retention-key");
  try {
    store.commit(inputs);
    const before = store.db.prepare("SELECT seq,id,payload FROM events ORDER BY seq").all();
    store.db.exec(`BEGIN IMMEDIATE; DROP TABLE memory_scopes; DELETE FROM retention_metadata WHERE id IN ('remote_memory_schema','operation_metrics_schema','repository_attribution_schema','terminal_ownership_schema','remote_mcp_schema','remote_terminal_schema','remote_repository_schema','candidate_workflow_schema','candidate_execution_schema','budget_planning_schema','candidate_generation_schema','role_sequence_schema','candidate_role_schema','model_evidence_schema','owned_role_contract_schema'); PRAGMA user_version=20;
      CREATE TRIGGER generated_marker_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='operation_metrics_schema'
      BEGIN SELECT RAISE(ABORT,'Generated operation marker failure'); END; COMMIT;`);
    store.close(); store = undefined;
    assert.throws(() => new EventStore(path, key, "generated-retention-key"), /Generated operation marker failure/);
    const raw = new DatabaseSync(path);
    try {
      assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, 20);
      assert.deepEqual(raw.prepare("SELECT seq,id,payload FROM events ORDER BY seq").all(), before);
      raw.exec("DROP TRIGGER generated_marker_failure");
    } finally { raw.close(); }
    store = new EventStore(path, key, "generated-retention-key");
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(store.db.prepare("SELECT seq,id,payload FROM events ORDER BY seq").all(), before);
  } finally { store?.close(); await rm(root, { recursive: true, force: true }); }
});

test("an actual sanitized-ledger append failure rolls back the source attempt and cannot retain a successful metric", () => {
  const store = new EventStore(":memory:");
  try {
    const runtime = new OperationTelemetry({ snapshot: () => scope(store.events()), events: () => store.events() }, store);
    const before = store.events();
    store.db.exec(`CREATE TRIGGER generated_outcome_failure BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.event_type')='operation.recorded'
      BEGIN SELECT RAISE(ABORT,'Generated sanitized ledger failure'); END`);
    assert.throws(() => store.commit(inputs, undefined, undefined, (primary) => runtime.derived(scope(primary), primary)), /Generated sanitized ledger failure/);
    assert.deepEqual(store.events(), before); assert.equal(scope(store.events()).operationEntries.length, 0);
    store.db.exec("DROP TRIGGER generated_outcome_failure");
    store.commit(inputs, undefined, undefined, (primary) => runtime.derived(scope(primary), primary));
    assert.equal(scope(store.events()).operationEntries.length, 1); assert.equal(scope(store.events()).operationEntries[0]?.outcome, "completed");
  } finally { store.close(); }
});

test("pre-upgrade forgotten tool history stays unavailable rather than being reconstructed or called complete", () => {
  const store = new EventStore(":memory:");
  try {
    store.commit(inputs);
    store.commit([{ event_type: "session.deleted", profile_id: "default", payload: { deletedSessionId: meta.session_id, usage: [] } }], undefined, { sessions: [meta.session_id] });
    const runtime = new OperationTelemetry({ snapshot: () => scope(store.events()), events: () => store.events() }, store);
    store.commit(runtime.legacyEvents());
    const result = runtime.query({ type: "telemetry.operations" });
    assert.equal(result.type, "telemetry.operations");
    if (result.type === "telemetry.operations") {
      assert.equal(result.coverage?.priorHistory, "retained-events-only"); assert.equal(result.totals.failureRate, null); assert.equal(result.entries.length, 0);
    }
    assert.equal(store.events().some((event) => event.event_type === "tool.completed"), false);
  } finally { store.close(); }
});
