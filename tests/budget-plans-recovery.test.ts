import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY, waitFor } from "./fixture.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";
import { GeneratedFileVault } from "./fixtures/generated-vault.ts";

test("actual control-plane SIGKILL releases only the proven undispatched plan and preserves the started model hold without another request", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-planned-budget-crash-"))), stateDir = join(directory, "state"), vaultPath = join(directory, "vault.json"), projectRoot = join(directory, "project");
  await mkdir(projectRoot, { mode: 0o700 }); await writeFile(join(projectRoot, "fixture.txt"), "Generated unchanged crash fixture.\n");
  const provider = await fixtureProvider(), started = performance.now();
  const child = await launchRuntimeChild({ stateDir, vaultPath, modelId: provider.modelId, baseUrl: provider.baseUrl, planBudgetOnStart: true });
  const sdk = await new MoguriSdk(child.connection).ready(); let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const project = await sdk.command({ type: "project.add", path: projectRoot }), source = await sdk.sessions.create(project.id!, "Generated planned-budget owner", { modelId: provider.modelId, env: "Local" });
    await sdk.command({ type: "draft.save", sessionId: source.id!, expectedRevision: 0, text: "generated slow planned-budget crash", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: source.id!, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => provider.requests.length === 1 && child.plannedBudgetId);
    const before = (await sdk.budgets.status(source.id!)).status, planId = child.plannedBudgetId!, plan = (await sdk.budgets.plans()).plans.find((plan) => plan.id === planId)!;
    assert.equal(plan.status, "held"); assert.equal(before.totals.calls, 1); assert.equal(before.totals.plannedHolds, 1);
    const modelHold = before.totals.heldTokens! - plan.tokens; assert.ok(modelHold > 0);
    await child.stop(); sdk.disconnect();
    const vault = new GeneratedFileVault(vaultPath);
    restarted = await startService({ stateDir, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY, platform: { remote: { vault, modelsVault: vault }, terminal: { vault } } });
    const current = await new MoguriSdk(restarted.connection).ready();
    try {
      const recovered = (await current.budgets.plans()).plans.find((plan) => plan.id === planId)!;
      assert.equal(recovered.status, "released"); assert.equal(recovered.release?.reason, "owner-turn-finished");
      const status = (await current.budgets.status(source.id!)).status;
      assert.equal(status.totals.calls, 1); assert.equal(status.totals.plannedHolds, 0);
      assert.equal(status.totals.heldTokens, modelHold); assert.equal(status.totals.reportedTokens, null);
      assert.equal(current.getState().snapshot!.budgetEntries[0]?.status, "unknown");
      assert.equal(provider.requests.length, 1); assert.equal(await readFile(join(projectRoot, "fixture.txt"), "utf8"), "Generated unchanged crash fixture.\n");
      console.log(JSON.stringify({ primitive: "actual-planned-budget-controller-sigkill", ms: performance.now() - started, calls: 1, modelHold, planReleasedWithoutDispatch: true, containment: false }));
    } finally { current.disconnect(); }
  } finally { sdk.disconnect(); await child.stop(); await restarted?.close(); await provider.close(); await rm(directory, { recursive: true, force: true }); }
});
