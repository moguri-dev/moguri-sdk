import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFile, realpath, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { MoguriError } from "../packages/protocol/src/index.ts";
import { digest } from "../apps/service/src/store.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { applyCandidate, CandidatePartial, stageCandidate, type CandidateAuthority, type CandidateEffect, type CandidateReview } from "./fixtures/candidate-prototype.ts";
import { compoundProviderFixture } from "./fixtures/compound-provider.ts";
import { compoundRoutingPrimitive } from "./fixtures/compound-routing-prototype.ts";
import { ciTime } from "./fixtures/time-scale.ts";

const proposal = { kind: "patch" as const, summary: "Generated bounded proposal.", edits: [
  { path: "fixture.txt", baseDigest: digest("generated original\n"), text: "Generated reviewed candidate.\n" },
] };
const twoFiles = { ...proposal, edits: [...proposal.edits, { path: "second.ts", baseDigest: digest("Generated second base.\n"), text: "Generated second candidate.\n" }] };

async function fixture() {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  await writeFile(join(f.project, "second.ts"), "Generated second base.\n");
  await writeFile(join(f.project, "unrelated.txt"), "Generated unrelated base.\n");
  const git = initializeGeneratedRepository(f.project, ["fixture.txt", "second.ts", "unrelated.txt"]);
  const projectId = f.session().projectId;
  const created = await sdk.workspaces.create(projectId, "moguri/generated-candidate");
  const workspace = await sdk.workspaces.wait(created.id!);
  assert.equal(workspace.status, "ready");
  let approved: string | null = null, policyRevision = 0;
  const effects: CandidateEffect[] = [];
  const authority: CandidateAuthority = {
    scope: () => ({ profileId: sdk.getState().snapshot!.profileId, projectId, workspaceId: workspace.id,
      source: sdk.getState().snapshot!.projects.find((project) => project.id === projectId)!.path,
      stage: workspace.path, baseCommit: workspace.baseCommit, policyRevision }),
    signal: new AbortController().signal,
    assert: async (phase) => {
      const current = (await sdk.workspaces.inspect(workspace.id)).inspection;
      assert.equal(current.registered, true); assert.equal(current.canonical, true);
      assert.equal(current.diagnostic, null); assert.equal(current.head, workspace.baseCommit);
      assert.equal(git(["rev-parse", "HEAD"]), workspace.baseCommit);
      if (phase === "prepare" && current.status) throw new MoguriError("candidate_stage_busy", "The owned candidate root has existing changes. Preserve and inspect them instead of overwriting its staging base.", 409);
    },
    current: () => { assert.equal(sdk.getState().snapshot!.profileId, "default"); },
    approve: async (review) => { if (approved !== review) throw new Error("Generated actual-user review has not authorized this exact candidate."); },
    record: async (effect) => { effects.push(effect); },
  };
  return { ...f, sdk, git, workspace, authority, effects,
    approve: (review: string | null) => { approved = review; }, changePolicy: () => { policyRevision++; },
    close: async () => { sdk.disconnect(); await f.close(); } };
}

test("owned candidate staging preserves the source until exact review and base-checked application preserves the real index and unrelated edits", { timeout: ciTime(30_000) }, async () => {
  const f = await fixture(), started = performance.now();
  try {
    const base = "generated original\nGenerated existing user line.\n", proposed = `${base}Generated candidate append.\n`;
    await writeFile(join(f.project, "fixture.txt"), base);
    await writeFile(join(f.project, "unrelated.txt"), "Generated user's separately staged edit.\n"); f.git(["add", "--", "unrelated.txt"]);
    await writeFile(join(f.project, "untracked.txt"), "Generated untracked user content.\n");
    const originalIndex = f.git(["write-tree"]), originalHead = f.git(["rev-parse", "HEAD"]);
    const originalIndexBytes = await readFile(join(f.project, ".git/index"));
    const review = await stageCandidate({ kind: "patch", summary: "Generated unaccepted patch.", edits: [
      { path: "fixture.txt", baseDigest: digest(base), text: proposed },
      { path: "generated.ts", baseDigest: "absent", text: "export const generated = true;\n" },
    ] }, f.authority);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), base);
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), proposed);
    await assert.rejects(() => readFile(join(f.project, "generated.ts")), /ENOENT/);
    await assert.rejects(() => applyCandidate(review, review.digest, f.authority), /actual-user review/);
    f.approve(review.digest);
    const result = await applyCandidate(review, review.digest, f.authority);
    assert.equal(result.status, "applied"); assert.deepEqual(result.applied, ["fixture.txt", "generated.ts"]);
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), proposed);
    assert.equal(await readFile(join(f.project, "generated.ts"), "utf8"), "export const generated = true;\n");
    assert.deepEqual(await readFile(join(f.project, ".git/index")), originalIndexBytes);
    assert.equal(f.git(["write-tree"]), originalIndex); assert.equal(f.git(["rev-parse", "HEAD"]), originalHead);
    assert.equal(f.git(["branch", "--show-current"]), "main");
    assert.equal(await readFile(join(f.project, "unrelated.txt"), "utf8"), "Generated user's separately staged edit.\n");
    assert.equal(await readFile(join(f.project, "untracked.txt"), "utf8"), "Generated untracked user content.\n");
    assert.equal(f.requests.length, 0);
    console.log(JSON.stringify({ primitive: "generated-owned-candidate", ms: performance.now() - started, sourceIndexPreserved: true, sourceHeadPreserved: true, applied: result.applied }));
  } finally { await f.close(); }
});

test("a staged-file change while retaining application intent is rejected before any source publication", { timeout: ciTime(30_000) }, async () => {
  const f = await fixture();
  try {
    const review = await stageCandidate({ kind: "patch", summary: "Generated exact staged candidate.", edits: [
      { path: "fixture.txt", baseDigest: digest("generated original\n"), text: "Generated approved candidate.\n" },
    ] }, f.authority);
    f.approve(review.digest);
    await assert.rejects(() => applyCandidate(review, review.digest, { ...f.authority, record: async (effect) => {
      await f.authority.record(effect);
      if (effect.phase === "apply.started") await writeFile(join(f.workspace.path, "fixture.txt"), "Generated later stage edit.\n");
    } }), { code: "candidate_stage" });
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "Generated later stage edit.\n");
  } finally { await f.close(); }
});

test("case aliases of one actual file are rejected before staging any candidate bytes", { timeout: ciTime(30_000) }, async (t) => {
  const f = await fixture();
  try {
    let upper: string;
    try { upper = await realpath(join(f.project, "FIXTURE.TXT")); }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      t.skip("This filesystem has distinct case-sensitive paths."); return;
    }
    if (upper !== await realpath(join(f.project, "fixture.txt"))) { t.skip("This filesystem has distinct case-sensitive paths."); return; }
    await assert.rejects(() => stageCandidate({ kind: "patch", summary: "Generated ambiguous physical paths.", edits: [
      { path: "fixture.txt", baseDigest: digest("generated original\n"), text: "Generated first proposal." },
      { path: "FIXTURE.TXT", baseDigest: digest("generated original\n"), text: "Generated conflicting proposal." },
    ] }, f.authority), { code: "candidate_path_alias" });
    assert.equal(f.effects.length, 0);
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
  } finally { await f.close(); }
});

test("changed review bytes, wrong review digests and stale source bases cannot publish an unreviewed candidate", { timeout: ciTime(30_000) }, async () => {
  const f = await fixture();
  try {
    const review = await stageCandidate(proposal, f.authority); f.approve(review.digest);
    await assert.rejects(() => applyCandidate(review, "0".repeat(64), f.authority), { code: "candidate_review" });
    const altered = structuredClone(review); altered.patch.edits[0]!.text = "Generated substituted model content.";
    await assert.rejects(() => applyCandidate(altered, review.digest, f.authority), { code: "candidate_review" });
    await writeFile(join(f.project, "fixture.txt"), "Generated later user edit.\n");
    await assert.rejects(() => applyCandidate(review, review.digest, f.authority), { code: "candidate_conflict" });
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "Generated later user edit.\n");
    assert.equal(f.effects.some((effect) => effect.phase.startsWith("apply")), false);
  } finally { await f.close(); }
});

test("a stale second base or protected path rejects the whole staging set before touching the owned checkout", { timeout: ciTime(30_000) }, async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.project, "second.ts"), "Generated later user second file.\n");
    await assert.rejects(() => stageCandidate(twoFiles, f.authority), { code: "candidate_conflict" });
    await assert.rejects(() => stageCandidate({ ...proposal, edits: [{ ...proposal.edits[0], path: ".git/config" }] }, f.authority), { code: "compound_candidate" });
    assert.equal(f.effects.length, 0);
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(await readFile(join(f.project, "second.ts"), "utf8"), "Generated later user second file.\n");
  } finally { await f.close(); }
});

test("source/stage aliases, directory replacement and symlink targets never become candidate filesystem authority", { timeout: ciTime(30_000) }, async () => {
  for (const mode of ["alias", "replacement", "symlink"] as const) {
    const f = await fixture();
    try {
      if (mode === "alias") {
        await assert.rejects(() => stageCandidate(proposal, { ...f.authority, scope: () => ({ ...f.authority.scope(), stage: f.authority.scope().source }) }), { code: "candidate_root" });
      } else if (mode === "replacement") {
        const review = await stageCandidate(proposal, f.authority); f.approve(review.digest);
        await rename(f.workspace.path, `${f.workspace.path}-replaced`); await symlink(f.project, f.workspace.path);
        await assert.rejects(() => applyCandidate(review, review.digest, f.authority), /canonical directory|identity changed/);
      } else {
        await symlink(join(f.project, "fixture.txt"), join(f.project, "alias.txt"));
        await assert.rejects(() => stageCandidate({ ...proposal, edits: [{ ...proposal.edits[0], path: "alias.txt" }] }, f.authority), /[Ss]ymlink/);
      }
      assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
      assert.equal(f.effects.some((effect) => effect.phase.startsWith("apply")), false);
    } finally { await f.close(); }
  }
});

test("failed intent receipts prevent effects and failed post-effect receipts remain explicit partial outcomes", { timeout: ciTime(30_000) }, async () => {
  for (const phase of ["stage.started", "stage.file", "apply.started", "apply.file", "apply.completed"] as const) {
    const f = await fixture();
    const failing = { ...f.authority, record: async (effect: CandidateEffect) => {
      if (effect.phase === phase) throw new Error("Generated candidate receipt failed.");
      await f.authority.record(effect);
    } };
    try {
      const run = async () => {
        if (phase.startsWith("stage")) return stageCandidate(proposal, failing);
        const review = await stageCandidate(proposal, f.authority); f.approve(review.digest);
        return applyCandidate(review, review.digest, failing);
      };
      if (phase.endsWith("started")) await assert.rejects(run, /receipt failed/);
      else await assert.rejects(run, (error: unknown) => {
        assert.ok(error instanceof CandidatePartial); assert.deepEqual(error.paths, ["fixture.txt"]);
        assert.match(String(error.cause), /receipt failed/); return true;
      });
      assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), phase.startsWith("apply") && !phase.endsWith("started") ? proposal.edits[0]!.text : "generated original\n");
      assert.equal(f.effects.some((effect) => effect.phase === "apply.completed"), false);
    } finally { await f.close(); }
  }
});

test("multi-file cancellation after one real publication preserves the other source file and cannot report success or replay", { timeout: ciTime(30_000) }, async () => {
  const f = await fixture(), abort = new AbortController();
  try {
    const review = await stageCandidate(twoFiles, f.authority); f.approve(review.digest);
    await assert.rejects(() => applyCandidate(review, review.digest, { ...f.authority, signal: abort.signal, record: async (effect) => {
      await f.authority.record(effect);
      if (effect.phase === "apply.file") abort.abort();
    } }), (error: unknown) => {
      assert.ok(error instanceof CandidatePartial); assert.equal(error.phase, "apply"); assert.deepEqual(error.paths, ["fixture.txt"]);
      assert.ok(error.cause instanceof Error); assert.equal(error.cause.name, "AbortError"); return true;
    });
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), proposal.edits[0]!.text);
    assert.equal(await readFile(join(f.project, "second.ts"), "utf8"), "Generated second base.\n");
    assert.equal(f.effects.some((effect) => effect.phase === "apply.completed"), false);
    await assert.rejects(() => applyCandidate(review, review.digest, f.authority), { code: "candidate_conflict" });
    assert.equal(await readFile(join(f.project, "second.ts"), "utf8"), "Generated second base.\n");
  } finally { await f.close(); }
});

test("policy revocation while retaining stage intent or authorizing application blocks the next effect", { timeout: ciTime(30_000) }, async () => {
  for (const phase of ["stage", "approve"] as const) {
    const f = await fixture();
    try {
      if (phase === "stage") await assert.rejects(() => stageCandidate(proposal, { ...f.authority, record: async (effect) => {
        await f.authority.record(effect); if (effect.phase === "stage.started") f.changePolicy();
      } }), { code: "candidate_stale" });
      else {
        const review = await stageCandidate(proposal, f.authority); f.approve(review.digest);
        await assert.rejects(() => applyCandidate(review, review.digest, { ...f.authority, approve: async (value) => {
          await f.authority.approve(value); f.changePolicy();
        } }), { code: "candidate_stale" });
      }
      assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
      assert.equal(f.effects.some((effect) => effect.phase === "apply.file"), false);
    } finally { await f.close(); }
  }
});

test("a user edit during the actual pending review is preserved instead of overwriting it after approval", { timeout: ciTime(30_000) }, async () => {
  const f = await fixture(); let entered = false, release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  try {
    const review = await stageCandidate(proposal, f.authority); f.approve(review.digest);
    const pending = applyCandidate(review, review.digest, { ...f.authority, approve: async (value) => {
      await f.authority.approve(value); entered = true; await held;
    } });
    const rejected = assert.rejects(() => pending, { code: "candidate_conflict" });
    await waitFor(() => entered);
    await writeFile(join(f.project, "fixture.txt"), "Generated edit while human review was held.\n");
    release(); await rejected;
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "Generated edit while human review was held.\n");
    assert.equal(f.effects.some((effect) => effect.phase.startsWith("apply")), false);
  } finally { release(); await f.close(); }
});

test("cancellation or revocation after the last file cannot append a successful stage/application completion", { timeout: ciTime(30_000) }, async () => {
  for (const phase of ["stage", "apply"] as const) for (const action of ["cancel", "revoke"] as const) {
    const f = await fixture(), abort = new AbortController();
    const authority = { ...f.authority, signal: abort.signal, record: async (effect: CandidateEffect) => {
      await f.authority.record(effect);
      if (effect.phase === `${phase}.file`) {
        if (action === "cancel") abort.abort(); else f.changePolicy();
      }
    } };
    try {
      await assert.rejects(async () => {
        if (phase === "stage") return stageCandidate(proposal, authority);
        const review = await stageCandidate(proposal, f.authority); f.approve(review.digest);
        return applyCandidate(review, review.digest, authority);
      }, (error: unknown) => { assert.ok(error instanceof CandidatePartial); assert.deepEqual(error.paths, ["fixture.txt"]); return true; });
      assert.equal(f.effects.some((effect) => effect.phase === `${phase}.completed`), false);
      assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), phase === "stage" ? "generated original\n" : proposal.edits[0]!.text);
    } finally { await f.close(); }
  }
});

test("a later user edit after the actual rename is preserved and cannot become a verified candidate completion", { timeout: ciTime(30_000) }, async () => {
  for (const phase of ["stage", "apply"] as const) {
    const f = await fixture();
    const authority = { ...f.authority, record: async (effect: CandidateEffect) => {
      await f.authority.record(effect);
      if (effect.phase === `${phase}.file`) await writeFile(join(phase === "stage" ? f.workspace.path : f.project, "fixture.txt"), "Generated newer user edit after publication.\n");
    } };
    try {
      await assert.rejects(async () => {
        if (phase === "stage") return stageCandidate(proposal, authority);
        const review = await stageCandidate(proposal, f.authority); f.approve(review.digest);
        return applyCandidate(review, review.digest, authority);
      }, (error: unknown) => { assert.ok(error instanceof CandidatePartial); assert.deepEqual(error.paths, ["fixture.txt"]); return true; });
      assert.equal(f.effects.some((effect) => effect.phase === `${phase}.completed`), false);
      assert.equal(await readFile(join(phase === "stage" ? f.workspace.path : f.project, "fixture.txt"), "utf8"), "Generated newer user edit after publication.\n");
      if (phase === "stage") assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    } finally { await f.close(); }
  }
});

test("binary text and new names sharing portable case or Unicode keys are rejected before any staged effect", { timeout: ciTime(30_000) }, async () => {
  const f = await fixture();
  try {
    for (const mode of ["binary", "case", "unicode"] as const) {
      const edits = mode === "binary" ? [{ ...proposal.edits[0], text: "Generated\0binary." }] :
        (mode === "case" ? ["generated.ts", "GENERATED.TS"] : ["\u00e9.ts", "e\u0301.ts"]).map((path) => ({ path, baseDigest: "absent", text: "Generated text." }));
      await assert.rejects(() => stageCandidate({ ...proposal, edits }, f.authority), { code: mode === "binary" ? "compound_candidate" : "candidate_path_alias" });
      assert.equal(f.effects.length, 0);
    }
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "generated original\n");
  } finally { await f.close(); }
});

test("an existing user edit in the candidate checkout is not adopted as a disposable staging base", { timeout: ciTime(30_000) }, async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.workspace.path, "fixture.txt"), "Generated user's candidate-checkout edit.\n");
    await assert.rejects(() => stageCandidate(proposal, f.authority), { code: "candidate_stage_busy" });
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "Generated user's candidate-checkout edit.\n");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(f.effects.length, 0);
  } finally { await f.close(); }
});

test("actual Cascade/Critique model proposals stage once and remain unapplied through validation until exact review", { timeout: ciTime(30_000) }, async () => {
  for (const workflow of ["cascade", "critique"] as const) {
    const f = await fixture(), models = await compoundProviderFixture(workflow, { draft: { replyText: JSON.stringify(proposal) } });
    const started = performance.now(); let review: CandidateReview | undefined, validations = 0;
    try {
      const source = await f.sdk.workspaces.file(f.session().id, "fixture.txt");
      const viewer = await f.sdk.sessions.create(f.session().projectId, "Generated candidate inspection", undefined, f.workspace.id);
      const result = await compoundRoutingPrimitive({ ...models.defaults,
        context: { ...models.defaults.context, state: JSON.stringify({ task: "Generated exact patch task.", source: { path: "fixture.txt", digest: source.digest, text: source.text } }) },
        validate: async (candidate) => {
          assert.equal(candidate.kind, "patch"); validations++;
          if (!review) review = await stageCandidate(candidate, f.authority); else assert.deepEqual(candidate, review.patch);
          for (const edit of review.patch.edits) assert.equal((await f.sdk.workspaces.file(viewer.id!, edit.path)).digest, digest(edit.text));
          assert.equal((await f.sdk.workspaces.file(f.session().id, "fixture.txt")).digest, source.digest);
          return { passed: true, diagnostics: ["Generated exact bytes/base check only; no calibrated model-quality claim."] };
        },
      });
      assert.ok(review); const completedReview = review; assert.equal(result.status, "proposed");
      assert.equal(validations, workflow === "cascade" ? 1 : 2);
      assert.equal(f.effects.filter((effect) => effect.phase === "stage.file").length, 1);
      assert.equal(f.effects.some((effect) => effect.phase.startsWith("apply")), false);
      await assert.rejects(() => applyCandidate(completedReview, completedReview.digest, f.authority), /actual-user review/);
      f.approve(completedReview.digest); await applyCandidate(completedReview, completedReview.digest, f.authority);
      assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), proposal.edits[0]!.text);
      assert.deepEqual(models.recorded.map((call) => call.role), workflow === "cascade" ? ["router", "draft"] : ["router", "draft", "critic"]);
      assert.ok(models.recorded.every((call) => call.reportedTokens === 42));
      for (const provider of [models.classifier, models.draft, models.other]) assert.ok(provider.requests.every((request) => request.tools === undefined));
      console.log(JSON.stringify({ primitive: `generated-${workflow}-owned-candidate`, ms: performance.now() - started,
        calls: models.recorded.length, reportedTokens: models.recorded.reduce((sum, call) => {
          assert.ok(typeof call.reportedTokens === "number"); return sum + call.reportedTokens;
        }, 0), stageEffects: 1, separateExactReview: true }));
    } finally { await models.close(); await f.close(); }
  }
});
