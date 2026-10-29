import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { EventStore } from "../apps/service/src/store.ts";
import { MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { removePost77FixtureMarkers, retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("the 72-to-73 website policy marker is atomic, preserves ciphertext and never manufactures grants", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let reopened: EventStore | undefined;
  try {
    const original = retainedCiphertextRows(fixture.service.store.db);
    await fixture.service.close();
    const raw = new DatabaseSync(path);
    try { removePost77FixtureMarkers(raw, fixture.service.controller.events(0)); raw.exec("DELETE FROM retention_metadata WHERE id IN ('model_selection_continuity_schema','native_web_policy_schema'); PRAGMA user_version=72; CREATE TRIGGER generated_web_migration_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='native_web_policy_schema' BEGIN SELECT RAISE(ABORT,'Generated website migration interruption'); END;"); }
    finally { raw.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated website migration interruption/);
    const interrupted = new DatabaseSync(path);
    try {
      assert.equal(interrupted.prepare("PRAGMA user_version").get()?.user_version, 72);
      assert.equal(interrupted.prepare("SELECT value FROM retention_metadata WHERE id='native_web_policy_schema'").get(), undefined);
      assert.deepEqual(retainedCiphertextRows(interrupted), original);
      interrupted.exec("DROP TRIGGER generated_web_migration_failure");
    } finally { interrupted.close(); }
    reopened = new EventStore(path, fixture.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    assert.ok(reopened.events().every((event) => event.event_type !== "settings.updated" || event.payload.settings.permissions.webAllowlist === undefined));
    reopened.close(); reopened = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    assert.equal(fixture.requests.length, 0);
  } finally { reopened?.close(); await fixture.close(); }
});

test("missing, corrupt, premature and relabelled website rules fail closed without rewriting retained bytes", async (t) => {
  for (const change of ["missing", "corrupt", "premature", "future-history"] as const) await t.test(change, async () => {
    const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
    try {
      if (change === "future-history") await sdk.webAllowlist.add("generated.example.invalid", { kind: "global" });
      sdk.disconnect(); await fixture.service.close();
      const raw = new DatabaseSync(fixture.service.store.path);
      let original;
      try {
        raw.exec(change === "corrupt" ? "UPDATE retention_metadata SET value='0' WHERE id='native_web_policy_schema'" :
          change === "premature" ? "PRAGMA user_version=72" :
          `DELETE FROM retention_metadata WHERE id='native_web_policy_schema'; ${change === "future-history" ? "PRAGMA user_version=72" : ""}`);
        original = retainedCiphertextRows(raw);
      } finally { raw.close(); }
      assert.throws(() => new EventStore(fixture.service.store.path, fixture.retentionKey), change === "premature" || change === "future-history" ?
        /Premature workspace schema marker/i : /website (policy schema marker|allowance history cannot be relabelled)/i);
      const preserved = new DatabaseSync(fixture.service.store.path);
      try { assert.deepEqual(retainedCiphertextRows(preserved), original); } finally { preserved.close(); }
    } finally { sdk.disconnect(); await fixture.close(); }
  });
});
