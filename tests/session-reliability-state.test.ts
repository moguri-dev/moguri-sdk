import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { EventStore } from "../apps/service/src/store.ts";
import { MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("schema 64 upgrades session reliability atomically without rewriting history or inventing approvals", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let reopened: EventStore | undefined;
  try {
    const before = retainedCiphertextRows(fixture.service.store.db);
    await fixture.service.close();
    const raw = new DatabaseSync(path);
    try {
      raw.exec("DELETE FROM retention_metadata WHERE id IN ('side_context_schema','retained_telemetry_schema','session_reliability_schema'); PRAGMA user_version=64; CREATE TRIGGER generated_reliability_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='session_reliability_schema' BEGIN SELECT RAISE(ABORT,'Generated reliability migration interruption'); END;");
    } finally { raw.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated reliability migration interruption/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 64);
      assert.deepEqual(retainedCiphertextRows(failed), before);
      failed.exec("DROP TRIGGER generated_reliability_failure");
    } finally { failed.close(); }
    reopened = new EventStore(path, fixture.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(reopened.db), before);
    reopened.close(); reopened = new EventStore(path, fixture.retentionKey);
    assert.deepEqual(retainedCiphertextRows(reopened.db), before);
  } finally { reopened?.close(); await fixture.close(); }
});

test("current reliability metadata is required and cannot be relabelled as older history", async (t) => {
  for (const sql of ["DELETE FROM retention_metadata WHERE id='session_reliability_schema'",
    "UPDATE retention_metadata SET value='0' WHERE id='session_reliability_schema'", "PRAGMA user_version=64"]) await t.test(sql, async () => {
    const fixture = await setupFixture(), path = fixture.service.store.path;
    try {
      await fixture.service.close(); const raw = new DatabaseSync(path);
      try { if (sql.startsWith("PRAGMA")) raw.exec("DELETE FROM retention_metadata WHERE id IN ('side_context_schema','retained_telemetry_schema')"); raw.exec(sql); } finally { raw.close(); }
      assert.throws(() => new EventStore(path, fixture.retentionKey), /session reliability.*(marker|lineage)/);
    } finally { await fixture.close(); }
  });
});

test("captured multi-repository history cannot be relabelled as schema 64 after removing its new marker", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), path = fixture.service.store.path;
  try {
    const folder = await sdk.projects.folder("Generated captured-root lineage");
    const configuration = (await sdk.projects.configuration(fixture.session().projectId)).configuration;
    await sdk.projects.organize(configuration.projectId, { folderId: folder.id!, order: 0, color: configuration.color }, configuration.revision);
    await sdk.sessions.createFolder(folder.id!);
    sdk.disconnect(); await fixture.service.close();
    const raw = new DatabaseSync(path);
    try { raw.exec("DELETE FROM retention_metadata WHERE id IN ('side_context_schema','retained_telemetry_schema','session_reliability_schema'); PRAGMA user_version=64;"); } finally { raw.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Session reliability history cannot be relabelled.*original schema marker/);
  } finally { sdk.disconnect(); await fixture.close(); }
});
