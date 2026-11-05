import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore, milestoneCapabilitySchemaMarkers } from "../apps/service/src/store.ts";
import { hasMilestoneModelHistory } from "../packages/protocol/src/milestone-models.ts";
import { PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-milestone-models-"));
  const path = join(directory, "state.sqlite"), key = Buffer.alloc(32, 0x6d);
  const store = new EventStore(path, key);
  const contentDigest = store.putBlob("Generated original retained model setup.");
  store.commit([
    { event_type: "session.created", profile_id: "default", session_id: "generated-source",
      payload: { title: "Generated original setup", controls: { env: "Local", modelId: null, autonomy: "Manual", budget: { kind: "unlimited" } } } },
    { event_type: "draft.saved", profile_id: "default", session_id: "generated-source",
      payload: { text: "Generated original draft.", attachments: [{ id: "generated-file", kind: "project_file", path: "fixture.txt", digest: contentDigest, bytes: 40 }] } },
  ], { id: "generated-original-command", digest: "generated-original-digest", result: { id: "generated-source" } });
  const events = store.events();
  store.close();
  return { path, key, events, close: () => rm(directory, { recursive: true, force: true }) };
}
const retained = (db: DatabaseSync) => ({
  events: db.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(),
  keys: db.prepare("SELECT * FROM retention_keys ORDER BY scope").all(),
  receipts: db.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all(),
  blobs: db.prepare("SELECT * FROM blob_payloads ORDER BY scope,digest").all(),
});

test("genuine91 upgrades all milestone capability markers atomically and reopens unchanged retained data", async () => {
  const f = await fixture();
  let reopened: EventStore | undefined;
  try {
    assert.equal(hasMilestoneModelHistory(f.events), false);
    const raw = new DatabaseSync(f.path);
    for (const marker of milestoneCapabilitySchemaMarkers) raw.prepare("DELETE FROM retention_metadata WHERE id=?").run(marker);
    raw.exec("PRAGMA user_version=91");
    const original = retained(raw);
    raw.exec("CREATE TRIGGER generated_milestone_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='kupo_options_schema' BEGIN SELECT RAISE(ABORT,'Generated milestone migration interruption'); END");
    raw.close();
    assert.throws(() => new EventStore(f.path, f.key), /Generated milestone migration interruption/);
    const failed = new DatabaseSync(f.path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 91);
      for (const marker of milestoneCapabilitySchemaMarkers) assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker), undefined);
      assert.deepEqual(retained(failed), original);
      failed.exec("DROP TRIGGER generated_milestone_failure");
    } finally { failed.close(); }
    reopened = new EventStore(f.path, f.key);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    for (const marker of milestoneCapabilitySchemaMarkers) assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker)?.value, "1");
    assert.deepEqual(retained(reopened.db), original);
    reopened.close();
    reopened = new EventStore(f.path, f.key);
    assert.deepEqual(retained(reopened.db), original);
  } finally { reopened?.close(); await f.close(); }
});

test("missing, corrupt and prematurely retained milestone capability markers never authorize an implicit upgrade", async (t) => {
  for (const change of ["missing", "corrupt", "premature"] as const) await t.test(change, async () => {
    const f = await fixture();
    try {
      const raw = new DatabaseSync(f.path);
      if (change === "missing") raw.prepare("DELETE FROM retention_metadata WHERE id=?").run("model_runtime_readiness_schema");
      else if (change === "corrupt") raw.prepare("UPDATE retention_metadata SET value='0' WHERE id=?").run("kupo_options_schema");
      else raw.exec("PRAGMA user_version=91");
      const original = retained(raw);
      raw.close();
      assert.throws(() => new EventStore(f.path, f.key), /milestone capabilit/i);
      const preserved = new DatabaseSync(f.path);
      try { assert.deepEqual(retained(preserved), original); } finally { preserved.close(); }
    } finally { await f.close(); }
  });
});

test("actual pooled controls cannot be relabelled as genuine91 by deleting their markers", async () => {
  const f = await fixture();
  try {
    const current = new EventStore(f.path, f.key);
    current.commit([{ event_type: "session.configured", profile_id: "default", session_id: "generated-source",
      payload: { controls: { env: "Local", modelId: "kupo", autonomy: "Manual", budget: { kind: "unlimited" }, modelOptions: { contextWindow: 24577 } } } }]);
    assert.equal(hasMilestoneModelHistory(current.events()), true);
    current.close();
    const raw = new DatabaseSync(f.path);
    for (const marker of milestoneCapabilitySchemaMarkers) raw.prepare("DELETE FROM retention_metadata WHERE id=?").run(marker);
    raw.exec("PRAGMA user_version=91");
    const original = retained(raw);
    raw.close();
    assert.throws(() => new EventStore(f.path, f.key), /milestone capability history.*pre-92/i);
    const preserved = new DatabaseSync(f.path);
    try { assert.deepEqual(retained(preserved), original); } finally { preserved.close(); }
  } finally { await f.close(); }
});
