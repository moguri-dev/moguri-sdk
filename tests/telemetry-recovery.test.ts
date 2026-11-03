import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MoguriSdk, type EventInput } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture } from "./fixture.ts";
import { assertCurrentSchema, writeLegacyState } from "./fixtures/legacy-state.ts";

function legacyTelemetry(events: EventInput[]): EventInput[] {
  return structuredClone(events).map((event) => {
    if (event.event_type === "budget.recorded") for (const name of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "stream", "timeBasis", "ownerTurnId", "telemetryDiagnostic"]) Reflect.deleteProperty(event.payload.entry, name);
    if (event.event_type === "model.completed") for (const name of ["cacheWriteTokens", "stream", "telemetryDiagnostic"]) Reflect.deleteProperty(event.payload.usage, name);
    return event;
  });
}

test("schema-17 accounting gains only provable category metadata without rewriting charges, prices or ciphertext history", { skip: process.platform !== "darwin" }, async (t) => {
  const fixture = await setupFixture({ legacySessionControlsJournal: true, workerPath: fileURLToPath(new URL("./fixtures/legacy-worker-83.ts", import.meta.url)), maxOutputTokens: 128, stream: { chunks: ["Generated ", "legacy ", "report."], delayMs: 25 },
    usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42, prompt_tokens_details: { cached_tokens: 10 } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const settings = structuredClone(sdk.settings.get()!.values);
    settings.notifications = { inApp: true, os: false, previewContent: false };
    settings.budgets.rates = [{ modelId: fixture.modelId, inputUsdPerMillion: 1, outputUsdPerMillion: 2, effectiveAt: new Date().toISOString().slice(0, 10), source: "user-estimate" }];
    await sdk.settings.update(settings, sdk.settings.get()!.revision);
    await sdk.budgets.policy({ basis: "estimate", tokens: 100000 }, 0, true);
    const commit = fixture.service.store.commit.bind(fixture.service.store);
    const mock = t.mock.method(fixture.service.store, "commit", (...args: Parameters<typeof commit>) => {
      args[0] = legacyTelemetry(args[0]);
      const derive = args[3]; if (derive) args[3] = (primary) => legacyTelemetry(derive(primary));
      return commit(...args);
    });
    await fixture.configure(); await fixture.send("Generated legacy category history."); await fixture.terminal(); mock.mock.restore();
    const before = (await sdk.budgets.status(fixture.sessionId)).status;
    assert.equal(before.totals.reportedTokens, 42); assert.equal(before.totals.estimatedUsd, 0.000054);
    assert.equal(fixture.service.controller.snapshot().budgetEntries[0]?.outputTokens, undefined);
    sdk.disconnect(); await writeLegacyState(fixture.service, 17);
    const previous = new DatabaseSync(fixture.service.store.path);
    const events = previous.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), receipts = previous.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all();
    const grants = previous.prepare("SELECT * FROM blob_payloads ORDER BY digest,scope").all(), keys = previous.prepare("SELECT * FROM retention_keys ORDER BY scope").all(); previous.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const current = await new MoguriSdk(restarted.connection).ready();
    try {
      assertCurrentSchema(restarted.store);
      assert.deepEqual(restarted.store.db.prepare("SELECT seq,id,data,payload FROM events WHERE seq<=? ORDER BY seq").all(Number(events.at(-1)!.seq)), events);
      assert.deepEqual(restarted.store.db.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all(), receipts);
      assert.deepEqual(restarted.store.db.prepare("SELECT * FROM blob_payloads ORDER BY digest,scope").all(), grants);
      assert.deepEqual(restarted.store.db.prepare("SELECT * FROM retention_keys ORDER BY scope").all(), keys);
      const entry = (await current.budgets.calls()).calls[0]!;
      assert.equal(entry.reportedTokens, 42); assert.equal(entry.estimatedUsdMicros, 54);
      assert.equal(entry.inputTokens, 30); assert.equal(entry.outputTokens, 12); assert.equal(entry.cacheReadTokens, 10);
      assert.equal(entry.cacheWriteTokens, null); assert.equal(entry.stream, null); assert.equal(entry.timeBasis, "admission");
      const after = (await current.budgets.status(fixture.sessionId)).status;
      assert.equal(after.remainingTokens, before.remainingTokens); assert.equal(after.totals.measuredStreamCalls, 0);
      assert.equal(fixture.requests.length, 1);
    } finally { current.disconnect(); }
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("a failed schema-18 marker leaves schema-17 data unchanged and reopenable without replay", async () => {
  const fixture = await setupFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await writeLegacyState(fixture.service, 17);
    const old = new DatabaseSync(fixture.service.store.path);
    const rows = old.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), receipts = old.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all();
    old.exec(`CREATE TRIGGER generated_stream_migration_failure BEFORE INSERT ON retention_metadata
      WHEN NEW.id='stream_telemetry_schema' BEGIN SELECT RAISE(ABORT,'Generated stream migration interruption'); END;`); old.close();
    const options = { stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey };
    await assert.rejects(() => startService(options), /Generated stream migration interruption/);
    const preserved = new DatabaseSync(fixture.service.store.path);
    try {
      assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 17);
      assert.deepEqual(preserved.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), rows);
      assert.deepEqual(preserved.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all(), receipts);
      assert.equal(preserved.prepare("SELECT id FROM retention_metadata WHERE id='stream_telemetry_schema'").get(), undefined);
      preserved.exec("DROP TRIGGER generated_stream_migration_failure");
    } finally { preserved.close(); }
    restarted = await startService(options); assertCurrentSchema(restarted.store);
    assert.equal(restarted.controller.snapshot().sessions[0]?.id, fixture.sessionId); assert.equal(fixture.requests.length, 0);
  } finally { await restarted?.close(); await fixture.close(); }
});

test("deleting source sessions and projects preserves independent measured calls and captured rates through restart", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ maxOutputTokens: 128, stream: { chunks: ["Generated ", "retained ", "timing."], delayMs: 25 } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await fixture.configure(); await fixture.send("Generated source-independent telemetry."); await fixture.terminal();
    const projectId = fixture.session().projectId, before = (await sdk.budgets.calls()).calls[0]!;
    assert.ok(before.stream?.streamMs); assert.equal(before.outputTokens, 12);
    await sdk.sessions.delete(fixture.sessionId, true);
    await sdk.refresh(); assert.equal(sdk.getState().snapshot!.sessionTelemetry[fixture.sessionId], undefined);
    const project = (await sdk.projects.configuration(projectId)).configuration;
    await sdk.projects.remove(projectId, true, project.revision);
    assert.deepEqual((await sdk.budgets.calls()).calls[0], before);
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const current = await new MoguriSdk(restarted.connection).ready();
    try {
      assert.equal(current.getState().snapshot!.sessions.length, 0); assert.equal(current.getState().snapshot!.projects.length, 0);
      assert.deepEqual(current.getState().snapshot!.sessionTelemetry, {});
      assert.deepEqual((await current.budgets.calls()).calls[0], before);
      const dashboard = await current.budgets.dashboard({ range: { kind: "days", days: 7 } });
      assert.equal(dashboard.totals.calls, 1); assert.equal(dashboard.totals.measuredStreamCalls, 1);
      assert.equal(fixture.requests.length, 1);
    } finally { current.disconnect(); }
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});
