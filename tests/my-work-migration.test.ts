import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore, myWorkSchemaMarker, backgroundServiceSchemaMarker } from "../apps/service/src/store.ts";
import { factoryControls, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { myWorkFixture } from "./my-work-fixture.ts";

const retained = (db: DatabaseSync) => ({
  events: db.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(),
  keys: db.prepare("SELECT scope,payload FROM retention_keys ORDER BY scope").all(),
  blobs: db.prepare("SELECT scope,digest,payload FROM blob_payloads ORDER BY scope,digest").all(),
  receipts: db.prepare("SELECT profile_id,id,digest,result FROM receipts ORDER BY profile_id,id").all(),
});
test("genuine94 inbox migration is atomic and preserves encrypted original events, grants and receipts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-my-work-migration-")), path = join(directory, "state.sqlite"), key = Buffer.alloc(32, 0x73);
  let reopened: EventStore | undefined;
  try {
    const store = new EventStore(path, key), content = store.putBlob("Generated original SDK context.");
    store.commit([{ event_type: "session.created", profile_id: "default", session_id: "generated-original",
      payload: { title: "Generated original inbox migration", controls: factoryControls() } },
    { event_type: "draft.saved", profile_id: "default", session_id: "generated-original", payload: { text: "Generated original unsent draft.",
      attachments: [{ id: "generated-context", kind: "project_file", path: "fixture.txt", digest: content, bytes: 31 }] } }],
    { id: "generated-original-command", digest: "generated-original-digest", result: { id: "generated-original" } });
    store.close();
    const raw = new DatabaseSync(path);
    raw.prepare("DELETE FROM retention_metadata WHERE id=?").run(myWorkSchemaMarker); raw.exec("PRAGMA user_version=94");
    raw.prepare("DELETE FROM retention_metadata WHERE id=?").run(backgroundServiceSchemaMarker);
    const original = retained(raw);
    raw.exec("CREATE TRIGGER generated_inbox_migration_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='my_work_inbox_schema' BEGIN SELECT RAISE(ABORT,'Generated inbox migration interruption'); END"); raw.close();
    assert.throws(() => new EventStore(path, key), /Generated inbox migration interruption/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 94);
      assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id=?").get(myWorkSchemaMarker), undefined);
      assert.deepEqual(retained(failed), original); failed.exec("DROP TRIGGER generated_inbox_migration_failure");
    } finally { failed.close(); }
    reopened = new EventStore(path, key);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(myWorkSchemaMarker)?.value, "1");
    assert.deepEqual(retained(reopened.db), original);
    reopened.close(); reopened = new EventStore(path, key); assert.deepEqual(retained(reopened.db), original);
  } finally { reopened?.close(); await rm(directory, { recursive: true, force: true }); }
});
test("missing, corrupt and premature inbox lineage fails closed without rewriting source data", async (t) => {
  for (const variant of ["missing", "corrupt", "premature"] as const) await t.test(variant, async () => {
    const directory = await mkdtemp(join(tmpdir(), "moguri-generated-my-work-lineage-")), path = join(directory, "state.sqlite"), key = Buffer.alloc(32, 0x73);
    try {
      new EventStore(path, key).close(); const raw = new DatabaseSync(path);
      if (variant === "missing") raw.prepare("DELETE FROM retention_metadata WHERE id=?").run(myWorkSchemaMarker);
      if (variant === "corrupt") raw.prepare("UPDATE retention_metadata SET value='0' WHERE id=?").run(myWorkSchemaMarker);
      if (variant === "premature") raw.exec("PRAGMA user_version=94");
      const original = retained(raw); raw.close();
      assert.throws(() => new EventStore(path, key), /My Work inbox.*schema/i);
      const preserved = new DatabaseSync(path); try { assert.deepEqual(retained(preserved), original); } finally { preserved.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
test("real retained inbox sources/observations cannot be relabelled as protocol94 and survive source project deletion", { timeout: 30000 }, async () => {
  const key = Buffer.alloc(32, 0x73), f = await myWorkFixture({ retentionKey: key });
  try {
    await f.configure(f.first); const started = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(started.id!);
    const original = await f.sdk.myWork.read(started.id!);
    const preview = (await f.sdk.artifacts.projectPreview(f.projectId)).preview;
    const configuration = (await f.sdk.projects.configuration(f.projectId)).configuration;
    await f.sdk.projects.remove(f.projectId, true, configuration.revision, { action: "retain", expectedDigest: preview.digest });
    assert.deepEqual((await f.sdk.myWork.read(started.id!)).observations, original.observations);
    assert.equal((await f.sdk.myWork.query()).entries[0]!.freshness, "stale");
    f.service.controller.store.db.prepare("DELETE FROM retention_metadata WHERE id=?").run(myWorkSchemaMarker);
    f.service.controller.store.db.exec("PRAGMA user_version=94");
    assert.throws(() => new EventStore(f.service.controller.store.path, key), /inbox history.*pre-95/i);
  } finally { await f.close(); }
});
