import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { profileFixture } from "./fixtures/profiles.ts";
import { createSshTarget } from "./fixtures/ssh-target.ts";
import { holdRemoteFrame } from "./fixtures/remote-frame-gate.ts";
import { waitFor } from "./fixture.ts";

test("user Remote saves serialize shared pinned roots across profile/target aliases without sharing artifacts", { skip: process.platform !== "darwin", timeout: 30_000 }, async (t) => {
  const f = await profileFixture(() => {
    const secrets = new Map<string, string>();
    return { remote: { vault: { read: async (key) => secrets.get(key) ?? null, write: async (key, value) => { secrets.set(key, value); }, remove: async (key) => { secrets.delete(key); } } } };
  });
  const root = await realpath(f.directory), sshRoot = join(root, "ssh"), workspace = join(root, "shared-remote"), localA = join(root, "local-a"), localB = join(root, "local-b");
  for (const path of [sshRoot, workspace, localA, localB]) await mkdir(path, { mode: 0o700 });
  const ssh = await createSshTarget(sshRoot);
  try {
    const beta = await f.create("Generated Remote plan Beta");
    const sessions: Array<{ client: typeof f.sdk; id: string }> = [];
    for (const [index, client] of [f.sdk, beta.client].entries()) {
      const settings = structuredClone(client.settings.get()!.values);
      settings.remote = { ...ssh.target, id: `generated-plan-alias-${index}`, name: `Generated plan alias ${index}`, stateDir: join(sshRoot, `runs-${index}`), allowCopilot: false };
      await client.settings.update(settings, client.settings.get()!.revision);
      const project = await client.command({ type: "project.add", path: index ? localB : localA });
      const configuration = (await client.projects.configuration(project.id!)).configuration;
      await client.projects.configure(project.id!, { ...configuration.values, remotePath: workspace }, configuration.revision);
      await client.remote.probe();
      const session = await client.sessions.create(project.id!, `Generated scoped plan ${index}`, { env: "Remote", modelId: null });
      sessions.push({ client, id: session.id! });
    }
    const first = sessions[0]!, second = sessions[1]!, gate = holdRemoteFrame(t, f.service.controller.remote, "approval");
    const plan = await first.client.plans.read(first.id);
    const pending = first.client.plans.save(first.id, "Generated Default-only Remote snapshot.\n", plan.digest, plan.bindingDigest);
    await waitFor(() => gate.held);
    const other = await second.client.plans.read(second.id);
    await assert.rejects(() => second.client.plans.save(second.id, "Generated concurrent forbidden alias write.\n", other.digest, other.bindingDigest), /writer|busy|owned/i);
    assert.equal((await second.client.plans.saves(second.id)).saves.length, 0);
    gate.release();
    const original = await pending;
    const fresh = await second.client.plans.read(second.id);
    const replacement = await second.client.plans.save(second.id, "Generated Beta-only retained snapshot.\n", fresh.digest, fresh.bindingDigest);
    assert.equal((await first.client.artifacts.read(original.id!)).text, "Generated Default-only Remote snapshot.\n");
    assert.equal((await second.client.artifacts.read(replacement.id!)).text, "Generated Beta-only retained snapshot.\n");
    await assert.rejects(() => second.client.artifacts.read(original.id!), /outside|missing|deleted/i);
    const secondSave = (await second.client.plans.saves(second.id)).saves[0]!;
    await assert.rejects(() => first.client.plans.saveInfo(second.id, secondSave.id), { code: "not_found" });
    assert.equal(f.providers.reduce((count, provider) => count + provider.requests.length, 0), 0);
    assert.equal(f.service.controller.snapshot().budgetEntries.length, 0);
  } finally { await f.service.close(); await ssh.close(); await f.close(); }
});
