import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { request } from "node:http";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk, PROTOCOL_VERSION, projectEvents } from "../packages/sdk/src/index.ts";
import { reviewNativeTools, setupFixture, waitFor } from "./fixture.ts";
import { appendLegacyAutopilot, removePost77FixtureMarkers, retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";

for (const version of [73, 74]) test(`the new service preserves schema-${version} ciphertext, events and website grants`, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let reopened: EventStore | undefined;
  try {
    await sdk.webAllowlist.add("generated.example.invalid", { kind: "session", sessionId: fixture.sessionId });
    const original = retainedCiphertextRows(fixture.service.store.db), events = fixture.service.store.events(), path = fixture.service.store.path;
    sdk.disconnect(); await fixture.service.close();
    const previous = new DatabaseSync(path);
    try { removePost77FixtureMarkers(previous, events); previous.exec(`DELETE FROM retention_metadata WHERE id='model_selection_continuity_schema'; PRAGMA user_version=${version};`); } finally { previous.close(); }
    reopened = new EventStore(path, fixture.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original); assert.deepEqual(reopened.events(), events);
    assert.equal(projectEvents(reopened.events()).settings.values.permissions.webAllowlist?.[0]?.site, "generated.example.invalid");
    reopened.close(); reopened = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original); assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); reopened?.close(); await fixture.close(); }
});

test("schema 58 upgrades without changing ciphertext or silently broadening saved Autopilot permissions", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let store: EventStore | undefined;
  try {
    appendLegacyAutopilot(fixture.service, fixture.sessionId);
    const before = retainedCiphertextRows(fixture.service.store.db), path = fixture.service.store.path;
    sdk.disconnect(); await writeLegacyState(fixture.service, 58);
    store = new EventStore(path, fixture.retentionKey);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.equal(store.db.prepare("SELECT value FROM retention_metadata WHERE id='session_github_workflows_schema'").get()?.value, "1");
    assert.deepEqual(retainedCiphertextRows(store.db), before);
    const projected = projectEvents(store.events());
    assert.equal(projected.sessions[0]?.controls.autonomy, "Autopilot");
    assert.equal(projected.sessions[0]?.controls.automaticApprovals, undefined);
    assert.equal(projected.settings.values.permissions.remembered, undefined);
    const events = store.events(); store.close(); store = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(store.events(), events); assert.deepEqual(retainedCiphertextRows(store.db), before);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); store?.close(); await fixture.close(); }
});

test("quiesced service shutdown closes an admitted unfinished HTTP body without executing or replaying it", async () => {
  const fixture = await setupFixture();
  const pending = request(new URL("/v1/commands", fixture.service.connection.baseUrl), { method: "POST",
    headers: { Authorization: `Bearer ${fixture.service.connection.token}`, "Content-Type": "application/json", "Content-Length": "1024", Expect: "100-continue" } });
  const errors: Error[] = []; pending.on("error", (error) => errors.push(error));
  let closing: Promise<void> | undefined, deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const admitted = new Promise<void>((resolve) => pending.once("continue", resolve)); pending.flushHeaders(); await admitted;
    pending.write("{");
    const before = fixture.service.controller.events(0).length;
    closing = fixture.service.close();
    const completed = await Promise.race([closing.then(() => true), new Promise<false>((resolve) => { deadline = setTimeout(() => resolve(false), 3000); })]);
    assert.equal(completed, true, "An incomplete client body cannot hold an otherwise quiesced service and registry open.");
    assert.equal(fixture.service.controller.events(0).length, before);
    assert.equal(fixture.requests.length, 0);
    assert.ok(errors.every((error) => "code" in error && error.code === "ECONNRESET"));
  } finally { clearTimeout(deadline); pending.destroy(); await closing; await fixture.close(); }
});

test("an interrupted schema-60 workflow migration rolls back and keeps original encrypted rows", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let store: EventStore | undefined;
  try {
    const before = retainedCiphertextRows(fixture.service.store.db);
    await writeLegacyState(fixture.service, 60);
    const original = new DatabaseSync(path);
    original.exec("CREATE TRIGGER generated_workflow_migration BEFORE INSERT ON retention_metadata WHEN NEW.id='session_github_workflows_schema' BEGIN SELECT RAISE(ABORT,'Generated workflow migration interruption'); END"); original.close();
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated workflow migration interruption/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 60);
      assert.deepEqual(retainedCiphertextRows(failed), before);
      failed.exec("DROP TRIGGER generated_workflow_migration");
    } finally { failed.close(); }
    store = new EventStore(path, fixture.retentionKey);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
  } finally { store?.close(); await fixture.close(); }
});

async function privateWorkflow59Fixture() {
  const fixture = await setupFixture(), session = fixture.session();
  fixture.service.store.commit([{ event_type: "session.configured", profile_id: "default", session_id: session.id,
    project_id: session.projectId, payload: { controls: { ...session.controls, autonomy: "Autopilot", automaticApprovals: true } } }]);
  fixture.service.controller.refreshProfile();
  await fixture.service.close();
  const raw = new DatabaseSync(fixture.service.store.path);
  try {
    removePost77FixtureMarkers(raw, fixture.service.controller.events(0));
    raw.exec("BEGIN IMMEDIATE; DELETE FROM retention_metadata WHERE id IN ('model_selection_continuity_schema','native_web_policy_schema','chat_home_schema','model_preferences_schema','composer_workflows_schema','side_context_schema','retained_telemetry_schema','session_reliability_schema','kanban_interactions_schema','session_kupo_kanban_schema','automatic_kupo_schema','project_kanban_schema','workspace_experience_schema','session_navigation_schema','session_github_convergence_schema'); PRAGMA user_version=59; COMMIT;");
  } finally { raw.close(); }
  return fixture;
}

test("the exact private approval schema-59 lineage converges atomically without rewriting actual consent", async () => {
  const fixture = await privateWorkflow59Fixture(), path = fixture.service.store.path;
  let store: EventStore | undefined;
  try {
    const raw = new DatabaseSync(path), before = retainedCiphertextRows(raw); raw.close();
    store = new EventStore(path, fixture.retentionKey);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.equal(projectEvents(store.events()).sessions[0]?.controls.automaticApprovals, true);
    for (const marker of ["workspace_experience_schema", "session_navigation_schema", "session_github_workflows_schema", "session_github_convergence_schema"]) {
      assert.equal(store.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker)?.value, "1");
    }
    assert.deepEqual(retainedCiphertextRows(store.db), before);
  } finally { store?.close(); await fixture.close(); }
});

test("private approval schema-59 convergence failure rolls back every new marker and preserves encrypted history", async () => {
  const fixture = await privateWorkflow59Fixture(), path = fixture.service.store.path;
  try {
    const raw = new DatabaseSync(path), before = retainedCiphertextRows(raw), markers = raw.prepare("SELECT id,value FROM retention_metadata ORDER BY id").all();
    raw.exec("CREATE TRIGGER generated_workflow_convergence_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='session_navigation_schema' BEGIN SELECT RAISE(ABORT,'Generated workflow convergence interruption'); END"); raw.close();
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated workflow convergence interruption/);
    const preserved = new DatabaseSync(path);
    try {
      assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 59);
      assert.deepEqual(preserved.prepare("SELECT id,value FROM retention_metadata ORDER BY id").all(), markers);
      assert.deepEqual(retainedCiphertextRows(preserved), before);
    } finally { preserved.close(); }
  } finally { await fixture.close(); }
});

test("an ambiguous schema-59 lineage is refused without repairing or rewriting retained state", async () => {
  const fixture = await privateWorkflow59Fixture(), path = fixture.service.store.path;
  try {
    const raw = new DatabaseSync(path), before = retainedCiphertextRows(raw);
    raw.exec("INSERT INTO retention_metadata(id,value) VALUES ('workspace_experience_schema','1')"); raw.close();
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Invalid pre-61.*lineage/);
    const preserved = new DatabaseSync(path);
    try { assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 59); assert.deepEqual(retainedCiphertextRows(preserved), before); }
    finally { preserved.close(); }
  } finally { await fixture.close(); }
});

test("current workflow schemas reject missing or corrupted consent metadata without resetting state", async (t) => {
  for (const sql of ["DELETE FROM retention_metadata WHERE id='session_github_workflows_schema'", "UPDATE retention_metadata SET value='0' WHERE id='session_github_workflows_schema'",
    "DELETE FROM retention_metadata WHERE id='session_github_convergence_schema'"]) await t.test(sql, async () => {
    const fixture = await setupFixture(), path = fixture.service.store.path;
    try {
      const before = retainedCiphertextRows(fixture.service.store.db); await fixture.service.close();
      const raw = new DatabaseSync(path); raw.exec(sql); raw.close();
      assert.throws(() => new EventStore(path, fixture.retentionKey), /session\/GitHub workflow schema marker/);
      const preserved = new DatabaseSync(path);
      try { assert.deepEqual(retainedCiphertextRows(preserved), before); } finally { preserved.close(); }
    } finally { await fixture.close(); }
  });
});

test("remembered approvals and explicit automatic consent survive an actual service restart without replay", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, restored: MoguriSdk | undefined;
  try {
    await reviewNativeTools(fixture, ["read_file"]);
    await fixture.configure(); await fixture.send("generated tool before restart");
    const pending = await waitFor(() => fixture.session().pendingApproval);
    await sdk.approvals.respond(fixture.sessionId, pending.id, true, { scope: "project", match: "exact" });
    await fixture.terminal(); await sdk.refresh();
    await sdk.sessions.autonomy(fixture.sessionId, "Autopilot");
    const grants = sdk.approvals.list(), requests = fixture.requests.length;
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), retentionKey: fixture.retentionKey, provider: fixture.provider,
      platform: { terminal: { vault: fixture.terminalVault } } });
    restored = await new MoguriSdk(restarted.connection).ready();
    assert.deepEqual(restored.approvals.list(), grants);
    const session = restored.getState().snapshot!.sessions.find((entry) => entry.id === fixture.sessionId)!;
    assert.equal(session.controls.automaticApprovals, true); assert.equal(session.turnId, null); assert.equal(fixture.requests.length, requests);
    await restored.command({ type: "draft.save", sessionId: session.id, expectedRevision: session.draft.revision, text: "generated tool after restart", attachments: [] });
    await restored.command({ type: "message.send", sessionId: session.id, expectedRevision: session.draft.revision + 1, delivery: "queue" });
    await waitFor(() => restarted!.controller.snapshot().sessions.find((entry) => entry.id === session.id)?.status === "completed");
    assert.equal(fixture.requests.length, requests + 2);
  } finally { sdk.disconnect(); restored?.disconnect(); await restarted?.close(); await fixture.close(); }
});
