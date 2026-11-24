import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY, waitFor } from "./fixture.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";
import { createSshTarget } from "./fixtures/ssh-target.ts";
import { GeneratedFileVault } from "./fixtures/generated-vault.ts";
import { ciTime } from "./fixtures/time-scale.ts";

async function output(sdk: MoguriSdk, id: string, text: string) {
  for (let index = 0; index < 150; index++) {
    const result = await sdk.terminal.read(id); if (result.data.includes(text)) return result;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("Real control-plane crash recovery lost its exact Remote console witness.");
}
test("actual service SIGKILL restores the same Remote owner/PTY without replaying lost input acknowledgements or substituting a missing key", { skip: process.platform !== "darwin", timeout: ciTime(45_000) }, async () => {
  for (const mode of ["normal", "missing-key", "held-input"] as const) {
    const missingKey = mode === "missing-key";
    const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-remote-console-crash-")));
    const stateDir = join(directory, "state"), local = join(directory, "local"), workspace = join(directory, "remote"), sshRoot = join(directory, "ssh"), vaultPath = join(directory, "generated-vault.json");
    for (const path of [local, workspace, sshRoot]) await mkdir(path, { mode: 0o700 });
    const ssh = await createSshTarget(sshRoot), provider = await fixtureProvider({ exposeModels: true });
    const child = await launchRuntimeChild({ stateDir, vaultPath, modelId: provider.modelId, baseUrl: provider.baseUrl, holdTerminalInput: mode === "held-input", rawTerminal: true }), sdk = await new MoguriSdk(child.connection).ready();
    let restarted: Awaited<ReturnType<typeof startService>> | undefined;
    try {
      const project = await sdk.command({ type: "project.add", path: local }), session = await sdk.sessions.create(project.id!);
      const settings = structuredClone(sdk.settings.get()!.values); settings.remote = { ...ssh.target, allowCopilot: false };
      await sdk.settings.update(settings, sdk.settings.get()!.revision);
      const configuration = (await sdk.projects.configuration(project.id!)).configuration;
      await sdk.projects.configure(project.id!, { ...configuration.values, remotePath: workspace }, configuration.revision);
      await sdk.remote.probe(); await sdk.sessions.env(session.id!, "Remote");
      const opened = await sdk.terminal.open(session.id!), before = await output(sdk, opened.id!, "GENERATED_CHILD_TERMINAL_READY");
      const owner = sdk.getState().snapshot!.terminalOwners.find((owner) => owner.id === before.terminal.ownerId)!;
      const pendingInput = sdk.terminal.input(opened.id!, "GENERATED_REMOTE_REAL_CRASH_INPUT\n").then(() => ({ accepted: true }), (error: unknown) => ({ error }));
      if (mode === "held-input") await waitFor(() => child.heldTerminalInput === opened.id); else assert.ok("accepted" in await pendingInput);
      const sent = await output(sdk, opened.id!, "GENERATED_REMOTE_REAL_CRASH_INPUT");
      const observedCopies = sent.data.split("GENERATED_REMOTE_REAL_CRASH_INPUT").length - 1;
      const vault = new GeneratedFileVault(vaultPath), slot = `terminal-owner-${owner.id}`, key = await vault.read(slot);
      assert.ok(key); await child.stop(); sdk.disconnect();
      if (mode === "held-input") assert.ok("error" in await pendingInput);
      if (missingKey) await vault.remove(slot);
      restarted = await startService({ stateDir, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY, platform: { terminal: { vault }, remote: { vault, modelsVault: vault } } });
      const current = await new MoguriSdk(restarted.connection).ready();
      try {
        if (missingKey) {
          assert.equal(current.getState().snapshot!.terminals[0]?.status, "unconfirmed");
          await current.remote.probe();
          await assert.rejects(() => current.terminal.open(session.id!), { code: "terminal_owner_unconfirmed" });
          assert.equal(current.getState().snapshot!.terminalOwners.length, 1);
          await vault.write(slot, key); await current.terminal.reconcile(opened.id!);
        }
        const after = await current.terminal.read(opened.id!);
        assert.equal(after.terminal.status, "running"); assert.equal(after.terminal.pid, before.terminal.pid);
        assert.equal(after.terminal.env, "Remote"); assert.equal(after.terminal.binding?.root, workspace);
        assert.equal(current.getState().snapshot!.terminalOwners.find((entry) => entry.id === owner.id)?.pid, owner.pid);
        assert.notEqual(after.terminal.attachmentId, before.terminal.attachmentId);
        assert.match(after.data, /GENERATED_REMOTE_REAL_CRASH_INPUT/); assert.equal(after.data.split("GENERATED_CHILD_TERMINAL_READY").length - 1, 1);
        assert.equal(after.data.split("GENERATED_REMOTE_REAL_CRASH_INPUT").length - 1, observedCopies);
        assert.equal(JSON.stringify(restarted.controller.events(0)).includes("GENERATED_REMOTE_REAL_CRASH_INPUT"), false);
        await current.terminal.input(opened.id!, "GENERATED_REMOTE_AFTER_REAL_CRASH\n"); await output(current, opened.id!, "GENERATED_REMOTE_AFTER_REAL_CRASH");
        await current.terminal.close(opened.id!);
        assert.equal(provider.requests.length, 0); assert.equal(restarted.controller.snapshot().terminals.length, 1);
      } finally { current.disconnect(); }
    } finally { sdk.disconnect(); await child.stop(); await restarted?.close(); await ssh.close(); await provider.close(); await rm(directory, { recursive: true, force: true }); }
  }
});
