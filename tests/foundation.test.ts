import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { projectEvents } from "../packages/protocol/src/index.ts";

test("events and command receipts commit together, replay, and cannot be mutated", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-foundation-"));
  const path = join(directory, "state.sqlite");
  let store = new EventStore(path);
  try {
    const project = { id: "generated-project", name: "Generated project", path: directory };
    store.commit([{ event_type: "project.added", profile_id: "default", project_id: project.id, payload: { project } }], {
      id: "generated-command", digest: "generated-digest", result: { id: project.id },
    });
    assert.equal(store.events().length, 1);
    assert.deepEqual(store.receipt("generated-command", "generated-digest"), { id: project.id });
    assert.throws(() => store.receipt("generated-command", "different"), /reused/);
    assert.throws(() => store.db.exec("UPDATE events SET payload = '{}'"), /append.only/);
    assert.throws(() => store.db.exec("DELETE FROM events"), /append.only/);
    store.close();
    store = new EventStore(path);
    const restored = store.events()[0];
    assert.equal(restored?.event_type, "project.added");
    if (restored?.event_type === "project.added") assert.equal(restored.payload.project.name, project.name);
    assert.equal(store.events(1).length, 0);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, 1);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the default profile never projects another profile's project or session", () => {
  const store = new EventStore(":memory:");
  try {
    store.commit([
      { event_type: "project.added", profile_id: "generated-other-profile", project_id: "other", payload: { project: { id: "other", name: "generated private project", path: "/generated/private" } } },
      { event_type: "project.added", profile_id: "default", project_id: "default", payload: { project: { id: "default", name: "generated visible project", path: "/generated/visible" } } },
    ]);
    assert.deepEqual(projectEvents(store.events()).projects.map((project) => project.id), ["default"]);
  } finally { store.close(); }
});

test("a newer durable schema is refused without resetting user data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-migration-"));
  try {
    const path = join(directory, "state.sqlite");
    const db = new DatabaseSync(path);
    db.exec("PRAGMA user_version=999; CREATE TABLE preserved (value TEXT); INSERT INTO preserved VALUES ('generated')");
    db.close();
    assert.throws(() => new EventStore(path), /newer/);
    const reopened = new DatabaseSync(path);
    assert.equal(reopened.prepare("SELECT value FROM preserved").get()?.value, "generated");
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
