import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { EventStore } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION, projectEvents } from "../packages/protocol/src/index.ts";
import { roleProposalFixture } from "./fixtures/role-proposal-api.ts";
import { retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";

test("schema-33 inspection compatibility marker preserves independent actual role-origin copies on rollback and reopen", { skip: process.platform !== "darwin" }, async () => {
  const f = await roleProposalFixture(); let opened: EventStore | undefined;
  try {
    const preview = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, f.patch, f.reference)).preview;
    const staged = await f.sdk.candidates.wait((await f.sdk.candidates.stage(f.sessionId, f.workspace.id, f.patch, preview.digest, f.reference)).id!);
    const source = (await f.sdk.artifacts.read(f.sequence.id)).artifact;
    await f.sdk.artifacts.delete(source.id, source.revision, true);
    const path = f.service.store.path, before = retainedCiphertextRows(f.service.store.db), origin = staged.candidate.roleOrigin!;
    const roleResult = f.service.store.blob(origin.resultDigest);
    await writeLegacyState(f.service, 33);
    const raw = new DatabaseSync(path);
    try { raw.exec(`CREATE TRIGGER generated_evidence_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='model_evidence_schema'
      BEGIN SELECT RAISE(ABORT,'Generated evidence marker failure'); END;`); } finally { raw.close(); }
    assert.throws(() => new EventStore(path, f.retentionKey), /evidence marker failure/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 33);
      assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id='model_evidence_schema'").get(), undefined);
      assert.deepEqual(retainedCiphertextRows(failed), before); failed.exec("DROP TRIGGER generated_evidence_marker");
    } finally { failed.close(); }
    const started = performance.now(); opened = new EventStore(path, f.retentionKey);
    assert.equal(opened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(opened.db), before);
    const snapshot = projectEvents(opened.events());
    assert.deepEqual(snapshot.candidates[0]?.roleOrigin, origin); assert.equal(snapshot.roleSequences.length, 0);
    assert.equal(opened.blob(origin.resultDigest), roleResult);
    assert.ok(opened.blob(origin.sequenceInputDigest).length); assert.ok(opened.blob(origin.roleInputDigest).length);
    assert.equal(f.requests.length, 3);
    console.log(JSON.stringify({ primitive: "model-evidence-schema-33-to-34", ms: performance.now() - started, ciphertextUnchanged: true, automaticFamilyClaims: false }));
  } finally { opened?.close(); await f.close(); }
});
