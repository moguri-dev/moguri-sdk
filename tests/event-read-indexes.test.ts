import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import test from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { GLOBAL_PROFILE_ID, MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { removeChatTitleFixtureMarkers, retainedCiphertextRows } from "./fixtures/legacy-state.ts";
import { generatedNegotiationHistory } from "./fixtures/negotiation-history.ts";
import { generatedIssueRevisions } from "./fixtures/responsive-history.ts";

test("startup header indexing upgrades 103 atomically without rewriting retention and still rejects freshly corrupted headers", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let reopened: EventStore | undefined;
  try {
    await fixture.service.close();
    const raw = new DatabaseSync(path);
    raw.exec("DROP INDEX IF EXISTS events_startup_headers; PRAGMA user_version=103; CREATE TABLE events_startup_headers(blocked TEXT)");
    const original = retainedCiphertextRows(raw); raw.close();
    assert.throws(() => new EventStore(path, fixture.retentionKey), /events_startup_headers|index/i);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 103);
      assert.deepEqual(retainedCiphertextRows(failed), original);
      failed.exec("DROP TABLE events_startup_headers");
    } finally { failed.close(); }
    reopened = new EventStore(path, fixture.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    const sql = `SELECT seq,json_extract(data,'$.schema_version','$.event_type','$.id','$.timestamp','$.profile_id') AS header,
      json_type(data,'$.payload') AS payload_type FROM events INDEXED BY events_startup_headers ORDER BY seq`;
    const plan = reopened.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
    assert.ok(plan.some((row) => String(row.detail).includes("COVERING INDEX events_startup_headers")));
    const before = reopened.events();
    reopened.close(); reopened = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(reopened.events(), before);
    reopened.close(); reopened = undefined;
    const corrupt = new DatabaseSync(path);
    try {
      corrupt.exec("DROP TRIGGER events_no_update");
      corrupt.prepare("UPDATE events SET data=json_set(data,'$.schema_version',999) WHERE seq=?").run(before[0]!.seq);
    } finally { corrupt.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Unsupported or corrupt durable event/);
    const preserved = new DatabaseSync(path);
    try { assert.equal(preserved.prepare("SELECT json_extract(data,'$.schema_version') AS version FROM events WHERE seq=?").get(before[0]!.seq)?.version, 999); }
    finally { preserved.close(); }
  } finally { reopened?.close(); await fixture.close(); }
});

test("profile/type read indexes upgrade genuine schema88 atomically without changing ciphertext, grants or receipts", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let reopened: EventStore | undefined;
  try {
    await fixture.service.close();
    const raw = new DatabaseSync(path);
    removeChatTitleFixtureMarkers(raw, fixture.service.controller.events(0));
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
    "DROP INDEX events_startup_headers",
    "DROP INDEX events_startup_headers; CREATE INDEX events_startup_headers ON events(seq)",
    "PRAGMA user_version=88",
  ]) await t.test(sql, async () => {
    const fixture = await setupFixture(), path = fixture.service.store.path;
    try {
      await fixture.service.close();
      const raw = new DatabaseSync(path), before = retainedCiphertextRows(raw); try { raw.exec(sql); } finally { raw.close(); }
      assert.throws(() => new EventStore(path, fixture.retentionKey), /event read index|chat naming\/live delivery|repository management|milestone capability/i);
      const preserved = new DatabaseSync(path);
      try { assert.deepEqual(retainedCiphertextRows(preserved), before); } finally { preserved.close(); }
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

test("retention rereads authenticate original ciphertext before reusing only exact issue-source metadata", async () => {
  const fixture = await setupFixture(), store = fixture.service.store, peer = store.view("default");
  try {
    store.commit(generatedIssueRevisions(fixture.session().projectId, 3, 1));
    const previous = store.events(), original = previous.find((event) => event.event_type === "issue.saved")!;
    assert.ok(original.event_type === "issue.saved" && original.payload.issue.github);
    const first = store.events(0, previous).find((event) => event.id === original.id)!;
    assert.ok(first.event_type === "issue.saved");
    assert.equal(first.payload.issue.github, original.payload.issue.github);
    original.payload.issue.body = "Generated mutated prior view, never source.";
    original.payload.issue.github.url = "https://github.com/generated/changed/issues/1";
    const fresh = store.events(0, previous).find((event) => event.id === original.id)!;
    assert.ok(fresh.event_type === "issue.saved");
    assert.notEqual(fresh.payload.issue.body, original.payload.issue.body);
    assert.notEqual(fresh.payload.issue.github, original.payload.issue.github);
    assert.equal(fresh.payload.issue.github!.url, "https://github.com/generated/responsiveness/issues/1");
    const appended = peer.commit(generatedIssueRevisions(fixture.session().projectId, 1, 1));
    assert.deepEqual(store.events(previous.at(-1)!.seq, previous), appended);
    store.commit([], undefined, { projects: [fixture.session().projectId] });
    assert.equal(store.events(0, previous).some((event) => event.event_type === "issue.saved"), false);
  } finally { peer.close(); await fixture.close(); }
});

test("a previous issue view cannot hide corrupted encrypted source bytes on a retention reload", async () => {
  const fixture = await setupFixture(), store = fixture.service.store;
  try {
    const appended = store.commit(generatedIssueRevisions(fixture.session().projectId, 1, 1)), previous = store.events();
    store.db.exec("DROP TRIGGER events_no_update");
    store.db.prepare("UPDATE events SET data=json_set(data,'$.payload.data',?) WHERE id=?").run(Buffer.from("Generated corrupted ciphertext").toString("base64"), appended[0]!.id);
    assert.throws(() => store.events(0, previous), /retention payload|key.*missing\/corrupt/i);
  } finally { await fixture.close(); }
});

test("authenticated rereads refresh scope keys after a peer forgets or corrupts a previously read scope", async (t) => {
  for (const change of ["forgotten", "corrupted"] as const) await t.test(change, async () => {
    const fixture = await setupFixture(), store = fixture.service.store, peer = store.view("default");
    try {
      const appended = store.commit(generatedIssueRevisions(fixture.session().projectId, 3, 1));
      const previous = store.events();
      assert.equal(previous.filter((event) => event.event_type === "issue.saved").length, 3);
      if (change === "forgotten") {
        peer.commit([], undefined, { projects: [fixture.session().projectId] });
        assert.equal(store.events(0, previous).some((event) => event.event_type === "issue.saved"), false);
        assert.equal(store.eventsOfTypes(["issue.saved"]).length, 0);
      } else {
        const scope = store.db.prepare("SELECT json_extract(data,'$.payload.scope') AS scope FROM events WHERE id=?").get(appended[0]!.id)?.scope;
        const original = peer.db.prepare("SELECT payload FROM retention_keys WHERE scope=?").get(scope!)?.payload;
        assert.equal(typeof original, "string");
        peer.db.prepare("UPDATE retention_keys SET payload=json_set(payload,'$.data',?) WHERE scope=?")
          .run(Buffer.from("Generated corrupted scope key").toString("base64"), scope!);
        assert.throws(() => store.events(0, previous), /retention payload|key.*missing\/corrupt/i);
        assert.throws(() => store.eventsOfTypes(["issue.saved"]), /retention payload|key.*missing\/corrupt/i);
        peer.db.prepare("UPDATE retention_keys SET payload=? WHERE scope=?").run(original!, scope!);
        assert.deepEqual(store.events(), previous);
      }
      assert.equal(fixture.requests.length, 0);
    } finally { peer.close(); await fixture.close(); }
  });
});

test("an authenticated row failure releases full and indexed read cursors without publishing a partial view", async () => {
  const fixture = await setupFixture(), store = fixture.service.store;
  try {
    const appended = store.commit(generatedIssueRevisions(fixture.session().projectId, 3, 1)), before = store.events();
    const original = store.db.prepare("SELECT data FROM events WHERE id=?").get(appended[1]!.id)?.data;
    assert.equal(typeof original, "string");
    store.db.exec("DROP TRIGGER events_no_update");
    store.db.prepare("UPDATE events SET data=json_set(data,'$.payload.data',?) WHERE id=?")
      .run(Buffer.from("Generated failure after an earlier authenticated row").toString("base64"), appended[1]!.id);
    for (const read of [() => store.events(), () => store.eventsOfTypes(["issue.saved"])]) {
      assert.throws(read, /retention payload|key.*missing\/corrupt/i);
      try { store.db.exec("BEGIN IMMEDIATE; DROP TABLE events; ROLLBACK"); }
      finally { if (store.db.isTransaction) store.db.exec("ROLLBACK"); }
    }
    store.db.prepare("UPDATE events SET data=? WHERE id=?").run(original!, appended[1]!.id);
    store.db.exec("CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;");
    assert.deepEqual(store.events(), before);
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});

test("type-selective readers use the retained type index and preserve profile, sequence, rollback and forgetting", async () => {
  const fixture = await setupFixture(), store = fixture.service.store, peer = store.view("generated-other-profile");
  try {
    store.commit(generatedIssueRevisions(fixture.session().projectId, 5, 2));
    peer.commit(generatedIssueRevisions("generated-other-project", 2, 1).map((event) => ({ ...event, profile_id: peer.profileId })));
    const types = ["draft.saved", "issue.saved"] as const;
    assert.deepEqual(store.eventsOfTypes(types), store.events().filter((event) => types.some((type) => type === event.event_type)));
    assert.equal(store.eventsOfTypes(["issue.saved"], store.events().at(-1)!.seq).length, 0);
    const plan = store.db.prepare(`EXPLAIN QUERY PLAN SELECT seq,data FROM events INDEXED BY events_type_sequence
      WHERE json_extract(data,'$.event_type') IN (?,?) AND json_extract(data,'$.profile_id')=? AND seq>? ORDER BY seq`).all(...types, store.profileId, 0);
    assert.ok(plan.some((row) => String(row.detail).includes("events_type_sequence")));
    const before = store.eventsOfTypes(types);
    assert.throws(() => store.commit(generatedIssueRevisions(fixture.session().projectId, 1, 1), undefined, undefined, () => {
      assert.equal(store.eventsOfTypes(["issue.saved"]).length, 6);
      throw new Error("Generated sparse read rollback");
    }), /Generated sparse read rollback/);
    assert.deepEqual(store.eventsOfTypes(types), before);
    store.commit([], undefined, { projects: [fixture.session().projectId] });
    assert.equal(store.eventsOfTypes(["issue.saved"]).length, 0);
    assert.equal(peer.eventsOfTypes(["issue.saved"]).length, 2);
  } finally { peer.close(); await fixture.close(); }
});

test("profile refresh reuses only an unchanged store and observes peer commits, local writes, rollback and retention changes", async (t) => {
  const fixture = await setupFixture(), store = fixture.service.store, control = fixture.service.controller, peer = store.view("default");
  try {
    control.refreshProfile();
    const read = t.mock.method(store, "events");
    control.refreshProfile();
    assert.equal(read.mock.callCount(), 0);
    const before = store.revision();
    peer.commit([{ event_type: "draft.saved", profile_id: "default", project_id: fixture.session().projectId, session_id: fixture.sessionId,
      payload: { text: "Generated peer refresh draft", attachments: [] } }]);
    assert.notEqual(store.revision().external, before.external);
    control.refreshProfile();
    assert.equal(fixture.session().draft.text, "Generated peer refresh draft");
    const local = store.revision();
    store.commit(generatedIssueRevisions(fixture.session().projectId, 1, 1));
    assert.notEqual(store.revision().local, local.local);
    control.refreshProfile();
    assert.equal(control.snapshot().issues.length, 1);
    assert.throws(() => store.commit(generatedIssueRevisions(fixture.session().projectId, 1, 1), undefined, undefined, () => {
      throw new Error("Generated profile refresh rollback");
    }), /Generated profile refresh rollback/);
    control.refreshProfile();
    assert.equal(control.snapshot().issues.length, 1);
    store.commit([], undefined, { sessions: [fixture.sessionId] });
    control.refreshProfile();
    assert.equal(control.snapshot().sessions.some((session) => session.id === fixture.sessionId), false);
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
