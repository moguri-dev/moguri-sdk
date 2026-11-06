import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore, githubPrCiSchemaMarker } from "../apps/service/src/store.ts";
import { factoryControls, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { githubApplicationFixture } from "./github-workflows-fixture.ts";

const retained = (db: DatabaseSync) => ({
  events: db.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(),
  keys: db.prepare("SELECT * FROM retention_keys ORDER BY scope").all(),
  blobs: db.prepare("SELECT * FROM blob_payloads ORDER BY scope,digest").all(),
  receipts: db.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all(),
});
test("genuine92 CI-watch upgrade is atomic and leaves original encrypted history, grants and receipts unchanged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-ci-migration-")), path = join(directory, "state.sqlite"), key = Buffer.alloc(32, 0x63);
  let reopened: EventStore | undefined;
  try {
    const store = new EventStore(path, key), content = store.putBlob("Generated original retained draft.");
    store.commit([
      { event_type: "session.created", profile_id: "default", session_id: "source", payload: { title: "Generated original CI user", controls: factoryControls() } },
      { event_type: "draft.saved", profile_id: "default", session_id: "source", payload: { text: "Generated retained draft.", attachments: [
        { id: "generated-file", kind: "project_file", path: "fixture.txt", digest: content, bytes: Buffer.byteLength("Generated original retained draft.") },
      ] } },
    ], { id: "generated-original-command", digest: "generated-original-digest", result: { id: "source" } });
    store.close();
    const raw = new DatabaseSync(path);
    raw.prepare("DELETE FROM retention_metadata WHERE id=?").run(githubPrCiSchemaMarker); raw.exec("PRAGMA user_version=92");
    const original = retained(raw);
    raw.exec("CREATE TRIGGER generated_ci_upgrade_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='github_pr_ci_watch_schema' BEGIN SELECT RAISE(ABORT,'Generated CI migration interruption'); END"); raw.close();
    assert.throws(() => new EventStore(path, key), /Generated CI migration interruption/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 92);
      assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id=?").get(githubPrCiSchemaMarker), undefined);
      assert.deepEqual(retained(failed), original);
      failed.exec("DROP TRIGGER generated_ci_upgrade_failure");
    } finally { failed.close(); }
    reopened = new EventStore(path, key);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(githubPrCiSchemaMarker)?.value, "1");
    assert.deepEqual(retained(reopened.db), original);
    reopened.close(); reopened = new EventStore(path, key);
    assert.deepEqual(retained(reopened.db), original);
  } finally { reopened?.close(); await rm(directory, { recursive: true, force: true }); }
});
test("missing and corrupt current CI markers fail closed without rewriting state", async (t) => {
  for (const change of ["missing", "corrupt", "premature"] as const) await t.test(change, async () => {
    const directory = await mkdtemp(join(tmpdir(), "moguri-generated-ci-lineage-")), path = join(directory, "state.sqlite"), key = Buffer.alloc(32, 0x63);
    try {
      new EventStore(path, key).close(); const raw = new DatabaseSync(path);
      if (change === "missing") raw.prepare("DELETE FROM retention_metadata WHERE id=?").run(githubPrCiSchemaMarker);
      else if (change === "corrupt") raw.prepare("UPDATE retention_metadata SET value='0' WHERE id=?").run(githubPrCiSchemaMarker);
      else raw.exec("PRAGMA user_version=92");
      const original = retained(raw); raw.close();
      assert.throws(() => new EventStore(path, key), /CI.watch schema/i);
      const preserved = new DatabaseSync(path);
      try { assert.deepEqual(retained(preserved), original); } finally { preserved.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
test("actual retained PR ownership and CI attention cannot be relabelled as protocol92 history", { timeout: 30_000 }, async () => {
  const key = Buffer.alloc(32, 0x63), f = await githubApplicationFixture({ retentionKey: key });
  try {
    const project = await f.sdk.github.project(f.scope), source = { kind: "pull" as const, number: 11,
      repository: project.repository, account: project.account, accountId: project.accountId };
    const preview = await f.sdk.github.previewCi(f.scope, source, { timeoutMs: 1000, pollMs: 50 });
    const started = await f.sdk.github.execute(preview, preview.document.confirmations, true);
    await f.sdk.github.wait(started.id!, { timeoutMs: 5000 });
    f.service.controller.store.db.prepare("DELETE FROM retention_metadata WHERE id=?").run(githubPrCiSchemaMarker);
    f.service.controller.store.db.exec("PRAGMA user_version=92");
    assert.throws(() => new EventStore(f.service.controller.store.path, key), /CI.watch history.*pre-93/i);
  } finally { await f.close(); }
});
