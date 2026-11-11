import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defaultSandboxManagement, MoguriSdk } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { distributionConfiguration, readSandboxDistribution } from "../apps/service/src/sandbox-distribution.ts";
import { nativeApiFixture } from "./fixtures/native-api.ts";
import { waitFor } from "./fixture.ts";
import { sandboxFixtureGit } from "./fixtures/sandbox-rewind.ts";

const distributionPath = process.env.MOGURI_SANDBOX_DISTRIBUTION;
for (const kind of ["project", "empty", "group"] as const) test(`the actual ${kind} native guest captures signed terminal files and rewind binds a fresh private stage without publication or replay`, {
  skip: process.platform !== "darwin" || process.arch !== "arm64" || !distributionPath, timeout: 180000,
}, async () => {
  const distribution = await readSandboxDistribution(distributionPath!, AbortSignal.timeout(30000));
  const configuration = distributionConfiguration(distribution.distribution);
  const fixture = await nativeApiFixture(configuration, { distribution: distributionPath, group: kind === "group" });
  let passed = false;
  try {
    const settings = fixture.sdk.settings.get()!;
    await fixture.sdk.settings.update({ ...settings.values, sandbox: fixture.reviewedConfiguration,
      sandboxManagement: { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false } }, settings.revision);
    await fixture.qualify();
    const ids: string[] = [];
    if (kind !== "empty") ids.push((await fixture.sdk.projects.add(fixture.project)).id!);
    if (kind === "group") {
      const second = join(fixture.root, "second-source"); await mkdir(second, { mode: 0o700 });
      await writeFile(join(second, "fixture.txt"), "generated source original\n");
      ids.push((await fixture.sdk.projects.add(second)).id!);
    }
    const controls = { env: "Sandbox" as const, modelId: fixture.provider.modelId };
    const folder = kind === "group" ? await fixture.sdk.projects.group("Generated rewind roots", ids.map((projectId) => ({
      projectId, revision: fixture.sdk.getState().snapshot!.projectConfigurations.find((configuration) => configuration.projectId === projectId)?.revision ?? 0,
    }))) : null;
    const created = folder ? await fixture.sdk.sessions.createFolder(folder.id!, "Generated grouped native rewind", controls) :
      await fixture.sdk.sessions.create(ids[0] ?? null, "Generated native per-turn rewind", controls);
    const sessionId = created.id!, session = () => fixture.service.controller.snapshot().sessions.find((session) => session.id === sessionId)!;
    if (kind !== "group") await fixture.sdk.sessions.autonomy(sessionId, "Autopilot");
    const send = async (text: string) => {
      const saved = await fixture.sdk.command({ type: "draft.save", sessionId, expectedRevision: session().draft.revision, text, attachments: [] });
      await fixture.sdk.command({ type: "message.send", sessionId, expectedRevision: saved.revision!, delivery: "queue" });
      const deadline = Date.now() + 60000, approved = new Set<string>();
      while (session().turnId || !["completed", "failed", "partial", "stopped"].includes(session().status)) {
        const approval = session().pendingApproval;
        if (approval && !approved.has(approval.id)) { approved.add(approval.id); await fixture.sdk.approvals.respond(sessionId, approval.id, true); }
        if (Date.now() >= deadline) throw new Error(`The actual native ${kind} turn did not settle: ${session().lastError ?? session().status}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(session().status, "completed", session().lastError ?? "");
      const admitted = fixture.service.controller.snapshot().checkpoints.findLast((checkpoint) => checkpoint.sessionId === sessionId)!;
      return waitFor(() => fixture.service.controller.snapshot().checkpoints.find((checkpoint) => checkpoint.id === admitted.id && checkpoint.terminal?.afterDigest), 30000);
    };
    const prompt = kind === "group" ? `generated native group ${ids.join(" ")}` :
      kind === "empty" ? "generated native root-less private turn" : "generated native write with a real per-turn checkpoint";
    const checkpoint = await send(prompt);
    const captured = await fixture.sdk.checkpoints.read(sessionId, checkpoint.id);
    const originals = (workspace: typeof captured.before) => workspace!.roots.flatMap((root) => root.files).filter((file) => file.path.endsWith("fixture.txt"));
    const value = (file: ReturnType<typeof originals>[number]) => Buffer.from(file.content, "base64").toString("utf8");
    assert.equal(captured.before?.boundary?.env, "Sandbox"); assert.equal(captured.after?.boundary?.env, "Sandbox");
    assert.equal(captured.before?.roots.length, kind === "group" ? 2 : 1);
    if (kind === "empty") assert.deepEqual(captured.before?.roots[0]?.files, []);
    else for (const file of originals(captured.before)) assert.equal(value(file), "generated source original\n");
    if (kind === "project") assert.equal(value(originals(captured.after)[0]!), "generated native replacement\n");
    if (kind === "group") assert.deepEqual(originals(captured.after).map(value), ["Generated native group output 0.\n", "Generated native group output 1.\n"]);
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated source original\n");
    const active = fixture.service.controller.snapshot().sandboxWorkspaces!.find((workspace) => workspace.id === session().sandboxWorkspaceId)!.stage!;
    const stagedPath = originals(captured.after)[0]?.path ?? "generated-native-proof.json", unrelated = join(dirname(stagedPath), "generated-unrelated.txt");
    sandboxFixtureGit(active.workspace, ["init", "--quiet", "--initial-branch=generated"]);
    sandboxFixtureGit(active.workspace, ["add", "--", stagedPath]);
    const gitIndex = await readFile(join(active.workspace, ".git", "index")), gitHead = await readFile(join(active.workspace, ".git", "HEAD"));
    await writeFile(join(active.workspace, unrelated), "Generated external private file stays current.\n");
    const { preview } = await fixture.sdk.checkpoints.preview(sessionId, checkpoint.id, "workspace");
    assert.deepEqual(preview.blockers, []);
    const budget = structuredClone(fixture.service.controller.snapshot().budgetEntries), stage = session().sandboxWorkspaceId;
    const applied = await fixture.sdk.checkpoints.apply(sessionId, checkpoint.id, "workspace", preview.digest,
      preview.files.map((file) => ({ root: file.root, path: file.path, choice: kind === "empty" || file.path.endsWith("fixture.txt") ? "restore-checkpoint" : "keep-current" })));
    assert.notEqual(session().sandboxWorkspaceId, stage);
    assert.deepEqual(fixture.service.controller.snapshot().budgetEntries, budget);
    assert.equal((await fixture.sdk.checkpoints.inspect(sessionId, applied.id!)).operationSettled, true);
    const restored = fixture.service.controller.snapshot().sandboxWorkspaces!.find((workspace) => workspace.id === session().sandboxWorkspaceId)!.stage!;
    assert.deepEqual(await readFile(join(restored.workspace, ".git", "index")), gitIndex);
    assert.deepEqual(await readFile(join(restored.workspace, ".git", "HEAD")), gitHead);
    assert.equal(await readFile(join(restored.workspace, unrelated), "utf8"), "Generated external private file stays current.\n");
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated source original\n");
    const following = await send(kind === "group" ? prompt : "generated native continuation after explicit rewind");
    assert.notEqual(following.id, checkpoint.id);
    const input = await fixture.sdk.checkpoints.read(sessionId, following.id);
    if (kind === "empty") assert.deepEqual(input.before?.roots[0]?.files.map((file) => file.path), ["generated-unrelated.txt"]);
    else for (const file of originals(input.before)) assert.equal(value(file), "generated source original\n");
    assert.ok(fixture.service.controller.snapshot().rewinds.every((record) => record.status === "completed"));
    for (const id of [checkpoint.id, following.id]) {
      const retained = (await fixture.sdk.checkpoints.read(sessionId, id)).checkpoint;
      await fixture.sdk.checkpoints.prune(sessionId, id, retained.revision);
      assert.equal((await fixture.sdk.checkpoints.read(sessionId, id)).state, null);
    }
    if (kind === "project") {
      const retainedBudget = structuredClone(fixture.service.controller.snapshot().budgetEntries);
      fixture.sdk.disconnect(); await fixture.service.close();
      const service = await startService(fixture.runtimeOptions), sdk = await new MoguriSdk(service.connection).ready();
      try {
        await waitFor(() => service.controller.snapshot().capabilities.find((capability) => capability.env === "Sandbox")?.ready, 30000);
        assert.deepEqual(service.controller.snapshot().budgetEntries, retainedBudget);
        assert.ok((await sdk.checkpoints.list(sessionId)).checkpoints.every((checkpoint) => checkpoint.forgotten));
        assert.equal((await sdk.checkpoints.inspect(sessionId, applied.id!)).record.status, "completed");
      } finally { sdk.disconnect(); await service.close(); }
    }
    passed = true;
  } finally { await fixture.close(passed); }
});
