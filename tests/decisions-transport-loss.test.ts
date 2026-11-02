import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY, waitFor } from "./fixture.ts";
import { createSshTarget } from "./fixtures/ssh-target.ts";
import { GeneratedFileVault } from "./fixtures/generated-vault.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";
import { generatedTechnicalAdvice } from "./fixtures/decisions-api.ts";

for (const phase of ["inflight", "before-effect"] as const) test(`actual SSH decision controller SIGKILL ${phase} retains original holds/results/cleanup without inference or answer replay`, { skip: process.platform !== "darwin", timeout: 40_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-owned-decision-loss-")), root = await realpath(directory);
  const project = join(root, "project"), workspace = join(root, "peer-project"), sshRoot = join(root, "ssh"), stateDir = join(root, "state");
  for (const path of [project, workspace, sshRoot]) await mkdir(path, { mode: 0o700 });
  const primary = await fixtureProvider({ exposeModels: true, responseMode: "auto", maxOutputTokens: 128 });
  const text = generatedTechnicalAdvice();
  const advice = await fixtureProvider({ modelId: "generated-owned-loss-advice", exposeModels: true, responseMode: "text", maxOutputTokens: 128,
    replyText: text, ...(phase === "inflight" ? { stream: { chunks: [text], delayMs: 60_000 } } : {}) });
  const ssh = await createSshTarget(sshRoot), vaultPath = join(root, "generated-vault.json");
  const runtime = await launchRuntimeChild({ stateDir, vaultPath, modelId: primary.modelId, baseUrl: primary.baseUrl, holdDecisionEffect: phase === "before-effect",
    modelInfo: { id: primary.modelId, name: "Generated owned SSH solver", contextWindow: 16384, maxTokens: 128, imageInput: false } });
  let sdk = await new MoguriSdk(runtime.connection).ready(), restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const bound = await sdk.projects.add(project), created = await sdk.sessions.create(bound.id!, "Generated exact owned loss");
    const settings = structuredClone(sdk.settings.get()!.values);
    settings.remote = { ...ssh.target, models: [{ id: "generated-owned-loss", name: "Generated owned loss", enabled: true, baseUrl: advice.baseUrl + "/v1", auth: "none",
      models: [{ id: advice.modelId, name: "Generated owned advice", contextWindow: 16384, maxTokens: 128, imageInput: false }] }] };
    await sdk.settings.update(settings, sdk.settings.get()!.revision); await sdk.remote.probe(); await sdk.models.refresh();
    const model = sdk.getState().snapshot!.provider.models.find((model) => model.name === "Generated owned advice")!;
    assert.ok(model);
    const configured = structuredClone(sdk.settings.get()!.values);
    configured.decisions = { ...configured.decisions, enabled: true, modelId: model.id, outputTokens: 128,
      technicalQuestions: [{ id: "generated-loss-choice", kind: "technical-choice", question: "Choose a generated fixture approach?",
        choices: ["Generated first choice", "Generated second choice"] }] };
    await sdk.settings.update(configured, sdk.settings.get()!.revision);
    const configuration = (await sdk.projects.configuration(bound.id!)).configuration;
    await sdk.projects.configure(bound.id!, { ...configuration.values, remotePath: workspace }, configuration.revision);
    await sdk.sessions.configure(created.id!, { ...sdk.getState().snapshot!.sessions.find((session) => session.id === created.id)!.controls,
      env: "Remote", modelId: primary.modelId });
    await sdk.sessions.autonomy(created.id!, "Autopilot Max");
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "generated structured question choices only with exact crash ownership", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    const original = await waitFor(() => sdk.getState().snapshot!.decisions[0], 15_000);
    await waitFor(() => phase === "inflight" ? advice.requests.length === 1 : runtime.heldDecisionId === original.id, 15_000);
    runtime.child.kill("SIGKILL"); await runtime.exited; sdk.disconnect();
    const vault = new GeneratedFileVault(vaultPath);
    restarted = await startService({ stateDir, provider: primary.provider, retentionKey: GENERATED_RETENTION_KEY, platform: { remote: { vault, modelsVault: vault } } });
    sdk = await new MoguriSdk(restarted.connection).ready();
    const recovered = (await sdk.decisions.read(original.id)).decision;
    assert.equal(recovered.version, 2); assert.equal(recovered.env, "Remote"); assert.equal(recovered.inputDigest, original.inputDigest);
    assert.equal(recovered.status, phase === "inflight" ? "partial" : "rejected"); assert.equal(recovered.applied, null);
    assert.equal(recovered.cleanup, phase === "inflight" ? "unconfirmed" : "owned-role-acknowledged");
    assert.equal(restarted.controller.snapshot().budgetEntries.find((entry) => entry.id === recovered.stepId)?.status, phase === "inflight" ? "unknown" : "settled");
    assert.equal(restarted.controller.snapshot().questions[0]?.answer, null);
    assert.equal(primary.requests.length, 1); assert.equal(advice.requests.length, 1);
    const execution = restarted.controller.snapshot().executions[0]!;
    let cleaned = false;
    for (let index = 0; index < 100; index++) {
      if ((await restarted.controller.remote.inspect(execution)).status.cleanup === "owned-worker-stopped") { cleaned = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(cleaned, true);
    await sdk.remote.reconcile(execution.id);
    assert.equal(restarted.controller.snapshot().sessions.find((session) => session.id === created.id)?.status, "partial");
    assert.equal((await sdk.decisions.read(original.id)).decision.status, recovered.status);
    assert.equal(restarted.controller.snapshot().budgetEntries.length, 2);
    assert.equal(primary.requests.length, 1); assert.equal(advice.requests.length, 1);
  } finally {
    sdk.disconnect(); await runtime.stop(); await restarted?.close(); await ssh.close(); await primary.close(); await advice.close();
    await rm(directory, { recursive: true, force: true });
  }
});
