import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION, defaultSettings, projectEvents } from "../packages/protocol/src/index.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { assertPreContinuityHistory, assertPreThemeHistory, removePost77FixtureMarkers, removeWorkspaceFixtureMarkers, retainedCiphertextRows } from "./fixtures/legacy-state.ts";
import type { StoredEvent } from "../packages/protocol/src/index.ts";

const markers = ["queued_slash_schema", "project_folder_actions_schema", "sandbox_multi_root_schema"] as const;
const combinedMarker = "theme_model_workspace_convergence_schema";
const allMarkers = ["model_selection_continuity_schema", "theme_catalog_schema", ...markers, combinedMarker] as const;
const pathFor = (fixture: Awaited<ReturnType<typeof setupFixture>>) => join(fixture.directory, "state", "state.sqlite");
function metadata(db: DatabaseSync) {
  return { version: db.prepare("PRAGMA user_version").get()?.user_version,
    markers: db.prepare("SELECT id,value FROM retention_metadata ORDER BY id").all(), rows: retainedCiphertextRows(db) };
}
function genuinePredecessor(db: DatabaseSync, version: 76 | 77 | 78 | 79, events: readonly StoredEvent[]) {
  if (version < 78) removePost77FixtureMarkers(db, events);
  if (version === 78) removeWorkspaceFixtureMarkers(db, events);
  if (version === 76 || version === 78) {
    assertPreContinuityHistory(events);
    db.prepare("DELETE FROM retention_metadata WHERE id='model_selection_continuity_schema'").run();
  }
  if (version === 79) {
    assertPreThemeHistory(events);
    db.exec("DELETE FROM retention_metadata WHERE id IN ('theme_catalog_schema','theme_model_workspace_convergence_schema')");
  }
  db.exec(`PRAGMA user_version=${version}`);
}

for (const version of [76, 77, 78, 79] as const) test(`genuine schema ${version} converges to actual combined80 without changing retained ciphertext or receipts`, async () => {
  const fixture = await setupFixture();
  try {
    if (version === 78) {
      const sdk = await new MoguriSdk(fixture.service.connection).ready();
      try { await sdk.slash(fixture.sessionId, "/theme vaporwave light", "cli"); } finally { sdk.disconnect(); }
    }
    if (version === 79) fixture.service.store.commit([{ event_type: "project.folder_saved", profile_id: "default",
      payload: { folder: { id: "generated-real-79-folder", name: "Generated actual workspace feature", color: "#6366f1", revision: 0, order: 0 } } }]);
    await fixture.service.close();
    const db = new DatabaseSync(pathFor(fixture)); genuinePredecessor(db, version, fixture.service.controller.events(0));
    const rows = retainedCiphertextRows(db); db.close();
    const store = new EventStore(pathFor(fixture), fixture.retentionKey);
    try {
      assert.equal(PROTOCOL_VERSION, 80); assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, 80);
      for (const id of allMarkers) assert.equal(store.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(id)?.value, "1");
      assert.deepEqual(retainedCiphertextRows(store.db), rows);
      if (version === 78) assert.equal(projectEvents(store.events()).settings.values.appearance.palette, "vaporwave");
      if (version === 79) assert.equal(projectEvents(store.events()).projectFolders[0]?.color, "#6366f1");
    } finally { store.close(); }
  } finally { await fixture.close(); }
});

test("unknown, unmarked and falsely combined predecessor lineages and future81 are refused before any mutation", async (t) => {
  for (const lineage of ["unknown-78", "unmarked-77", "false-model-78", "false-theme-79", "future-81"] as const) await t.test(lineage, async () => {
    const fixture = await setupFixture();
    try {
      await fixture.service.close();
      const db = new DatabaseSync(pathFor(fixture));
      const events = fixture.service.controller.events(0);
      if (lineage === "unknown-78") { genuinePredecessor(db, 76, events); db.exec("PRAGMA user_version=78"); }
      if (lineage === "unmarked-77") { genuinePredecessor(db, 77, events); db.exec("DELETE FROM retention_metadata WHERE id='model_selection_continuity_schema'"); }
      if (lineage === "false-model-78") { genuinePredecessor(db, 78, events); db.exec("INSERT INTO retention_metadata(id,value) VALUES ('model_selection_continuity_schema','1')"); }
      if (lineage === "false-theme-79") { genuinePredecessor(db, 79, events); db.exec("INSERT INTO retention_metadata(id,value) VALUES ('theme_catalog_schema','1')"); }
      if (lineage === "future-81") db.exec("PRAGMA user_version=81");
      const before = metadata(db); db.close();
      assert.throws(() => new EventStore(pathFor(fixture), fixture.retentionKey), /schema marker|lineage|newer schema/i);
      const preserved = new DatabaseSync(pathFor(fixture));
      try { assert.deepEqual(metadata(preserved), before); } finally { preserved.close(); }
    } finally { await fixture.close(); }
  });
});

test("missing, corrupt and prematurely retained workspace markers cannot be repaired from a version number", async (t) => {
  for (const marker of [...markers, combinedMarker]) for (const defect of ["missing", "corrupt", "premature"] as const) await t.test(`${marker} ${defect}`, async () => {
    const fixture = await setupFixture();
    try {
      await fixture.service.close();
      const db = new DatabaseSync(pathFor(fixture));
      if (defect === "premature") db.exec("PRAGMA user_version=77");
      else if (defect === "missing") db.prepare("DELETE FROM retention_metadata WHERE id=?").run(marker);
      else db.prepare("UPDATE retention_metadata SET value='invalid-generated-marker' WHERE id=?").run(marker);
      const before = metadata(db); db.close();
      assert.throws(() => new EventStore(pathFor(fixture), fixture.retentionKey), /workspace.*marker|marker.*workspace|premature.*schema/i);
      const preserved = new DatabaseSync(pathFor(fixture));
      try { assert.deepEqual(metadata(preserved), before); } finally { preserved.close(); }
    } finally { await fixture.close(); }
  });
});

for (const profileId of ["default", "generated-unloaded-profile"]) test(`a forged downgrade with ${profileId} colored-folder history and erased markers cannot mint new provenance`, async () => {
  const fixture = await setupFixture();
  try {
    const view = profileId === "default" ? fixture.service.store : new EventStore(pathFor(fixture), fixture.retentionKey, "generated-workspace-key", profileId);
    view.commit([{ event_type: "project.folder_saved", profile_id: profileId,
      payload: { folder: { id: "generated-feature-bearing-folder", name: "Generated colored folder", color: "#6366f1", revision: 0, order: 0 } } }]);
    const original = metadata(view.db);
    assert.throws(() => removePost77FixtureMarkers(view.db, view.events()), /genuine pre-workspace-interaction/);
    assert.deepEqual(metadata(view.db), original);
    if (view !== fixture.service.store) view.close();
    await fixture.service.close();
    const db = new DatabaseSync(pathFor(fixture));
    for (const id of [...markers, "theme_catalog_schema", combinedMarker]) db.prepare("DELETE FROM retention_metadata WHERE id=?").run(id);
    db.exec("PRAGMA user_version=77");
    const before = metadata(db); db.close();
    assert.throws(() => new EventStore(pathFor(fixture), fixture.retentionKey), /workspace.*history|history.*workspace/i);
    const preserved = new DatabaseSync(pathFor(fixture));
    try { assert.deepEqual(metadata(preserved), before); } finally { preserved.close(); }
  } finally { await fixture.close(); }
});

for (const version of [76, 77, 78, 79] as const) test(`combined80 migration from genuine${version} commits every missing feature marker atomically`, async () => {
  const fixture = await setupFixture();
  try {
    await fixture.service.close();
    const db = new DatabaseSync(pathFor(fixture)); genuinePredecessor(db, version, fixture.service.controller.events(0));
    db.exec(`CREATE TRIGGER generated_workspace_marker_failure BEFORE INSERT ON retention_metadata
      WHEN NEW.id='theme_model_workspace_convergence_schema' BEGIN SELECT RAISE(ABORT,'generated migration failure'); END;`);
    const before = metadata(db); db.close();
    assert.throws(() => new EventStore(pathFor(fixture), fixture.retentionKey), /generated migration failure/);
    const preserved = new DatabaseSync(pathFor(fixture));
    try { assert.deepEqual(metadata(preserved), before); preserved.exec("DROP TRIGGER generated_workspace_marker_failure"); } finally { preserved.close(); }
    const restarted = new EventStore(pathFor(fixture), fixture.retentionKey);
    try {
      assert.equal(restarted.db.prepare("PRAGMA user_version").get()?.user_version, 80);
      for (const id of allMarkers) assert.equal(restarted.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(id)?.value, "1");
    } finally { restarted.close(); }
  } finally { await fixture.close(); }
});

test("genuine77 command inspections remain ordinary retained history, not future slash-command intent", async () => {
  const fixture = await setupFixture();
  try {
    const jobId = "generated-legacy-inspected-command", common = { profile_id: "default", session_id: fixture.sessionId, project_id: fixture.session().projectId };
    fixture.service.store.commit([
      { ...common, event_type: "job.started", payload: { job: { id: jobId, kind: "command.watch", sessionId: fixture.sessionId, projectId: fixture.session().projectId,
        parentTurnId: "generated-legacy-turn", status: "running", progress: "Generated predecessor command", resultDigest: null, error: null,
        commandJob: { root: fixture.project, command: "generated retained command", timeoutMs: 1000, callId: "generated-legacy-call", env: "Local" } } } },
      { ...common, event_type: "job.finished", payload: { jobId, status: "partial", resultDigest: null, error: "Generated predecessor interruption" } },
      { ...common, event_type: "command.inspected", payload: { jobId, root: fixture.project, actor: "user" } },
    ]);
    const events = fixture.service.store.events(); await fixture.service.close();
    const raw = new DatabaseSync(pathFor(fixture)); genuinePredecessor(raw, 77, events);
    const before = retainedCiphertextRows(raw); raw.close();
    const recovered = new EventStore(pathFor(fixture), fixture.retentionKey);
    try {
      assert.deepEqual(retainedCiphertextRows(recovered.db), before);
      assert.equal(projectEvents(recovered.events()).jobs.find((job) => job.id === jobId)?.commandJob?.inspected, true);
    } finally { recovered.close(); }
  } finally { await fixture.close(); }
});

for (const feature of ["theme", "model"] as const) for (const profileId of ["default", "generated-unloaded-profile"]) {
  test(`missing ${feature} provenance cannot be minted over actual ${profileId} feature history`, async () => {
    const fixture = await setupFixture();
    try {
      const view = profileId === "default" ? fixture.service.store : new EventStore(pathFor(fixture), fixture.retentionKey, "generated-cross-lineage-key", profileId);
      const settings = defaultSettings();
      if (feature === "theme") settings.appearance = { theme: "light", palette: "rose" };
      else settings.startup.profile = { preferredThinkingEffort: "max" };
      view.commit([{ event_type: "settings.updated", profile_id: profileId, payload: { settings, revision: 1, permissionRevision: 0 } }]);
      assert.throws(() => feature === "theme" ? assertPreThemeHistory(view.events()) : assertPreContinuityHistory(view.events()), /genuine pre-/);
      if (view !== fixture.service.store) view.close();
      await fixture.service.close();
      const raw = new DatabaseSync(pathFor(fixture));
      const erased = feature === "theme" ? ["theme_catalog_schema", combinedMarker] : ["model_selection_continuity_schema", ...markers, combinedMarker];
      for (const id of erased) raw.prepare("DELETE FROM retention_metadata WHERE id=?").run(id);
      raw.exec(feature === "theme" ? "PRAGMA user_version=79" : "PRAGMA user_version=78");
      const before = metadata(raw); raw.close();
      assert.throws(() => new EventStore(pathFor(fixture), fixture.retentionKey), feature === "theme" ? /theme history.*original catalogue marker/i : /effort preference history.*original continuity marker/i);
      const preserved = new DatabaseSync(pathFor(fixture));
      try { assert.deepEqual(metadata(preserved), before); } finally { preserved.close(); }
    } finally { await fixture.close(); }
  });
}
