import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EventStore, inboxSkillSchemaMarkers, skillsRewindSchemaMarkers } from "../apps/service/src/store.ts";
import { MoguriSdk, PROTOCOL_VERSION, projectEvents } from "../packages/sdk/src/index.ts";
import { admitGeneratedSkill, setupFixture } from "./fixture.ts";
import { removeInboxSkillFixtureMarkers, retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("genuine98 upgrades Inbox/load markers atomically without changing original checkpoint ciphertext, owners, draft or accounting", async () => {
  const f = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(f.service.connection).ready();
  let reopened: EventStore | undefined;
  try {
    await f.configure(); await f.send("Generated genuine98 checkpoint."); await f.terminal();
    await sdk.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: f.session().draft.revision, text: "Generated genuine98 unsent draft.", attachments: [] });
    const snapshot = f.service.controller.snapshot(), events = f.service.controller.events(0), path = f.service.store.path;
    sdk.disconnect(); await f.service.close();
    const raw = new DatabaseSync(path); removeInboxSkillFixtureMarkers(raw, events); raw.exec("PRAGMA user_version=98");
    const original = retainedCiphertextRows(raw);
    raw.exec("CREATE TRIGGER generated99_interruption BEFORE INSERT ON retention_metadata WHEN NEW.id='explicit_skill_load_schema' BEGIN SELECT RAISE(ABORT,'Generated atomic99 interruption'); END"); raw.close();
    assert.throws(() => new EventStore(path, f.retentionKey), /Generated atomic99 interruption/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 98);
      for (const marker of inboxSkillSchemaMarkers) assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker), undefined);
      for (const marker of skillsRewindSchemaMarkers) assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker)?.value, "1");
      assert.deepEqual(retainedCiphertextRows(failed), original); failed.exec("DROP TRIGGER generated99_interruption");
    } finally { failed.close(); }
    reopened = new EventStore(path, f.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    for (const marker of inboxSkillSchemaMarkers) assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker)?.value, "1");
    const projected = projectEvents(reopened.events());
    assert.deepEqual(projected.checkpoints, snapshot.checkpoints); assert.deepEqual(projected.budgetEntries, snapshot.budgetEntries);
    assert.equal(projected.sessions[0]?.draft.text, "Generated genuine98 unsent draft."); assert.equal(f.requests.length, 1);
  } finally { reopened?.close(); sdk.disconnect(); await f.close(); }
});

for (const variant of ["missing", "corrupt", "premature", "deleted-downgrade", "forgotten-downgrade", "skill-downgrade"] as const) {
  test(`invalid99 ${variant} cannot rewrite state or manufacture older Inbox/skill history`, async () => {
    const f = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(f.service.connection).ready();
    try {
      if (variant.includes("downgrade")) {
        await f.configure(); await f.send("Generated original Inbox owner."); await f.terminal(); await sdk.refresh();
        if (variant === "skill-downgrade") {
          const path = join(f.project, "SKILL.md"); await writeFile(path, "---\nname: generated99-load\ndescription: Generated original source\n---\nGenerated immutable instructions.\n");
          const imported = await sdk.capabilities.importSkill(f.session().projectId, path); await sdk.capabilities.toggle(imported.id!, true, 0);
          const skill = sdk.getState().snapshot!.registry.find((entry) => entry.id === imported.id)!;
          await admitGeneratedSkill(sdk, f.sessionId, skill.id, skill.contentDigest); await sdk.skills.consume(f.sessionId, skill.id, skill.contentDigest);
        } else {
          await sdk.attention.delete([sdk.attention.list()[0]!.id]);
          if (variant === "forgotten-downgrade") await sdk.sessions.delete(f.sessionId, true, f.session().revision);
        }
      }
      sdk.disconnect(); await f.service.close();
      const raw = new DatabaseSync(f.service.store.path);
      if (variant === "missing") raw.prepare("DELETE FROM retention_metadata WHERE id=?").run(inboxSkillSchemaMarkers[0]);
      if (variant === "corrupt") raw.prepare("UPDATE retention_metadata SET value='0' WHERE id=?").run(inboxSkillSchemaMarkers[1]);
      if (variant === "premature") raw.exec("PRAGMA user_version=98");
      if (variant.includes("downgrade")) raw.exec("DELETE FROM retention_metadata WHERE id IN ('session_inbox_schema','explicit_skill_load_schema'); PRAGMA user_version=98");
      const original = retainedCiphertextRows(raw); raw.close();
      assert.throws(() => new EventStore(f.service.store.path, f.retentionKey), /Inbox|skill.load|pre-99/i);
      const preserved = new DatabaseSync(f.service.store.path);
      try { assert.deepEqual(retainedCiphertextRows(preserved), original); } finally { preserved.close(); }
    } finally { sdk.disconnect(); await f.close(); }
  });
}
