import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { winddownApiFixture } from "./fixtures/winddown-api.ts";
import { digest } from "../apps/service/src/store.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("budget wind-down accepts only separately reviewed actual-user accepted bytes on a new local branch, preserving source index/HEAD and original paid intent", { skip: process.platform !== "darwin", timeout: ciTime(25000) }, async () => {
  const f = await winddownApiFixture({ git: true });
  try {
    const accepted = await f.accept(); assert.equal(accepted.candidate.acceptance?.actor, "user");
    const checkpoint = await f.run(); assert.equal(checkpoint.winddown.status, "ready"); assert.ok(f.git);
    await f.unrelated();
    const index = await readFile(join(f.project, ".git/index")), head = f.git(["rev-parse", "HEAD"]);
    const input = { winddownId: checkpoint.winddown.id, sessionId: f.sessionId, candidateIds: [accepted.candidate.id],
      branch: "moguri/generated-reviewed-budget-checkpoint", message: "chore: retain explicitly accepted checkpoint work" };
    await assert.rejects(() => f.sdk.winddown.commitPreview({ ...input, remoteAccepted: true }), /actual original boundary|fallback/i);
    const preview = await f.sdk.winddown.commitPreview(input);
    assert.equal(f.git(["rev-parse", "HEAD"]), head); assert.deepEqual(await readFile(join(f.project, ".git/index")), index);
    const created = await f.sdk.winddown.commit(input, preview.preview.revision, preview.preview.digest, true); assert.equal(created.id, checkpoint.winddown.id);
    const result = await f.sdk.winddown.waitCommit(checkpoint.winddown.id);
    assert.equal(result.winddown.status, "completed"); assert.equal(result.winddown.commit?.actor, "user");
    assert.ok(result.winddown.commit?.publishedCommit);
    assert.equal(f.git(["rev-parse", "refs/heads/" + input.branch]), result.winddown.commit.publishedCommit);
    assert.equal(f.git(["diff-tree", "--no-commit-id", "--name-only", "-r", result.winddown.commit.publishedCommit]), "fixture.txt");
    assert.equal(f.git(["rev-parse", "HEAD"]), head); assert.deepEqual(await readFile(join(f.project, ".git/index")), index);
    assert.equal(f.requests.length, 1); assert.equal(f.checkpoint.requests.length, 1);
  } finally { await f.close(); }
});

test("a separately staged but unaccepted candidate and changed actual accepted bytes cannot become a budget Git checkpoint", { skip: process.platform !== "darwin", timeout: ciTime(20000) }, async () => {
  const f = await winddownApiFixture({ git: true });
  try {
    const accepted = await f.accept(), checkpoint = await f.run(); assert.ok(f.git);
    const input = { winddownId: checkpoint.winddown.id, sessionId: f.sessionId, candidateIds: [accepted.candidate.id],
      branch: "moguri/generated-budget-stale-source", message: "Generated exact accepted-work review" };
    const stage = await f.sdk.workspaces.wait((await f.sdk.workspaces.create(f.session().projectId, "moguri/generated-unaccepted-budget-candidate")).id!);
    const patch = { kind: "patch" as const, summary: "Generated staged-only bytes are not acceptance.", edits: [{ path: "fixture.txt",
      baseDigest: digest(accepted.document.patch.edits[0]!.text), text: "Generated unaccepted candidate.\n" }] };
    const staging = (await f.sdk.candidates.preview(f.sessionId, stage.id, patch)).preview;
    const unaccepted = await f.sdk.candidates.wait((await f.sdk.candidates.stage(f.sessionId, stage.id, patch, staging.digest)).id!);
    await assert.rejects(() => f.sdk.winddown.commitPreview({ ...input, candidateIds: [unaccepted.candidate.id] }), /acceptance|accepted/i);
    const preview = await f.sdk.winddown.commitPreview(input);
    await writeFile(join(f.project, "fixture.txt"), "Generated later actual-user source change.\n");
    await assert.rejects(() => f.sdk.winddown.commit(input, preview.preview.revision, preview.preview.digest, true), /changed|acceptance|exact|source/i);
    assert.equal((await f.sdk.winddown.read(checkpoint.winddown.id)).winddown.commit, null);
    assert.equal(f.git(["for-each-ref", "--format=%(refname)", "refs/heads/" + input.branch]), "");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "Generated later actual-user source change.\n");
    assert.equal(f.checkpoint.requests.length, 1);
  } finally { await f.close(); }
});
