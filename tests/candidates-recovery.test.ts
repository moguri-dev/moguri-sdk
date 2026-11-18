import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MoguriSdk, type CandidatePatch, type Command } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { digest } from "../apps/service/src/store.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY, waitFor } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";
import { GeneratedFileVault } from "./fixtures/generated-vault.ts";

test("actual service SIGKILL during candidate deletion resumes exact cleanup, preserves partial code/quarantine and cannot resurrect lost intents", { timeout: 60_000 }, async (t) => {
  for (const mode of ["stage-before", "apply-after-first"] as const) {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-candidate-cleanup-crash-"))), projectRoot = join(directory, "project"), stateDir = join(directory, "state"), vaultPath = join(directory, "vault.json");
    await mkdir(projectRoot, { mode: 0o700 });
    const original = "Generated cleanup crash base.\n", proposed = "Generated cleanup crash proposal.\n";
    for (const path of ["one.txt", "two.txt"]) await writeFile(join(projectRoot, path), original);
    const git = initializeGeneratedRepository(projectRoot, ["one.txt", "two.txt"]), head = git(["rev-parse", "HEAD"]), index = await readFile(join(projectRoot, ".git/index"));
    const provider = await fixtureProvider();
    const child = await launchRuntimeChild({ stateDir, vaultPath, modelId: provider.modelId, baseUrl: provider.baseUrl, holdCandidate: mode });
    const sdk = await new MoguriSdk(child.connection).ready(); let restarted: Awaited<ReturnType<typeof startService>> | undefined;
    try {
      const project = await sdk.command({ type: "project.add", path: projectRoot });
      const session = await sdk.command({ type: "session.create", projectId: project.id!, workspaceMode: "checkout" });
      const workspace = await sdk.workspaces.wait((await sdk.workspaces.create(project.id!, "moguri/generated-cleanup-crash")).id!);
      const patch: CandidatePatch = { kind: "patch", summary: "Generated interrupted cleanup.", edits: ["one.txt", "two.txt"].map((path) => ({ path, baseDigest: digest(original), text: proposed })) };
      const preview = (await sdk.candidates.preview(session.id!, workspace.id, patch)).preview, commandId = randomUUID();
      const command: Command = { type: "candidate.stage", sessionId: session.id!, stageWorkspaceId: workspace.id, patch, expectedDigest: preview.digest, confirm: true };
      const staged = await sdk.command(command, commandId);
      if (mode === "apply-after-first") {
        const ready = await sdk.candidates.wait(staged.id!), review = (await sdk.candidates.applyPreview(staged.id!, session.id!)).preview;
        await sdk.candidates.apply(staged.id!, session.id!, ready.candidate.revision, review.digest);
      }
      await waitFor(() => child.heldCandidateId === staged.id);
      let settled = false;
      const deleting = sdk.sessions.delete(session.id!, true, undefined, undefined, { confirmRunning: true }).then(() => { settled = true; }, () => {});
      await waitFor(() => sdk.getState().snapshot?.candidateCleanups.some((cleanup) => cleanup.status === "pending" && cleanup.targets.includes(staged.id!)));
      assert.equal(settled, false);
      await child.stop(); await deleting; sdk.disconnect();
      const vault = new GeneratedFileVault(vaultPath);
      restarted = await startService({ stateDir, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY, platform: { terminal: { vault }, remote: { vault, modelsVault: vault } } });
      const current = await new MoguriSdk(restarted.connection).ready();
      try {
        assert.equal(current.getState().snapshot!.sessions.length, 0);
        assert.equal(current.getState().snapshot!.candidates.length, 0);
        assert.equal(current.getState().snapshot!.artifacts.length, 0);
        assert.ok(current.getState().snapshot!.candidateCleanups.some((cleanup) => cleanup.status === "completed" && cleanup.targets.includes(staged.id!)));
        assert.equal(await readFile(join(projectRoot, "one.txt"), "utf8"), mode === "apply-after-first" ? proposed : original);
        assert.equal(await readFile(join(projectRoot, "two.txt"), "utf8"), original);
        assert.deepEqual(await readFile(join(projectRoot, ".git/index")), index); assert.equal(git(["rev-parse", "HEAD"]), head);
        if (mode === "stage-before") assert.ok(current.getState().snapshot!.blockedWorkspaces.includes(workspace.id));
        else assert.ok(current.getState().snapshot!.blockedProjects.includes(project.id!));
        restarted.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run("default", commandId);
        const root = t.mock.method(restarted.controller.platform.managed, "project", () => { throw new Error("A deleted candidate must never probe or replay its filesystem."); });
        await assert.rejects(() => current.command(command, commandId), { code: "candidate_deleted" });
        assert.equal(root.mock.callCount(), 0); root.mock.restore();
        assert.deepEqual(await current.sessions.delete(session.id!, true), { id: session.id });
        assert.equal(provider.requests.length, 0);
      } finally { current.disconnect(); }
    } finally { t.mock.restoreAll(); sdk.disconnect(); await child.stop(); await restarted?.close(); await provider.close(); await rm(directory, { recursive: true, force: true }); }
  }
});

test("actual service SIGKILL retains candidate file witnesses and original commands without replaying partial or completed application", { timeout: 60_000 }, async (t) => {
  for (const mode of ["stage-before", "stage-after-first", "apply-before", "apply-after-first", "retained"] as const) {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-candidate-crash-"))), projectRoot = join(directory, "project"), stateDir = join(directory, "state"), vaultPath = join(directory, "vault.json");
    await mkdir(projectRoot, { mode: 0o700 });
    const original = "Generated candidate crash base.\n", proposed = "Generated candidate crash proposal.\n";
    for (const path of ["one.txt", "two.txt"]) await writeFile(join(projectRoot, path), original);
    const git = initializeGeneratedRepository(projectRoot, ["one.txt", "two.txt"]), head = git(["rev-parse", "HEAD"]), index = await readFile(join(projectRoot, ".git/index"));
    const provider = await fixtureProvider();
    const child = await launchRuntimeChild({ stateDir, vaultPath, modelId: provider.modelId, baseUrl: provider.baseUrl, ...(mode === "retained" ? {} : { holdCandidate: mode }) });
    const sdk = await new MoguriSdk(child.connection).ready(); let restarted: Awaited<ReturnType<typeof startService>> | undefined;
    try {
      const project = await sdk.command({ type: "project.add", path: projectRoot });
      const session = await sdk.command({ type: "session.create", projectId: project.id!, workspaceMode: "checkout" });
      const created = await sdk.workspaces.create(project.id!, "moguri/generated-crash-candidate"), workspace = await sdk.workspaces.wait(created.id!);
      const patch: CandidatePatch = { kind: "patch", summary: "Generated exact crash-recovery patch.", edits: ["one.txt", "two.txt"].map((path) => ({ path, baseDigest: digest(original), text: proposed })) };
      const preview = (await sdk.candidates.preview(session.id!, workspace.id, patch)).preview;
      const stageId = randomUUID(), stageCommand: Command = { type: "candidate.stage", sessionId: session.id!, stageWorkspaceId: workspace.id, patch, expectedDigest: preview.digest, confirm: true };
      const staged = await sdk.command(stageCommand, stageId); let command: Command = stageCommand, commandId = stageId;
      if (!mode.startsWith("stage")) {
        const ready = await sdk.candidates.wait(staged.id!), review = (await sdk.candidates.applyPreview(staged.id!, session.id!)).preview;
        commandId = randomUUID(); command = { type: "candidate.apply", candidateId: staged.id!, sessionId: session.id!, expectedRevision: ready.candidate.revision, expectedDigest: review.digest, confirm: true };
        await sdk.command(command, commandId);
      }
      if (mode === "retained") assert.equal((await sdk.candidates.wait(staged.id!)).candidate.status, "applied");
      else await waitFor(() => child.heldCandidateId === staged.id);
      await child.stop(); sdk.disconnect();
      const raw = new DatabaseSync(join(stateDir, "state.sqlite"));
      try { raw.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run("default", commandId); } finally { raw.close(); }
      const vault = new GeneratedFileVault(vaultPath);
      restarted = await startService({ stateDir, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY, platform: { remote: { vault, modelsVault: vault }, terminal: { vault } } });
      const current = await new MoguriSdk(restarted.connection).ready();
      try {
        const recovered = await current.candidates.read(staged.id!);
        assert.equal(recovered.candidate.status, mode === "retained" ? "applied" : "partial");
        assert.equal((mode.startsWith("stage") ? recovered.stageJob : recovered.applyJob)?.status, mode === "retained" ? "completed" : "partial");
        assert.equal(recovered.candidate.stageIntent.sessionId, session.id);
        if (!mode.startsWith("stage")) assert.equal(recovered.candidate.applyIntent?.sessionId, session.id);
        assert.equal(await readFile(join(projectRoot, "one.txt"), "utf8"), mode === "apply-after-first" || mode === "retained" ? proposed : original);
        assert.equal(await readFile(join(projectRoot, "two.txt"), "utf8"), mode === "retained" ? proposed : original);
        assert.equal(await readFile(join(workspace.path, "one.txt"), "utf8"), mode === "stage-before" ? original : proposed);
        assert.equal(await readFile(join(workspace.path, "two.txt"), "utf8"), mode.startsWith("stage") ? original : proposed);
        assert.deepEqual(await readFile(join(projectRoot, ".git/index")), index); assert.equal(git(["rev-parse", "HEAD"]), head);
        if (mode.startsWith("stage")) assert.ok(current.getState().snapshot!.blockedWorkspaces.includes(workspace.id));
        else if (mode !== "retained") assert.ok(current.getState().snapshot!.blockedProjects.includes(project.id!));
        const count = current.getState().snapshot!.jobs.filter((job) => job.candidate?.candidateId === staged.id).length;
        const root = t.mock.method(restarted.controller.platform.managed, "project", () => { throw new Error("Recovered candidate command cannot re-probe or replay a root."); });
        assert.equal((await current.command(command, commandId)).id, staged.id);
        assert.equal(root.mock.callCount(), 0); root.mock.restore();
        assert.equal(current.getState().snapshot!.jobs.filter((job) => job.candidate?.candidateId === staged.id).length, count);
        assert.equal(provider.requests.length, 0);
      } finally { t.mock.restoreAll(); current.disconnect(); }
    } finally { sdk.disconnect(); await child.stop(); await restarted?.close(); await provider.close(); await rm(directory, { recursive: true, force: true }); }
  }
});
