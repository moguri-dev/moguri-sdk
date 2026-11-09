import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultSandboxManagement } from "../packages/sdk/src/index.ts";
import { distributionConfiguration, readSandboxDistribution } from "../apps/service/src/sandbox-distribution.ts";
import { nativeApiFixture } from "./fixtures/native-api.ts";
import { waitFor } from "./fixture.ts";

const distributionPath = process.env.MOGURI_SANDBOX_DISTRIBUTION;
test("the actual native guest captures its signed terminal tree and reviewed rewind binds a fresh private stage without publishing or replay", {
  skip: process.platform !== "darwin" || process.arch !== "arm64" || !distributionPath, timeout: 180000,
}, async () => {
  const distribution = await readSandboxDistribution(distributionPath!, AbortSignal.timeout(30000));
  const configuration = distributionConfiguration(distribution.distribution, "/opt/moguri/sendbox/0.2.4");
  const fixture = await nativeApiFixture(configuration, { distribution: distributionPath });
  let passed = false;
  try {
    const settings = fixture.sdk.settings.get()!;
    await fixture.sdk.settings.update({ ...settings.values, sandbox: fixture.reviewedConfiguration,
      sandboxManagement: { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false } }, settings.revision);
    await fixture.qualify();
    const project = await fixture.sdk.projects.add(fixture.project);
    const created = await fixture.sdk.sessions.create(project.id!, "Generated native per-turn rewind", { env: "Sandbox", modelId: fixture.provider.modelId });
    const sessionId = created.id!, session = () => fixture.service.controller.snapshot().sessions.find((session) => session.id === sessionId)!;
    await fixture.sdk.sessions.autonomy(sessionId, "Autopilot");
    const send = async (text: string) => {
      const saved = await fixture.sdk.command({ type: "draft.save", sessionId, expectedRevision: session().draft.revision, text, attachments: [] });
      await fixture.sdk.command({ type: "message.send", sessionId, expectedRevision: saved.revision!, delivery: "queue" });
      await waitFor(() => !session().turnId && ["completed", "failed", "partial", "stopped"].includes(session().status) && session(), 60000);
      assert.equal(session().status, "completed", session().lastError ?? "");
      const admitted = fixture.service.controller.snapshot().checkpoints.findLast((checkpoint) => checkpoint.sessionId === sessionId)!;
      return waitFor(() => fixture.service.controller.snapshot().checkpoints.find((checkpoint) => checkpoint.id === admitted.id && checkpoint.terminal?.afterDigest), 30000);
    };
    const checkpoint = await send("generated native write with a real per-turn checkpoint");
    const captured = await fixture.sdk.checkpoints.read(sessionId, checkpoint.id);
    const value = (workspace: typeof captured.before) => Buffer.from(workspace!.roots.flatMap((root) => root.files).find((file) => file.path === "fixture.txt")!.content, "base64").toString("utf8");
    assert.equal(captured.before?.boundary?.env, "Sandbox"); assert.equal(captured.after?.boundary?.env, "Sandbox");
    assert.equal(value(captured.before), "generated source original\n"); assert.equal(value(captured.after), "generated native replacement\n");
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated source original\n");
    const { preview } = await fixture.sdk.checkpoints.preview(sessionId, checkpoint.id, "workspace");
    assert.deepEqual(preview.blockers, []);
    const budget = structuredClone(fixture.service.controller.snapshot().budgetEntries), stage = session().sandboxWorkspaceId;
    const applied = await fixture.sdk.checkpoints.apply(sessionId, checkpoint.id, "workspace", preview.digest,
      preview.files.map((file) => ({ root: file.root, path: file.path, choice: file.path === "fixture.txt" ? "restore-checkpoint" : "keep-current" })));
    assert.notEqual(session().sandboxWorkspaceId, stage);
    assert.deepEqual(fixture.service.controller.snapshot().budgetEntries, budget);
    assert.equal((await fixture.sdk.checkpoints.inspect(sessionId, applied.id!)).operationSettled, true);
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated source original\n");
    const following = await send("generated native continuation after explicit rewind");
    assert.notEqual(following.id, checkpoint.id);
    const input = await fixture.sdk.checkpoints.read(sessionId, following.id);
    assert.equal(value(input.before), "generated source original\n");
    assert.ok(fixture.service.controller.snapshot().rewinds.every((record) => record.status === "completed"));
    passed = true;
  } finally { await fixture.close(passed); }
});
