import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY, setupFixture, waitFor } from "./fixture.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";
import { retainedCiphertextRows } from "./fixtures/legacy-state.ts";

test("schema 61 upgrades atomically without rewriting retained history, and a failed marker leaves it reopenable", async () => {
  const fixture = await setupFixture(), path = fixture.service.store.path;
  let store: EventStore | undefined;
  try {
    await fixture.service.close();
    const db = new DatabaseSync(path);
    db.exec("BEGIN IMMEDIATE; DELETE FROM retention_metadata WHERE id IN ('session_kupo_kanban_schema','automatic_kupo_schema','project_kanban_schema'); PRAGMA user_version=61; COMMIT;");
    const before = retainedCiphertextRows(db);
    db.exec("CREATE TRIGGER generated_kanban_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='project_kanban_schema' BEGIN SELECT RAISE(ABORT,'Generated Kanban migration failure'); END;");
    db.close();
    assert.throws(() => new EventStore(path, fixture.retentionKey), /Generated Kanban migration failure/);
    const failed = new DatabaseSync(path);
    assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 61);
    assert.deepEqual(retainedCiphertextRows(failed), before);
    failed.exec("DROP TRIGGER generated_kanban_failure"); failed.close();
    store = new EventStore(path, fixture.retentionKey);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(store.db), before);
  } finally { store?.close(); await fixture.close(); }
});

test("actual controller SIGKILL keeps the source, isolated root and unknown model hold without replaying a task or lost receipt", { skip: process.platform !== "darwin", timeout: 40000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-kanban-crash-")), provider = await fixtureProvider();
  const child = await launchRuntimeChild({ stateDir: join(directory, "state"), vaultPath: join(directory, "vault.json"),
    modelId: provider.modelId, baseUrl: provider.baseUrl, projectWork: true });
  const fixture = child.projectWorkFixture;
  if (!fixture) { await child.stop(); await provider.close(); throw new Error("Generated owned-work recovery fixture was not acknowledged."); }
  assert.equal(dirname(fixture.directory), resolve(".moguri", "qualification"));
  assert.match(basename(fixture.directory), /^generated-github-service-[a-f0-9-]{36}$/);
  const sdk = await new MoguriSdk(child.connection).ready(); let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const origin = sdk.getState().snapshot!.sessions.find((session) => session.id === fixture.sessionId)!;
    await sdk.sessions.configure(origin.id, { ...origin.controls, modelId: provider.modelId });
    const card = await sdk.issues.create(fixture.projectId, { title: "Generated durable task", body: "generated slow crash task", kind: "feature", phaseId: "backlog", pullRequestUrl: null });
    const started = await sdk.kanban.continue(origin.id, card.id!);
    await waitFor(() => provider.requests.length === 1, 15000);
    const before = (await sdk.kanban.work(started.id!)).run;
    const reservation = await waitFor(() => sdk.getState().snapshot?.budgetEntries.find((entry) => entry.sessionId === before.sessionId &&
      entry.modelId === provider.modelId && entry.status === "reserved" && entry.reservedTokens !== null && entry.reservedTokens > 0), 15000);
    await child.stop(); sdk.disconnect();
    restarted = await startService({ stateDir: fixture.stateDir, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY,
      platform: { github: { runProgram: async () => { throw new Error("Generated restart forbids new Git/GitHub execution."); } } } });
    const peer = await new MoguriSdk(restarted.connection).ready();
    try {
      const read = await peer.kanban.work(before.id);
      assert.equal(read.run.status, "partial");
      assert.equal(read.run.workspaceId, before.workspaceId);
      assert.equal(read.run.sessionId, before.sessionId);
      assert.match(read.text, /generated slow crash task/);
      const recovered = peer.getState().snapshot!.budgetEntries.find((entry) => entry.id === reservation.id);
      assert.ok(recovered);
      assert.equal(recovered.status, "unknown");
      assert.equal(recovered.reservedTokens, reservation.reservedTokens);
      assert.equal(provider.requests.length, 1);
      restarted.store.db.prepare("DELETE FROM receipts WHERE id=?").run(before.commandId);
      await assert.rejects(() => restarted!.controller.dispatch({ id: before.commandId, profileId: "default",
        command: { type: "project.work.start", sessionId: origin.id, issueId: card.id } }), { code: "project_work_no_replay" });
      assert.equal(provider.requests.length, 1);
      assert.equal(peer.getState().snapshot!.managedWorkspaces.length, 1);
    } finally { peer.disconnect(); }
  } finally {
    sdk.disconnect(); await child.stop(); await restarted?.close(); await provider.close();
    await rm(fixture.directory, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});
