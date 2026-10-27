import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk, PROTOCOL_VERSION, projectEvents, type ChatWriter } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("the 71-to-72 Home marker migration rolls back atomically, preserves ciphertext and binds a legacy chat only on explicit use", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path, sessionId = "generated-legacy-home-chat";
  let reopened: EventStore | undefined, service: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined;
  try {
    fixture.service.store.commit([{ event_type: "session.created", profile_id: "default", session_id: sessionId,
      payload: { title: "Generated original root-less chat", controls: fixture.session().controls } }]);
    fixture.service.controller.refreshProfile();
    await writeFile(join(fixture.home, "generated-original-home.txt"), "Generated original Home bytes.\n");
    const original = retainedCiphertextRows(fixture.service.store.db);
    await fixture.service.close();
    const raw = new DatabaseSync(path);
    try { raw.exec("DELETE FROM retention_metadata WHERE id='chat_home_schema'; PRAGMA user_version=71; CREATE TRIGGER generated_home_migration_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='chat_home_schema' BEGIN SELECT RAISE(ABORT,'Generated Home migration interruption'); END;"); }
    finally { raw.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated Home migration interruption/);
    const interrupted = new DatabaseSync(path);
    try {
      assert.equal(interrupted.prepare("PRAGMA user_version").get()?.user_version, 71);
      assert.equal(interrupted.prepare("SELECT value FROM retention_metadata WHERE id='chat_home_schema'").get(), undefined);
      assert.deepEqual(retainedCiphertextRows(interrupted), original);
      interrupted.exec("DROP TRIGGER generated_home_migration_failure");
    } finally { interrupted.close(); }
    reopened = new EventStore(path, fixture.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    assert.equal(projectEvents(reopened.events()).sessions.find((session) => session.id === sessionId)?.homeRoot, undefined);
    reopened.close(); reopened = undefined;
    const options = { stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
      platform: { terminal: { defaultRoot: fixture.home, vault: fixture.terminalVault } } };
    service = await startService(options); sdk = await new MoguriSdk(service.connection).ready();
    assert.equal(sdk.getState().snapshot!.sessions.find((session) => session.id === sessionId)?.homeRoot, undefined);
    assert.ok((await sdk.workspaces.files(sessionId)).entries.includes("generated-original-home.txt"));
    const root = (await sdk.workspaces.home(sessionId)).root;
    assert.equal(sdk.getState().snapshot!.sessions.find((session) => session.id === sessionId)?.projectId, null);
    assert.equal(service.controller.events(0).filter((event) => event.event_type === "session.home_bound").length, 1);
    const otherHome = join(fixture.directory, "different-home"); await mkdir(otherHome);
    await writeFile(join(otherHome, "generated-wrong-home.txt"), "Generated wrong root.\n");
    sdk.disconnect(); await service.close();
    service = await startService({ ...options, platform: { terminal: { ...options.platform.terminal, defaultRoot: otherHome } } });
    sdk = await new MoguriSdk(service.connection).ready();
    assert.deepEqual((await sdk.workspaces.home(sessionId)).root, root);
    const files = await sdk.workspaces.files(sessionId);
    assert.ok(files.entries.includes("generated-original-home.txt")); assert.equal(files.entries.includes("generated-wrong-home.txt"), false);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk?.disconnect(); reopened?.close(); await service?.close(); await fixture.close(); }
});

test("missing, corrupt or premature Home markers and genuine Home history cannot be relabelled or silently repaired", async (t) => {
  for (const change of ["missing", "corrupt", "premature", "future-history"] as const) await t.test(change, async () => {
    const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
    try {
      if (change === "future-history") await sdk.sessions.create(null, "Generated actual Home binding");
      sdk.disconnect(); await fixture.service.close();
      const raw = new DatabaseSync(fixture.service.store.path);
      let original;
      try {
        raw.exec(change === "corrupt" ? "UPDATE retention_metadata SET value='0' WHERE id='chat_home_schema'" :
          change === "premature" ? "PRAGMA user_version=71" :
          `DELETE FROM retention_metadata WHERE id='chat_home_schema'; ${change === "future-history" ? "PRAGMA user_version=71" : ""}`);
        original = retainedCiphertextRows(raw);
      } finally { raw.close(); }
      assert.throws(() => new EventStore(fixture.service.store.path, fixture.retentionKey), /Home-backed chat (schema marker|history cannot be relabelled)/i);
      const preserved = new DatabaseSync(fixture.service.store.path);
      try { assert.deepEqual(retainedCiphertextRows(preserved), original); } finally { preserved.close(); }
    } finally { sdk.disconnect(); await fixture.close(); }
  });
});

test("independent Home writer replay preserves exact ownership and distinguishes cleanup observations from actual-user inspection", () => {
  const store = new EventStore(":memory:");
  try {
    const now = new Date().toISOString(), writer: ChatWriter = { id: "generated-home-writer", profileId: "default", sessionId: "generated-removed-source",
      turnId: "generated-original-turn", root: { root: "/generated/home", device: "1", inode: "2" }, revision: 0,
      status: "active", startedAt: now, updatedAt: now, backgroundJobs: [], diagnostic: null };
    const recorded = store.commit([{ event_type: "chat.writer_recorded", profile_id: "default", payload: { writer } }]);
    const saved = recorded[0]!; assert.equal(saved.event_type, "chat.writer_recorded");
    for (const next of [
      { ...writer, revision: 1, root: { ...writer.root, inode: "3" } },
      { ...writer, revision: 2 },
      { ...writer, revision: 1, sessionId: "generated-replacement-owner" },
      { ...writer, revision: 1, status: "acknowledged" as const, inspection: { sessionId: "generated-reviewer", actor: "user" as const } },
    ]) assert.throws(() => projectEvents([...recorded, { ...saved, seq: saved.seq + 1, id: "generated-invalid-event", event_type: "chat.writer_recorded", payload: { writer: next } }]), /Home writer/);
    const unknown = { ...writer, revision: 1, status: "unconfirmed" as const, diagnostic: "Generated lost original control plane." };
    const uncertain = store.commit([{ event_type: "chat.writer_recorded", profile_id: "default", payload: { writer: unknown } }]);
    assert.equal(projectEvents(store.events()).chatWriters[0]?.status, "unconfirmed");
    assert.throws(() => projectEvents([...store.events(), { ...uncertain[0]!, seq: uncertain[0]!.seq + 1, id: "generated-false-cleanup", event_type: "chat.writer_recorded",
      payload: { writer: { ...unknown, revision: 2, status: "settled" } } }]), /Home writer/);
    store.commit([{ event_type: "chat.writer_recorded", profile_id: "default", payload: { writer: { ...unknown, revision: 2, status: "acknowledged",
      inspection: { sessionId: "generated-reviewer", actor: "user" }, diagnostic: "Actual-user risk acknowledgement, not cleanup proof." } } }]);
    const restored = projectEvents(store.events()).chatWriters[0]!;
    assert.equal(restored.sessionId, writer.sessionId); assert.equal(restored.status, "acknowledged");
    assert.equal(restored.inspection?.actor, "user"); assert.equal(restored.root.inode, "2");
  } finally { store.close(); }
});
