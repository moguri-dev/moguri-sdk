import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { MoguriSdk, type Command } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { digest } from "../apps/service/src/store.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY, waitFor } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";
import { GeneratedFileVault } from "./fixtures/generated-vault.ts";

test("actual generation controller SIGKILL never replays before admission, in flight, before result retention or after a retained proposal", { skip: process.platform !== "darwin", timeout: 45_000 }, async (t) => {
  for (const mode of ["before-admission", "in-flight", "before-result", "retained"] as const) {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-generation-crash-"))), projectRoot = join(directory, "project"), stateDir = join(directory, "state"), vaultPath = join(directory, "vault.json");
    await mkdir(projectRoot, { mode: 0o700 }); const original = "Generated owned-generation crash base.\n"; await writeFile(join(projectRoot, "fixture.txt"), original);
    const git = initializeGeneratedRepository(projectRoot, ["fixture.txt"]), index = await readFile(join(projectRoot, ".git/index")), head = git(["rev-parse", "HEAD"]);
    const patch = { kind: "patch", summary: "Generated retained crash proposal.", edits: [{ path: "fixture.txt", baseDigest: digest(original), text: "Generated owned-generation proposal.\n" }] };
    const provider = await fixtureProvider({ replyText: JSON.stringify(patch), responseMode: "text" }), startedAt = performance.now();
    const child = await launchRuntimeChild({ stateDir, vaultPath, modelId: provider.modelId, baseUrl: provider.baseUrl,
      ...(mode === "before-admission" || mode === "before-result" ? { holdGeneration: mode } : {}) });
    const sdk = await new MoguriSdk(child.connection).ready(); let restarted: Awaited<ReturnType<typeof startService>> | undefined;
    try {
      const project = await sdk.command({ type: "project.add", path: projectRoot }), session = await sdk.sessions.create(project.id!, "Generated crash proposal owner", { modelId: provider.modelId, env: "Local" });
      const created = await sdk.workspaces.create(project.id!, "moguri/generated-generation-crash"), workspace = await sdk.workspaces.wait(created.id!);
      const input = { task: mode === "in-flight" ? "generated slow crash proposal" : "Generate one reviewed crash proposal.", files: [{ path: "fixture.txt", baseDigest: digest(original) }] };
      const preview = (await sdk.candidates.generatePreview(session.id!, workspace.id, input)).preview;
      const commandId: string = randomUUID(), command: Command = { type: "candidate.generate", sessionId: session.id!, stageWorkspaceId: workspace.id, input, expectedDigest: preview.digest, confirmCost: true };
      const generated = await sdk.command(command, commandId), id = generated.id!;
      if (mode === "retained") assert.equal((await sdk.candidates.waitGeneration(id)).generation.status, "proposed");
      else if (mode === "in-flight") await waitFor(() => provider.requests.length === 1);
      else await waitFor(() => child.heldGenerationId === id);
      await child.stop(); sdk.disconnect();
      const raw = new DatabaseSync(join(stateDir, "state.sqlite"));
      try { raw.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run("default", commandId); } finally { raw.close(); }
      const vault = new GeneratedFileVault(vaultPath);
      restarted = await startService({ stateDir, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY, platform: { remote: { vault, modelsVault: vault }, terminal: { vault } } });
      const current = await new MoguriSdk(restarted.connection).ready();
      try {
        const recovered = await current.candidates.generation(id);
        assert.equal(recovered.generation.status, mode === "retained" ? "proposed" : "partial"); assert.deepEqual(recovered.input.files, [{ ...input.files[0], text: original }]);
        assert.equal(recovered.proposal !== null, mode === "retained");
        const budget = (await current.budgets.status(session.id!)).status;
        assert.equal(budget.totals.calls, mode === "before-admission" ? 0 : 1);
        if (mode === "retained") { assert.equal(budget.totals.reportedTokens, 42); assert.equal(budget.totals.heldTokens, 0); }
        else if (mode !== "before-admission") { assert.equal(budget.totals.reportedTokens, null); assert.ok(budget.totals.heldTokens! > 0); }
        const root = t.mock.method(restarted.controller.platform.managed, "project", () => { throw new Error("Recovered generation cannot re-probe a root."); });
        assert.equal((await current.command(command, commandId)).id, id); assert.equal(root.mock.callCount(), 0); root.mock.restore();
        assert.equal(provider.requests.length, mode === "before-admission" ? 0 : 1);
        assert.equal(await readFile(join(projectRoot, "fixture.txt"), "utf8"), original); assert.equal(await readFile(join(workspace.path, "fixture.txt"), "utf8"), original);
        assert.deepEqual(await readFile(join(projectRoot, ".git/index")), index); assert.equal(git(["rev-parse", "HEAD"]), head);
        assert.equal(current.getState().snapshot!.blockedProjects.includes(project.id!), false);
        console.log(JSON.stringify({ primitive: "actual-generation-controller-sigkill", phase: mode, ms: performance.now() - startedAt, requests: provider.requests.length, sourceUnchanged: true, replay: false, containment: false }));
      } finally { t.mock.restoreAll(); current.disconnect(); }
    } finally { sdk.disconnect(); await child.stop(); await restarted?.close(); await provider.close(); await rm(directory, { recursive: true, force: true }); }
  }
});
