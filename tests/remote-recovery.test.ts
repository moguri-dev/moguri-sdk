import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startService } from "../apps/service/src/server.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { MoguriSdk, isRecord, type Connection } from "../packages/sdk/src/index.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY, waitFor } from "./fixture.ts";
import { createSshTarget } from "./fixtures/ssh-target.ts";
import { GeneratedFileVault } from "./fixtures/generated-vault.ts";

test("a real control-plane SIGKILL preserves remote identity and reconciles cancellation without restarting inference", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), "moguri-ssh-recovery-")), root = await realpath(temporary), state = join(root, "state");
  const project = join(root, "local-project"), workspace = join(root, "remote-project"), sshRoot = join(root, "ssh");
  for (const path of [project, workspace, sshRoot]) await mkdir(path, { mode: 0o700 });
  const ssh = await createSshTarget(sshRoot), provider = await fixtureProvider({ exposeModels: true }), vaultPath = join(root, "generated-vault.json");
  const child = fork(resolve("tests/fixtures/runtime-child.ts"), [], { execPath: process.execPath, execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  let sdk: MoguriSdk | undefined, restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const ready = new Promise<Connection>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("Generated child runtime did not start.")), 8000);
      child.once("error", reject);
      child.once("message", (raw: unknown) => {
        clearTimeout(deadline);
        if (!isRecord(raw) || !isRecord(raw.connection)) { reject(new Error("Invalid generated runtime connection.")); return; }
        const value = raw.connection;
        if (typeof value.protocolVersion !== "number" || typeof value.baseUrl !== "string" || typeof value.wsUrl !== "string" || typeof value.token !== "string" || typeof value.pid !== "number") { reject(new Error("Incomplete generated connection.")); return; }
        resolve({ protocolVersion: value.protocolVersion, baseUrl: value.baseUrl, wsUrl: value.wsUrl, token: value.token, pid: value.pid });
      });
    });
    child.send({ stateDir: state, vaultPath, modelId: provider.modelId, baseUrl: provider.baseUrl });
    sdk = await new MoguriSdk(await ready).ready();
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
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    await restarted?.close(); await ssh.close(); await provider.close(); await rm(temporary, { recursive: true, force: true });
  }
});
