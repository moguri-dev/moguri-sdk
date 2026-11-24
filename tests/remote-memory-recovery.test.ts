import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk, type MemoryIndex } from "../packages/sdk/src/index.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY, waitFor } from "./fixture.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";
import { createSshTarget } from "./fixtures/ssh-target.ts";
import { GeneratedFileVault } from "./fixtures/generated-vault.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("actual service SIGKILL preserves exact index intent/cache and a missing original receipt cannot replay capture after restart", { skip: process.platform !== "darwin", timeout: ciTime(40_000) }, async () => {
  for (const mode of ["pending", "streaming", "retained"] as const) {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-memory-crash-")));
    const stateDir = join(directory, "state"), local = join(directory, "local"), workspace = join(directory, "remote"), sshRoot = join(directory, "ssh"), vaultPath = join(directory, "vault.json");
    for (const path of [local, workspace, sshRoot]) await mkdir(path, { mode: 0o700 });
    await writeFile(join(local, "fixture.ts"), "GENERATED_LOCAL_CRASH_MEMORY_FORBIDDEN");
    await writeFile(join(workspace, "knowledge.ts"), "export function generatedRestartMemory() { return 'generated remote knowledge'; }\n");
    if (mode === "streaming") for (let index = 0; index < 100; index++) await writeFile(join(workspace, `generated-${index}.txt`), "Generated streaming source.\n".repeat(2000));
    const ssh = await createSshTarget(sshRoot), provider = await fixtureProvider();
    const child = await launchRuntimeChild({ stateDir, vaultPath, modelId: provider.modelId, baseUrl: provider.baseUrl, holdMemory: mode === "pending", holdMemoryStream: mode === "streaming" });
    const sdk = await new MoguriSdk(child.connection).ready();
    let restarted: Awaited<ReturnType<typeof startService>> | undefined;
    try {
      const project = await sdk.command({ type: "project.add", path: local }), session = await sdk.sessions.create(project.id!);
      const settings = structuredClone(sdk.settings.get()!.values); settings.remote = ssh.target; settings.memory.enabled = true;
      await sdk.settings.update(settings, sdk.settings.get()!.revision);
      const configuration = (await sdk.projects.configuration(project.id!)).configuration;
      await sdk.projects.configure(project.id!, { ...configuration.values, remotePath: workspace }, configuration.revision);
      await sdk.remote.probe(); await sdk.sessions.env(session.id!, "Remote");
      const command = { type: "memory.index", sessionId: session.id! } as const, commandId = randomUUID();
      const requested = await sdk.command(command, commandId);
      let prior: MemoryIndex | null = null;
      if (mode !== "retained") await waitFor(() => child.heldMemoryRoot === (mode === "streaming" ? "streaming" : workspace));
      else { assert.equal((await sdk.jobs.wait(requested.id!)).status, "completed"); prior = (await sdk.memory.state(session.id!)).index; }
      await child.stop(); sdk.disconnect();
      const raw = new DatabaseSync(join(stateDir, "state.sqlite"));
      try { raw.prepare("DELETE FROM receipts WHERE profile_id='default' AND id=?").run(commandId); } finally { raw.close(); }
      const vault = new GeneratedFileVault(vaultPath);
      restarted = await startService({ stateDir, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY, platform: { remote: { vault, modelsVault: vault } } });
      const current = await new MoguriSdk(restarted.connection).ready();
      try {
        assert.equal(current.getState().snapshot!.jobs.find((job) => job.id === requested.id)?.status, mode === "retained" ? "completed" : "partial");
        assert.equal((await current.remote.status()).remote.ready, false);
        assert.equal((await current.command(command, commandId)).id, requested.id);
        assert.equal((await current.remote.status()).remote.ready, false);
        assert.equal(current.getState().snapshot!.jobs.filter((job) => job.kind === "memory.index").length, 1);
        await current.remote.probe();
        const state = await current.memory.state(session.id!); assert.deepEqual(state.index, prior);
        if (mode !== "retained") await assert.rejects(() => current.memory.searchSession(session.id!, "generatedRestartMemory"), { code: "memory_missing" });
        else {
          const hits = await current.memory.searchSession(session.id!, "generatedRestartMemory");
          assert.ok(hits.items.some((hit) => hit.text.includes("generatedRestartMemory")));
          assert.equal(JSON.stringify(hits).includes("GENERATED_LOCAL_CRASH_MEMORY_FORBIDDEN"), false);
        }
        assert.equal(provider.requests.length, 0);
      } finally { current.disconnect(); }
    } finally { sdk.disconnect(); await child.stop(); await restarted?.close(); await ssh.close(); await provider.close(); await rm(directory, { recursive: true, force: true }); }
  }
});
