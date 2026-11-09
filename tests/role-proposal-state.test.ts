import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { digest, EventStore } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION, projectEvents } from "../packages/protocol/src/index.ts";
import { ownedSequenceFixture } from "./fixtures/owned-sequence-api.ts";
import { retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";

test("schema-32 role-proposal marker preserves actual owned-role inputs/results, ciphertext, plans, keys and receipts on failure and reopen", { skip: process.platform !== "darwin" }, async () => {
  const f = await ownedSequenceFixture({ legacyTurnCheckpointJournal: true }); let opened: EventStore | undefined;
  try {
    const created = await f.start(), sequence = await f.settled(created.id), path = f.service.store.path;
    const before = retainedCiphertextRows(f.service.store.db), identities = f.service.store.events().map(({ id, seq }) => ({ id, seq }));
    const input = f.service.store.blob(sequence.inputDigest), result = f.service.store.blob(sequence.steps[2]!.resultDigest!);
    await writeLegacyState(f.service, 32);
    const raw = new DatabaseSync(path);
    try { raw.exec(`CREATE TRIGGER generated_role_proposal_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='candidate_role_schema'
      BEGIN SELECT RAISE(ABORT,'Generated role proposal marker failure'); END;`); } finally { raw.close(); }
    assert.throws(() => new EventStore(path, f.retentionKey), /role proposal marker failure/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 32);
      assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id='candidate_role_schema'").get(), undefined);
      assert.deepEqual(retainedCiphertextRows(failed), before); failed.exec("DROP TRIGGER generated_role_proposal_marker");
    } finally { failed.close(); }
    const started = performance.now(); opened = new EventStore(path, f.retentionKey);
    assert.equal(opened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(opened.db), before); assert.deepEqual(opened.events().map(({ id, seq }) => ({ id, seq })), identities);
    assert.equal(opened.blob(sequence.inputDigest), input); assert.equal(opened.blob(sequence.steps[2]!.resultDigest!), result);
    const snapshot = projectEvents(opened.events());
    assert.equal(snapshot.roleSequences[0]?.id, sequence.id); assert.equal(snapshot.roleSequences[0]?.status, "completed");
    assert.equal(snapshot.candidates.length, 0); assert.equal(f.requests.length, 3);
    console.log(JSON.stringify({ primitive: "role-proposal-schema-32-to-33", ms: performance.now() - started, ciphertextUnchanged: true, fabricatedOrigins: false }));
  } finally { opened?.close(); await f.close(); }
});

test("legacy fixtures reject new candidate role origin instead of relabeling it as schema 32", { skip: process.platform !== "darwin" }, async () => {
  const patch = { kind: "patch" as const, summary: "Generated immutable role source.", edits: [
    { path: "fixture.txt", baseDigest: digest("generated original\n"), text: "Generated role migration bytes.\n" },
  ] }, f = await ownedSequenceFixture({ replyText: JSON.stringify(patch) });
  try {
    const created = await f.start(); await f.settled(created.id);
    const origin = { roleSequenceId: created.id }, preview = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, patch, origin)).preview;
    await f.sdk.candidates.wait((await f.sdk.candidates.stage(f.sessionId, f.workspace.id, patch, preview.digest, origin)).id!);
    await assert.rejects(() => writeLegacyState(f.service, 32), /pre-role-proposal history/);
  } finally { await f.close(); }
});
