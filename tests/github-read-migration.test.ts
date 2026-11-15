import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore, myWorkSchemaMarker, backgroundServiceSchemaMarker, otlpExportSchemaMarker, skillsRewindSchemaMarkers, inboxSkillSchemaMarkers, scriptInboxSchemaMarkers, repositoryWorkflowSchemaMarkers, nativeCandidateIdentitySchemaMarker, nativeScriptSchemaMarker, chatRepositoryBindingSchemaMarker } from "../apps/service/src/store.ts";
import { factoryControls, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { removeMyWorkFixtureMarker } from "./fixtures/legacy-state.ts";

const retained = (db: DatabaseSync) => ({
  events: db.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(),
  keys: db.prepare("SELECT * FROM retention_keys ORDER BY scope").all(),
  blobs: db.prepare("SELECT * FROM blob_payloads ORDER BY scope,digest").all(),
  receipts: db.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all(),
  metadata: db.prepare("SELECT id,value FROM retention_metadata ORDER BY id").all(),
});

test("the protocol93 upgrade changes only current metadata and never normalizes retained source", async () => {
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
    const events = store.events(); store.close(); store = undefined;
    const legacy = new DatabaseSync(path);
    removeMyWorkFixtureMarker(legacy, events);
    legacy.exec("PRAGMA user_version=93");
    const original = retained(legacy); legacy.close();
    for (let restart = 0; restart < 2; restart++) {
      store = new EventStore(path, key);
      assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
      const actual = retained(store.db);
      assert.deepEqual({ ...actual, metadata: original.metadata }, original);
      assert.deepEqual(actual.metadata.map((row) => ({ ...row })), [...original.metadata.map((row) => ({ ...row })),
        { id: myWorkSchemaMarker, value: "1" }, { id: backgroundServiceSchemaMarker, value: "1" }, { id: otlpExportSchemaMarker, value: "1" },
        ...skillsRewindSchemaMarkers.map((id) => ({ id, value: "1" })), ...inboxSkillSchemaMarkers.map((id) => ({ id, value: "1" })),
        ...scriptInboxSchemaMarkers.map((id) => ({ id, value: "1" })), ...repositoryWorkflowSchemaMarkers.map((id) => ({ id, value: "1" })),
        { id: nativeCandidateIdentitySchemaMarker, value: "1" }, { id: nativeScriptSchemaMarker, value: "1" }, { id: chatRepositoryBindingSchemaMarker, value: "1" }]
        .sort((a, b) => String(a.id).localeCompare(String(b.id))));
      assert.equal(store.blob(content), source);
      store.close(); store = undefined;
    }
  } finally { store?.close(); await rm(directory, { recursive: true, force: true }); }
});
