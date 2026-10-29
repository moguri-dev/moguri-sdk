import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk, ToolPreferencesSchema, defaultToolPreferences, effectiveToolPreferences, parse, toolPreferenceGuidance, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { removeCommandToolFixtureMarkers, retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("tool ranking is a complete validated permutation with the exact requested factory order", () => {
  const defaults = defaultToolPreferences();
  assert.deepEqual(defaults.order, ["mcp-gateway", "mcp-direct", "rest", "cli"]);
  assert.deepEqual(effectiveToolPreferences(), defaults);
  for (const order of [defaults.order, [...defaults.order].reverse(), ["rest", "mcp-direct", "cli", "mcp-gateway"]]) {
    assert.deepEqual(parse(ToolPreferencesSchema, { order }).order, order);
  }
  for (const order of [[], ["cli"], ["cli", "cli", "rest", "mcp-direct"], [...defaults.order, "rest"], ["mcp-gateway", "mcp-direct", "rest", "unknown"]]) {
    assert.throws(() => parse(ToolPreferencesSchema, { order }));
  }
  const prompt = toolPreferenceGuidance({ order: ["cli", "rest", "mcp-direct", "mcp-gateway"] });
  assert.ok(prompt.indexOf("1. CLI") < prompt.indexOf("2. REST API"));
  assert.match(prompt, /not permission|Ranking is not permission/);
  assert.match(prompt, /Never retry an uncertain write/);
});

test("ranked settings persist through exact revisions, profile restart and browser-safe SDK without granting tools", async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready(), peer = await new MoguriSdk(f.service.connection).ready();
  let reopened: Awaited<ReturnType<typeof startService>> | undefined, next: MoguriSdk | undefined;
  try {
    const settings = sdk.settings.get()!, policy = structuredClone(settings.values.permissions);
    await sdk.settings.update({ ...settings.values, toolPreferences: { order: ["cli", "rest", "mcp-direct", "mcp-gateway"] } }, settings.revision);
    await assert.rejects(() => peer.settings.update({ ...settings.values, toolPreferences: { order: ["rest", "cli", "mcp-gateway", "mcp-direct"] } }, settings.revision), { code: "revision_conflict" });
    assert.match(f.service.controller.platform.prompt(f.session()), /1\. CLI/);
    assert.deepEqual(f.service.controller.snapshot().settings.values.permissions, policy);
    sdk.disconnect(); peer.disconnect(); await f.service.close();
    reopened = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    next = await new MoguriSdk(reopened.connection).ready();
    assert.equal(next.settings.get()?.values.toolPreferences?.order[0], "cli");
    const current = next.settings.get()!;
    await next.settings.reset("toolPreferences", current.revision);
    assert.deepEqual(effectiveToolPreferences(next.settings.get()?.values.toolPreferences), defaultToolPreferences());
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); peer.disconnect(); next?.disconnect(); await reopened?.close(); await f.close(); }
});

test("genuine81 migration atomically adds both82 markers without rewriting retained controls, ciphertext or receipts", async () => {
  const f = await setupFixture(), path = f.service.store.path;
  let reopened: EventStore | undefined;
  try {
    const events = f.service.store.events(), rows = retainedCiphertextRows(f.service.store.db);
    await f.service.close();
    const raw = new DatabaseSync(path);
    removeCommandToolFixtureMarkers(raw, events);
    raw.exec("PRAGMA user_version=81; CREATE TRIGGER generated_delivery_upgrade BEFORE INSERT ON retention_metadata WHEN NEW.id='tool_preferences_schema' BEGIN SELECT RAISE(ABORT,'Generated command preference interruption'); END;");
    raw.close();
    assert.throws(() => new EventStore(path, f.retentionKey), /Generated command preference interruption/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 81);
      assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id='workflow_commands_schema'").get(), undefined);
      assert.deepEqual(retainedCiphertextRows(failed), rows);
      failed.exec("DROP TRIGGER generated_delivery_upgrade");
    } finally { failed.close(); }
    reopened = new EventStore(path, f.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    for (const id of ["workflow_commands_schema", "tool_preferences_schema", "session_request_recovery_schema", "builtin_git_schema"]) {
      assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(id)?.value, "1");
    }
    assert.deepEqual(retainedCiphertextRows(reopened.db), rows);
    reopened.close(); reopened = new EventStore(path, f.retentionKey);
    assert.deepEqual(retainedCiphertextRows(reopened.db), rows);
  } finally { reopened?.close(); await f.close(); }
});

test("actual ranked preference history cannot be downgraded and missing current markers cannot be silently minted", async (t) => {
  for (const mode of ["downgrade", "missing"] as const) await t.test(mode, async () => {
    const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready(), path = f.service.store.path;
    try {
      const current = sdk.settings.get()!;
      await sdk.settings.update({ ...current.values, toolPreferences: { order: ["cli", "rest", "mcp-direct", "mcp-gateway"] } }, current.revision);
      const rows = retainedCiphertextRows(f.service.store.db);
      sdk.disconnect(); await f.service.close();
      const raw = new DatabaseSync(path);
      try {
        raw.exec("DELETE FROM retention_metadata WHERE id='tool_preferences_schema';");
        if (mode === "downgrade") raw.exec("DELETE FROM retention_metadata WHERE id='workflow_commands_schema'; PRAGMA user_version=81;");
      } finally { raw.close(); }
      assert.throws(() => new EventStore(path, f.retentionKey), mode === "downgrade" ? /pre-82 lineage/ : /command\/tool preference.*marker/);
      const preserved = new DatabaseSync(path);
      try { assert.deepEqual(retainedCiphertextRows(preserved), rows); } finally { preserved.close(); }
    } finally { sdk.disconnect(); await f.close(); }
  });
});
