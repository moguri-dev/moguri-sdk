import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  parseDependencyUpdate, projectRoundupRun, roundupGroups, roundupPackageKey, roundupProblem, isRoundupAuthor, validateRoundupBots,
  type RoundupRun, type RoundupUpdate,
} from "../packages/protocol/src/index.ts";
import { roundupSummary, roundupsSlash } from "../packages/sdk/src/index.ts";
import { myWorkFixture, type GeneratedWorkPull, type GeneratedWorkRepository } from "./my-work-fixture.ts";
import { GeneratedIntakeClock } from "./fixtures/intake-clock.ts";
import { removeRoundupsPersonasFixtureMarkers } from "./fixtures/legacy-state.ts";
import { waitFor } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

const ghsa = "GHSA-2c3m-xw4q-v9wp";
const dependabot = (number: number, head: string, overrides: Partial<GeneratedWorkPull> = {}): GeneratedWorkPull => ({
  number, state: "open", merged: false, head, updatedAt: "2026-01-02T00:00:00Z", author: "dependabot[bot]",
  headRef: "dependabot/npm_and_yarn/lodash-4.17.21", labels: ["dependencies", "security"],
  title: "Bump lodash from 4.17.20 to 4.17.21",
  body: `Bumps [lodash](https://github.com/lodash/lodash) from 4.17.20 to 4.17.21.\n\nFixes [${ghsa}](https://github.com/advisories/${ghsa}).`,
  requests: [], threads: [], decision: null, ...overrides,
});
const renovate = (number: number, head: string): GeneratedWorkPull => ({
  number, state: "open", merged: false, head, updatedAt: "2026-01-02T00:00:00Z", author: "renovate[bot]", headRef: "renovate/major-eslint-monorepo",
  title: "chore(deps): update dependency eslint to v9",
  body: "| Package | Change | Age |\n|---|---|---|\n| [eslint](https://eslint.org) | [`8.57.0` -> `9.0.0`](https://renovatebot.com/diffs/npm/eslint/8.57.0/9.0.0) | x |\n",
  requests: [], threads: [], decision: null,
});

test("update PRs parse deterministically: Dependabot single and group, Renovate tables, provider security and a labelled heuristic", () => {
  const single = parseDependencyUpdate({ title: "build(deps): bump lodash from 4.17.20 to 4.17.21", author: "dependabot[bot]", head: "dependabot/npm_and_yarn/lodash-4.17.21",
    labels: [{ name: "security", color: null }], body: `Bumps [lodash](https://github.com/lodash/lodash) from 4.17.20 to 4.17.21. See CVE-2021-23337 and ${ghsa.toLowerCase()}.` });
  assert.equal(single.bot, "dependabot");
  assert.deepEqual(single.packages, [{ name: "lodash", ecosystem: "npm", from: "4.17.20", to: "4.17.21", updateType: "patch" }]);
  assert.deepEqual(single.security?.signals, ["label:security", "body:advisory-ids"]);
  assert.deepEqual(single.security?.advisories, [{ id: "CVE-2021-23337", url: null }, { id: ghsa, url: `https://github.com/advisories/${ghsa}` }]);
  assert.equal(single.breaking.likely, false);
  const group = parseDependencyUpdate({ title: "Bump the npm_and_yarn group across 1 directory with 2 updates", author: "dependabot[bot]", head: "dependabot/npm_and_yarn/npm_and_yarn-0a1b2c",
    labels: [], body: "Bumps the npm_and_yarn group with 2 updates.\n\nUpdates `axios` from 0.27.2 to 0.28.0\n\nUpdates `react` from 17.0.2 to 18.3.1\n" });
  assert.equal(group.group, "npm_and_yarn");
  assert.deepEqual(group.packages.map((entry) => [entry.name, entry.updateType]), [["axios", "minor"], ["react", "major"]]);
  assert.deepEqual(group.breaking.signals, ["zero-major-minor:axios", "major:react"]);
  assert.equal(group.security, null, "no advisory information is null, never a clean bill of health");
  const table = parseDependencyUpdate(renovate(1, "a".repeat(40)) as never);
  assert.equal(table.bot, "renovate");
  assert.deepEqual(table.packages, [{ name: "eslint", ecosystem: "npm", from: "8.57.0", to: "9.0.0", updateType: "major" }]);
  const action = parseDependencyUpdate({ title: "Update actions/checkout action to v4 [SECURITY]", author: "renovate[bot]", head: "renovate/actions-checkout-4.x", labels: [],
    body: "| Package | Type | Update | Change |\n|---|---|---|---|\n| [actions/checkout](https://redirect.github.com/actions/checkout) | action | major | `v3` -> `v4` |\n" });
  assert.deepEqual(action.packages, [{ name: "actions/checkout", ecosystem: "github-actions", from: "v3", to: "v4", updateType: "major" }]);
  assert.deepEqual(action.security?.signals, ["title:[SECURITY]"]);
  const unparsed = parseDependencyUpdate({ title: "Update all non-major dependencies", author: "renovate[bot]", head: "renovate/all-minor-patch", labels: [], body: "Generated text." });
  assert.deepEqual(unparsed.packages, []);
  assert.equal(isRoundupAuthor("Dependabot[bot]", ["dependabot[bot]"]), true);
  assert.equal(isRoundupAuthor("dependabot", ["dependabot[bot]"]), true, "GraphQL App logins omit [bot]");
  assert.equal(isRoundupAuthor("generated-human", ["dependabot[bot]"]), false);
  assert.throws(() => validateRoundupBots(["dependabot[bot]", "Dependabot[bot]"]), /distinct/);
  assert.throws(() => validateRoundupBots([]), /1 to 50/);
});

test("grouping keeps every PR identity, folds names only where the ecosystem does and keeps unparsed PRs visible", () => {
  const base = (itemId: string, packages: RoundupUpdate["packages"], extra: Partial<RoundupUpdate> = {}): RoundupUpdate => ({
    bot: "dependabot", group: null, packages, security: null, breaking: { likely: false, signals: [] }, itemId, repository: itemId.split("#")[0]!, number: 1,
    url: "https://github.com/generated-owner/a/pull/1", title: itemId, author: "dependabot[bot]", state: "open", draft: false, headSha: null,
    observedAt: "2026-01-01T00:00:00.000Z", freshness: "fresh", conflicting: false, ci: null, reviewDecision: null, unresolvedThreads: null, sources: [], ...extra });
  const pkg = (name: string, ecosystem: string | null, to = "2.0.0") => ({ name, ecosystem, from: "1.0.0", to, updateType: "major" as const });
  const groups = roundupGroups([
    base("generated-owner/a#1", [pkg("Requests", "pip")]), base("generated-owner/b#1", [pkg("requests", "pip", "2.1.0")], { security: { signals: ["label:security"], advisories: [] } }),
    base("generated-owner/a#2", [pkg("github.com/Generated/Mod", "go")]), base("generated-owner/b#2", [pkg("github.com/generated/mod", "go")]),
    base("generated-owner/c#3", [pkg("requests", null)]), base("generated-owner/c#4", [], { title: "Update all non-major dependencies" }),
  ]);
  const requests = groups.find((group) => group.key === "pip:requests")!;
  assert.deepEqual(requests.itemIds, ["generated-owner/a#1", "generated-owner/b#1", "generated-owner/c#3"], "an unknown-ecosystem update joins the one known group of that name");
  assert.equal(requests.security, true); assert.deepEqual(requests.versions, ["2.0.0", "2.1.0"]);
  assert.equal(groups.filter((group) => group.ecosystems.includes("go")).length, 2, "Go module paths stay case-sensitive");
  assert.equal(groups[0], requests, "reported security sorts first");
  assert.ok(groups.some((group) => group.key === "pr:generated-owner/c#4" && group.name === "Update all non-major dependencies"));
  assert.equal(roundupPackageKey("Django_REST.framework", "pip"), "django-rest-framework");
  assert.equal(roundupProblem({ enabled: true, freshness: "fresh", complete: true, failed: false }), null);
  assert.equal(roundupProblem({ enabled: false, freshness: "fresh", complete: true, failed: false }), "disabled");
  assert.equal(roundupProblem({ enabled: true, freshness: "partial", complete: false, failed: true }), "failed");
});

test("roundup runs keep their trigger, owned refresh and terminal outcome immutable", () => {
  const run: RoundupRun = { version: 1, id: "generated-run", revision: 0, profileId: "default", settingsRevision: 0, trigger: "manual", occurrenceAt: null, missed: 0,
    sourceIds: ["a".repeat(64)], refreshId: "generated-refresh", status: "running", summary: null, commandId: "generated-command",
    createdAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-01T00:00:00.000Z", diagnostic: null };
  assert.deepEqual(projectRoundupRun(undefined, run), run);
  assert.throws(() => projectRoundupRun(undefined, { ...run, status: "starting", refreshId: null }), /roundup/i, "a manual run is admitted with its refresh");
  const done = { ...run, revision: 1, status: "completed" as const, summary: { updates: 1, groups: 1, security: 0, likelyBreaking: 0, failingChecks: 0, closed: 0 } };
  assert.deepEqual(projectRoundupRun(run, done), done);
  assert.throws(() => projectRoundupRun(run, { ...done, refreshId: "generated-other-refresh" }), /roundup/i, "a run never adopts another refresh");
  assert.throws(() => projectRoundupRun(done, { ...done, revision: 2, status: "running" }), /roundup/i);
  assert.throws(() => projectRoundupRun(run, { ...run, revision: 1, status: "cancelled" }), /roundup/i, "a stopped run states what happened");
  assert.throws(() => removeRoundupsPersonasFixtureMarkers(new DatabaseSync(":memory:"), [{ event_type: "dependency_roundup.run_recorded" } as never]), /pre-119/);
});

const configureRoundup = async (f: Awaited<ReturnType<typeof myWorkFixture>>, repositories: GeneratedWorkRepository[], options: Parameters<typeof f.sdk.roundups.configure>[0] extends infer T ? Partial<T> : never = {}) => {
  const sourceIds: string[] = [];
  for (const repository of repositories) sourceIds.push(await f.configure(repository));
  await f.sdk.refresh();
  await f.sdk.roundups.configure({ sourceIds, ...options });
  await f.sdk.refresh();
  return sourceIds;
};

test("a roundup groups update-bot PRs across configured sources and accounts without duplicates, and reruns add none", { timeout: ciTime(60000) }, async () => {
  const f = await myWorkFixture();
  try {
    const alias = await f.addRepository("inbox-alias", f.first.account, f.first.accountId, false, f.first.repository);
    f.first.pulls.push(dependabot(21, f.head), renovate(22, f.head), { ...dependabot(23, f.head), author: "generated-update-bot[bot]", headRef: "generated/updates",
      title: "Update generated-widget to 3.0.0", body: "Generated update.", labels: [] });
    alias.pulls = structuredClone(f.first.pulls); alias.checks = structuredClone(f.first.checks);
    f.second.pulls = [dependabot(31, f.head, { title: "Bump lodash from 4.17.19 to 4.17.21", labels: ["dependencies"],
      body: "Bumps [lodash](https://github.com/lodash/lodash) from 4.17.19 to 4.17.21." })];
    await assert.rejects(f.sdk.roundups.refresh(), /Configure dependency roundups first/);
    await configureRoundup(f, [f.first, f.second, alias]);
    const writes = () => f.calls.filter((call) => call.method !== "GET" && call.path !== "graphql").length;
    const started = await f.sdk.roundups.refresh(), run = await f.sdk.roundups.wait(started.id!);
    assert.equal(run.status, "completed");
    assert.deepEqual(run.summary, { updates: 3, groups: 2, security: 1, likelyBreaking: 1, failingChecks: 0, closed: 0 });
    const refresh = f.service.controller.snapshot().myWorkRefreshes.find((value) => value.id === run.refreshId)!;
    assert.equal(refresh.actor, "user"); assert.equal(refresh.trigger, undefined);
    let roundup = await f.sdk.roundups.query();
    assert.equal(roundup.interpretation, "none"); assert.equal(roundup.complete, true);
    assert.deepEqual(roundup.updates.map((update) => `${update.repository}#${update.number}`).sort(),
      [`${f.first.repository}#21`, `${f.first.repository}#22`, `${f.second.repository}#31`]);
    const lodash = roundup.groups.find((group) => group.key === "npm:lodash")!;
    assert.equal(lodash.itemIds.length, 2); assert.deepEqual(lodash.repositories.sort(), [f.first.repository, f.second.repository].sort());
    const reported = roundup.updates.find((update) => update.number === 21)!;
    assert.equal(reported.sources.length, 2, "one PR observed through two sources keeps both associations");
    assert.deepEqual(reported.security?.advisories, [{ id: ghsa, url: `https://github.com/advisories/${ghsa}` }]);
    assert.equal(roundup.updates.find((update) => update.number === 31)!.security, null);
    assert.equal(roundup.updates.find((update) => update.number === 22)!.breaking.likely, true);
    assert.match(roundupSummary(roundup), /not a statement that a package is secure/);
    const again = await f.sdk.roundups.refresh();
    assert.equal((await f.sdk.roundups.wait(again.id!)).status, "completed");
    roundup = await f.sdk.roundups.query();
    assert.equal(roundup.updates.length, 3, "a rerun adds no duplicate entries");
    assert.equal(new Set(roundup.updates.map((update) => update.itemId)).size, 3);
    const current = f.sdk.roundups.settings()!;
    await f.sdk.roundups.configure({ sourceIds: current.sourceIds, bots: [...current.bots, "generated-update-bot[bot]"] });
    assert.equal((await f.sdk.roundups.query()).updates.length, 4, "the view derives from retained observations; no read was needed");
    f.second.pulls[0]!.state = "closed";
    const closed = await f.sdk.roundups.refresh(), closedRun = await f.sdk.roundups.wait(closed.id!);
    assert.equal(closedRun.summary?.closed, 1);
    assert.equal((await f.sdk.roundups.query()).updates.some((update) => update.number === 31), false);
    assert.equal((await f.sdk.roundups.query({ state: "all" })).updates.find((update) => update.number === 31)?.state, "closed");
    assert.equal((await f.sdk.roundups.query({ security: true })).updates.length, 1);
    assert.equal(writes(), 0, "a roundup never writes to GitHub");
    assert.equal(f.service.controller.snapshot().githubOperations.length, 0);
    assert.equal(f.service.controller.snapshot().sessions.length, 1, "no chat or follow-up starts without an explicit user action");
    const slash = await roundupsSlash(f.sdk, "", "cli");
    assert.ok(slash.kind === "text" && slash.text.includes("lodash"));
    assert.deepEqual(await roundupsSlash(f.sdk, "", "desktop"), { kind: "client-view", name: "dependency-roundup", argument: "{}" });
  } finally { await f.close(); }
});

test("rate limits, revoked access and disabled sources stay explicit and never become a clean roundup", { timeout: ciTime(60000) }, async () => {
  const f = await myWorkFixture();
  try {
    f.first.pulls.push(dependabot(21, f.head)); f.second.pulls = [dependabot(31, f.head)];
    const [first, second] = await configureRoundup(f, [f.first, f.second]);
    f.second.rateLimited = true;
    const limited = await f.sdk.roundups.wait((await f.sdk.roundups.refresh()).id!);
    assert.equal(limited.status, "partial"); assert.ok(limited.diagnostic);
    let roundup = await f.sdk.roundups.query();
    assert.equal(roundup.complete, false);
    const source = roundup.sources.find((value) => value.sourceId === second)!;
    assert.equal(source.problem, "failed"); assert.match(source.diagnostic!, /rate limit/i);
    assert.equal(roundup.sources.find((value) => value.sourceId === first)!.problem, null);
    assert.equal(roundup.updates.length, 1, "the readable source still reports its own updates");
    f.second.rateLimited = false; f.first.revoked = true;
    const revoked = await f.sdk.roundups.wait((await f.sdk.roundups.refresh()).id!);
    assert.notEqual(revoked.status, "completed");
    roundup = await f.sdk.roundups.query();
    assert.match(roundup.sources.find((value) => value.sourceId === first)!.diagnostic!, /403/);
    assert.equal(roundup.complete, false);
    await f.sdk.myWork.toggle(second!, f.service.controller.snapshot().myWorkSources.find((value) => value.id === second)!.revision, false);
    await f.sdk.refresh();
    roundup = await f.sdk.roundups.query();
    assert.equal(roundup.sources.find((value) => value.sourceId === second)!.problem, "disabled");
    await assert.rejects(f.sdk.roundups.refresh(), /enabled My Work sources/);
  } finally { await f.close(); }
});

test("a roundup never adopts another reader's refresh and owns only the refresh admitted with it", { timeout: ciTime(60000) }, async () => {
  const gate = Promise.withResolvers<void>(); let reading = 0;
  const f = await myWorkFixture({ beforeRead: async (_repo, path, signal) => {
    if (!path.includes("/pulls?")) return;
    reading++;
    await Promise.race([gate.promise, new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))]);
  } });
  try {
    f.first.pulls.push(dependabot(21, f.head));
    const [source] = await configureRoundup(f, [f.first]);
    const user = await f.sdk.myWork.refresh([source!]); await waitFor(() => reading === 1);
    await assert.rejects(f.sdk.roundups.refresh(), (error: unknown) => error instanceof Error && /already owns|already running/i.test(error.message));
    assert.equal(f.sdk.roundups.runs().length, 0, "the busy roundup recorded nothing and adopted no reader");
    gate.resolve(); await f.sdk.myWork.wait(user.id!);
    const started = await f.sdk.roundups.refresh(), run = await f.sdk.roundups.wait(started.id!);
    assert.equal(run.status, "completed", "once the other reader finished, the roundup owns its own new refresh");
    assert.notEqual(run.refreshId, user.id);
  } finally { gate.resolve(); await f.close(); }
});

test("stopping a running roundup records cancellation without claiming other operations stopped", { timeout: ciTime(60000) }, async () => {
  let reading = false;
  const f = await myWorkFixture({ beforeRead: async (_repo, path, signal) => {
    if (!path.includes("/pulls?")) return;
    reading = true;
    await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  } });
  try {
    f.first.pulls.push(dependabot(21, f.head));
    await configureRoundup(f, [f.first]);
    const started = await f.sdk.roundups.refresh(); await waitFor(() => reading);
    await f.sdk.roundups.cancel(started.id!);
    const run = await f.sdk.roundups.wait(started.id!);
    assert.equal(run.status, "cancelled");
    assert.match(run.diagnostic!, /Only this roundup's own GitHub readers were stopped/);
    assert.equal(f.service.controller.snapshot().myWorkRefreshes.find((value) => value.id === run.refreshId)?.status, "cancelled");
    await f.sdk.roundups.cancel(started.id!);
    assert.equal(f.sdk.roundups.runs().filter((value) => value.id === started.id).length, 1);
  } finally { await f.close(); }
});

test("scheduled roundups reuse #6 schedules, record schedule provenance and skip overlapping occurrences", { timeout: ciTime(60000) }, async () => {
  const clock = new GeneratedIntakeClock(); let hold = false; let release = Promise.withResolvers<void>(); let reading = 0;
  const f = await myWorkFixture({ intakeClock: clock, beforeRead: async (_repo, path) => {
    if (!path.includes("/pulls?")) return;
    reading++;
    if (hold) await release.promise;
  } });
  try {
    f.first.pulls.push(dependabot(21, f.head));
    await configureRoundup(f, [f.first], { schedule: { kind: "interval", minutes: 60, timeZone: "UTC" }, scheduleEnabled: true });
    const settings = f.sdk.roundups.settings()!;
    assert.equal(settings.status, "active"); assert.equal(settings.nextAt, "2030-01-01T11:00:00.000Z");
    clock.advanceBy(3_600_000);
    await waitFor(() => f.service.controller.snapshot().dependencyRoundupRuns[0]?.status === "completed");
    const scheduled = f.service.controller.snapshot().dependencyRoundupRuns[0]!;
    assert.equal(scheduled.trigger, "schedule"); assert.equal(scheduled.occurrenceAt, "2030-01-01T11:00:00.000Z");
    assert.equal(scheduled.commandId, settings.commandId, "the timer is not a user; the activation command authorizes it");
    const refresh = f.service.controller.snapshot().myWorkRefreshes.find((value) => value.id === scheduled.refreshId)!;
    assert.equal(refresh.actor, "schedule");
    assert.deepEqual(refresh.trigger, { kind: "dependency-roundup-schedule", runId: scheduled.id, settingsRevision: scheduled.settingsRevision,
      activationCommandId: settings.commandId, activationCommandDigest: settings.commandDigest });
    hold = true; release = Promise.withResolvers<void>(); const before = reading;
    clock.advanceBy(3_600_000);
    await waitFor(() => reading > before);
    clock.advanceBy(3_600_000);
    await waitFor(() => f.service.controller.snapshot().dependencyRoundupRuns.some((run) => run.status === "skipped"));
    const skipped = f.service.controller.snapshot().dependencyRoundupRuns.find((run) => run.status === "skipped")!;
    assert.equal(skipped.refreshId, null); assert.match(skipped.diagnostic!, /still running/);
    release.resolve(); hold = false;
    await waitFor(() => !f.service.controller.snapshot().dependencyRoundupRuns.some((run) => run.status === "running"));
    await f.sdk.refresh();
    await f.sdk.roundups.setSchedule(false); await f.sdk.refresh();
    assert.equal(f.sdk.roundups.settings()!.nextAt, null);
    const runs = f.service.controller.snapshot().dependencyRoundupRuns.length;
    clock.advanceBy(5 * 3_600_000); await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(f.service.controller.snapshot().dependencyRoundupRuns.length, runs, "a paused schedule starts nothing");
    await assert.rejects(f.sdk.roundups.configure({ sourceIds: ["f".repeat(64)] }), /enabled My Work sources/);
    const current = f.sdk.roundups.settings()!;
    const once = new Date(clock.now() + 3_600_000).toISOString();
    await f.sdk.roundups.configure({ sourceIds: current.sourceIds, schedule: { kind: "once", at: once, timeZone: "UTC",
      localTime: once.slice(0, 16), offsetMinutes: 0 }, scheduleEnabled: true });
    await f.sdk.refresh();
    clock.advanceBy(3_600_000);
    await waitFor(() => f.service.controller.snapshot().dependencyRoundupRuns[0]?.occurrenceAt === once &&
      f.service.controller.snapshot().dependencyRoundupRuns[0]?.status === "completed");
    await f.sdk.refresh();
    assert.deepEqual([f.sdk.roundups.settings()!.status, f.sdk.roundups.settings()!.nextAt], ["paused", null], "a fired one-time schedule turns itself off");
    const slash = await roundupsSlash(f.sdk, `configure ${current.sourceIds.join(",")} dependabot[bot]`, "cli");
    assert.equal(slash.kind, "ok", "later edits never re-activate a past one-time schedule");
  } finally { release.resolve(); await f.close(); }
});
