import { Type, type Static } from "typebox";
import { CONFLICT_RESOLUTION_LIMITS } from "./pr-automation.ts";

/**
 * Session lifecycle: what Moguri does after a request round finishes. Defaults are on; every effect still
 * goes through the session's normal tool approvals, hard policy and budgets.
 */
export const SessionLifecycleSettingsSchema = Type.Object({
  /** Queue one wrap-up turn after the last completed request in a round. */
  enabled: Type.Boolean(),
  /** Follow an open PR after wrap-up: new reviews and failing CI queue bounded follow-up turns. */
  followUps: Type.Boolean(),
}, { additionalProperties: false });
export type SessionLifecycleSettings = Static<typeof SessionLifecycleSettingsSchema>;
export const DEFAULT_SESSION_LIFECYCLE: SessionLifecycleSettings = { enabled: true, followUps: true };
export const sessionLifecycle = (settings: { wrapUp?: SessionLifecycleSettings }): SessionLifecycleSettings => settings.wrapUp ?? DEFAULT_SESSION_LIFECYCLE;
export const LIFECYCLE_LIMITS = { ciFollowUps: 2, reviewFollowUps: 3, pollMs: 120_000, followUpWindowMs: 24 * 3_600_000, titleRefreshes: 3 } as const;
/** Successful calls to these tools count as repository edits for the wrap-up decision. */
export const LIFECYCLE_EDIT_TOOLS: ReadonlySet<string> = new Set(["edit_file", "write_file", "edit_document", "write_document", "git_write"]);

export interface LifecyclePullRequest { url: string; number: number; state: "open" | "closed" | "merged" | "unknown"; headSha: string | null }
/** Service-observed facts captured when a lifecycle turn is queued. They are data for the checklist, not user text. */
export interface LifecycleFacts {
  version: 1;
  trigger: "round" | "ci" | "review" | "conflicts";
  /** The last user-request turn of the round this item belongs to. */
  sourceTurnId: string;
  workspace: "managed-worktree" | "checkout" | "none";
  edits: number;
  pullRequests: "draft" | "off" | "none";
  pr: LifecyclePullRequest | null;
  ci: { headSha: string; failing: string[]; repeated: boolean } | null;
  reviews: { ids: number[]; authors: string[] } | null;
  skills: string[];
  parent: boolean;
  /** Protocol 113: the repository's effective pull request automation when the item was queued. */
  automation?: { ciRetry: boolean; conflictResolution: boolean };
  /** Protocol 113: the conflict GitHub reported, bound to its durable conflict resolution record. */
  conflicts?: { id: string; headSha: string; headRef: string; baseRef: string; baseSha: string } | null;
}

const list = (values: readonly string[]) => values.length > 6 ? `${values.slice(0, 6).join(", ")} and ${values.length - 6} more` : values.join(", ");
const short = (sha: string) => sha.slice(0, 7);

export function lifecycleNotice(facts: LifecycleFacts): string {
  if (facts.trigger === "conflicts") return `Follow-up: PR #${facts.pr?.number ?? "?"} conflicts with ${facts.conflicts?.baseRef ?? "its base"}. Resolving it while keeping both sides' features.`;
  if (facts.trigger === "ci") return facts.ci?.repeated ? `Follow-up: the same CI checks failed again (${list(facts.ci.failing)}). Asking you before retrying.` :
    `Follow-up: CI failed on ${short(facts.ci?.headSha ?? "")} (${list(facts.ci?.failing ?? [])}).`;
  if (facts.trigger === "review") return `Follow-up: new review${(facts.reviews?.ids.length ?? 0) === 1 ? "" : "s"} on PR #${facts.pr?.number ?? "?"}${facts.reviews?.authors.length ? ` from ${list(facts.reviews.authors.map((author) => `@${author}`))}` : ""}.`;
  const steps = [facts.workspace === "managed-worktree" && facts.edits ? facts.pullRequests === "draft" ? "commit, push and update the pull request" : "commit the changes" : "",
    facts.workspace === "managed-worktree" && facts.edits && facts.pullRequests === "draft" ? "check CI and reviews" : "",
    facts.skills.length ? "review the skills used" : "", facts.parent ? "report to the parent session" : ""].filter(Boolean);
  return `Wrap-up: ${steps.join(", ") || "finish the session"}.`;
}

/** The model-facing checklist for one lifecycle turn. */
export function lifecycleGuidance(facts: LifecycleFacts): string {
  const json = (value: unknown) => JSON.stringify(value).replaceAll("<", "\\u003c");
  const pr = facts.pr ? `Session PR: ${json(facts.pr)}.` : "No PR is linked to this session yet.";
  const rules = "This is Moguri's lifecycle checklist, not a new user request. It grants no extra permission: approvals, hard policy and budgets still apply. Never merge, force-push, rebase shared history or delete branches unless the user asked.";
  const ask = facts.automation?.ciRetry ?
    "Fix broken CI is on for this repository: Moguri itself reruns failed GitHub Actions jobs whose logs and GitHub Status point to a transient cause, so never rerun jobs yourself. If the same failure repeats, or a failure looks flaky or caused by a provider outage, stop and ask the user with ask_user instead of changing code." :
    "If the same failure repeats, or a failure looks flaky (intermittent, a timeout, infrastructure, unrelated to this change, or passes on rerun), stop and ask the user with ask_user instead of retrying.";
  const merge = facts.automation?.conflictResolution ? conflictProtocol(facts.conflicts ?? null) : null;
  if (facts.trigger === "ci") {
    return `<moguri-session-follow-up trigger="ci">
${rules}
${pr}
CI failed on head ${json(facts.ci?.headSha)}: ${json(facts.ci?.failing ?? [])}.
${facts.ci?.repeated ? "These checks already failed after a previous fix attempt in this round. Do not try another fix. Read the failing logs, summarize the cause in two or three sentences and ask the user how to proceed with ask_user." :
  `Read the failing check logs (github_read checks, runs, jobs and logs on this head). If this change caused the failure, fix it once, validate locally, commit and push. ${ask}`}
End with a short status: what failed, what you changed and the new head, or why you stopped.
</moguri-session-follow-up>`;
  }
  if (facts.trigger === "conflicts") {
    return `<moguri-session-follow-up trigger="conflicts">
${rules}
${pr}
GitHub reports that head ${json(facts.conflicts?.headSha)} (branch ${json(facts.conflicts?.headRef)}) conflicts with base ${json(facts.conflicts?.baseRef)} at ${json(facts.conflicts?.baseSha)}. Automatic conflict resolution is on for this repository.
${conflictProtocol(facts.conflicts ?? null)}
End with a short status: each conflicted file and how both sides were kept, the checks you ran with their results, and the new head; or why you stopped and what the user must decide.
</moguri-session-follow-up>`;
  }
  if (facts.trigger === "review") {
    return `<moguri-session-follow-up trigger="review">
${rules}
${pr}
New review activity: ${json(facts.reviews)}.
Read the unresolved review threads and review comments (github_read threads, reviews and review-comments). Address each valid comment, validate, commit and push. When a comment is wrong or out of scope, explain why instead of changing code. Do not resolve threads on the reviewer's behalf. If nothing actionable remains, say so and stop; Moguri keeps watching for new reviews.
End with a short status: comments addressed, the new head, and anything left for the user.
</moguri-session-follow-up>`;
  }
  const steps: string[] = [];
  if (facts.workspace === "managed-worktree" && facts.edits) {
    steps.push(merge ?
      `Repository (Moguri-managed worktree, ${facts.edits} edit${facts.edits === 1 ? "" : "s"} this round): first commit every uncommitted change with a clear message. Then, if the base branch moved and this branch conflicts with it, resolve the conflicts first and keep both sides' intent, following this protocol:\n${merge}` :
      `Repository (Moguri-managed worktree, ${facts.edits} edit${facts.edits === 1 ? "" : "s"} this round): if the base branch moved and this branch conflicts with it, resolve the conflicts first and keep both sides' intent. Then commit every remaining uncommitted change with a clear message. Leave nothing uncommitted.`);
    steps.push(facts.pullRequests === "draft" ?
      `Pull request: ${facts.pr && facts.pr.state === "open" ? "push the branch to the existing PR and update its description if the change grew." : "push the branch and open a draft PR describing the change, unless the user said not to in this chat or the work clearly needs no PR. Reuse an existing PR for this branch instead of opening a duplicate."} Never claim a PR exists without its actual URL.` :
      "Pull request: this project opted out of automatic PRs. Commit only; open a PR just if the user asked for one.");
    if (facts.pullRequests === "draft") {
      steps.push(`CI: if the repository runs CI on the PR, check the latest head (github_read checks or runs, or a bounded \`gh pr checks --watch\`). If a check fails because of this change, fix it once and push. ${ask}`);
      steps.push("Reviews: if the PR has unresolved review comments, address the valid ones, push and reply briefly where useful. Do not resolve threads on the reviewer's behalf. If there are none, stop; Moguri watches for new reviews and CI after this turn.");
    }
  }
  if (facts.skills.length) steps.push(`Skills: this round loaded ${json(facts.skills)}. If one was wrong, outdated or missing a step this session needed, propose a concrete improvement with propose_skill (same name, complete revised content). Skip it when nothing reusable was learned. The user reviews proposals in Suggestions.`);
  if (facts.parent) steps.push("Parent session: this session was delegated by another session. If the parent needs the outcome, send it one concise summary with session_message.");
  return `<moguri-session-wrap-up trigger="round">
${rules}
The user's requests in this round are done. Work through these steps in order, skip any that do not apply and do not redo finished work.
${pr}
${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}
End with a short status: commit, PR URL, CI and review state, and anything blocked with its reason.
</moguri-session-wrap-up>`;
}

/**
 * The feature-preserving merge protocol used when automatic conflict resolution is on. Merging the base into the PR branch keeps
 * both histories; picking a side, concatenating blocks or rebasing shared history is never a resolution.
 */
export function conflictProtocol(conflict: LifecycleFacts["conflicts"] | null): string {
  const base = conflict ? `${conflict.baseRef}` : "the PR's base branch";
  return [
    "- Run git status first. If anything is uncommitted that isn't yours to commit, stop and ask with ask_user. Never stash, reset, checkout or clean files you didn't create.",
    `- Fetch ${base} from the upstream remote${conflict ? ` and confirm the PR head is still ${conflict.headSha}; if it moved, stop and report the new head` : ""}.`,
    `- Merge it into this branch with \`git merge --no-ff --no-commit\`. Never rebase, force-push, use -X ours/-X theirs, or check out --ours/--theirs for a conflicted file.`,
    "- For every conflicted file, read both sides and their merge base, name the feature or behavior each side adds, and write one result that keeps both. Choosing one side, or placing both blocks one after the other, is not a resolution. Keep unrelated changes from both sides untouched.",
    "- Validate before you call it resolved: run the relevant tests, type checks, linters and builds for every touched area, including tests that exercise both features. Fix only what the merge broke.",
    "- Only when both features demonstrably survive and the checks pass, commit the merge (it keeps both parents) and push. Say exactly which checks you ran and their results.",
    "- If you can't establish that both features survive (incompatible behavior, unclear intent, failing checks you can't fix without dropping a side), run `git merge --abort` so both originals stay intact, leave the conflict unresolved and ask the user with ask_user, describing what each side does. Never drop functionality to get a clean merge.",
  ].join("\n");
}

const STOP_WORDS = new Set(("the and for with that this from into onto over under then than also just make sure about after before again " +
  "can could should would will please need want like have has had are was were been being you your our its it's not but all any some " +
  "add fix use using update change now let lets get set new more less one two very only them they what when where which while who why how").split(" "));
const words = (text: string): Set<string> => new Set((text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) ?? [])
  .map((word) => word.replace(/(?:ing|ed|es|s)$/u, "")).filter((word) => word.length > 2 && !STOP_WORDS.has(word)));
/**
 * Cheap, deterministic gate for a title refresh: true only when a substantial new request shares almost no
 * vocabulary with the current topic. The naming model still decides the final title and may keep it.
 */
export function topicDrift(topic: readonly string[], next: string): boolean {
  const incoming = words(next);
  if (incoming.size < 6) return false;
  const known = new Set(topic.flatMap((text) => [...words(text)]));
  if (!known.size) return false;
  let shared = 0;
  for (const word of incoming) if (known.has(word)) shared++;
  return shared / incoming.size < 0.15;
}

export interface PrActivityCheck {
  name: string; status: string; conclusion: string | null;
  /** Check run details (protocol 113). For GitHub Actions, the check run ID is the job ID. Absent for commit statuses. */
  id?: number; app?: string | null; url?: string | null; startedAt?: string | null; completedAt?: string | null;
}
export interface PrActivity {
  headSha: string; headRef: string; state: "open" | "closed" | "merged"; author: string | null;
  /** GitHub's merge check (protocol 112); null while it is still computing, absent from older readers. */
  mergeable?: boolean | null; mergeableState?: string | null;
  /** The PR base (protocol 113), used to bind a conflict resolution. */
  baseRef?: string; baseSha?: string;
  reviews: { id: number; state: string; author: string | null; submittedAt: string | null }[];
  checks: PrActivityCheck[];
}
const FAILED = new Set(["failure", "timed_out", "startup_failure", "action_required"]);
/**
 * Decides one follow-up for an idle session from fresh PR activity and this round's earlier lifecycle items.
 * Reviews count only when submitted by someone other than the PR author after the latest lifecycle turn
 * finished; CI counts only once every check on the head finished and one failed.
 */
export function followUpFacts(input: {
  base: LifecycleFacts; earlier: readonly LifecycleFacts[]; activity: PrActivity; lastFinishedAt: number;
  /** Review and CI follow-ups (the wrap-up "follow up" switch). Default on. */
  followUps?: boolean;
  /** Failing checks that Fix broken CI is handling; the model is not asked to fix them meanwhile. */
  ciOwned?: ReadonlySet<string>;
  /** Automatic conflict resolution with the new record's ID. */
  conflicts?: { id: string } | null;
}): LifecycleFacts | null {
  const { base, earlier, activity } = input, followUps = input.followUps ?? true;
  if (activity.state !== "open") return null;
  const resolving = earlier.filter((facts) => facts.trigger === "conflicts");
  if (input.conflicts && (activity.mergeable === false || activity.mergeableState === "dirty") && activity.baseRef && activity.baseSha && activity.headRef &&
    !resolving.some((facts) => facts.conflicts?.headSha === activity.headSha) && resolving.length < CONFLICT_RESOLUTION_LIMITS.perRound) {
    return { ...base, trigger: "conflicts", pr: base.pr ? { ...base.pr, state: "open", headSha: activity.headSha } : null, ci: null, reviews: null, skills: [], edits: 0,
      conflicts: { id: input.conflicts.id, headSha: activity.headSha, headRef: activity.headRef, baseRef: activity.baseRef, baseSha: activity.baseSha } };
  }
  if (!followUps) return null;
  const handled = new Set(earlier.flatMap((facts) => facts.reviews?.ids ?? []));
  const fresh = activity.reviews.filter((review) => review.author !== null && review.author !== activity.author && !handled.has(review.id) &&
    ["COMMENTED", "CHANGES_REQUESTED"].includes(review.state) && review.submittedAt !== null && Date.parse(review.submittedAt) > input.lastFinishedAt);
  const pr = base.pr ? { ...base.pr, state: "open" as const, headSha: activity.headSha } : null;
  if (fresh.length && earlier.filter((facts) => facts.trigger === "review").length < LIFECYCLE_LIMITS.reviewFollowUps) {
    return { ...base, trigger: "review", pr, ci: null, skills: [], edits: 0,
      reviews: { ids: fresh.map((review) => review.id), authors: [...new Set(fresh.map((review) => review.author!))].sort() } };
  }
  if (!activity.checks.length || activity.checks.some((check) => check.status !== "completed")) return null;
  const failing = [...new Set(activity.checks.filter((check) => check.conclusion !== null && FAILED.has(check.conclusion) && !input.ciOwned?.has(check.name)).map((check) => check.name))].sort();
  if (!failing.length) return null;
  const ci = earlier.filter((facts) => facts.trigger === "ci");
  if (ci.some((facts) => facts.ci?.headSha === activity.headSha) || ci.some((facts) => facts.ci?.repeated)) return null;
  const repeated = ci.some((facts) => JSON.stringify(facts.ci?.failing) === JSON.stringify(failing));
  if (!repeated && ci.length >= LIFECYCLE_LIMITS.ciFollowUps) return null;
  return { ...base, trigger: "ci", pr, reviews: null, skills: [], edits: 0, ci: { headSha: activity.headSha, failing, repeated } };
}
