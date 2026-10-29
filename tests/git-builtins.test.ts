import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type GitAction, isRecord } from "../packages/sdk/src/index.ts";
import { githubServiceFixture } from "./github-workflows-fixture.ts";
import { fixtureProvider, waitFor } from "./fixture.ts";
import { runProgram } from "../apps/service/src/program.ts";

type Fixture = Awaited<ReturnType<typeof githubServiceFixture>>;
async function perform(f: Fixture, action: GitAction) {
  const review = (await f.sdk.git.preview(f.sessionId, action)).preview;
  const admitted = await f.sdk.git.execute(review, review.document.confirmations, true);
  const result = await f.sdk.git.wait(admitted.id!);
  assert.equal(result.operation.status, "completed", result.operation.diagnostic ?? JSON.stringify(result.result));
  return result;
}

test("built-in Git reads pin real history and expose branches/diff/show without changing the index", async () => {
  const f = await githubServiceFixture();
  try {
    f.git(["commit", "--no-gpg-sign", "--allow-empty", "-m", "Generated second commit"]);
    const index = await readFile(join(f.root, ".git/index")), head = f.git(["rev-parse", "HEAD"]);
    assert.equal((await f.sdk.git.status(f.sessionId)).git.head, head);
    const first = await f.sdk.git.log(f.sessionId, { limit: 1 });
    assert.equal(first.data.action, "log");
    if (first.data.action !== "log") assert.fail("Missing exact history.");
    assert.equal(first.data.commits[0]?.sha, head); assert.equal(first.data.nextOffset, 1);
    const second = await f.sdk.git.log(f.sessionId, { head: first.data.head, offset: first.data.nextOffset!, limit: 1 });
    if (second.data.action !== "log") assert.fail("Missing original history continuation.");
    assert.equal(second.data.commits.length, 1); assert.equal(second.data.nextOffset, null);
    const branches = await f.sdk.git.branches(f.sessionId);
    if (branches.data.action !== "branches") assert.fail("Missing exact branch list.");
    assert.ok(branches.data.branches.some((branch) => branch.name === "main" && branch.sha === head));
    const shown = await f.sdk.git.show(f.sessionId, head);
    if (shown.data.action !== "show") assert.fail("Missing exact commit.");
    assert.match(shown.data.text, /Generated second commit/);
    await f.sdk.git.diff(f.sessionId);
    assert.deepEqual(await readFile(join(f.root, ".git/index")), index);
    assert.equal(f.service.controller.snapshot().githubOperations.length, 0);
  } finally { await f.close(); }
});

test("create-without-checkout and current-branch rename preserve unrelated staged and dirty bytes", async () => {
  const f = await githubServiceFixture();
  try {
    await writeFile(join(f.root, "fixture.txt"), "Generated dirty original file.\n");
    await writeFile(join(f.root, "other-staged.txt"), "Generated unrelated staged content.\n");
    await writeFile(join(f.root, "other-untracked.txt"), "Generated unrelated untracked content.\n");
    f.git(["add", "--", "other-staged.txt"]);
    const index = await readFile(join(f.root, ".git/index")), head = f.git(["rev-parse", "HEAD"]);
    await perform(f, { kind: "git.branch.create", branch: "generated/new-branch", start: head, checkout: false });
    await perform(f, { kind: "git.branch.rename", from: "main", to: "generated/renamed-branch" });
    assert.equal(f.git(["rev-parse", "refs/heads/generated/new-branch"]), head);
    assert.equal(f.git(["branch", "--show-current"]), "generated/renamed-branch");
    assert.deepEqual(await readFile(join(f.root, ".git/index")), index);
    assert.equal(await readFile(join(f.root, "fixture.txt"), "utf8"), "Generated dirty original file.\n");
    assert.equal(await readFile(join(f.root, "other-untracked.txt"), "utf8"), "Generated unrelated untracked content.\n");
    await assert.rejects(() => f.sdk.git.preview(f.sessionId, { kind: "git.switch", branch: "generated/new-branch" }), { code: "git_dirty" });
    await assert.rejects(() => f.sdk.git.preview(f.sessionId, { kind: "git.branch.create", branch: "generated/new-branch", start: head, checkout: false }), { code: "git_branch_exists" });
  } finally { await f.close(); }
});

test("built-in branch creation/switch use explicit clean local refs and never infer a remote checkout", async () => {
  const f = await githubServiceFixture();
  try {
    await perform(f, { kind: "git.branch.create", branch: "generated/checked-out", start: f.git(["rev-parse", "HEAD"]), checkout: true });
    assert.equal(f.git(["branch", "--show-current"]), "generated/checked-out");
    await perform(f, { kind: "git.switch", branch: "main" });
    assert.equal(f.git(["branch", "--show-current"]), "main");
    await assert.rejects(() => f.sdk.git.preview(f.sessionId, { kind: "git.switch", branch: "generated/nonexistent" }), { code: "git_branch_missing" });
  } finally { await f.close(); }
});

test("exact-file stage/unstage preserve unrelated index entries and every working file", async () => {
  const f = await githubServiceFixture();
  try {
    await writeFile(join(f.root, "fixture.txt"), "Generated selected dirty content.\n");
    await writeFile(join(f.root, "new-selected.txt"), "Generated new selected content.\n");
    await writeFile(join(f.root, "other-staged.txt"), "Generated unrelated staged content.\n");
    f.git(["add", "--", "other-staged.txt"]);
    const unrelated = f.git(["ls-files", "--stage", "--", "other-staged.txt"]);
    await perform(f, { kind: "git.stage", paths: ["fixture.txt", "new-selected.txt"] });
    assert.equal(f.git(["show", ":fixture.txt"]), "Generated selected dirty content.");
    assert.equal(f.git(["show", ":new-selected.txt"]), "Generated new selected content.");
    assert.equal(f.git(["ls-files", "--stage", "--", "other-staged.txt"]), unrelated);
    await perform(f, { kind: "git.unstage", paths: ["fixture.txt", "new-selected.txt"] });
    assert.equal(f.git(["show", ":fixture.txt"]), "generated base");
    assert.equal(f.git(["ls-files", "--stage", "--", "new-selected.txt"]), "");
    assert.equal(f.git(["ls-files", "--stage", "--", "other-staged.txt"]), unrelated);
    assert.equal(await readFile(join(f.root, "fixture.txt"), "utf8"), "Generated selected dirty content.\n");
    assert.equal(await readFile(join(f.root, "new-selected.txt"), "utf8"), "Generated new selected content.\n");
  } finally { await f.close(); }
});

test("selected staged commits preserve the real index, unrelated staged work and partially staged working bytes", async () => {
  const f = await githubServiceFixture();
  try {
    await writeFile(join(f.root, "fixture.txt"), "Generated selected staged bytes.\n"); f.git(["add", "--", "fixture.txt"]);
    await writeFile(join(f.root, "fixture.txt"), "Generated later unstaged bytes.\n");
    await writeFile(join(f.root, "other-staged.txt"), "Generated unrelated staged bytes.\n"); f.git(["add", "--", "other-staged.txt"]);
    await writeFile(join(f.root, "other-untracked.txt"), "Generated untouched untracked bytes.\n");
    const head = f.git(["rev-parse", "HEAD"]), index = await readFile(join(f.root, ".git/index"));
    const result = await perform(f, { kind: "git.commit", paths: ["fixture.txt"], message: "Generated selected staged commit" });
    assert.equal(f.git(["rev-parse", "HEAD^"]), head);
    assert.equal(f.git(["show", "HEAD:fixture.txt"]), "Generated selected staged bytes.");
    assert.equal(f.git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]), "fixture.txt");
    assert.equal(await readFile(join(f.root, "fixture.txt"), "utf8"), "Generated later unstaged bytes.\n");
    assert.equal(await readFile(join(f.root, "other-untracked.txt"), "utf8"), "Generated untouched untracked bytes.\n");
    assert.deepEqual(await readFile(join(f.root, ".git/index")), index);
    assert.equal(f.git(["show", ":other-staged.txt"]), "Generated unrelated staged bytes.");
    assert.equal(f.git(["log", "-1", "--format=%B"]).includes("Co-authored-by"), false);
    assert.equal(result.operation.actor, "user");
  } finally { await f.close(); }
});

test("rollback creates a new revert commit with the exact previous tree and never discards dirty work", async () => {
  const f = await githubServiceFixture();
  try {
    const base = f.git(["rev-parse", "HEAD"]);
    await writeFile(join(f.root, "fixture.txt"), "Generated rollback target bytes.\n"); f.git(["add", "--", "fixture.txt"]);
    f.git(["commit", "--no-gpg-sign", "-m", "Generated rollback target"]);
    const target = f.git(["rev-parse", "HEAD"]);
    await perform(f, { kind: "git.revert", commit: target });
    assert.equal(f.git(["rev-parse", "HEAD^"]), target);
    assert.equal(f.git(["rev-parse", "HEAD^{tree}"]), f.git(["rev-parse", `${base}^{tree}`]));
    assert.equal(f.git(["rev-list", "--count", "HEAD"]), "3");
    await writeFile(join(f.root, "fixture.txt"), "Generated dirty work must survive.\n");
    const index = await readFile(join(f.root, ".git/index"));
    await assert.rejects(() => f.sdk.git.preview(f.sessionId, { kind: "git.revert", commit: f.git(["rev-parse", "HEAD"]) }), { code: "git_dirty" });
    assert.deepEqual(await readFile(join(f.root, ".git/index")), index);
    assert.equal(await readFile(join(f.root, "fixture.txt"), "utf8"), "Generated dirty work must survive.\n");
  } finally { await f.close(); }
});

test("new-branch push binds exact remote absence and stale source/index reviews cannot mutate", async () => {
  const f = await githubServiceFixture();
  try {
    const action: GitAction = { kind: "git.push", remote: "origin", branch: "generated/new-remote-branch", forceWithLease: false };
    const stale = (await f.sdk.git.preview(f.sessionId, action)).preview;
    f.bare(["update-ref", "refs/heads/generated/new-remote-branch", f.git(["rev-parse", "HEAD"])]);
    await assert.rejects(() => f.sdk.git.execute(stale, stale.document.confirmations, true), { code: "github_review" });
    const result = await perform(f, { ...action, branch: "generated/another-new-branch" });
    assert.equal(result.result?.remoteSha, f.git(["rev-parse", "HEAD"]));
    assert.equal(f.bare(["rev-parse", "refs/heads/generated/another-new-branch"]), f.git(["rev-parse", "HEAD"]));
    const rename = (await f.sdk.git.preview(f.sessionId, { kind: "git.branch.rename", from: "main", to: "generated/stale-rename" })).preview;
    await writeFile(join(f.root, "new-staged.txt"), "Generated competing staged bytes.\n"); f.git(["add", "--", "new-staged.txt"]);
    await assert.rejects(() => f.sdk.git.execute(rename, rename.document.confirmations, true), { code: "github_review" });
    assert.equal(f.git(["branch", "--show-current"]), "main");
  } finally { await f.close(); }
});

test("the actual model uses declared Git tools with exact automatic approval and root handoff, not shell scripts", { skip: process.platform !== "darwin" }, async () => {
  const input: GitAction = { kind: "git.branch.create", branch: "generated/model-builtin", start: "main", checkout: false };
  const provider = await fixtureProvider({ respond: (request, index) => {
    if (index === 1) return { tool: { name: "git_write", args: { action: "preview", input } } };
    if (index === 2) {
      const messages = Array.isArray(request.messages) ? request.messages.filter(isRecord) : [];
      const value: unknown = JSON.parse(String(messages.findLast((message) => message.role === "tool")?.content));
      if (!isRecord(value) || typeof value.digest !== "string" || !isRecord(value.document)) throw new Error("Generated model requires the original real Git preview.");
      return { tool: { name: "git_write", args: { action: "execute", input, expectedDigest: value.digest, confirmations: value.document.confirmations } } };
    }
    return { text: "Generated built-in branch completed." };
  } });
  const f = await githubServiceFixture({}, provider.provider);
  try {
    await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, modelId: provider.modelId }, f.session().revision);
    await f.sdk.sessions.autonomy(f.sessionId, "Autopilot");
    await f.sdk.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: f.session().draft.revision, text: "Generated built-in branch task.", attachments: [] });
    await f.sdk.command({ type: "message.send", sessionId: f.sessionId, expectedRevision: f.session().draft.revision, delivery: "queue" });
    await waitFor(() => f.service.controller.snapshot().sessions.find((session) => session.id === f.sessionId)?.status === "completed");
    const operations = f.service.controller.snapshot().githubOperations;
    assert.equal(operations.length, 1); assert.equal(operations[0]?.status, "completed", operations[0]?.diagnostic ?? "");
    assert.equal(operations[0]?.actor, "model"); assert.match(operations[0]?.toolCallDigest ?? "", /^[a-f0-9]{64}$/);
    assert.equal(f.git(["rev-parse", "refs/heads/generated/model-builtin"]), f.git(["rev-parse", "HEAD"]));
    const tools = f.service.controller.events(0).flatMap((event) => event.event_type === "tool.started" ? [event.payload.call.name] : []);
    assert.deepEqual(tools, ["git_write", "git_write"]);
    assert.match(JSON.stringify(provider.requests[0]?.messages), /For Git, discover git_read and git_write first/);
  } finally { await f.close(); await provider.close(); }
});

test("late branch effects after cancellation stay partial and are never reported as a successful stop", async () => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(); let writes = 0;
  const f = await githubServiceFixture({ runProgram: async (executable, args, request) => {
    if (args.includes("--move")) {
      writes++; entered.resolve(); await release.promise;
      return runProgram(executable, args, { ...request, signal: new AbortController().signal,
        env: { ...request.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
    }
    return runProgram(executable, args, { ...request, env: { ...request.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  } });
  try {
    const review = (await f.sdk.git.preview(f.sessionId, { kind: "git.branch.rename", from: "main", to: "generated/late-rename" })).preview;
    const admitted = await f.sdk.git.execute(review, review.document.confirmations, true);
    await entered.promise; await f.sdk.git.cancel(admitted.id!); release.resolve();
    const result = await f.sdk.git.wait(admitted.id!);
    assert.equal(result.operation.status, "partial"); assert.equal(result.operation.cancelRequested, true);
    assert.equal(f.git(["branch", "--show-current"]), "generated/late-rename"); assert.equal(writes, 1);
    await assert.rejects(() => f.sdk.git.preview(f.sessionId, { kind: "git.branch.rename", from: "generated/late-rename", to: "generated/no-replay" }), /quarantin|uncertain/i);
  } finally { release.resolve(); await f.close(); }
});

test("hard denials, read-only mode and disallowed execution environments defeat Autopilot and copied confirmations", { skip: process.platform !== "darwin" }, async () => {
  const f = await githubServiceFixture();
  try {
    await f.sdk.sessions.autonomy(f.sessionId, "Autopilot");
    const action: GitAction = { kind: "git.branch.create", branch: "generated/denied", start: "main", checkout: false };
    const catalog = await f.sdk.tools.catalog(f.sessionId, "git_write"), write = catalog.tools.find((tool) => tool.name === "git_write");
    assert.ok(write);
    await assert.rejects(() => f.sdk.tools.execute(f.sessionId, "git_write", { action: "preview", input: action }, write.schemaDigest), { code: "tool_owner" });
    const settings = f.sdk.settings.get()!;
    await f.sdk.settings.update({ ...settings.values, permissions: { ...settings.values.permissions,
      tools: [{ id: "generated-git-denial", tool: "git_write", pathPrefix: "", decision: "deny" }] } }, settings.revision);
    await assert.rejects(() => f.sdk.git.preview(f.sessionId, action), { code: "github_denied" });
    await f.sdk.settings.update(settings.values, f.sdk.settings.get()!.revision);
    await f.sdk.sessions.mode(f.sessionId, "read-only");
    assert.equal((await f.sdk.git.status(f.sessionId)).git.branch, "main");
    assert.equal((await f.sdk.tools.catalog(f.sessionId, "git_write")).tools.some((tool) => tool.name === "git_write"), false);
    await assert.rejects(() => f.sdk.git.preview(f.sessionId, action), { code: "read_only" });
    await f.sdk.command({ type: "policy.set", allowedEnvs: ["Remote"] });
    await assert.rejects(() => f.sdk.git.status(f.sessionId), { code: "github_env" });
    assert.equal(f.service.controller.snapshot().githubOperations.length, 0);
    assert.equal(f.git(["for-each-ref", "--format=%(refname)", "refs/heads/generated/denied"]), "");
  } finally { await f.close(); }
});

test("a model-supplied execute confirmation still requires the actual Manual approval and denial creates no Git intent", { skip: process.platform !== "darwin" }, async () => {
  const input: GitAction = { kind: "git.branch.create", branch: "generated/not-approved", start: "main", checkout: false };
  const provider = await fixtureProvider({ respond: (request, index) => {
    if (index === 1) return { tool: { name: "git_write", args: { action: "preview", input } } };
    if (index === 2) {
      const messages = Array.isArray(request.messages) ? request.messages.filter(isRecord) : [];
      const value: unknown = JSON.parse(String(messages.findLast((message) => message.role === "tool")?.content));
      if (!isRecord(value) || !isRecord(value.document)) throw new Error("Generated model requires the original Git preview.");
      return { tool: { name: "git_write", args: { action: "execute", input, expectedDigest: value.digest, confirmations: value.document.confirmations } } };
    }
    return { text: "Generated denied Git operation was not executed." };
  } });
  const f = await githubServiceFixture({}, provider.provider);
  try {
    await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, modelId: provider.modelId }, f.session().revision);
    await f.sdk.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: 0, text: "Generated Manual Git review.", attachments: [] });
    await f.sdk.command({ type: "message.send", sessionId: f.sessionId, expectedRevision: 1, delivery: "queue" });
    const preview = await waitFor(() => f.service.controller.snapshot().sessions[0]?.pendingApproval);
    await f.sdk.approvals.respond(f.sessionId, preview.id, true);
    const execute = await waitFor(() => {
      const approval = f.service.controller.snapshot().sessions[0]?.pendingApproval;
      return approval?.id !== preview.id && approval;
    });
    assert.equal(execute.call.arguments.action, "execute");
    assert.equal(f.service.controller.snapshot().githubOperations.length, 0);
    await f.sdk.approvals.respond(f.sessionId, execute.id, false);
    await waitFor(() => f.service.controller.snapshot().sessions[0]?.status === "completed");
    assert.equal(f.service.controller.snapshot().githubOperations.length, 0);
    assert.equal(f.git(["for-each-ref", "--format=%(refname)", "refs/heads/generated/not-approved"]), "");
  } finally { await f.close(); await provider.close(); }
});

test("a normal new-branch push compares captured absence even when the destination appears immediately before dispatch", async () => {
  let race = () => {}, pushes = 0;
  const f = await githubServiceFixture({ runProgram: async (executable, args, request) => {
    if (args.includes("push")) { pushes++; race(); }
    return runProgram(executable, args, { ...request, env: { ...request.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  } });
  try {
    const base = f.git(["rev-parse", "HEAD"]);
    f.git(["commit", "--no-gpg-sign", "--allow-empty", "-m", "Generated raced push child"]);
    const head = f.git(["rev-parse", "HEAD"]);
    assert.notEqual(head, base);
    race = () => f.bare(["update-ref", "refs/heads/generated/raced-new-branch", base]);
    const review = (await f.sdk.git.preview(f.sessionId, { kind: "git.push", remote: "origin", branch: "generated/raced-new-branch", forceWithLease: false })).preview;
    const admitted = await f.sdk.git.execute(review, review.document.confirmations, true), result = await f.sdk.git.wait(admitted.id!);
    assert.equal(result.operation.status, "partial"); assert.equal(pushes, 1);
    assert.equal(f.bare(["rev-parse", "refs/heads/generated/raced-new-branch"]), base);
  } finally { await f.close(); }
});

test("exact-file review enforces the real byte threshold, canonical paths and transformations before admitting any effect", async () => {
  const f = await githubServiceFixture();
  try {
    const path = "generated-bounded.bin", bytes = 2 * 1024 * 1024;
    await writeFile(join(f.root, path), Buffer.alloc(bytes, 0x67));
    const review = (await f.sdk.git.preview(f.sessionId, { kind: "git.stage", paths: [path] })).preview;
    assert.equal(review.document.files?.[0]?.bytes, bytes);
    await writeFile(join(f.root, path), Buffer.alloc(bytes + 1, 0x67));
    await assert.rejects(() => f.sdk.git.preview(f.sessionId, { kind: "git.stage", paths: [path] }), { code: "git_paths" });
    await assert.rejects(() => f.sdk.git.preview(f.sessionId, { kind: "git.stage", paths: ["./fixture.txt"] }), { code: "git_paths" });
    await writeFile(join(f.root, ".gitattributes"), "fixture.txt text\n");
    await assert.rejects(() => f.sdk.git.preview(f.sessionId, { kind: "git.stage", paths: ["fixture.txt"] }), { code: "git_filtered_path" });
    assert.equal(f.service.controller.snapshot().githubOperations.length, 0);
    assert.equal(f.git(["diff", "--cached", "--name-only"]), "");
  } finally { await f.close(); }
});
