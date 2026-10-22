import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk, PROTOCOL_VERSION, projectEvents, type RepositoryObservation } from "../packages/sdk/src/index.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY, waitFor } from "./fixture.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";
import { createSshTarget } from "./fixtures/ssh-target.ts";
import { forbidControllerGithub, generatedRemoteGithub } from "./fixtures/remote-github.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { GeneratedFileVault } from "./fixtures/generated-vault.ts";
import { generatedRepositoryMetadata } from "./fixtures/repository-info.ts";
import { observedRepository } from "../apps/service/src/repository-metadata.ts";

test("schema-26 marker rollback preserves exact schema-25 ciphertext, keys, old observations and receipts", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-generated-gh-migration-")), path = join(root, "state.sqlite"), key = randomBytes(32);
  let store: EventStore | undefined = new EventStore(path, key);
  try {
    const observation: RepositoryObservation = {
      id: randomUUID(), scopeKey: "a".repeat(64), scopeDigest: "b".repeat(64), revision: 1, profileId: "default", projectId: "generated-project",
      workspaceId: null, env: "Remote", status: "active", actor: "user", jobId: null, access: "public", lookupBoundary: "control-plane-public",
      repository: observedRepository("https://github.com/generated/example", generatedRepositoryMetadata()), createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    };
    store.commit([{ event_type: "repository.recorded", profile_id: "default", payload: { observation } }], { id: randomUUID(), digest: "d".repeat(64), result: { id: observation.id, revision: 1 } });
    const before = store.db.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), keys = store.db.prepare("SELECT scope,payload FROM retention_keys ORDER BY scope").all();
    const receipts = store.db.prepare("SELECT profile_id,id,digest,result FROM receipts ORDER BY id").all();
    store.db.exec(`BEGIN IMMEDIATE; DROP TABLE memory_scopes; DELETE FROM retention_metadata WHERE id IN ('remote_memory_schema','remote_repository_schema','candidate_workflow_schema','candidate_execution_schema','budget_planning_schema','candidate_generation_schema','role_sequence_schema','candidate_role_schema','model_evidence_schema','owned_role_contract_schema','paste_file_schema','native_execution_schema','compound_workflow_schema','budget_winddown_schema','owned_decision_schema'); PRAGMA user_version=25;
      CREATE TRIGGER generated_remote_repository_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='remote_repository_schema'
      BEGIN SELECT RAISE(ABORT,'Generated Remote repository migration failure'); END; COMMIT;`);
    store.close(); store = undefined;
    assert.throws(() => new EventStore(path, key), /Generated Remote repository migration failure/);
    const raw = new DatabaseSync(path);
    try {
      assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, 25);
      assert.deepEqual(raw.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), before);
      assert.deepEqual(raw.prepare("SELECT scope,payload FROM retention_keys ORDER BY scope").all(), keys);
      raw.exec("DROP TRIGGER generated_remote_repository_marker");
    } finally { raw.close(); }
    store = new EventStore(path, key); assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(store.db.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), before);
    assert.deepEqual(store.db.prepare("SELECT scope,payload FROM retention_keys ORDER BY scope").all(), keys);
    assert.deepEqual(store.db.prepare("SELECT profile_id,id,digest,result FROM receipts ORDER BY id").all(), receipts);
    assert.deepEqual(projectEvents(store.events()).repositoryObservations, [observation]);
    const remote = { host: "generated.invalid", user: "generated", port: 2222, root: "/generated/root", hostFingerprint: "SHA256:generated", workerDigest: "c".repeat(64) };
    const history = store.events(), event = history.at(-1)!;
    const synthetic = (changes: Partial<RepositoryObservation>) => ({ ...event, event_type: "repository.recorded" as const, seq: event.seq + 1, id: randomUUID(), payload: { observation: { ...observation, access: "gh-cli" as const, lookupBoundary: "remote-gh-cli" as const, remote, ...changes } } });
    assert.equal(projectEvents([...history, synthetic({})]).repositoryObservations[0]?.remote?.host, remote.host);
    for (const changes of [{ remote: undefined }, { env: "Local" as const }, { access: "public" as const }, { profileId: "generated-foreign" }]) {
      assert.throws(() => projectEvents([...history, synthetic(changes)]), { code: "repository_corrupt" });
    }
  } finally { store?.close(); await rm(root, { recursive: true, force: true }); }
});

test("real service SIGKILL preserves completed Remote facts or interrupted partial jobs without replaying the original gh command", { skip: process.platform !== "darwin", timeout: 40_000 }, async () => {
  for (const mode of ["pending", "retained"] as const) {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-gh-crash-")));
    const stateDir = join(directory, "state"), local = join(directory, "local"), workspace = join(directory, "remote"), sshRoot = join(directory, "ssh"), vaultPath = join(directory, "vault.json");
    for (const path of [local, workspace, sshRoot]) await mkdir(path, { mode: 0o700 });
    await Promise.all([local, workspace].map((path) => writeFile(join(path, "fixture.txt"), "Generated repository crash witness.\n")));
    initializeGeneratedRepository(local)(["remote", "add", "origin", "https://github.com/generated/host.git"]);
    initializeGeneratedRepository(workspace)(["remote", "add", "origin", "https://github.com/generated/example.git"]);
    const ssh = await createSshTarget(sshRoot), github = await generatedRemoteGithub(directory, ssh.target), provider = await fixtureProvider();
    const controllerGithub = await forbidControllerGithub(directory);
    const child = await launchRuntimeChild({ stateDir, vaultPath, modelId: provider.modelId, baseUrl: provider.baseUrl }), sdk = await new MoguriSdk(child.connection).ready();
    let restarted: Awaited<ReturnType<typeof startService>> | undefined;
    try {
      const project = await sdk.command({ type: "project.add", path: local }), session = await sdk.sessions.create(project.id!);
      const settings = structuredClone(sdk.settings.get()!.values); settings.remote = github.target;
      await sdk.settings.update(settings, sdk.settings.get()!.revision);
      const configuration = (await sdk.projects.configuration(project.id!)).configuration;
      await sdk.projects.configure(project.id!, { ...configuration.values, remotePath: workspace, repo: { ...configuration.values.repo, githubAccess: "gh-cli" } }, configuration.revision);
      await sdk.remote.probe(); await sdk.sessions.env(session.id!, "Remote");
      if (mode === "pending") await github.configure("hold");
      const preview = (await sdk.repositories.preview(session.id!)).preview, commandId = randomUUID();
      const command = { type: "repository.refresh", sessionId: session.id!, expectedBinding: preview.bindingDigest, expectedRevision: preview.revision, confirm: true } as const;
      const refresh = await sdk.command(command, commandId);
      let pid: number | undefined;
      if (mode === "retained") assert.equal((await sdk.jobs.wait(refresh.id!)).status, "completed");
      else pid = await waitFor(() => { try { return Number(readFileSync(github.ready, "utf8")); } catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return false; throw error; } });
      await child.stop(); sdk.disconnect();
      if (pid) await waitFor(() => { try { process.kill(pid, 0); return false; } catch (error) { return error instanceof Error && "code" in error && error.code === "ESRCH"; } }, 8000);
      const vault = new GeneratedFileVault(vaultPath);
      restarted = await startService({ stateDir, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY, platform: { remote: { vault, modelsVault: vault } } });
      const current = await new MoguriSdk(restarted.connection).ready();
      try {
        const job = current.getState().snapshot!.jobs.find((job) => job.id === refresh.id)!;
        assert.equal(job.status, mode === "retained" ? "completed" : "partial");
        assert.equal(current.getState().snapshot!.repositoryObservations.length, mode === "retained" ? 1 : 0);
        await current.remote.probe(); assert.equal((await current.command(command, commandId)).id, refresh.id);
        assert.equal((await github.records()).length, 1); assert.equal(provider.requests.length, 0);
        if (mode === "retained") {
          const state = (await current.repositories.state(session.id!)).observation!;
          assert.deepEqual(state.remote, preview.remote); assert.equal(state.repository?.visibility, "private");
        }
      } finally { current.disconnect(); }
    } finally { try { sdk.disconnect(); await child.stop(); await restarted?.close(); await ssh.close(); await provider.close(); await rm(directory, { recursive: true, force: true }); } finally { controllerGithub.restore(); } }
  }
});
