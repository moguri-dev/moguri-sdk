import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION } from "../packages/protocol/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { removePost77FixtureMarkers, retainedCiphertextRows } from "./fixtures/legacy-state.ts";
import type { StoredEvent } from "../packages/protocol/src/index.ts";

const markers = ["queued_slash_schema", "project_folder_actions_schema", "sandbox_multi_root_schema"] as const;
const pathFor = (fixture: Awaited<ReturnType<typeof setupFixture>>) => join(fixture.directory, "state", "state.sqlite");
function metadata(db: DatabaseSync) {
  return { version: db.prepare("PRAGMA user_version").get()?.user_version,
    markers: db.prepare("SELECT id,value FROM retention_metadata ORDER BY id").all(), rows: retainedCiphertextRows(db) };
}
function genuinePredecessor(db: DatabaseSync, version: 76 | 77, events: readonly StoredEvent[]) {
  removePost77FixtureMarkers(db, events);
  if (version === 76) db.prepare("DELETE FROM retention_metadata WHERE id='model_selection_continuity_schema'").run();
  db.exec(`PRAGMA user_version=${version}`);
}

for (const version of [76, 77] as const) test(`genuine schema ${version} gains distinct workspace feature markers without changing retained ciphertext or receipts`, async () => {
  const fixture = await setupFixture();
  try {
    await fixture.service.close();
    const db = new DatabaseSync(pathFor(fixture)); genuinePredecessor(db, version, fixture.service.controller.events(0));
    const rows = retainedCiphertextRows(db); db.close();
    const store = new EventStore(pathFor(fixture), fixture.retentionKey);
    try {
      assert.equal(PROTOCOL_VERSION, 79); assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, 79);
      for (const id of [...markers, "model_selection_continuity_schema"]) assert.equal(store.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(id)?.value, "1");
      assert.deepEqual(retainedCiphertextRows(store.db), rows);
    } finally { store.close(); }
  } finally { await fixture.close(); }
});

test("standalone themes 78, unknown 78, theme-bearing current state and future 80 are refused before any mutation", async (t) => {
  for (const lineage of ["themes-78", "unknown-78", "themes-current", "future-80"] as const) await t.test(lineage, async () => {
    const fixture = await setupFixture();
    try {
      await fixture.service.close();
      const db = new DatabaseSync(pathFor(fixture));
      if (lineage.endsWith("78")) genuinePredecessor(db, 76, fixture.service.controller.events(0));
      if (lineage.startsWith("themes")) db.prepare("INSERT INTO retention_metadata(id,value) VALUES ('theme_catalog_schema','1')").run();
      if (lineage.endsWith("78")) db.exec("PRAGMA user_version=78");
      if (lineage === "future-80") db.exec("PRAGMA user_version=80");
      const before = metadata(db); db.close();
      assert.throws(() => new EventStore(pathFor(fixture), fixture.retentionKey), /theme|unsupported.*78|newer schema/i);
      const preserved = new DatabaseSync(pathFor(fixture));
      try { assert.deepEqual(metadata(preserved), before); } finally { preserved.close(); }
    } finally { await fixture.close(); }
  });
});

test("missing, corrupt and prematurely retained workspace markers cannot be repaired from a version number", async (t) => {
  for (const marker of markers) for (const defect of ["missing", "corrupt", "premature"] as const) await t.test(`${marker} ${defect}`, async () => {
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
    for (const id of markers) db.prepare("DELETE FROM retention_metadata WHERE id=?").run(id);
    db.exec("PRAGMA user_version=77");
    const before = metadata(db); db.close();
    assert.throws(() => new EventStore(pathFor(fixture), fixture.retentionKey), /workspace.*history|history.*workspace/i);
    const preserved = new DatabaseSync(pathFor(fixture));
    try { assert.deepEqual(metadata(preserved), before); } finally { preserved.close(); }
  } finally { await fixture.close(); }
});

test("workspace feature markers and schema 79 commit atomically when persistence fails", async () => {
  const fixture = await setupFixture();
  try {
    await fixture.service.close();
    const db = new DatabaseSync(pathFor(fixture)); genuinePredecessor(db, 77, fixture.service.controller.events(0));
    db.exec(`CREATE TRIGGER generated_workspace_marker_failure BEFORE INSERT ON retention_metadata
      WHEN NEW.id='sandbox_multi_root_schema' BEGIN SELECT RAISE(ABORT,'generated migration failure'); END;`);
    const before = metadata(db); db.close();
    assert.throws(() => new EventStore(pathFor(fixture), fixture.retentionKey), /generated migration failure/);
    const preserved = new DatabaseSync(pathFor(fixture));
    try { assert.deepEqual(metadata(preserved), before); preserved.exec("DROP TRIGGER generated_workspace_marker_failure"); } finally { preserved.close(); }
    const restarted = new EventStore(pathFor(fixture), fixture.retentionKey);
    try {
      assert.equal(restarted.db.prepare("PRAGMA user_version").get()?.user_version, 79);
      for (const id of markers) assert.equal(restarted.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(id)?.value, "1");
    } finally { restarted.close(); }
  } finally { await fixture.close(); }
});
