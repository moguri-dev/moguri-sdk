import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../apps/service/src/store.ts";
import { factoryControls, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";

const retained = (db: DatabaseSync) => ({
  events: db.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(),
  keys: db.prepare("SELECT * FROM retention_keys ORDER BY scope").all(),
  blobs: db.prepare("SELECT * FROM blob_payloads ORDER BY scope,digest").all(),
  receipts: db.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all(),
  metadata: db.prepare("SELECT id,value FROM retention_metadata ORDER BY id").all(),
});

test("the protocol93 metadata upgrade changes only version metadata and never normalizes retained source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-github-read-upgrade-")), path = join(directory, "state.sqlite"), key = Buffer.alloc(32, 0x64);
  const source = JSON.stringify({ role: "assistant", content: [{ type: "toolCall", id: "", name: "generated_original_tool", arguments: { generated: true } }] });
  let store: EventStore | undefined;
  try {
    store = new EventStore(path, key);
    const content = store.putBlob(source);
    store.commit([
      { event_type: "session.created", profile_id: "default", session_id: "generated-source", payload: { title: "Generated compatible retained session", controls: factoryControls() } },
      { event_type: "draft.saved", profile_id: "default", session_id: "generated-source", payload: { text: "Generated original unsent draft.", attachments: [
        { id: "generated-source-file", kind: "project_file", path: "generated-original.json", digest: content, bytes: Buffer.byteLength(source) },
      ] } },
    ], { id: "generated-original-receipt", digest: "generated-original-digest", result: { id: "generated-source" } });
    store.close(); store = undefined;
    const legacy = new DatabaseSync(path);
    legacy.exec("PRAGMA user_version=93");
    const original = retained(legacy); legacy.close();
    for (let restart = 0; restart < 2; restart++) {
      store = new EventStore(path, key);
      assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
      assert.deepEqual(retained(store.db), original); assert.equal(store.blob(content), source);
      store.close(); store = undefined;
    }
  } finally { store?.close(); await rm(directory, { recursive: true, force: true }); }
});
