import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { EventStore, nativeScriptSchemaMarker, digest } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk, PROTOCOL_VERSION, type ScriptReviewRecord, type ScriptExecutionResult } from "../packages/sdk/src/index.ts";
import { scriptReviewFixture } from "./fixtures/script-review.ts";
import { removeNativeScriptFixtureMarker, retainedCiphertextRows } from "./fixtures/legacy-state.ts";
import { waitFor } from "./fixture.ts";

test("genuine102 Local reviews upgrade atomically without ciphertext changes and preserve an exact later user force", { skip: process.platform !== "darwin" }, async () => {
  const f = await scriptReviewFixture({ unsafe: true });
  let reopened: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined;
  try {
    await f.send("Generated original102 complete-source review."); await f.terminal();
    const review = structuredClone(f.review()!), events = f.service.controller.events(0), calls = f.requests.length;
    f.sdk.disconnect(); await f.service.close();
    const raw = new DatabaseSync(f.service.store.path);
    removeNativeScriptFixtureMarker(raw, events); raw.exec("PRAGMA user_version=102");
    const original = retainedCiphertextRows(raw);
    raw.exec("CREATE TRIGGER generated103_interruption BEFORE INSERT ON retention_metadata WHEN NEW.id='native_script_execution_schema' BEGIN SELECT RAISE(ABORT,'Generated atomic103 interruption'); END");
    raw.close();
    assert.throws(() => new EventStore(f.service.store.path, f.retentionKey), /Generated atomic103 interruption/);
    const interrupted = new DatabaseSync(f.service.store.path);
    try {
      assert.equal(interrupted.prepare("PRAGMA user_version").get()?.user_version, 102);
      assert.equal(interrupted.prepare("SELECT value FROM retention_metadata WHERE id=?").get(nativeScriptSchemaMarker), undefined);
      assert.deepEqual(retainedCiphertextRows(interrupted), original);
      interrupted.exec("DROP TRIGGER generated103_interruption");
    } finally { interrupted.close(); }
    const migrated = new EventStore(f.service.store.path, f.retentionKey);
    try {
      assert.equal(migrated.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
      assert.deepEqual(retainedCiphertextRows(migrated.db), original);
    } finally { migrated.close(); }
    reopened = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    sdk = await new MoguriSdk(reopened.connection).ready();
    const read = await sdk.scriptReviews.read(f.sessionId, review.id);
    assert.deepEqual(read.review, review); assert.equal(read.text, f.source); assert.equal(f.requests.length, calls);
    const forced = await sdk.scriptReviews.force(f.sessionId, review.id, review.source.digest, review.revision);
    const approval = await waitFor(() => reopened!.controller.snapshot().sessions.find((session) => session.id === f.sessionId)?.pendingApproval);
    await sdk.approvals.respond(f.sessionId, approval.id, true);
    assert.equal((await sdk.jobs.wait(forced.id!)).status, "completed");
    assert.equal(f.requests.length, calls);
    await assert.rejects(() => sdk!.scriptReviews.force(f.sessionId, review.id, review.source.digest, review.revision), /original|retained|exact|revision/i);
  } finally { sdk?.disconnect(); await reopened?.close(); await f.close(); }
});

for (const forgotten of [false, true]) test(`storage-only native result references survive reopen and ${forgotten ? "forgotten" : "retained"} grants cannot downgrade`, {
  skip: process.platform !== "darwin",
}, async () => {
  const f = await scriptReviewFixture({ autopilot: true });
  let store: EventStore | undefined;
  try {
    await f.send("Generated encrypted native observation storage."); await f.terminal();
    const base = structuredClone(f.review()!), path = join(f.directory, "generated-observation.sqlite");
    const result: ScriptExecutionResult = { text: "Generated original native observation.", outcome: "completed", isError: false };
    store = new EventStore(path, f.retentionKey);
    const resultDigest = store.putBlob(JSON.stringify(result));
    assert.equal(store.putBlob(f.source), base.source.digest);
    const review: ScriptReviewRecord = { ...base, revision: base.revision + 1, nativeExecution: {
      version: 1, executionId: "generated-storage-execution", workspaceId: "generated-storage-workspace", turnId: base.turnId,
      stepId: "generated-storage-step", rootDigest: base.source.rootDigest, guestRootDigest: "1".repeat(64), resultDigest,
    } };
    store.commit([{ event_type: "script.review_recorded", profile_id: base.profileId, project_id: base.projectId, session_id: base.sessionId,
      turn_id: base.turnId, step_id: review.nativeExecution!.stepId, payload: { review } }]);
    store.close(); store = new EventStore(path, f.retentionKey);
    assert.equal(store.blob(resultDigest), JSON.stringify(result)); assert.equal(digest(store.blob(resultDigest)), resultDigest);
    if (forgotten) store.commit([], undefined, { sessions: [base.sessionId] });
    store.close(); store = undefined;
    const raw = new DatabaseSync(path);
    raw.exec("DELETE FROM retention_metadata WHERE id='native_script_execution_schema'; PRAGMA user_version=102");
    const original = retainedCiphertextRows(raw); raw.close();
    assert.throws(() => new EventStore(path, f.retentionKey), /pre-103/);
    const preserved = new DatabaseSync(path);
    try { assert.deepEqual(retainedCiphertextRows(preserved), original); } finally { preserved.close(); }
  } finally { store?.close(); await f.close(); }
});
