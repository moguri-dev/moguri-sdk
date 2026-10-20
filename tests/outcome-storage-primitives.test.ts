import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../apps/service/src/store.ts";
import type { EventInput, StoredEvent } from "../packages/protocol/src/index.ts";
import { operationProjection, profileCipherStorage } from "./fixtures/outcome-prototype.ts";

const controls = { env: "Local", modelId: "generated-model", autonomy: "Manual", budget: { kind: "unlimited" } } as const;
const meta = { profile_id: "default", session_id: "generated-session", project_id: "generated-project", turn_id: "generated-turn", step_id: "generated-step" };
const stored = (input: EventInput, seq: number): StoredEvent => ({ ...input, seq, id: `generated-event-${seq}`, schema_version: 1, timestamp: new Date(Date.UTC(2024, 0, 1, 0, 0, seq)).toISOString(), work_item_id: null, parent_event_id: null, artifact_id: null });
const call = { id: "generated-call", name: "read_file", arguments: { path: "GENERATED_PRIVATE_SENTINEL.txt" } };
function source(outcome = "completed", isError = false): StoredEvent[] {
  return [
    stored({ ...meta, event_type: "session.created", payload: { title: "Generated private title", controls } }, 1),
    stored({ ...meta, event_type: "model.started", payload: { modelId: "generated-model", role: "solver" } }, 2),
    stored({ ...meta, event_type: "tool.started", payload: { call } }, 3),
    stored({ ...meta, event_type: "tool.completed", payload: { call, text: "GENERATED_PRIVATE_SENTINEL output/credentials", isError, outcome } }, 4),
  ];
}

test("outcome projection retains exact operational metadata but never arguments, outputs, prompts or error text", () => {
  const entries = operationProjection(source());
  assert.equal(entries.length, 1); assert.equal(entries[0]?.family, "tool");
  assert.equal(entries[0]?.actor, "model"); assert.equal(entries[0]?.outcome, "completed"); assert.equal(entries[0]?.started, true);
  assert.equal(entries[0]?.elapsedMs, 1000);
  assert.equal(JSON.stringify(entries).includes("GENERATED_PRIVATE_SENTINEL"), false);
  assert.equal(JSON.stringify(entries).includes("Generated private title"), false);
  for (const outcome of ["stopped", "partial", "unconfirmed", "failed"]) {
    const result = operationProjection(source(outcome, true))[0]!;
    assert.equal(result.outcome, outcome); assert.notEqual(result.outcome, "completed");
  }
  assert.equal(operationProjection(source("completed", true))[0]?.outcome, "unknown");
});

test("tool identity includes owning scope; reused call IDs, profiles and incomplete outcomes cannot collapse into successes", () => {
  const first = source(), second = source().map((event) => ({ ...event, id: `${event.id}-second`, turn_id: "generated-second-turn", step_id: "generated-second-step" }));
  const foreign = source().map((event) => ({ ...event, id: `${event.id}-foreign`, profile_id: "generated-beta" }));
  const entries = operationProjection([...first, ...second, ...foreign]);
  assert.equal(entries.length, 2); assert.notEqual(entries[0]?.id, entries[1]?.id);
  const interrupted = operationProjection([...first.slice(0, 3), stored({ ...meta, event_type: "turn.finished", payload: { outcome: "stopped", diagnostic: "GENERATED_PRIVATE_SENTINEL cancellation detail" } }, 5)]);
  assert.equal(interrupted[0]?.outcome, "unconfirmed");
  assert.equal(interrupted[0]?.elapsedMs, null); assert.equal(interrupted[0]?.finishedAt, null);
  assert.equal(JSON.stringify(interrupted).includes("GENERATED_PRIVATE_SENTINEL"), false);
});

test("actual MCP attempts form a separate family while discovery and uncertain legacy actors stay distinct", () => {
  const events = source("partial", true), mcp = { ...call, name: "mcp_gateway", arguments: { action: "call", serverId: "generated-server", tool: "generated_tool", arguments: { key: "GENERATED_PRIVATE_SENTINEL" }, schemaDigest: "a".repeat(64) } };
  const replaced = events.map((event) => event.event_type === "tool.started" ? { ...event, payload: { call: mcp } } : event.event_type === "tool.completed" ? { ...event, payload: { ...event.payload, call: mcp } } : event);
  const result = operationProjection(replaced)[0]!;
  assert.equal(result.family, "mcp"); assert.equal(result.serverId, "generated-server"); assert.equal(result.name, "generated_tool");
  assert.equal(result.outcome, "partial"); assert.equal(JSON.stringify(result).includes("GENERATED_PRIVATE_SENTINEL"), false);
  const legacy = operationProjection(source().filter((event) => event.event_type !== "model.started"));
  assert.equal(legacy[0]?.actor, "unknown");
  const discovery = replaced.map((event): StoredEvent => {
    const call = { ...mcp, arguments: { action: "discover" } };
    if (event.event_type === "tool.started") return { ...event, payload: { call } };
    if (event.event_type === "tool.completed") return { ...event, payload: { ...event.payload, call } };
    return event;
  });
  assert.equal(operationProjection(discovery)[0]?.family, "tool");
});

test("denied admission is not execution or a fabricated latency, and external MCP is not attributed to the user or a model", () => {
  const approval = { id: "generated-approval", stepId: meta.step_id, call, policyRevision: 0 };
  const denied = operationProjection([...source().slice(0, 2),
    stored({ ...meta, event_type: "tool.requested", payload: { approval } }, 3),
    stored({ ...meta, event_type: "tool.decided", payload: { approvalId: approval.id, actor: "user", allow: false } }, 4)]);
  assert.equal(denied[0]?.outcome, "denied"); assert.equal(denied[0]?.started, false); assert.equal(denied[0]?.elapsedMs, null);
  const external = operationProjection([...source().filter((event) => event.event_type !== "model.started"), stored({ ...meta, event_type: "job.started", payload: { job: {
    id: "generated-external-job", kind: "mcp.call", projectId: meta.project_id, sessionId: meta.session_id, workspaceId: null,
    parentTurnId: meta.turn_id, status: "waiting_input", progress: "GENERATED_PRIVATE_SENTINEL", resultDigest: null, error: null,
  } } }, 2)]);
  assert.equal(external[0]?.actor, "external"); assert.equal(JSON.stringify(external).includes("GENERATED_PRIVATE_SENTINEL"), false);
});

test("explicit user plan controls are excluded from model tool/MCP counts and legacy time/environment stays unknown", () => {
  const controlled = operationProjection([...source(), stored({ ...meta, event_type: "turn.control_started", payload: { purpose: "plan.save", saveId: "generated-save", controls, policyRevision: 0, intentDigest: "a".repeat(64) } }, 2)]);
  assert.equal(controlled.length, 0);
  const result = operationProjection(source().filter((event) => event.event_type === "tool.completed"))[0]!;
  assert.equal(result.actor, "unknown"); assert.equal(result.env, "unknown"); assert.equal(result.startedAt, null); assert.equal(result.elapsedMs, null);
});

test("sanitized retained projection survives session-key deletion without copying source contents", () => {
  const store = new EventStore(":memory:");
  try {
    const primary = source().map(({ event_type, payload }) => ({ ...meta, event_type, payload } as EventInput));
    store.commit(primary, undefined, undefined, (events) => operationProjection(events).map((entry) => ({
      event_type: "job.progress", profile_id: "default", payload: { jobId: `generated-metric-${entry.id}`, progress: JSON.stringify(entry) },
    })));
    store.commit([{ event_type: "session.deleted", profile_id: "default", payload: { deletedSessionId: meta.session_id, usage: [] } }], undefined, { sessions: [meta.session_id] });
    const retained = store.events().filter((event) => event.event_type === "job.progress");
    assert.equal(retained.length, 1); assert.equal(JSON.stringify(retained).includes("GENERATED_PRIVATE_SENTINEL"), false);
    assert.equal(store.events().some((event) => event.event_type === "tool.completed"), false);
  } finally { store.close(); }
});

test("storage counts one key-backed ciphertext payload per row/grant, excludes forgotten/foreign scopes and never invents physical reclaimed bytes", () => {
  const store = new EventStore(":memory:");
  try {
    store.commit([{ event_type: "session.created", profile_id: "default", session_id: "generated-storage-session", payload: { title: "Generated storage source", controls } },
      { event_type: "draft.saved", profile_id: "default", session_id: "generated-storage-session", payload: { text: "Generated encrypted draft. ".repeat(30), attachments: [] } }]);
    const before = profileCipherStorage(store);
    assert.ok(before.bytes.total > 0); assert.equal(before.bytes.total, before.bytes.events + before.bytes.blobGrants + before.bytes.keys);
    assert.equal(before.measurement, "key-backed-retained-ciphertext"); assert.equal(before.integrity, "not-verified"); assert.equal(before.physicalBytes, null);
    store.commit([{ event_type: "session.created", profile_id: "generated-beta", session_id: "generated-beta-session", payload: { title: "Generated foreign storage", controls } }]);
    assert.deepEqual(profileCipherStorage(store), before);
    store.commit([{ event_type: "session.deleted", profile_id: "default", payload: { deletedSessionId: "generated-storage-session", usage: [] } }], undefined, { sessions: ["generated-storage-session"] });
    const after = profileCipherStorage(store);
    assert.equal(after.counts.keys, before.counts.keys); // One forgotten session key is replaced by the profile tombstone key.
    assert.equal(after.reclaimedPhysicalBytes, null);
    assert.ok(after.bytes.events < before.bytes.events);
  } finally { store.close(); }
});

test("missing keys without a deletion tombstone fail storage measurement instead of silently becoming zero bytes", () => {
  const store = new EventStore(":memory:");
  try {
    store.commit([{ event_type: "session.created", profile_id: "default", session_id: "generated-corrupt-session", payload: { title: "Generated corruption", controls } }]);
    store.db.prepare("DELETE FROM retention_keys WHERE session_id=?").run("generated-corrupt-session");
    assert.throws(() => profileCipherStorage(store), /missing without a deletion record/);
  } finally { store.close(); }
});

test("duplicate content grants are real retained ciphertext copies rather than deduplicated logical content bytes", () => {
  const store = new EventStore(":memory:");
  try {
    const hash = store.putBlob("Generated shared content \u03bb ".repeat(40));
    store.commit(["generated-storage-a", "generated-storage-b"].map((session_id) => ({
      event_type: "session.created", profile_id: "default", session_id, payload: { title: "Generated grant", controls, contextDigest: hash },
    })));
    const size = profileCipherStorage(store);
    assert.equal(size.counts.blobContents, 1); assert.equal(size.counts.blobGrants, 2);
    assert.equal(size.bytes.blobGrants, store.db.prepare("SELECT payload FROM blob_payloads").all().reduce((sum, row) => sum + Buffer.byteLength(String(row.payload)), 0));
    assert.equal(size.bytes.events, store.db.prepare("SELECT payload FROM events").all().reduce((sum, row) => sum + Buffer.byteLength(String(row.payload)), 0));
    store.commit([{ event_type: "session.deleted", profile_id: "default", payload: { deletedSessionId: "generated-storage-a", usage: [] } }], undefined, { sessions: ["generated-storage-a"] });
    const after = profileCipherStorage(store);
    assert.equal(after.counts.blobContents, 1); assert.equal(after.counts.blobGrants, 1); assert.equal(store.blob(hash).startsWith("Generated"), true);
    assert.ok(after.bytes.blobGrants < size.bytes.blobGrants);
  } finally { store.close(); }
});

test("a failed derived write rolls back source and sanitized ledger together, and retained rows recover after a real store restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-outcome-primitives-")), path = join(root, "state.sqlite"), key = randomBytes(32);
  let store = new EventStore(path, key, "generated-retention-key");
  try {
    const inputs = source().map(({ event_type, payload }) => ({ ...meta, event_type, payload } as EventInput));
    assert.throws(() => store.commit(inputs, undefined, undefined, () => { throw new Error("Generated ledger persistence failure"); }), /Generated ledger persistence failure/);
    assert.equal(store.events().length, 0); assert.equal(profileCipherStorage(store).counts.keys, 0);
    store.commit(inputs, undefined, undefined, (events) => operationProjection(events).map((entry) => ({
      event_type: "job.progress", profile_id: "default", payload: { jobId: `generated-metric-${entry.id}`, progress: JSON.stringify(entry) },
    })));
    store.commit([{ event_type: "session.deleted", profile_id: "default", payload: { deletedSessionId: meta.session_id, usage: [] } }], undefined, { sessions: [meta.session_id] });
    const before = store.events(), size = profileCipherStorage(store);
    store.close(); store = new EventStore(path, key, "generated-retention-key");
    assert.deepEqual(store.events(), before); assert.deepEqual(profileCipherStorage(store), size);
    assert.equal(JSON.stringify(store.events()).includes("GENERATED_PRIVATE_SENTINEL"), false);
    assert.equal(store.events().filter((event) => event.event_type === "job.progress").length, 1);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test("generated large outcome replay is deterministic and keeps concurrent terminal identities separate", () => {
  const events: StoredEvent[] = [];
  for (let index = 0; index < 5000; index++) {
    const scope = { ...meta, turn_id: `generated-turn-${index}`, step_id: `generated-step-${index}` };
    events.push(stored({ ...scope, event_type: "model.started", payload: { modelId: "generated-model" } }, index * 4 + 1),
      stored({ ...scope, event_type: "tool.started", payload: { call } }, index * 4 + 2),
      stored({ ...scope, event_type: "tool.completed", payload: { call, text: "GENERATED_PRIVATE_SENTINEL", isError: index % 2 === 0, outcome: index % 2 === 0 ? "failed" : "completed" } }, index * 4 + 3),
      stored({ ...scope, event_type: "turn.finished", payload: { outcome: "completed", diagnostic: null } }, index * 4 + 4));
  }
  const started = performance.now(), entries = operationProjection(events), durationMs = performance.now() - started;
  assert.equal(entries.length, 5000); assert.equal(entries.filter((entry) => entry.outcome === "failed").length, 2500);
  assert.equal(JSON.stringify(entries).includes("GENERATED_PRIVATE_SENTINEL"), false);
  assert.deepEqual(operationProjection(events).map((entry) => entry.id), entries.map((entry) => entry.id));
  console.log(JSON.stringify({ primitive: "sanitized-operation-replay", events: events.length, entries: entries.length, durationMs, productionThroughput: false }));
});
