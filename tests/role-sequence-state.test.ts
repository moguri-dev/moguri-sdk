import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { EventStore } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION, projectEvents } from "../packages/protocol/src/index.ts";
import { candidateGenerationFixture } from "./fixtures/candidate-generation-api.ts";
import { retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";
import { roleSequenceFixture } from "./fixtures/role-sequence-api.ts";

test("schema-31 role-marker rollback preserves generation bytes; the current upgrade rekeys only its exact recorded result", { skip: process.platform !== "darwin" }, async () => {
  const f = await candidateGenerationFixture(undefined, { legacyCandidateJournal: true }); let opened: EventStore | undefined;
  try {
    const generated = await f.generate(), result = await f.settled(generated.id);
    assert.equal(result.generation.status, "proposed");
    const path = f.service.store.path, before = retainedCiphertextRows(f.service.store.db), identities = f.service.store.events().map(({ id, seq }) => ({ id, seq }));
    const rawResult = f.service.store.blob(result.generation.resultDigest!);
    const completion = f.service.store.events().find((event) => event.event_type === "model.completed" && event.step_id === result.generation.stepId)!;
    const sourceScope = `profile/default/project/${f.session().projectId}/session/${f.sessionId}`;
    await writeLegacyState(f.service, 31);
    const raw = new DatabaseSync(path);
    try { raw.exec(`CREATE TRIGGER generated_role_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='role_sequence_schema'
      BEGIN SELECT RAISE(ABORT,'Generated role marker failure'); END;`); } finally { raw.close(); }
    assert.throws(() => new EventStore(path, f.retentionKey), /role marker failure/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 31);
      assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id='role_sequence_schema'").get(), undefined);
      assert.deepEqual(retainedCiphertextRows(failed), before); failed.exec("DROP TRIGGER generated_role_marker");
    } finally { failed.close(); }
    const started = performance.now(); opened = new EventStore(path, f.retentionKey);
    assert.equal(opened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    const stableRows = (tables: ReturnType<typeof retainedCiphertextRows>) => tables.map(([table, rows]) => [table,
      table === "events" ? rows.filter((row) => row.id !== completion.id) :
        table === "blob_payloads" ? rows.filter((row) => row.digest !== result.generation.resultDigest || row.scope !== sourceScope) : rows]);
    assert.deepEqual(stableRows(retainedCiphertextRows(opened.db)), stableRows(before));
    assert.deepEqual(opened.events().map(({ id, seq }) => ({ id, seq })), identities);
    const rekeyed = opened.events().find((event) => event.id === completion.id)!;
    assert.equal(rekeyed.artifact_id, generated.id);
    assert.ok(rekeyed.event_type === "model.completed"); assert.equal(rekeyed.payload.candidateGenerationId, generated.id);
    assert.equal(rekeyed.timestamp, completion.timestamp);
    const projection = projectEvents(opened.events()); assert.deepEqual(projection.roleSequences, []);
    assert.equal(projection.candidateGenerations[0]?.id, generated.id);
    assert.equal(opened.blob(result.generation.resultDigest!), rawResult);
    console.log(JSON.stringify({ primitive: "role-sequence-schema-31-to-32", ms: performance.now() - started, unrelatedCiphertextUnchanged: true, candidateResultRekeyed: true, fabricatedSequences: false }));
  } finally { opened?.close(); await f.close(); }
});

test("legacy fixture generation cannot relabel future role records/control turns as schema 31", async () => {
  const f = await roleSequenceFixture();
  try { await assert.rejects(() => writeLegacyState(f.service, 31), /pre-sequence history/); }
  finally { await f.close(); }
});
