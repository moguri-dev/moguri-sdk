import assert from "node:assert/strict";
import test from "node:test";
import { myWorkCategories, myWorkItemId, projectMyWorkSource, type MyWorkPull, type MyWorkSource } from "../packages/protocol/src/my-work.ts";
import { MoguriError, MoguriSdk } from "../packages/sdk/src/index.ts";
import { myWorkFixture } from "./my-work-fixture.ts";
import { connectGithubSdk } from "./github-workflows-fixture.ts";
import { waitFor } from "./fixture.ts";
import { profileFixture } from "./fixtures/profiles.ts";
import { mkdir, rename } from "node:fs/promises";
import { ciTime } from "./fixtures/time-scale.ts";

const source: MyWorkSource = {
  version: 1, id: "a".repeat(64), profileId: "default", revision: 0, enabled: true, actor: "user",
  repository: "generated-owner/fixture", account: "generated-user", accountId: "generated-user:42",
  binding: { env: "Local", profileId: "default", projectId: "generated-project", workspaceId: null,
    root: { root: "/generated/checkout", device: "1", inode: "2" }, configurationRevision: 0, policyRevision: 0, permissionRevision: 0 },
  remote: { name: "origin", fetchUrl: "git@github.com:generated-owner/fixture.git", pushUrls: ["git@github.com:generated-owner/fixture.git"] },
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};
const pull: MyWorkPull = {
  item: { kind: "pull", id: 10, number: 9, title: "Generated work", body: "Many comments are not proof of unresolved threads.",
    state: "open", url: "https://github.com/generated-owner/fixture/pull/9", author: "generated-user",
    headSha: "b".repeat(40), conclusion: null, updatedAt: "2026-01-01T00:00:00Z", draft: false },
  observedAt: "2026-01-01T00:00:00.000Z", complete: false, diagnostic: null,
  reviewDecision: null, requests: null, threads: null, ci: null,
};

test("canonical PR identity ignores repository case and overlapping attention categories", () => {
  assert.equal(myWorkItemId("generated-owner/fixture", 9), myWorkItemId("Generated-Owner/Fixture", 9));
  assert.notEqual(myWorkItemId("generated-owner/fixture", 9), myWorkItemId("generated-owner/other", 9));
  assert.throws(() => myWorkItemId("generated-owner/fixture", 0), /positive|canonical/i);
});

test("unknown review/thread/check evidence cannot become guessed attention or successful CI", () => {
  assert.deepEqual(myWorkCategories(pull), ["open-pr"]);
  assert.deepEqual(myWorkCategories({ ...pull, requests: [{ kind: "user", login: "generated-reviewer",
    url: "https://github.com/generated-reviewer" }], threads: [{ id: "GENERATED_THREAD", commentId: 83, resolved: false,
    outdated: true, body: "Generated thread", path: "fixture.ts", line: 1,
    url: "https://github.com/generated-owner/fixture/pull/9#discussion_r83" }] }), ["open-pr", "pending-review", "unresolved-thread"]);
  assert.deepEqual(myWorkCategories({ ...pull, item: { ...pull.item, state: "closed" }, requests: [], threads: [] }), []);
});

test("configured source ownership cannot be retargeted or lose actual-user provenance", () => {
  assert.deepEqual(projectMyWorkSource(undefined, source), source);
  const next = { ...source, enabled: false, revision: 1, updatedAt: "2026-01-02T00:00:00.000Z" };
  assert.deepEqual(projectMyWorkSource(source, next), next);
  assert.throws(() => projectMyWorkSource(source, { ...next, accountId: "generated-other:43" }), /corrupt|ownership/i);
  assert.throws(() => projectMyWorkSource(source, { ...next, binding: { ...source.binding, profileId: "other" } }), /corrupt|ownership/i);
  assert.throws(() => projectMyWorkSource(source, { ...next, revision: 3 }), /corrupt|ownership/i);
});

test("shared inbox aggregates only configured repositories/accounts and deduplicates canonical PR categories/associations", { timeout: ciTime(30000) }, async () => {
  const f = await myWorkFixture();
  try {
    const before = f.calls.length;
    assert.equal((await f.sdk.myWork.query()).entries.length, 0);
    assert.equal(f.calls.length, before);
    await assert.rejects(f.sdk.myWork.refresh(), /Configure.*explicit|unconfigured/i);
    const a = await f.configure(f.first), b = await f.configure(f.second);
    const alias = await f.addRepository("inbox-alias", f.first.account, f.first.accountId, false, f.first.repository);
    await f.configure(alias);
    f.first.checks[0]!.conclusion = "startup_failure";
    alias.checks = structuredClone(f.first.checks); alias.pulls = structuredClone(f.first.pulls);
    const original = await f.sdk.github.source(f.scope, { kind: "pull", repository: f.first.repository, account: f.first.account,
      accountId: `${f.first.account}:${f.first.accountId}`, number: 11 });
    await f.sdk.sessions.associatePr(f.sessionId, { ...original.source, expectedDigest: original.digest });
    const started = await f.sdk.myWork.refresh(), result = await f.sdk.myWork.wait(started.id!);
    assert.equal(result.refresh.status, "completed");
    const inbox = await f.sdk.myWork.query();
    assert.equal(inbox.entries.length, 2);
    const entry = inbox.entries.find((entry) => entry.repository === f.first.repository)!;
    assert.equal(entry.associations.length, 2);
    assert.deepEqual(new Set(entry.categories), new Set(["open-pr", "pending-review", "failed-ci", "unresolved-thread"]));
    assert.ok(entry.associations.some((source) => source.sessionIds.includes(f.sessionId)));
    assert.equal(entry.pull.ci?.state, "failure");
    assert.match(entry.associations.find((source) => source.source.id === a)!.pull.ci!.items[0]!.body, /billing allowance/);
    assert.equal((await f.sdk.myWork.query({ category: "pending-review" })).total, 2);
    assert.equal((await f.sdk.myWork.query({ sourceId: b })).total, 1);
    assert.equal((await f.sdk.myWork.query({ accountId: "generated-b:43" })).total, 1);
    assert.equal((await f.sdk.myWork.query({ projectId: f.projectId, text: "inbox-a" })).total, 1);
    assert.equal(f.service.controller.snapshot().githubOperations.length, 0);
    assert.equal(f.service.controller.snapshot().sessions[0]!.turnId, null);
    assert.ok(f.calls.every((call) => call.method === "GET" || call.path === "graphql"));
    const attention = f.service.controller.snapshot().attention.filter((entry) => entry.reason === "my-work" && entry.active);
    assert.equal(attention.length, 2);
    await f.sdk.myWork.markRead(entry.id);
    assert.equal(f.service.controller.snapshot().attention.find((value) => value.messageId === entry.id)?.acknowledged, true);
    const again = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(again.id!);
    assert.equal(f.service.controller.snapshot().attention.filter((entry) => entry.reason === "my-work" && entry.active).length, 2);
    assert.equal(f.service.controller.snapshot().attention.find((value) => value.messageId === entry.id)?.acknowledged, true);
  } finally { await f.close(); }
});

test("deleting a global notification suppresses its exact repeated observation but a genuinely changed head can raise new attention", { timeout: ciTime(30000) }, async () => {
  const f = await myWorkFixture();
  try {
    await f.configure(f.first);
    await f.sdk.myWork.wait((await f.sdk.myWork.refresh()).id!);
    const original = f.service.controller.snapshot().attention.find((entry) => entry.reason === "my-work" && entry.active)!;
    await f.sdk.attention.delete([original.id]);
    await f.sdk.myWork.wait((await f.sdk.myWork.refresh()).id!);
    assert.equal(f.service.controller.snapshot().attention.some((entry) => entry.messageId === original.messageId && entry.active), false);
    await f.sdk.myWork.markRead(original.messageId!);
    assert.equal(f.service.controller.snapshot().attention.find((entry) => entry.id === original.id)?.deleted, true);
    f.first.pulls[0]!.head = "c".repeat(40); f.first.checks[0]!.head_sha = "c".repeat(40);
    await f.sdk.myWork.wait((await f.sdk.myWork.refresh()).id!);
    const changed = f.service.controller.snapshot().attention.find((entry) => entry.messageId === original.messageId && entry.active);
    assert.ok(changed); assert.notEqual(changed.id, original.id); assert.notEqual(changed.myWork?.fingerprint, original.myWork?.fingerprint);
    assert.equal(f.service.controller.snapshot().budgetEntries.length, 0);
    assert.equal(f.service.controller.snapshot().sessions[0]?.turnId, null);
  } finally { await f.close(); }
});

test("complete PR/review/thread/check pagination is real provider state, including team requests and outdated unresolved conversations", { timeout: ciTime(60000) }, async () => {
  const f = await myWorkFixture();
  try {
    const base = f.first.pulls[0]!;
    f.first.pulls = Array.from({ length: 2 }, (_, index) => ({ ...base, number: index + 1, title: `Generated paginated PR ${index + 1}`,
      requests: [], threads: [] }));
    f.first.pullPages = [[1], [2]];
    f.first.pulls[0]!.requests = Array.from({ length: 101 }, (_, index) => ({ kind: index === 100 ? "team" : "user",
      login: index === 100 ? "generated-org/reviewers" : `generated-reviewer-${index}` }));
    f.first.pulls[0]!.threads = Array.from({ length: 201 }, (_, index) => ({ id: `GENERATED_THREAD_${index}`,
      commentId: 1000 + index, resolved: index !== 200, outdated: index === 200 }));
    f.first.checks = Array.from({ length: 101 }, (_, index) => ({ ...f.first.checks[0]!, id: 1000 + index }));
    await f.configure(f.first);
    const started = await f.sdk.myWork.refresh();
    assert.equal((await f.sdk.myWork.wait(started.id!, { timeoutMs: 55000 })).refresh.status, "completed");
    const first = await f.sdk.myWork.query({}, { limit: 1 }), second = await f.sdk.myWork.query({}, { offset: 1, limit: 1 });
    assert.equal(first.total, 2); assert.equal(first.entries.length, 1); assert.equal(second.entries.length, 1);
    const original = (await f.sdk.myWork.read(started.id!)).observations[0]!.pulls.find((pull) => pull.item.number === 1)!;
    assert.equal(original.requests?.length, 101); assert.equal(original.threads?.length, 201); assert.equal(original.ci?.items.length, 101);
    assert.ok(original.requests?.some((request) => request.kind === "team"));
    assert.deepEqual(myWorkCategories(original), ["open-pr", "pending-review", "unresolved-thread"]);
    assert.ok(f.calls.some((call) => call.path.includes("/pulls?") && call.path.includes("page=2")));
    assert.equal(new Set([first.entries[0]!.id, second.entries[0]!.id]).size, 2);
  } finally { await f.close(); }
});

test("changed heads, closed/merged/reopened PRs and old observations retain distinct freshness and original reports", { timeout: ciTime(30000) }, async () => {
  let now = Date.now();
  const f = await myWorkFixture({ now: () => now });
  try {
    await f.configure(f.first);
    const first = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(first.id!);
    now += 300001;
    assert.equal((await f.sdk.myWork.query()).entries[0]!.freshness, "stale");
    f.first.pulls[0]!.head = "c".repeat(40); f.first.checks[0]!.head_sha = "c".repeat(40);
    const second = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(second.id!);
    assert.equal((await f.sdk.myWork.query()).entries[0]!.pull.item.headSha, "c".repeat(40));
    assert.equal((await f.sdk.myWork.read(first.id!)).observations[0]!.pulls[0]!.item.headSha, f.head);
    f.first.pulls[0]!.state = "closed"; f.first.pulls[0]!.merged = true;
    const closed = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(closed.id!);
    assert.equal((await f.sdk.myWork.query()).total, 0);
    assert.equal((await f.sdk.myWork.query({ state: "merged" })).total, 1);
    assert.equal(f.service.controller.snapshot().attention.filter((entry) => entry.reason === "my-work" && entry.active).length, 0);
    f.first.pulls[0]!.state = "open"; f.first.pulls[0]!.merged = false;
    const reopened = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(reopened.id!);
    assert.equal((await f.sdk.myWork.query()).total, 1);
  } finally { await f.close(); }
});

test("revoked access/outages retain older positive evidence and never become a clean inbox", { timeout: ciTime(30000) }, async () => {
  const f = await myWorkFixture();
  try {
    const source = await f.configure(f.first); await f.configure(f.second);
    const first = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(first.id!);
    f.first.revoked = true; f.second.outage = true;
    const failed = await f.sdk.myWork.refresh(), original = await f.sdk.myWork.wait(failed.id!);
    assert.notEqual(original.refresh.status, "completed");
    const inbox = await f.sdk.myWork.query();
    assert.equal(inbox.entries.length, 2);
    assert.ok(inbox.sources.every((source) => source.diagnostic && !source.complete));
    assert.ok(inbox.entries.every((entry) => entry.freshness !== "fresh"));
    assert.equal((await f.sdk.myWork.read(first.id!)).observations.length, 2);
    await assert.rejects(f.sdk.myWork.previewFollowup(myWorkItemId(f.first.repository, 11), source), /HTTP 403/);
    assert.equal(f.service.controller.snapshot().sessions.length, 1);
  } finally { await f.close(); }
});

test("incomplete/malformed/repeated review pages preserve positive PRs without guessing resolution", { timeout: ciTime(30000) }, async (t) => {
  for (const kind of ["malformed", "count", "cursor"] as const) await t.test(kind, async () => {
    const f = await myWorkFixture();
    try {
      await f.configure(f.first);
      if (kind === "malformed") f.first.malformedThreads = true;
      if (kind === "count") f.first.countOverride = 9;
      if (kind === "cursor") {
        f.first.repeatedCursor = true;
        f.first.pulls[0]!.threads = Array.from({ length: 201 }, (_, index) => ({ id: `GENERATED_THREAD_${index}`, commentId: 1000 + index, resolved: false, outdated: false }));
      }
      const started = await f.sdk.myWork.refresh(), result = await f.sdk.myWork.wait(started.id!);
      assert.equal(result.refresh.status, "partial");
      const inbox = await f.sdk.myWork.query();
      assert.equal(inbox.total, 1); assert.equal(inbox.entries[0]!.pull.complete, false);
      assert.equal(inbox.entries[0]!.pull.ci, null);
      assert.match(inbox.sources[0]!.diagnostic!, /resolution|count|pagination|original|provider|schema/i);
    } finally { await f.close(); }
  });
});

test("overlapping SDK refreshes share one actual job; conflicting sets fail; cancellation never stops a CI watch", { timeout: ciTime(30000) }, async () => {
  const gate = Promise.withResolvers<void>(); let block = false, reading = false;
  const f = await myWorkFixture({ beforeRead: async (_repo, path, signal) => {
    if (!block || !path.includes("/pulls?")) return;
    reading = true;
    await Promise.race([gate.promise, new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))]);
  } });
  const second = new MoguriSdk(f.service.connection);
  try {
    const a = await f.configure(f.first), b = await f.configure(f.second); await connectGithubSdk(second);
    block = true;
    const [one, two] = await Promise.all([f.sdk.myWork.refresh([a]), second.myWork.refresh([a])]);
    assert.equal(one.id, two.id); await waitFor(() => reading);
    await assert.rejects(second.myWork.refresh([a, b]), /already owns|overlapping|original/i);
    assert.equal(f.service.controller.snapshot().myWorkRefreshes.length, 1);
    await second.myWork.cancel(one.id!);
    const original = await f.sdk.myWork.wait(one.id!);
    assert.equal(original.refresh.status, "cancelled"); assert.equal(original.refresh.cancelRequested, true);
    assert.equal(f.service.controller.snapshot().githubOperations.length, 0);
    assert.equal(f.calls.filter((call) => call.path.includes("/pulls?")).length, 1);
  } finally { gate.resolve(); second.disconnect(); await f.close(); }
});

test("source changes fence late results without replacing the original account/root", { timeout: ciTime(30000) }, async () => {
  const gate = Promise.withResolvers<void>(); let block = false, reading = false;
  const f = await myWorkFixture({ beforeRead: async (_repo, path, signal) => {
    if (!block || !path.includes("/pulls?")) return;
    reading = true; await gate.promise; signal.throwIfAborted();
  } });
  try {
    const sourceId = await f.configure(f.first); block = true;
    const started = await f.sdk.myWork.refresh(); await waitFor(() => reading);
    await f.sdk.myWork.toggle(sourceId, 0, false); gate.resolve();
    const result = await f.sdk.myWork.wait(started.id!);
    assert.equal(result.refresh.status, "partial");
    assert.equal(result.refresh.sources[0]!.source.enabled, true);
    assert.equal(result.refresh.sources[0]!.source.accountId, "generated-a:42");
    assert.equal(result.refresh.sources[0]!.observationDigest, null);
    assert.equal((await f.sdk.myWork.query()).total, 0);
  } finally { gate.resolve(); await f.close(); }
});

test("explicit follow-up uses a fresh exact source review and creates only an idle session/draft", { timeout: ciTime(30000) }, async () => {
  const f = await myWorkFixture();
  try {
    const sourceId = await f.configure(f.first), started = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(started.id!);
    const itemId = myWorkItemId(f.first.repository, 11), before = f.calls.length;
    assert.deepEqual((await f.sdk.myWork.navigate(itemId, sourceId)).navigation.sessionIds, []);
    assert.equal(f.calls.length, before);
    const preview = await f.sdk.myWork.previewFollowup(itemId, sourceId);
    f.first.pulls[0]!.body = "Generated changed source for exact review.";
    await assert.rejects(f.sdk.myWork.start(preview, sourceId, true), /review changed|review|source/i);
    assert.equal(f.service.controller.snapshot().sessions.length, 1);
    const fresh = await f.sdk.myWork.previewFollowup(itemId, sourceId), admitted = await f.sdk.myWork.start(fresh, sourceId, true);
    const session = f.service.controller.snapshot().sessions.find((session) => session.id === admitted.id)!;
    assert.equal(session.projectId, f.projectId); assert.equal(session.turnId, null); assert.equal(session.queue.length, 0);
    assert.equal(session.githubSource?.accountId, "generated-a:42");
    assert.match(session.draft.text, /Generated changed source/);
    assert.ok((await f.sdk.myWork.navigate(itemId, sourceId)).navigation.sessionIds.includes(session.id));
    assert.ok(f.calls.every((call) => call.method === "GET" || call.path === "graphql"));
  } finally { await f.close(); }
});

test("CI edge states and count/diagnostic failures are honest and do not fabricate a green inbox", { timeout: ciTime(60000) }, async (t) => {
  for (const [conclusion, expected] of [["success", "success"], ["cancelled", "cancelled"], ["timed_out", "timed-out"],
    ["startup_failure", "failure"], ["neutral", "neutral"], ["skipped", "skipped"], ["unexpected", "unknown"]] as const) {
    await t.test(conclusion, async () => {
      const f = await myWorkFixture();
      try {
        await f.configure(f.first); f.first.checks[0]!.conclusion = conclusion;
        const start = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(start.id!);
        const entry = (await f.sdk.myWork.query()).entries[0]!;
        assert.equal(entry.pull.ci?.state, expected);
        assert.equal(entry.categories.includes("failed-ci"), ["failure", "cancelled", "timed-out"].includes(expected));
      } finally { await f.close(); }
    });
  }
  const f = await myWorkFixture();
  try {
    await f.configure(f.first); f.first.checks = [];
    const start = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(start.id!);
    assert.equal((await f.sdk.myWork.query()).entries[0]!.pull.ci?.state, "no-checks");
    f.first.checks = [{ id: 82, name: "Generated running", status: "in_progress", conclusion: null, head_sha: f.head }];
    const running = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(running.id!);
    assert.equal((await f.sdk.myWork.query()).entries[0]!.pull.ci?.state, "running");
  } finally { await f.close(); }
});

test("uncertain reader cleanup stays partial and cannot erase prior failure evidence", { timeout: ciTime(30000) }, async () => {
  let fail = false;
  const f = await myWorkFixture({ beforeRead: async (_repo, path) => {
    if (fail && path.includes("/pulls?")) throw new MoguriError("program_partial", "Generated original reader cleanup is unconfirmed.", 409);
  } });
  try {
    await f.configure(f.first);
    const first = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(first.id!);
    fail = true;
    const second = await f.sdk.myWork.refresh(), original = await f.sdk.myWork.wait(second.id!);
    assert.equal(original.refresh.status, "partial"); assert.equal(original.refresh.cleanupUnconfirmed, true);
    assert.equal((await f.sdk.myWork.query()).total, 1);
    assert.equal((await f.sdk.myWork.query()).entries[0]!.freshness, "stale");
    await assert.rejects(f.sdk.myWork.refresh(), /Inspect original partial refresh/);
    await assert.rejects(f.sdk.myWork.inspect(second.id!, original.refresh.revision + 1, original.refresh.inputDigest, true), /revision.*changed/i);
    await f.sdk.myWork.inspect(second.id!, original.refresh.revision, original.refresh.inputDigest, true);
    assert.equal((await f.sdk.myWork.read(second.id!)).refresh.cleanupUnconfirmed, true);
    fail = false;
    const independent = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(independent.id!);
    assert.notEqual(independent.id, second.id);
    assert.equal((await f.sdk.myWork.read(second.id!)).refresh.status, "partial");
  } finally { await f.close(); }
});

test("all current GitHub RequestedReviewer variants remain actual pending requests without guessed user/team membership", { timeout: ciTime(30000) }, async () => {
  const f = await myWorkFixture();
  try {
    f.first.pulls[0]!.requests = [{ kind: "user", login: "generated-human" }, { kind: "team", login: "generated-org/reviewers" },
      { kind: "bot", login: "generated-review-bot[bot]" }, { kind: "mannequin", login: "generated-mannequin" },
      { kind: "enterprise-team", login: "generated-enterprise/reviewers" }];
    await f.configure(f.first);
    const started = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(started.id!);
    const entry = (await f.sdk.myWork.query()).entries[0]!;
    assert.deepEqual(entry.pull.requests?.map((request) => request.kind), ["user", "team", "bot", "mannequin", "enterprise-team"]);
    assert.equal(entry.pull.requests?.at(-1)?.url, null);
    assert.equal(entry.pull.requests?.at(-1)?.nodeId, "GENERATED_ENTERPRISE_TEAM");
    assert.ok(entry.categories.includes("pending-review"));
  } finally { await f.close(); }
});

test("provider head/account changes mid-read fence partial pages and preserve the original source without mixed CI", { timeout: ciTime(30000) }, async (t) => {
  for (const change of ["head", "account"] as const) await t.test(change, async () => {
    let alter = false;
    const f = await myWorkFixture({ beforeRead: async (repo, path) => {
      if (!alter || change === "head" && path !== "graphql" || change === "account" && !path.includes("/pulls?")) return;
      alter = false;
      if (change === "head") repo.pulls[0]!.head = "c".repeat(40); else repo.accountId++;
    } });
    try {
      await f.configure(f.first);
      const original = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(original.id!);
      alter = true;
      const changed = await f.sdk.myWork.refresh(), record = await f.sdk.myWork.wait(changed.id!);
      assert.notEqual(record.refresh.status, "completed");
      const inbox = await f.sdk.myWork.query();
      assert.equal(inbox.entries[0]!.pull.item.headSha, f.head);
      assert.equal(inbox.entries[0]!.freshness === "fresh", false);
      if (change === "head") assert.equal(inbox.entries[0]!.pull.ci, null);
      assert.equal((await f.sdk.myWork.read(original.id!)).observations[0]!.source.accountId, "generated-a:42");
    } finally { await f.close(); }
  });
});

test("retained CI watch reuse is exact-head/source-bound; cancelling an inbox leaves the pre-existing watcher running", { timeout: ciTime(30000) }, async () => {
  const reached = Promise.withResolvers<void>(); let block = false, reading = false;
  const f = await myWorkFixture({ wait: async (_ms, signal) => {
    reached.resolve(); await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  }, beforeRead: async (_repo, path, signal) => {
    if (!block || !path.includes("/pulls?")) return; reading = true;
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  } });
  try {
    const sourceId = await f.configure(f.first);
    f.first.checks[0]!.status = "in_progress"; f.first.checks[0]!.conclusion = null;
    const scope = f.scope, target = { kind: "pull" as const, repository: f.first.repository, account: f.first.account, accountId: "generated-a:42", number: 11 };
    const review = await f.sdk.github.previewCi(scope, target, { timeoutMs: 20000, pollMs: 50 });
    const watch = await f.sdk.github.execute(review, review.document.confirmations, true); await reached.promise;
    const reads = f.calls.filter((call) => call.path.includes("/check-runs?")).length;
    const started = await f.sdk.myWork.refresh([sourceId]); await f.sdk.myWork.wait(started.id!);
    const entry = (await f.sdk.myWork.query()).entries[0]!;
    assert.equal(entry.pull.ci?.state, "running"); assert.equal(entry.pull.ciWatchId, watch.id);
    assert.equal(entry.associations[0]!.watch?.operationId, watch.id);
    assert.ok(entry.associations[0]!.sessionIds.includes(f.sessionId));
    assert.equal(f.calls.filter((call) => call.path.includes("/check-runs?")).length, reads);
    block = true;
    const refresh = await f.sdk.myWork.refresh([sourceId]); await waitFor(() => reading);
    await f.sdk.myWork.cancel(refresh.id!);
    assert.equal((await f.sdk.github.read(watch.id!)).operation.status, "running");
    assert.equal((await f.sdk.github.read(watch.id!)).operation.cancelRequested, false);
    block = false; f.first.pulls[0]!.head = "c".repeat(40); f.first.checks[0]!.head_sha = "c".repeat(40);
    const fresh = await f.sdk.myWork.refresh([sourceId]); await f.sdk.myWork.wait(fresh.id!);
    const current = (await f.sdk.myWork.query()).entries[0]!;
    assert.equal(current.pull.ci?.target.headSha, "c".repeat(40)); assert.equal(current.pull.ciWatchId, undefined);
    assert.equal(current.associations[0]!.watch?.currentHead, false);
    assert.equal((await f.sdk.github.read(watch.id!)).ciObservation?.target.headSha, f.head);
    assert.equal(f.service.controller.snapshot().githubOperations.length, 1);
  } finally { await f.close(); }
});

test("profile-owned source/query/refresh/attention history never leaks into another immutable SDK view", { timeout: ciTime(30000) }, async () => {
  const f = await myWorkFixture(), profiles = await profileFixture(() => ({ github: { runProgram: f.githubProgram } }));
  try {
    const { client: beta } = await profiles.create("Generated inbox Beta");
    const project = await beta.projects.add(f.root);
    f.first.pulls[0]!.body = "GENERATED_BETA_ONLY_INBOX_BODY";
    const preview = await beta.myWork.previewSource({ env: "Local", projectId: project.id! });
    const source = await beta.myWork.configure(preview.preview, true), refresh = await beta.myWork.refresh(); await beta.myWork.wait(refresh.id!);
    assert.equal((await beta.myWork.query()).entries.length, 1);
    assert.equal((await profiles.sdk.myWork.query()).entries.length, 0);
    assert.equal((await profiles.sdk.myWork.status()).sources.length, 0);
    assert.equal(JSON.stringify(profiles.sdk.getState()).includes("GENERATED_BETA_ONLY_INBOX_BODY"), false);
    assert.ok(profiles.sdk.getState().events.every((event) => event.profile_id === "default"));
    await assert.rejects(profiles.sdk.myWork.read(refresh.id!), /unavailable.*profile/i);
    await assert.rejects(profiles.sdk.myWork.navigate(myWorkItemId(f.first.repository, 11), source.id!), /unavailable.*profile/i);
  } finally { await profiles.close(); await f.close(); }
});

test("known credentials are redacted from retained observations before restart/query publication", { timeout: ciTime(30000) }, async () => {
  const f = await myWorkFixture();
  try {
    f.first.pulls[0]!.body = "Generated ghp_123456789012345678901234 source";
    await f.configure(f.first); const start = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(start.id!);
    const read = JSON.stringify(await f.sdk.myWork.read(start.id!));
    assert.equal(read.includes("ghp_123456789012345678901234"), false); assert.ok(read.includes("[redacted]"));
  } finally { await f.close(); }
});

test("a replaced physical checkout is refused before any GitHub read and never falls back to a different root", { timeout: ciTime(30000) }, async () => {
  const f = await myWorkFixture();
  try {
    await f.configure(f.first); const first = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(first.id!);
    await rename(f.root, `${f.root}-displaced`); await mkdir(f.root);
    const reads = f.calls.length, next = await f.sdk.myWork.refresh(); await f.sdk.myWork.wait(next.id!);
    assert.equal(f.calls.length, reads);
    const inbox = await f.sdk.myWork.query();
    assert.equal(inbox.total, 1); assert.equal(inbox.entries[0]!.freshness, "stale");
    assert.match(inbox.sources[0]!.diagnostic!, /root|source|binding|checkout/i);
    assert.equal((await f.sdk.myWork.read(first.id!)).observations[0]!.source.binding.root.root, f.root);
  } finally { await f.close(); }
});

test("an active refresh with a missing original admission receipt cannot authorize a concurrent reader", { timeout: ciTime(30000) }, async () => {
  const gate = Promise.withResolvers<void>(); let reading = false;
  const f = await myWorkFixture({ beforeRead: async (_repo, path, signal) => {
    if (!path.includes("/pulls?")) return;
    reading = true; await gate.promise; signal.throwIfAborted();
  } });
  try {
    await f.configure(f.first); const first = await f.sdk.myWork.refresh(); await waitFor(() => reading);
    const original = (await f.sdk.myWork.read(first.id!, { metadataOnly: true })).refresh;
    f.service.controller.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run("default", original.commandId);
    await assert.rejects(f.sdk.myWork.refresh(), /no admission receipt/i);
    assert.equal(f.service.controller.snapshot().myWorkRefreshes.length, 1);
    assert.equal(f.calls.filter((call) => call.path.includes("/pulls?")).length, 1);
    gate.resolve(); await f.sdk.myWork.wait(first.id!);
  } finally { gate.resolve(); await f.close(); }
});

test("CI diagnostic outages preserve actual failure, complete review/thread evidence and original failure attention", { timeout: ciTime(30000) }, async () => {
  const f = await myWorkFixture({ beforeRead: async (_repo, path) => {
    if (/\/check-runs\/82$/.test(path)) throw new MoguriError("program_failed", "Generated HTTP 503 diagnostics unavailable.", 503);
  } });
  try {
    f.first.checks[0]!.conclusion = "failure"; await f.configure(f.first);
    const start = await f.sdk.myWork.refresh(); assert.equal((await f.sdk.myWork.wait(start.id!)).refresh.status, "partial");
    const entry = (await f.sdk.myWork.query()).entries[0]!;
    assert.equal(entry.pull.ci?.state, "failure"); assert.match(entry.pull.diagnostic!, /diagnostic inspection failed/);
    assert.equal(entry.pull.requests?.length, 1); assert.equal(entry.pull.threads?.length, 1);
    assert.ok(entry.categories.includes("failed-ci"));
    assert.equal(f.service.controller.snapshot().attention.filter((entry) => entry.reason === "my-work" && entry.active).length, 1);
  } finally { await f.close(); }
});

test("inspection or a source disable cannot raise old provider attention as a new notification", { timeout: ciTime(30000) }, async () => {
  let blockedRoot = "";
  const f = await myWorkFixture({ beforeRead: async (repo, path) => {
    if (repo.root === blockedRoot && path.includes("/pulls?")) throw new MoguriError("program_partial", "Generated second reader cleanup is unconfirmed.", 409);
  } });
  try {
    const a = await f.configure(f.first), b = await f.configure(f.second);
    const successful = a < b ? f.first : f.second, successfulId = a < b ? a : b;
    blockedRoot = a < b ? f.second.root : f.first.root; successful.checks[0]!.conclusion = "failure";
    const start = await f.sdk.myWork.refresh(), original = (await f.sdk.myWork.wait(start.id!)).refresh;
    assert.equal(original.status, "partial"); assert.equal(original.cleanupUnconfirmed, true);
    assert.equal(f.service.controller.snapshot().attention.filter((entry) => entry.reason === "my-work" && entry.active).length, 1);
    await f.sdk.myWork.toggle(successfulId, 0, false);
    assert.equal(f.service.controller.snapshot().attention.filter((entry) => entry.reason === "my-work" && entry.active).length, 0);
    await f.sdk.myWork.inspect(start.id!, original.revision, original.inputDigest, true);
    assert.equal(f.service.controller.snapshot().attention.filter((entry) => entry.reason === "my-work" && entry.active).length, 0);
  } finally { await f.close(); }
});

test("inspection retains one timestamp even when every clock read advances across a millisecond boundary", { timeout: ciTime(30000) }, async () => {
  let clock = Date.now(), fail = true;
  const f = await myWorkFixture({ now: () => clock++, beforeRead: async (_repo, path) => {
    if (fail && path.includes("/pulls?")) throw new MoguriError("program_partial", "Generated original reader cleanup is unconfirmed.", 409);
  } });
  try {
    await f.configure(f.first); const started = await f.sdk.myWork.refresh(), original = (await f.sdk.myWork.wait(started.id!)).refresh;
    assert.equal(original.status, "partial");
    await f.sdk.myWork.inspect(original.id, original.revision, original.inputDigest, true);
    const inspected = (await f.sdk.myWork.read(original.id)).refresh;
    assert.equal(inspected.inspection?.at, inspected.updatedAt);
    assert.equal(inspected.inspection?.observedRevision, original.revision);
    assert.equal(inspected.status, "partial"); assert.equal(inspected.cleanupUnconfirmed, true);
    fail = false;
    const independent = await f.sdk.myWork.refresh(); assert.equal((await f.sdk.myWork.wait(independent.id!)).refresh.status, "completed");
  } finally { await f.close(); }
});
