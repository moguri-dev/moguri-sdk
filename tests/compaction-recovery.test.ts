import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MoguriSdk, type EventInput } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { COMPACTION_PROMPT } from "../apps/service/src/compaction-context.ts";
import { setupFixture } from "./fixture.ts";
import { compactionFixture } from "./fixtures/compaction-service.ts";
import { assertCurrentSchema, writeLegacyState } from "./fixtures/legacy-state.ts";

test("schema 18 upgrades without rewriting ciphertext, scoped receipts, grants or charges and never invents compaction history", async () => {
  const f = await setupFixture({ workerPath: fileURLToPath(new URL("./fixtures/legacy-worker-83.ts", import.meta.url)), legacyTurnCheckpointJournal: true });
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await f.configure(); await f.send("Generated preserved pre-compaction ledger."); await f.terminal();
    await writeLegacyState(f.service, 18);
    const old = new DatabaseSync(f.service.store.path);
    const rows = old.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), receipts = old.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all();
    const blobs = old.prepare("SELECT * FROM blob_payloads ORDER BY digest,scope").all(), keys = old.prepare("SELECT * FROM retention_keys ORDER BY scope").all();
    old.close();
    restarted = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    const sdk = await new MoguriSdk(restarted.connection).ready();
    try {
      assertCurrentSchema(restarted.store);
      assert.deepEqual(restarted.store.db.prepare("SELECT seq,id,data,payload FROM events WHERE seq<=? ORDER BY seq").all(Number(rows.at(-1)!.seq)), rows);
      assert.deepEqual(restarted.store.db.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all(), receipts);
      assert.deepEqual(restarted.store.db.prepare("SELECT * FROM blob_payloads ORDER BY digest,scope").all(), blobs);
      assert.deepEqual(restarted.store.db.prepare("SELECT * FROM retention_keys ORDER BY scope").all(), keys);
      assert.deepEqual((await sdk.compactions.state(f.sessionId)).compactions, []);
      assert.equal((await sdk.budgets.status(f.sessionId)).status.totals.knownReportedTokens, 42);
      assert.equal(f.requests.length, 1);
    } finally { sdk.disconnect(); }
  } finally { await restarted?.close(); await f.close(); }
});

test("a failed schema-19 marker keeps schema-18 state intact and reopenable", async () => {
  const f = await setupFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await writeLegacyState(f.service, 18);
    const old = new DatabaseSync(f.service.store.path);
    const rows = old.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), receipts = old.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all();
    old.exec(`CREATE TRIGGER generated_compaction_migration_failure BEFORE INSERT ON retention_metadata
      WHEN NEW.id='context_compaction_schema' BEGIN SELECT RAISE(ABORT,'Generated compaction migration interruption'); END;`); old.close();
    const options = { stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey };
    await assert.rejects(() => startService(options), /Generated compaction migration interruption/);
    const preserved = new DatabaseSync(f.service.store.path);
    try {
      assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 18);
      assert.deepEqual(preserved.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), rows);
      assert.deepEqual(preserved.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all(), receipts);
      assert.equal(preserved.prepare("SELECT id FROM retention_metadata WHERE id='context_compaction_schema'").get(), undefined);
      preserved.exec("DROP TRIGGER generated_compaction_migration_failure");
    } finally { preserved.close(); }
    restarted = await startService(options); assertCurrentSchema(restarted.store);
    assert.equal(restarted.controller.snapshot().sessions[0]?.id, f.sessionId);
    assert.equal(f.requests.length, 0);
  } finally { await restarted?.close(); await f.close(); }
});

test("an applied summary survives restart and source deletion retains real compactor charges independently", { timeout: 20_000 }, async () => {
  const f = await compactionFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const preview = (await f.sdk.compactions.preview(f.sessionId, { keepRecentTurns: 1 })).preview;
    const request = await f.sdk.compactions.generate(f.sessionId, preview, true); await f.terminal();
    const entry = (await f.sdk.compactions.state(f.sessionId)).compactions.find((entry) => entry.id === request.id)!;
    await f.sdk.compactions.apply(f.sessionId, entry.id, entry.revision);
    const before = await f.sdk.compactions.state(f.sessionId), calls = (await f.sdk.budgets.calls()).calls;
    f.sdk.disconnect(); await f.service.close();
    restarted = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    const sdk = await new MoguriSdk(restarted.connection).ready();
    try {
      const after = await sdk.compactions.state(f.sessionId);
      assert.equal(after.activeId, before.activeId); assert.equal(after.sourceDigest, before.sourceDigest);
      assert.equal(after.estimatedTokens, before.estimatedTokens);
      assert.equal((await sdk.compactions.read(f.sessionId, entry.id)).text, f.configuration.replyText);
      assert.deepEqual((await sdk.budgets.calls()).calls, calls);
      await sdk.compactions.restore(f.sessionId, after.activeId!, after.sourceDigest, true);
      assert.equal((await sdk.compactions.state(f.sessionId)).activeId, null);
      await sdk.sessions.delete(f.sessionId, true);
      assert.equal(restarted.controller.snapshot().compactions.length, 0);
      assert.deepEqual((await sdk.budgets.calls()).calls, calls);
      assert.equal(f.requests.length, 4);
    } finally { sdk.disconnect(); }
  } finally { await restarted?.close(); await f.close(); }
});

test("restart reconciles a generated interrupted admission snapshot without replaying or freeing its unknown reservation", { timeout: 20_000 }, async () => {
  const f = await compactionFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const preview = (await f.sdk.compactions.preview(f.sessionId, { keepRecentTurns: 1 })).preview;
    const request = await f.sdk.compactions.generate(f.sessionId, preview, true); await f.terminal();
    const template = (await f.sdk.compactions.state(f.sessionId)).compactions.find((entry) => entry.id === request.id)!;
    const id = "generated-interrupted-compaction", stepId = "generated-interrupted-compaction-step", session = f.session();
    const reservation = f.service.controller.platform.budgets.reserve(session, { stepId, turnId: id, providerId: "github-copilot", apiModelId: f.modelId, role: "compaction", modelId: f.modelId, inputEstimate: 3000, maxOutputTokens: 1024 });
    const metadata = { profile_id: "default", project_id: session.projectId, session_id: session.id, turn_id: id, step_id: stepId };
    const events: EventInput[] = [
      { ...metadata, event_type: "compaction.saved", payload: { compaction: { ...template, id, turnId: id, revision: 0, status: "running", stepId, resultDigest: null, replacementDigest: null, afterTokens: null, completedAt: null } } },
      { ...metadata, event_type: "turn.control_started", payload: { purpose: "compaction", compactionId: id, controls: session.controls, policyRevision: f.service.controller.snapshot().policy.revision, promptDigest: f.service.store.putBlob(COMPACTION_PROMPT) } },
      reservation.event,
      { ...metadata, event_type: "model.started", payload: { modelId: f.modelId, role: "compaction" } },
    ];
    f.service.store.commit(events);
    f.sdk.disconnect(); await f.service.close();
    restarted = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    const sdk = await new MoguriSdk(restarted.connection).ready();
    try {
      const state = await sdk.compactions.state(f.sessionId);
      assert.equal(state.activeId, null);
      assert.equal(state.compactions.find((entry) => entry.id === id)?.status, "partial");
      const held = (await sdk.budgets.calls({ role: "compaction" })).calls.find((entry) => entry.id === stepId)!;
      assert.equal(held.status, "unknown"); assert.equal(held.reportedTokens, null);
      assert.equal(held.reservedTokens, 4024);
      assert.equal(f.requests.length, 4);
      assert.equal(restarted.controller.snapshot().sessions[0]?.turnId, null);
    } finally { sdk.disconnect(); }
  } finally { await restarted?.close(); await f.close(); }
});
