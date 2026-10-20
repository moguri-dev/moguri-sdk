import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, fixtureProvider, GENERATED_RETENTION_KEY, waitFor } from "./fixture.ts";
import { assertCurrentSchema, writeLegacyState } from "./fixtures/legacy-state.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";
import { createSshTarget } from "./fixtures/ssh-target.ts";
import { GeneratedFileVault } from "./fixtures/generated-vault.ts";

test("schema 19 upgrades Remote plan authority without rewriting old ciphertext, receipts, grants or artifact actors", async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const document = await sdk.artifacts.create(f.sessionId, { kind: "plan", name: "Generated legacy plan", text: "Generated schema-19 retained text." });
    sdk.disconnect(); await writeLegacyState(f.service, 19);
    const old = new DatabaseSync(f.service.store.path);
    const events = old.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), receipts = old.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all();
    const grants = old.prepare("SELECT * FROM blob_payloads ORDER BY digest,scope").all(), keys = old.prepare("SELECT * FROM retention_keys ORDER BY scope").all(); old.close();
    restarted = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    const current = await new MoguriSdk(restarted.connection).ready();
    try {
      assertCurrentSchema(restarted.store);
      assert.deepEqual(restarted.store.db.prepare("SELECT seq,id,data,payload FROM events WHERE seq<=? ORDER BY seq").all(Number(events.at(-1)!.seq)), events);
      assert.deepEqual(restarted.store.db.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all(), receipts);
      assert.deepEqual(restarted.store.db.prepare("SELECT * FROM blob_payloads ORDER BY digest,scope").all(), grants);
      assert.deepEqual(restarted.store.db.prepare("SELECT * FROM retention_keys ORDER BY scope").all(), keys);
      assert.equal((await current.artifacts.read(document.id!)).text, "Generated schema-19 retained text.");
      assert.deepEqual((await current.plans.saves(f.sessionId)).saves, []); assert.equal(f.requests.length, 0);
    } finally { current.disconnect(); }
  } finally { sdk.disconnect(); await restarted?.close(); await f.close(); }
});

test("failed schema-20 plan marker leaves schema-19 data unchanged and usable", async () => {
  const f = await setupFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await writeLegacyState(f.service, 19);
    const old = new DatabaseSync(f.service.store.path);
    const events = old.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), receipts = old.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all();
    old.exec(`CREATE TRIGGER generated_plan_migration_failure BEFORE INSERT ON retention_metadata
      WHEN NEW.id='remote_plan_save_schema' BEGIN SELECT RAISE(ABORT,'Generated Remote plan migration interruption'); END;`); old.close();
    const options = { stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey };
    await assert.rejects(() => startService(options), /Generated Remote plan migration interruption/);
    const preserved = new DatabaseSync(f.service.store.path);
    try {
      assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 19);
      assert.deepEqual(preserved.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), events);
      assert.deepEqual(preserved.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all(), receipts);
      assert.equal(preserved.prepare("SELECT id FROM retention_metadata WHERE id='remote_plan_save_schema'").get(), undefined);
      preserved.exec("DROP TRIGGER generated_plan_migration_failure");
    } finally { preserved.close(); }
    restarted = await startService(options); assertCurrentSchema(restarted.store); assert.equal(f.requests.length, 0);
  } finally { await restarted?.close(); await f.close(); }
});

test("real control-plane SIGKILL before authorization or result receipt preserves exact plan intent without replay", { skip: process.platform !== "darwin", timeout: 45_000 }, async () => {
  for (const holdUserPlan of ["approval", "result"] as const) {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-plan-crash-")));
    const stateDir = join(directory, "state"), project = join(directory, "local"), workspace = join(directory, "remote"), sshRoot = join(directory, "ssh"), vaultPath = join(directory, "generated-vault.json");
    for (const path of [project, workspace, sshRoot]) await mkdir(path, { mode: 0o700 });
    const ssh = await createSshTarget(sshRoot), provider = await fixtureProvider({ exposeModels: true });
    const child = await launchRuntimeChild({ stateDir, vaultPath, modelId: provider.modelId, baseUrl: provider.baseUrl, holdUserPlan });
    const sdk = await new MoguriSdk(child.connection).ready();
    let restarted: Awaited<ReturnType<typeof startService>> | undefined;
    try {
      const bound = await sdk.command({ type: "project.add", path: project }), created = await sdk.sessions.create(bound.id!);
      const settings = structuredClone(sdk.settings.get()!.values); settings.remote = { ...ssh.target, allowCopilot: false };
      await sdk.settings.update(settings, sdk.settings.get()!.revision);
      const configuration = (await sdk.projects.configuration(bound.id!)).configuration;
      await sdk.projects.configure(bound.id!, { ...configuration.values, remotePath: workspace }, configuration.revision);
      await sdk.remote.probe();
      const session = sdk.getState().snapshot!.sessions.find((value) => value.id === created.id)!;
      await sdk.sessions.configure(session.id, { ...session.controls, env: "Remote", modelId: null });
      const text = "Generated exact plan across a real control-plane crash.\n";
      const binding = (await sdk.plans.read(session.id)).bindingDigest;
      const pending = sdk.plans.save(session.id, text, "absent", binding).then((result) => ({ result }), (error: unknown) => ({ error }));
      await waitFor(() => child.heldExecution);
      const intent = (await sdk.plans.saves(session.id)).saves[0]!;
      if (holdUserPlan === "result") assert.equal(await readFile(join(workspace, "docs/plan.md"), "utf8"), text);
      await child.stop(); sdk.disconnect();
      assert.ok("error" in await pending);
      const vault = new GeneratedFileVault(vaultPath);
      restarted = await startService({ stateDir, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY, platform: { remote: { vault, modelsVault: vault } } });
      const current = await new MoguriSdk(restarted.connection).ready();
      try {
        const before = (await current.plans.saveInfo(session.id, intent.id)).save;
        assert.equal(before.status, "partial"); assert.equal(before.artifactId, null);
        assert.equal(before.fileOutcome, holdUserPlan === "result" ? "unconfirmed" : "not-started");
        await assert.rejects(() => restarted!.controller.dispatch({ id: intent.commandId, profileId: "default", command: { type: "plan.save", sessionId: session.id, text, expectedDigest: "absent", expectedBinding: binding } }), /recorded|replayed|partial/i);
        const execution = restarted.controller.snapshot().executions.find((value) => value.id === intent.executionId)!;
        let settled = false;
        for (let index = 0; index < 80; index++) {
          const inspection = await restarted.controller.remote.inspect(execution);
          if (inspection.status.cleanup === "owned-worker-stopped") { settled = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.equal(settled, true);
        await current.remote.reconcile(execution.id);
        const after = (await current.plans.saveInfo(session.id, intent.id)).save;
        assert.equal(after.status, "partial");
        if (holdUserPlan === "result") {
          assert.equal(after.fileOutcome, "written"); assert.ok(after.artifactId);
          const artifact = await current.artifacts.read(after.artifactId!);
          assert.equal(artifact.text, text); assert.equal(artifact.artifact.sources[0]?.boundary?.root, workspace);
          assert.ok(artifact.artifact.sources[0]?.boundary?.frame);
        } else {
          assert.equal(after.fileOutcome, "not-started");
          await assert.rejects(() => readFile(join(workspace, "docs/plan.md")), { code: "ENOENT" });
        }
        assert.equal(restarted.controller.snapshot().executions.length, 1);
        assert.equal(restarted.controller.snapshot().sessions.find((value) => value.id === session.id)?.status, "partial");
        assert.equal(provider.requests.length, 0); assert.equal(restarted.controller.snapshot().budgetEntries.length, 0);
      } finally { current.disconnect(); }
    } finally { sdk.disconnect(); await child.stop(); await restarted?.close(); await ssh.close(); await provider.close(); await rm(directory, { recursive: true, force: true }); }
  }
});
