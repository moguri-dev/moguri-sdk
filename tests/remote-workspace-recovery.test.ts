import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { profileFixture } from "./fixtures/profiles.ts";
import { writeLegacyState } from "./fixtures/legacy-state.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";
import { envelope } from "../apps/service/src/controller.ts";

test("schema 16 upgrades workspace reads without rewriting scoped ciphertexts, receipts or retained grants", async () => {
  const fixture = await profileFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const { client: beta, profile } = await fixture.create("Generated remote-view migration Beta");
    const session = await beta.sessions.create(null, "Generated retained migration chat");
    const document = await beta.artifacts.create(session.id!, { kind: "plan", name: "Generated preserved plan", text: "Generated unchanged schema-16 retained bytes." });
    for (const client of fixture.clients) client.disconnect();
    await writeLegacyState(fixture.service, 16);
    const previous = new DatabaseSync(fixture.service.store.path);
    const events = previous.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), receipts = previous.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all();
    const blobs = previous.prepare("SELECT * FROM blob_payloads ORDER BY digest,scope").all(), keys = previous.prepare("SELECT * FROM retention_keys ORDER BY scope").all();
    previous.close();
    restarted = await startService(fixture.options);
    const sdk = await new MoguriSdk(restarted.connection).ready(), scoped = await sdk.profiles.open(profile.id);
    try {
      const db = restarted.store.db;
      assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
      assert.deepEqual(db.prepare("SELECT seq,id,data,payload FROM events WHERE seq<=? ORDER BY seq").all(Number(events.at(-1)!.seq)), events);
      assert.deepEqual(db.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all(), receipts);
      assert.deepEqual(db.prepare("SELECT * FROM blob_payloads ORDER BY digest,scope").all(), blobs);
      assert.deepEqual(db.prepare("SELECT * FROM retention_keys ORDER BY scope").all(), keys);
      assert.equal((await scoped.artifacts.read(document.id!)).text, "Generated unchanged schema-16 retained bytes.");
      assert.equal(fixture.providers.reduce((count, provider) => count + provider.requests.length, 0), 0);
    } finally { sdk.disconnect(); scoped.disconnect(); }
  } finally { await restarted?.close(); await fixture.close(); }
});

test("a failed schema-17 marker transaction leaves schema-16 state usable without deleting or replaying data", async () => {
  const fixture = await setupFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await writeLegacyState(fixture.service, 16);
    const old = new DatabaseSync(fixture.service.store.path);
    const rows = old.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), receipts = old.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all();
    old.exec(`CREATE TRIGGER generated_remote_read_migration_failure BEFORE INSERT ON retention_metadata
      WHEN NEW.id='remote_workspace_read_schema' BEGIN SELECT RAISE(ABORT,'Generated remote-view migration interruption'); END;`);
    old.close();
    const options = { stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey };
    await assert.rejects(() => startService(options), /Generated remote-view migration interruption/);
    const preserved = new DatabaseSync(fixture.service.store.path);
    try {
      assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 16);
      assert.deepEqual(preserved.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), rows);
      assert.deepEqual(preserved.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all(), receipts);
      assert.equal(preserved.prepare("SELECT id FROM retention_metadata WHERE id='remote_workspace_read_schema'").get(), undefined);
      preserved.exec("DROP TRIGGER generated_remote_read_migration_failure");
    } finally { preserved.close(); }
    restarted = await startService(options);
    assert.equal(restarted.store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.equal(restarted.controller.snapshot().sessions[0]?.id, fixture.sessionId); assert.equal(fixture.requests.length, 0);
  } finally { await restarted?.close(); await fixture.close(); }
});

test("the current SSH inspector verifies generated authenticated protocol-16/17/18/19 receipts without attaching or replaying the legacy worker", { skip: process.platform !== "darwin", timeout: 15_000 }, async () => {
  const fixture = await remoteFixture();
  try {
    await fixture.probe(); await fixture.select(); await fixture.send("Generated legacy-inspection reply.");
    await waitFor(() => fixture.session().status === "completed");
    const execution = await waitFor(() => fixture.controller.snapshot().executions.find((value) => value.cleanup === "owned-worker-stopped"));
    const key = fixture.secrets.get(execution.id)!; assert.ok(key);
    const path = join(execution.target.stateDir, execution.id, "status.json"), saved = JSON.parse(await readFile(path, "utf8"));
    for (const protocol of [16, 17, 18, 19]) {
      saved.info.protocol = protocol;
      saved.proof = createHmac("sha256", Buffer.from(key, "hex")).update(JSON.stringify({ status: saved.status, info: saved.info })).digest("hex");
      await writeFile(path, JSON.stringify(saved), { mode: 0o600 });
      await fixture.controller.dispatch(envelope({ type: "remote.reconcile", executionId: execution.id }));
      assert.equal(fixture.requests.length, 1); assert.equal(fixture.session().usage.length, 1); assert.equal(fixture.session().status, "completed");
      await assert.rejects(() => fixture.controller.remote.query(execution.target, {
        action: "attach", protocol: PROTOCOL_VERSION, workerDigest: execution.workerDigest, root: execution.workspace,
        stateDir: execution.target.stateDir, runId: execution.id, key, after: execution.lastSequence,
      }, AbortSignal.timeout(5000)), /inspection only|reattached|resumed/);
    }
    assert.equal(fixture.requests.length, 1);
  } finally { await fixture.close(); }
});
