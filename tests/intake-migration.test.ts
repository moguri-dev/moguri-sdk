import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { EventStore } from "../apps/service/src/store.ts";
import { MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { removeIntakeFixtureMarkers, retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("genuine83 upgrades all distinct84 markers atomically without changing ciphertext or receipts", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let reopened: EventStore | undefined;
  try {
    const rows = retainedCiphertextRows(fixture.service.store.db), events = fixture.service.controller.events(0);
    await fixture.service.close();
    const raw = new DatabaseSync(path); removeIntakeFixtureMarkers(raw, events);
    raw.exec("PRAGMA user_version=83; CREATE TRIGGER generated_intake_upgrade BEFORE INSERT ON retention_metadata WHEN NEW.id='scheduled_prompts_schema' BEGIN SELECT RAISE(ABORT,'Generated intake migration interruption'); END"); raw.close();
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated intake migration interruption/);
    const interrupted = new DatabaseSync(path);
    assert.equal(interrupted.prepare("PRAGMA user_version").get()?.user_version, 83);
    assert.equal(interrupted.prepare("SELECT value FROM retention_metadata WHERE id='model_failure_recovery_schema'").get(), undefined);
    assert.deepEqual(retainedCiphertextRows(interrupted), rows);
    interrupted.exec("DROP TRIGGER generated_intake_upgrade"); interrupted.close();
    reopened = new EventStore(path, fixture.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    for (const id of ["model_failure_recovery_schema", "scheduled_prompts_schema", "kupo_modes_schema",
      "work_item_comments_schema", "repository_script_review_schema", "workflow_commands_schema", "tool_preferences_schema",
      "session_request_recovery_schema", "builtin_git_schema"]) assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(id)?.value, "1");
    assert.deepEqual(retainedCiphertextRows(reopened.db), rows);
    reopened.close(); reopened = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(retainedCiphertextRows(reopened.db), rows);
  } finally { reopened?.close(); await fixture.close(); }
});

for (const mode of ["missing", "downgrade"] as const) test(`actual scheduled history rejects ${mode} marker lineage without rewriting state`, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), path = fixture.service.store.path;
  try {
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated genuine84 scheduled history.", attachments: [] });
    await sdk.scheduledPrompts.create(fixture.sessionId, { kind: "delay", minutes: 5, timeZone: "UTC" });
    const events = fixture.service.controller.events(0), rows = retainedCiphertextRows(fixture.service.store.db);
    sdk.disconnect(); await fixture.service.close();
    const raw = new DatabaseSync(path);
    assert.throws(() => removeIntakeFixtureMarkers(raw, events), /genuine pre-84/);
    raw.exec(mode === "missing" ? "DELETE FROM retention_metadata WHERE id='scheduled_prompts_schema'" :
      "DELETE FROM retention_metadata WHERE id IN ('model_failure_recovery_schema','scheduled_prompts_schema','kupo_modes_schema'); PRAGMA user_version=83"); raw.close();
    assert.throws(() => new EventStore(path, fixture.retentionKey), mode === "missing" ? /recovery\/scheduling\/Kupo.*marker/ : /pre-84 lineage/);
    const preserved = new DatabaseSync(path); assert.deepEqual(retainedCiphertextRows(preserved), rows); preserved.close();
  } finally { sdk.disconnect(); await fixture.close(); }
});
