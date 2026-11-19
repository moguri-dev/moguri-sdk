import { randomUUID } from "node:crypto";
import {
  CI_RETRY_TERMINAL, defaultProjectConfiguration, effectivePrAutomation, followUpFacts, LIFECYCLE_EDIT_TOOLS, LIFECYCLE_LIMITS, MoguriError, projectWorkflowDefaults,
  sessionLifecycle, sessionPrScope, sessionPullRequest, type LifecycleFacts, type PrActivity, type PullRequestLink, type Session, type Snapshot, type StoredEvent,
} from "../../../packages/protocol/src/index.ts";
import type { PrAutomationRuntime } from "./pr-automation.ts";
import { runProgram } from "./program.ts";
import { pullRequestLink } from "./project-integrations.ts";

/** One request round: everything since the last user-request turn, including Moguri's lifecycle turns. */
export interface LifecycleRound {
  sourceTurnId: string; turnIds: Set<string>; lifecycle: LifecycleFacts[]; lifecycleTurnIds: Set<string>;
  edits: number; skills: string[]; lastLifecycleFinishedAt: number | null; lastLifecycleOutcome: string | null;
  /** The latest finished turn of the round, lifecycle or not. Pull request automation watches from here. */
  lastFinishedAt: number | null; lastOutcome: string | null;
}
export function lifecycleRound(events: readonly StoredEvent[], sessionId: string): LifecycleRound | null {
  let start = -1;
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!;
    if (event.session_id === sessionId && event.event_type === "turn.started" && !event.payload.item.lifecycle && event.turn_id) { start = index; break; }
  }
  if (start < 0) return null;
  const sourceTurnId = events[start]!.turn_id!;
  const round: LifecycleRound = { sourceTurnId, turnIds: new Set([sourceTurnId]), lifecycle: [], lifecycleTurnIds: new Set(), edits: 0, skills: [],
    lastLifecycleFinishedAt: null, lastLifecycleOutcome: null, lastFinishedAt: null, lastOutcome: null };
  // Edits and skills accumulate across every request since the previous round's wrap-up was queued.
  const skills = new Set<string>(), lifecycleTurns = new Set<string>();
  for (const event of events) {
    if (event.session_id !== sessionId) continue;
    if (event.event_type === "turn.started" && event.payload.item.lifecycle && event.turn_id) lifecycleTurns.add(event.turn_id);
    else if (event.event_type === "queue.enqueued" && event.payload.item.lifecycle?.trigger === "round") { round.edits = 0; skills.clear(); }
    else if (event.event_type === "tool.completed" && event.turn_id && !lifecycleTurns.has(event.turn_id) && !event.payload.isError && LIFECYCLE_EDIT_TOOLS.has(event.payload.call.name)) round.edits++;
    else if ((event.event_type === "skill.loaded" || event.event_type === "skill.used") && event.turn_id && !lifecycleTurns.has(event.turn_id)) skills.add(event.payload.name);
  }
  for (const event of events.slice(start)) {
    if (event.session_id !== sessionId) continue;
    if (event.event_type === "turn.started" && event.turn_id) {
      round.turnIds.add(event.turn_id);
      if (event.payload.item.lifecycle) round.lifecycleTurnIds.add(event.turn_id);
    } else if (event.event_type === "queue.enqueued" && event.payload.item.lifecycle) round.lifecycle.push(event.payload.item.lifecycle);
    else if (event.event_type === "turn.finished" && event.turn_id && round.turnIds.has(event.turn_id)) {
      round.lastFinishedAt = Date.parse(event.timestamp); round.lastOutcome = event.payload.outcome;
      if (round.lifecycleTurnIds.has(event.turn_id)) { round.lastLifecycleFinishedAt = Date.parse(event.timestamp); round.lastLifecycleOutcome = event.payload.outcome; }
    }
  }
  round.skills = [...skills].sort();
  return round;
}

const prFacts = (session: Session, snapshot: Snapshot, url: string | null): LifecycleFacts["pr"] => {
  const target = url ?? sessionPrScope(session, snapshot)?.url ?? null;
  if (!target) return null;
  let parsed: PullRequestLink;
  try { parsed = pullRequestLink(target); } catch { return null; }
  const observed = sessionPullRequest(session, snapshot);
  return { url: parsed.url, number: parsed.number, state: observed?.url === parsed.url ? observed.state : "unknown", headSha: observed?.url === parsed.url ? observed.headSha ?? null : null };
};
const projectSettings = (snapshot: Snapshot, session: Session) =>
  session.projectId ? (snapshot.projectConfigurations.find((value) => value.projectId === session.projectId) ?? defaultProjectConfiguration(session.projectId)).values : null;
/** The repository's effective flags, or null for sessions without a project. */
export const sessionAutomation = (snapshot: Snapshot, session: Session) => {
  const configuration = projectSettings(snapshot, session);
  return configuration ? effectivePrAutomation(snapshot.settings.values, configuration) : null;
};
export function baseFacts(snapshot: Snapshot, session: Session, round: LifecycleRound, prUrl: string | null = null): LifecycleFacts {
  const configuration = projectSettings(snapshot, session), automation = sessionAutomation(snapshot, session);
  // Recorded only when a flag is on, so default lifecycle items keep their protocol-109 shape.
  const flags = automation && (automation.ciRetry.value || automation.conflictResolution.value) ? { automation: { ciRetry: automation.ciRetry.value, conflictResolution: automation.conflictResolution.value } } : {};
  return { ...flags,
    version: 1, trigger: "round", sourceTurnId: round.sourceTurnId,
    workspace: session.workspaceId ? "managed-worktree" : session.projectId ? "checkout" : "none",
    edits: round.edits, pullRequests: configuration ? projectWorkflowDefaults(configuration).pullRequests : "off",
    pr: prFacts(session, snapshot, prUrl), ci: null, reviews: null,
    skills: snapshot.settings.values.evolution.enabled ? round.skills : [], parent: Boolean(session.coordinationParentId),
  };
}
const ordinary = (session: Session) => session.kind === "agent" && session.purpose !== "kanban" && session.mode !== "read-only" && session.status !== "archived";
export const lifecycleIdle = (session: Session) => !session.turnId && !session.pendingApproval && !session.pendingQuestionId && !session.queue.some((item) => !item.held);

/**
 * The wrap-up decision for one finished turn. Only the last user request of a round qualifies, once per
 * round, and only when there is housekeeping: edits in the Moguri-managed worktree, or skills to review.
 */
export function wrapUpFacts(snapshot: Snapshot, session: Session, events: readonly StoredEvent[], finished: Extract<StoredEvent, { event_type: "turn.finished" }>): LifecycleFacts | null {
  if (finished.payload.outcome !== "completed" || !sessionLifecycle(snapshot.settings.values).enabled || !ordinary(session) || !lifecycleIdle(session)) return null;
  const round = lifecycleRound(events, session.id);
  if (!round || round.sourceTurnId !== finished.turn_id || round.lifecycle.length) return null;
  const facts = baseFacts(snapshot, session, round);
  return facts.workspace === "managed-worktree" && facts.edits > 0 || facts.skills.length ? facts : null;
}
/** A follow-up may only join the same round while the session is still idle and ordinary. */
export const followUpAllowed = (snapshot: Snapshot, session: Session, events: readonly StoredEvent[], facts: LifecycleFacts): boolean =>
  (facts.trigger === "conflicts" ? sessionAutomation(snapshot, session)?.conflictResolution.value === true : sessionLifecycle(snapshot.settings.values).followUps) &&
  ordinary(session) && lifecycleIdle(session) && lifecycleRound(events, session.id)?.sourceTurnId === facts.sourceTurnId;

const PR_URL = /https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}\/pull\/[1-9]\d{0,9}/g;
/** The PR the agent reported in this round's lifecycle turns. Used only to choose what to poll; its head branch is verified. */
export function reportedPrUrl(session: Session, round: LifecycleRound): string | null {
  for (const message of [...session.messages].reverse()) {
    if (message.role !== "assistant" || !round.lifecycleTurnIds.has(message.turnId)) continue;
    const found = message.text.match(PR_URL);
    if (found?.length) return found.at(-1)!;
  }
  return null;
}

interface FollowUpHost {
  snapshot(): Snapshot;
  events(): StoredEvent[];
  activity(link: PullRequestLink, access: "public" | "gh-cli", root: string, signal: AbortSignal): Promise<PrActivity>;
  enqueue(sessionId: string, facts: LifecycleFacts): void;
  branch?(root: string, signal: AbortSignal): Promise<string>;
  /** Fix broken CI and conflict verification; absent hosts only run review and CI follow-ups. */
  automation?: Pick<PrAutomationRuntime, "ci" | "settleConflicts">;
  now?(): number;
}
/**
 * Polls the open PR of idle sessions that already ran a lifecycle turn, for up to a day after it. Observations
 * stay in memory; only an actual follow-up becomes durable, as one queued lifecycle turn.
 */
export class LifecycleFollowUps {
  private readonly polled = new Map<string, number>();
  private readonly active = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  private readonly abort = new AbortController();
  constructor(private readonly host: FollowUpHost, private readonly interval: number = LIFECYCLE_LIMITS.pollMs) {}
  start(): void {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => this.scan(), Math.min(this.interval, 60_000)); this.timer.unref();
  }
  close(): void { this.closed = true; clearInterval(this.timer); this.abort.abort(); this.polled.clear(); }
  private now(): number { return this.host.now?.() ?? Date.now(); }
  scan(): Promise<void>[] {
    if (this.closed) return [];
    const snapshot = this.host.snapshot(), polls: Promise<void>[] = [];
    if (this.host.automation) polls.push(this.host.automation.settleConflicts().catch((error: unknown) => {
      if (!this.closed) console.error("Conflict resolution verification failed:", error instanceof MoguriError ? error.code : "conflict_verification");
    }));
    const followUps = sessionLifecycle(snapshot.settings.values).followUps;
    let events: StoredEvent[] | undefined;
    for (const session of snapshot.sessions) {
      if (this.active.size >= 2) break;
      if (this.active.has(session.id) || !ordinary(session) || !lifecycleIdle(session) || !session.workspaceId || !session.projectId) continue;
      if (this.now() - (this.polled.get(session.id) ?? -Infinity) < this.interval) continue;
      const automation = this.host.automation ? sessionAutomation(snapshot, session) : null;
      const openRetries = (snapshot.prAutomation ?? []).some((value) => value.sessionId === session.id && value.kind === "ci-retry" && !CI_RETRY_TERMINAL.has(value.status));
      const automated = Boolean(automation?.ciRetry.value || automation?.conflictResolution.value || openRetries);
      if (!followUps && !automated) continue;
      events ??= this.host.events();
      const round = lifecycleRound(events, session.id);
      const watched = followUps && round?.lastLifecycleFinishedAt !== null && round?.lastLifecycleOutcome === "completed" ? round?.lastLifecycleFinishedAt :
        automated && round?.lastOutcome === "completed" ? round.lastFinishedAt : null;
      if (!round || watched === null || watched === undefined || this.now() - watched > LIFECYCLE_LIMITS.followUpWindowMs) continue;
      const workspace = snapshot.managedWorkspaces.find((value) => value.id === session.workspaceId && value.status === "ready");
      const url = sessionPrScope(session, snapshot)?.url ?? reportedPrUrl(session, round);
      if (!workspace || !url) continue;
      this.polled.set(session.id, this.now()); this.active.add(session.id);
      polls.push(this.poll(session.id, url, workspace.path, round).catch((error: unknown) => {
        if (!this.closed) console.error("Lifecycle follow-up check failed:", error instanceof MoguriError ? error.code : "lifecycle_follow_up");
      }).finally(() => { this.active.delete(session.id); }));
    }
    return polls;
  }
  private async poll(sessionId: string, url: string, root: string, round: LifecycleRound): Promise<void> {
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(45_000)]);
    const snapshot = this.host.snapshot(), session = snapshot.sessions.find((value) => value.id === sessionId);
    if (!session?.projectId) return;
    const access = (snapshot.projectConfigurations.find((value) => value.projectId === session.projectId) ?? defaultProjectConfiguration(session.projectId)).values.repo.githubAccess;
    const [branch, activity] = await Promise.all([(this.host.branch ?? currentBranch)(root, signal), this.host.activity(pullRequestLink(url), access, root, signal)]);
    if (activity.headRef !== branch) throw new MoguriError("lifecycle_pr_branch", "The reported PR does not track this session's worktree branch. No follow-up was queued.", 409);
    const current = this.host.snapshot().sessions.find((value) => value.id === sessionId);
    if (this.closed || !current || !lifecycleIdle(current)) return;
    const latest = this.host.snapshot(), automation = this.host.automation ? sessionAutomation(latest, current) : null;
    let ciOwned = new Set<number | string>();
    if (this.host.automation && (automation?.ciRetry.value || (latest.prAutomation ?? []).some((value) => value.sessionId === sessionId && value.kind === "ci-retry" && !CI_RETRY_TERMINAL.has(value.status)))) {
      try { ciOwned = (await this.host.automation.ci({ session: current, url, root, activity, signal })).owned; }
      catch (error) {
        if (this.closed || signal.aborted) return;
        console.error("Fix broken CI check failed:", error instanceof MoguriError ? error.code : "ci_retry");
      }
    }
    const after = this.host.snapshot().sessions.find((value) => value.id === sessionId);
    if (this.closed || !after || !lifecycleIdle(after)) return;
    const modelFollowUps = sessionLifecycle(this.host.snapshot().settings.values).followUps && round.lastLifecycleFinishedAt !== null && round.lastLifecycleOutcome === "completed";
    const facts = followUpFacts({ base: baseFacts(this.host.snapshot(), after, round, url), earlier: round.lifecycle, activity, lastFinishedAt: round.lastLifecycleFinishedAt ?? 0,
      followUps: modelFollowUps, ciOwned, conflicts: automation?.conflictResolution.value ? { id: randomUUID() } : null });
    if (facts) this.host.enqueue(sessionId, facts);
  }
}
export async function currentBranch(root: string, signal: AbortSignal): Promise<string> {
  return (await runProgram("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: root, signal, timeoutMs: 10_000, maxBytes: 4096, label: "Read the session branch" })).trim();
}
