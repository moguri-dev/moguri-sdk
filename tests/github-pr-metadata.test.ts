import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "typebox/value";
import { GithubWriteToolSchema, isGithubModelAction, type GithubAction } from "../packages/protocol/src/github-workflows.ts";
import { githubApplicationFixture } from "./github-workflows-fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

type Fixture = Awaited<ReturnType<typeof githubApplicationFixture>>;
const identity = { repository: "generated-owner/fixture", account: "generated-owner" };
async function run(f: Fixture, action: GithubAction) {
  const review = (await f.sdk.github.preview(f.scope, action)).preview;
  return { review, read: await f.sdk.github.wait((await f.sdk.github.execute(review, review.document.confirmations, true)).id!, { timeoutMs: 10_000 }) };
}

test("a PR's draft state toggles both ways through one reviewed GraphQL mutation and a no-op is refused", { timeout: ciTime(30_000) }, async () => {
  const f = await githubApplicationFixture();
  try {
    await assert.rejects(() => f.sdk.github.preview(f.scope, { kind: "github.pr.draft", ...identity, number: 11, draft: true }), { code: "github_pr_draft" });
    const ready = await run(f, { kind: "github.pr.draft", ...identity, number: 11, draft: false });
    assert.ok(ready.review.document.confirmations.includes("Mark pull request #11 ready for review."));
    assert.equal(ready.read.operation.status, "completed", ready.read.operation.diagnostic ?? "");
    assert.equal(ready.read.result?.resource?.kind, "pull"); assert.equal(ready.read.result?.resource?.draft, false);
    assert.equal(f.workItem(11)?.draft, false);
    await assert.rejects(() => f.sdk.github.preview(f.scope, { kind: "github.pr.draft", ...identity, number: 11, draft: false }), { code: "github_pr_draft" });
    const draft = await run(f, { kind: "github.pr.draft", ...identity, number: 11, draft: true });
    assert.ok(draft.review.document.confirmations.includes("Convert pull request #11 to draft."));
    assert.equal(draft.read.operation.status, "completed", draft.read.operation.diagnostic ?? "");
    assert.equal(draft.read.result?.resource?.draft, true); assert.equal(f.workItem(11)?.draft, true);
    assert.equal(f.calls.filter((call) => call.method === "POST" && call.path === "graphql").length, 2);
    f.closePull(11);
    await assert.rejects(() => f.sdk.github.preview(f.scope, { kind: "github.pr.draft", ...identity, number: 11, draft: false }), { code: "github_pr" });
  } finally { await f.close(); }
});

test("labels and assignees replace the whole set on PRs and issues, including the empty set", { timeout: ciTime(30_000) }, async () => {
  const f = await githubApplicationFixture();
  try {
    const labels = await run(f, { kind: "github.issue.labels", ...identity, number: 11, labels: ["generated-bug", "Generated-Docs"] });
    assert.equal(labels.read.operation.status, "completed", labels.read.operation.diagnostic ?? "");
    assert.equal(labels.read.result?.resource?.kind, "pull");
    assert.deepEqual(labels.read.result?.resource?.labels, [{ name: "generated-bug", color: "d73a4a" }, { name: "generated-docs", color: "0075ca" }]);
    assert.ok(labels.review.document.warnings.some((warning) => warning.includes("whole label set")));
    const cleared = await run(f, { kind: "github.issue.labels", ...identity, number: 11, labels: [] });
    assert.equal(cleared.read.operation.status, "completed", cleared.read.operation.diagnostic ?? "");
    assert.deepEqual(cleared.read.result?.resource?.labels, []); assert.deepEqual(f.workItem(11)?.labels, []);
    assert.ok(f.calls.some((call) => call.method === "PUT" && call.path === "repos/generated-owner/fixture/issues/11/labels"));

    const assigned = await run(f, { kind: "github.issue.assignees", ...identity, number: 7, assignees: ["generated-teammate", "generated-reviewer"] });
    assert.equal(assigned.read.operation.status, "completed", assigned.read.operation.diagnostic ?? "");
    assert.equal(assigned.read.result?.resource?.kind, "issue");
    assert.deepEqual(assigned.read.result?.resource?.assignees, ["generated-teammate", "generated-reviewer"]);
    const dropped = await run(f, { kind: "github.issue.assignees", ...identity, number: 7, assignees: ["generated-stranger"] });
    assert.equal(dropped.read.operation.status, "partial");
    assert.match(dropped.read.operation.diagnostic ?? "", /assignees/);
    const none = await run(f, { kind: "github.issue.assignees", ...identity, number: 11, assignees: [] });
    assert.equal(none.read.operation.status, "completed", none.read.operation.diagnostic ?? "");
    assert.deepEqual(none.read.result?.resource?.assignees, []); assert.deepEqual(f.workItem(11)?.assignees, []);
    await assert.rejects(() => f.sdk.github.preview(f.scope, { kind: "github.issue.labels", ...identity, number: 11, labels: ["generated-bug", "GENERATED-BUG"] }), { code: "github_input" });
  } finally { await f.close(); }
});

test("PR reviewers are requested and removed in one exact call each", { timeout: ciTime(30_000) }, async () => {
  const f = await githubApplicationFixture();
  try {
    const requested = await run(f, { kind: "github.pr.reviewers", ...identity, number: 11, operation: "request", reviewers: ["generated-teammate"] });
    assert.equal(requested.read.operation.status, "completed", requested.read.operation.diagnostic ?? "");
    assert.deepEqual(requested.read.result?.resource?.reviewers, ["generated-reviewer", "generated-teammate"]);
    const removed = await run(f, { kind: "github.pr.reviewers", ...identity, number: 11, operation: "remove", reviewers: ["generated-reviewer", "generated-teammate"] });
    assert.equal(removed.read.operation.status, "completed", removed.read.operation.diagnostic ?? "");
    assert.deepEqual(removed.read.result?.resource?.reviewers, []);
    assert.deepEqual(f.calls.filter((call) => call.path.endsWith("/requested_reviewers")).map((call) => call.method), ["POST", "DELETE"]);
  } finally { await f.close(); }
});

test("an inline review comment posts once on the reviewed head and lines, then shows under review comments and the timeline", { timeout: ciTime(30_000) }, async () => {
  const f = await githubApplicationFixture();
  try {
    const head = f.git(["rev-parse", "HEAD"]);
    const single = await run(f, { kind: "github.review.comment", ...identity, number: 11, path: "src/generated.ts", line: 12, side: "RIGHT", body: "Generated inline note." });
    assert.ok(single.review.document.confirmations.includes("Post a review comment on src/generated.ts line 12 of pull request #11."));
    assert.ok(single.review.document.warnings.includes(`GitHub publishes this comment right away on the reviewed head ${head}. It shows under the pull request's reviews, not its conversation.`));
    assert.equal(single.read.operation.status, "completed", single.read.operation.diagnostic ?? "");
    assert.deepEqual([single.read.result?.resource?.kind, single.read.result?.resource?.path, single.read.result?.resource?.line, single.read.result?.resource?.headSha],
      ["comment", "src/generated.ts", 12, head]);
    const range = await run(f, { kind: "github.review.comment", ...identity, number: 11, path: "src/generated.ts", line: 5, side: "LEFT", startLine: 3, startSide: "LEFT", body: "Generated range note." });
    assert.ok(range.review.document.confirmations.includes("Post a review comment on src/generated.ts old lines 3-5 of pull request #11."));
    assert.equal(range.read.operation.status, "completed", range.read.operation.diagnostic ?? "");
    assert.deepEqual(f.reviewComments(11).map((comment) => [comment.path, comment.line, comment.side, comment.start_line, comment.start_side, comment.commit_id]),
      [["src/generated.ts", 12, "RIGHT", null, null, head], ["src/generated.ts", 5, "LEFT", 3, "LEFT", head]]);
    assert.equal(f.calls.filter((call) => call.method === "POST" && call.path === "repos/generated-owner/fixture/pulls/11/comments").length, 2);
    const listed = (await f.sdk.github.browse(f.scope, { resource: "review-comments", ...identity, number: 11, page: 1, perPage: 30 })).items;
    assert.deepEqual(listed.slice(1).map((item) => [item.kind, item.body, item.path, item.line]), [["comment", "Generated inline note.", "src/generated.ts", 12], ["comment", "Generated range note.", "src/generated.ts", 5]]);
    const timeline = (await f.sdk.github.browse(f.scope, { resource: "timeline", ...identity, number: 11, page: 1, perPage: 100 })).items;
    assert.deepEqual(timeline.slice(-2).map((item) => [item.kind, item.body, item.line]), [["comment", "Generated inline note.", 12], ["comment", "Generated range note.", 5]]);
    assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });

    const invalid = { kind: "github.review.comment" as const, ...identity, number: 11, path: "src/generated.ts", line: 5, side: "RIGHT" as const, body: "Generated note." };
    for (const action of [{ ...invalid, startLine: 3 }, { ...invalid, startLine: 5, startSide: "RIGHT" as const }, { ...invalid, path: "src/../generated.ts" }, { ...invalid, path: "/generated.ts" }]) {
      await assert.rejects(() => f.sdk.github.preview(f.scope, action), { code: "github_input" }, JSON.stringify(action));
    }
    f.driftReviewComments();
    const drifted = await run(f, { ...invalid, line: 7 });
    assert.equal(drifted.read.operation.status, "partial");
    assert.match(drifted.read.operation.diagnostic ?? "", /doesn't acknowledge the exact file, lines, side/);
    assert.equal(f.reviewComments(11).length, 3, "the unacknowledged write is inspectable, never retried");
    f.closePull(11);
    await assert.rejects(() => f.sdk.github.preview(f.scope, invalid), { code: "github_pr" });
  } finally { await f.close(); }
});

test("PR commits, timeline, repository labels, assignable users and work-item metadata map to typed items", { timeout: ciTime(30_000) }, async () => {
  const f = await githubApplicationFixture();
  try {
    const head = f.git(["rev-parse", "HEAD"]), browse = (input: Parameters<Fixture["sdk"]["github"]["browse"]>[1]) => f.sdk.github.browse(f.scope, input);
    const first = await browse({ resource: "commits", ...identity, number: 11, page: 1, perPage: 1 });
    const second = await browse({ resource: "commits", ...identity, number: 11, page: 2, perPage: 1 });
    assert.equal(first.nextPage, 2); assert.equal(second.nextPage, null);
    assert.deepEqual([...first.items, ...second.items].map((item) => [item.kind, item.id, item.headSha, item.title, item.author]), [
      ["commit", 1, `c0ffee${"0".repeat(34)}`, "Generated first commit", "generated-owner"], ["commit", 2, head, "Generated head commit", "generated-owner"]]);
    assert.equal(first.items[0]?.body, "Generated first commit\n\nGenerated commit details."); assert.equal(first.items[0]?.updatedAt, "2026-01-01T00:00:00Z");

    await run(f, { kind: "github.pr.draft", ...identity, number: 11, draft: false });
    const timeline = (await browse({ resource: "timeline", ...identity, number: 11, page: 1, perPage: 100 })).items;
    assert.deepEqual(timeline.map((item) => [item.kind, item.state, item.title]), [
      ["commit", "", "Generated first commit"], ["commit", "", "Generated head commit"], ["event", "review_requested", "generated-reviewer"],
      ["event", "labeled", "generated-label"], ["comment", "", ""], ["review", "APPROVED", ""], ["comment", "", ""],
      ["event", "renamed", "Generated pull request"], ["event", "ready_for_review", ""]]);
    assert.deepEqual(timeline[3]?.labels, [{ name: "generated-label", color: "0e8a16" }]);
    assert.equal(timeline[4]?.body, "Generated conversation comment."); assert.equal(timeline[5]?.updatedAt, "2026-01-01T04:00:00Z");
    assert.equal(timeline[5]?.headSha, head); assert.equal(timeline[6]?.path, "generated.ts"); assert.equal(timeline[6]?.line, 1);
    assert.equal(timeline[7]?.body, "Generated draft title"); assert.equal(timeline[8]?.author, "generated-owner");

    const labels = await browse({ resource: "labels", ...identity, page: 1, perPage: 30 });
    assert.deepEqual(labels.items.map((item) => [item.kind, item.id, item.title, item.state, item.body]), [["label", 901, "generated-label", "0e8a16", "Generated label"],
      ["label", 902, "generated-bug", "d73a4a", "Generated bug report"], ["label", 903, "generated-docs", "0075ca", ""]]);
    const users = await browse({ resource: "assignees", ...identity, page: 1, perPage: 30 });
    assert.deepEqual(users.items.map((item) => [item.kind, item.id, item.title, item.author]), [["user", 42, "generated-owner", "generated-owner"],
      ["user", 43, "generated-reviewer", "generated-reviewer"], ["user", 44, "generated-teammate", "generated-teammate"]]);

    const pull = (await browse({ resource: "pull", ...identity, number: 11, page: 1, perPage: 30 })).items[0]!;
    assert.deepEqual([pull.labels, pull.assignees, pull.reviewers, pull.createdAt, pull.commits, pull.changedFiles],
      [[{ name: "generated-label", color: "0e8a16" }], ["generated-owner"], ["generated-reviewer"], "2025-12-31T00:00:00Z", 2, 1]);
    const listed = (await browse({ resource: "pulls", ...identity, page: 1, perPage: 30 })).items[0]!;
    assert.equal("commits" in listed, false); assert.deepEqual(listed.reviewers, ["generated-reviewer"]);
    assert.equal("reviewers" in (await browse({ resource: "issue", ...identity, number: 7, page: 1, perPage: 30 })).items[0]!, false);
  } finally { await f.close(); }
});

test("only GitHub Actions check runs link to their workflow run; checks and runs carry start times and apps", { timeout: ciTime(30_000) }, async () => {
  const f = await githubApplicationFixture();
  try {
    const head = f.git(["rev-parse", "HEAD"]);
    f.setCi({ statuses: [], checks: [{ id: 82, name: "Generated Actions job", status: "completed", conclusion: "success", head_sha: head },
      { id: 85, name: "Generated external check", status: "completed", conclusion: "success", head_sha: head, app: { slug: "generated-ci" },
        html_url: "https://github.com/generated-owner/fixture/runs/85", details_url: "https://github.com/generated-owner/fixture/actions/runs/99/job/85" },
      { id: 86, name: "Generated legacy check", status: "completed", conclusion: "success", head_sha: head, started_at: null,
        html_url: "https://github.com/generated-owner/fixture/runs/86", details_url: "https://github.com/generated-owner/fixture/runs/86" }] });
    const checks = (await f.sdk.github.browse(f.scope, { resource: "checks", ...identity, headSha: head, page: 1, perPage: 30 })).items;
    assert.deepEqual(checks.map((item) => [item.id, item.app, item.runId, item.startedAt]), [[82, "github-actions", 80, "2026-01-01T00:00:00Z"],
      [85, "generated-ci", undefined, "2026-01-01T00:00:00Z"], [86, "github-actions", undefined, undefined]]);
    const runs = (await f.sdk.github.browse(f.scope, { resource: "runs", ...identity, page: 1, perPage: 30 })).items;
    assert.equal(runs[0]?.startedAt, "2026-01-01T00:00:00Z");
  } finally { await f.close(); }
});

test("agents may toggle draft state but labels, assignees, reviewers and inline review comments stay user-only", () => {
  const base = { ...identity, number: 11 };
  assert.equal(isGithubModelAction({ kind: "github.pr.draft" }), true);
  for (const kind of ["github.issue.labels", "github.issue.assignees", "github.pr.reviewers", "github.review.comment"]) assert.equal(isGithubModelAction({ kind }), false, kind);
  assert.equal(Value.Check(GithubWriteToolSchema, { action: "preview", input: { kind: "github.review.comment", ...base, path: "generated.ts", line: 1, side: "RIGHT", body: "Generated." } }), false);
  assert.equal(Value.Check(GithubWriteToolSchema, { action: "preview", input: { kind: "github.pr.draft", ...base, draft: false } }), true);
  assert.equal(Value.Check(GithubWriteToolSchema, { action: "preview", input: { kind: "github.issue.labels", ...base, labels: ["generated-bug"] } }), false);
  assert.equal(Value.Check(GithubWriteToolSchema, { action: "preview", input: { kind: "github.pr.reviewers", ...base, operation: "request", reviewers: ["generated-teammate"] } }), false);
});
