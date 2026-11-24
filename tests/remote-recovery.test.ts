import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startService } from "../apps/service/src/server.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY, waitFor } from "./fixture.ts";
import { createSshTarget } from "./fixtures/ssh-target.ts";
import { GeneratedFileVault } from "./fixtures/generated-vault.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("a real control-plane SIGKILL preserves remote identity and reconciles cancellation without restarting inference", { skip: process.platform !== "darwin", timeout: ciTime(30_000) }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), "moguri-ssh-recovery-")), root = await realpath(temporary), state = join(root, "state");
  const project = join(root, "local-project"), workspace = join(root, "remote-project"), sshRoot = join(root, "ssh");
  for (const path of [project, workspace, sshRoot]) await mkdir(path, { mode: 0o700 });
  const ssh = await createSshTarget(sshRoot), provider = await fixtureProvider({ exposeModels: true }), vaultPath = join(root, "generated-vault.json");
  const runtime = await launchRuntimeChild({ stateDir: state, vaultPath, modelId: provider.modelId, baseUrl: provider.baseUrl });
  const { child, exited } = runtime;
  let sdk: MoguriSdk | undefined, restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    sdk = await new MoguriSdk(runtime.connection).ready();
    const bound = await sdk.command({ type: "project.add", path: project }), session = await sdk.sessions.create(bound.id!);
    const settings = structuredClone(sdk.settings.get()!.values); settings.remote = ssh.target;
    await sdk.settings.update(settings, sdk.settings.get()!.revision);
    const configuration = (await sdk.projects.configuration(bound.id!)).configuration;
    await sdk.projects.configure(bound.id!, { ...configuration.values, remotePath: workspace }, configuration.revision);
    await sdk.remote.probe();
    const current = sdk.getState().snapshot!.sessions.find((value) => value.id === session.id)!;
    await sdk.sessions.configure(current.id, { ...current.controls, env: "Remote", modelId: provider.modelId });
    await sdk.command({ type: "draft.save", sessionId: current.id, expectedRevision: 0, text: "generated slow crash recovery", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: current.id, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => provider.requests.length === 1);
    child.kill("SIGKILL"); await exited; sdk.disconnect();
    const vault = new GeneratedFileVault(vaultPath);
    restarted = await startService({ stateDir: state, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY, platform: { remote: { vault, modelsVault: vault } } });
    const recovered = restarted.controller.snapshot().sessions.find((value) => value.id === current.id)!;
    assert.equal(recovered.status, "partial");
    assert.equal(restarted.controller.snapshot().capabilities.find((value) => value.env === "Remote")?.ready, false);
    const execution = restarted.controller.snapshot().executions[0]!;
    assert.equal(execution.status, "unconfirmed");
    assert.equal(provider.requests.length, 1);
    assert.equal(restarted.controller.snapshot().budgetEntries[0]?.status, "unknown");
    assert.ok(restarted.controller.snapshot().budgetEntries[0]!.reservedTokens! > 0);
    let settled = false;
    for (let index = 0; index < 50; index++) {
      const inspection = await restarted.controller.remote.inspect(execution);
      if (inspection.status.cleanup === "owned-worker-stopped") { settled = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(settled, true);
    await restarted.controller.dispatch(envelope({ type: "remote.reconcile", executionId: execution.id }));
    assert.equal(restarted.controller.snapshot().sessions.find((value) => value.id === current.id)?.status, "partial");
    assert.equal(restarted.controller.snapshot().executions[0]?.cleanup, "owned-worker-stopped");
    assert.equal(restarted.controller.snapshot().executions.length, 1); assert.equal(provider.requests.length, 1);
    assert.equal(restarted.controller.snapshot().budgetEntries.length, 1);
  } finally {
    sdk?.disconnect();
    await runtime.stop();
    await restarted?.close(); await ssh.close(); await provider.close(); await rm(temporary, { recursive: true, force: true });
  }
});
