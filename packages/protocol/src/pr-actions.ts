import type { PrActivity } from "./session-lifecycle.ts";

/** Explicit user actions the Code Change view offers for a session's linked pull request (protocol 112). */
export type PrActionKind = "address-review" | "fix-conflicts" | "fix-ci";
export const PR_ACTION_KINDS: readonly PrActionKind[] = ["address-review", "fix-conflicts", "fix-ci"];
export const PR_ACTION_LABELS: Record<PrActionKind, string> = { "address-review": "Address code review", "fix-conflicts": "Fix merge conflicts", "fix-ci": "Fix CI" };
/** A queued or started pull request follow-up workflow, by preset or slash command; such history cannot be pre-112. */
export const prWorkflowItem = (item: { workflow?: { kind: string }; command?: { name: string } }): boolean =>
  (PR_ACTION_KINDS as readonly string[]).includes(item.workflow?.kind ?? "") || (PR_ACTION_KINDS as readonly string[]).includes(item.command?.name ?? "");
export interface PrAction { kind: PrActionKind; available: boolean; reason: string }
/** A read-only observation of one linked PR. Nothing is retained; an action only queues an ordinary user-requested workflow. */
export interface PrStatus {
  url: string; state: PrActivity["state"]; headSha: string; headRef: string;
  /** The session checkout's current branch, or null when it could not be read. */
  branch: string | null;
  mergeable: boolean | null; mergeableState: string | null;
  /** Other reviewers whose latest review requests changes or leaves comments. */
  reviewers: string[];
  failedChecks: string[]; runningChecks: number; totalChecks: number;
  actions: PrAction[]; checkedAt: string;
}
const FAILED = new Set(["failure", "timed_out", "startup_failure", "action_required"]);
const names = (values: readonly string[]) => values.length > 3 ? `${values.slice(0, 3).join(", ")} and ${values.length - 3} more` : values.join(", ");

/** Decides which actions apply from a fresh PR read and the session's checkout branch. */
export function prStatus(url: string, activity: PrActivity, branch: string | null, checkedAt: string): PrStatus {
  const latest = new Map<string, string>();
  for (const review of [...activity.reviews].sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""))) {
    if (review.author && review.author !== activity.author && review.state !== "PENDING") latest.set(review.author, review.state);
  }
  const reviewers = [...latest].filter(([, state]) => state === "CHANGES_REQUESTED" || state === "COMMENTED").map(([author]) => author).sort();
  const checks = activity.checks.filter((check) => check.name !== "(more checks)");
  const failedChecks = checks.filter((check) => check.status === "completed" && check.conclusion !== null && FAILED.has(check.conclusion)).map((check) => check.name).sort();
  const runningChecks = activity.checks.filter((check) => check.status !== "completed").length;
  const mergeable = activity.mergeable ?? null, mergeableState = activity.mergeableState ?? null;
  const blocked = activity.state !== "open" ? `The pull request is ${activity.state}.` :
    branch === null ? "This session's branch couldn't be read, so changes might land on the wrong branch." :
    branch !== activity.headRef ? `This session's checkout is on ${branch}, not the pull request branch ${activity.headRef}.` : null;
  const action = (kind: PrActionKind, available: boolean, reason: string): PrAction => blocked ? { kind, available: false, reason: blocked } : { kind, available, reason };
  const conflicted = mergeable === false || mergeableState === "dirty";
  return {
    url, state: activity.state, headSha: activity.headSha, headRef: activity.headRef, branch, mergeable, mergeableState, reviewers,
    failedChecks, runningChecks, totalChecks: checks.length, checkedAt,
    actions: [
      action("address-review", reviewers.length > 0, reviewers.length ? `Changes requested or comments from ${names(reviewers)}.` : "No open review feedback from other reviewers."),
      action("fix-conflicts", conflicted, conflicted ? "The branch conflicts with its base." : mergeable === null ? "GitHub is still checking for conflicts. Refresh in a moment." : "No merge conflicts."),
      action("fix-ci", failedChecks.length > 0, failedChecks.length ? `Failing checks: ${names(failedChecks)}${runningChecks ? `; ${runningChecks} still running` : ""}.` :
        runningChecks ? `${runningChecks} check${runningChecks === 1 ? " is" : "s are"} still running.` : checks.length ? "All checks passed." : "No checks ran on the pull request head."),
    ],
  };
}

/** The user-requested prompt an action queues: the PR and the facts the user saw, never review text or log content. */
export function prActionPrompt(status: PrStatus, kind: PrActionKind): string {
  const facts = kind === "address-review" ? `Review feedback from: ${status.reviewers.join(", ")}.` :
    kind === "fix-conflicts" ? `GitHub reports merge conflicts with the base (mergeable state ${status.mergeableState ?? "unknown"}).` :
    `Failing checks: ${status.failedChecks.join(", ")}.`;
  return `${PR_ACTION_LABELS[kind]} for pull request ${status.url} (branch ${status.headRef}, head ${status.headSha.slice(0, 12)}). ${facts}`;
}
