import test from "node:test";
import assert from "node:assert/strict";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriError } from "../packages/protocol/src/index.ts";
import { digest } from "../apps/service/src/store.ts";
import { candidateApiFixture } from "./fixtures/candidate-api.ts";

async function fixture() {
  const f = await candidateApiFixture();
  f.git(["config", "user.name", "Generated fixture"]); f.git(["config", "user.email", "fixture@example.invalid"]);
  const project = f.service.controller.snapshot().projects.find((project) => project.id === f.session().projectId)!;
  const projects = f.service.controller.platform.sessions.projects;
  const files = [
    { path: "fixture.txt", text: "Generated accepted checkpoint file.\n" },
    { path: "second.txt", text: "Generated second accepted checkpoint file.\n" },
  ];
  return { ...f, projectRecord: project, projects, files,
    preview: (branch = "generated/reviewed-checkpoint") => projects.artifactCommitPreview(project, branch, AbortSignal.timeout(5000)),
    accept: async () => {
      const staged = await f.stage({ ...f.patch, edits: files.map((file, index) => ({
        ...file, baseDigest: digest(index === 0 ? "generated original\n" : "Generated second base.\n"),
      })) });
      const review = (await f.sdk.candidates.applyPreview(staged.candidate.id, f.sessionId)).preview;
      await f.sdk.candidates.apply(staged.candidate.id, f.sessionId, staged.candidate.revision, review.digest);
      const result = await f.sdk.candidates.wait(staged.candidate.id);
      assert.equal(result.candidate.status, "applied"); assert.equal(result.candidate.acceptance?.actor, "user");
      return result;
    },
  };
}

test("reviewed multi-file checkpoints commit actual accepted candidate bytes on only the explicit new branch without changing source index/HEAD", async () => {
  const f = await fixture();
  try {
    await f.accept();
    await writeFile(join(f.project, "generated-staged.txt"), "Generated unrelated staged work.\n"); f.git(["add", "--", "generated-staged.txt"]);
    await writeFile(join(f.project, "generated-untracked.txt"), "Generated unrelated untracked work.\n");
    const index = await readFile(join(f.project, ".git/index")), head = f.git(["rev-parse", "HEAD"]), expected = await f.preview();
    let guards = 0, intent: string | null = null, committed: string | null = null;
    const result = await f.projects.reviewedCommit(f.projectRecord, f.files, expected, "chore: checkpoint reviewed accepted work", AbortSignal.timeout(10_000), {
      beforeCommit: () => { guards++; },
      publishIntent: async (value) => { intent = value.commit; },
      committed: (value) => { committed = value.commit; },
    });
    assert.equal(guards, 3); assert.equal(intent, result.commit); assert.equal(committed, result.commit);
    assert.equal(f.git(["rev-parse", `refs/heads/${expected.branch}`]), result.commit);
    assert.equal(f.git(["rev-parse", `${result.commit}^`]), expected.base);
    assert.equal(f.git(["diff-tree", "--no-commit-id", "--name-only", "-r", result.commit]), "fixture.txt\nsecond.txt");
    for (const file of f.files) {
      assert.equal(f.git(["show", `${result.commit}:${file.path}`]), file.text.trim());
      assert.equal(await readFile(join(f.project, file.path), "utf8"), file.text);
    }
    assert.deepEqual(await readFile(join(f.project, ".git/index")), index);
    assert.equal(f.git(["rev-parse", "HEAD"]), head); assert.equal(f.git(["branch", "--show-current"]), "main");
    assert.equal(f.git(["log", "-1", "--format=%B", result.commit]).includes("Co-authored-by"), false);
    assert.equal(f.git(["remote"]), ""); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("checkpoint preparation snapshots caller-owned files, review and project instead of retargeting to a different repository", async () => {
  const f = await fixture();
  try {
    const other = join(f.directory, "generated-other-repository"); f.git(["clone", "--no-hardlinks", "--", f.project, other]);
    const expected = await f.preview(), branch = expected.branch, project = { ...f.projectRecord }, files = f.files.map((file) => ({ ...file }));
    const result = await f.projects.reviewedCommit(project, files, expected, "Generated immutable checkpoint capture", AbortSignal.timeout(10_000), {
      publishIntent: async (value) => {
        project.path = other; expected.branch = "generated/unreviewed-retarget"; expected.base = "0".repeat(expected.base.length);
        files[0]!.text = "Generated later caller mutation.\n"; files.push({ path: "generated-unreviewed.txt", text: "Generated not reviewed.\n" });
        value.branch = "generated/mutated-callback"; value.commit = "0".repeat(value.commit.length);
      },
    });
    assert.equal(result.branch, branch); assert.equal(f.git(["rev-parse", `refs/heads/${branch}`]), result.commit);
    assert.equal(f.git(["show", `${result.commit}:fixture.txt`]), f.files[0]!.text.trim());
    assert.equal(f.git(["diff-tree", "--no-commit-id", "--name-only", "-r", result.commit]), "fixture.txt\nsecond.txt");
    assert.equal(f.git(["-C", other, "for-each-ref", "--format=%(objectname)", `refs/heads/${branch}`]), "");
  } finally { await f.close(); }
});

test("reviewed checkpoints preserve explicitly captured executable modes without touching working files", async () => {
  const f = await fixture();
  try {
    await chmod(join(f.project, "fixture.txt"), 0o755);
    const expected = await f.preview(), before = (await stat(join(f.project, "fixture.txt"))).mode;
    const result = await f.projects.reviewedCommit(f.projectRecord, [{ ...f.files[0]!, mode: "100755" }], expected,
      "chore: checkpoint explicitly reviewed executable", AbortSignal.timeout(10_000));
    assert.match(f.git(["ls-tree", result.commit, "--", "fixture.txt"]), /^100755 blob /);
    assert.equal((await stat(join(f.project, "fixture.txt"))).mode, before);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
  } finally { await f.close(); }
});

test("denied checkpoint authority fails before preparing Git objects or publishing a branch", async () => {
  const f = await fixture();
  try {
    const expected = await f.preview(), before = f.git(["count-objects", "-v"]);
    await assert.rejects(() => f.projects.reviewedCommit(f.projectRecord, f.files, expected, "Generated denied checkpoint", AbortSignal.timeout(10_000), {
      beforeCommit: () => { throw new MoguriError("generated_commit_denied", "Generated actual Git authorization denied."); },
    }), { code: "generated_commit_denied" });
    assert.equal(f.git(["count-objects", "-v"]), before);
    assert.equal(f.git(["for-each-ref", "--format=%(objectname)", `refs/heads/${expected.branch}`]), "");
  } finally { await f.close(); }
});

test("failed checkpoint publication-intent retention cannot create the local branch", async () => {
  const f = await fixture();
  try {
    const expected = await f.preview(); let prepared: string | null = null;
    await assert.rejects(() => f.projects.reviewedCommit(f.projectRecord, f.files, expected, "Generated failed intent", AbortSignal.timeout(10_000), {
      publishIntent: async (value) => { prepared = value.commit; throw new Error("Generated checkpoint intent append failure."); },
    }), /intent append failure/);
    assert.ok(prepared); assert.equal(f.git(["for-each-ref", "--format=%(objectname)", `refs/heads/${expected.branch}`]), "");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
  } finally { await f.close(); }
});

test("abort inside the last checkpoint authority guard prevents branch publication", async () => {
  const f = await fixture(), abort = new AbortController(); let guards = 0, intent = false;
  try {
    const expected = await f.preview();
    await assert.rejects(() => f.projects.reviewedCommit(f.projectRecord, f.files, expected, "Generated last-guard stop", abort.signal, {
      beforeCommit: () => { if (++guards === 2) abort.abort(new Error("Generated checkpoint cancelled before publication.")); },
      publishIntent: async () => { intent = true; },
    }), /cancelled before publication/);
    assert.equal(intent, true); assert.equal(f.git(["for-each-ref", "--format=%(objectname)", `refs/heads/${expected.branch}`]), "");
  } finally { await f.close(); }
});

test("a competing branch is never overwritten after the exact checkpoint intent was retained", async () => {
  const f = await fixture();
  try {
    const expected = await f.preview();
    await assert.rejects(() => f.projects.reviewedCommit(f.projectRecord, f.files, expected, "Generated competing checkpoint", AbortSignal.timeout(10_000), {
      publishIntent: async () => { f.git(["branch", expected.branch, expected.base]); },
    }), /exited|exists|lock/);
    assert.equal(f.git(["rev-parse", `refs/heads/${expected.branch}`]), expected.base);
  } finally { await f.close(); }
});

test("checkpoint preparation cannot publish against a HEAD changed while retaining intent", async () => {
  const f = await fixture();
  try {
    const expected = await f.preview();
    await assert.rejects(() => f.projects.reviewedCommit(f.projectRecord, f.files, expected, "Generated stale checkpoint", AbortSignal.timeout(10_000), {
      publishIntent: async () => { f.git(["commit", "--no-gpg-sign", "--allow-empty", "-m", "Generated independent user HEAD change"]); },
    }), /HEAD changed/);
    assert.notEqual(f.git(["rev-parse", "HEAD"]), expected.base);
    assert.equal(f.git(["for-each-ref", "--format=%(objectname)", `refs/heads/${expected.branch}`]), "");
  } finally { await f.close(); }
});

test("post-publication cancellation and lost acknowledgements remain observable failures with the actual checkpoint ref preserved", async () => {
  const f = await fixture();
  try {
    for (const failure of ["cancel", "receipt"] as const) {
      const abort = new AbortController(), expected = await f.preview(`generated/checkpoint-${failure}`); let published: string | null = null;
      await assert.rejects(() => f.projects.reviewedCommit(f.projectRecord, f.files, expected, "Generated post-publication failure", abort.signal, {
        committed: (value) => {
          published = value.commit;
          if (failure === "cancel") abort.abort(new Error("Generated stop after actual checkpoint publication."));
          else throw new Error("Generated lost checkpoint acknowledgement.");
        },
      }), failure === "cancel" ? /stop after actual/ : /lost checkpoint/);
      assert.ok(published); assert.equal(f.git(["rev-parse", `refs/heads/${expected.branch}`]), published);
      assert.equal(f.git(["rev-parse", "HEAD"]), expected.base);
    }
  } finally { await f.close(); }
});

test("a changed reference after real publication cannot be acknowledged as a verified checkpoint", async () => {
  const f = await fixture();
  try {
    const expected = await f.preview(); let published: string | null = null;
    await assert.rejects(() => f.projects.reviewedCommit(f.projectRecord, f.files, expected, "Generated moved checkpoint", AbortSignal.timeout(10_000), {
      committed: (value) => { published = value.commit; f.git(["update-ref", `refs/heads/${value.branch}`, value.base, value.commit]); },
    }), { code: "reviewed_commit_changed" });
    assert.ok(published); assert.equal(f.git(["rev-parse", `refs/heads/${expected.branch}`]), expected.base);
  } finally { await f.close(); }
});

test("invalid duplicate/protected checkpoint paths are rejected as a complete set before Git preparation", async () => {
  const f = await fixture();
  try {
    const expected = await f.preview(), before = f.git(["count-objects", "-v"]);
    for (const files of [[f.files[0]!, f.files[0]!], [f.files[0]!, { path: ".git/config", text: "Generated forbidden data." }]]) {
      await assert.rejects(() => f.projects.reviewedCommit(f.projectRecord, files, expected, "Generated invalid checkpoint", AbortSignal.timeout(10_000)), /distinct|protected/);
    }
    assert.equal(f.git(["count-objects", "-v"]), before);
  } finally { await f.close(); }
});
