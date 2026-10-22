import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { runProgram } from "../apps/service/src/program.ts";
import { connectGithubSdk, githubServiceFixture } from "./github-workflows-fixture.ts";

test("two real SDK clients share reviewed Git jobs and independent results survive deletion of the owning source session", { timeout: 20_000 }, async () => {
  const f = await githubServiceFixture(), other = new MoguriSdk(f.service.connection);
  try {
    await connectGithubSdk(other);
    const review = (await f.sdk.github.preview(f.scope, { kind: "git.tag.create", tag: "generated-service-tag", target: f.git(["rev-parse", "HEAD"]), annotated: false, message: "" })).preview;
    const result = await other.github.execute(review, review.document.confirmations, true);
    const completed = await other.github.wait(result.id!);
    assert.equal(completed.operation.status, "completed"); assert.equal(completed.operation.originSessionId, f.sessionId);
    assert.equal(f.service.controller.snapshot().jobs.find((value) => value.id === completed.operation.jobId)?.sessionId, f.sessionId);
    await f.sdk.refresh(); assert.equal(f.sdk.github.list(f.projectId)[0]?.id, completed.operation.id);
    await f.sdk.sessions.delete(f.sessionId, true);
    const retained = await other.github.read(completed.operation.id);
    assert.equal(retained.operation.status, "completed"); assert.equal(retained.document.scope.sessionId, f.sessionId);
    assert.equal(retained.result?.kind, "git.tag.create"); assert.equal(f.git(["rev-parse", "generated-service-tag"]), review.document.targetSha);
    await assert.rejects(() => other.github.preview(f.scope, { kind: "git.tag.push", remote: "origin", tag: "generated-service-tag" }), /scope|session|binding/i);
  } finally { other.disconnect(); await f.close(); }
});

test("real SDK rebase conflict quarantine permits only explicit continue/abort and never clears unrelated retained uncertainty", { timeout: 20_000 }, async () => {
  const f = await githubServiceFixture();
  try {
    f.git(["switch", "-c", "generated-topic"]); await writeFile(join(f.root, "fixture.txt"), "generated topic\n"); f.git(["add", "--", "fixture.txt"]); f.git(["commit", "-m", "Generated topic"]);
    const original = f.git(["rev-parse", "HEAD"]); f.git(["switch", "main"]);
    await writeFile(join(f.root, "fixture.txt"), "generated main\n"); f.git(["add", "--", "fixture.txt"]); f.git(["commit", "-m", "Generated main"]); f.git(["switch", "generated-topic"]);
    const review = (await f.sdk.github.preview(f.scope, { kind: "git.rebase", mode: "start", onto: "main" })).preview;
    const started = await f.sdk.github.execute(review, review.document.confirmations, true), conflict = await f.sdk.github.wait(started.id!);
    assert.equal(conflict.operation.status, "partial"); assert.equal(conflict.result?.outcome, "conflicts");
    assert.ok(f.service.controller.snapshot().blockedProjects.includes(f.projectId));
    await assert.rejects(() => f.sdk.github.preview(f.scope, { kind: "git.tag.create", tag: "generated-no-bypass", target: original, annotated: false, message: "" }), /quarantin|uncertain/i);
    const abort = (await f.sdk.github.preview(f.scope, { kind: "git.rebase", mode: "abort" })).preview;
    assert.ok(abort.document.warnings.some((value) => value.includes("remains quarantined")));
    const aborted = await f.sdk.github.wait((await f.sdk.github.execute(abort, abort.document.confirmations, true)).id!);
    assert.equal(aborted.operation.status, "completed"); assert.equal(f.git(["rev-parse", "HEAD"]), original);
    assert.ok(f.service.controller.snapshot().blockedProjects.includes(f.projectId));
    await assert.rejects(() => f.sdk.github.preview(f.scope, { kind: "git.push", remote: "origin", branch: "main", forceWithLease: false }), /quarantin|uncertain/i);
  } finally { await f.close(); }
});

test("source-session deletion cancels and joins its actual Git owner while the partial job/root/intent remain independently retained", { timeout: 20_000 }, async () => {
  let entered!: () => void; const writing = new Promise<void>((resolve) => { entered = resolve; });
  const f = await githubServiceFixture({ runProgram: async (executable, args, options) => {
    if (executable !== "git") throw new Error("Generated fixture forbids real GitHub requests.");
    if (args.includes("push")) {
      entered();
      await new Promise<void>((_resolve, reject) => {
        const cancel = () => reject(options.signal.reason ?? new DOMException("Cancelled", "AbortError"));
        options.signal.addEventListener("abort", cancel, { once: true }); if (options.signal.aborted) cancel();
      });
    }
    return runProgram(executable, args, { ...options, env: { ...options.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  } });
  try {
    const before = f.bare(["rev-parse", "main"]), preview = (await f.sdk.github.preview(f.scope, { kind: "git.push", remote: "origin", branch: "main", forceWithLease: false })).preview;
    const result = await f.sdk.github.execute(preview, preview.document.confirmations, true); await writing;
    assert.ok(f.service.controller.ownedLocalRoots().includes(f.root));
    await f.sdk.sessions.delete(f.sessionId, true);
    const partial = await f.sdk.github.read(result.id!);
    assert.equal(partial.operation.status, "partial"); assert.equal(partial.operation.cancelRequested, true);
    assert.equal(f.service.controller.snapshot().sessions.some((value) => value.id === f.sessionId), false);
    assert.equal(f.bare(["rev-parse", "main"]), before); assert.ok(f.service.controller.snapshot().blockedProjects.includes(f.projectId));
    assert.equal(f.service.controller.ownedLocalRoots().includes(f.root), true);
    await assert.rejects(() => f.sdk.github.acknowledge(partial.operation.id, partial.operation.revision - 1, partial.operation.inputDigest, true), { code: "github_inspection_stale" });
    await f.sdk.github.acknowledge(partial.operation.id, partial.operation.revision, partial.operation.inputDigest, true);
    const inspected = await f.sdk.github.read(result.id!);
    assert.equal(inspected.operation.status, "partial");
    assert.equal(inspected.operation.inspection?.actor, "user");
    assert.equal(inspected.operation.resultDigest, partial.operation.resultDigest);
    assert.equal(f.service.controller.ownedLocalRoots().includes(f.root), false);
    const missingReceiptId = randomUUID();
    await assert.rejects(() => f.sdk.github.read(missingReceiptId), /missing|profile/i);
  } finally { await f.close(); }
});
