import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import test from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { GLOBAL_PROFILE_ID, MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { retainedCiphertextRows } from "./fixtures/legacy-state.ts";
import { generatedNegotiationHistory } from "./fixtures/negotiation-history.ts";

test("profile/type read indexes upgrade genuine schema88 atomically without changing ciphertext, grants or receipts", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let reopened: EventStore | undefined;
  try {
    await fixture.service.close();
    const raw = new DatabaseSync(path);
    raw.exec("DROP INDEX IF EXISTS events_profile_sequence; DROP INDEX IF EXISTS events_type_sequence; DELETE FROM retention_metadata WHERE id='event_read_indexes_schema'; PRAGMA user_version=88;");
    const before = retainedCiphertextRows(raw);
    raw.exec("CREATE TRIGGER generated_read_index_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='event_read_indexes_schema' BEGIN SELECT RAISE(ABORT,'Generated read index interruption'); END;");
    raw.close();
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated read index interruption/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 88);
      assert.deepEqual(retainedCiphertextRows(failed), before);
      assert.equal(failed.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('events_profile_sequence','events_type_sequence')").get()?.count, 0);
      failed.exec("DROP TRIGGER generated_read_index_failure");
    } finally { failed.close(); }
    reopened = new EventStore(path, fixture.retentionKey);
    assert.equal(PROTOCOL_VERSION, 89);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id='event_read_indexes_schema'").get()?.value, "1");
    assert.deepEqual(retainedCiphertextRows(reopened.db), before);
    reopened.close(); reopened = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(retainedCiphertextRows(reopened.db), before);
  } finally { reopened?.close(); await fixture.close(); }
});

test("the indexed read keeps exact profile/sequence order and SQLite uses both intended query paths", async () => {
  const fixture = await setupFixture(), global = fixture.service.store.view(GLOBAL_PROFILE_ID);
  try {
    const store = fixture.service.store, original = store.events();
    const profilePlan = store.db.prepare("EXPLAIN QUERY PLAN SELECT seq,data FROM events WHERE json_extract(data,'$.profile_id')=? AND seq>? ORDER BY seq").all("default", 0);
    const typePlan = store.db.prepare("EXPLAIN QUERY PLAN SELECT COALESCE(MAX(seq),0) AS seq FROM events WHERE json_extract(data,'$.event_type') IN ('budget.recorded','budget.plan_recorded')").all();
    assert.ok(profilePlan.some((row) => String(row.detail).includes("events_profile_sequence")));
    assert.ok(typePlan.some((row) => String(row.detail).includes("events_type_sequence")));
    assert.deepEqual(store.events(original[0]!.seq), original.slice(1));
    assert.ok(global.events().every((event) => event.profile_id === GLOBAL_PROFILE_ID));
    assert.ok(store.events().every((event) => event.profile_id === "default"));
    assert.equal(fixture.requests.length, 0);
  } finally { global.close(); await fixture.close(); }
});

test("missing, corrupt or prematurely retained read-index provenance cannot silently rebuild or relabel a store", async (t) => {
  for (const sql of [
    "DELETE FROM retention_metadata WHERE id='event_read_indexes_schema'",
    "UPDATE retention_metadata SET value='0' WHERE id='event_read_indexes_schema'",
    "DROP INDEX events_profile_sequence",
    "DROP INDEX events_type_sequence; CREATE INDEX events_type_sequence ON events(seq)",
    "PRAGMA user_version=88",
  ]) await t.test(sql, async () => {
    const fixture = await setupFixture(), path = fixture.service.store.path;
    try {
      await fixture.service.close();
      const raw = new DatabaseSync(path); try { raw.exec(sql); } finally { raw.close(); }
      assert.throws(() => new EventStore(path, fixture.retentionKey), /event read index/i);
    } finally { await fixture.close(); }
  });
});

test("indexed readers observe concurrent committed appends and never retain rolled-back speculative rows", async () => {
  const fixture = await setupFixture(), store = fixture.service.store, peer = store.view("default");
  try {
    const event = { event_type: "draft.saved" as const, profile_id: "default", project_id: fixture.session().projectId,
      session_id: fixture.sessionId, payload: { text: "Generated committed indexed draft.", attachments: [] } };
    const before = peer.events();
    assert.throws(() => store.commit([event], undefined, undefined, () => { peer.events(); throw new Error("Generated indexed transaction rollback"); }), /Generated indexed transaction rollback/);
    assert.deepEqual(peer.events(), before);
    const committed = store.commit([event]);
    assert.deepEqual(peer.events(before.at(-1)!.seq), committed);
    assert.equal(peer.events().at(-1)?.event_type, "draft.saved");
  } finally { peer.close(); await fixture.close(); }
});

test("new chat and snapshot acknowledgement do not repeatedly decode unrelated retained ciphertext", { timeout: 20_000 }, async (t) => {
  const fixture = await setupFixture(), stateDir = join(fixture.directory, "state");
  let runtime: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined;
  try {
    const events = generatedNegotiationHistory(fixture.sessionId, fixture.session().projectId, "Generated retained responsive draft.");
    await fixture.service.close();
    const store = new EventStore(join(stateDir, "state.sqlite"), fixture.retentionKey);
    try { store.commit(events); } finally { store.close(); }
    const startup = performance.now();
    runtime = await startService({ stateDir, provider: fixture.provider, retentionKey: fixture.retentionKey });
    const startupMs = performance.now() - startup;
    sdk = await new MoguriSdk(runtime.connection).ready();
    const timings: number[] = [];
    for (let index = 0; index < 3; index++) {
      const began = performance.now(), result = await sdk.sessions.create(null, `Generated responsive chat ${index}`);
      timings.push(performance.now() - began);
      assert.ok(sdk.sessions.get(result.id!));
    }
    const began = performance.now(); await sdk.refresh(); const snapshotMs = performance.now() - began;
    t.diagnostic(JSON.stringify({ retainedHistoryBytes: Buffer.byteLength(JSON.stringify(events)), startupMs, newChatMs: timings, snapshotMs }));
    assert.ok(startupMs < 2000, `Generated service startup took ${startupMs.toFixed(1)} ms, above 2000 ms.`);
    assert.ok(timings.every((ms) => ms < 500), `Generated new-chat acknowledgement exceeded 500 ms: ${timings.join(", ")}.`);
    assert.ok(snapshotMs < 200, `Generated snapshot took ${snapshotMs.toFixed(1)} ms, above 200 ms.`);
    const catalog = await sdk.profiles.list();
    await sdk.profiles.globalBudget({ basis: "estimate", tokens: 1_000_000_000 }, catalog.catalog.globalBudget.revision, true);
    const capped: number[] = [];
    for (let index = 0; index < 3; index++) {
      const began = performance.now(); await sdk.sessions.create(null, `Generated capped responsive chat ${index}`);
      capped.push(performance.now() - began);
    }
    t.diagnostic(JSON.stringify({ finiteGlobalPolicyNewChatMs: capped }));
    assert.ok(capped.every((ms) => ms < 500), `Finite-global-policy new-chat acknowledgement exceeded 500 ms: ${capped.join(", ")}.`);
    assert.equal(sdk.sessions.get(fixture.sessionId)?.draft.text, "Generated retained responsive draft.");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk?.disconnect(); await runtime?.close(); await fixture.close(); }
});
