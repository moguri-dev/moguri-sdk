import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { removePost77FixtureMarkers, retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";

test("the genuine76-to-combined80 theme migration is atomic and preserves ciphertext, receipts, custom choices and hard policy", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let reopened: EventStore | undefined, service: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, appearance: { theme: "system", palette: "ocean", custom: { dark: { text: "#fafafa" } } } }, settings.revision);
    await sdk.budgets.policy({ basis: "estimate", tokens: 500 }, 0, true);
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision,
      text: "Generated original theme-upgrade draft.", attachments: [] }, "generated-theme-receipt");
    const before = retainedCiphertextRows(fixture.service.store.db), path = fixture.service.store.path;
    sdk.disconnect(); await fixture.service.close();
    const raw = new DatabaseSync(path);
    try { removePost77FixtureMarkers(raw, fixture.service.controller.events(0)); raw.exec("DELETE FROM retention_metadata WHERE id='model_selection_continuity_schema'; PRAGMA user_version=76; CREATE TRIGGER generated_theme_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='theme_catalog_schema' BEGIN SELECT RAISE(ABORT,'Generated theme migration interruption'); END"); }
    finally { raw.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated theme migration interruption/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 76);
      assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id='theme_catalog_schema'").get(), undefined);
      assert.deepEqual(retainedCiphertextRows(failed), before);
      failed.exec("DROP TRIGGER generated_theme_failure");
    } finally { failed.close(); }
    reopened = new EventStore(path, fixture.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id='theme_catalog_schema'").get()?.value, "1");
    assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id='model_selection_continuity_schema'").get()?.value, "1");
    assert.deepEqual(retainedCiphertextRows(reopened.db), before);
    reopened.close(); reopened = undefined;
    service = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const peer = await new MoguriSdk(service.connection).ready();
    try {
      assert.deepEqual(peer.settings.get()?.values.appearance, { theme: "system", palette: "ocean", custom: { dark: { text: "#fafafa" } } });
      assert.equal(peer.getState().snapshot?.budgetPolicy.limit?.tokens, 500);
      assert.equal(peer.getState().snapshot?.sessions[0]?.draft.text, "Generated original theme-upgrade draft.");
      assert.ok(service.store.db.prepare("SELECT id FROM receipts WHERE id='generated-theme-receipt'").get());
      await peer.slash(fixture.sessionId, "/theme crystal", "tui");
    } finally { peer.disconnect(); }
    await service.close();
    service = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    assert.equal(service.controller.snapshot().settings.values.appearance.palette, "crystal");
    assert.equal(service.controller.snapshot().settings.values.appearance.theme, "system");
    const after: ReturnType<typeof retainedCiphertextRows> = retainedCiphertextRows(service.store.db);
    for (const [table, rows] of before) assert.deepEqual(after.find(([name]) => name === table)![1].slice(0, rows.length), rows, table);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); reopened?.close(); await service?.close(); await fixture.close(); }
});

test("missing, corrupt, premature, relabelled and unsupported sibling lineages fail without repairing provenance", async (t) => {
  for (const change of ["missing", "corrupt", "premature", "relabelled", "model-only"] as const) await t.test(change, async () => {
    const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
    try {
      if (change === "relabelled") await sdk.slash(fixture.sessionId, "/theme rose", "cli");
      sdk.disconnect(); await fixture.service.close();
      const path = fixture.service.store.path, raw = new DatabaseSync(path);
      let before;
      try {
        raw.exec(change === "corrupt" ? "UPDATE retention_metadata SET value='0' WHERE id='theme_catalog_schema'" :
          change === "premature" ? "PRAGMA user_version=76" :
          change === "model-only" ? "DELETE FROM retention_metadata WHERE id='theme_catalog_schema'; PRAGMA user_version=77" :
          `DELETE FROM retention_metadata WHERE id='theme_catalog_schema'; ${change === "relabelled" ? "PRAGMA user_version=76" : ""}`);
        before = retainedCiphertextRows(raw);
      } finally { raw.close(); }
      assert.throws(() => new EventStore(path, fixture.retentionKey), ["premature", "relabelled", "model-only"].includes(change) ?
        /Premature workspace schema marker/i : /theme (catalogue|history)|theme build/i);
      const retained = new DatabaseSync(path);
      try { assert.deepEqual(retainedCiphertextRows(retained), before); } finally { retained.close(); }
    } finally { sdk.disconnect(); await fixture.close(); }
  });
});

test("new palette history cannot be manufactured into a legacy fixture and stale clients cannot overwrite another theme choice", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), peer = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const stale = structuredClone(peer.settings.get()!);
    await sdk.slash(fixture.sessionId, "/theme vaporwave light", "desktop");
    await assert.rejects(() => peer.settings.update({ ...stale.values, appearance: { theme: "dark", palette: "rose" } }, stale.revision), /changed|revision/i);
    assert.equal(fixture.service.controller.snapshot().settings.values.appearance.palette, "vaporwave");
    await assert.rejects(() => writeLegacyState(fixture.service, 60), /pre-theme-catalogue history/);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); peer.disconnect(); await fixture.close(); }
});
