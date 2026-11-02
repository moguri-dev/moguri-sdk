import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultSandboxManagement, type StoredEvent } from "../packages/sdk/src/index.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { nativeConfiguration } from "./fixtures/native-target.ts";
import { nativeApiFixture } from "./fixtures/native-api.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { waitFor } from "./fixture.ts";

const native = await nativeConfiguration();
for (const stopped of [false, true]) test(`native accepted-work checkpoint ${stopped ? "keeps Stop partial through exact effect inspection" : "publishes separately accepted source at its original Local root"} and preserves HEAD/index`, { skip: !native, timeout: 90000 }, async () => {
  assert.ok(native);
  const f = await nativeApiFixture(native, { scenario: "checkpoint" }), git = initializeGeneratedRepository(f.project);
  git(["config", "user.name", "Generated fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
  let passed = false, tightened: Promise<unknown> | undefined, sessionId = "";
  const change = (events: StoredEvent[]) => {
    if (tightened || !events.some((event) => event.event_type === "tool.completed" && event.session_id === sessionId &&
      event.payload.call.name === "write_file" && event.payload.outcome === "completed")) return;
    const snapshot = f.service.controller.snapshot(), record = snapshot.winddowns[0]!;
    tightened = f.service.controller.dispatch(envelope({ type: "budget.policy", expectedRevision: snapshot.budgetPolicy.revision,
      limit: { basis: "estimate", tokens: 84 + record.step.inputBound + record.step.outputBound }, confirmRisk: true }));
  };
  try {
    const settings = structuredClone(f.sdk.settings.get()!);
    settings.values.sandbox = f.reviewedConfiguration; settings.values.sandboxManagement = { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false };
    settings.values.winddown = { ...settings.values.winddown, enabled: true, modelId: f.provider.modelId, allowHosted: true, outputTokens: 128 };
    await f.sdk.settings.update(settings.values, settings.revision); await f.sdk.sandbox.probe();
    const bound = await f.sdk.projects.add(f.project), created = await f.sdk.sessions.create(bound.id!, "Generated accepted native checkpoint",
      { env: "Sandbox", modelId: f.provider.modelId, budget: { kind: "limited", basis: "estimate", tokens: 500000 } });
    sessionId = created.id!; await f.sdk.sessions.autonomy(sessionId, "Autopilot");
    const session = () => f.service.controller.snapshot().sessions.find((entry) => entry.id === sessionId)!;
    f.service.controller.on("change", change);
    await f.sdk.command({ type: "draft.save", sessionId, expectedRevision: 0, text: "Generated native checkpoint work.", attachments: [] });
    await f.sdk.command({ type: "message.send", sessionId, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => !session().turnId && ["completed", "partial", "failed"].includes(session().status), 30000); await tightened;
    const state = f.service.controller.snapshot(), record = state.winddowns[0]!, execution = state.sandboxExecutions![0]!;
    assert.equal(record.status, "ready", record.diagnostic ?? ""); assert.equal(session().status, "partial");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated source original\n");
    const input = { winddownId: record.id, sessionId, candidateIds: [], nativePublicationIds: ["generated-missing-acceptance"],
      branch: "moguri/generated-native-checkpoint", message: "Retain separately accepted native work" };
    await assert.rejects(() => f.sdk.winddown.commitPreview(input), /accept|publication/i);
    const source = await f.sdk.sandbox.publicationPreview(execution.id, ["fixture.txt"]);
    const admitted = await f.sdk.sandbox.publish(execution.id, ["fixture.txt"], source.preview.digest, execution.revision);
    const accepted = await f.sdk.sandbox.waitPublication(admitted.id!);
    assert.equal(accepted.publication.status, "completed");
    input.nativePublicationIds = [accepted.publication.id];
    await f.sdk.command({ type: "policy.set", allowedEnvs: ["Sandbox"] });
    await assert.rejects(() => f.sdk.winddown.commitPreview(input), /Local Git policy|original.*source/i);
    await f.sdk.command({ type: "policy.set", allowedEnvs: ["Local", "Sandbox", "Remote"] });
    await writeFile(join(f.project, "fixture.txt"), "Generated changed after separate native acceptance.\n");
    await assert.rejects(() => f.sdk.winddown.commitPreview(input), /source bytes changed|accepted.*changed/i);
    await writeFile(join(f.project, "fixture.txt"), "Generated separately accepted native checkpoint bytes.\n");
    await writeFile(join(f.project, "generated-unrelated.txt"), "Generated unrelated staged native source work.\n");
    git(["add", "--", "generated-unrelated.txt"]);
    const head = git(["rev-parse", "HEAD"]), index = await readFile(join(f.project, ".git/index"));
    const preview = await f.sdk.winddown.commitPreview(input);
    assert.equal(preview.preview.document.version, 2);
    if (preview.preview.document.version === 2) {
      assert.equal(preview.preview.document.modelEnv, "Sandbox"); assert.equal(preview.preview.document.publicationEnv, "Local");
    }
    if (stopped) {
      const projects = f.service.controller.platform.sessions.projects, original = projects.reviewedCommit.bind(projects);
      projects.reviewedCommit = async (...args) => {
        const result = await original(...args); await f.sdk.winddown.stop(record.id); return result;
      };
    }
    await f.sdk.winddown.commit(input, preview.preview.revision, preview.preview.digest, true);
    const complete = await f.sdk.winddown.waitCommit(record.id);
    assert.equal(complete.winddown.status, stopped ? "partial" : "completed", complete.winddown.diagnostic ?? "");
    if (stopped) {
      assert.equal(complete.winddown.commit?.cancelRequested, true);
      assert.ok(f.service.controller.ownedWriteRoots().includes(f.project));
      const inspection = await f.sdk.winddown.inspectCommit(record.id);
      assert.equal(inspection.inspection.review.document.publicationEnv, "Local");
      assert.equal(inspection.inspection.review.document.actualCommit, complete.winddown.commit?.publishedCommit);
      await f.sdk.winddown.reconcileCommit(record.id, inspection.inspection.review.revision, inspection.inspection.review.digest, true);
      const retained = await f.sdk.winddown.read(record.id);
      assert.equal(retained.winddown.status, "partial"); assert.equal(retained.winddown.commit?.cancelRequested, true);
      assert.equal(retained.commitInspection?.actualCommit, complete.winddown.commit?.publishedCommit);
      assert.equal(f.service.controller.ownedWriteRoots().includes(f.project), false);
    }
    assert.equal(git(["show", `${input.branch}:fixture.txt`]), "Generated separately accepted native checkpoint bytes.");
    assert.equal(git(["diff-tree", "--no-commit-id", "--name-only", "-r", input.branch]), "fixture.txt");
    assert.equal(git(["rev-parse", "HEAD"]), head); assert.deepEqual(await readFile(join(f.project, ".git/index")), index);
    assert.equal(f.provider.requests.length, 0); assert.equal(f.service.controller.snapshot().sandboxExecutions!.length, 1);
    assert.deepEqual(state.budgetEntries.map((entry) => [entry.env, entry.role, entry.reportedTokens]), [["Sandbox", "solver", 42], ["Sandbox", "solver", 42], ["Sandbox", "checkpoint", 42]]);
    passed = true;
  } finally { f.service.controller.off("change", change); await tightened; await f.close(passed); }
});
