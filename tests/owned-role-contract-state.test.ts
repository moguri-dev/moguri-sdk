import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { EventStore } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION, projectEvents } from "../packages/sdk/src/index.ts";
import { roleProposalFixture } from "./fixtures/role-proposal-api.ts";
import { roleContractFixture } from "./fixtures/role-contract-api.ts";
import { retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";

test("schema-34 contract marker rollback preserves actual version-1 role/candidate evidence, ciphertext and explicit model marker", { skip: process.platform !== "darwin" }, async () => {
  const f = await roleProposalFixture({ legacyCandidateJournal: true }); let reopened: EventStore | undefined;
  try {
    const preview = (await f.sdk.candidates.preview(f.sessionId, f.workspace.id, f.patch, f.reference)).preview;
    const staged = await f.sdk.candidates.wait((await f.sdk.candidates.stage(f.sessionId, f.workspace.id, f.patch, preview.digest, f.reference)).id!);
    const before = retainedCiphertextRows(f.service.store.db), path = f.service.store.path, origin = staged.candidate.roleOrigin!;
    const originalInput = f.service.store.blob(origin.sequenceInputDigest);
    await writeLegacyState(f.service, 34);
    const raw = new DatabaseSync(path);
    try { raw.exec(`CREATE TRIGGER generated_role_contract_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='owned_role_contract_schema'
      BEGIN SELECT RAISE(ABORT,'Generated owned contract marker failure'); END;`); } finally { raw.close(); }
    assert.throws(() => new EventStore(path, f.retentionKey), /contract marker failure/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 34);
      assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id='model_evidence_schema'").get()?.value, "1");
      assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id='owned_role_contract_schema'").get(), undefined);
      assert.deepEqual(retainedCiphertextRows(failed), before); failed.exec("DROP TRIGGER generated_role_contract_marker");
    } finally { failed.close(); }
    const started = performance.now(); reopened = new EventStore(path, f.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(reopened.db), before);
    const snapshot = projectEvents(reopened.events());
    assert.equal(snapshot.roleSequences[0]?.inputVersion, undefined); assert.deepEqual(snapshot.candidates[0]?.roleOrigin, origin);
    assert.equal(reopened.blob(origin.sequenceInputDigest), originalInput); assert.equal(JSON.parse(originalInput).version, 1);
    assert.equal(f.requests.length, 3);
    console.log(JSON.stringify({ primitive: "owned-role-contract-schema-34-to-35", ms: performance.now() - started, ciphertextUnchanged: true, retrofittedContracts: false }));
  } finally { reopened?.close(); await f.close(); }
});

test("new version-2 context/contract semantics cannot be relabeled as legacy schema 34", { skip: process.platform !== "darwin" }, async () => {
  const f = await roleContractFixture();
  try {
    const created = await f.run(); await f.settled(created.id);
    await assert.rejects(() => writeLegacyState(f.service, 34), /version-1.*legacy.*contract semantics/);
    assert.equal(f.service.store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.equal((await f.sdk.roleSequences.contract(created.id, 2)).result.status, "valid"); assert.equal(f.requests.length, 4);
  } finally { await f.close(); }
});
