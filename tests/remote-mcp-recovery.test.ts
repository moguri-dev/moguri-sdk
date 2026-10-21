import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startService } from "../apps/service/src/server.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { fixtureProvider, GENERATED_RETENTION_KEY, waitFor } from "./fixture.ts";
import { launchRuntimeChild } from "./fixtures/runtime-process.ts";
import { createSshTarget } from "./fixtures/ssh-target.ts";
import { GeneratedFileVault } from "./fixtures/generated-vault.ts";

test("real service SIGKILL before Remote MCP authorization or result ACK retains exact external ownership without access/effect replay", { skip: process.platform !== "darwin", timeout: 45_000 }, async () => {
  for (const holdUserMcp of ["authorization", "result"] as const) {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-generated-mcp-crash-")));
    const stateDir = join(directory, "state"), project = join(directory, "local"), workspace = join(directory, "remote"), sshRoot = join(directory, "ssh"), vaultPath = join(directory, "generated-vault.json");
    for (const path of [project, workspace, sshRoot]) await mkdir(path, { mode: 0o700 });
    const marker = join(workspace, "generated-call-effect");
    const ssh = await createSshTarget(sshRoot), provider = await fixtureProvider({ exposeModels: true });
    const child = await launchRuntimeChild({ stateDir, vaultPath, modelId: provider.modelId, baseUrl: provider.baseUrl, holdUserMcp });
    const sdk = await new MoguriSdk(child.connection).ready();
    let restarted: Awaited<ReturnType<typeof startService>> | undefined;
    try {
      const bound = await sdk.command({ type: "project.add", path: project }), created = await sdk.sessions.create(bound.id!);
      const settings = structuredClone(sdk.settings.get()!.values);
      settings.remote = { ...ssh.target, allowCopilot: false };
      settings.mcpServers = [{ id: "generated-crash-mcp", name: "Generated crash MCP", enabled: true, transport: {
        type: "stdio", command: process.execPath, args: [resolve("tests/fixtures/mcp-echo.mjs"), "--call-marker", marker],
      } }];
      await sdk.settings.update(settings, sdk.settings.get()!.revision);
      const configuration = (await sdk.projects.configuration(bound.id!)).configuration;
      await sdk.projects.configure(bound.id!, { ...configuration.values, remotePath: workspace }, configuration.revision);
      await sdk.remote.probe(); await sdk.sessions.env(created.id!, "Remote");
      const preview = (await sdk.mcp.remotePreview(created.id!, "generated-crash-mcp")).preview;
      await sdk.mcp.grantRemote(created.id!, "generated-crash-mcp", preview.digest, preview.settingsRevision, false, true);
      await sdk.remote.probe();
      const tool = (await sdk.mcp.tools("generated-crash-mcp", "", 0, created.id!)).tools[0]!;
      const command = { type: "mcp.call" as const, sessionId: created.id!, serverId: "generated-crash-mcp", tool: tool.name, arguments: { text: "generated exact crash effect" }, schemaDigest: tool.digest };
      const pending = await sdk.command(command);
      const approval = sdk.getState().snapshot!.sessions.find((session) => session.id === created.id)!.pendingApproval!;
      await sdk.command({ type: "approval.respond", sessionId: created.id!, approvalId: approval.id, allow: true });
      await waitFor(() => child.heldExecution);
      const intent = (await sdk.mcp.remoteCalls(created.id!)).calls[0]!;
      assert.equal(intent.actor, "external"); assert.equal(intent.accessForwarded, false);
      if (holdUserMcp === "result") assert.equal(await readFile(marker, "utf8"), "generated call\n");
      await child.stop(); sdk.disconnect();
      const vault = new GeneratedFileVault(vaultPath);
      restarted = await startService({ stateDir, provider: provider.provider, retentionKey: GENERATED_RETENTION_KEY, platform: { remote: { vault, modelsVault: vault } } });
      const current = await new MoguriSdk(restarted.connection).ready();
      try {
        const before = (await current.mcp.remoteCall(created.id!, intent.id)).call;
        assert.equal(before.status, "unconfirmed"); assert.equal(before.resultDigest, null); assert.equal(before.accessForwarded, false);
        assert.equal((await current.jobs.wait(pending.id!)).status, "partial");
        assert.equal((await restarted.controller.dispatch({ id: intent.commandId!, profileId: "default", command })).id, pending.id);
        await current.mcp.revokeRemote(created.id!, "generated-crash-mcp", current.settings.get()!.revision, true);
        const execution = restarted.controller.snapshot().executions.find((execution) => execution.id === intent.executionId)!;
        let stopped = false;
        for (let index = 0; index < 80; index++) {
          const inspection = await restarted.controller.remote.inspect(execution);
          if (inspection.status.cleanup === "owned-worker-stopped") { stopped = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.equal(stopped, true);
        await restarted.controller.dispatch(envelope({ type: "remote.reconcile", executionId: execution.id }));
        await current.refresh();
        const after = await current.mcp.remoteCall(created.id!, intent.id);
        assert.equal(after.call.actor, "external"); assert.equal(after.call.root, workspace); assert.equal(after.call.jobId, pending.id);
        if (holdUserMcp === "result") {
          assert.equal(after.call.status, "partial"); assert.ok(after.call.resultDigest);
          assert.match(JSON.stringify(after.result), /generated exact crash effect/);
          assert.match((await current.mcp.readResult(pending.id!)).text, /generated exact crash effect/);
          assert.equal(await readFile(marker, "utf8"), "generated call\n");
        } else {
          assert.equal(after.call.status, "unconfirmed"); assert.equal(after.result, null);
          await assert.rejects(() => readFile(marker), { code: "ENOENT" });
        }
        assert.equal(restarted.controller.snapshot().sessions.find((session) => session.id === created.id)?.status, "partial");
        assert.equal(restarted.controller.snapshot().executions.length, 1); assert.equal(provider.requests.length, 0); assert.equal(restarted.controller.snapshot().budgetEntries.length, 0);
      } finally { current.disconnect(); }
    } finally { sdk.disconnect(); await child.stop(); await restarted?.close(); await ssh.close(); await provider.close(); await rm(directory, { recursive: true, force: true }); }
  }
});
