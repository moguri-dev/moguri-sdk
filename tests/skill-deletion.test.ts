import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { admitGeneratedSkill, setupFixture } from "./fixture.ts";
import { removeCapabilityDeletionFixtureMarker, retainedCiphertextRows } from "./fixtures/legacy-state.ts";

const mac = { skip: process.platform !== "darwin" };
async function importSkill(sdk: MoguriSdk, root: string, projectId: string, name: string) {
  const directory = join(root, name), path = join(directory, "SKILL.md");
  await mkdir(directory, { recursive: true });
  await writeFile(path, `---\nname: ${name}\ndescription: Generated deletable skill\n---\nGenerated deletable instructions.\n`);
  return (await sdk.capabilities.importSkill(projectId, path)).id!;
}

test("deleting an imported skill removes it after an exact revision, revokes admissions, survives restart and refuses plugin-owned skills", mac, async () => {
  const fixture = await setupFixture();
  let sdk = await new MoguriSdk(fixture.service.connection).ready(), service: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const projectId = fixture.session().projectId;
    const id = await importSkill(sdk, fixture.project, projectId, "generated-deletable");
    const kept = await importSkill(sdk, fixture.project, projectId, "generated-kept");
    await sdk.capabilities.toggle(id, true, 0);
    const entry = sdk.getState().snapshot!.registry.find((value) => value.id === id)!;
    await admitGeneratedSkill(sdk, fixture.sessionId, id, entry.contentDigest);
    await assert.rejects(() => sdk.capabilities.delete(id, 0, true), { code: "capability_conflict" });
    assert.ok(sdk.getState().snapshot!.registry.some((value) => value.id === id));
    await sdk.capabilities.delete(id, entry.revision, true);
    assert.equal(sdk.getState().snapshot!.registry.some((value) => value.id === id), false);
    assert.ok(sdk.getState().snapshot!.registry.some((value) => value.id === kept));
    await assert.rejects(() => fixture.service.controller.platform.delegate(fixture.session(), { id: "generated-deleted-load", name: "use_skill",
      arguments: { action: "load", id, expectedDigest: entry.contentDigest } }, new AbortController().signal), /revoked|no longer retained|changed/i);
    await assert.rejects(() => sdk.capabilities.delete(id, entry.revision, true), { code: "capability_conflict" });
    const pluginPath = join(fixture.project, "plugin.json");
    await writeFile(pluginPath, JSON.stringify({ schemaVersion: 1, name: "generated-bundle", version: "1.0.0", description: "Generated plugin",
      skills: ["---\nname: generated-bundle-skill\ndescription: Bundled skill\n---\nGenerated bundled instructions.\n"] }));
    const plugin = await sdk.capabilities.importPlugin(projectId, pluginPath);
    const child = sdk.getState().snapshot!.registry.find((value) => value.ownerPluginId === plugin.id)!;
    await assert.rejects(() => sdk.capabilities.delete(child.id, child.revision, true), { code: "capability_plugin_owned" });
    await assert.rejects(() => sdk.capabilities.delete(plugin.id!, 0, true), { code: "capability_delete_kind" });
    const keptEntry = sdk.getState().snapshot!.registry.find((value) => value.id === kept)!;
    const result = await sdk.slash(fixture.sessionId, `/skills delete ${kept} ${keptEntry.revision} confirm-delete`, "desktop");
    assert.equal(result.kind, "ok");
    assert.equal(sdk.getState().snapshot!.registry.some((value) => value.id === kept), false);
    const options = { stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
      platform: { terminal: { defaultRoot: fixture.home, vault: fixture.terminalVault } } };
    sdk.disconnect(); await fixture.service.close();
    service = await startService(options); sdk = await new MoguriSdk(service.connection).ready();
    const registry = sdk.getState().snapshot!.registry;
    assert.equal(registry.some((value) => value.id === id || value.id === kept), false);
    assert.ok(registry.some((value) => value.id === child.id));
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await service?.close(); await fixture.close(); }
});

test("schema 105 upgrades to the skill deletion marker and refuses premature markers or relabelled deletions", async (t) => {
  await t.test("upgrade", async () => {
    const fixture = await setupFixture(), path = fixture.service.store.path;
    let reopened: EventStore | undefined;
    try {
      await fixture.service.close();
      const raw = new DatabaseSync(path);
      try { removeCapabilityDeletionFixtureMarker(raw, fixture.service.controller.events(0)); raw.exec("PRAGMA user_version=105"); }
      finally { raw.close(); }
      const original = (() => { const db = new DatabaseSync(path); try { return retainedCiphertextRows(db); } finally { db.close(); } })();
      reopened = new EventStore(path, fixture.retentionKey);
      assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
      assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id='capability_deletion_schema'").get()?.value, "1");
      assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    } finally { reopened?.close(); await fixture.close(); }
  });
  for (const change of ["missing", "premature", "deletion-history"] as const) await t.test(change, mac, async () => {
    const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
    try {
      if (change === "deletion-history") {
        const id = await importSkill(sdk, fixture.project, fixture.session().projectId, "generated-history");
        await sdk.capabilities.delete(id, 0, true);
      }
      sdk.disconnect(); await fixture.service.close();
      const raw = new DatabaseSync(fixture.service.store.path);
      let original;
      try {
        raw.exec(change === "missing" ? "DELETE FROM retention_metadata WHERE id='capability_deletion_schema'" :
          change === "premature" ? "PRAGMA user_version=105" : "DELETE FROM retention_metadata WHERE id='capability_deletion_schema'; PRAGMA user_version=105");
        original = retainedCiphertextRows(raw);
      } finally { raw.close(); }
      assert.throws(() => new EventStore(fixture.service.store.path, fixture.retentionKey),
        change === "missing" ? /Missing or invalid skill deletion schema marker/ : change === "premature" ? /Premature skill deletion/ : /pre-106 lineage/);
      const preserved = new DatabaseSync(fixture.service.store.path);
      try { assert.deepEqual(retainedCiphertextRows(preserved), original); } finally { preserved.close(); }
    } finally { sdk.disconnect(); await fixture.close(); }
  });
});
