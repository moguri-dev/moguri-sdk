import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { runProgram } from "../apps/service/src/program.ts";
import { connectGithubSdk, githubServiceFixture } from "./github-workflows-fixture.ts";
import { fixtureProvider, waitFor } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("a pull request list survives an unrelated session turn finishing without changing its reviewed authority", { timeout: ciTime(15_000) }, async () => {
  const provider = await fixtureProvider();
  let entered = () => {}, release = () => {};
  const reading = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const fixture = await githubServiceFixture({ runProgram: async (executable, args, options) => {
    if (executable === "git") return runProgram(executable, args, options);
    const path = args[args.indexOf("--method") + 2]!;
    if (path === "user") return 'HTTP/2.0 200 OK\r\n\r\n{"login":"generated-owner","id":42}';
    const pull = path.includes("/pulls?");
    if (pull) { entered(); await held; }
    return `HTTP/2.0 200 OK\r\n\r\n${JSON.stringify([{ id: pull ? 11 : 7, number: pull ? 11 : 7,
      title: pull ? "Generated pull request" : "Generated issue", body: "Generated complete source.", state: "open",
      html_url: `https://github.com/generated-owner/fixture/${pull ? "pull" : "issues"}/${pull ? 11 : 7}`, draft: pull }])}`;
  } }, provider.provider);
  let listing: ReturnType<typeof fixture.sdk.github.pulls> | undefined;
  try {
    await fixture.sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: provider.modelId }, fixture.session().revision);
    assert.equal((await fixture.sdk.github.issues(fixture.scope, "generated-owner/fixture", "generated-owner")).items[0]?.number, 7);
    listing = fixture.sdk.github.pulls(fixture.scope, "generated-owner/fixture", "generated-owner");
    await reading;
    await fixture.sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision,
      text: "Generated independent conversation turn.", attachments: [] });
    await fixture.sdk.command({ type: "message.send", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, delivery: "queue" });
    await waitFor(() => fixture.session().status === "completed");
    release();
    const result = await listing;
    assert.equal(result.items[0]?.number, 11); assert.equal(result.items[0]?.body, "Generated complete source.");
    assert.equal(result.accountId, "generated-owner:42");
    assert.equal(fixture.service.controller.snapshot().githubOperations.length, 0);
  } finally { release(); if (listing) await Promise.allSettled([listing]); await fixture.close(); await provider.close(); }
});

test("in-flight PR lists still reject real root, permission, mode and archival changes without retry", async (t) => {
  for (const change of ["root", "permission", "mode", "archive"] as const) await t.test(change, async () => {
    let entered = () => {}, release = () => {}, reads = 0;
    const reading = new Promise<void>((resolve) => { entered = resolve; }), held = new Promise<void>((resolve) => { release = resolve; });
    const fixture = await githubServiceFixture({ runProgram: async (executable, args, options) => {
      if (executable === "git") return runProgram(executable, args, options);
      if (args[args.indexOf("--method") + 2] === "user") return 'HTTP/2.0 200 OK\r\n\r\n{"login":"generated-owner","id":42}';
      reads++; entered(); await held; return "HTTP/2.0 200 OK\r\n\r\n[]";
    } });
    let listing: ReturnType<typeof fixture.sdk.github.pulls> | undefined;
    try {
      listing = fixture.sdk.github.pulls(fixture.scope, "generated-owner/fixture", "generated-owner");
      await reading;
      if (change === "root") { await rename(fixture.root, join(fixture.directory, "original-root")); await mkdir(fixture.root); }
      else if (change === "permission") {
        const settings = fixture.sdk.settings.get()!;
        await fixture.sdk.settings.update({ ...settings.values, permissions: { ...settings.values.permissions,
          tools: [{ id: "generated-github-denial", tool: "github", pathPrefix: "", decision: "deny" }] } }, settings.revision);
      } else if (change === "mode") await fixture.sdk.sessions.mode(fixture.sessionId, "read-only");
      else await fixture.sdk.command({ type: "session.archive", sessionId: fixture.sessionId });
      release();
      await assert.rejects(() => listing!, /root|directory|scope|policy|binding|changed/i);
      assert.equal(reads, 1); assert.equal(fixture.service.controller.snapshot().githubOperations.length, 0);
    } finally { release(); if (listing) await Promise.allSettled([listing]); await fixture.close(); }
  });
});

test("a realistic PR page above 512 KiB loads through the actual bounded CLI reader without truncating bodies", { timeout: ciTime(20_000) }, async () => {
  let responsePath = "";
  const fixture = await githubServiceFixture({ runProgram: async (executable, args, options) => {
    if (executable === "git") return runProgram(executable, args, options);
    const path = args[args.indexOf("--method") + 2];
    if (path === "user") return 'HTTP/2.0 200 OK\r\n\r\n{"login":"generated-owner","id":42}';
    assert.match(path!, /^repos\/generated-owner\/fixture\/pulls\?/);
    return runProgram(process.execPath, ["-e", "process.stdout.write(require('node:fs').readFileSync(process.argv[1]))", responsePath], options);
  } });
  try {
    const body = "Generated complete PR description.\n".repeat(900);
    const pulls = Array.from({ length: 20 }, (_, index) => ({ id: index + 100, number: index + 1, title: `Generated PR ${index + 1}`,
      body, state: "open", html_url: `https://github.com/generated-owner/fixture/pull/${index + 1}`, draft: true,
      head: { sha: fixture.git(["rev-parse", "HEAD"]), ref: `generated-${index}`, repo: { full_name: "generated-owner/fixture", description: "Generated metadata.".repeat(1000) } },
      base: { ref: "main", repo: { description: "Generated metadata.".repeat(1000) } } }));
    const response = `HTTP/2.0 200 OK\r\n\r\n${JSON.stringify(pulls)}`;
    assert.ok(Buffer.byteLength(response) > 512 * 1024);
    responsePath = join(fixture.directory, "generated-pr-response.txt"); await writeFile(responsePath, response);
    const result = await fixture.sdk.github.browse(fixture.scope, { resource: "pulls", repository: "generated-owner/fixture", account: "generated-owner", page: 1, perPage: 20, state: "open" });
    assert.equal(result.items.length, 20); assert.equal(result.items.at(-1)?.body, body);
    assert.equal(result.nextPage, null);
    assert.equal(fixture.service.controller.snapshot().githubOperations.length, 0);
  } finally { await fixture.close(); }
});

test("two real SDK clients share reviewed Git jobs and independent results survive deletion of the owning source session", { timeout: ciTime(20_000) }, async () => {
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

test("real SDK rebase conflict quarantine permits only explicit continue/abort and never clears unrelated retained uncertainty", { timeout: ciTime(20_000) }, async () => {
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

test("source-session deletion cancels and joins its actual Git owner while the partial job/root/intent remain independently retained", { timeout: ciTime(20_000) }, async () => {
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
    await f.sdk.sessions.delete(f.sessionId, true, undefined, undefined, { confirmRunning: true });
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
