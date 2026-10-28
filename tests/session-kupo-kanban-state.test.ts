import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { EventStore } from "../apps/service/src/store.ts";
import { defaultSingleKupoSettings, MoguriSdk, PROTOCOL_VERSION, projectEvents } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { appendLegacyAutopilot, retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";

const mergedMarker = "session_kupo_kanban_schema";
const workflowMarkers = ["session_github_workflows_schema", "session_github_convergence_schema"];

for (const lineage of ["automatic-61", "workflows-61", "kanban-62"] as const) {
  test(`actual ${lineage} markers converge atomically without rewriting consent, settings, ciphertext or receipts`, async () => {
    const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), path = fixture.service.store.path;
    let store: EventStore | undefined;
    try {
      const policy = { ...defaultSingleKupoSettings(), classifierModelId: fixture.modelId };
      await sdk.routing.configure(policy, sdk.settings.get()!.revision);
      if (lineage === "automatic-61") appendLegacyAutopilot(fixture.service, fixture.sessionId);
      else await sdk.sessions.autonomy(fixture.sessionId, "Autopilot");
      if (lineage === "kanban-62") {
        await sdk.kanban.open(fixture.session().projectId!);
        const board = (await sdk.issues.board(fixture.session().projectId!)).board;
        await sdk.issues.configure(board.projectId, { ...board, kanban: { visible: false, source: "github-issues", phaseIds: ["backlog"] } }, board.revision);
      }
      await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision,
        text: `Generated original ${lineage} draft.`, attachments: [] }, `generated-${lineage}-draft`);
      const events = fixture.service.store.events(), rows = retainedCiphertextRows(fixture.service.store.db);
      sdk.disconnect(); await fixture.service.close();
      const raw = new DatabaseSync(path), version = lineage === "kanban-62" ? 62 : 61;
      let markers: Record<string, SQLOutputValue>[];
      try {
        const removed = ["native_web_policy_schema", "chat_home_schema", "model_preferences_schema", "composer_workflows_schema", "side_context_schema", "retained_telemetry_schema", "session_reliability_schema", "kanban_interactions_schema", mergedMarker, ...(lineage === "automatic-61" ? workflowMarkers : ["automatic_kupo_schema"]),
          ...(lineage === "kanban-62" ? [] : ["project_kanban_schema"])];
        for (const id of removed) raw.prepare("DELETE FROM retention_metadata WHERE id=?").run(id);
        raw.exec(`PRAGMA user_version=${version}`);
        markers = raw.prepare("SELECT id,value FROM retention_metadata ORDER BY id").all();
        raw.exec(`CREATE TRIGGER generated_convergence_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='${mergedMarker}' BEGIN SELECT RAISE(ABORT,'Generated convergence interruption'); END`);
      } finally { raw.close(); }
      assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated convergence interruption/);
      const interrupted = new DatabaseSync(path);
      try {
        assert.equal(interrupted.prepare("PRAGMA user_version").get()?.user_version, version);
        assert.deepEqual(interrupted.prepare("SELECT id,value FROM retention_metadata ORDER BY id").all(), markers);
        assert.deepEqual(retainedCiphertextRows(interrupted), rows);
        interrupted.exec("DROP TRIGGER generated_convergence_failure");
      } finally { interrupted.close(); }
      store = new EventStore(path, fixture.retentionKey);
      assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
      for (const id of [mergedMarker, ...workflowMarkers, "automatic_kupo_schema", "project_kanban_schema"]) {
        assert.equal(store.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(id)?.value, "1");
      }
      assert.deepEqual(store.events(), events); assert.deepEqual(retainedCiphertextRows(store.db), rows);
      const state = projectEvents(store.events()), session = state.sessions.find((entry) => entry.id === fixture.sessionId)!;
      assert.equal(session.controls.automaticApprovals, lineage === "automatic-61" ? undefined : true);
      assert.equal(session.draft.text, `Generated original ${lineage} draft.`);
      assert.deepEqual(state.settings.values.kupo, policy);
      store.close(); store = new EventStore(path, fixture.retentionKey);
      assert.deepEqual(store.events(), events); assert.deepEqual(retainedCiphertextRows(store.db), rows);
      assert.equal(fixture.requests.length, 0);
    } finally { sdk.disconnect(); store?.close(); await fixture.close(); }
  });
}

test("an interrupted upgrade from schema 60 retains a complete intermediate lineage that can reopen safely", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let store: EventStore | undefined;
  try {
    const rows = retainedCiphertextRows(fixture.service.store.db);
    await writeLegacyState(fixture.service, 60);
    const raw = new DatabaseSync(path);
    try {
      raw.exec(`CREATE TRIGGER generated_intermediate_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='${mergedMarker}' BEGIN SELECT RAISE(ABORT,'Generated intermediate interruption'); END`);
    } finally { raw.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated intermediate interruption/);
    const interrupted = new DatabaseSync(path);
    try {
      assert.equal(interrupted.prepare("PRAGMA user_version").get()?.user_version, 61);
      for (const id of [...workflowMarkers, "automatic_kupo_schema"]) assert.equal(interrupted.prepare("SELECT value FROM retention_metadata WHERE id=?").get(id)?.value, "1");
      for (const id of [mergedMarker, "project_kanban_schema"]) assert.equal(interrupted.prepare("SELECT value FROM retention_metadata WHERE id=?").get(id), undefined);
      assert.deepEqual(retainedCiphertextRows(interrupted), rows);
      interrupted.exec("DROP TRIGGER generated_intermediate_failure");
    } finally { interrupted.close(); }
    store = new EventStore(path, fixture.retentionKey);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(store.db), rows);
    assert.equal(fixture.requests.length, 0);
  } finally { store?.close(); await fixture.close(); }
});

test("schema 62 cannot manufacture a missing workflow lineage from the unrelated automatic Kupo marker", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  try {
    await fixture.service.close();
    const raw = new DatabaseSync(path);
    try {
      for (const id of ["native_web_policy_schema", "chat_home_schema", "model_preferences_schema", "composer_workflows_schema", "side_context_schema", "retained_telemetry_schema", "session_reliability_schema", "kanban_interactions_schema", mergedMarker, ...workflowMarkers]) raw.prepare("DELETE FROM retention_metadata WHERE id=?").run(id);
      raw.exec("PRAGMA user_version=62");
    } finally { raw.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Invalid schema-62.*lineage/);
    const preserved = new DatabaseSync(path);
    try {
      assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 62);
      for (const id of workflowMarkers) assert.equal(preserved.prepare("SELECT value FROM retention_metadata WHERE id=?").get(id), undefined);
    } finally { preserved.close(); }
  } finally { await fixture.close(); }
});

test("current convergence markers cannot be silently repaired or relabelled as either older lineage", async (t) => {
  for (const sql of [
    `DELETE FROM retention_metadata WHERE id='${mergedMarker}'`,
    `UPDATE retention_metadata SET value='0' WHERE id='${mergedMarker}'`,
    "PRAGMA user_version=61",
    "PRAGMA user_version=62",
  ]) await t.test(sql, async () => {
    const fixture = await setupFixture(), path = fixture.service.store.path;
    try {
      await fixture.service.close();
      const raw = new DatabaseSync(path);
      let rows: ReturnType<typeof retainedCiphertextRows>;
      try {
        if (sql.startsWith("PRAGMA")) raw.exec("DELETE FROM retention_metadata WHERE id IN ('native_web_policy_schema','chat_home_schema','model_preferences_schema','composer_workflows_schema','side_context_schema','retained_telemetry_schema','session_reliability_schema','kanban_interactions_schema')");
        raw.exec(sql); rows = retainedCiphertextRows(raw);
      } finally { raw.close(); }
      assert.throws(() => new EventStore(path, fixture.retentionKey), /session\/Kupo\/Kanban.*(marker|lineage)|pre-63/);
      const preserved = new DatabaseSync(path);
      try { assert.deepEqual(retainedCiphertextRows(preserved), rows); } finally { preserved.close(); }
    } finally { await fixture.close(); }
  });
});
