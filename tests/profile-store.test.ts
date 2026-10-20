import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../apps/service/src/store.ts";
import { DatabaseSync } from "node:sqlite";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { writeLegacyState } from "./fixtures/legacy-state.ts";

test("schema 13 upgrades Default in place without changing encrypted history, receipts, key identity or retained grants", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let upgraded: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const attachment = await sdk.command({ type: "attachment.add", sessionId: fixture.sessionId, expectedRevision: 0, path: "fixture.txt" });
    assert.ok(attachment.revision);
    const draft = { type: "draft.save" as const, sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated schema-13 Default draft.", attachments: fixture.session().draft.attachments };
    const result = await sdk.command(draft, "generated-profile-migration-command");
    const artifact = await sdk.artifacts.create(fixture.sessionId, { kind: "decision", name: "Generated legacy retained decision", text: "Generated schema-13 independent retained bytes." });
    sdk.disconnect(); await writeLegacyState(fixture.service, 13);
    const legacy = new DatabaseSync(fixture.service.store.path);
    const rows = legacy.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all();
    const keys = legacy.prepare("SELECT * FROM retention_keys ORDER BY scope").all();
    const identity = legacy.prepare("SELECT value FROM retention_metadata WHERE id='key_id'").get()?.value;
    const receipt = legacy.prepare("SELECT digest,result FROM receipts WHERE id=?").get("generated-profile-migration-command");
    legacy.close();
    upgraded = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const peer = await new MoguriSdk(upgraded.connection).ready();
    try {
      assert.equal(upgraded.store.db.prepare("PRAGMA user_version").get()?.user_version, 15);
      assert.equal(upgraded.store.db.prepare("SELECT value FROM retention_metadata WHERE id='key_id'").get()?.value, identity);
      assert.deepEqual(upgraded.store.db.prepare("SELECT seq,id,data,payload FROM events WHERE seq<=? ORDER BY seq").all(Number(rows.at(-1)!.seq)), rows);
      assert.deepEqual(upgraded.store.db.prepare("SELECT * FROM retention_keys WHERE scope NOT GLOB 'profile/_global*' ORDER BY scope").all(), keys);
      assert.deepEqual(upgraded.store.db.prepare("SELECT digest,result FROM receipts WHERE profile_id='default' AND id=?").get("generated-profile-migration-command"), receipt);
      assert.deepEqual(await peer.command(draft, "generated-profile-migration-command"), result);
      assert.equal(peer.getState().snapshot!.profileId, "default");
      assert.equal(peer.getState().snapshot!.sessions[0]?.draft.text, draft.text);
      assert.equal((await peer.artifacts.read(artifact.id!)).text, "Generated schema-13 independent retained bytes.");
      assert.equal(upgraded.store.blob(draft.attachments[0]!.digest), "generated original\n");
    } finally { peer.disconnect(); }
  } finally { sdk.disconnect(); await upgraded?.close(); await fixture.close(); }
});

test("an interrupted schema-14 receipt migration rolls back and reopens the unchanged schema-13 state", async () => {
  const fixture = await setupFixture();
  let upgraded: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await writeLegacyState(fixture.service, 13);
    const path = fixture.service.store.path, legacy = new DatabaseSync(path);
    const rows = legacy.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), receipts = legacy.prepare("SELECT * FROM receipts ORDER BY id").all();
    legacy.exec(`CREATE TRIGGER generated_profile_migration_failure BEFORE INSERT ON retention_metadata
      WHEN NEW.id='profile_scope_schema' BEGIN SELECT RAISE(ABORT,'Generated profile migration interruption'); END;`);
    legacy.close();
    const options = { stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey };
    await assert.rejects(() => startService(options), /Generated profile migration interruption/);
    const preserved = new DatabaseSync(path);
    try {
      assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 13);
      assert.deepEqual(preserved.prepare("PRAGMA table_info(receipts)").all().map((column) => column.name), ["id", "digest", "result"]);
      assert.deepEqual(preserved.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), rows);
      assert.deepEqual(preserved.prepare("SELECT * FROM receipts ORDER BY id").all(), receipts);
      assert.equal(preserved.prepare("SELECT name FROM sqlite_master WHERE name='receipts_v14'").get(), undefined);
      preserved.exec("DROP TRIGGER generated_profile_migration_failure");
    } finally { preserved.close(); }
    upgraded = await startService(options);
    assert.equal(upgraded.store.db.prepare("PRAGMA user_version").get()?.user_version, 15);
    assert.equal(upgraded.controller.snapshot().sessions[0]?.id, fixture.sessionId);
    assert.equal(fixture.requests.length, 0);
  } finally { await upgraded?.close(); await fixture.close(); }
});

test("profile-scoped views isolate events, same-ID receipts, blob grants and forgetting in one authoritative database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-profile-store-")), path = join(directory, "state.sqlite"), key = Buffer.alloc(32, 0x68);
  const first = new EventStore(path, key, "generated-shared-master", "default"), second = new EventStore(path, key, "generated-shared-master", "generated-profile-b");
  try {
    const content = "Generated same-content profile grants.", privateContent = first.putBlob("Generated first-profile-only text.");
    first.commit([{ event_type: "capability.saved", profile_id: "default", project_id: "generated-shared-id", payload: { entry: {
      id: "generated-private-entry", projectId: "generated-shared-id", kind: "memory", name: "Generated private A", description: "", contentDigest: privateContent, source: "user", enabled: false, revision: 0, createdAt: "2026-01-01T00:00:00Z",
    } } }], { id: "generated-same-command", digest: "generated-command-digest", result: { id: "generated-result-a" } });
    assert.equal(second.events().length, 0);
    assert.throws(() => second.blob(privateContent), /Missing|deleted/);
    for (const [store, profile] of [[first, "default"], [second, "generated-profile-b"]] as const) {
      const contentDigest = store.putBlob(content);
      store.commit([{ event_type: "capability.saved", profile_id: profile, project_id: "generated-shared-id", payload: { entry: {
        id: "generated-shared-entry", projectId: "generated-shared-id", kind: "memory", name: "Generated shared bytes", description: "", contentDigest, source: "user", enabled: false, revision: 0, createdAt: "2026-01-01T00:00:00Z",
      } } }], profile === "default" ? undefined : { id: "generated-same-command", digest: "generated-command-digest", result: { id: "generated-result-b" } });
    }
    assert.equal(first.receipt("generated-same-command", "generated-command-digest")?.id, "generated-result-a");
    assert.equal(second.receipt("generated-same-command", "generated-command-digest")?.id, "generated-result-b");
    assert.ok(first.events().every((event) => event.profile_id === "default"));
    assert.ok(second.events().every((event) => event.profile_id === "generated-profile-b"));
    first.commit([], undefined, { projects: ["generated-shared-id"] });
    assert.equal(first.events().length, 0);
    assert.equal(second.events().length, 1);
    const retained = second.events()[0]!;
    assert.ok(retained.event_type === "capability.saved");
    assert.equal(second.blob(retained.payload.entry.contentDigest), content);
    assert.throws(() => first.blob(privateContent), /Missing|deleted/);
  } finally { first.close(); second.close(); await rm(directory, { recursive: true, force: true }); }
});
