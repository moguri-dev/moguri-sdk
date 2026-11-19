import { createHash, randomUUID } from "node:crypto";
import {
  CI_RETRY_LIMITS, CI_RETRY_TERMINAL, CONFLICT_RESOLUTION_LIMITS, ciRetryOwnsCheck, classifyCiFailure, defaultProjectConfiguration, effectivePrAutomation, evaluateGithubStatus,
  MoguriError, type CiRetryAttempt, type CiRetryRecord, type CiRetryStatus, type ConflictResolutionRecord, type EventInput, type LifecycleFacts,
  type PrActivity, type PrActivityCheck, type PrAutomationCommand, type PrAutomationRecord, type ProviderStatusObservation, type Session, type Snapshot,
  type StoredEvent,
} from "../../../packages/protocol/src/index.ts";
import { boundedBody } from "./network.ts";
import { runProgram } from "./program.ts";
import { gitReadFilters } from "./project-git.ts";
import { pullRequestLink } from "./project-integrations.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";

export interface CiJob { id: number; runId: number; name: string; headSha: string; status: string; conclusion: string | null; startedAt: string | null; completedAt: string | null; url: string | null }
/** Everything the CI automation does outside Moguri. Tests replace it with generated responses; production uses the controller gh account and GitHub Status. */
export interface CiRetryTransport {
  account(root: string, signal: AbortSignal): Promise<{ login: string; id: number }>;
  job(repository: string, jobId: number, root: string, signal: AbortSignal): Promise<CiJob>;
  log(repository: string, jobId: number, root: string, signal: AbortSignal): Promise<{ text: string; complete: boolean }>;
  rerun(repository: string, jobId: number, root: string, signal: AbortSignal): Promise<void>;
  status(signal: AbortSignal): Promise<ProviderStatusObservation>;
}
const record = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const positive = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
const time = (value: unknown): string | null => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export const rerunCommand = (repository: string, jobId: number): string[] => ["api", "--hostname", "github.com", "--method", "POST", `repos/${repository}/actions/jobs/${jobId}/rerun`];

/** The production transport: the signed-in GitHub CLI account on this Mac and the public GitHub Status API. */
export function githubCiTransport(options: { program?: typeof runProgram; fetch?: typeof fetch } = {}): CiRetryTransport {
  const program = options.program ?? runProgram, fetcher = options.fetch ?? fetch;
  const env = { GH_HOST: "github.com", GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_PAGER: "cat" };
  const read = async (path: string, root: string, signal: AbortSignal): Promise<Record<string, unknown>> => {
    const text = await program("gh", ["api", "--hostname", "github.com", "--method", "GET", path], { cwd: root, signal, timeoutMs: 20_000, maxBytes: 2 * 1024 * 1024, label: "Read GitHub Actions job", env });
    try { return record(JSON.parse(text)); } catch { throw new MoguriError("ci_retry_response", "GitHub returned unreadable job data. Nothing was retried.", 502); }
  };
  const statusJson = async (url: string, maxBytes: number, signal: AbortSignal) => {
    const response = await fetcher(url, { headers: { Accept: "application/json" }, signal, redirect: "error" });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new MoguriError("provider_status_http", `GitHub Status returned HTTP ${response.status}.`, 502); }
    const age = Number(response.headers.get("age"));
    return { data: JSON.parse((await boundedBody(response, maxBytes, signal)).toString("utf8")) as unknown, age: Number.isFinite(age) && age >= 0 ? age : null, date: response.headers.get("date") };
  };
  return {
    account: async (root, signal) => {
      const data = await read("user", root, signal), login = typeof data.login === "string" ? data.login : "", id = positive(data.id);
      if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(login) || !id) throw new MoguriError("ci_retry_account", "The signed-in GitHub CLI account couldn't be verified. Nothing was retried.", 409);
      return { login, id };
    },
    job: async (repository, jobId, root, signal) => {
      const data = await read(`repos/${repository}/actions/jobs/${jobId}`, root, signal);
      const id = positive(data.id), runId = positive(data.run_id);
      if (id !== jobId || !runId || typeof data.head_sha !== "string" || typeof data.name !== "string" || typeof data.status !== "string") {
        throw new MoguriError("ci_retry_response", "GitHub returned a job that doesn't match the failed check. Nothing was retried.", 502);
      }
      return { id, runId, name: data.name, headSha: data.head_sha, status: data.status, conclusion: typeof data.conclusion === "string" ? data.conclusion : null,
        startedAt: time(data.started_at), completedAt: time(data.completed_at), url: typeof data.html_url === "string" && data.html_url.startsWith("https://github.com/") ? data.html_url.slice(0, 2048) : null };
    },
    log: async (repository, jobId, root, signal) => {
      let complete = true;
      try {
        const text = await program("gh", ["api", "--hostname", "github.com", "--method", "GET", `repos/${repository}/actions/jobs/${jobId}/logs`], {
          cwd: root, signal, timeoutMs: 60_000, maxBytes: CI_RETRY_LIMITS.logBytes, label: "Read GitHub Actions job log", env, tail: { truncated: () => { complete = false; } },
        });
        return { text, complete };
      } catch (error) {
        signal.throwIfAborted();
        console.error("Fix broken CI could not read a job log:", error instanceof MoguriError ? error.code : "ci_retry_log");
        return { text: "", complete: false };
      }
    },
    rerun: async (repository, jobId, root, signal) => {
      await program("gh", rerunCommand(repository, jobId), { cwd: root, signal, timeoutMs: CI_RETRY_REQUEST_MS, maxBytes: 64 * 1024, label: "Rerun a GitHub Actions job", env });
    },
    status: async (signal) => {
      const observedAt = new Date().toISOString();
      const [summary, incidents] = await Promise.all([statusJson(`${GITHUB_STATUS_API}/summary.json`, 1024 * 1024, signal), statusJson(`${GITHUB_STATUS_API}/incidents.json`, 4 * 1024 * 1024, signal)]);
      const ages = [summary.age, incidents.age].filter((value): value is number => value !== null);
      return { summary: summary.data, incidents: incidents.data, observedAt, ageSeconds: ages.length ? Math.max(...ages) : null, date: summary.date };
    },
  };
}
const GITHUB_STATUS_API = "https://www.githubstatus.com/api/v2";
const CI_RETRY_REQUEST_MS = 30_000;
const RETRYABLE = new Set(["failure", "timed_out"]);

/** Read-only Git, with the same hook/filter suppression as other workspace reads; some commands report through exit 1. */
async function git(root: string, args: string[], signal: AbortSignal, filters: string[]): Promise<string> {
  return runProgram("git", ["--no-pager", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", "-c", "core.hooksPath=/dev/null", "-c", "submodule.recurse=false", ...filters, ...args], {
    cwd: root, signal, label: "Verify a conflict resolution", timeoutMs: 30_000, maxBytes: 4 * 1024 * 1024, okCodes: [0, 1],
    env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_LFS_SKIP_SMUDGE: "1", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
  });
}
export type ConflictVerification = NonNullable<ConflictResolutionRecord["verification"]>;
/**
 * Checks, without touching the index or files, whether the worktree kept both sides: HEAD must contain the original PR head and
 * the base, no merge may be left half-done, no conflicted file may simply equal one side, and no conflict markers may remain.
 */
export async function verifyConflictResolution(root: string, binding: { headSha: string; baseSha: string }, signal: AbortSignal): Promise<ConflictVerification> {
  const filters = await gitReadFilters(root, signal), run = (args: string[]) => git(root, args, signal, filters);
  const resolve = async (rev: string) => (await run(["rev-parse", "--verify", "--quiet", "--end-of-options", rev])).trim() || null;
  const head = await resolve("HEAD^{commit}");
  const mergeInProgress = Boolean(await resolve("MERGE_HEAD"));
  const unmerged = [...new Set((await run(["diff", "--name-only", "--diff-filter=U", "-z"])).split("\0").filter(Boolean))].slice(0, CONFLICT_RESOLUTION_LIMITS.paths);
  const hasHead = Boolean(await resolve(`${binding.headSha}^{commit}`)), hasBase = Boolean(await resolve(`${binding.baseSha}^{commit}`));
  const ancestor = async (commit: string) => Boolean(head) && (await run(["merge-base", commit, head!])).trim() === commit;
  const containsHead = hasHead && await ancestor(binding.headSha), containsBase = hasBase && await ancestor(binding.baseSha);
  const conflicted = hasHead && hasBase ? [...new Set((await run(["merge-tree", "--write-tree", "--name-only", "--no-messages", "-z", binding.headSha, binding.baseSha]))
    .split("\0").slice(1).filter(Boolean))].slice(0, CONFLICT_RESOLUTION_LIMITS.paths) : [];
  const discarded: string[] = [], markers: string[] = [];
  if (head && head !== binding.headSha && containsHead && containsBase) {
    for (const path of conflicted) {
      const [resolved, ours, theirs] = await Promise.all([resolve(`HEAD:${path}`), resolve(`${binding.headSha}:${path}`), resolve(`${binding.baseSha}:${path}`)]);
      if (ours !== theirs && (resolved === ours || resolved === theirs)) discarded.push(path);
      if (resolved && /^(?:<{7}|>{7})(?: |$)/m.test(await run(["cat-file", "blob", resolved]))) markers.push(path);
    }
  }
  return { checkedAt: new Date().toISOString(), head, mergeInProgress, containsHead, containsBase, conflicted, unmerged, discarded, markers };
}
/** The outcome a verification supports. Only a committed merge of both histories with no dropped side counts as merged. */
export function conflictOutcome(verification: ConflictVerification, binding: { headSha: string }, turnOutcome: string): { status: ConflictResolutionRecord["status"]; diagnostic: string } {
  const files = (paths: string[]) => paths.length > 3 ? `${paths.slice(0, 3).join(", ")} and ${paths.length - 3} more` : paths.join(", ");
  if (verification.mergeInProgress || verification.unmerged.length) {
    return { status: turnOutcome === "completed" ? "paused" : "stopped", diagnostic: `The merge is still in progress${verification.unmerged.length ? ` with unresolved ${files(verification.unmerged)}` : ""}. Both originals are kept for your review; Moguri didn't commit or abort it.` };
  }
  if (!verification.head || verification.head === binding.headSha) {
    return { status: turnOutcome === "completed" ? "paused" : "stopped", diagnostic: "No merge was committed, so the conflict is still open. The branch and its base are unchanged for your review." };
  }
  if (!verification.containsHead) return { status: "needs-review", diagnostic: "The branch no longer contains its original head, so history was rewritten and a side may be lost. Review it before pushing anything else." };
  if (!verification.containsBase) return { status: "unverified", diagnostic: "The branch moved but doesn't contain the base yet, so the conflict wasn't merged. Review what changed." };
  if (verification.discarded.length || verification.markers.length) {
    return { status: "needs-review", diagnostic: [verification.discarded.length ? `${files(verification.discarded)} now match${verification.discarded.length === 1 ? "es" : ""} one side exactly, so the other side's change was dropped` : "",
      verification.markers.length ? `conflict markers remain in ${files(verification.markers)}` : ""].filter(Boolean).join("; ") + ". Review before relying on this merge." };
  }
  return { status: turnOutcome === "completed" ? "merged" : "stopped", diagnostic: `Both histories are merged and no conflicted file was resolved by picking one side (${verification.conflicted.length} file${verification.conflicted.length === 1 ? "" : "s"} checked). Check the agent's validation and CI on the new head.` };
}

interface Host {
  snapshot(): Snapshot;
  events(): StoredEvent[];
  commit(events: EventInput[]): void;
  /** The session's bound Local root (its managed worktree), or an error when it isn't available. */
  root(session: Session): string;
  now?(): number;
}
export interface CiEvaluation { owned: Set<number | string> }
/** The stored check name: GitHub names can exceed the record limit, so long ones keep a prefix plus a digest of the full name. */
export const checkKey = (name: string): string => name.length <= 255 ? name : `${name.slice(0, 220)}... #${createHash("sha256").update(name).digest("hex").slice(0, 16)}`;
/**
 * Whether a check on the PR head is this record's job or one of its reruns. Actions checks match by job ID, or by the same job
 * name in the same workflow run; same-named jobs from other workflows are different checks. Without a run ID, only a unique
 * name matches.
 */
export function sameCheck(value: CiRetryRecord, check: PrActivityCheck, checks: readonly PrActivityCheck[]): boolean {
  if (value.check.jobId === null) return check.id === undefined && checkKey(check.name) === value.check.name;
  if (check.id === undefined) return false;
  if (check.id === value.check.jobId || value.attempts.some((attempt) => attempt.jobId === check.id || attempt.resultJobId === check.id)) return true;
  if (checkKey(check.name) !== value.check.name) return false;
  if (check.runId !== undefined) return check.runId === value.check.runId;
  return checks.filter((item) => item.id !== undefined && checkKey(item.name) === value.check.name).length === 1;
}
/**
 * Fix broken CI and conflict resolution records. The lifecycle watcher calls `ci` with each fresh PR read; nothing here starts a
 * model. Every rerun is retained as `admitted` before GitHub is called, so a restart reports it unconfirmed instead of replaying it.
 */
export class PrAutomationRuntime {
  private readonly inflight = new Map<string, { abort: AbortController; done: Promise<void> }>();
  private health: { at: number; observation: ProviderStatusObservation | { error: string; observedAt: string } } | null = null;
  private settling = false;
  private closed = false;
  private readonly shutdown = new AbortController();
  constructor(private readonly host: Host, private readonly transport: CiRetryTransport) {}
  private now(): number { return this.host.now?.() ?? Date.now(); }
  private iso(): string { return new Date(this.now()).toISOString(); }
  close(): void { this.closed = true; this.shutdown.abort(); for (const value of this.inflight.values()) value.abort.abort(); }
  records(sessionId: string): PrAutomationRecord[] { return (this.host.snapshot().prAutomation ?? []).filter((value) => value.sessionId === sessionId); }
  private current(id: string): PrAutomationRecord | undefined { return (this.host.snapshot().prAutomation ?? []).find((value) => value.id === id); }
  private event(previous: PrAutomationRecord | undefined, next: PrAutomationRecord): EventInput {
    const value = previous ? { ...next, revision: previous.revision + 1, updatedAt: this.iso() < previous.updatedAt ? previous.updatedAt : this.iso() } : next;
    return { event_type: "pr_automation.recorded", profile_id: value.profileId, project_id: value.projectId, session_id: value.sessionId, payload: { record: value as PrAutomationRecord } };
  }
  private save(previous: PrAutomationRecord | undefined, next: PrAutomationRecord): void {
    if (this.closed) return;
    if (previous && this.current(previous.id)?.revision !== previous.revision) throw new MoguriError("pr_automation_changed", "This automation record changed while it was being updated. Nothing was replayed.", 409);
    this.host.commit([this.event(previous, next)]);
  }

  /** At startup, a rerun admitted before the restart has an unknown effect. It is reported, never replayed. */
  reconcile(): void {
    const events: EventInput[] = [];
    for (const value of this.host.snapshot().prAutomation ?? []) {
      if (value.kind !== "ci-retry" || value.attempts.at(-1)?.status !== "admitted") continue;
      const attempts = value.attempts.map((attempt, index) => index === value.attempts.length - 1 ? { ...attempt, status: "unconfirmed" as const,
        diagnostic: "Moguri restarted while requesting this rerun, so it doesn't know whether GitHub accepted it. It won't be requested again automatically." } : attempt);
      events.push(this.event(value, { ...value, attempts, status: CI_RETRY_TERMINAL.has(value.status) ? value.status : "unconfirmed",
        diagnostic: "Moguri restarted while requesting a rerun. It watches for the new attempt but never requests it twice." }));
    }
    if (events.length) this.host.commit(events);
  }

  /** Why Fix broken CI can't act for this session right now, or null. Saving the flag alone never bypasses these. */
  blocked(snapshot: Snapshot, session: Session): string | null {
    const configuration = session.projectId ? (snapshot.projectConfigurations.find((value) => value.projectId === session.projectId) ?? defaultProjectConfiguration(session.projectId)).values : null;
    if (!configuration || !effectivePrAutomation(snapshot.settings.values, configuration).ciRetry.value) return "Fix broken CI is off for this repository.";
    if (session.controls.env !== "Local" || !snapshot.policy.allowedEnvs.includes("Local")) return "Fix broken CI reruns jobs only for Local sessions that policy allows. Remote and Sandbox keep their own GitHub boundary.";
    if (session.mode === "read-only" || session.status === "archived") return "Read-only and archived sessions don't run automation.";
    if (configuration.repo.githubAccess !== "gh-cli") return "Reruns need your signed-in GitHub CLI account. Choose it for GitHub read access in this repository's settings.";
    const permissions = snapshot.settings.values.permissions;
    if (permissions.defaultDecision === "deny" || permissions.tools.some((rule) => rule.decision === "deny" && ["*", "github", "run_command"].includes(rule.tool))) {
      return "Your tool policy denies controller GitHub operations, so Fix broken CI won't rerun jobs.";
    }
    return null;
  }

  private async providerHealth(window: { startedAt: string | null; completedAt: string | null }, signal: AbortSignal) {
    // Each admission needs fresh evidence; one poll may reuse the same minute-old observation across sessions.
    if (!this.health || this.now() - this.health.at > 60_000) {
      let observation: ProviderStatusObservation | { error: string; observedAt: string };
      try { observation = await this.transport.status(AbortSignal.any([signal, AbortSignal.timeout(15_000)])); }
      catch (error) {
        signal.throwIfAborted();
        observation = { error: `GitHub Status couldn't be reached (${error instanceof MoguriError ? error.message : "network error"}), so provider health is unknown. Automatic retries are paused.`, observedAt: this.iso() };
      }
      this.health = { at: this.now(), observation };
    }
    return evaluateGithubStatus(this.health.observation, this.now(), window);
  }

  /** Evaluates the session's PR head and returns the failing checks automation is handling, by check run ID (or name for commit statuses). */
  async ci(input: { session: Session; url: string; root: string; activity: PrActivity; signal: AbortSignal }): Promise<CiEvaluation> {
    const owned = new Set<number | string>(), { session, activity, signal } = input, link = pullRequestLink(input.url);
    const snapshot = this.host.snapshot(), mine = this.records(session.id).filter((value): value is CiRetryRecord => value.kind === "ci-retry" && value.binding.url === link.url);
    for (const value of mine) if (!CI_RETRY_TERMINAL.has(value.status) && (activity.state !== "open" || value.binding.headSha !== activity.headSha)) {
      this.save(value, { ...value, status: "superseded", notBefore: null, diagnostic: activity.state !== "open" ? `The pull request is ${activity.state}. No further reruns.` :
        `The PR head moved to ${activity.headSha.slice(0, 7)}. This retry no longer applies; the new head is evaluated on its own.` });
    }
    if (activity.state !== "open") return { owned };
    const blocked = this.blocked(snapshot, session);
    const live = () => this.records(session.id).filter((value): value is CiRetryRecord => value.kind === "ci-retry" && value.binding.url === link.url && value.binding.headSha === activity.headSha);
    const result = (): CiEvaluation => {
      const records = live();
      for (const check of activity.checks) {
        const value = records.find((item) => sameCheck(item, check, activity.checks));
        if (value && ciRetryOwnsCheck(value)) owned.add(check.id ?? check.name);
      }
      return { owned };
    };
    if (blocked) {
      for (const value of live()) if (!CI_RETRY_TERMINAL.has(value.status) && !this.inflight.has(value.id)) {
        this.save(value, { ...value, status: "cancelled", notBefore: null, cancellation: { actor: "settings", at: this.iso() }, diagnostic: blocked });
      }
      return { owned };
    }
    const seen = new Set<string>();
    for (const value of live()) if (value.status === "requested" || value.status === "unconfirmed") { seen.add(value.id); await this.observe(value, activity, input); }
    if (activity.checks.some((check) => check.status !== "completed")) return result();
    const failing = activity.checks.filter((check) => check.conclusion !== null && RETRYABLE.has(check.conclusion)).slice(0, CI_RETRY_LIMITS.checksPerPoll);
    for (const check of failing) {
      signal.throwIfAborted();
      const existing = live().find((value) => sameCheck(value, check, activity.checks));
      if (existing && seen.has(existing.id)) continue;
      seen.add(existing?.id ?? "");
      try {
        if (!existing) await this.start(check, input);
        else if (existing.status === "deferred" || existing.status === "scheduled") await this.evaluate(existing, input);
      } catch (error) {
        if (signal.aborted || this.closed) throw error;
        console.error("Fix broken CI could not evaluate a failed check:", error instanceof MoguriError ? error.code : "ci_retry");
      }
    }
    return result();
  }
  private async start(check: PrActivityCheck, input: { session: Session; url: string; root: string; activity: PrActivity; signal: AbortSignal }): Promise<void> {
    const { session, activity, signal } = input, link = pullRequestLink(input.url), now = this.iso();
    const base = { version: 1 as const, kind: "ci-retry" as const, id: randomUUID(), profileId: this.host.snapshot().profileId, sessionId: session.id, projectId: session.projectId!,
      revision: 0, createdAt: now, updatedAt: now, classification: null, health: null, notBefore: null, attempts: [], cancellation: null };
    const actions = check.app === "github-actions" && check.id !== undefined;
    const account = await this.transport.account(input.root, signal);
    const job = actions ? await this.transport.job(link.repo, check.id!, input.root, signal) : null;
    if (job && (job.headSha !== activity.headSha || job.status !== "completed")) throw new MoguriError("ci_retry_binding", "The failed job doesn't belong to this exact PR head. Nothing was retried.", 409);
    const value: CiRetryRecord = { ...base, binding: { repository: link.repo, number: link.number, url: link.url, headSha: activity.headSha, headRef: activity.headRef, account },
      check: { name: checkKey(check.name), jobId: job?.id ?? null, runId: job?.runId ?? null, url: job?.url ?? null, startedAt: job?.startedAt ?? null, completedAt: job?.completedAt ?? null },
      status: "ineligible", diagnostic: actions ? null : "This check isn't a GitHub Actions job, so Moguri can't rerun it. It's left to you." };
    if (!job) { this.save(undefined, value); return; }
    await this.evaluate(value, input, true);
  }
  /** Decides the next state of a failing check: deferred, scheduled, ineligible or a rerun request. */
  private async evaluate(value: CiRetryRecord, input: { session: Session; url: string; root: string; activity: PrActivity; signal: AbortSignal }, created = false): Promise<void> {
    const { signal } = input, jobId = value.attempts.at(-1)?.resultJobId ?? value.check.jobId;
    if (!jobId) return;
    const job = jobId === value.check.jobId && value.check.completedAt ? { startedAt: value.check.startedAt, completedAt: value.check.completedAt } :
      await this.transport.job(value.binding.repository, jobId, input.root, signal);
    const evaluated = await this.providerHealth({ startedAt: job.startedAt, completedAt: job.completedAt }, signal);
    const write = (next: CiRetryRecord) => {
      const changed = created || JSON.stringify({ ...next, health: next.health && { ...next.health, observedAt: null } }) !== JSON.stringify({ ...value, health: value.health && { ...value.health, observedAt: null } });
      if (changed) this.save(created ? undefined : value, next);
    };
    if (evaluated.health.state === "disrupted") {
      write({ ...value, status: "deferred", health: evaluated.health, notBefore: null,
        diagnostic: `${evaluated.health.diagnostic ?? "GitHub reports a provider incident."} This failure isn't blamed on the change, and the original CI isn't reported fixed.` });
      return;
    }
    let classification = value.classification;
    if (!classification) {
      const log = await this.transport.log(value.binding.repository, jobId, input.root, signal);
      classification = classifyCiFailure(log.text, { complete: log.complete, providerIncident: evaluated.overlapping[0] ? `"${evaluated.overlapping[0].name}"${evaluated.overlapping[0].resolvedAt ? " (resolved)" : ""}` : null });
    }
    if (classification.kind !== "transient") { write({ ...value, status: "ineligible", classification, health: evaluated.health, notBefore: null, diagnostic: null }); return; }
    if (evaluated.health.state === "unknown") { write({ ...value, status: "deferred", classification, health: evaluated.health, notBefore: null, diagnostic: evaluated.health.diagnostic }); return; }
    const attempt = value.attempts.length + 1;
    if (attempt > CI_RETRY_LIMITS.attempts) { write({ ...value, status: "exhausted", classification, health: evaluated.health, notBefore: null, diagnostic: `Still failing after ${value.attempts.length} reruns. Moguri won't retry it again.` }); return; }
    const completed = Date.parse(job.completedAt ?? "") || this.now();
    const notBefore = new Date(completed + CI_RETRY_LIMITS.backoffMs[attempt - 1]!).toISOString();
    const scheduled: CiRetryRecord = { ...value, status: "scheduled", classification, health: evaluated.health, notBefore, diagnostic: null };
    if (Date.parse(notBefore) > this.now()) { write(scheduled); return; }
    if (created) this.save(undefined, { ...scheduled });
    await this.admit(created ? this.current(value.id) as CiRetryRecord : value, scheduled, jobId, input);
  }
  private async admit(previous: CiRetryRecord, scheduled: CiRetryRecord, jobId: number, input: { root: string; activity: PrActivity; signal: AbortSignal; session: Session }): Promise<void> {
    const snapshot = this.host.snapshot(), blocked = this.blocked(snapshot, input.session);
    if (blocked) throw new MoguriError("ci_retry_blocked", blocked, 409);
    const command = ["gh", ...rerunCommand(previous.binding.repository, jobId)].join(" ");
    if (snapshot.settings.values.permissions.commands.some((rule) => rule.decision === "deny" && rule.command === command)) {
      this.save(previous, { ...scheduled, status: "cancelled", notBefore: null, cancellation: { actor: "settings", at: this.iso() }, diagnostic: "An exact command rule denies this rerun." });
      return;
    }
    const account = await this.transport.account(input.root, input.signal);
    if (account.login.toLowerCase() !== previous.binding.account.login.toLowerCase() || account.id !== previous.binding.account.id) {
      this.save(previous, { ...scheduled, status: "superseded", notBefore: null, diagnostic: "The signed-in GitHub CLI account changed. Moguri doesn't rerun jobs with a different account." });
      return;
    }
    const job = await this.transport.job(previous.binding.repository, jobId, input.root, input.signal);
    if (job.headSha !== previous.binding.headSha || input.activity.headSha !== previous.binding.headSha || job.status !== "completed" || !RETRYABLE.has(job.conclusion ?? "")) {
      this.save(previous, { ...scheduled, status: "superseded", notBefore: null, diagnostic: "The job or PR head changed before the rerun. A fresh evaluation is needed." });
      return;
    }
    const attempt: CiRetryAttempt = { attempt: previous.attempts.length + 1, jobId, runId: job.runId, admittedAt: this.iso(), status: "admitted", requestedAt: null,
      result: null, resultJobId: null, resultAt: null, diagnostic: null };
    this.save(previous, { ...scheduled, status: "requested", notBefore: null, attempts: [...previous.attempts, attempt], diagnostic: null });
    const admitted = this.current(previous.id) as CiRetryRecord;
    const abort = new AbortController();
    let settled!: () => void;
    const done = new Promise<void>((resolve) => { settled = resolve; });
    this.inflight.set(previous.id, { abort, done });
    let outcome: Pick<CiRetryAttempt, "status" | "diagnostic"> & { record: CiRetryStatus; note: string | null };
    try {
      await this.transport.rerun(previous.binding.repository, jobId, input.root, AbortSignal.any([abort.signal, this.shutdown.signal, AbortSignal.timeout(CI_RETRY_REQUEST_MS)]));
      outcome = { status: "requested", diagnostic: null, record: "requested", note: null };
    } catch (error) {
      const unknown = abort.signal.aborted || this.shutdown.signal.aborted || error instanceof MoguriError && error.code === "program_partial";
      outcome = unknown ? { status: "unconfirmed", diagnostic: "The rerun request was interrupted, so Moguri doesn't know whether GitHub accepted it. It won't be requested again automatically.", record: "unconfirmed", note: null } :
        { status: "failed", diagnostic: `GitHub didn't accept the rerun: ${error instanceof Error ? error.message.slice(0, 600) : "unknown error"}`, record: "failed", note: "The rerun request failed. Moguri doesn't retry a rejected request." };
    }
    try {
      const latest = this.current(previous.id) as CiRetryRecord | undefined;
      if (latest && latest.revision === admitted.revision && !this.closed) {
        const attempts = latest.attempts.map((value, index) => index === latest.attempts.length - 1 ? { ...value, status: outcome.status, diagnostic: outcome.diagnostic,
          requestedAt: outcome.status === "requested" ? this.iso() : null } : value);
        this.save(latest, { ...latest, attempts, status: outcome.record, diagnostic: outcome.note });
      }
    } finally { this.inflight.delete(previous.id); settled(); }
  }
  /** Follows a requested rerun to its actual conclusion. Admission is never reported as success. */
  private async observe(value: CiRetryRecord, activity: PrActivity, input: { session: Session; url: string; root: string; activity: PrActivity; signal: AbortSignal }): Promise<void> {
    const last = value.attempts.at(-1);
    if (!last || this.inflight.has(value.id)) return;
    // The rerun appears as a newer check run of the same job in the same workflow run.
    const known = new Set([value.check.jobId, ...value.attempts.map((attempt) => attempt.jobId)]);
    const check = activity.checks.find((item) => item.id !== undefined && !known.has(item.id) && sameCheck(value, item, activity.checks));
    if (!check?.id) {
      if (value.status === "requested" && last.requestedAt && this.now() - Date.parse(last.requestedAt) > CI_RETRY_LIMITS.resultWindowMs) {
        this.save(value, { ...value, status: "unconfirmed", diagnostic: "GitHub showed no new attempt within an hour of the accepted rerun. Inspect the run on GitHub; Moguri won't request it again." });
      }
      return;
    }
    const observed = last.status === "requested" ? last : { ...last, status: "requested" as const, diagnostic: "Observed on GitHub after Moguri lost track of the request." };
    if (check.status !== "completed") {
      if (value.status === "unconfirmed" || observed !== last) this.save(value, { ...value, status: "requested", attempts: [...value.attempts.slice(0, -1), observed], diagnostic: null });
      return;
    }
    const result = check.conclusion ?? "unknown";
    const settled: CiRetryAttempt = { ...observed, result: result.slice(0, 64), resultJobId: check.id, resultAt: check.completedAt ?? this.iso() };
    const next: CiRetryRecord = { ...value, attempts: [...value.attempts.slice(0, -1), settled] };
    if (result === "success") { this.save(value, { ...next, status: "succeeded", diagnostic: `Passed on rerun ${settled.attempt}. The original failure is still part of this PR's history.` }); return; }
    if (!RETRYABLE.has(result)) { this.save(value, { ...next, status: "exhausted", diagnostic: `The rerun ended ${result.replaceAll("_", " ")}. Moguri doesn't retry it again.` }); return; }
    if (next.attempts.length >= CI_RETRY_LIMITS.attempts) { this.save(value, { ...next, status: "exhausted", diagnostic: `Still failing after ${next.attempts.length} reruns. Moguri won't retry it again.` }); return; }
    this.save(value, { ...next, status: "scheduled", classification: null, diagnostic: null });
    try { await this.evaluate(this.current(value.id) as CiRetryRecord, input); }
    catch (error) { if (input.signal.aborted || this.closed) throw error; console.error("Fix broken CI could not evaluate a failed rerun:", error instanceof MoguriError ? error.code : "ci_retry"); }
  }

  /** Explicit cancellation stops further automatic reruns. An in-flight request is aborted first and settles as unconfirmed. */
  async cancel(command: PrAutomationCommand, finish: WorkspaceFinish) {
    let value = this.current(command.recordId);
    if (!value || value.kind !== "ci-retry") throw new MoguriError("pr_automation_missing", "Choose an existing CI retry. Conflict resolutions are follow-up turns you stop or remove from the chat queue.", 404);
    const inflight = this.inflight.get(value.id);
    if (inflight) { inflight.abort.abort(); await inflight.done; value = this.current(command.recordId) as CiRetryRecord; }
    else if (value.revision !== command.expectedRevision) throw new MoguriError("pr_automation_changed", "This retry changed. Review its current state before cancelling.", 409);
    if (CI_RETRY_TERMINAL.has(value.status)) return finish([], { revision: value.revision });
    const event = this.event(value, { ...value, status: "cancelled", notBefore: null, cancellation: { actor: "user", at: this.iso() },
      diagnostic: "You cancelled this automatic retry. Moguri won't rerun this check again on this head; any rerun GitHub already started keeps running." });
    return finish([event], { revision: value.revision + 1 });
  }

  /** The queued record that binds a conflict follow-up turn; committed atomically with the queue item. */
  conflictEvent(session: Session, facts: LifecycleFacts): EventInput {
    if (!facts.conflicts || !facts.pr || !session.projectId) throw new MoguriError("conflict_resolution_binding", "A conflict follow-up needs its exact PR and base.", 409);
    const link = pullRequestLink(facts.pr.url), now = this.iso();
    const value: ConflictResolutionRecord = { version: 1, kind: "conflict-resolution", id: facts.conflicts.id, profileId: this.host.snapshot().profileId, sessionId: session.id,
      projectId: session.projectId, revision: 0, createdAt: now, updatedAt: now, binding: { repository: link.repo, number: link.number, url: link.url, headSha: facts.conflicts.headSha,
        headRef: facts.conflicts.headRef, baseRef: facts.conflicts.baseRef, baseSha: facts.conflicts.baseSha }, status: "queued", turnId: null, turnOutcome: null, verification: null, diagnostic: null };
    return this.event(undefined, value);
  }
  /** Verifies conflict turns that finished, from the actual worktree. Runs at most one pass at a time. */
  async settleConflicts(signal: AbortSignal = this.shutdown.signal): Promise<void> {
    const queued = (this.host.snapshot().prAutomation ?? []).filter((value): value is ConflictResolutionRecord => value.kind === "conflict-resolution" && value.status === "queued");
    if (!queued.length || this.settling || this.closed) return;
    this.settling = true;
    try {
      const events = this.host.events();
      for (const value of queued) {
        const started = events.find((event) => event.event_type === "turn.started" && event.session_id === value.sessionId && event.payload.item.lifecycle?.conflicts?.id === value.id);
        const enqueued = events.find((event) => event.event_type === "queue.enqueued" && event.session_id === value.sessionId && event.payload.item.lifecycle?.conflicts?.id === value.id);
        const itemId = enqueued?.event_type === "queue.enqueued" ? enqueued.payload.item.id : null;
        const removed = !started && itemId !== null && events.some((event) => event.event_type === "queue.removed" && event.session_id === value.sessionId && event.payload.messageId === itemId);
        const session = this.host.snapshot().sessions.find((item) => item.id === value.sessionId);
        if (removed || !session) {
          this.save(value, { ...value, status: "stopped", diagnostic: "The conflict follow-up was removed before it started. Nothing was merged." });
          continue;
        }
        const finished = started && events.find((event) => event.event_type === "turn.finished" && event.turn_id === started.turn_id);
        if (!started || !finished || finished.event_type !== "turn.finished") continue;
        let verification: ConflictVerification;
        try { verification = await verifyConflictResolution(this.host.root(session), value.binding, signal); }
        catch (error) {
          if (signal.aborted) return;
          this.save(value, { ...value, status: "unverified", turnId: started.turn_id ?? null, turnOutcome: finished.payload.outcome,
            diagnostic: `Moguri couldn't inspect the worktree (${error instanceof MoguriError ? error.message.slice(0, 300) : "Git error"}). Review the branch before relying on it.` });
          continue;
        }
        const outcome = conflictOutcome(verification, value.binding, finished.payload.outcome);
        this.save(value, { ...value, ...outcome, turnId: started.turn_id ?? null, turnOutcome: finished.payload.outcome, verification });
      }
    } finally { this.settling = false; }
  }
}
