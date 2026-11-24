import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nativeConfiguration } from "./fixtures/native-target.ts";
import { nativeCheckpointFixture } from "./fixtures/native-checkpoint.ts";
import { ciTime } from "./fixtures/time-scale.ts";

const native = await nativeConfiguration();
for (const stopped of [false, true]) test(`native accepted-work checkpoint ${stopped ? "keeps Stop partial through exact effect inspection" : "publishes separately accepted source at its original Local root"} and preserves HEAD/index`, { skip: !native, timeout: ciTime(90000) }, async () => {
  assert.ok(native);
  const f = await nativeCheckpointFixture(native), { git, sessionId, record } = f, state = f.snapshot;
  let passed = false;
  try {
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated source original\n");
    const input = { winddownId: record.id, sessionId, candidateIds: [], nativePublicationIds: ["generated-missing-acceptance"],
      branch: "moguri/generated-native-checkpoint", message: "Retain separately accepted native work" };
    await assert.rejects(() => f.sdk.winddown.commitPreview(input), /accept|publication/i);
    const accepted = await f.accept();
    input.nativePublicationIds = [accepted.publication.id];
    await assert.rejects(() => f.sdk.winddown.commitPreview({ ...input, remoteAccepted: true }), /actual original boundary|fallback/i);
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
  } finally { await f.close(passed); }
});
