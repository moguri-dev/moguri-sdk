import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MoguriSdk, type Command } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY, waitFor } from "./fixture.ts";
import { createSshTarget } from "./fixtures/ssh-target.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";
import { GeneratedFileVault } from "./fixtures/generated-vault.ts";
import { executionFrameName, loadExecutionStatus } from "../apps/service/src/execution-journal.ts";
import { digest } from "../apps/service/src/store.ts";
import { candidateEnvWriteRoots } from "../apps/service/src/candidate-envs.ts";
import { remoteRootLease } from "../apps/service/src/remote.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("real service SIGKILL/lost candidate terminal ACK recovers only original pinned journal receipts without replay or successful outcome fabrication", { timeout: ciTime(300_000) }, async (t) => {
  for (const holdCandidateTransport of ["result", "terminal", "stage-result", "apply-terminal"] as const) {
    const directory = resolve(".test-output", `candidate-recovery-${randomUUID()}`);
    for (const part of ["local", "peer", "ssh"]) await mkdir(join(directory, part), { recursive: true, mode: 0o700 });
    const root = await realpath(directory), peer = join(root, "peer"), stateDir = join(root, "state"), vaultPath = join(root, "vault.json");
    await writeFile(join(peer, "fixture.txt"), "Generated original peer source.\n");
    const git = initializeGeneratedRepository(peer), index = await readFile(join(peer, ".git/index")), head = git(["rev-parse", "HEAD"]);
    const ssh = await createSshTarget(join(root, "ssh")), provider = await fixtureProvider({ exposeModels: true });
    const child = await launchRuntimeChild({ stateDir, vaultPath, modelId: provider.modelId, baseUrl: provider.baseUrl, holdCandidateTransport });
    const sdk = await new MoguriSdk(child.connection).ready(); let restarted: Awaited<ReturnType<typeof startService>> | undefined;
    try {
      const project = await sdk.command({ type: "project.add", path: join(root, "local") }), session = await sdk.sessions.create(project.id!);
      const settings = structuredClone(sdk.settings.get()!.values); settings.remote = { ...ssh.target, allowCopilot: false };
      await sdk.settings.update(settings, sdk.settings.get()!.revision);
      const configuration = (await sdk.projects.configuration(project.id!)).configuration;
      await sdk.projects.configure(project.id!, { ...configuration.values, remotePath: peer }, configuration.revision);
      await sdk.remote.probe();
      const owner = sdk.getState().snapshot!.sessions.find((value) => value.id === session.id)!;
      await sdk.sessions.configure(owner.id, { ...owner.controls, env: "Remote", modelId: null });
      const review = (await sdk.candidates.workspacePreview(owner.id, "Generated interrupted peer stage")).preview;
      let commandId = randomUUID(), command: Command = { type: "candidate.workspace.create", sessionId: owner.id, name: review.name, expectedDigest: review.digest, confirm: true };
      const created = await sdk.command(command, commandId);
      let candidateId: string | null = null, resultId = created.id!;
      const writing = holdCandidateTransport === "stage-result" || holdCandidateTransport === "apply-terminal", proposed = "Generated exact recovered candidate proposal.\n";
      if (writing) {
        await sdk.candidates.waitWorkspace(created.id!);
        const patch = { kind: "patch" as const, summary: "Generated interrupted exact peer patch", edits: [{ path: "fixture.txt",
          baseDigest: digest("Generated original peer source.\n"), text: proposed }] };
        const staging = (await sdk.candidates.preview(owner.id, created.id!, patch)).preview;
        commandId = randomUUID(); command = { type: "candidate.stage", sessionId: owner.id, stageWorkspaceId: created.id!, patch, expectedDigest: staging.digest, confirm: true };
        const staged = await sdk.command(command, commandId); candidateId = staged.id!; resultId = staged.id!;
        if (holdCandidateTransport === "apply-terminal") {
          const ready = await sdk.candidates.wait(staged.id!), application = (await sdk.candidates.applyPreview(staged.id!, owner.id)).preview;
          commandId = randomUUID(); command = { type: "candidate.apply", candidateId, sessionId: owner.id, expectedRevision: ready.candidate.revision, expectedDigest: application.digest, confirm: true };
          await sdk.command(command, commandId);
        }
      }
      await waitFor(() => child.heldCandidateTransportId, 12000);
      const transportId = child.heldCandidateTransportId!;
      const resource = (await sdk.candidates.workspace(created.id!)).workspace, originalKey = await new GeneratedFileVault(vaultPath).read(transportId);
      assert.equal(await readFile(join(resource.plannedRoot, "fixture.txt"), "utf8"), writing ? proposed : "Generated original peer source.\n");
      await child.stop(); sdk.disconnect();
      const vault = new GeneratedFileVault(vaultPath);
      restarted = await startService({ stateDir, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY,
        platform: { remote: { vault, modelsVault: vault }, terminal: { vault } } });
      const current = await new MoguriSdk(restarted.connection).ready();
      try {
        const before = (await current.candidates.transport(transportId)).transport;
        assert.equal(before.status, "partial"); assert.equal(before.cleanupConfirmed, false); assert.equal(before.terminalAcknowledged, false);
        assert.equal(Boolean(before.resultDigest), holdCandidateTransport === "terminal" || holdCandidateTransport === "apply-terminal");
        const reconcileId = randomUUID(), reconcile: Command = { type: "candidate.transport.reconcile", transportId: before.id, expectedRevision: before.revision };
        assert.ok(originalKey);
        const journal = join(ssh.target.stateDir, before.id);
        let stopped = false;
        for (let attempt = 0; attempt < 30; attempt++) {
          if ((await loadExecutionStatus(journal, Buffer.from(originalKey, "hex"))).status.cleanup === "owned-worker-stopped") { stopped = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.equal(stopped, true);
        if (holdCandidateTransport === "result") {
          await vault.write(before.id, "f".repeat(64));
          await assert.rejects(() => current.candidates.reconcileTransport(before.id, before.revision), /key|proof|identity|auth|journal|confirm/i);
          assert.equal((await current.candidates.transport(before.id)).transport.cleanupConfirmed, false);
          assert.ok(candidateEnvWriteRoots(restarted.controller.events(0), restarted.controller.snapshot()).includes(remoteRootLease(ssh.target, peer)!));
          assert.equal(await vault.read(before.id), "f".repeat(64));
          await vault.write(before.id, originalKey);
          const remapped = structuredClone(current.settings.get()!.values);
          remapped.remote = { ...ssh.target, id: "generated-different-current", command: ["/generated/current-worker-must-not-run"],
            identityFile: join(root, "current-identity-must-not-be-read"), stateDir: join(root, "current-state-must-not-be-created"), allowCopilot: false };
          await current.settings.update(remapped, current.settings.get()!.revision);
          const changed = (await current.projects.configuration(project.id!)).configuration;
          await current.projects.configure(project.id!, { ...changed.values, remotePath: join(root, "local") }, changed.revision);
        } else if (holdCandidateTransport === "terminal") {
          const terminal = join(journal, executionFrameName(before.sequence + 1)), retained = join(root, "original-terminal-frame.bin");
          await rename(terminal, retained);
          await assert.rejects(() => current.candidates.reconcileTransport(before.id, before.revision), /gap|missing|cursor|terminal|confirm/i);
          assert.equal((await current.candidates.transport(before.id)).transport.cleanupConfirmed, false);
          assert.ok(candidateEnvWriteRoots(restarted.controller.events(0), restarted.controller.snapshot()).includes(remoteRootLease(ssh.target, peer)!));
          await rename(retained, terminal);
        }
        let reconciled = false;
        for (let attempt = 0; attempt < 20; attempt++) {
          try { await current.command(reconcile, reconcileId); reconciled = true; break; }
          catch (error) {
            if (!(error instanceof Error) || !/settled|cleanup|unconfirmed/i.test(error.message)) throw error;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
        assert.equal(reconciled, true);
        const after = (await current.candidates.transport(before.id)).transport;
        assert.equal(after.status, "partial"); assert.equal(after.cleanupConfirmed, true); assert.equal(after.terminalAcknowledged, false);
        assert.equal(after.recovery?.evidence.journal.root, peer);
        assert.ok(after.resultDigest); assert.equal(after.recovery?.actor, "user"); assert.equal(after.recovery?.evidence.terminal.originalAcknowledged, false);
        const sharedRead = await current.slash(owner.id, `/candidate transport-read ${before.id}`, "tui");
        assert.equal(sharedRead.kind, "text");
        if (sharedRead.kind === "text") assert.equal(JSON.parse(sharedRead.text).transport.cleanupConfirmed, true);
        assert.equal((await current.candidates.workspace(created.id!)).workspace.status, writing ? "ready" : "partial");
        if (!writing) assert.equal(candidateEnvWriteRoots(restarted.controller.events(0), restarted.controller.snapshot()).includes(remoteRootLease(ssh.target, peer)!), false);
        if (candidateId) {
          const candidate = await current.candidates.read(candidateId);
          assert.equal(candidate.candidate.status, "partial");
          assert.equal((holdCandidateTransport === "stage-result" ? candidate.stageJob : candidate.applyJob)?.status, "partial");
          assert.equal(holdCandidateTransport === "apply-terminal" ? candidate.candidate.acceptance?.actor : candidate.candidate.acceptance, holdCandidateTransport === "apply-terminal" ? "user" : null);
          assert.equal(holdCandidateTransport === "stage-result" ? candidate.candidate.stageResultDigest : candidate.candidate.applyResultDigest, null);
        }
        assert.equal(await vault.read(before.id), originalKey);
        restarted.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id IN (?,?)").run("default", commandId, reconcileId);
        const launch = t.mock.method(restarted.controller.remote, "launch", () => { throw new Error("Original candidate effects must never be replayed."); });
        const inspect = t.mock.method(restarted.controller.remote, "inspectCandidate", async () => { throw new Error("Canonical reconciliation receipt must not inspect again."); });
        assert.equal((await current.command(command, commandId)).id, resultId);
        assert.equal((await current.command(reconcile, reconcileId)).id, before.id);
        assert.equal(launch.mock.callCount(), 0); assert.equal(inspect.mock.callCount(), 0); launch.mock.restore(); inspect.mock.restore();
        assert.deepEqual(await readFile(join(peer, ".git/index")), index); assert.equal(git(["rev-parse", "HEAD"]), head);
        assert.equal(await readFile(join(peer, "fixture.txt"), "utf8"), holdCandidateTransport === "apply-terminal" ? proposed : "Generated original peer source.\n");
        assert.equal(provider.requests.length, 0); assert.equal(current.getState().snapshot!.budgetEntries.length, 0);
        await current.sessions.delete(owner.id, true);
        assert.equal((await current.candidates.workspace(created.id!)).workspace.status, writing ? "ready" : "partial");
        assert.equal(await readFile(join(resource.plannedRoot, "fixture.txt"), "utf8"), writing ? proposed : "Generated original peer source.\n");
      } finally { current.disconnect(); }
    } finally { t.mock.restoreAll(); sdk.disconnect(); await child.stop(); await restarted?.close(); await ssh.close(); await provider.close(); await rm(root, { recursive: true, force: true }); }
  }
});
