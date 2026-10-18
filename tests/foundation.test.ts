import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { EventStore } from "../apps/service/src/store.ts";

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
    assert.equal(store.events()[0]?.payload.project.name, project.name);
    assert.equal(store.events(1).length, 0);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, 1);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
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
