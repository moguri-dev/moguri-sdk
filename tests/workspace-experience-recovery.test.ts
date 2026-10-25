import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";

test("schema-58 upgrade preserves ciphertext, receipts, session identities and default-off skill sources across restart", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const command = { type: "draft.save" as const, sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated retained upgrade draft.", attachments: [] };
    await sdk.command(command, "generated-experience-upgrade");
    const before = retainedCiphertextRows(fixture.service.store.db);
    const preserved = (store: EventStore) => {
      const after = retainedCiphertextRows(store.db);
      before.forEach(([table, rows], index) => {
        assert.equal(after[index]![0], table);
        assert.deepEqual(table === "events" ? after[index]![1].slice(0, rows.length) : after[index]![1], rows);
      });
    };
    sdk.disconnect(); await writeLegacyState(fixture.service, 58);
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    assert.equal(restarted.store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    preserved(restarted.store);
    assert.equal(restarted.controller.snapshot().sessions[0]!.id, fixture.sessionId);
    assert.equal(restarted.controller.snapshot().sessions[0]!.draft.text, command.text);
    assert.deepEqual(restarted.controller.snapshot().settings.values.skillSources, []);
    await restarted.close(); restarted = undefined;
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    preserved(restarted.store);
    assert.ok(restarted.store.db.prepare("SELECT id FROM receipts WHERE id='generated-experience-upgrade'").get());
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("a failed schema-59 migration rolls back its marker and version without rewriting retained data", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  try {
    await writeLegacyState(fixture.service, 58);
    const raw = new DatabaseSync(path), before = retainedCiphertextRows(raw);
    raw.exec("CREATE TRIGGER generated_experience_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='workspace_experience_schema' BEGIN SELECT RAISE(ABORT,'Generated experience migration failure'); END");
    raw.close();
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated experience migration failure/);
    const after = new DatabaseSync(path);
    try {
      assert.equal(after.prepare("PRAGMA user_version").get()?.user_version, 58);
      assert.equal(after.prepare("SELECT value FROM retention_metadata WHERE id='workspace_experience_schema'").get(), undefined);
      assert.deepEqual(retainedCiphertextRows(after), before);
      after.exec("DROP TRIGGER generated_experience_failure");
    } finally { after.close(); }
    const upgraded = new EventStore(path, fixture.retentionKey);
    try { assert.equal(upgraded.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION); assert.deepEqual(retainedCiphertextRows(upgraded.db), before); }
    finally { upgraded.close(); }
  } finally { await fixture.close(); }
});
