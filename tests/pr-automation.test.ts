import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  classifyCiFailure, defaultProjectSettings, defaultSettings, effectivePrAutomation, evaluateGithubStatus, followUpFacts, isRecord, lifecycleGuidance, MoguriError, MoguriSdk,
  prAutomationExceptions, projectPrAutomationRecord, withPrAutomationOverride, type CiRetryRecord, type EventInput, type LifecycleFacts, type PrActivity, type PrActivityCheck,
  type PrAutomationRecord, type ProviderStatusObservation, type Session, type Snapshot,
} from "../packages/sdk/src/index.ts";
import { conflictOutcome, PrAutomationRuntime, verifyConflictResolution, type CiJob, type CiRetryTransport } from "../apps/service/src/pr-automation.ts";
import { LifecycleFollowUps } from "../apps/service/src/session-wrap-up.ts";
import { startService } from "../apps/service/src/server.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { setupFixture, waitFor, type GeneratedProviderOptions } from "./fixture.ts";
import { generatedGit } from "./fixtures/git.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { removePrAutomationFixtureMarker } from "./fixtures/legacy-state.ts";
import { ciTime } from "./fixtures/time-scale.ts";

const PR = "https://github.com/generated/repo/pull/7", HEAD = "a".repeat(40), NEXT = "b".repeat(40);
const at = (value: number) => new Date(value).toISOString();
const START = Date.parse("2030-01-01T09:50:00.000Z"), DONE = Date.parse("2030-01-01T09:55:00.000Z");
const FLAKY = "2030-01-01T09:54:59.0000000Z curl: (22) The requested URL returned error: 503\n2030-01-01T09:55:00.0000000Z ##[error]Process completed with exit code 22.";

test("repository overrides win over global defaults, list as exceptions and restore inheritance independently", () => {
  const settings = { prAutomation: { ciRetry: true, conflictResolution: false } };
  let project = defaultProjectSettings();
  assert.deepEqual([effectivePrAutomation({}, project).ciRetry.value, effectivePrAutomation({}, project).conflictResolution.value], [false, false], "Both flags default off.");
  assert.deepEqual(effectivePrAutomation(settings, project).ciRetry, { flag: "ciRetry", value: true, source: "global", override: null, global: true });
  project = withPrAutomationOverride(project, "conflictResolution", "enabled");
  project = withPrAutomationOverride(project, "ciRetry", "disabled");
  const effective = effectivePrAutomation(settings, project);
  assert.deepEqual([effective.ciRetry.value, effective.ciRetry.source, effective.conflictResolution.value, effective.conflictResolution.source], [false, "repository", true, "repository"]);
  const configurations = [{ projectId: "generated-a", values: project }, { projectId: "generated-b", values: defaultProjectSettings() }];
  assert.deepEqual(prAutomationExceptions(settings, configurations).map((value) => [value.projectId, value.flag, value.override, value.value, value.global]),
    [["generated-a", "ciRetry", "disabled", false, true], ["generated-a", "conflictResolution", "enabled", true, false]]);
  assert.deepEqual(prAutomationExceptions({}, configurations).map((value) => value.global), [false, false], "Changing the global default keeps each override.");
  project = withPrAutomationOverride(project, "ciRetry", "inherit");
  assert.equal(Object.hasOwn(project.repo, "ciRetry"), false);
  assert.deepEqual(prAutomationExceptions(settings, [{ projectId: "generated-a", values: project }]).map((value) => value.flag), ["conflictResolution"]);
  assert.deepEqual(prAutomationExceptions(settings, configurations, new Set(["generated-b"])), [], "Removed repositories are not listed.");
});

test("job logs separate transient 5xx and network failures from deterministic and unclear ones", () => {
  for (const log of [FLAKY, "npm error code E503\nnpm error 503 Service Unavailable - GET https://registry.npmjs.org/generated", "Error: Request failed with status code 502",
    "Error: read ECONNRESET\n    at TLSWrap.onStreamRead", "##[error]The runner has received a shutdown signal."]) {
    assert.equal(classifyCiFailure(log).kind, "transient", log);
  }
  const flaky = classifyCiFailure(FLAKY);
  assert.match(flaky.reason, /HTTP 5xx/); assert.deepEqual(flaky.evidence, ["curl: (22) The requested URL returned error: 503"], "Evidence drops the log timestamp.");
  for (const log of ["AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n\n503 !== 200", "src/app.ts(4,7): error TS2322: Type 'string' is not assignable to type 'number'.",
    "✖ 3 problems (3 errors, 0 warnings)", "Error: Cannot find module './generated-missing'"]) {
    assert.equal(classifyCiFailure(log).kind, "deterministic", log);
  }
  assert.equal(classifyCiFailure("1 failing\nProcess completed with exit code 1").kind, "unclear");
  const jest = ["    expect(received).toBe(expected) // Object.is equality", "    Expected: 2", "    Received: 1", "    connect ECONNREFUSED 127.0.0.1:5432"]
    .map((line) => `2030-01-01T09:54:59.1234567Z ${line}`).join("\n");
  assert.equal(classifyCiFailure(jest).kind, "deterministic", "Timestamped Jest assertion lines still count as deterministic evidence.");
  assert.match(classifyCiFailure("", { complete: false }).reason, /unavailable or incomplete/);
  assert.equal(classifyCiFailure("1 failing", { providerIncident: "\"Generated Actions incident\" (resolved)" }).kind, "transient");
  assert.equal(classifyCiFailure("AssertionError: generated", { providerIncident: "\"Generated Actions incident\"" }).kind, "deterministic", "An incident never excuses a real assertion.");
});

const components = (overrides: Record<string, string> = {}) => ["Git Operations", "API Requests", "Actions", "Copilot"].map((name) => ({ name, status: overrides[name] ?? "operational" }));
const incident = (values: Record<string, unknown> = {}) => ({ id: "generatedinc1", name: "Generated delays for Actions", status: "investigating", impact: "major",
  shortlink: "https://stspg.io/generated", created_at: at(START - 60_000), started_at: at(START - 60_000), resolved_at: null, components: [{ name: "Actions" }], ...values });
const observation = (values: Partial<{ components: unknown[]; active: unknown[]; recent: unknown[]; age: number | null; date: string | null; at: number }> = {}): ProviderStatusObservation => ({
  summary: { components: values.components ?? components(), incidents: values.active ?? [] }, incidents: { incidents: values.recent ?? [] },
  observedAt: at(values.at ?? DONE), ageSeconds: values.age === undefined ? 4 : values.age, date: values.date ?? null,
});

test("GitHub Status: healthy, down, active incident, recovered, unreachable and stale are distinguished; only healthy admits", () => {
  const now = DONE + 120_000, window = { startedAt: at(START), completedAt: at(DONE) };
  assert.equal(evaluateGithubStatus(observation(), now, window).health.state, "operational");
  const down = evaluateGithubStatus(observation({ components: components({ Actions: "major_outage" }) }), now, window).health;
  assert.equal(down.state, "disrupted"); assert.match(down.diagnostic!, /Actions is major outage/);
  const active = evaluateGithubStatus(observation({ active: [incident()] }), now, window).health;
  assert.equal(active.state, "disrupted"); assert.equal(active.incidents[0]?.url, "https://stspg.io/generated"); assert.equal(active.incidents[0]?.components[0], "Actions");
  assert.equal(evaluateGithubStatus(observation({ active: [incident({ components: [{ name: "Copilot" }], name: "Generated Copilot delays" })] }), now, window).health.state, "operational",
    "An unrelated component's incident doesn't pause CI.");
  const recovered = evaluateGithubStatus(observation({ recent: [incident({ status: "resolved", resolved_at: at(DONE + 30_000) })] }), now, window);
  assert.equal(recovered.health.state, "operational"); assert.equal(recovered.overlapping[0]?.name, "Generated delays for Actions");
  assert.deepEqual(evaluateGithubStatus(observation({ recent: [incident({ started_at: at(START - 7_200_000), resolved_at: at(START - 3_600_000) })] }), now, window).overlapping, [],
    "An incident resolved long before the job doesn't explain it.");
  const unreachable = evaluateGithubStatus({ error: "Generated network failure", observedAt: at(now) }, now, window).health;
  assert.equal(unreachable.state, "unknown"); assert.match(unreachable.diagnostic!, /Generated network failure/);
  assert.equal(evaluateGithubStatus(observation({ age: 900 }), now, window).health.state, "unknown");
  assert.match(evaluateGithubStatus(observation({ age: null, date: new Date(now - 3_600_000).toUTCString() }), now, window).health.diagnostic!, /stale/);
  assert.equal(evaluateGithubStatus(observation({ components: [{ name: "Copilot", status: "operational" }] }), now, window).health.state, "unknown", "A missing Actions component is not health.");
});

test("conflict follow-ups bind the reported base once per head, independent of review/CI follow-ups; owned checks never reach the model", () => {
  const base: LifecycleFacts = { version: 1, trigger: "round", sourceTurnId: "generated-turn", workspace: "managed-worktree", edits: 1, pullRequests: "draft",
    pr: { url: PR, number: 7, state: "open", headSha: null }, ci: null, reviews: null, skills: [], parent: false, automation: { ciRetry: true, conflictResolution: true } };
  const activity: PrActivity = { headSha: HEAD, headRef: "moguri/generated", state: "open", author: "generated-author", reviews: [], mergeable: false, mergeableState: "dirty",
    baseRef: "main", baseSha: NEXT, checks: [{ name: "integration", status: "completed", conclusion: "failure" }, { name: "lint", status: "completed", conclusion: "failure" }] };
  const conflicts = followUpFacts({ base, earlier: [base], activity, lastFinishedAt: 0, followUps: false, conflicts: { id: "generated-conflict" } });
  assert.deepEqual(conflicts?.conflicts, { id: "generated-conflict", headSha: HEAD, headRef: "moguri/generated", baseRef: "main", baseSha: NEXT });
  assert.equal(followUpFacts({ base, earlier: [base, conflicts!], activity, lastFinishedAt: 0, followUps: false, conflicts: { id: "generated-other" } }), null, "Once per head, and review/CI stay off.");
  assert.equal(followUpFacts({ base, earlier: [base], activity, lastFinishedAt: 0, conflicts: null })?.trigger, "ci", "Without the flag a conflict is left alone.");
  const ci = followUpFacts({ base, earlier: [base], activity: { ...activity, mergeable: true, mergeableState: "clean" }, lastFinishedAt: 0, ciOwned: new Set(["integration"]) });
  assert.deepEqual(ci?.ci?.failing, ["lint"]);
  assert.equal(followUpFacts({ base, earlier: [base], activity: { ...activity, mergeable: true }, lastFinishedAt: 0, ciOwned: new Set(["integration", "lint"]) }), null);
  const twins = { ...activity, mergeable: true, checks: [{ name: "test", status: "completed", conclusion: "failure", id: 11 }, { name: "test", status: "completed", conclusion: "failure", id: 12 }] };
  assert.deepEqual(followUpFacts({ base, earlier: [base], activity: twins, lastFinishedAt: 0, ciOwned: new Set([11]) })?.ci?.failing, ["test"],
    "Owning one job never hides a same-named job from another workflow.");
  const guidance = lifecycleGuidance(conflicts!);
  for (const rule of [/git merge --no-ff --no-commit/, /keeps both/, /git merge --abort/, /Never rebase, force-push/, /run the relevant tests/, /Never stash, reset/]) assert.match(guidance, rule);
  assert.match(lifecycleGuidance(base), /following this protocol/); assert.match(lifecycleGuidance(base), /never rerun jobs yourself/);
  const plain = lifecycleGuidance({ ...base, automation: undefined });
  assert.match(plain, /resolve the conflicts first and keep both sides' intent/); assert.doesNotMatch(plain, /git merge --abort|never rerun jobs yourself/);
});

test("durable records keep their binding, attempts and terminal outcome", () => {
  const event = { profile_id: "generated-profile", project_id: "generated-project", session_id: "generated-session" };
  const value: CiRetryRecord = { version: 1, kind: "ci-retry", id: "generated-record", profileId: "generated-profile", sessionId: "generated-session", projectId: "generated-project",
    revision: 0, createdAt: at(DONE), updatedAt: at(DONE), binding: { repository: "generated/repo", number: 7, url: PR, headSha: HEAD, headRef: "moguri/generated", account: { login: "generated-user", id: 7 } },
    check: { name: "integration", jobId: 101, runId: 900, url: null, startedAt: at(START), completedAt: at(DONE) }, status: "scheduled", classification: null, health: null,
    notBefore: null, attempts: [], cancellation: null, diagnostic: null };
  const first = projectPrAutomationRecord(undefined, value, event);
  assert.throws(() => projectPrAutomationRecord(first, { ...value, revision: 1, binding: { ...value.binding, headSha: NEXT } }, event), /pr_automation|binding/i);
  assert.throws(() => projectPrAutomationRecord(first, { ...value, revision: 2 }, event));
  assert.throws(() => projectPrAutomationRecord(undefined, value, { ...event, session_id: "generated-other" }));
  const cancelled = projectPrAutomationRecord(first, { ...value, revision: 1, status: "cancelled" }, event);
  assert.throws(() => projectPrAutomationRecord(cancelled, { ...value, revision: 2, status: "scheduled" }, event), MoguriError);
});

interface Harness {
  runtime: PrAutomationRuntime; records: () => CiRetryRecord[]; reruns: number[]; logs: Map<number, string>; jobs: Map<number, CiJob>;
  status: { value: ProviderStatusObservation | Error; calls: number }; clock: { now: number }; account: { login: string; id: number };
  settings: ReturnType<typeof defaultSettings>; hold: { rerun: boolean }; ci: (activity: PrActivity) => Promise<Set<number | string>>; session: Session;
  host: ConstructorParameters<typeof PrAutomationRuntime>[0]; transport: CiRetryTransport; store: Map<string, PrAutomationRecord>;
}
function harness(): Harness {
  const store = new Map<string, PrAutomationRecord>(), reruns: number[] = [], logs = new Map<number, string>(), jobs = new Map<number, CiJob>();
  const clock = { now: DONE + 120_000 }, account = { login: "generated-user", id: 7 }, hold = { rerun: false };
  const status: Harness["status"] = { value: observation(), calls: 0 };
  const settings = { ...defaultSettings(), prAutomation: { ciRetry: true, conflictResolution: false } };
  const project = defaultProjectSettings(); project.repo.githubAccess = "gh-cli";
  const session = { id: "generated-session", projectId: "generated-project", controls: { env: "Local" }, mode: "default", status: "completed" } as unknown as Session;
  const snapshot = () => ({ profileId: "generated-profile", settings: { values: settings }, policy: { revision: 0, allowedEnvs: ["Local"] }, sessions: [session],
    projectConfigurations: [{ projectId: "generated-project", revision: 1, folderId: null, color: "#000000", order: 0, values: project }], prAutomation: [...store.values()] }) as unknown as Snapshot;
  const host = { snapshot, events: () => [], root: () => "/generated/root", now: () => clock.now,
    commit: (events: EventInput[]) => { for (const event of events) if (event.event_type === "pr_automation.recorded") store.set(event.payload.record.id, projectPrAutomationRecord(store.get(event.payload.record.id), event.payload.record, event)); } };
  const transport: CiRetryTransport = {
    account: async () => ({ ...account }),
    job: async (_repository, id) => { const job = jobs.get(id); if (!job) throw new MoguriError("generated_job", "Generated job missing."); return job; },
    log: async (_repository, id) => ({ text: logs.get(id) ?? "", complete: true }),
    rerun: async (_repository, id, _root, signal) => {
      reruns.push(id);
      if (hold.rerun) await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new MoguriError("program_partial", "Generated abort.")), { once: true }));
    },
    status: async () => { status.calls++; if (status.value instanceof Error) throw status.value; return { ...status.value, observedAt: at(clock.now) }; },
  };
  const runtime = new PrAutomationRuntime(host, transport);
  const records = () => [...store.values()].filter((value): value is CiRetryRecord => value.kind === "ci-retry");
  const ci = async (activity: PrActivity) => (await runtime.ci({ session, url: PR, root: "/generated/root", activity, signal: AbortSignal.timeout(10_000) })).owned;
  return { runtime, records, reruns, logs, jobs, status, clock, account, settings, hold, ci, session, host, transport, store };
}
const job = (id: number, values: Partial<CiJob> = {}): CiJob => ({ id, runId: 900, name: "integration", headSha: HEAD, status: "completed", conclusion: "failure",
  startedAt: at(START), completedAt: at(DONE), url: null, ...values });
const check = (id: number, values: Partial<PrActivityCheck> = {}): PrActivityCheck => ({ name: "integration", status: "completed", conclusion: "failure", id, runId: 900, app: "github-actions",
  url: null, startedAt: at(START), completedAt: at(DONE), ...values });
const pr = (checks: PrActivityCheck[], headSha = HEAD): PrActivity => ({ headSha, headRef: "moguri/generated", state: "open", author: "generated-author", reviews: [], checks });

test("a flaky HTTP 5xx job is rerun once per attempt after a fresh health check, and only the actual result counts", async () => {
  const h = harness();
  h.jobs.set(101, job(101)); h.logs.set(101, FLAKY);
  assert.deepEqual([...await h.ci(pr([check(101)]))], [101]);
  assert.deepEqual(h.reruns, [101]);
  let value = h.records()[0]!;
  assert.equal(value.status, "requested"); assert.equal(value.attempts[0]?.status, "requested"); assert.equal(value.classification?.kind, "transient");
  assert.equal(value.health?.state, "operational"); assert.equal(value.binding.account.login, "generated-user");
  await h.ci(pr([check(101)]));
  assert.deepEqual(h.reruns, [101], "Waiting for GitHub to show the new attempt never requests it again.");
  assert.deepEqual([...await h.ci(pr([check(102, { status: "in_progress", conclusion: null })]))], [102]);
  await h.ci(pr([check(102, { conclusion: "success", completedAt: at(DONE + 300_000) })]));
  value = h.records()[0]!;
  assert.equal(value.status, "succeeded"); assert.deepEqual([value.attempts[0]?.result, value.attempts[0]?.resultJobId], ["success", 102]);
  assert.deepEqual(h.reruns, [101]);
});

test("same-named jobs from different workflow runs are separate checks, and long names keep the attempt bound", async () => {
  const h = harness();
  h.jobs.set(1101, job(1101, { name: "test" })); h.logs.set(1101, FLAKY);
  h.jobs.set(1201, job(1201, { name: "test", runId: 901 })); h.logs.set(1201, "AssertionError: expected 1 to equal 2");
  const twins = (first: Partial<PrActivityCheck> = {}) => pr([check(1101, { name: "test", ...first }), check(1201, { name: "test", runId: 901 })]);
  assert.deepEqual([...await h.ci(twins())], [1101]);
  assert.deepEqual(h.records().map((value) => [value.check.jobId, value.status]).sort(), [[1101, "requested"], [1201, "ineligible"]]);
  await h.ci(pr([check(1102, { name: "test", conclusion: "success" }), check(1201, { name: "test", runId: 901 })]));
  assert.deepEqual(h.records().map((value) => [value.check.jobId, value.status, value.attempts[0]?.resultJobId ?? null]).sort(),
    [[1101, "succeeded", 1102], [1201, "ineligible", null]], "The other workflow's job is never taken as the rerun result.");
  const owned = await h.ci(pr([check(1102, { name: "test", conclusion: "success" }), check(1201, { name: "test", runId: 901 })]));
  assert.deepEqual([...owned], [1102]);
  assert.deepEqual(followUpFacts({ base: { version: 1, trigger: "round", sourceTurnId: "generated-turn", workspace: "managed-worktree", edits: 1, pullRequests: "draft", pr: null,
    ci: null, reviews: null, skills: [], parent: false }, earlier: [], lastFinishedAt: 0, ciOwned: owned,
  activity: pr([check(1102, { name: "test", conclusion: "success" }), check(1201, { name: "test", runId: 901 })]) })?.ci?.failing, ["test"]);
  assert.deepEqual(h.reruns, [1101]);

  const long = harness(), name = `matrix / ${"generated-axis ".repeat(20)}`.trim();
  long.clock.now = DONE + 30_000; long.jobs.set(1301, job(1301, { name })); long.logs.set(1301, FLAKY);
  for (let poll = 0; poll < 4; poll++) { long.clock.now += 61_000; await long.ci(pr([check(1301, { name })])); }
  assert.equal(long.records().length, 1); assert.ok(long.records()[0]!.check.name.length <= 255);
  assert.deepEqual(long.reruns, [1301], "A long check name still maps to one record and one rerun.");
});

test("deterministic, unclear and non-Actions failures are not retried and stay with the model and user", async () => {
  const h = harness();
  h.jobs.set(201, job(201)); h.logs.set(201, "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n\n503 !== 200");
  h.jobs.set(202, job(202, { name: "lint" })); h.logs.set(202, "1 failing");
  const owned = await h.ci(pr([check(201), check(202, { name: "lint" }), { name: "generated/external", status: "completed", conclusion: "failure", app: "generated-ci", url: null }]));
  assert.equal(owned.size, 0); assert.deepEqual(h.reruns, []);
  assert.deepEqual(h.records().map((value) => [value.check.name, value.status, value.classification?.kind ?? null]).sort(),
    [["generated/external", "ineligible", null], ["integration", "ineligible", "deterministic"], ["lint", "ineligible", "unclear"]]);
  assert.match(h.records().find((value) => value.check.name === "generated/external")!.diagnostic!, /isn't a GitHub Actions job/);
  const events = h.store.size;
  await h.ci(pr([check(201), check(202, { name: "lint" })]));
  assert.equal(h.store.size, events); assert.ok(h.records().every((value) => value.revision === 0), "Unchanged evaluations append no history.");
});

test("provider outages and active incidents pause retries without blaming the change; recovery needs a fresh check", async () => {
  const h = harness();
  h.jobs.set(301, job(301)); h.logs.set(301, "1 failing");
  h.status.value = observation({ components: components({ Actions: "partial_outage" }), active: [incident()] });
  assert.deepEqual([...await h.ci(pr([check(301)]))], [301], "A paused check isn't handed to the model as a code failure.");
  let value = h.records()[0]!;
  assert.equal(value.status, "deferred"); assert.equal(value.classification, null, "The log isn't judged during an outage.");
  assert.equal(value.health?.incidents[0]?.url, "https://stspg.io/generated"); assert.match(value.diagnostic!, /isn't blamed on the change/);
  assert.deepEqual(h.reruns, []);
  const calls = h.status.calls;
  await h.ci(pr([check(301)]));
  assert.equal(h.status.calls, calls, "Health observations are reused for up to a minute.");
  h.status.value = observation({ recent: [incident({ status: "resolved", resolved_at: at(DONE + 60_000) })] });
  h.clock.now += 61_000;
  await h.ci(pr([check(301)]));
  value = h.records()[0]!;
  assert.equal(h.status.calls, calls + 1); assert.equal(value.status, "requested"); assert.match(value.classification!.reason, /incident overlapped/);
  assert.deepEqual(h.reruns, [301]);
});

test("unreachable or stale status data is unknown: retries pause until a fresh healthy observation", async () => {
  const h = harness();
  h.jobs.set(401, job(401)); h.logs.set(401, FLAKY);
  h.status.value = new MoguriError("provider_status_http", "GitHub Status returned HTTP 503.");
  await h.ci(pr([check(401)]));
  assert.equal(h.records()[0]?.status, "deferred"); assert.match(h.records()[0]!.diagnostic!, /couldn't be reached/); assert.deepEqual(h.reruns, []);
  h.status.value = observation({ age: 900 }); h.clock.now += 61_000;
  await h.ci(pr([check(401)]));
  assert.equal(h.records()[0]?.status, "deferred"); assert.match(h.records()[0]!.diagnostic!, /stale/); assert.deepEqual(h.reruns, []);
  h.status.value = observation(); h.clock.now += 61_000;
  await h.ci(pr([check(401)]));
  assert.equal(h.records()[0]?.status, "requested"); assert.deepEqual(h.reruns, [401]);
});

test("attempts are bounded with backoff, and a changed head or account supersedes the retry", async () => {
  const h = harness();
  h.clock.now = DONE + 30_000;
  h.jobs.set(501, job(501)); h.logs.set(501, FLAKY);
  await h.ci(pr([check(501)]));
  assert.equal(h.records()[0]?.status, "scheduled"); assert.equal(h.records()[0]?.notBefore, at(DONE + 60_000)); assert.deepEqual(h.reruns, []);
  h.clock.now = DONE + 61_000;
  await h.ci(pr([check(501)]));
  assert.deepEqual(h.reruns, [501]);
  h.jobs.set(502, job(502, { completedAt: at(DONE + 200_000) })); h.logs.set(502, FLAKY);
  h.clock.now = DONE + 210_000;
  await h.ci(pr([check(502, { completedAt: at(DONE + 200_000) })]));
  assert.equal(h.records()[0]?.status, "scheduled"); assert.equal(h.records()[0]?.notBefore, at(DONE + 500_000), "The second attempt waits five minutes.");
  h.clock.now = DONE + 501_000;
  await h.ci(pr([check(502, { completedAt: at(DONE + 200_000) })]));
  assert.deepEqual(h.reruns, [501, 502]);
  await h.ci(pr([check(503, { completedAt: at(DONE + 700_000) })]));
  assert.equal(h.records()[0]?.status, "exhausted"); assert.deepEqual(h.records()[0]!.attempts.map((attempt) => attempt.result), ["failure", "failure"]);
  assert.deepEqual(h.reruns, [501, 502]);

  const moved = harness();
  moved.clock.now = DONE + 30_000; moved.jobs.set(601, job(601)); moved.logs.set(601, FLAKY);
  await moved.ci(pr([check(601)]));
  await moved.ci(pr([check(602, { status: "in_progress", conclusion: null })], NEXT));
  assert.equal(moved.records()[0]?.status, "superseded"); assert.deepEqual(moved.reruns, []);

  const switched = harness();
  switched.clock.now = DONE + 30_000; switched.jobs.set(701, job(701)); switched.logs.set(701, FLAKY);
  await switched.ci(pr([check(701)]));
  switched.account.login = "generated-other"; switched.clock.now = DONE + 61_000;
  await switched.ci(pr([check(701)]));
  assert.equal(switched.records()[0]?.status, "superseded"); assert.match(switched.records()[0]!.diagnostic!, /account changed/); assert.deepEqual(switched.reruns, []);
});

test("cancellation stops pending and in-flight retries; turning the flag off cancels the rest", async () => {
  const h = harness();
  h.clock.now = DONE + 30_000; h.jobs.set(801, job(801)); h.logs.set(801, FLAKY);
  await h.ci(pr([check(801)]));
  const finish = (events: EventInput[], result = {}) => { h.host.commit(events); return result; };
  await h.runtime.cancel({ type: "pr_automation.cancel", recordId: h.records()[0]!.id, expectedRevision: h.records()[0]!.revision }, finish as never);
  assert.equal(h.records()[0]?.status, "cancelled"); assert.equal(h.records()[0]?.cancellation?.actor, "user");
  h.clock.now = DONE + 61_000;
  await h.ci(pr([check(801)]));
  assert.deepEqual(h.reruns, []);

  const flight = harness();
  flight.hold.rerun = true; flight.jobs.set(811, job(811)); flight.logs.set(811, FLAKY);
  const pending = flight.ci(pr([check(811)]));
  await waitFor(() => flight.reruns.length === 1);
  await flight.runtime.cancel({ type: "pr_automation.cancel", recordId: flight.records()[0]!.id, expectedRevision: 0 }, ((events: EventInput[], result = {}) => { flight.host.commit(events); return result; }) as never);
  await pending;
  assert.equal(flight.records()[0]?.status, "cancelled"); assert.equal(flight.records()[0]?.attempts[0]?.status, "unconfirmed");

  const off = harness();
  off.clock.now = DONE + 30_000; off.jobs.set(821, job(821)); off.logs.set(821, FLAKY);
  await off.ci(pr([check(821)]));
  off.settings.prAutomation = { ciRetry: false, conflictResolution: false };
  assert.equal((await off.ci(pr([check(821)]))).size, 0);
  assert.equal(off.records()[0]?.status, "cancelled"); assert.equal(off.records()[0]?.cancellation?.actor, "settings");
});

test("a restart during a rerun request reports it unconfirmed and never replays it", async () => {
  const h = harness();
  h.hold.rerun = true; h.jobs.set(901, job(901)); h.logs.set(901, FLAKY);
  const pending = h.ci(pr([check(901)]));
  await waitFor(() => h.reruns.length === 1);
  assert.equal(h.records()[0]?.attempts[0]?.status, "admitted", "Intent is retained before GitHub is called.");
  h.runtime.close(); await pending.catch(() => {});
  assert.equal(h.records()[0]?.attempts[0]?.status, "admitted", "A closing service records nothing it can't confirm.");
  const restarted = new PrAutomationRuntime(h.host, h.transport);
  restarted.reconcile();
  assert.equal(h.records()[0]?.status, "unconfirmed"); assert.equal(h.records()[0]?.attempts[0]?.status, "unconfirmed");
  const ci = async (activity: PrActivity) => (await restarted.ci({ session: h.session, url: PR, root: "/generated/root", activity, signal: AbortSignal.timeout(10_000) })).owned;
  assert.equal((await ci(pr([check(901)]))).size, 0);
  assert.deepEqual(h.reruns, [901], "No second request for the same attempt.");
  await ci(pr([check(902, { conclusion: "success" })]));
  assert.equal(h.records()[0]?.status, "succeeded"); assert.match(h.records()[0]!.attempts[0]!.diagnostic!, /lost track/);
});

async function conflictRepository() {
  const root = await mkdtemp(join(tmpdir(), "moguri-generated-conflict-"));
  const git = (...args: string[]) => generatedGit(root, ...args);
  const features = (...names: string[]) => `export const features = ${JSON.stringify(names)};\n`;
  await git("init", "--initial-branch=main"); await git("config", "user.name", "Generated Fixture"); await git("config", "user.email", "generated@example.invalid");
  await writeFile(join(root, "features.mjs"), features("base"));
  await writeFile(join(root, "notes.txt"), "generated notes\n");
  await git("add", "."); await git("commit", "--no-gpg-sign", "-m", "Generated base");
  await git("switch", "-c", "moguri/generated");
  await writeFile(join(root, "features.mjs"), features("base", "alpha"));
  await writeFile(join(root, "alpha.test.mjs"), "import assert from 'node:assert';\nimport { features } from './features.mjs';\nassert.ok(features.includes('alpha'));\n");
  await git("add", "."); await git("commit", "--no-gpg-sign", "-m", "Generated alpha feature");
  const head = await git("rev-parse", "HEAD");
  await git("switch", "main");
  await writeFile(join(root, "features.mjs"), features("base", "beta"));
  await writeFile(join(root, "beta.test.mjs"), "import assert from 'node:assert';\nimport { features } from './features.mjs';\nassert.ok(features.includes('beta'));\n");
  await git("add", "."); await git("commit", "--no-gpg-sign", "-m", "Generated beta feature");
  const base = await git("rev-parse", "HEAD");
  await git("switch", "moguri/generated");
  const merge = async (...args: string[]) => { try { await git("merge", "--no-ff", "--no-edit", ...args, "main"); } catch { /* Generated conflict expected. */ } };
  return { root, git, head, base, features, merge, close: () => rm(root, { recursive: true, force: true }) };
}
const passes = async (root: string, file: string) => { try { await import(`${pathToFileURL(join(root, file)).href}?${Math.random()}`); return true; } catch { return false; } };

test("conflict verification accepts only merges that keep both features, and pauses without losing either side", { timeout: ciTime(60_000) }, async () => {
  const both = await conflictRepository();
  try {
    await both.merge();
    await writeFile(join(both.root, "features.mjs"), both.features("base", "alpha", "beta"));
    await both.git("add", "features.mjs"); await both.git("commit", "--no-gpg-sign", "--no-edit");
    assert.ok(await passes(both.root, "alpha.test.mjs") && await passes(both.root, "beta.test.mjs"), "Both features' generated tests pass.");
    const verification = await verifyConflictResolution(both.root, { headSha: both.head, baseSha: both.base }, AbortSignal.timeout(20_000));
    assert.deepEqual(verification.conflicted, ["features.mjs"]); assert.deepEqual([verification.containsHead, verification.containsBase], [true, true]);
    assert.equal(conflictOutcome(verification, { headSha: both.head }, "completed").status, "merged");
  } finally { await both.close(); }

  const picked = await conflictRepository();
  try {
    await picked.merge("-X", "ours");
    const verification = await verifyConflictResolution(picked.root, { headSha: picked.head, baseSha: picked.base }, AbortSignal.timeout(20_000));
    assert.deepEqual(verification.discarded, ["features.mjs"]);
    const outcome = conflictOutcome(verification, { headSha: picked.head }, "completed");
    assert.equal(outcome.status, "needs-review"); assert.match(outcome.diagnostic, /dropped/);
    assert.equal(await passes(picked.root, "beta.test.mjs"), false, "Choosing a side really lost the base feature.");
  } finally { await picked.close(); }

  const markers = await conflictRepository();
  try {
    await markers.merge();
    await markers.git("add", "features.mjs"); await markers.git("commit", "--no-gpg-sign", "--no-edit");
    const verification = await verifyConflictResolution(markers.root, { headSha: markers.head, baseSha: markers.base }, AbortSignal.timeout(20_000));
    assert.deepEqual(verification.markers, ["features.mjs"]); assert.equal(conflictOutcome(verification, { headSha: markers.head }, "completed").status, "needs-review");
  } finally { await markers.close(); }

  const pending = await conflictRepository();
  try {
    const notes = join(pending.root, "notes.txt");
    await writeFile(notes, "generated unrelated edit\n");
    await pending.merge();
    const index = await pending.git("ls-files", "--stage");
    const progress = await verifyConflictResolution(pending.root, { headSha: pending.head, baseSha: pending.base }, AbortSignal.timeout(20_000));
    assert.equal(progress.mergeInProgress, true); assert.deepEqual(progress.unmerged, ["features.mjs"]);
    assert.equal(await pending.git("ls-files", "--stage"), index, "Verification leaves the real index alone.");
    assert.equal(conflictOutcome(progress, { headSha: pending.head }, "completed").status, "paused");
    await pending.git("merge", "--abort");
    const aborted = await verifyConflictResolution(pending.root, { headSha: pending.head, baseSha: pending.base }, AbortSignal.timeout(20_000));
    assert.equal(aborted.head, pending.head); assert.equal(aborted.mergeInProgress, false);
    assert.equal(await pending.git("rev-parse", "main"), pending.base, "Both originals stay intact.");
    assert.equal(await readFile(notes, "utf8"), "generated unrelated edit\n", "The unrelated edit survives the paused resolution.");
    assert.equal(conflictOutcome(aborted, { headSha: pending.head }, "completed").status, "paused");
    assert.equal(conflictOutcome(aborted, { headSha: pending.head }, "stopped").status, "stopped");
  } finally { await pending.close(); }
});

test("flags persist through the service across clients and restart, and pre-113 lineages are refused", { timeout: ciTime(60_000) }, async () => {
  const f = await setupFixture();
  let reopened: Awaited<ReturnType<typeof startService>> | undefined, sdk = await new MoguriSdk(f.service.connection).ready(), other: MoguriSdk | undefined;
  try {
    const projectId = f.session().projectId, path = f.service.store.path;
    let settings = structuredClone(sdk.settings.get()!);
    assert.equal(settings.values.prAutomation, undefined);
    await sdk.settings.update({ ...settings.values, prAutomation: { ciRetry: true, conflictResolution: false } }, settings.revision);
    const { configuration } = await sdk.projects.configuration(projectId);
    await sdk.projects.configure(projectId, withPrAutomationOverride(configuration.values, "conflictResolution", "enabled"), configuration.revision);
    other = await new MoguriSdk(f.service.connection).ready();
    await waitFor(() => other!.getState().snapshot?.projectConfigurations.some((value) => value.projectId === projectId && value.values.repo.conflictResolution === "enabled"));
    const state = other.getState().snapshot!;
    assert.deepEqual(prAutomationExceptions(state.settings.values, state.projectConfigurations).map((value) => [value.flag, value.value]), [["conflictResolution", true]]);
    settings = structuredClone(sdk.settings.get()!);
    await sdk.settings.update({ ...settings.values, prAutomation: { ciRetry: false, conflictResolution: false } }, settings.revision);
    other.disconnect(); other = undefined; sdk.disconnect(); await f.service.close();
    reopened = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    sdk = await new MoguriSdk(reopened.connection).ready();
    const restored = sdk.getState().snapshot!, values = restored.projectConfigurations.find((value) => value.projectId === projectId)!.values;
    const effective = effectivePrAutomation(restored.settings.values, values);
    assert.deepEqual([effective.ciRetry.value, effective.ciRetry.source, effective.conflictResolution.value, effective.conflictResolution.source], [false, "global", true, "repository"],
      "The global change kept the explicit repository override across restart.");
    const current = (await sdk.projects.configuration(projectId)).configuration;
    await sdk.projects.configure(projectId, withPrAutomationOverride(current.values, "conflictResolution", "inherit"), current.revision);
    await waitFor(() => !prAutomationExceptions(sdk.getState().snapshot!.settings.values, sdk.getState().snapshot!.projectConfigurations).length);
    sdk.disconnect(); await reopened.close(); reopened = undefined;
    const history = new EventStore(path, f.retentionKey);
    const events = history.events(); history.close();
    assert.throws(() => removePrAutomationFixtureMarker(new DatabaseSync(":memory:"), events), /genuine pre-113 history/);
    const raw = new DatabaseSync(path);
    try { raw.exec("DELETE FROM retention_metadata WHERE id='pr_automation_schema'; PRAGMA user_version=112"); } finally { raw.close(); }
    assert.throws(() => new EventStore(path, f.retentionKey), /pre-113 lineage/);
  } finally { other?.disconnect(); sdk.disconnect(); await reopened?.close(); await f.close(); }
});

const wrapping = (request: Record<string, unknown>) => JSON.stringify(request.messages).includes("moguri-session-wrap-up");
const resolving = (request: Record<string, unknown>) => JSON.stringify(request.messages).includes("moguri-session-follow-up trigger=\\\"conflicts\\\"");
test("with follow-ups off, the conflict flag alone queues one bound resolution turn whose worktree is then verified", { skip: process.platform !== "darwin", timeout: ciTime(60_000) }, async () => {
  const options: GeneratedProviderOptions = { respond: (request) => {
    if (wrapping(request)) return { text: "Committed and opened https://github.com/generated/repo/pull/7 as a draft." };
    if (resolving(request)) return { text: "The features can't both be kept without your decision. I ran git merge --abort and left the conflict for you." };
    const messages = (request.messages as unknown[]).filter(isRecord), user = messages.findLastIndex((message) => message.role === "user");
    const tools = messages.slice(user + 1).filter((message) => message.role === "tool");
    if (!String(messages[user]?.content).includes("generated write")) return { text: "Generated reply." };
    if (!tools.length) return { tool: { name: "read_file", args: { path: "fixture.txt" } } };
    const file: unknown = JSON.parse(String(tools[0]!.content));
    return tools.length === 1 && isRecord(file) ? { tool: { name: "write_file", args: { path: "fixture.txt", text: "generated replacement\n", expectedDigest: file.digest } } } : { text: "Generated write done." };
  } };
  const f = await setupFixture(options);
  initializeGeneratedRepository(f.project);
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const settings = structuredClone(sdk.settings.get()!);
    await sdk.settings.update({ ...settings.values, wrapUp: { enabled: true, followUps: false }, prAutomation: { ciRetry: false, conflictResolution: true } }, settings.revision);
    const created = await sdk.sessions.create(f.session().projectId, "Generated conflicts", { modelId: f.modelId });
    const id = created.id!, current = () => f.service.controller.snapshot().sessions.find((session) => session.id === id)!;
    await sdk.workspaces.wait(current().workspaceId!);
    const saved = await sdk.command({ type: "draft.save", sessionId: id, expectedRevision: current().draft.revision, text: "generated write", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: id, expectedRevision: saved.revision!, delivery: "queue" });
    const settled = () => waitFor(() => !current().turnId && !current().queue.length && current().status === "completed" && current(), 15_000);
    await settled();
    const root = f.service.controller.snapshot().managedWorkspaces.find((value) => value.id === current().workspaceId)!.path;
    const head = await generatedGit(root, "rev-parse", "HEAD");
    const activity: PrActivity = { headSha: head, headRef: "moguri/generated", state: "open", author: "generated-author", reviews: [], mergeable: false, mergeableState: "dirty",
      baseRef: "main", baseSha: NEXT, checks: [{ name: "lint", status: "completed", conclusion: "failure" }] };
    let clock = Date.now() + 2000;
    const watcher = new LifecycleFollowUps({
      snapshot: () => f.service.controller.snapshot(), events: () => f.service.controller.events(0), now: () => clock,
      activity: async () => activity, branch: async () => "moguri/generated",
      enqueue: (sessionId, facts) => {
        const session = f.service.controller.snapshot().sessions.find((value) => value.id === sessionId)!;
        f.service.controller.lifecycleFollowUp(sessionId, facts, facts.trigger === "conflicts" ? [f.service.controller.platform.prAutomation.conflictEvent(session, facts)] : []);
      },
      automation: f.service.controller.platform.prAutomation,
    }, 1000);
    const scan = async () => { clock += 1500; await Promise.all(watcher.scan()); await settled(); };
    await scan();
    const lifecycle = () => f.service.controller.events(0).flatMap((event) => event.event_type === "queue.enqueued" && event.session_id === id && event.payload.item.lifecycle ? [event.payload.item.lifecycle] : []);
    assert.deepEqual(lifecycle().map((facts) => facts.trigger), ["round", "conflicts"], "No CI follow-up while follow-ups are off.");
    const conflict = lifecycle()[1]!.conflicts!;
    assert.deepEqual([conflict.headSha, conflict.baseRef, conflict.baseSha], [head, "main", NEXT]);
    assert.equal(f.requests.filter(resolving).length, 1);
    await scan();
    const record = f.service.controller.snapshot().prAutomation!.find((value) => value.id === conflict.id);
    assert.equal(record?.kind, "conflict-resolution"); assert.equal(record?.status, "paused"); assert.equal(record?.turnOutcome, "completed");
    assert.match(record!.diagnostic!, /No merge was committed/);
    assert.equal(lifecycle().length, 2, "The same head isn't resolved twice.");
    assert.equal(await generatedGit(root, "rev-parse", "HEAD"), head);
    watcher.close();
  } finally { sdk.disconnect(); await f.close(); }
});

test("a retained rerun intent survives an actual service restart as unconfirmed, without a second request", { timeout: ciTime(60_000) }, async () => {
  const reruns: number[] = [];
  const transport = (hold: boolean): CiRetryTransport => ({
    account: async () => ({ login: "generated-user", id: 7 }),
    job: async (_repository, id) => job(id, { completedAt: at(Date.now() - 600_000), startedAt: at(Date.now() - 900_000) }),
    log: async () => ({ text: FLAKY, complete: true }),
    rerun: async (_repository, id, _root, signal) => {
      reruns.push(id);
      if (hold) await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new MoguriError("program_partial", "Generated abort.")), { once: true }));
    },
    status: async () => ({ ...observation(), observedAt: new Date().toISOString() }),
  });
  const f = await setupFixture({ platform: { prAutomation: { transport: transport(true) } } });
  let reopened: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined = await new MoguriSdk(f.service.connection).ready();
  try {
    const projectId = f.session().projectId, settings = structuredClone(sdk.settings.get()!);
    await sdk.settings.update({ ...settings.values, prAutomation: { ciRetry: true, conflictResolution: false } }, settings.revision);
    const { configuration } = await sdk.projects.configuration(projectId);
    await sdk.projects.configure(projectId, { ...configuration.values, repo: { ...configuration.values.repo, githubAccess: "gh-cli" } }, configuration.revision);
    const recent = { startedAt: at(Date.now() - 900_000), completedAt: at(Date.now() - 600_000) };
    const pending = f.service.controller.platform.prAutomation.ci({ session: f.session() as Session, url: PR, root: f.project, activity: pr([check(1001, recent)]), signal: AbortSignal.timeout(20_000) });
    await waitFor(() => reruns.length === 1);
    sdk.disconnect(); sdk = undefined;
    await f.service.close(); await pending.catch(() => {});
    reopened = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey, platform: { prAutomation: { transport: transport(false) } } });
    const value = reopened.controller.snapshot().prAutomation!.find((item) => item.kind === "ci-retry") as CiRetryRecord;
    assert.equal(value.status, "unconfirmed"); assert.equal(value.attempts[0]?.status, "unconfirmed"); assert.match(value.attempts[0]!.diagnostic!, /restarted/);
    const session = reopened.controller.snapshot().sessions.find((item) => item.id === f.sessionId)!;
    await reopened.controller.platform.prAutomation.ci({ session, url: PR, root: f.project, activity: pr([check(1001, recent)]), signal: AbortSignal.timeout(20_000) });
    assert.deepEqual(reruns, [1001], "The interrupted attempt is never requested again.");
    await reopened.controller.platform.prAutomation.ci({ session, url: PR, root: f.project, activity: pr([check(1002, { ...recent, conclusion: "timed_out" })]), signal: AbortSignal.timeout(20_000) });
    const observed = reopened.controller.snapshot().prAutomation!.find((item) => item.id === value.id) as CiRetryRecord;
    assert.equal(observed.attempts[0]?.result, "timed_out", "The rerun's actual result is retained, not reported as success.");
    assert.notEqual(observed.status, "succeeded");
  } finally { sdk?.disconnect(); await reopened?.close(); await f.close(); }
});
