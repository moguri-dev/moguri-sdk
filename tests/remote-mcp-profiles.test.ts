import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { profileFixture } from "./fixtures/profiles.ts";
import { createSshTarget } from "./fixtures/ssh-target.ts";

test("pending external Remote MCP approvals lease the actual pinned root across isolated profiles and target aliases", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const f = await profileFixture(() => {
    const values = new Map<string, string>();
    return { remote: { vault: { read: async (id) => values.get(id) ?? null, write: async (id, value) => { values.set(id, value); }, remove: async (id) => { values.delete(id); } } } };
  });
  const root = await realpath(f.directory), sshRoot = join(root, "ssh"), workspace = join(root, "remote"), localA = join(root, "local-a"), localB = join(root, "local-b");
  for (const path of [sshRoot, workspace, localA, localB]) await mkdir(path, { mode: 0o700 });
  await writeFile(join(workspace, "fixture.txt"), "Generated exact shared Remote MCP root.\n");
  const ssh = await createSshTarget(sshRoot);
  try {
    const beta = await f.create("Generated MCP Beta");
    const sessions: Array<{ client: typeof f.sdk; id: string; digest: string }> = [];
    for (const [index, client] of [f.sdk, beta.client].entries()) {
      const settings = structuredClone(client.settings.get()!.values);
      settings.remote = { ...ssh.target, id: `generated-mcp-alias-${index}`, name: `Generated MCP alias ${index}`, stateDir: join(sshRoot, `runs-${index}`), allowCopilot: false };
      await client.settings.update(settings, client.settings.get()!.revision);
      const project = await client.command({ type: "project.add", path: index ? localB : localA });
      const configuration = (await client.projects.configuration(project.id!)).configuration;
      await client.projects.configure(project.id!, { ...configuration.values, remotePath: workspace }, configuration.revision);
      await client.remote.probe();
      const session = await client.sessions.create(project.id!, `Generated MCP owner ${index}`, { env: "Remote", modelId: null });
      const preview = (await client.mcp.remotePreview(session.id!, "builtin")).preview;
      await client.mcp.grantRemote(session.id!, "builtin", preview.digest, preview.settingsRevision, false, true);
      await client.remote.probe();
      const tool = (await client.mcp.tools("builtin", "grep", 0, session.id!)).tools[0]!;
      sessions.push({ client, id: session.id!, digest: tool.digest });
    }
    const first = sessions[0]!, second = sessions[1]!;
    const pending = await first.client.mcp.call(first.id, "builtin", "grep_logs", { path: "fixture.txt", query: "Generated" }, first.digest);
    await assert.rejects(() => second.client.mcp.call(second.id, "builtin", "grep_logs", { path: "fixture.txt", query: "Generated" }, second.digest), { code: "workspace_busy" });
    const original = (await first.client.mcp.remoteCalls(first.id)).calls[0]!;
    await assert.rejects(() => second.client.mcp.remoteCall(first.id, original.id), /outside|not found/i);
    assert.equal(f.service.controller.snapshot().executions.length, 0);
    await first.client.jobs.cancel(pending.id!);
    assert.equal((await first.client.jobs.wait(pending.id!)).status, "cancelled");
    const next = await second.client.mcp.call(second.id, "builtin", "grep_logs", { path: "fixture.txt", query: "Generated" }, second.digest);
    await second.client.jobs.cancel(next.id!);
    assert.equal((await second.client.jobs.wait(next.id!)).status, "cancelled");
    assert.equal((await second.client.mcp.remoteCalls(second.id)).calls.length, 1);
    assert.equal(f.providers.reduce((total, provider) => total + provider.requests.length, 0), 0);
  } finally { await f.service.close(); await ssh.close(); await f.close(); }
});
