import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { MoguriSdk, KUPO_MODEL_ID, defaultKupoSettings, type BudgetEntry, type RoutingTurn } from "../packages/sdk/src/index.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture } from "./fixture.ts";
import { profileFixture } from "./fixtures/profiles.ts";
import { writeLegacyState } from "./fixtures/legacy-state.ts";

test("schema 15 preserves both profiles' ciphertexts, receipts and retained grants while routing starts disabled", async () => {
  const fixture = await profileFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const { client: beta, profile } = await fixture.create("Generated routing migration Beta");
    const first = await fixture.sdk.sessions.create(null, "Generated Default routing migration"), second = await beta.sessions.create(null, "Generated Beta routing migration");
    const artifact = await beta.artifacts.create(second.id!, { kind: "decision", name: "Generated old routing note", text: "Generated unchanged retained routing bytes." });
    for (const id of ["default", profile.id]) {
      const control = await fixture.service.profiles.control(id), settings = structuredClone(control.snapshot().settings);
      Reflect.deleteProperty(settings.values, "kupo");
      control.store.commit([{ event_type: "settings.updated", profile_id: id, payload: { settings: settings.values, revision: settings.revision + 1, permissionRevision: settings.permissionRevision } }]);
    }
    for (const client of fixture.clients) client.disconnect();
    await writeLegacyState(fixture.service, 15);
    const legacy = new DatabaseSync(fixture.service.store.path);
    const rows = legacy.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), receipts = legacy.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all();
    const blobs = legacy.prepare("SELECT * FROM blob_payloads ORDER BY digest,scope").all(), keys = legacy.prepare("SELECT * FROM retention_keys ORDER BY scope").all();
    legacy.close();
    restarted = await startService(fixture.options);
    const current = await new MoguriSdk(restarted.connection).ready(), scoped = await current.profiles.open(profile.id);
    try {
      assert.equal(restarted.store.db.prepare("PRAGMA user_version").get()?.user_version, 17);
      assert.deepEqual(restarted.store.db.prepare("SELECT seq,id,data,payload FROM events WHERE seq<=? ORDER BY seq").all(Number(rows.at(-1)!.seq)), rows);
      assert.deepEqual(restarted.store.db.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all(), receipts);
      assert.deepEqual(restarted.store.db.prepare("SELECT * FROM blob_payloads ORDER BY digest,scope").all(), blobs);
      assert.deepEqual(restarted.store.db.prepare("SELECT * FROM retention_keys ORDER BY scope").all(), keys);
      assert.equal(current.getState().snapshot!.sessions[0]?.id, first.id); assert.equal(scoped.getState().snapshot!.sessions[0]?.id, second.id);
      for (const client of [current, scoped]) {
        assert.deepEqual(client.routing.policy(), defaultKupoSettings()); assert.deepEqual(client.getState().snapshot!.routings, []);
        assert.equal(client.getState().snapshot!.provider.models.some((model) => model.synthetic), false);
      }
      assert.equal((await scoped.artifacts.read(artifact.id!)).text, "Generated unchanged retained routing bytes.");
      assert.equal(fixture.providers.reduce((sum, provider) => sum + provider.requests.length, 0), 0);
    } finally { current.disconnect(); scoped.disconnect(); }
  } finally { await restarted?.close(); await fixture.close(); }
});

test("failed schema-16 routing migration reopens unchanged schema-15 history and receipts", async () => {
  const fixture = await setupFixture();
  let upgraded: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await writeLegacyState(fixture.service, 15);
    const legacy = new DatabaseSync(fixture.service.store.path);
    const rows = legacy.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), receipts = legacy.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all();
    legacy.exec(`CREATE TRIGGER generated_routing_migration_failure BEFORE INSERT ON retention_metadata
      WHEN NEW.id='single_routing_schema' BEGIN SELECT RAISE(ABORT,'Generated routing migration interruption'); END;`);
    legacy.close();
    const options = { stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey };
    await assert.rejects(() => startService(options), /Generated routing migration interruption/);
    const preserved = new DatabaseSync(fixture.service.store.path);
    try {
      assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 15);
      assert.deepEqual(preserved.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), rows);
      assert.deepEqual(preserved.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all(), receipts);
      assert.equal(preserved.prepare("SELECT id FROM retention_metadata WHERE id='single_routing_schema'").get(), undefined);
      preserved.exec("DROP TRIGGER generated_routing_migration_failure");
    } finally { preserved.close(); }
    upgraded = await startService(options);
    assert.equal(upgraded.store.db.prepare("PRAGMA user_version").get()?.user_version, 17);
    assert.equal(upgraded.controller.snapshot().sessions[0]?.id, fixture.sessionId); assert.equal(fixture.requests.length, 0);
  } finally { await upgraded?.close(); await fixture.close(); }
});

test("restart marks interrupted router/solver receipts partial, holds their reservations and never replays saved work", async () => {
  for (const role of ["router", "solver"] as const) {
    const fixture = await setupFixture({ maxOutputTokens: 128 });
    let restarted: Awaited<ReturnType<typeof startService>> | undefined;
    try {
      const policy = { ...defaultKupoSettings(), enabled: true, classifierModelId: fixture.modelId, approvedModelIds: [fixture.modelId], allowHosted: true };
      const settings = structuredClone(fixture.service.controller.snapshot().settings.values); settings.kupo = policy;
      const current = fixture.session(), controls = { ...current.controls, modelId: KUPO_MODEL_ID }, turnId = randomUUID(), stepId = randomUUID();
      const scope = { profile_id: "default", project_id: current.projectId, session_id: current.id, turn_id: turnId };
      const routing: RoutingTurn = { id: turnId, sessionId: current.id, projectId: current.projectId, turnId, env: "Local", createdAt: "2026-01-01T00:00:00Z",
        settingsRevision: 1, permissionRevision: 1, policyRevision: 0, policyDigest: "generated-retained-policy", contextDigest: "generated-retained-context",
        classifierModelId: fixture.modelId, candidateModelIds: [fixture.modelId], policy, status: "planning", classifierStepId: stepId, plan: null, diagnostic: null };
      const entry: BudgetEntry = { id: stepId, sessionId: current.id, ownerSessionId: current.id, projectId: current.projectId, folderId: null,
        turnId, modelId: fixture.modelId, providerId: "generated-provider", apiModelId: fixture.modelId, role, env: "Local", createdAt: routing.createdAt,
        imported: false, status: "reserved", inputEstimate: 9, outputLimit: 128, reservedTokens: 137, reportedTokens: null, reservedUsdMicros: null,
        estimatedUsdMicros: null, rate: null, requestMs: 0, outcome: "running", diagnostic: null };
      await fixture.service.close();
      const store = new EventStore(fixture.service.store.path, fixture.retentionKey);
      try {
        store.commit([
          { event_type: "settings.updated", profile_id: "default", payload: { settings, revision: 1, permissionRevision: 1 } },
          { ...scope, event_type: "turn.started", payload: { item: { id: randomUUID(), text: "Generated interrupted routing task.", attachments: [], delivery: "queue" }, controls, policyRevision: 0 } },
          { ...scope, event_type: "routing.started", payload: { routing } },
          ...(role === "solver" ? [{ ...scope, event_type: "routing.planned" as const, payload: { routingId: turnId, classifierStepId: randomUUID(), plan: { pattern: "single" as const, modelId: fixture.modelId, confidence: 0.95, reason: "Generated retained solver plan." } } }] : []),
          { event_type: "budget.recorded", profile_id: "default", payload: { entry } },
          { ...scope, step_id: stepId, event_type: "model.started", payload: { modelId: fixture.modelId, role } },
          { ...scope, event_type: "queue.enqueued", payload: { item: { id: "generated-held-after-routing", text: "Generated preserved queue.", attachments: [], delivery: "queue" } } },
        ]);
      } finally { store.close(); }
      restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
      const sdk = await new MoguriSdk(restarted.connection).ready();
      try {
        const snapshot = sdk.getState().snapshot!, session = snapshot.sessions.find((session) => session.id === current.id)!;
        assert.equal(session.turnId, null); assert.equal(session.queue[0]?.id, "generated-held-after-routing");
        assert.equal(snapshot.routings[0]?.status, "partial"); assert.match(snapshot.routings[0]!.diagnostic!, /restarted|replay/i);
        assert.equal(snapshot.budgetEntries[0]?.role, role); assert.equal(snapshot.budgetEntries[0]?.status, "unknown");
        assert.equal((await sdk.budgets.status(current.id)).status.totals.heldTokens, 137);
        assert.equal(session.usage[0]?.quality, "unknown"); assert.equal(fixture.requests.length, 0);
        assert.equal(restarted.controller.events(0).some((event) => event.event_type === "tool.started"), false);
      } finally { sdk.disconnect(); }
    } finally { await restarted?.close(); await fixture.close(); }
  }
});
