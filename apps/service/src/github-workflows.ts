import { createHash, randomUUID } from "node:crypto";
import { stripMarkdownComments } from "../../../packages/protocol/src/markdown.ts";
import { constants } from "node:fs";
import { isUtf8 } from "node:buffer";
import { lstat, mkdtemp, open, readFile, readdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MoguriError, observedPrReadiness, isRecord, parse, kanbanIssueSignature, readOnlySource, type CommandResult, type EventInput } from "../../../packages/protocol/src/index.ts";
import {
  GithubActionSchema, GithubBrowseSchema, GithubCiObservationSchema, GithubCommandSchema, GithubItemSchema, GithubOperationResultSchema, GithubQuerySchema, GithubRepositorySchema, GithubReviewDocumentSchema, githubCiOperationMatches, githubPrCiState, githubRootQuarantined, githubSourceOwner, durableSourceBinding, isGithubModelAction,
  type GithubAction, type GithubBrowse, type GithubGitState, type GithubItem, type GithubOperation,
  type GithubOperationResult, type GithubPreview, type GithubQuery, type GithubResponse, type GithubScope, type GithubCommand,
  type GithubCiObservation, type GithubCiState, type GithubReviewDocument, type GithubRepository, type GithubWorkSource, type GithubSourceBinding, type GitRead, type GitReadData,
} from "../../../packages/protocol/src/github-workflows.ts";
import type { WorkspaceInspection } from "../../../packages/protocol/src/worktrees.ts";
import { candidateGitState, gitUpstreamRemote, readGit, readGitBinding, readWorkspaceGit } from "./project-git.ts";
import { isProtectedProjectPath, scopedPath } from "./files.ts";
import { validateProjectPath } from "./project-policy.ts";
import { observedRepository } from "./repository-metadata.ts";
import { sameDurableRoot, sourceRoot, sourceRootSync } from "./repository-source.ts";
import { runProgram } from "./program.ts";
import { digest, type EventStore } from "./store.ts";
import type { CandidateJobLifecycle } from "./candidates.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import type { ModelAdviceSource } from "../../../packages/protocol/src/questions.ts";
import type { WorkflowHost } from "./workflow-host.ts";
import { applyRemoteChange, inspectRemoteChange } from "./project-remote.ts";
import { repositoryUrl } from "./project-clone.ts";
import { MyWorkObservationSchema, MyWorkRequestSchema, MyWorkThreadSchema, type MyWorkObservation, type MyWorkPull,
  type MyWorkSource } from "../../../packages/protocol/src/my-work.ts";
export { githubRootQuarantined };

export interface GitHubWorkflowOptions {
  runProgram?: typeof runProgram;
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  readTimeoutMs?: number;
  writeTimeoutMs?: number;
}
export interface GitToolAuthority {
  sessionId: string; callDigest: string; signal: AbortSignal; guard(): void;
}
interface ApiResponse { data: unknown; etag: string | null; next: boolean }
const sha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SECRET = /(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|Bearer\s+[^\s"']+|https?:\/\/[^/\s:@]+:[^@\s]+@)/gi;
const diagnostic = (error: unknown) => {
  if (error instanceof MoguriError && error.code === "program_failed") return "The installed Git/GitHub CLI rejected the exact request. Inspect the original target and local CLI configuration; raw hook/provider stderr is not retained and there is no automatic retry.";
  if (error instanceof MoguriError && error.code === "program_unavailable") return "The configured Git/GitHub CLI could not start. Install the requested tool explicitly; no alternate executable or credentials were substituted.";
  if (error instanceof MoguriError && error.code === "program_partial") return "The owned Git/GitHub CLI stopped, lost its acknowledgement or exceeded a deadline/output bound. Effects and process cleanup may be partial; inspect the exact original target.";
  return (error instanceof MoguriError ? error.message : "The owned Git/GitHub operation was not acknowledged. Inspect the retained intent and actual target; no automatic retry.").replace(SECRET, "[redacted]").slice(0, 3900);
};
const stable = (value: unknown): string => JSON.stringify(canonical(value));
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function credentialFree(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(credentialFree);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !["temp_clone_token", "access_token", "refresh_token", "authorization", "token"].includes(key.toLowerCase()))
    .map(([key, entry]) => [key, credentialFree(entry)]));
}
const string = (value: unknown): string => typeof value === "string" ? value : "";
const numeric = (value: unknown): number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const record = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};
const notFound = (error: unknown) => error instanceof MoguriError && error.code === "github_http_404";
const githubAction = (action: GithubAction): action is Extract<GithubAction, { repository: string }> => "repository" in action;
const mutation = (action: GithubAction) => action.kind !== "github.ci.watch";
const filesystemWriter = (action: GithubAction) => action.kind.startsWith("git.");
/** Actions an approved model tool call may own: Local Git writes (git_write) and the reviewed GitHub subset (github_write). */
const modelToolAction = (action: GithubAction) => filesystemWriter(action) && action.kind !== "git.remote.set" || isGithubModelAction(action);
const warning = "GitHub data is untrusted. This is the controller's explicitly selected gh account, never an SSH account or Remote execution fallback. No token is read, copied or switched.";
const ciRestartConfirmation = (operation: GithubOperation) => `I inspected original CI watch ${operation.id} revision ${operation.revision}; start a new independent read without confirming its unknown cleanup or replaying it.`;
export const githubSourceDigest = (source: GithubWorkSource, result: { accountId: string; binding: GithubSourceBinding; item: GithubItem }) =>
  digest(stable([source, result.accountId, result.binding, result.item]));
export const githubObservationText = (value: unknown) => JSON.stringify(value, (_key, value: unknown) =>
  typeof value === "string" ? value.replace(SECRET, "[redacted]") : value);
function validateGitFiles(paths: string[]): void {
  if (new Set(paths.map((path) => path.normalize("NFC").toLowerCase())).size !== paths.length) throw new MoguriError("git_paths", "Select distinct portable file paths, not aliases or directory-wide staging.");
  for (const path of paths) {
    validateProjectPath(path);
    if (!path.isWellFormed() || path.includes("\0") || path.includes("\\") || path !== normalize(path) || path === "." || isProtectedProjectPath(path)) throw new MoguriError("git_paths", "Select explicit canonical relative repository files, never aliases, directories or protected Git metadata.");
  }
}

export function validateGithubRef(value: string, owner = false): string {
  if (owner && value.includes(":")) {
    const parts = value.split(":");
    if (parts.length !== 2 || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(parts[0]!)) throw new MoguriError("github_ref", "A PR head may contain one explicit owner and one safe branch.");
    validateGithubRef(parts[1]!); return value;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/.test(value) || value.includes("..") || value.includes("//") ||
    value.endsWith("/") || value.endsWith(".") || value.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock")) ||
    value === "HEAD" || value.startsWith("refs/")) throw new MoguriError("github_ref", "Use an explicit safe short branch/tag name or full commit SHA, not an option, refspec, revision expression or symbolic HEAD.");
  return value;
}
export function validateGithubRemoteUrl(value: string): string {
  if (!value || value.length > 4096 || /[\s\0-\x1f\x7f]/.test(value) || value.startsWith("-") || SECRET.test(value)) {
    SECRET.lastIndex = 0; throw new MoguriError("github_remote", "Remote URLs must be explicit, bounded and credential-free. No URL was retained.");
  }
  SECRET.lastIndex = 0;
  if (isAbsolute(value)) return value;
  if (/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}@[A-Za-z0-9][A-Za-z0-9.-]{0,252}:[A-Za-z0-9_./~][A-Za-z0-9_./~-]*$/.test(value)) return value;
  let url: URL;
  try { url = new URL(value); } catch { throw new MoguriError("github_remote", "Use a credential-free HTTPS/SSH URL or an explicit absolute local Git remote."); }
  if (!["https:", "ssh:", "file:"].includes(url.protocol) && !(url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)) || url.password || url.search || url.hash ||
    url.protocol !== "ssh:" && url.username || url.protocol === "ssh:" && (!/^(?:[A-Za-z0-9_][A-Za-z0-9_.-]{0,63})?$/.test(url.username) || url.hostname.startsWith("-")) ||
    url.protocol === "file:" && url.host || url.protocol !== "file:" && !url.hostname ||
    url.protocol === "ssh:" && !/^[A-Za-z0-9_./~-]+$/.test(url.pathname)) throw new MoguriError("github_remote", "Remote credentials, custom helpers, URL query/fragment arguments and unsafe SSH paths are not supported. No URL was retained.");
  return value;
}
/** A provider rate limit, reported explicitly so a partial read is never presented as complete or as missing access. */
function rateLimited(status: number, reset: string | null): MoguriError {
  const at = reset && Number.isSafeInteger(Number(reset)) ? ` after ${new Date(Number(reset) * 1000).toISOString()}` : " later";
  return new MoguriError("github_rate_limited", `GitHub rate limit reached (HTTP ${status}). Reading stopped; retry${at}. Retained observations stay partial and nothing was retried automatically.`, status);
}
function items(value: unknown, field?: string): unknown[] {
  const selected = field ? record(value)[field] : value;
  if (!Array.isArray(selected)) throw new MoguriError("github_response", "GitHub returned an unsupported collection. No truncated or invented result was used.", 502);
  return selected;
}
function item(value: unknown, kind: GithubItem["kind"]): GithubItem {
  const data = record(value), head = record(data.head), base = record(data.base), author = record(data.user ?? data.author ?? data.actor);
  const workItem = ["issue", "pull", "comment", "review"].includes(kind);
  return {
    kind, id: numeric(data.id), ...(numeric(data.number) ? { number: numeric(data.number) } : {}),
    title: workItem ? stripMarkdownComments(string(data.title ?? data.name ?? data.context)) : string(data.title ?? data.name ?? data.context),
    body: workItem ? stripMarkdownComments(string(data.body)) : string(data.body), state: kind === "pull" && (data.merged === true || !!string(data.merged_at)) ? "merged" : string(data.state ?? data.status),
    url: string(data.html_url ?? data.details_url ?? data.target_url) || null,
    updatedAt: string(data.updated_at ?? data.submitted_at ?? data.completed_at) || null, author: string(author.login) || null,
    headSha: string(data.head_sha ?? data.commit_id ?? head.sha) || null, conclusion: string(data.conclusion) || null,
    ...(kind === "release" ? { tag: string(data.tag_name), target: string(data.target_commitish), draft: data.draft === true, prerelease: data.prerelease === true } : {}),
    ...(kind === "pull" ? { base: string(base.ref), head: string(head.ref), draft: data.draft === true,
      ...(observedPrReadiness(data) !== undefined ? { readyToMerge: observedPrReadiness(data), mergeState: string(data.mergeable_state) } : {}),
      ...(string(record(head.repo).full_name) ? { headRepository: string(record(head.repo).full_name) } : {}) } : {}),
    ...(kind === "file" ? { title: string(data.filename), path: string(data.filename), state: string(data.status),
      additions: numeric(data.additions), deletions: numeric(data.deletions), patch: typeof data.patch === "string" ? data.patch : null,
      url: string(data.blob_url) || null } : {}),
    ...(kind === "comment" && string(data.path) ? { path: string(data.path), ...(numeric(data.line) ? { line: numeric(data.line) } : {}) } : {}),
    ...(kind === "job" && Array.isArray(data.steps) ? { steps: data.steps.map((step) => ({ name: string(record(step).name),
      status: string(record(step).status), conclusion: string(record(step).conclusion) || null })) } : {}),
    ...(kind === "tag" ? { title: string(data.name), tag: string(data.name), body: "", state: "", url: null, headSha: sha.test(string(record(data.commit).sha)) ? string(record(data.commit).sha) : null } : {}),
    ...(kind === "annotation" ? { title: string(data.title) || string(data.path), body: [string(data.message), string(data.raw_details)].filter(Boolean).join("\n\n"),
      state: string(data.annotation_level), url: string(data.blob_href) || null, headSha: null,
      ...(string(data.path) ? { path: string(data.path) } : {}), ...(numeric(data.start_line) ? { line: numeric(data.start_line) } : {}) } : {}),
    ...(kind === "content" ? contentItem(data) : {}),
    ...(kind === "settings" ? { title: string(data.full_name), state: string(data.visibility), body: JSON.stringify(Object.fromEntries(REPOSITORY_SETTINGS
      .filter((key) => data[key] !== undefined).map((key) => [key, data[key]])), null, 2), url: string(data.html_url) || null, headSha: null } : {}),
    ...(kind === "ruleset" ? { title: string(data.name), state: string(data.enforcement), url: string(record(record(data._links).html).href) || null, headSha: null,
      body: JSON.stringify({ target: data.target ?? null, sourceType: data.source_type ?? null, source: data.source ?? null }) } : {}),
    ...(kind === "rule" ? { id: numeric(data.ruleset_id), title: string(data.type), state: string(data.ruleset_source_type), conclusion: string(data.ruleset_source) || null,
      body: JSON.stringify(data.parameters ?? {}), url: null, headSha: null } : {}),
    ...(kind === "issue" || kind === "pull" ? workItemMetadata(data, kind) : {}),
    ...(kind === "check" || kind === "run" || kind === "job" ? ciMetadata(data, kind) : {}),
    ...(kind === "label" ? { title: string(data.name), body: string(data.description), state: string(data.color), url: null, headSha: null } : {}),
    ...(kind === "user" ? { title: string(data.login), body: "", state: "", author: string(data.login) || null, headSha: null } : {}),
  };
}
const logins = (value: unknown[]) => value.map((entry) => string(record(entry).login)).filter(Boolean);
/** Protocol 118 (D64): labels, assignees, requested users and counts, emitted only when GitHub returned them. */
function workItemMetadata(data: Record<string, unknown>, kind: "issue" | "pull"): Partial<GithubItem> {
  return {
    ...(Array.isArray(data.labels) ? { labels: data.labels.map((label) => typeof label === "string" ? { name: label, color: null } :
      { name: string(record(label).name), color: string(record(label).color) || null }).filter((label) => label.name) } : {}),
    ...(Array.isArray(data.assignees) ? { assignees: logins(data.assignees) } : {}),
    ...(kind === "pull" && Array.isArray(data.requested_reviewers) ? { reviewers: logins(data.requested_reviewers) } : {}),
    ...(typeof data.created_at === "string" ? { createdAt: data.created_at } : {}),
    ...(kind === "pull" && typeof data.commits === "number" ? { commits: numeric(data.commits) } : {}),
    ...(kind === "pull" && typeof data.changed_files === "number" ? { changedFiles: numeric(data.changed_files) } : {}),
  };
}
/** Protocol 118 (D64): start time, GitHub app and, for GitHub Actions check runs, the workflow run that produced the job. */
function ciMetadata(data: Record<string, unknown>, kind: "check" | "run" | "job"): Partial<GithubItem> {
  const started = kind === "run" ? data.run_started_at : data.started_at, app = string(record(data.app).slug);
  const run = kind === "job" ? numeric(data.run_id) : kind === "check" && app === "github-actions" ?
    Number([string(data.html_url), string(data.details_url)].map((url) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/job\/\d+/.exec(url)?.[1])
      .find(Boolean) ?? 0) : 0;
  return { ...(typeof started === "string" ? { startedAt: started } : {}), ...(app ? { app } : {}),
    ...(Number.isSafeInteger(run) && run > 0 ? { runId: run } : {}) };
}
const COMMIT_MESSAGE = 512 * 1024;
const firstLine = (message: string) => message.split(/\r?\n/, 1)[0]!.slice(0, 2048);
/** A PR commit or timeline commit: headSha is the commit SHA, title its message's first line and body the complete message. */
function commitItem(value: unknown, id: number): GithubItem {
  const data = record(value), commit = isRecord(data.commit) ? data.commit : data, author = record(commit.author), committer = record(commit.committer);
  const message = string(commit.message), commitSha = string(data.sha);
  if (message.length > COMMIT_MESSAGE) throw new MoguriError("github_limit", "A commit message exceeds 512 KiB. No truncated message was returned.", 409);
  return { kind: "commit", id, title: firstLine(message), body: message, state: "", url: string(data.html_url) || null,
    updatedAt: string(committer.date ?? author.date) || null, author: string(record(data.author).login) || string(author.name) || null,
    headSha: sha.test(commitSha) ? commitSha : null, conclusion: null };
}
/** Maps one timeline entry to commit, review, comment or event items. Events keep GitHub's event name in state and their subject in title. */
function timelineItems(value: unknown): GithubItem[] {
  const data = record(value), event = string(data.event);
  if (event === "committed") return [commitItem(value, 0)];
  if (event === "reviewed") return [{ ...item(value, "review"), state: string(data.state).toUpperCase(), updatedAt: string(data.submitted_at) || null }];
  if (event === "commented") return [item(value, "comment")];
  if (event === "line-commented" || event === "commit-commented") return Array.isArray(data.comments) ? data.comments.map((comment) => item(comment, "comment")) : [];
  const source = record(record(data.source).issue), label = record(data.label), rename = record(data.rename);
  const subject = event === "renamed" ? string(rename.to) : ["labeled", "unlabeled"].includes(event) ? string(label.name) :
    ["assigned", "unassigned"].includes(event) ? string(record(data.assignee).login) :
    ["review_requested", "review_request_removed"].includes(event) ? string(record(data.requested_reviewer).login) || string(record(data.requested_team).slug) :
    ["milestoned", "demilestoned"].includes(event) ? string(record(data.milestone).title) :
    event === "cross-referenced" ? string(source.title) : string(data.ref ?? data.commit_id);
  return [{ kind: "event", id: numeric(data.id), title: stripMarkdownComments(subject), body: event === "renamed" ? stripMarkdownComments(string(rename.from)) : "", state: event,
    url: string(source.html_url ?? data.html_url) || null, updatedAt: string(data.created_at) || null,
    author: string(record(data.actor).login) || null, headSha: sha.test(string(data.commit_id)) ? string(data.commit_id) : null,
    conclusion: null, ...(event === "labeled" || event === "unlabeled" ? { labels: [{ name: string(label.name), color: string(label.color) || null }] } : {}) }];
}
/** Repository fields the settings view reports and `github.repo.settings` may change (the latter only the editable subset). */
const REPOSITORY_SETTINGS = ["default_branch", "visibility", "private", "archived", "description", "homepage", "topics", "has_issues", "has_projects",
  "has_wiki", "has_discussions", "has_pages", "allow_merge_commit", "allow_squash_merge", "allow_rebase_merge", "allow_auto_merge", "allow_update_branch",
  "delete_branch_on_merge", "squash_merge_commit_title", "squash_merge_commit_message", "merge_commit_title", "merge_commit_message",
  "web_commit_signoff_required", "security_and_analysis", "permissions"] as const;
/** Files must fit the agent's complete tool view (MAX_TEXT) after JSON escaping, with room for the page around them. */
const CONTENT_VIEW = 96 * 1024;
/** A file's UTF-8 text (bounded) or a directory entry. Binary, oversized or undecodable files report why instead of returning bytes. */
function contentItem(data: Record<string, unknown>): Partial<GithubItem> {
  const type = string(data.type), base: Partial<GithubItem> = { title: string(data.name), path: string(data.path) || string(data.name), state: type,
    url: string(data.html_url) || null, headSha: sha.test(string(data.sha)) ? string(data.sha) : null, body: "", conclusion: null };
  if (type !== "file" || typeof data.content !== "string") return base;
  if (data.encoding !== "base64") return { ...base, conclusion: "not-inline" };
  const bytes = Buffer.from(data.content.replace(/\s/g, ""), "base64");
  if (bytes.length > CONTENT_VIEW) return { ...base, conclusion: "too-large" };
  if (!isUtf8(bytes)) return { ...base, conclusion: "binary" };
  const text = bytes.toString("utf8");
  return JSON.stringify(text).length > CONTENT_VIEW ? { ...base, conclusion: "too-large" } : { ...base, body: text };
}
const visibleItem = (value: GithubItem): GithubItem => ["issue", "pull", "comment", "review"].includes(value.kind) ?
  { ...value, title: stripMarkdownComments(value.title), body: stripMarkdownComments(value.body) } : value;
function visibleResource(resource: GithubReviewDocument["resource"]): GithubReviewDocument["resource"] {
  if (!resource) return null;
  let value: unknown;
  try { value = JSON.parse(resource.content); }
  catch { throw new MoguriError("github_corrupt", "The original reviewed GitHub source is not valid structured content. No unfiltered or replacement source was used.", 409); }
  const content = stable(JSON.parse(JSON.stringify(value, (key, value: unknown) =>
    (key === "title" || key === "body") && typeof value === "string" ? stripMarkdownComments(value) : value)));
  return content === resource.content ? resource : { ...resource, content, contentViewDigest: digest(content) };
}
export function githubCiState(values: GithubItem[]): "no-checks" | "pending" | "failure" | "success" {
  if (!values.length) return "no-checks";
  if (values.some((value) => value.kind === "status" ? ["failure", "error"].includes(value.state) :
    ["failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"].includes(value.conclusion ?? ""))) return "failure";
  if (values.some((value) => value.kind === "status" ? value.state !== "success" :
    value.state !== "completed" || !["success", "neutral", "skipped"].includes(value.conclusion ?? ""))) return "pending";
  return "success";
}

export class GitHubWorkflows {
  private readonly run: typeof runProgram;
  private readonly now: () => number;
  private readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly roots = new Set<string>();
  private readonly pendingRoots = new Set<string>();
  private readonly active = new Map<string, AbortController>();
  private readonly results = new Map<string, { value: GithubOperationResult; digest?: string }>();
  private readonly shutdown = new AbortController();
  private credentialEpoch = 0;
  constructor(private readonly store: EventStore, private readonly host: WorkflowHost, private readonly options: GitHubWorkflowOptions = {}) {
    this.run = options.runProgram ?? runProgram; this.now = options.now ?? Date.now;
    this.wait = options.wait ?? (async (ms, signal) => { await delay(ms, undefined, { signal }); });
  }
  private operations(): GithubOperation[] { return this.host.snapshot().githubOperations; }
  private operation(id: string): GithubOperation {
    const value = this.operations().find((value) => value.id === id);
    if (!value || value.profileId !== this.host.snapshot().profileId) throw new MoguriError("github_missing", "This independently retained operation is missing or belongs to another profile.", 404);
    return value;
  }
  private event(operation: GithubOperation): EventInput {
    return { event_type: "github.operation_recorded", profile_id: operation.profileId, project_id: operation.projectId,
      session_id: operation.originSessionId, payload: { operation } };
  }
  private update(id: string, changes: Partial<GithubOperation>): GithubOperation {
    const previous = this.operation(id), next = { ...previous, ...changes, revision: previous.revision + 1, updatedAt: new Date(this.now()).toISOString() };
    this.host.commit([this.event(next)]); return next;
  }
  private permitRebaseRecovery(root: GithubReviewDocument["root"], action: GithubAction | undefined, actual?: GithubGitState | null): boolean {
    if (action?.kind !== "git.rebase" || action.mode === "start" || !actual?.rebaseDigest || !actual.rebaseOriginalHead || !actual.rebaseOnto) return false;
    const holds = this.operations().filter((operation) => operation.root.root === root.root && operation.status === "partial" &&
      operation.kind.startsWith("git.") && !operation.inspection);
    return holds.length > 0 && holds.every((operation) => {
      if (operation.profileId !== this.host.snapshot().profileId || operation.kind !== "git.rebase" || !operation.resultDigest ||
        !sameDurableRoot(operation.root, root)) return false;
      try {
        const result = parse(GithubOperationResultSchema, JSON.parse(this.store.blob(operation.resultDigest)));
        const review = parse(GithubReviewDocumentSchema, JSON.parse(this.store.blob(operation.reviewDigest)));
        return result.operationId === operation.id && result.kind === "git.rebase" && result.outcome === "conflicts" && result.rebaseInProgress &&
          review.profileId === operation.profileId && sameDurableRoot(review.root, root) && review.action.kind === "git.rebase" &&
          actual.rebaseOriginalHead === (review.action.mode === "start" ? review.git.head : review.git.rebaseOriginalHead) &&
          actual.rebaseOnto === (review.action.mode === "start" ? review.targetSha : review.git.rebaseOnto);
      } catch { return false; }
    });
  }
  private policy(scope: GithubScope, action?: GithubAction, observation = false): string {
    const ci = action?.kind === "github.ci.watch" && action.prNumber !== undefined;
    observation ||= ci;
    const snapshot = this.host.snapshot(), configuration = this.host.configuration(scope.projectId);
    if (this.shutdown.signal.aborted || this.host.closing(scope.projectId)) throw new MoguriError("github_closing", "The service or project is closing. No new Git/GitHub operation was admitted.", 409);
    if (scope.env !== "Local" || !snapshot.policy.allowedEnvs.includes("Local")) throw new MoguriError("github_env", "This operation requires explicitly allowed Local project execution. Remote/Sandbox policies never fall back to Local.", 403);
    const session = scope.sessionId ? snapshot.sessions.find((session) => session.id === scope.sessionId) : undefined;
    if (scope.sessionId && (!session || session.projectId !== scope.projectId || session.workspaceId !== (scope.workspaceId ?? null) ||
      session.controls.env !== "Local" || session.status === "archived")) throw new MoguriError("github_scope", "The exact active Local session/project/workspace binding changed. No previous or base root was substituted.", 409);
    if (action && mutation(action) && session && (session.kind !== "agent" || session.mode !== "agent" || session.pendingMode === "read-only")) throw new MoguriError("read_only", "Side/read-only sessions cannot perform Git or GitHub mutations.", 403);
    if (action && filesystemWriter(action) && !scope.workspaceId && readOnlySource(snapshot.projects.find((project) => project.id === scope.projectId))) {
      throw new MoguriError("project_read_only", "This project comes from a workspace folder, so Moguri doesn't run Git writes in it. Use a session's worktree instead.", 409);
    }
    if (action && filesystemWriter(action) && (scope.workspaceId ? snapshot.blockedWorkspaces.includes(scope.workspaceId) : snapshot.blockedProjects.includes(scope.projectId)) &&
      !(action.kind === "git.rebase" && action.mode !== "start")) throw new MoguriError("github_quarantined", "This root has retained uncertain effects. Ordinary Git writes cannot bypass quarantine. Only an exact in-progress rebase continue/abort may be separately reviewed; it does not clear unrelated uncertainty.", 409);
    if (configuration.values.deniedFolders.length || action && mutation(action) && configuration.values.readOnlyFolders.length) throw new MoguriError("folder_containment", "Native Local Git hooks/gh cannot enforce descendant folder restrictions. A qualified SendBox boundary is required; this explicit Local workflow does not bypass them.", 403);
    const permissions = snapshot.settings.values.permissions;
    if (action && permissions.tools.some((rule) => rule.decision === "deny" &&
      ["*", "run_command", action.kind, githubAction(action) ? "github" : "git", ...(filesystemWriter(action) ? ["git_write"] : []), ...(isGithubModelAction(action) ? ["github_write"] : [])].includes(rule.tool))) throw new MoguriError("github_denied", "A hard user tool denial excludes this Git/GitHub operation. Review cannot override policy.", 403);
    if (action && permissions.commands.some((rule) => rule.decision === "deny" && rule.command === action.kind)) throw new MoguriError("github_denied", "A hard exact-command denial excludes this operation.", 403);
    return digest(stable({ profileId: snapshot.profileId, policy: snapshot.policy, permissionRevision: snapshot.settings.permissionRevision,
      permissions, configuration: observation ? configuration.values : configuration, ...(action && githubAction(action) ? { credentialEpoch: this.credentialEpoch } : {}), session: session ? { id: session.id, projectId: session.projectId, workspaceId: session.workspaceId,
        env: session.controls.env, kind: session.kind, mode: session.mode, pendingMode: session.pendingMode,
        ...(action && !ci ? { status: session.status } : {}) } : null }));
  }
  private async context(scope: GithubScope, action: GithubAction | undefined, signal: AbortSignal, jobId?: string, projectWorkId?: string, toolAuthority?: GitToolAuthority, observation = false) {
    toolAuthority?.guard();
    const ownerSessionId = toolAuthority?.sessionId ?? (projectWorkId && action ? this.workAuthority(scope, action, projectWorkId) : undefined);
    const policyDigest = this.policy(scope, action, observation), project = this.host.project(scope.projectId, scope.workspaceId);
    await this.host.assertRoot(scope.projectId, scope.workspaceId, signal);
    const root = await sourceRoot(project.path);
    const recoveryState = action?.kind === "git.rebase" && action.mode !== "start" ? await this.gitState(root.root, signal) : null;
    const current = () => {
      signal.throwIfAborted();
      toolAuthority?.guard();
      if (this.policy(scope, action, observation) !== policyDigest || this.host.project(scope.projectId, scope.workspaceId).path !== root.root ||
        stable(sourceRootSync(root.root)) !== stable(root)) throw new MoguriError("github_stale", "The reviewed root identity, session or policy changed. No stale authority or fallback root was used.", 409);
      if (action && filesystemWriter(action)) {
        const permit = this.permitRebaseRecovery(root, action, recoveryState);
        if (githubRootQuarantined(this.host.snapshot(), root.root) && !permit) throw new MoguriError("github_quarantined", "This exact captured root has uninspected partial Git effects, regardless of project/workspace aliases. Inspect the retained operation explicitly; no unknown effects were cleared.", 409);
        if (projectWorkId && action) this.workAuthority(scope, action, projectWorkId);
        if (this.host.rootBusy(root.root, jobId, permit, ownerSessionId) || !jobId && (this.roots.has(root.root) || this.pendingRoots.has(root.root))) throw new MoguriError("workspace_busy", "Another owned writer or unrelated root uncertainty holds this exact Local root. No concurrent Git mutation or quarantine bypass was admitted.", 409);
      }
    };
    current(); return { root, policyDigest, current, recoveryState };
  }
  private async git(root: string, args: string[], signal: AbortSignal, write = false, environment: NodeJS.ProcessEnv = {}): Promise<string> {
    const command = ["--no-pager", "-c", "core.fsmonitor=false", "--literal-pathspecs", ...args];
    if (write && this.host.snapshot().settings.values.permissions.commands.some((rule) => rule.decision === "deny" && rule.command === ["git", ...command].join(" "))) throw new MoguriError("github_denied", "The exact Git invocation is denied by user policy.", 403);
    try {
      return await this.run("git", command, { cwd: root, signal, label: write ? "Reviewed Git operation" : "Read reviewed Git state",
        timeoutMs: write ? this.options.writeTimeoutMs ?? 120_000 : this.options.readTimeoutMs ?? 30_000, maxBytes: 512 * 1024,
        env: { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: write ? "1" : "0", GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true",
          ...(process.env.SSH_AUTH_SOCK ? { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK } : {}), ...environment } });
    } catch (error) { throw new MoguriError(error instanceof MoguriError ? error.code : "github_program", diagnostic(error), error instanceof MoguriError ? error.status : 502); }
  }
  private async gitState(root: string, signal: AbortSignal): Promise<GithubGitState> {
    const binding = await readGitBinding(root, signal), [state, indexName, gitDirectory, config] = await Promise.all([
      candidateGitState(root, signal), this.git(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"], signal),
      this.git(root, ["rev-parse", "--absolute-git-dir"], signal),
      this.git(root, ["config", "--null", "--list"], signal),
    ]);
    const index = indexName.trim(), directory = await realpath(gitDirectory.trim());
    if (!isAbsolute(index) || resolve(index) !== index || await realpath(resolve(index, "..")) !== directory) throw new MoguriError("github_index", "Git's index is not the exact bound worktree index. No alternate index or fallback was used.", 409);
    let indexBytes: Buffer;
    try {
      const metadata = await lstat(index);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 32 * 1024 * 1024) throw new MoguriError("github_index", "The bound Git index is a symlink, unsupported or exceeds its bound.", 409);
      indexBytes = await readFile(index);
    } catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") indexBytes = Buffer.from("absent-index"); else throw error; }
    const parsed = JSON.parse(state) as { status: string; worktree: string; index: string };
    const rebases: Array<{ name: string; files: Array<{ name: string; digest: string; text?: string }> }> = [];
    for (const name of ["rebase-merge", "rebase-apply"]) {
      const path = join(directory, name);
      let metadata;
      try { metadata = await lstat(path); } catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") continue; throw error; }
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new MoguriError("github_rebase", "The in-progress rebase metadata is not an owned directory.", 409);
      const names = (await readdir(path)).sort();
      if (names.length > 200) throw new MoguriError("github_rebase", "The in-progress rebase exceeds the bounded metadata review.", 409);
      const files: Array<{ name: string; digest: string; text?: string }> = [];
      for (const name of names) {
        const file = join(path, name), entry = await lstat(file);
        if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 1024 * 1024) throw new MoguriError("github_rebase", "The rebase metadata contains an unsupported entry. Preserve it and inspect with Git.", 409);
        const bytes = await readFile(file);
        files.push({ name, digest: createHash("sha256").update(bytes).digest("hex"),
          ...(["orig-head", "onto", "head-name"].includes(name) ? { text: bytes.toString("utf8").trim() } : {}) });
      }
      rebases.push({ name, files });
    }
    const original = rebases.flatMap((entry) => entry.files).find((entry) => entry.name === "orig-head")?.text ?? null;
    const onto = rebases.flatMap((entry) => entry.files).find((entry) => entry.name === "onto")?.text ?? null;
    const headName = rebases.flatMap((entry) => entry.files).find((entry) => entry.name === "head-name")?.text;
    const rebaseBranch = headName?.startsWith("refs/heads/") ? validateGithubRef(headName.slice("refs/heads/".length)) : null;
    if (rebases.length > 1 || original && !sha.test(original) || onto && !sha.test(onto)) throw new MoguriError("github_rebase", "The current rebase identity is unsupported or ambiguous.", 409);
    return { commonDir: binding.gitCommonDir, head: binding.head, branch: binding.branch, configDigest: digest(config),
      indexDigest: createHash("sha256").update(indexBytes).digest("hex"), statusDigest: digest(parsed.status),
      worktreeDigest: digest(state), status: parsed.status.replaceAll("\0", "\n"),
      rebaseDigest: rebases.length ? digest(stable(rebases)) : null, rebaseOriginalHead: original, rebaseOnto: onto, rebaseBranch };
  }
  private async indexEntries(root: string, signal: AbortSignal) {
    const output = await readGit(root, ["ls-files", "--stage", "-z"], signal);
    return output.split("\0").filter(Boolean).map((line) => {
      const match = line.match(/^([0-9]{6}) ([a-f0-9]{40}(?:[a-f0-9]{24})?) ([0-3])\t([\s\S]+)$/);
      if (!match) throw new MoguriError("git_index", "Git returned an unsupported exact index entry. No stage or commit was inferred.", 409);
      return { path: match[4]!, mode: match[1]!, sha: match[2]!, stage: Number(match[3]) };
    });
  }
  private async treeEntries(root: string, base: string, signal: AbortSignal) {
    return (await readGit(root, ["ls-tree", "-r", "-z", base], signal)).split("\0").filter(Boolean).map((line) => {
      const match = line.match(/^([0-9]{6}) (?:blob|commit) ([a-f0-9]{40}(?:[a-f0-9]{24})?)\t([\s\S]+)$/);
      if (!match) throw new MoguriError("git_tree", "Git returned an unsupported exact committed tree.", 409);
      return { path: match[3]!, mode: match[1]!, sha: match[2]!, stage: 0 };
    });
  }
  private async workingTreeDigest(root: string, base: string, signal: AbortSignal, exclude: string[] = []) {
    let paths: string[] = [];
    if (exclude.length) {
      const selected = new Set(exclude), entries = [...await this.indexEntries(root, signal), ...await this.treeEntries(root, base, signal)];
      paths = [...new Set(entries.map((entry) => entry.path).filter((path) => !selected.has(path)))].sort();
      if (!paths.length) return digest("");
    }
    return digest(await readGit(root, ["diff", "--binary", "--no-ext-diff", "--no-textconv", "--no-renames", base, "--", ...paths], signal));
  }
  private async noIntegration(root: string, signal: AbortSignal): Promise<void> {
    for (const name of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"]) {
      const marker = (await readGit(root, ["rev-parse", "--git-path", name], signal)).trim();
      try { await lstat(resolve(root, marker)); throw new MoguriError("git_integration", "Resolve the current merge/cherry-pick/revert explicitly before this Git operation. No abort, reset or stash was performed.", 409); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    }
  }
  private effectScope(document: GithubReviewDocument, signal: AbortSignal): void {
    signal.throwIfAborted();
    if (this.policy(document.scope, document.action) !== document.policyDigest ||
      !sameDurableRoot(document.root, sourceRootSync(document.root.root)) ||
      this.host.project(document.scope.projectId, document.scope.workspaceId).path !== document.root.root) {
      throw new MoguriError("github_stale", "The captured Git root identity, owner or current policy changed. Inspect the retained operation; no replacement checkout was used.", 409);
    }
  }
  private async reviewedFiles(root: string, paths: string[], signal: AbortSignal): Promise<NonNullable<GithubReviewDocument["files"]>> {
    validateGitFiles(paths);
    const files: NonNullable<GithubReviewDocument["files"]> = [];
    let totalBytes = 0;
    const format = (await readGit(root, ["rev-parse", "--show-object-format"], signal)).trim();
    if (format !== "sha1" && format !== "sha256") throw new MoguriError("git_format", "This Git object format is not supported by exact-byte staging.", 409);
    for (const path of paths) {
      signal.throwIfAborted();
      const absolute = await scopedPath(root, path, true);
      let file: Awaited<ReturnType<typeof open>>;
      try { file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        files.push({ path, digest: null, blob: null, mode: null, bytes: 0 }); continue;
      }
      try {
        const metadata = await file.stat(), buffer = Buffer.alloc(2 * 1024 * 1024 + 1);
        if (!metadata.isFile() || metadata.size >= buffer.length) throw new MoguriError("git_paths", "Built-in staging accepts regular files up to 2 MiB each, not directories, links or submodules.", 409);
        let length = 0;
        while (length < buffer.length) {
          signal.throwIfAborted();
          const read = await file.read(buffer, length, buffer.length - length, length);
          if (!read.bytesRead) break;
          length += read.bytesRead;
        }
        if (length === buffer.length) throw new MoguriError("git_paths", "The selected file grew beyond its exact staging bound. No file prefix was accepted.", 409);
        const bytes = buffer.subarray(0, length), current = await lstat(await scopedPath(root, path));
        const blob = (await readGit(root, ["hash-object", "--no-filters", "--", path], signal)).trim();
        const expected = createHash(format).update(`blob ${length}\0`).update(bytes).digest("hex");
        if (!sha.test(blob) || blob !== expected || metadata.dev !== current.dev || metadata.ino !== current.ino ||
          metadata.mode !== current.mode) throw new MoguriError("git_file_changed", "A selected file changed while its original bytes were captured. Review it again before staging.", 409);
        files.push({ path, digest: createHash("sha256").update(bytes).digest("hex"), blob, mode: metadata.mode & 0o111 ? "100755" : "100644", bytes: bytes.length });
        totalBytes += bytes.length;
        if (totalBytes > 8 * 1024 * 1024) throw new MoguriError("git_paths", "The complete staging review exceeds 8 MiB. Select a smaller exact set; no file prefix was staged.", 409);
      } finally { await file.close(); }
    }
    return files;
  }
  private async gitRead(scope: GithubScope, input: GitRead, signal: AbortSignal): Promise<Extract<GithubResponse, { type: "git.read" }>> {
    const permissions = this.host.snapshot().settings.values.permissions;
    if (permissions.tools.some((rule) => rule.decision === "deny" && ["*", "git", "git_read", "run_command"].includes(rule.tool))) throw new MoguriError("github_denied", "A hard user denial excludes this built-in Git read.", 403);
    const context = await this.context(scope, undefined, signal), root = context.root.root, git = await this.gitState(root, signal);
    let data: GitReadData;
    if (input.action === "status") data = { action: input.action, status: git.status };
    else if (input.action === "branches") {
      const output = await readGit(root, ["for-each-ref", "--format=%(refname:short)%09%(objectname)%09%(upstream:short)", "refs/heads", "refs/remotes"], signal);
      data = { action: input.action, branches: output.trimEnd().split("\n").filter(Boolean).map((line) => {
        const [name, hash, upstream] = line.split("\t");
        if (!name || !hash || !sha.test(hash)) throw new MoguriError("git_response", "Git returned an invalid exact branch identity.", 409);
        return { name, sha: hash, upstream: upstream || null };
      }) };
    } else if (input.action === "log") {
      const head = input.head ?? git.head, offset = input.offset ?? 0, limit = input.limit ?? 20;
      const output = await readGit(root, ["log", "--no-show-signature", `--max-count=${limit + 1}`, `--skip=${offset}`, "--format=%H%x09%P%x09%s", head, "--"], signal);
      const commits = output.trimEnd().split("\n").filter(Boolean).map((line) => {
        const [hash, parents, ...subject] = line.split("\t"), parentIds = parents ? parents.split(" ") : [];
        if (!hash || !sha.test(hash) || parentIds.some((parent) => !sha.test(parent))) throw new MoguriError("git_response", "Git returned an invalid exact history identity.", 409);
        return { sha: hash, parents: parentIds, subject: subject.join("\t") };
      });
      data = { action: input.action, head, commits: commits.slice(0, limit), nextOffset: commits.length > limit ? offset + limit : null };
    } else {
      if (input.action === "diff" && input.path) {
        validateProjectPath(input.path);
        if (isProtectedProjectPath(input.path)) throw new MoguriError("git_paths", "Protected Git metadata is not a diff source.", 403);
      }
      const text = await readGit(root, input.action === "show" ?
        ["show", "--no-show-signature", "--no-ext-diff", "--no-textconv", "--no-renames", "--format=fuller", input.commit, "--"] :
        ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", ...(input.staged ? ["--cached"] : []), "--", input.path ?? "."], signal);
      data = { action: input.action, text };
    }
    context.current(); return { type: "git.read", root: context.root, git, data };
  }
  private async remote(root: string, name: string, ref: string, signal: AbortSignal, expectedUrl?: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(name)) throw new MoguriError("github_remote", "Select one configured safe Git remote name.");
    const urls = (await this.git(root, ["remote", "get-url", "--push", "--all", name], signal)).trim().split("\n");
    if (urls.length !== 1) throw new MoguriError("github_remote", "This workflow requires exactly one captured push URL; multiple destinations need separate reviews.", 409);
    const url = validateGithubRemoteUrl(urls[0]!);
    if (expectedUrl !== undefined && url !== expectedUrl) throw new MoguriError("github_remote", "The exact captured push URL changed. No ref was read or written at the replacement destination.", 409);
    const output = await this.git(root, ["ls-remote", "--refs", "--", url, ref], signal), entries = output.trim() ? output.trim().split("\n") : [];
    if (entries.length > 1 || entries.some((entry) => { const [value, target] = entry.split("\t"); return !sha.test(value ?? "") || target !== ref; })) throw new MoguriError("github_remote", "Git returned an ambiguous remote ref; nothing was selected implicitly.", 409);
    return { name, url, ref, sha: entries.length ? entries[0]!.split("\t")[0]! : null };
  }
  private async commitRef(root: string, value: string, signal: AbortSignal): Promise<string> {
    validateGithubRef(value);
    let target = value;
    if (!sha.test(value)) {
      const choices = [`refs/heads/${value}`, `refs/tags/${value}`, `refs/remotes/${value}`];
      const found = (await this.git(root, ["for-each-ref", "--format=%(refname)", ...choices], signal)).trim().split("\n").filter((ref) => choices.includes(ref));
      if (found.length !== 1) throw new MoguriError("github_ref", "Select one existing unambiguous branch/tag/tracking ref or a full commit SHA. Abbreviations and competing branch/tag names are not resolved implicitly.", 409);
      target = found[0]!;
    }
    const result = (await this.git(root, ["rev-parse", "--verify", "--end-of-options", `${target}^{commit}`], signal)).trim();
    if (!sha.test(result)) throw new MoguriError("github_head", "Git did not return an exact reviewed target commit.", 409);
    return result;
  }
  private async api(root: string, path: string, signal: AbortSignal, method = "GET", fields?: Record<string, string | number | boolean | string[]>, etag?: string | null): Promise<ApiResponse> {
    const args = ["api", "--hostname", "github.com", "--include", "--method", method, path, "-H", "Accept: application/vnd.github+json",
      "-H", "X-GitHub-Api-Version: 2022-11-28", ...(etag ? ["-H", `If-Match: ${etag}`] : [])];
    for (const [key, value] of Object.entries(fields ?? {})) {
      // gh sends `key[]=value` once per element and a bare `key[]` as an empty JSON array.
      if (Array.isArray(value)) { if (value.length) for (const entry of value) args.push("--raw-field", `${key}[]=${entry}`); else args.push("--raw-field", `${key}[]`); }
      else args.push(typeof value === "string" ? "--raw-field" : "--field", `${key}=${value}`);
    }
    if (method !== "GET" && path !== "graphql" && this.host.snapshot().settings.values.permissions.commands.some((rule) =>
      rule.decision === "deny" && rule.command === ["gh", ...args].join(" "))) throw new MoguriError("github_denied", "This exact GitHub invocation is denied by user policy.", 403);
    let output: string;
    try { output = await this.run("gh", args, { cwd: root, signal, label: "Reviewed GitHub CLI request", timeoutMs: method === "GET" ? this.options.readTimeoutMs ?? 30_000 : this.options.writeTimeoutMs ?? 120_000,
      maxBytes: method === "GET" ? 8 * 1024 * 1024 : 512 * 1024, env: { GH_HOST: "github.com", GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" } }); }
    catch (error) {
      const status = error instanceof MoguriError && error.code === "program_failed" ? Number(error.message.match(/\bHTTP[\s:]+(\d{3})\b/i)?.[1]) : 0;
      if ((status === 403 || status === 429) && error instanceof Error && /rate limit/i.test(error.message)) throw rateLimited(status, null);
      if (status >= 400 && status <= 599) throw new MoguriError(`github_http_${status}`, `GitHub returned HTTP ${status} for the exact reviewed resource. Raw provider diagnostics are not retained; no account substitution or automatic write retry.`, status);
      throw new MoguriError(error instanceof MoguriError ? error.code : "github_api", diagnostic(error), error instanceof MoguriError ? error.status : 502);
    }
    const normalized = output.replaceAll("\r\n", "\n"), split = normalized.indexOf("\n\n");
    if (!normalized.startsWith("HTTP/") || split < 0) throw new MoguriError("github_response", "GitHub CLI did not return its bounded HTTP status/headers. No success or remote revision was inferred.", 502);
    const headers = normalized.slice(0, split), content = normalized.slice(split + 2), status = Number(headers.match(/^HTTP\/\S+\s+(\d{3})/)?.[1]);
    if ((status === 403 || status === 429) && (/^x-ratelimit-remaining:\s*0\s*$/im.test(headers) || /^retry-after:/im.test(headers))) {
      throw rateLimited(status, headers.match(/^x-ratelimit-reset:\s*(\d{9,11})\s*$/im)?.[1] ?? null);
    }
    if (status < 200 || status >= 300) throw new MoguriError(`github_http_${status || "unknown"}`, `GitHub returned HTTP ${status || "unknown"}. No automatic retry or atomic-success claim.`, status || 502);
    const tag = headers.match(/^etag:\s*(.+)$/im)?.[1]?.trim() ?? null;
    if (tag && (tag.length > 512 || /[\x00-\x1f\x7f]/.test(tag))) throw new MoguriError("github_response", "GitHub returned an unsupported resource revision.", 502);
    let data: unknown = null;
    try { if (content.trim()) data = credentialFree(JSON.parse(content)); } catch { throw new MoguriError("github_response", "GitHub returned non-JSON content for a typed endpoint.", 502); }
    if (path === "graphql" && (record(data).errors || !isRecord(record(data).data))) throw new MoguriError("github_graphql", "GitHub rejected the exact GraphQL query/mutation. No fallback or success was inferred.", 409);
    return { data, etag: tag, next: /^link:.*rel="next"/im.test(headers) };
  }
  private async account(root: string, expected: string, signal: AbortSignal): Promise<string> {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(expected)) throw new MoguriError("github_account", "Select the explicit authenticated GitHub account.");
    const actual = record((await this.api(root, "user", signal)).data);
    if (string(actual.login).toLowerCase() !== expected.toLowerCase() || !numeric(actual.id)) throw new MoguriError("github_account", "The active controller gh account does not match the reviewed account. Switch it explicitly outside Moguri; no token was scraped or account substituted.", 409);
    return `${string(actual.login).toLowerCase()}:${numeric(actual.id)}`;
  }
  private discoveryPolicy(): string {
    const state = this.host.snapshot();
    if (this.shutdown.signal.aborted) throw new MoguriError("github_closing", "GitHub discovery is stopping. No other account was used.", 409);
    if (state.settings.values.permissions.tools.some((rule) => rule.decision === "deny" && ["*", "github", "run_command"].includes(rule.tool))) {
      throw new MoguriError("github_denied", "A hard user policy excludes controller GitHub discovery.", 403);
    }
    return digest(stable([state.profileId, state.policy.revision, state.settings.permissionRevision, this.credentialEpoch]));
  }
  private async discoveryAccount(root: string, expected: string | undefined, signal: AbortSignal) {
    const data = record((await this.api(root, "user", signal)).data), login = string(data.login), id = numeric(data.id);
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(login) || !id || expected && login.toLowerCase() !== expected.toLowerCase()) {
      throw new MoguriError("github_account", "The signed-in GitHub CLI account is missing or changed. Sign in explicitly or reload the selected account; Copilot and updater credentials are not used.", 409);
    }
    return { account: login, accountId: `${login.toLowerCase()}:${id}` };
  }
  private async repositories(query: Extract<GithubQuery, { type: "github.repositories" }>, requested?: AbortSignal): Promise<Extract<GithubResponse, { type: "github.repositories" }>> {
    const policy = this.discoveryPolicy(), root = dirname(this.store.path), signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(this.options.readTimeoutMs ?? 30_000), ...(requested ? [requested] : [])]);
    const identity = await this.discoveryAccount(root, query.account, signal);
    if (query.accountId && query.accountId !== identity.accountId) throw new MoguriError("github_account", "The repository page belongs to a different numeric GitHub account. Reload account selection explicitly.", 409);
    if (query.source === "public" && !query.query.trim()) throw new MoguriError("github_search", "Enter a public repository search before sending it to GitHub.");
    const suffix = `per_page=${query.perPage}&page=${query.page}`;
    const response = await this.api(root, query.source === "account" ?
      `user/repos?affiliation=owner,organization_member&sort=updated&direction=desc&${suffix}` :
      `search/repositories?q=${encodeURIComponent(`${query.query.trim()} is:public archived:false`)}&sort=updated&order=desc&${suffix}`, signal);
    if (query.source === "public" && record(response.data).incomplete_results !== false) throw new MoguriError("github_incomplete", "GitHub returned an incomplete public search. Refine the search; no complete list was inferred.", 502);
    const values = items(response.data, query.source === "public" ? "items" : undefined);
    if (values.length > query.perPage || response.next && query.page === 100) throw new MoguriError("github_limit", "The repository page exceeded its explicit bound. Refine the selection instead of silently omitting results.", 409);
    const seen = new Set<number>();
    const repositories = values.map((value): GithubRepository => {
      const data = record(value), fullName = string(data.full_name);
      const metadata = observedRepository(`https://github.com/${fullName}`, value);
      if (seen.has(metadata.id) || data.ssh_url !== `git@github.com:${fullName}.git` || data.clone_url !== `https://github.com/${fullName}.git` ||
        query.source === "public" && metadata.visibility !== "public" || typeof data.default_branch !== "string" ||
        data.description !== null && typeof data.description !== "string") throw new MoguriError("github_repository", "GitHub returned a duplicate, mismatched or non-canonical repository. No clone destination or account was guessed.", 502);
      seen.add(metadata.id); validateGithubRef(data.default_branch);
      const relationship = query.source === "public" ? "public" : metadata.owner.toLowerCase() === identity.account.toLowerCase() ? "owner" :
        metadata.ownerKind === "organization" ? "organization" : "accessible";
      return parse(GithubRepositorySchema, { id: metadata.id, fullName, description: data.description ?? "", url: metadata.url,
        sshUrl: data.ssh_url, cloneUrl: data.clone_url, visibility: metadata.visibility, defaultBranch: data.default_branch, relationship,
        licenseId: metadata.licenseId, openSource: metadata.publicOsiLicensed });
    }).filter((entry) => query.source === "public" || !query.query.trim() || `${entry.fullName} ${entry.description}`.toLowerCase().includes(query.query.trim().toLowerCase()));
    const rank = { owner: 0, organization: 1, accessible: 2, public: 3 };
    repositories.sort((a, b) => rank[a.relationship] - rank[b.relationship] || a.fullName.localeCompare(b.fullName));
    if ((await this.discoveryAccount(root, identity.account, signal)).accountId !== identity.accountId || this.discoveryPolicy() !== policy) {
      throw new MoguriError("github_stale", "Account or read policy changed during discovery. The old page was discarded.", 409);
    }
    return { type: "github.repositories", boundary: "controller-gh-account-not-ssh", ...identity, source: query.source,
      repositories, page: query.page, nextPage: response.next ? query.page + 1 : null, warning };
  }
  private sourceBinding(scope: GithubScope, root: GithubReviewDocument["root"]): GithubSourceBinding {
    const state = this.host.snapshot();
    return { env: "Local", profileId: state.profileId, projectId: scope.projectId, workspaceId: scope.workspaceId ?? null, root,
      configurationRevision: this.host.configuration(scope.projectId).revision, policyRevision: state.policy.revision,
      permissionRevision: state.settings.permissionRevision };
  }
  observationPolicy(scope: GithubScope): string {
    return digest(stable([this.discoveryPolicy(), this.policy(scope, undefined, true)]));
  }
  async projectContext(scope: GithubScope, expectedAccount?: Pick<GithubWorkSource, "account" | "accountId">,
    expectedRemote?: { repository: string; fetchUrl: string; pushUrl?: string; name?: string }, expectedBinding?: GithubSourceBinding,
    requested?: AbortSignal, observation = false): Promise<Extract<GithubResponse, { type: "github.project" }>> {
    this.discoveryPolicy();
    const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(this.options.readTimeoutMs ?? 30_000), ...(requested ? [requested] : [])]);
    const context = await this.context(scope, undefined, signal, undefined, undefined, undefined, observation), root = context.root.root, configuration = this.host.configuration(scope.projectId);
    const actualBinding = this.sourceBinding(scope, context.root);
    if (expectedBinding && stable(observation ? githubSourceOwner(actualBinding) : durableSourceBinding(actualBinding)) !== stable(observation ? githubSourceOwner(expectedBinding) : durableSourceBinding(expectedBinding))) {
      throw new MoguriError("github_source", "The captured root, profile or policy changed. No GitHub metadata was requested through a replacement binding.", 409);
    }
    const gitPolicy = { deniedFolders: configuration.values.deniedFolders };
    const remote = await gitUpstreamRemote(root, signal);
    const git = await readWorkspaceGit(root, gitPolicy, false, signal);
    if (!remote || !git.repository) throw new MoguriError("github_repository", "This folder's Git configuration designates no supported GitHub remote (the gh repo set-default choice, origin or its only remote). Set the folder's Git remote; no repository URL was guessed.", 409);
    const repository = git.repository.slice("https://github.com/".length);
    const fetchUrl = validateGithubRemoteUrl((await this.git(root, ["remote", "get-url", remote], signal)).trim());
    const pushUrls = (await this.git(root, ["remote", "get-url", "--push", "--all", remote], signal)).trim().split("\n").map(validateGithubRemoteUrl);
    if (expectedRemote && (repository !== expectedRemote.repository || fetchUrl !== expectedRemote.fetchUrl ||
      expectedRemote.name !== undefined && remote !== expectedRemote.name ||
      expectedRemote.pushUrl !== undefined && (pushUrls.length !== 1 || pushUrls[0] !== expectedRemote.pushUrl))) {
      throw new MoguriError("github_work_remote", "The captured task's exact repository/fetch/push destination changed. No replacement private repository or publication was accessed.", 409);
    }
    const identity = await this.discoveryAccount(root, expectedAccount?.account, signal);
    if (expectedAccount?.accountId && identity.accountId !== expectedAccount.accountId) throw new MoguriError("github_source", "The original numeric GitHub account changed. No repository metadata was requested using its replacement.", 409);
    const data = record((await this.api(root, `repos/${repository}`, signal)).data);
    const metadata = observedRepository(git.repository, data);
    validateGithubRef(string(data.default_branch));
    const fresh = await readWorkspaceGit(root, gitPolicy, false, signal);
    if (fresh.repository !== git.repository || fresh.branch !== git.branch || await gitUpstreamRemote(root, signal) !== remote ||
      (await this.discoveryAccount(root, identity.account, signal)).accountId !== identity.accountId) throw new MoguriError("github_stale", "The project's Git remote, branch or account changed during discovery. Reload before choosing an item.", 409);
    context.current();
    return { type: "github.project", boundary: "controller-gh-account-not-ssh", ...identity, repository: metadata.fullName,
      defaultBranch: string(data.default_branch), branch: git.branch, url: metadata.url, binding: this.sourceBinding(scope, context.root), warning,
      remote: { name: remote, fetchUrl, pushUrls } };
  }
  async projectItem(scope: GithubScope, source: GithubWorkSource, requested?: AbortSignal, includeMerged = false, expectedBinding?: GithubSourceBinding, observation = false): Promise<{ item: GithubItem; accountId: string; binding: GithubSourceBinding }> {
    const project = await this.projectContext(scope, source, undefined, expectedBinding, requested, observation);
    if (project.repository.toLowerCase() !== source.repository.toLowerCase() || project.account.toLowerCase() !== source.account.toLowerCase() ||
      source.accountId !== undefined && project.accountId !== source.accountId) {
      throw new MoguriError("github_source", "Choose an item from this project's exact repository and current account. No cross-repository or account fallback was used.", 409);
    }
    const response = await this.browse(scope, { resource: source.kind, repository: source.repository, account: source.account,
      number: source.number, page: 1, perPage: 1 }, AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(this.options.readTimeoutMs ?? 30_000), ...(requested ? [requested] : [])]));
    const selected = response.items[0], expected = `https://github.com/${source.repository}/${source.kind === "pull" ? "pull" : "issues"}/${source.number}`;
    if (response.accountId !== project.accountId || !selected || !selected.id || !selected.title.trim() ||
      !(["open", "closed"].includes(selected.state) || includeMerged && source.kind === "pull" && selected.state === "merged") ||
      selected.number !== source.number || selected.url !== expected || selected.kind !== source.kind) {
      throw new MoguriError("github_source", "The returned GitHub item did not match the exact selected repository, account and number.", 409);
    }
    const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(this.options.readTimeoutMs ?? 30_000), ...(requested ? [requested] : [])]), configuration = this.host.configuration(scope.projectId);
    const context = await this.context(scope, undefined, signal, undefined, undefined, undefined, observation);
    const fresh = await readWorkspaceGit(context.root.root, { deniedFolders: configuration.values.deniedFolders }, false, signal);
    if (fresh.repository?.toLowerCase() !== project.url.toLowerCase()) throw new MoguriError("github_source_stale", "The folder's Git remote changed while reading this item. Reload the exact source before using it.", 409);
    context.current();
    const binding = this.sourceBinding(scope, context.root);
    if (stable(observation ? githubSourceOwner(binding) : durableSourceBinding(binding)) !== stable(observation ? githubSourceOwner(project.binding) : durableSourceBinding(project.binding))) throw new MoguriError("github_source_stale", "The actual source root or policy changed during item inspection. Reload its complete review.", 409);
    return { item: selected, accountId: project.accountId, binding };
  }
  async observeMyWork(source: MyWorkSource, knownNumbers: number[], signal: AbortSignal,
    publish: (observation: MyWorkObservation) => void): Promise<MyWorkObservation> {
    const scope: GithubScope = { env: "Local", projectId: source.binding.projectId,
      ...(source.binding.workspaceId ? { workspaceId: source.binding.workspaceId } : {}) };
    const observation: MyWorkObservation = { version: 1, source, at: new Date(this.now()).toISOString(), complete: false, diagnostic: null, pulls: [] };
    const observed = new Map<number, MyWorkPull>();
    const save = () => {
      signal.throwIfAborted();
      observation.at = new Date(this.now()).toISOString(); observation.pulls = [...observed.values()];
      publish(parse(MyWorkObservationSchema, observation));
    };
    try {
      const context = await this.projectContext(scope, source, { repository: source.repository, ...source.remote },
        source.binding, signal);
      if (stable(context.remote) !== stable(source.remote)) throw new MoguriError("github_source", "The configured inbox upstream changed. Review a new source; no replacement was used.", 409);
      const policy = this.observationPolicy(scope), root = source.binding.root.root;
      const guard = () => {
        signal.throwIfAborted();
        if (this.observationPolicy(scope) !== policy || stable(durableSourceBinding(this.sourceBinding(scope, sourceRootSync(root)))) !== stable(durableSourceBinding(source.binding))) {
          throw new MoguriError("github_source", "The original inbox account policy/root changed. Original observations remain historical.", 409);
        }
      };
      const read = async (path: string, fields?: Record<string, string | number | boolean>) => {
        guard();
        if (await this.account(root, source.account, signal) !== source.accountId) throw new MoguriError("github_account", "The inbox's numeric account changed before this read. No replacement account was used.", 409);
        const response = await this.api(root, path, signal, fields ? "POST" : "GET", fields);
        guard();
        if (await this.account(root, source.account, signal) !== source.accountId) throw new MoguriError("github_account", "The inbox's account changed during this read. Its late response was not adopted.", 409);
        return response;
      };
      const parsePull = (value: unknown, number?: number): GithubItem => {
        const data = record(value), selected = parse(GithubItemSchema, item(data, "pull"));
        if (!selected.id || !selected.number || number !== undefined && selected.number !== number ||
          !selected.title.trim() || selected.url !== `https://github.com/${source.repository}/pull/${selected.number}` ||
          !["open", "closed", "merged"].includes(selected.state) || !selected.headSha || typeof data.draft !== "boolean" ||
          !selected.updatedAt || !Number.isFinite(Date.parse(selected.updatedAt)) ||
          string(record(record(data.base).repo).full_name).toLowerCase() !== source.repository.toLowerCase() ||
          data.merged === true && data.state !== "closed") {
          throw new MoguriError("github_source", "The inbox PR response lost its canonical repository/number/head/state. No foreign or empty item was adopted.", 502);
        }
        return selected;
      };
      const initial = (selected: GithubItem): MyWorkPull => ({ item: selected, observedAt: new Date(this.now()).toISOString(),
        complete: false, diagnostic: null, reviewDecision: null, requests: null, threads: null, ci: null });
      for (let page = 1; page <= 10; page++) {
        const response = await read(`repos/${source.repository}/pulls?state=open&per_page=100&page=${page}`);
        const pageItems = items(response.data);
        if (pageItems.length > 100) throw new MoguriError("github_incomplete", "The PR page exceeded its declared size. No complete inbox was inferred.", 502);
        for (const value of pageItems) {
          const selected = parsePull(value);
          if (selected.state !== "open" || observed.has(selected.number!)) throw new MoguriError("github_incomplete", "Open PR pagination repeated an identity or changed its state. Original pages remain partial.", 502);
          observed.set(selected.number!, initial(selected));
        }
        save();
        if (!response.next) break;
        if (page === 10) throw new MoguriError("github_limit", "This inbox source exceeds 1,000 open PRs. The retained prefix is partial, never a clean inbox.", 409);
      }
      const numbers = [...new Set([...observed.keys(), ...knownNumbers])];
      if (numbers.length > 1000) throw new MoguriError("github_limit", "This source exceeds 1,000 tracked PRs. Original evidence remains partial; no previous PR was silently dropped.", 409);
      for (const number of numbers) {
        const selected = parsePull((await read(`repos/${source.repository}/pulls/${number}`)).data, number), current = initial(selected);
        observed.set(number, structuredClone(current)); save();
        const [owner, name] = source.repository.split("/");
        const connection = async (field: "reviewRequests" | "reviewThreads") => {
          const values: unknown[] = [], cursors = new Set<string>();
          let after: string | null = null, total: number | undefined;
          for (let page = 1; page <= 10; page++) {
            const fields = field === "reviewRequests" ?
              "nodes{id requestedReviewer{__typename ... on User{id login url} ... on Team{id slug url organization{login}} ... on Bot{id login url} ... on Mannequin{id login url} ... on EnterpriseTeam{id combinedSlug}}}" :
              "nodes{id isResolved isOutdated path line comments(last:1){nodes{databaseId body url}}}";
            const response = await read("graphql", { query:
              `query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){nameWithOwner pullRequest(number:$number){number headRefOid state reviewDecision ${field}(first:100,after:$after){totalCount ${fields} pageInfo{hasNextPage endCursor}}}}}`,
              owner: owner!, name: name!, number, ...(after ? { after } : {}) });
            const repository = record(record(record(response.data).data).repository), pull = record(repository.pullRequest);
            const state = string(pull.state).toLowerCase(), collection = record(pull[field]), info = record(collection.pageInfo), decision = pull.reviewDecision;
            if (string(repository.nameWithOwner).toLowerCase() !== source.repository.toLowerCase() || pull.number !== number ||
              pull.headRefOid !== selected.headSha || state !== selected.state ||
              decision !== null && decision !== "APPROVED" && decision !== "CHANGES_REQUESTED" && decision !== "REVIEW_REQUIRED" ||
              typeof collection.totalCount !== "number" || !Number.isSafeInteger(collection.totalCount) || collection.totalCount < 0 ||
              collection.totalCount > 1000 || total !== undefined && total !== collection.totalCount ||
              typeof info.hasNextPage !== "boolean") {
              throw new MoguriError("github_incomplete", "Review requests/threads lost their exact repository/head/state/count. No guessed pending review or resolved conversation was used.", 502);
            }
            if (field === "reviewThreads" && current.reviewDecision !== pull.reviewDecision) throw new MoguriError("github_incomplete", "The provider review decision changed between observations. No mixed review state was adopted.", 502);
            current.reviewDecision = decision;
            total = collection.totalCount;
            const nodes = items(collection, "nodes");
            if (nodes.length > 100) throw new MoguriError("github_incomplete", "The review page exceeded its declared size.", 502);
            values.push(...nodes);
            if (!info.hasNextPage) {
              if (values.length !== total) throw new MoguriError("github_incomplete", "Review pagination did not match its actual total. Missing work is not zero.", 502);
              break;
            }
            const cursor = string(info.endCursor);
            if (!cursor || cursors.has(cursor) || page === 10) throw new MoguriError("github_incomplete", "Review pagination is repeated or incomplete. No omitted requests/threads were treated as resolved.", 502);
            cursors.add(cursor); after = cursor;
          }
          const ids = new Set<string>();
          for (const value of values) {
            const key = string(record(value).id);
            if (!key || ids.has(key)) throw new MoguriError("github_incomplete", "Review pagination has missing or repeated original identities.", 502);
            ids.add(key);
          }
          return values;
        };
        current.requests = (await connection("reviewRequests")).map((value) => {
          const requested = record(record(value).requestedReviewer), team = requested.__typename === "Team", enterprise = requested.__typename === "EnterpriseTeam";
          if (enterprise) return parse(MyWorkRequestSchema, { kind: "enterprise-team", login: requested.combinedSlug, url: null, nodeId: requested.id });
          if (!["User", "Team", "Bot", "Mannequin"].includes(string(requested.__typename))) throw new MoguriError("github_incomplete", "A requested reviewer is unavailable or unsupported. No viewer/team membership was guessed.", 502);
          const login = team ? `${string(record(requested.organization).login)}/${string(requested.slug)}` : string(requested.login);
          const url = team ? `https://github.com/orgs/${string(record(requested.organization).login)}/teams/${string(requested.slug)}` : `https://github.com/${login}`;
          let actual: URL;
          try { actual = new URL(string(requested.url)); } catch { throw new MoguriError("github_incomplete", "The requested reviewer has no canonical provider URL.", 502); }
          if (!login || actual.protocol !== "https:" || actual.host !== "github.com" || actual.username || actual.password || actual.search || actual.hash ||
            (team || requested.__typename === "User") && requested.url !== url) throw new MoguriError("github_incomplete", "The requested reviewer lost its canonical provider identity.", 502);
          return parse(MyWorkRequestSchema, { kind: team ? "team" : requested.__typename === "Bot" ? "bot" : requested.__typename === "Mannequin" ? "mannequin" : "user",
            login, url: requested.url, ...(typeof requested.id === "string" ? { nodeId: requested.id } : {}) });
        });
        current.threads = (await connection("reviewThreads")).map((value) => {
          const thread = record(value), comments = items(record(thread.comments), "nodes"), last = record(comments.at(-1));
          if (comments.length !== 1 || typeof last.body !== "string" || typeof thread.isResolved !== "boolean" ||
            typeof thread.isOutdated !== "boolean" || last.url !== `${selected.url}#discussion_r${last.databaseId}`) {
            throw new MoguriError("github_incomplete", "A review thread has no actual resolution state/canonical comment. Comment counts never substitute for thread state.", 502);
          }
          return parse(MyWorkThreadSchema, { id: thread.id, commentId: last.databaseId, resolved: thread.isResolved, outdated: thread.isOutdated,
            body: stripMarkdownComments(last.body), path: thread.path, line: thread.line, url: last.url });
        });
        observed.set(number, structuredClone(current)); save();
        const matching = this.operations().filter((operation) => githubCiOperationMatches(operation, {
          repository: source.repository, accountId: source.accountId, number }, source.binding) &&
          operation.ci?.target.headSha === selected.headSha && operation.ci.complete && !operation.ci.cleanupUnconfirmed &&
          ["running", "completed"].includes(operation.status) && operation.ci.observedAt &&
          this.now() - Date.parse(operation.ci.observedAt) >= 0 && this.now() - Date.parse(operation.ci.observedAt) <= 300_000)
          .sort((a, b) => b.ci!.observedAt!.localeCompare(a.ci!.observedAt!))[0];
        if (matching) {
          const retained = await this.query({ type: "github.read", operationId: matching.id }, signal);
          if (retained.type !== "github.read" || !retained.ciObservation) throw new MoguriError("github_corrupt", "The exact retained watch observation is unavailable. No poller was restarted.", 409);
          current.ci = retained.ciObservation;
          current.ciWatchId = matching.id;
        } else {
          guard();
          const values = await this.ciCollection(root, source.repository, selected.headSha!, signal);
          guard();
          if (await this.account(root, source.account, signal) !== source.accountId) throw new MoguriError("github_account", "The original CI account changed while collecting checks. Its late collection was not adopted.", 409);
          current.ci = { version: 1, target: { repository: source.repository, account: source.account, accountId: source.accountId,
            number, headSha: selected.headSha! }, at: new Date(this.now()).toISOString(), state: githubPrCiState(values),
            complete: true, deadlineReached: false, items: values };
          if (current.ci.state === "failure") {
            observed.set(number, structuredClone(current));
            save();
            try { current.ci.items = await this.ciDiagnostics({ root: source.binding.root, action: {
              kind: "github.ci.watch", repository: source.repository, account: source.account, headSha: selected.headSha!,
              timeoutMs: 100, pollMs: 50 } }, values, signal); }
            catch (error) {
              signal.throwIfAborted();
              if (error instanceof MoguriError && error.code === "program_partial") throw error;
              current.diagnostic = `CI failure was observed; diagnostic inspection failed. ${diagnostic(error)}`.slice(0, 4000);
            }
          }
        }
        const fresh = parsePull((await read(`repos/${source.repository}/pulls/${number}`)).data, number);
        if (fresh.headSha !== selected.headSha || fresh.state !== selected.state || fresh.updatedAt !== selected.updatedAt) {
          throw new MoguriError("github_head", "The PR head/state/revision changed during inbox observation. The original partial head is preserved, not mixed with a new one.", 409);
        }
        current.complete = current.diagnostic === null; current.observedAt = new Date(this.now()).toISOString();
        observed.set(number, current); save();
      }
      const fresh = await this.projectContext(scope, source, { repository: source.repository, ...source.remote }, source.binding, signal);
      guard();
      if (stable(fresh.remote) !== stable(source.remote)) throw new MoguriError("github_source", "The original upstream changed before inbox publication.", 409);
      observation.complete = [...observed.values()].every((pull) => pull.complete);
      if (!observation.complete) observation.diagnostic = "Some original PR observations or CI diagnostics are incomplete. Inspect the retained source; incomplete evidence is not a clean inbox.";
      save();
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof MoguriError && error.code === "program_partial") throw error;
      observation.complete = false; observation.diagnostic = diagnostic(error); save();
    }
    return observation;
  }
  private async optionalApi(root: string, path: string, signal: AbortSignal): Promise<unknown | null> {
    try { return (await this.api(root, path, signal)).data; }
    catch (error) { if (notFound(error)) return null; throw error; }
  }
  private async tagCommit(root: string, repository: string, tag: string, signal: AbortSignal): Promise<{ ref: unknown; commit: string | null }> {
    const ref = await this.optionalApi(root, `repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`, signal);
    if (ref === null) return { ref, commit: null };
    let target = record(record(ref).object);
    for (let depth = 0; depth < 5; depth++) {
      if (!sha.test(string(target.sha))) throw new MoguriError("github_tag", "GitHub did not return an exact tag object.", 409);
      if (target.type === "commit") return { ref, commit: string(target.sha) };
      if (target.type !== "tag") break;
      target = record(record((await this.api(root, `repos/${repository}/git/tags/${string(target.sha)}`, signal)).data).object);
    }
    throw new MoguriError("github_tag", "Release tag did not resolve to one bounded exact commit. No target was inferred.", 409);
  }
  private async resource(root: string, action: Extract<GithubAction, { repository: string }>, signal: AbortSignal): Promise<GithubReviewDocument["resource"]> {
    const base = `repos/${action.repository}`;
    let path: string, response: ApiResponse;
    if (action.kind === "github.review.resolve") {
      path = "graphql";
      response = await this.api(root, path, signal, "POST", { query: "query($id:ID!){node(id:$id){__typename ... on PullRequestReviewThread{id isResolved isOutdated pullRequest{number headRefOid state repository{nameWithOwner}} comments(first:100){nodes{id databaseId body updatedAt} pageInfo{hasNextPage}}}}}", id: action.threadId });
      const node = record(record(response.data).data).node, thread = record(node), pull = record(thread.pullRequest);
      if (thread.__typename !== "PullRequestReviewThread" || numeric(pull.number) !== action.number ||
        string(record(pull.repository).nameWithOwner).toLowerCase() !== action.repository.toLowerCase() ||
        record(record(thread.comments).pageInfo).hasNextPage === true) throw new MoguriError("github_thread", "The exact bounded review thread does not belong to this repository/PR or has more than 100 comments.", 409);
      return { path, digest: digest(stable(node)), etag: null, headSha: string(pull.headRefOid) || null,
        state: string(pull.state), content: stable(node) };
    }
    if (action.kind === "github.ci.watch") {
      if (action.prNumber !== undefined) {
        path = `${base}/pulls/${action.prNumber}`; response = await this.api(root, path, signal);
        const pull = record(response.data);
        if (numeric(pull.number) !== action.prNumber || pull.state !== "open" || pull.merged === true ||
          record(pull.head).sha !== action.headSha || pull.html_url !== `https://github.com/${action.repository}/pull/${action.prNumber}`) {
          throw new MoguriError("github_ci_head", "The exact reviewed PR is closed, moved or has a different head. No alternate PR/head was adopted.", 409);
        }
      } else {
        path = `${base}/commits/${action.headSha}`; response = await this.api(root, path, signal);
        if (record(response.data).sha !== action.headSha) throw new MoguriError("github_head", "CI must bind an exact existing remote commit SHA.", 409);
      }
    } else if (action.kind === "github.pr.create") {
      const headRepository = action.headRepository ?? action.repository, headBranch = action.head.split(":").at(-1)!;
      const [baseBranch, head] = await Promise.all([
        this.api(root, `${base}/branches/${encodeURIComponent(action.base)}`, signal),
        this.api(root, `repos/${headRepository}/branches/${encodeURIComponent(headBranch)}`, signal),
      ]);
      const baseSha = string(record(record(baseBranch.data).commit).sha), headSha = string(record(record(head.data).commit).sha);
      if (!sha.test(baseSha) || !sha.test(headSha) || record(baseBranch.data).name !== action.base || record(head.data).name !== headBranch) throw new MoguriError("github_head", "GitHub did not disclose the exact existing PR base/head branches and commits.", 409);
      path = `${base}/pulls`;
      response = { data: { base: { repository: action.repository, ref: action.base, sha: baseSha, branch: baseBranch.data },
        head: { repository: headRepository, ref: headBranch, sha: headSha, branch: head.data } }, etag: null, next: false };
    } else if (action.kind === "github.release.create" || action.kind === "github.release.update" || action.kind === "github.release.publish") {
      path = action.kind === "github.release.create" ? base : `${base}/releases/${action.releaseId}`;
      response = await this.api(root, path, signal);
      const release = record(response.data), target = action.kind === "github.release.publish" ? string(release.target_commitish) : action.target;
      const tag = action.kind === "github.release.publish" ? string(release.tag_name) : action.tag;
      validateGithubRef(target); validateGithubRef(tag);
      const commit = record((await this.api(root, `${base}/commits/${encodeURIComponent(target)}`, signal)).data);
      if (!sha.test(string(commit.sha))) throw new MoguriError("github_head", "Release target did not resolve to an exact remote commit.", 409);
      const tagState = await this.tagCommit(root, action.repository, tag, signal);
      if (tagState.commit && tagState.commit !== commit.sha) throw new MoguriError("github_tag", "The existing release tag points to a different commit than the reviewed target. GitHub ignores target_commitish for existing tags; select the exact matching target explicitly.", 409);
      response.data = { resource: response.data, targetSha: commit.sha, tagRef: tagState.ref, tagCommitSha: tagState.commit };
      if (action.kind === "github.release.publish" && release.draft !== true) throw new MoguriError("github_release", "Only the exact reviewed draft can be published. An already-published release is not replayed.", 409);
    } else if (action.kind === "github.comment.update" || action.kind === "github.comment.delete") {
      const review = action.channel === "review";
      path = `${base}/${review ? "pulls" : "issues"}/comments/${action.commentId}`;
      response = await this.api(root, path, signal);
      const comment = record(response.data), owner = review ? comment.pull_request_url : comment.issue_url;
      if (owner !== `https://api.github.com/repos/${action.repository}/${review ? "pulls" : "issues"}/${action.number}`) throw new MoguriError("github_comment", "The exact comment does not belong to the reviewed repository, issue/PR and channel.", 409);
      const parent = (await this.api(root, `${base}/${review ? "pulls" : "issues"}/${action.number}`, signal)).data;
      response.data = { parent, comment: response.data };
    } else if ("number" in action) {
      const pull = action.kind.startsWith("github.pr.") || action.kind.startsWith("github.review.") || action.kind === "github.branch.delete";
      // Branch deletion and revert act on a merged PR; every other PR action needs it open.
      const afterMerge = action.kind === "github.branch.delete" || action.kind === "github.pr.revert";
      path = `${base}/${pull ? "pulls" : "issues"}/${action.number}`; response = await this.api(root, path, signal);
      const resource = record(response.data);
      if (pull && (!sha.test(string(record(resource.head).sha)) || resource.state !== "open" && action.kind !== "github.pr.update" && action.kind !== "github.pr.comment" && !afterMerge)) throw new MoguriError("github_pr", "Choose an existing open PR with an exact head. A closed/merged PR is not adopted or merged.", 409);
      if (!pull && resource.pull_request && action.kind !== "github.issue.labels" && action.kind !== "github.issue.assignees") throw new MoguriError("github_issue", "This number is a pull request, not the reviewed issue.", 409);
      if (action.kind === "github.pr.merge" && resource.merged === true) throw new MoguriError("github_pr", "This PR is already merged; no merge was replayed.", 409);
      if (afterMerge && resource.merged !== true) throw new MoguriError("github_pr", "Only a merged pull request's branch can be deleted or its changes reverted. Nothing was changed.", 409);
      if (action.kind === "github.pr.revert" && !string(resource.node_id)) throw new MoguriError("github_pr", "This merged PR has no GitHub node ID, so a revert pull request can't be requested.", 409);
      if (action.kind === "github.branch.delete") {
        const head = record(resource.head), headRepository = string(record(head.repo).full_name);
        if (!headRepository || headRepository.toLowerCase() !== action.repository.toLowerCase()) throw new MoguriError("github_branch", "This PR's branch lives in another repository (a fork), so it isn't deleted from here.", 409);
        if (string(head.ref) !== action.branch) throw new MoguriError("github_branch", "The branch doesn't match this PR's head branch. Nothing was deleted.", 409);
        const repository = record((await this.api(root, base, signal)).data);
        if (action.branch === string(repository.default_branch)) throw new MoguriError("github_branch", "The repository's default branch is never deleted.", 409);
        const branch = await this.optionalApi(root, `${base}/git/ref/heads/${action.branch.split("/").map(encodeURIComponent).join("/")}`, signal);
        if (branch === null) throw new MoguriError("github_branch_missing", `Branch ${action.branch} is already deleted on GitHub. Nothing was changed.`, 409);
        // A branch that moved since the merge holds work the PR never included.
        if (string(record(record(branch).object).sha) !== string(head.sha)) throw new MoguriError("github_branch", `Branch ${action.branch} has commits that aren't in the merged PR. It wasn't deleted.`, 409);
        response.data = { pull: response.data, branch };
      }
      if (action.kind === "github.pr.update" && resource.merged === true) throw new MoguriError("github_pr", "Merged PRs cannot be reopened or edited by this workflow.", 409);
      if (action.kind === "github.pr.draft") {
        if (resource.merged === true || !string(resource.node_id)) throw new MoguriError("github_pr", "Only an open, unmerged PR with a GitHub node ID can change its draft state.", 409);
        if ((resource.draft === true) === action.draft) throw new MoguriError("github_pr_draft", action.draft ? `Pull request #${action.number} is already a draft. Nothing was changed.` :
          `Pull request #${action.number} is already ready for review. Nothing was changed.`, 409);
      }
      if (action.kind === "github.pr.merge") {
        const head = record(resource.head);
        if (!string(record(head.repo).full_name) || !string(head.ref)) throw new MoguriError("github_pr", "The exact PR head repository/branch is unavailable. A merge or possible server-policy branch deletion cannot be reviewed.", 409);
        const repository = record((await this.api(root, base, signal)).data);
        response.data = { pull: response.data, mergePolicy: { deleteBranchOnMerge: typeof repository.delete_branch_on_merge === "boolean" ? repository.delete_branch_on_merge : null } };
      }
      if (action.kind === "github.review.reply") {
        const comment = (await this.api(root, `${base}/pulls/comments/${action.commentId}`, signal)).data;
        if (string(record(comment).pull_request_url) !== `https://api.github.com/repos/${action.repository}/pulls/${action.number}`) throw new MoguriError("github_comment", "The exact review comment does not belong to this reviewed PR.", 409);
        response.data = { pull: response.data, comment };
      }
    } else { path = base; response = await this.api(root, path, signal); }
    const data = record(response.data), pull = record(data.pull ?? data.parent ?? data);
    const content = stable(response.data);
    if (Buffer.byteLength(content) > 256 * 1024) throw new MoguriError("github_limit", "The exact remote review exceeds 256 KiB. No resource was silently truncated.", 409);
    return { path, digest: digest(content), etag: response.etag, headSha: string(record(pull.head).sha) || null,
      state: string(pull.state) || null, content };
  }
  private validateAction(action: GithubAction): void {
    parse(GithubActionSchema, action);
    if (action.kind === "git.remote.set") repositoryUrl(action.url);
    if (action.kind === "github.ci.watch" && (action.prNumber === undefined) !== (action.accountId === undefined)) {
      throw new MoguriError("github_ci_target", "A PR CI watch needs both its explicit PR number and numeric account identity. Legacy head-only watches are not reassociated.", 409);
    }
    if (Object.values(action).some((value) => typeof value === "string" && (!value.isWellFormed() || value.includes("\0")))) throw new MoguriError("github_input", "Exact Git/GitHub inputs require well-formed text without NUL bytes. No CLI replacement, truncation or remote write was allowed.", 400);
    const names = action.kind === "github.issue.labels" ? action.labels : action.kind === "github.issue.assignees" ? action.assignees : action.kind === "github.pr.reviewers" ? action.reviewers : null;
    if (names && (names.some((name) => !name.isWellFormed()) || new Set(names.map((name) => name.toLowerCase())).size !== names.length)) throw new MoguriError("github_input", "List each label or user once with well-formed text. GitHub compares these names without case.", 400);
    if ("branch" in action) validateGithubRef(action.branch);
    if (action.kind === "github.review.comment") {
      if (action.path.startsWith("/") || action.path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
        throw new MoguriError("github_input", "Comment on a repository-relative file path without empty, \".\" or \"..\" segments.", 400);
      }
      if ((action.startLine === undefined) !== (action.startSide === undefined)) throw new MoguriError("github_input", "A multi-line review comment needs both its first line and side; a single-line comment sets neither.", 400);
      if (action.startLine !== undefined && action.startSide === action.side && action.startLine >= action.line) throw new MoguriError("github_input", "A multi-line review comment's first line must come before its last line on the same side.", 400);
    }
    if (action.kind === "git.push" && action.destination) validateGithubRef(action.destination);
    if ("tag" in action) validateGithubRef(action.tag);
    if ("target" in action) validateGithubRef(action.target);
    if ("onto" in action) validateGithubRef(action.onto);
    if (action.kind === "github.pr.create") {
      validateGithubRef(action.base); validateGithubRef(action.head, true);
      const owner = action.head.includes(":") ? action.head.split(":")[0]! : (action.headRepository ?? action.repository).split("/")[0]!;
      if (owner.toLowerCase() !== (action.headRepository ?? action.repository).split("/")[0]!.toLowerCase()) throw new MoguriError("github_ref", "A cross-repository PR requires the exact explicit headRepository and matching owner:branch. No fork name is inferred.", 409);
    }
    if ((action.kind === "github.pr.update" || action.kind === "github.issue.update") && action.title === undefined && action.body === undefined && action.state === undefined) throw new MoguriError("github_edit", "Select at least one exact field to update; omitted fields are preserved.");
    if (action.kind === "git.tag.create" && (action.annotated ? !action.message.trim() : action.message !== "")) throw new MoguriError("github_tag", "Annotated tags require an exact nonempty message; lightweight tags must not carry a discarded message.");
    if (action.kind === "github.repo.settings") {
      if (Object.values(action.settings).some((value) => typeof value === "string" && (!value.isWellFormed() || value.includes("\0")))) throw new MoguriError("github_input", "Repository settings need well-formed text without NUL bytes.", 400);
      if (action.settings.default_branch !== undefined) validateGithubRef(action.settings.default_branch);
      if (action.settings.homepage && !/^https:\/\/[^\s]+$/.test(action.settings.homepage)) throw new MoguriError("github_input", "Use an https:// homepage URL, or an empty value to clear it.", 400);
    }
  }
  private async preview(scope: GithubScope, action: GithubAction, signal: AbortSignal, jobId?: string, projectWorkId?: string, toolAuthority?: GitToolAuthority): Promise<{ preview: GithubPreview; current(): void }> {
    this.validateAction(action);
    const context = await this.context(scope, action, signal, jobId, projectWorkId, toolAuthority), root = context.root.root;
    const git = await this.gitState(root, signal);
    if (context.recoveryState && stable(context.recoveryState) !== stable(git)) throw new MoguriError("github_stale", "The exact in-progress rebase changed during recovery review. No quarantine exception or Git effect was adopted.", 409);
    if (action.kind.startsWith("git.") && action.kind !== "git.rebase" && git.rebaseDigest) throw new MoguriError("github_rebase", "Resolve the current rebase with a separate reviewed continue/abort before another Git write.", 409);
    const document: GithubReviewDocument = {
      format: "moguri-github-review", version: 1, profileId: this.host.snapshot().profileId, scope: structuredClone(scope), root: context.root,
      policyDigest: context.policyDigest, action: structuredClone(action), git, remote: null, targetSha: null, resource: null, accountId: null,
      warnings: ["Native Local Git/gh use the user's configuration and hooks. They are not a qualified SendBox descendant-containment boundary. No credentials or hook bypass are supplied."],
      confirmations: ["I reviewed this exact Local root, action, inputs and policy."],
    };
    if (action.kind === "git.remote.set") {
      if (projectWorkId || toolAuthority) throw new MoguriError("remote_user_only", "Repository remote changes require a separate actual-user review, not model/tool or delegated task authority.", 403);
      if (!this.host.consoleBusy) throw new MoguriError("remote_console_boundary", "This host cannot verify exact retained Local console ownership. No shared remote change was admitted.", 409);
      document.remoteChange = await inspectRemoteChange(root, action.remote, action.url, dirname(this.store.path), signal,
        (path, args, signal) => this.git(path, args, signal), validateGithubRemoteUrl, this.run);
      const boundary = document.remoteChange;
      for (const path of [boundary.common.root, ...boundary.worktrees.map((worktree) => worktree.root)]) {
        if (this.host.rootBusy(path, jobId) || this.host.consoleBusy(path) || !jobId && (this.roots.has(path) || this.pendingRoots.has(path))) throw new MoguriError("workspace_busy", "An owned writer or console holds an affected linked worktree/shared Git directory. Finish that exact owner before reviewing this shared remote change.", 409);
      }
      document.warnings = ["This is a Local shared Git config change, not a display-label edit. Every listed linked worktree uses the new destination.",
        "No fetch, push, hooks, submodules, model call or authentication. Historical PR/candidate sources and account approvals are not transferred. Future GitHub actions require fresh account/repository review."];
      document.confirmations.push(`Change remote ${action.remote} for all ${boundary.worktrees.length} listed linked worktrees.`);
      document.confirmations.push("Invalidate remembered Local command/Git approvals scoped to the affected projects and sessions; retain global hard policy.");
      if (boundary.pushUrls.length) document.confirmations.push("Replace the displayed explicit push URL as well as the fetch URL.");
    }
    const main = this.host.configuration(scope.projectId).values.repo.mainBranch;
    if (scope.workspaceId && (action.kind === "git.branch.create" && action.checkout ||
      action.kind === "git.switch" && action.branch !== git.branch)) throw new MoguriError("git_workspace_switch",
      "A managed worktree retains its captured change-set branch. Create a branch without checkout or create a separate managed worktree for another branch; no existing conversation or root was moved.", 409);
    if (action.kind === "git.branch.create" || action.kind === "git.branch.rename") {
      const branch = action.kind === "git.branch.create" ? action.branch : action.to;
      validateGithubRef(branch);
      if ((await readGit(root, ["for-each-ref", "--format=%(refname)", `refs/heads/${branch}`], signal)).trim()) throw new MoguriError("git_branch_exists", "The exact destination branch already exists or contains child refs. No force rename or overwrite was performed.", 409);
      if (action.kind === "git.branch.create") document.targetSha = await this.commitRef(root, action.start, signal);
      else {
        validateGithubRef(action.from);
        if (action.from !== git.branch) throw new MoguriError("git_branch_changed", "Rename only the exact captured current branch. No other worktree or branch was changed.", 409);
        if ([main, "main", "master"].includes(action.from)) document.confirmations.push(`I explicitly approve renaming protected/main branch ${action.from} to ${action.to}.`);
        if (scope.workspaceId) {
          if (!this.host.branchEvents) throw new MoguriError("git_workspace_binding", "This host cannot atomically retain a managed branch rename. No Git effect was admitted.", 409);
          const workspace = this.host.snapshot().managedWorkspaces.find((workspace) => workspace.id === scope.workspaceId);
          if (!workspace) throw new MoguriError("git_workspace_binding", "The captured managed workspace disappeared. No base checkout was used.", 409);
          document.managedBranch = { revision: workspace.revision, changeSetId: workspace.changeSetId, branch: workspace.branch, baseCommit: workspace.baseCommit };
          this.host.branchEvents(document, action.to, "preview");
        }
      }
    }
    if (action.kind === "git.switch") {
      const refs = (await readGit(root, ["for-each-ref", "--format=%(refname)%09%(objectname)", `refs/heads/${action.branch}`], signal)).trim().split("\n");
      const selected = refs.filter((line) => line.split("\t")[0] === `refs/heads/${action.branch}`);
      if (selected.length !== 1) throw new MoguriError("git_branch_missing", "Select one existing local branch. No remote branch or implicit tracking checkout was created.", 409);
      document.targetSha = selected[0]!.split("\t")[1]!;
    }
    if (action.kind === "git.switch" || action.kind === "git.revert" || action.kind === "git.branch.create" && action.checkout) {
      if (git.status || git.branch === "(detached)") throw new MoguriError("git_dirty", "This operation needs a clean committed current branch. Unrelated staged, dirty and untracked work was preserved; no stash, reset or overwrite was attempted.", 409);
      await this.noIntegration(root, signal);
    }
    if (action.kind === "git.revert") {
      if (action.commit !== git.head) throw new MoguriError("git_revert", "Rollback preserves history by reverting the exact current commit only. Select the current HEAD SHA; no older range, merge mainline or reset was inferred.", 409);
      const parents = (await readGit(root, ["rev-list", "--parents", "--max-count=1", action.commit], signal)).trim().split(" ");
      if (parents.length !== 2 || !sha.test(parents[1]!)) throw new MoguriError("git_revert", "Rollback requires one exact parent. Root and merge commits need a separately specified workflow; no mainline was guessed.", 409);
      document.targetSha = parents[1]!;
      document.confirmations.push(`Create a new revert commit for ${git.head}, preserving its history.`);
    }
    if (action.kind === "git.stage" || action.kind === "git.unstage") {
      await this.noIntegration(root, signal);
      document.files = await this.reviewedFiles(root, action.paths, signal);
      const selected = new Set(action.paths), entries = await this.indexEntries(root, signal);
      const tracked = new Set([...entries, ...await this.treeEntries(root, git.head, signal)].map((entry) => entry.path));
      if (document.files.some((file) => !tracked.has(file.path) && (action.kind === "git.unstage" || file.digest === null))) throw new MoguriError("git_paths", "A selected path has no original staged/tracked entry or current file. No directory, implicit set or missing file was staged.", 409);
      document.unaffectedIndexDigest = digest(stable(entries.filter((entry) => !selected.has(entry.path))));
      document.workingTreeDigest = await this.workingTreeDigest(root, git.head, signal, action.paths);
      if (action.kind === "git.stage") {
        const attributes = (await readGit(root, ["check-attr", "-z", "filter", "text", "eol", "--", ...action.paths], signal)).split("\0");
        if (attributes.at(-1) === "") attributes.pop();
        if (attributes.length !== action.paths.length * 9) throw new MoguriError("git_attributes", "Git did not return every exact file/transformation attribute. No missing value was treated as safe.", 409);
        const configuration = await readGit(root, ["config", "--null", "--list"], signal);
        if (attributes.some((value, index) => index % 3 === 2 && !["unspecified", "unset"].includes(value)) ||
          configuration.split("\0").some((entry) => /^core\.autocrlf\n(?:true|input)$/i.test(entry))) throw new MoguriError("git_filtered_path", "Built-in exact-byte staging does not apply filters or text normalization. Review the configured Git transformation explicitly; no file was staged.", 409);
      }
    }
    if (action.kind === "git.commit") {
      await this.noIntegration(root, signal);
      validateGitFiles(action.paths);
      const selected = new Set(action.paths), entries = await this.indexEntries(root, signal), base = await this.treeEntries(root, git.head, signal);
      if (selected.size !== action.paths.length || entries.some((entry) => entry.stage !== 0) ||
        action.paths.some((path) => !entries.some((entry) => entry.path === path) && !base.some((entry) => entry.path === path)) ||
        !(await readGit(root, ["diff", "--cached", "--name-only", git.head, "--", ...action.paths], signal)).trim()) throw new MoguriError("git_commit", "Commit requires exact resolved paths with actual staged changes. Nothing was staged, resolved or taken from unstaged files automatically.", 409);
      const expected = [...base.filter((entry) => !selected.has(entry.path)), ...entries.filter((entry) => selected.has(entry.path))]
        .sort((a, b) => a.path.localeCompare(b.path, "en"));
      document.indexEntriesDigest = digest(stable(expected));
      document.workingTreeDigest = await this.workingTreeDigest(root, git.head, signal);
      document.confirmations.push("Commit only the selected staged paths; preserve the real index and all unstaged work.");
    }
    if (["git.commit", "git.revert", "git.branch.rename"].includes(action.kind)) {
      const worktrees = (await readGit(root, ["worktree", "list", "--porcelain", "-z"], signal)).split("\0");
      if (worktrees.filter((value) => value === `branch refs/heads/${git.branch}`).length !== 1) throw new MoguriError("git_branch_owner", "This branch is detached or checked out by multiple worktrees. No other root's HEAD or branch binding was changed.", 409);
    }
    if (action.kind === "git.push" || action.kind === "git.tag.push" || action.kind === "git.tag.delete" && action.location === "remote") {
      const destination = action.kind === "git.push" ? action.destination ?? action.branch : null;
      const ref = destination ? `refs/heads/${destination}` : `refs/tags/${"tag" in action ? action.tag : ""}`;
      document.remote = await this.remote(root, action.remote, ref, signal,
        projectWorkId ? this.host.snapshot().projectWorkRuns.find((run) => run.id === projectWorkId)!.pushUrl : undefined);
      document.confirmations.push(`Write exactly ${document.remote.name} ${ref}.`);
      if (action.kind === "git.push" && (destination === main || ["main", "master"].includes(destination!))) document.confirmations.push(`I explicitly approve pushing protected/main branch ${destination}.`);
      if (action.kind === "git.push" && action.forceWithLease) {
        document.confirmations.push(`I explicitly approve force-with-lease at ${document.remote.sha ?? "absent"}.`);
        document.warnings.push("Only the captured destination SHA/absence can be replaced. There is no raw --force, retry with a refreshed lease, or branch-protection bypass.");
      }
      if (action.kind === "git.tag.push") {
        document.targetSha = (await this.git(root, ["rev-parse", "--verify", "--end-of-options", `refs/tags/${action.tag}`], signal)).trim();
        if (!sha.test(document.targetSha)) throw new MoguriError("github_tag", "Select an existing exact local tag object.", 409);
        if (document.remote.sha && document.remote.sha !== document.targetSha) throw new MoguriError("github_tag", "The remote tag differs. Tag replacement is not implicit; separately review explicit deletion first.", 409);
      }
      if (action.kind === "git.tag.delete" && !document.remote.sha) throw new MoguriError("github_tag", "The exact remote tag does not exist; no deletion was inferred.", 409);
    }
    if (action.kind === "git.tag.create") {
      if ((await this.git(root, ["for-each-ref", "--format=%(objectname)", `refs/tags/${action.tag}`], signal)).trim()) throw new MoguriError("github_tag", "This exact local tag already exists. No tag was overwritten.", 409);
      document.targetSha = await this.commitRef(root, action.target, signal);
    }
    if (action.kind === "git.tag.delete" && action.location === "local") document.targetSha = (await this.git(root, ["rev-parse", "--verify", "--end-of-options", `refs/tags/${action.tag}`], signal)).trim();
    if (action.kind === "git.tag.delete") document.confirmations.push(`I explicitly approve deleting ${action.location} tag ${action.tag}.`);
    if (action.kind === "git.rebase") {
      if (action.mode === "start") {
        if (git.status || git.rebaseDigest || git.branch === "(detached)") throw new MoguriError("github_rebase", "Start rebase only on an explicit clean committed branch with no existing operation. No stash, reset or abort was performed.", 409);
        const markers = await Promise.all(["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"].map((name) => this.git(root, ["rev-parse", "--git-path", name], signal)));
        for (const marker of markers) {
          try { await lstat(resolve(root, marker.trim())); throw new MoguriError("github_rebase", "Resolve the existing Git integration operation explicitly before starting a rebase.", 409); }
          catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
        }
        document.targetSha = await this.commitRef(root, action.onto, signal);
        document.warnings.push("Rebase rewrites this branch using the exact captured onto commit. Original/onto commits are retained under refs/moguri/rebase/<operationId> before rebase. Conflicts and both histories remain for a new explicit continue/abort review; there is no auto-abort.");
      } else {
        if (!git.rebaseDigest || !git.rebaseOriginalHead || !git.rebaseOnto) throw new MoguriError("github_rebase", "There is no exact supported in-progress rebase to continue/abort.", 409);
        if (action.mode === "continue" && (await this.git(root, ["ls-files", "--unmerged", "-z"], signal)).length) throw new MoguriError("github_rebase", "Resolve and stage all conflict entries explicitly before reviewing continue. Nothing was reset or staged automatically.", 409);
        if (action.mode === "abort") document.warnings.push("Explicit abort restores Git's original rebase state and discards the currently reviewed conflict-resolution work. No unrelated checkout or Git cleanup is performed.");
      }
      document.confirmations.push(`I explicitly approve rebase ${action.mode}${action.mode === "start" ? ` of ${git.branch} onto ${document.targetSha}` : ` for original ${git.rebaseOriginalHead}`}.`);
      if (scope.workspaceId ? this.host.snapshot().blockedWorkspaces.includes(scope.workspaceId) : this.host.snapshot().blockedProjects.includes(scope.projectId)) document.warnings.push("This root remains quarantined after the reviewed rebase continuation/abort. No unrelated uncertainty is cleared and normal source work is not implicitly resumed.");
      const rewrittenBranch = git.rebaseBranch ?? git.branch;
      if (rewrittenBranch === main || ["main", "master"].includes(rewrittenBranch)) document.confirmations.push(`I explicitly approve rewriting protected/main branch ${rewrittenBranch}.`);
    }
    if (document.targetSha && !sha.test(document.targetSha)) throw new MoguriError("github_head", "Git did not return an exact target object; nothing was dispatched.", 409);
    if (githubAction(action)) {
      if (action.kind === "github.ci.watch" && action.prNumber !== undefined) {
        const source = await this.projectContext(scope, { account: action.account, accountId: action.accountId }, undefined, undefined, signal, true);
        if (source.repository.toLowerCase() !== action.repository.toLowerCase() || !sameDurableRoot(source.binding.root, document.root)) {
          throw new MoguriError("github_ci_target", "The selected PR must belong to this exact project/root and account. No foreign repository or replacement root was used.", 409);
        }
      }
      document.accountId = await this.account(root, action.account, signal);
      if (action.kind === "github.ci.watch" && action.accountId !== undefined && action.accountId !== document.accountId) {
        throw new MoguriError("github_account", "The selected PR's numeric account changed before review. No replacement account was accepted.", 409);
      }
      document.resource = visibleResource(await this.resource(root, action, signal));
      if (await this.account(root, action.account, signal) !== document.accountId) throw new MoguriError("github_account", "The exact authenticated account changed during resource review. No different-account result was adopted.", 409);
      document.warnings.push(warning);
      if (action.kind !== "github.pr.merge" && mutation(action)) document.warnings.push("Remote revisions are rechecked immediately before dispatch and If-Match is sent when available. GitHub does not guarantee compare-and-swap for every edit/comment/release/thread endpoint: a concurrent server edit after that check can still race. There are no automatic write retries.");
      if (action.kind === "github.pr.merge") {
        document.confirmations.push(`I explicitly approve ${action.method} merging PR #${action.number} at ${document.resource?.headSha}.`);
        document.confirmations.push(`I explicitly approve server-policy deletion of PR #${action.number}'s captured head branch at ${document.resource?.headSha}, if GitHub performs it.`);
        const policy = record(record(JSON.parse(document.resource!.content)).mergePolicy).deleteBranchOnMerge;
        document.warnings.push(`GitHub server auto-delete policy: ${policy === true ? "enabled" : policy === false ? "disabled at review" : "not disclosed"}. Moguri issues no branch-delete request, but GitHub may apply its repository policy during merge. The merge SHA guard cannot atomically lock repository settings; the separate confirmation covers only this exact captured PR head branch.`);
      }
      if (action.kind === "github.comment.delete") document.confirmations.push(`I explicitly approve deleting ${action.channel} comment ${action.commentId} from #${action.number}.`);
      if (action.kind === "github.pr.draft") document.confirmations.push(action.draft ? `Convert pull request #${action.number} to draft.` : `Mark pull request #${action.number} ready for review.`);
      if (action.kind === "github.branch.delete") {
        document.confirmations.push(`Delete branch ${action.branch} on GitHub, merged with pull request #${action.number} at ${document.resource?.headSha}.`);
        document.warnings.push("Only the remote branch on GitHub is deleted. Local branches, worktrees and the pull request stay; GitHub can restore the branch from the pull request page.");
      }
      if (action.kind === "github.pr.revert") {
        document.confirmations.push(`Open a ${action.draft ? "draft " : ""}pull request that reverts pull request #${action.number}.`);
        document.warnings.push("GitHub creates a new branch with a commit that undoes the merged changes and opens it as a pull request. Nothing is merged; review and merge the revert like any other pull request.");
      }
      if (action.kind === "github.review.comment") {
        const shown = action.path.length > 160 ? `...${action.path.slice(-157).replace(/^[\uDC00-\uDFFF]/, "")}` : action.path;
        const side = (value: "LEFT" | "RIGHT") => value === "LEFT" ? "old " : "";
        const lines = action.startLine === undefined ? `${side(action.side)}line ${action.line}` : action.startSide === action.side ?
          `${side(action.side)}lines ${action.startLine}-${action.line}` : `${side(action.startSide!)}line ${action.startLine} to ${side(action.side)}line ${action.line}`;
        document.confirmations.push(`Post a review comment on ${shown} ${lines} of pull request #${action.number}.`);
        document.warnings.push(`GitHub publishes this comment right away on the reviewed head ${document.resource?.headSha}. It shows under the pull request's reviews, not its conversation.`);
      }
      if (action.kind === "github.issue.labels") document.warnings.push("This replaces the whole label set. GitHub may create a listed label that does not exist in the repository yet.");
      if (action.kind === "github.issue.assignees") document.warnings.push("This replaces every assignee. GitHub silently drops users it can't assign; the result must list exactly the requested users or the operation stays partial.");
      if (action.kind === "github.repo.settings") {
        const current = record(JSON.parse(document.resource!.content));
        document.confirmations.push(`I explicitly approve changing ${Object.keys(action.settings).sort().join(", ")} on ${action.repository}.`);
        if (action.settings.default_branch !== undefined && action.settings.default_branch !== current.default_branch) {
          document.confirmations.push(`I explicitly approve changing the default branch from ${string(current.default_branch) || "unknown"} to ${action.settings.default_branch}.`);
        }
      }
      if (action.kind === "github.release.publish" || action.kind === "github.release.create" && !action.draft || action.kind === "github.release.update" && !action.draft) document.confirmations.push("I explicitly approve publishing this exact release tag and target.");
    }
    if (action.kind === "github.ci.watch" && action.prNumber !== undefined) {
      const previous = this.operations().filter((operation) => operation.ci?.cleanupUnconfirmed &&
        operation.status !== "running" && operation.profileId === document.profileId && operation.projectId === scope.projectId &&
        operation.workspaceId === (scope.workspaceId ?? null) && sameDurableRoot(operation.root, document.root) &&
        operation.ci.target.accountId === document.accountId && operation.ci.target.repository.toLowerCase() === action.repository.toLowerCase() &&
        operation.ci.target.number === action.prNumber).at(-1);
      if (previous) {
        document.confirmations.push(ciRestartConfirmation(previous));
        document.warnings.push("The prior CI report remains partial/unconfirmed. This separate user-started read never resumes its polling, confirms prior process cleanup or cancels GitHub workflows.");
      }
    }
    parse(GithubReviewDocumentSchema, document); context.current();
    return { preview: { document, digest: digest(JSON.stringify(document)) }, current: context.current };
  }
  async query(query: GithubQuery, requested?: AbortSignal): Promise<GithubResponse> {
    query = structuredClone(parse(GithubQuerySchema, query));
    const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(this.options.readTimeoutMs ?? 30_000), ...(requested ? [requested] : [])]);
    signal.throwIfAborted();
    if (query.type === "git.read") return this.gitRead(query.scope, query.input, signal);
    if (query.type === "github.repositories") return this.repositories(query, signal);
    if (query.type === "github.project") return this.projectContext(query.scope, undefined, undefined, undefined, signal);
    if (query.type === "github.branch") {
      validateGithubRef(query.branch);
      const context = await this.projectContext(query.scope, { account: query.account, accountId: query.accountId }, undefined, undefined, signal);
      if (context.repository !== query.repository) throw new MoguriError("github_source", "The branch must belong to this exact project repository.", 409);
      const data = record((await this.api(context.binding.root.root, `repos/${query.repository}/branches/${encodeURIComponent(query.branch)}`, signal)).data);
      const head = string(record(data.commit).sha);
      if (string(data.name) !== query.branch || !sha.test(head) ||
        (await this.discoveryAccount(context.binding.root.root, query.account, signal)).accountId !== context.accountId) {
        throw new MoguriError("github_branch", "The exact branch/account response changed. No replacement base was adopted.", 409);
      }
      return { type: query.type, branch: query.branch, sha: head, accountId: context.accountId, binding: context.binding };
    }
    if (query.type === "github.source") {
      const result = await this.projectItem(query.scope, query.source, signal, true);
      return { type: query.type, source: query.source, ...result, digest: githubSourceDigest(query.source, result), warning };
    }
    if (query.type === "github.ci") {
      const source = await this.projectItem(query.scope, query.source, signal, true, query.binding, true);
      const watches = this.operations().filter((operation) =>
        githubCiOperationMatches(operation, { ...query.source, accountId: source.accountId }, source.binding)).reverse();
      return { type: query.type, source: query.source, ...source, watches,
        currentWatchId: source.item.state === "open" ? watches.find((operation) => operation.ci?.target.headSha === source.item.headSha)?.id ?? null : null,
        verifiedAt: new Date(this.now()).toISOString(), warning };
    }
    if (query.type === "github.preview") return { type: query.type, preview: (await this.preview(query.scope, query.action, signal)).preview };
    if (query.type === "github.browse") return this.browse(query.scope, query.input, signal);
    if (query.type === "github.history") {
      const values = this.operations().filter((value) => !query.projectId || value.projectId === query.projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { type: query.type, operations: values.slice(query.offset, query.offset + query.limit), total: values.length };
    }
    const operation = this.operation(query.operationId);
    const document = parse(GithubReviewDocumentSchema, JSON.parse(this.store.blob(operation.reviewDigest)));
    if (document.profileId !== operation.profileId || document.scope.projectId !== operation.projectId ||
      (document.scope.workspaceId ?? null) !== operation.workspaceId || (document.scope.sessionId ?? null) !== operation.originSessionId ||
      document.action.kind !== operation.kind || stable(document.root) !== stable(operation.root)) throw new MoguriError("github_corrupt", "The retained original review does not belong to this exact operation/profile/root. No fallback input was adopted.", 409);
    if (operation.ci && (document.action.kind !== "github.ci.watch" || document.action.prNumber !== operation.ci.target.number ||
      document.accountId !== operation.ci.target.accountId || document.action.repository !== operation.ci.target.repository ||
      document.action.account !== operation.ci.target.account || document.action.headSha !== operation.ci.target.headSha)) {
      throw new MoguriError("github_corrupt", "The retained CI watch lost its exact original PR/account/head review. No source was inferred from a commit.", 409);
    }
    const result = operation.resultDigest ? parse(GithubOperationResultSchema, JSON.parse(this.store.blob(operation.resultDigest))) : null;
    if (result && (result.operationId !== operation.id || result.kind !== operation.kind)) throw new MoguriError("github_corrupt", "The retained result belongs to different original work.", 409);
    const ciObservation = operation.ci?.observationDigest ?
      parse(GithubCiObservationSchema, JSON.parse(this.store.blob(operation.ci.observationDigest))) : undefined;
    if (ciObservation && (stable(ciObservation.target) !== stable(operation.ci?.target) ||
      ciObservation.state !== operation.ci?.state || ciObservation.items.length !== operation.ci?.count ||
      ciObservation.complete !== operation.ci?.complete || ciObservation.deadlineReached !== operation.ci?.deadlineReached)) {
      throw new MoguriError("github_corrupt", "The retained CI observation belongs to another original target or summary. No replacement was read.", 409);
    }
    const viewDocument = document.resource ? { ...document, resource: visibleResource(document.resource) } : document;
    const viewResult = result?.resource ? { ...result, resource: visibleItem(result.resource) } : result;
    const documentChanged = stable(viewDocument) !== stable(document), resultChanged = stable(viewResult) !== stable(result);
    return { type: query.type, operation, document: viewDocument, result: viewResult, ...(ciObservation ? { ciObservation } : {}), ...(documentChanged || resultChanged ? {
      commentFilter: { kind: "work-item-comments-v1" as const,
        ...(documentChanged ? { document: { sourceDigest: operation.reviewDigest, viewDigest: digest(stable(viewDocument)) } } : {}),
        ...(resultChanged && operation.resultDigest ? { result: { sourceDigest: operation.resultDigest, viewDigest: digest(stable(viewResult)) } } : {}) },
    } : {}) };
  }
  private async browse(scope: GithubScope, input: GithubBrowse, signal: AbortSignal): Promise<Extract<GithubResponse, { type: "github.browse" }>> {
    parse(GithubBrowseSchema, input);
    if (this.host.snapshot().settings.values.permissions.tools.some((rule) => rule.decision === "deny" &&
      ["*", "run_command", "github"].includes(rule.tool))) throw new MoguriError("github_denied", "A hard user policy excludes native GitHub CLI reads.", 403);
    const context = await this.context(scope, undefined, signal), root = context.root.root, accountId = await this.account(root, input.account, signal);
    const base = `repos/${input.repository}`, suffix = `per_page=${input.perPage}&page=${input.page}`;
    let path: string, kind: GithubItem["kind"], field: string | undefined, collection = true;
    switch (input.resource) {
      case "search": {
        if (!input.query.trim()) throw new MoguriError("github_search_query", "Enter non-empty search terms for the explicitly selected repository.", 400);
        if (/(?:repo|org|user):/i.test(input.query)) throw new MoguriError("github_search_scope", "Select the repository separately; search terms cannot replace its reviewed repository scope.", 409);
        let depth = 0, quoted = false, escaped = false;
        for (const character of input.query) {
          if (escaped) { escaped = false; continue; }
          if (character === "\\") {
            if (!quoted) throw new MoguriError("github_search_query", "Backslash escapes must stay inside a quoted search phrase.", 400);
            escaped = true; continue;
          }
          if (character === "\"") { quoted = !quoted; continue; }
          if (!quoted && character === "(") depth++;
          if (!quoted && character === ")" && --depth < 0) throw new MoguriError("github_search_query", "Search parentheses cannot escape the selected repository scope.", 400);
        }
        if (depth || quoted || escaped) throw new MoguriError("github_search_query", "Close every search parenthesis and quoted phrase before reading this exact repository.", 400);
        if (input.page * input.perPage > 1000) throw new MoguriError("github_search_limit", "GitHub search exposes at most 1,000 results. Refine the reviewed query instead of silently omitting later pages.", 409);
        path = `search/issues?q=${encodeURIComponent(`repo:${input.repository} (${input.query.trim()})`)}&${suffix}`;
        kind = "issue"; field = "items"; break;
      }
      case "issues": path = `${base}/issues?state=${input.state ?? "all"}&${suffix}`; kind = "issue"; break;
      case "pulls": path = `${base}/pulls?state=${input.state ?? "all"}&${suffix}`; kind = "pull"; break;
      case "issue": path = `${base}/issues/${input.number}`; kind = "issue"; collection = false; break;
      case "pull": path = `${base}/pulls/${input.number}`; kind = "pull"; collection = false; break;
      case "reviews": path = `${base}/pulls/${input.number}/reviews?${suffix}`; kind = "review"; break;
      case "comments": path = `${base}/issues/${input.number}/comments?${suffix}`; kind = "comment"; break;
      case "review-comments": path = `${base}/pulls/${input.number}/comments?${suffix}`; kind = "comment"; break;
      case "files": {
        const pull = record((await this.api(root, `${base}/pulls/${input.number}`, signal)).data);
        if (numeric(pull.number) !== input.number || record(pull.head).sha !== input.headSha) throw new MoguriError("github_head", "The PR head changed before its file read. No newer diff was substituted.", 409);
        path = `${base}/pulls/${input.number}/files?${suffix}`; kind = "file"; break;
      }
      case "jobs": {
        const run = record((await this.api(root, `${base}/actions/runs/${input.runId}`, signal)).data);
        if (numeric(run.id) !== input.runId || run.head_sha !== input.headSha) throw new MoguriError("github_head", "The selected run no longer matches this exact PR head. No job data was adopted.", 409);
        path = `${base}/actions/runs/${input.runId}/jobs?${suffix}`; kind = "job"; field = "jobs"; break;
      }
      case "threads": {
        const [owner, name] = input.repository.split("/");
        let after: string | null = null, selected: unknown[] = [], next = false, head = "";
        for (let page = 1; page <= input.page; page++) {
          const response = await this.api(root, "graphql", signal, "POST", {
            query: "query($owner:String!,$name:String!,$number:Int!,$first:Int!,$after:String){repository(owner:$owner,name:$name){nameWithOwner pullRequest(number:$number){number headRefOid reviewThreads(first:$first,after:$after){nodes{id isResolved isOutdated comments(last:1){nodes{databaseId body updatedAt author{login}}}} pageInfo{hasNextPage endCursor}}}}}",
            owner: owner!, name: name!, number: input.number, first: input.perPage, ...(after ? { after } : {}),
          });
          const repository = record(record(record(response.data).data).repository), pull = record(repository.pullRequest), threads = record(pull.reviewThreads), info = record(threads.pageInfo);
          if (string(repository.nameWithOwner).toLowerCase() !== input.repository.toLowerCase() || numeric(pull.number) !== input.number ||
            !sha.test(string(pull.headRefOid))) throw new MoguriError("github_thread", "The review-thread page does not belong to the exact repository/PR/head.", 409);
          if (head && head !== pull.headRefOid) throw new MoguriError("github_head", "The PR head changed while paging its review threads. No mixed-head page was adopted.", 409);
          head = string(pull.headRefOid); selected = items(threads, "nodes"); next = info.hasNextPage === true;
          if (!next) { if (page < input.page) selected = []; break; }
          if (!string(info.endCursor) || info.endCursor === after) throw new MoguriError("github_thread", "GitHub returned an incomplete or repeated review-thread cursor.", 502);
          after = string(info.endCursor);
        }
        if (next && input.page === 100) throw new MoguriError("github_limit", "Review-thread pagination reached its explicit 100-page bound; remaining work was not silently omitted.", 409);
        const values: GithubItem[] = selected.map((value) => {
          const thread = record(value), last = record(items(record(thread.comments), "nodes").at(-1));
          return { kind: "comment", id: numeric(last.databaseId), nodeId: string(thread.id), title: string(thread.id), body: stripMarkdownComments(string(last.body)),
            state: thread.isResolved === true ? "resolved" : "unresolved", url: null, updatedAt: string(last.updatedAt) || null,
            author: string(record(last.author).login) || null, headSha: head, conclusion: thread.isOutdated === true ? "outdated" : null };
        });
        await this.account(root, input.account, signal); context.current();
        return { type: "github.browse", boundary: "controller-gh-account-not-ssh", account: input.account, accountId, repository: input.repository,
          resource: input.resource, page: input.page, perPage: input.perPage, nextPage: next ? input.page + 1 : null, items: values, warning };
      }
      case "releases": path = `${base}/releases?${suffix}`; kind = "release"; break;
      case "release": path = `${base}/releases/${input.releaseId}`; kind = "release"; collection = false; break;
      case "release-latest": path = `${base}/releases/latest`; kind = "release"; collection = false; break;
      case "release-tag": validateGithubRef(input.tag); path = `${base}/releases/tags/${encodeURIComponent(input.tag)}`; kind = "release"; collection = false; break;
      case "tags": path = `${base}/tags?${suffix}`; kind = "tag"; break;
      case "annotations": {
        const check = record((await this.api(root, `${base}/check-runs/${input.checkRunId}`, signal)).data);
        if (numeric(check.id) !== input.checkRunId || check.head_sha !== input.headSha) throw new MoguriError("github_head", "The selected check run no longer matches this exact head. No annotations were adopted.", 409);
        path = `${base}/check-runs/${input.checkRunId}/annotations?${suffix}`; kind = "annotation"; break;
      }
      case "contents": {
        const parts = input.path.split("/").filter(Boolean);
        if (input.path.startsWith("/") || parts.some((part) => part === "." || part === "..") || /[\0\\]/.test(input.path)) throw new MoguriError("github_path", "Use a repository-relative path without . or .. segments.", 400);
        if (input.ref) validateGithubRef(input.ref);
        path = `${base}/contents/${parts.map(encodeURIComponent).join("/")}${input.ref ? `?ref=${encodeURIComponent(input.ref)}` : ""}`; kind = "content"; collection = false; break;
      }
      case "settings": path = base; kind = "settings"; collection = false; break;
      case "rulesets": path = `${base}/rulesets?${suffix}&includes_parents=true`; kind = "ruleset"; break;
      case "branch-rules": validateGithubRef(input.branch); path = `${base}/rules/branches/${encodeURIComponent(input.branch)}?${suffix}`; kind = "rule"; break;
      case "runs": path = `${base}/actions/runs?${suffix}${input.headSha ? `&head_sha=${input.headSha}` : ""}`; kind = "run"; field = "workflow_runs"; break;
      case "run": path = `${base}/actions/runs/${input.runId}`; kind = "run"; collection = false; break;
      case "logs": {
        const run = record((await this.api(root, `${base}/actions/runs/${input.runId}`, signal)).data);
        const text = await this.run("gh", ["run", "view", String(input.runId), "--repo", input.repository, "--log"], {
          cwd: root, signal, label: "Read bounded GitHub run logs", timeoutMs: this.options.readTimeoutMs ?? 30_000, maxBytes: 512 * 1024,
          env: { GH_HOST: "github.com", GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" },
        });
        await this.account(root, input.account, signal); context.current();
        return { type: "github.browse", boundary: "controller-gh-account-not-ssh", account: input.account, accountId, repository: input.repository,
          resource: input.resource, page: input.page, perPage: input.perPage, nextPage: null,
          items: [{ ...item(run, "logs"), body: text }], warning: `${warning} Logs are untrusted output, bounded to 512 KiB; excess fails rather than silently truncates.` };
      }
      case "checks": {
        const checked = await this.checks(root, input.repository, input.headSha, input.page, input.perPage, signal);
        if (checked.next && input.page === 100) throw new MoguriError("github_limit", "Check/status pagination reached its explicit 100-page bound.", 409);
        context.current();
        return { type: "github.browse", boundary: "controller-gh-account-not-ssh", account: input.account, accountId,
          repository: input.repository, resource: input.resource, page: input.page, perPage: input.perPage,
          nextPage: checked.next && input.page < 100 ? input.page + 1 : null, items: checked.items, warning };
      }
      case "commits": case "timeline": {
        const response = await this.api(root, input.resource === "commits" ? `${base}/pulls/${input.number}/commits?${suffix}` :
          `${base}/issues/${input.number}/timeline?${suffix}`, signal);
        if (response.next && input.page === 100) throw new MoguriError("github_limit", "GitHub pagination reached its explicit 100-page bound; remaining records were not silently omitted.", 409);
        const offset = (input.page - 1) * input.perPage;
        const values = input.resource === "commits" ? items(response.data).map((value, index) => commitItem(value, offset + index + 1)) :
          items(response.data).flatMap(timelineItems);
        await this.account(root, input.account, signal); context.current();
        return { type: "github.browse", boundary: "controller-gh-account-not-ssh", account: input.account, accountId, repository: input.repository,
          resource: input.resource, page: input.page, perPage: input.perPage, nextPage: response.next && input.page < 100 ? input.page + 1 : null, items: values, warning };
      }
      case "labels": path = `${base}/labels?${suffix}`; kind = "label"; break;
      case "assignees": path = `${base}/assignees?${suffix}`; kind = "user"; break;
    }
    const response = await this.api(root, path, signal);
    if (input.resource === "search" && record(response.data).incomplete_results !== false) throw new MoguriError("github_incomplete", "GitHub returned incomplete search evidence. Refine the query; no complete result was inferred.", 502);
    if (collection && response.next && input.page === 100) throw new MoguriError("github_limit", "GitHub pagination reached its explicit 100-page bound; remaining records were not silently omitted.", 409);
    let values = collection ? items(response.data, field) : input.resource === "contents" && Array.isArray(response.data) ? response.data : [response.data];
    if (input.resource === "search") {
      const total = record(response.data).total_count;
      if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) throw new MoguriError("github_incomplete", "GitHub did not provide a valid search total. No complete page was inferred.", 502);
      if (total > 1000) throw new MoguriError("github_search_limit", "This search exceeds GitHub's 1,000-result bound. Refine the query; excess records were not silently omitted.", 409);
      const remaining = Math.max(0, total - (input.page - 1) * input.perPage), expected = Math.min(remaining, input.perPage);
      if (values.length !== expected || response.next !== (remaining > input.perPage)) throw new MoguriError("github_incomplete", "GitHub's search count, page or next-page receipt is inconsistent. No missing records were treated as an empty complete result.", 502);
    }
    if (input.resource === "search" && values.some((value) => {
      const data = record(value);
      return string(data.repository_url).toLowerCase() !== `https://api.github.com/repos/${input.repository}`.toLowerCase();
    })) throw new MoguriError("github_search_scope", "The search response contains a different repository. No foreign result was adopted.", 502);
    if (input.resource === "issues") values = values.filter((value) => !record(value).pull_request);
    if (input.resource === "issue" && record(response.data).pull_request) throw new MoguriError("github_source", "This number is a pull request, not an issue. Choose it from pull requests.", 409);
    if (input.resource === "settings" && string(record(response.data).full_name).toLowerCase() !== input.repository.toLowerCase()) throw new MoguriError("github_source", "GitHub returned a different repository's settings. Nothing was adopted.", 502);
    const result = values.map((value) => item(value, input.resource === "search" && record(value).pull_request ? "pull" : kind));
    if (input.resource === "files") {
      const pull = record((await this.api(root, `${base}/pulls/${input.number}`, signal)).data);
      if (numeric(pull.number) !== input.number || record(pull.head).sha !== input.headSha) throw new MoguriError("github_head", "The PR head changed during its file read. No mixed-head diff was adopted.", 409);
    }
    if (input.resource === "runs" && input.headSha && result.some((value) => value.headSha !== input.headSha)) throw new MoguriError("github_head", "GitHub returned workflow runs from a different head. No CI result was adopted.", 409);
    await this.account(root, input.account, signal); context.current();
    return { type: "github.browse", boundary: "controller-gh-account-not-ssh", account: input.account, accountId, repository: input.repository,
      resource: input.resource, page: input.page, perPage: input.perPage,
      nextPage: collection && response.next && input.page < 100 ? input.page + 1 : null, items: result, warning };
  }
  private async checks(root: string, repository: string, head: string, page: number, perPage: number, signal: AbortSignal) {
    const base = `repos/${repository}/commits/${head}`, suffix = `per_page=${perPage}&page=${page}`;
    const [checks, statuses] = await Promise.all([this.api(root, `${base}/check-runs?filter=latest&${suffix}`, signal), this.api(root, `${base}/status?${suffix}`, signal)]);
    const values = items(checks.data, "check_runs").map((value) => item(value, "check"));
    if (values.some((value) => value.headSha !== head) || record(statuses.data).sha !== head) throw new MoguriError("github_head", "Checks/statuses were not bound to the exact reviewed commit.", 409);
    const statusItems = items(statuses.data, "statuses").map((value) => ({ ...item(value, "status"), headSha: head }));
    return { items: [...values, ...statusItems], next: checks.next || statuses.next,
      totals: { checks: record(checks.data).total_count, statuses: record(statuses.data).total_count },
      received: { checks: values.length, statuses: statusItems.length } };
  }
  private workAuthority(scope: GithubScope, action: GithubAction, id: string): string {
    const run = this.host.snapshot().projectWorkRuns.find((run) => run.id === id), session = this.host.snapshot().sessions.find((session) => session.id === scope.sessionId);
    const origin = run ? this.host.snapshot().sessions.find((session) => session.id === run.originSessionId) : undefined;
    if (!run || run.status !== "publishing" || !session || run.sessionId !== session.id || run.turnId !== session.turnId ||
      !origin || digest(JSON.stringify(origin.controls)) !== run.originControlsDigest ||
      run.projectId !== scope.projectId || run.workspaceId !== scope.workspaceId || run.profileId !== this.host.snapshot().profileId ||
      run.binding.policyRevision !== this.host.snapshot().policy.revision || run.binding.permissionRevision !== this.host.snapshot().settings.permissionRevision ||
      run.binding.configurationRevision !== this.host.configuration(run.projectId).revision ||
      !sameDurableRoot(run.binding.root, sourceRootSync(this.host.project(run.projectId, origin.workspaceId ?? undefined).path)) ||
      run.source.kind === "kanban" && !this.host.snapshot().issues.some((issue) => issue.id === run.source.key.slice("kanban:".length) && digest(kanbanIssueSignature(issue)) === run.source.digest) ||
      [run.baseBranch, "main", "master"].includes(run.destinationBranch) ||
      !(action.kind === "git.push" ? !action.forceWithLease && action.remote === run.remote && action.branch === run.branch &&
        (action.destination ?? action.branch) === run.destinationBranch :
        action.kind === "github.pr.create" ? !run.existingPrNumber && action.repository === run.repository && action.account === run.account &&
          action.head === run.destinationBranch && action.base === run.baseBranch && action.draft && !action.headRepository :
        action.kind === "github.pr.update" && action.repository === run.repository && action.account === run.account && action.number === run.existingPrNumber && action.state === undefined)) {
      throw new MoguriError("github_work_delegation", "The actual retained user task does not delegate this exact branch, PR, repository or owning turn. No model-owned permission was inferred.", 403);
    }
    return session.id;
  }
  async workPreview(scope: GithubScope, action: GithubAction, projectWorkId: string): Promise<GithubPreview> {
    this.workAuthority(scope, action, projectWorkId);
    const run = this.host.snapshot().projectWorkRuns.find((run) => run.id === projectWorkId)!;
    const project = await this.projectContext(scope, { account: run.account, accountId: run.accountId }, { repository: run.repository, fetchUrl: run.fetchUrl, pushUrl: run.pushUrl });
    if (action.kind === "git.push" && (action.destination ?? action.branch) === project.defaultBranch) throw new MoguriError("github_work_protected", "The task destination is now the actual default branch. No autonomous push was authorized.", 403);
    this.workAuthority(scope, action, projectWorkId);
    return (await this.preview(scope, action, AbortSignal.timeout(this.options.readTimeoutMs ?? 30_000), undefined, projectWorkId)).preview;
  }
  async toolPreview(scope: GithubScope, action: GithubAction, authority: GitToolAuthority): Promise<GithubPreview> {
    authority.guard();
    if (scope.sessionId !== authority.sessionId || !modelToolAction(action)) throw new MoguriError("git_tool_owner", "This model Git/GitHub review lost its exact owning session, or the action needs a user.", 403);
    return (await this.preview(scope, action, AbortSignal.any([authority.signal, AbortSignal.timeout(this.options.readTimeoutMs ?? 30_000)]), undefined, undefined, authority)).preview;
  }
  async recoverManagedBranch(inspection: WorkspaceInspection): Promise<EventInput[] | null> {
    const workspace = inspection.workspace;
    if (!this.host.branchEvents || !inspection.exists || !inspection.canonical || !inspection.registered || !inspection.branch) return null;
    for (const operation of this.operations().filter((operation) => operation.workspaceId === workspace.id &&
      operation.projectId === workspace.projectId && operation.kind === "git.branch.rename" && operation.status === "partial" &&
      operation.inspection && operation.resultDigest)) {
      if (!operation.resultDigest) continue;
      const document = parse(GithubReviewDocumentSchema, JSON.parse(this.store.blob(operation.reviewDigest)));
      const result = parse(GithubOperationResultSchema, JSON.parse(this.store.blob(operation.resultDigest)));
      if (document.action.kind !== "git.branch.rename" || document.action.from !== workspace.branch || document.action.to !== inspection.branch ||
        document.managedBranch?.revision !== workspace.revision || document.managedBranch.changeSetId !== workspace.changeSetId ||
        document.scope.workspaceId !== workspace.id || stable(document.root) !== stable(operation.root) ||
        result.operationId !== operation.id || result.kind !== operation.kind || result.branch !== inspection.branch ||
        result.head !== document.git.head || result.outcome !== "completed") continue;
      const actual = await this.gitState(workspace.path, AbortSignal.timeout(this.options.readTimeoutMs ?? 30_000));
      if (!sameDurableRoot(document.root, sourceRootSync(workspace.path)) || actual.commonDir !== document.git.commonDir ||
        actual.head !== document.git.head || actual.branch !== result.branch || actual.indexDigest !== document.git.indexDigest ||
        actual.worktreeDigest !== document.git.worktreeDigest) throw new MoguriError("git_workspace_recovery", "The original partial rename no longer matches its exact root, HEAD, index or files. No metadata, Git effect or successful outcome was replayed.", 409);
      return this.host.branchEvents(document, result.branch, operation.id);
    }
    return null;
  }
  async execute(command: GithubCommand, finish: WorkspaceFinish, modelSource?: ModelAdviceSource, projectWorkId?: string, toolAuthority?: GitToolAuthority): Promise<CommandResult> {
    command = structuredClone(parse(GithubCommandSchema, command));
    toolAuthority?.guard();
    if (command.type === "github.execute" && command.action.kind === "git.remote.set" && (modelSource || projectWorkId || toolAuthority)) throw new MoguriError("remote_user_only", "Repository remote changes require a separate actual-user review. No model or delegated workflow may retarget a repository.", 403);
    if (toolAuthority && (!modelSource || projectWorkId || command.type !== "github.execute" ||
      command.scope.sessionId !== toolAuthority.sessionId || !modelToolAction(command.action))) throw new MoguriError("git_tool_owner", "Only the exact approved model Git/GitHub call can hand its root to this job.", 403);
    const ownerSessionId = toolAuthority?.sessionId ?? (projectWorkId && modelSource && command.type === "github.execute" ? this.workAuthority(command.scope, command.action, projectWorkId) : undefined);
    if (projectWorkId && !ownerSessionId || modelSource && !ownerSessionId && (command.type !== "github.execute" || command.action.kind !== "github.issue.create" || !command.scope.sessionId)) throw new MoguriError("github_model_scope", "Model writes require the exact issue adapter or retained user-delegated project task, never arbitrary Git writes, merges or inspection acknowledgement.", 403);
    const intent = finish.intent;
    if (!intent || !/^[a-f0-9]{64}$/.test(intent.digest)) throw new MoguriError("github_intent", "An actual-user canonical command identity is required before Git/GitHub admission.", 409);
    if (command.type === "github.acknowledge") {
      const receipt = this.store.receipt(intent.id, intent.digest);
      if (receipt) return receipt;
      const owner = this.operations().find((operation) => operation.commandId === intent.id || operation.inspection?.commandId === intent.id);
      if (owner) throw new MoguriError("github_no_replay", "This retained command/inspection already owns its canonical identity without a receipt. No inspection, job, signal or operation was replayed.", 409);
      const operation = this.operation(command.operationId);
      if (operation.revision !== command.expectedRevision || operation.inputDigest !== command.expectedInputDigest) throw new MoguriError("github_inspection_stale", "The retained operation revision or original input digest changed. Read that exact operation again before inspection acknowledgement.", 409);
      if (operation.status !== "partial" || !operation.kind.startsWith("git.") || operation.inspection) throw new MoguriError("github_inspection", "Only an uninspected terminal partial Git operation can receive this one actual-user inspection acknowledgement.", 409);
      const now = new Date(this.now()).toISOString();
      return finish([this.event({ ...operation, revision: operation.revision + 1, updatedAt: now, inspection: {
        actor: "user", at: now, commandId: intent.id, commandDigest: intent.digest, operationId: operation.id,
        observedRevision: operation.revision, inputDigest: operation.inputDigest,
      } })], { id: operation.id, revision: operation.revision + 1 });
    }
    const previous = this.operations().find((operation) => operation.commandId === intent.id);
    if (previous) {
      if (previous.commandDigest !== intent.digest) throw new MoguriError("github_command_conflict", "This canonical command ID already belongs to different retained Git/GitHub input.", 409);
      const receipt = this.store.receipt(intent.id, intent.digest);
      if (receipt) return receipt;
      throw new MoguriError("github_no_replay", "The original retained operation has no command receipt. Inspect its independent history; source deletion, lost receipts or restart cannot replay it.", 409);
    }
    const { preview, current } = await this.preview(command.scope, command.action, AbortSignal.any([AbortSignal.timeout(this.options.readTimeoutMs ?? 30_000), ...(toolAuthority ? [toolAuthority.signal] : [])]), undefined, projectWorkId, toolAuthority);
    const concurrent = this.operations().find((operation) => operation.commandId === intent.id);
    if (concurrent) {
      if (concurrent.commandDigest !== intent.digest) throw new MoguriError("github_command_conflict", "A concurrent command already owns this canonical identity with different input.", 409);
      const receipt = this.store.receipt(intent.id, intent.digest);
      if (receipt) return receipt;
      throw new MoguriError("github_no_replay", "The concurrently retained original intent has no receipt. It cannot authorize a second Git/GitHub dispatch.", 409);
    }
    if (preview.digest !== command.expectedDigest || stable(command.confirmations) !== stable(preview.document.confirmations)) throw new MoguriError("github_review", "The exact action, root, Git/index/remote/resource revision, policy or explicit protected-action confirmations changed. Review again; nothing was dispatched.", 409);
    current();
    const root = preview.document.root.root, lease = filesystemWriter(command.action);
    if (command.action.kind === "github.ci.watch" && command.action.prNumber !== undefined) {
      const action = command.action;
      const owners = this.operations().filter((operation) => operation.ci && ["running", "partial"].includes(operation.status) &&
        operation.profileId === preview.document.profileId && operation.projectId === command.scope.projectId &&
        operation.workspaceId === (command.scope.workspaceId ?? null) && sameDurableRoot(operation.root, preview.document.root) &&
        operation.ci.target.repository.toLowerCase() === action.repository.toLowerCase() &&
        operation.ci.target.number === action.prNumber && operation.ci.target.accountId === preview.document.accountId);
      const original = owners.find((operation) => operation.status === "running") ?? owners.at(-1);
      if (original) {
        const independent = original.status === "partial" && !this.active.has(original.id) && command.confirmations.includes(ciRestartConfirmation(original));
        if (!independent && (original.status === "partial" || original.ci?.target.headSha !== action.headSha)) {
          throw new MoguriError("github_ci_active", "The original PR watcher has another head or unconfirmed ownership. Stop/inspect that exact owner before starting another; no poller was duplicated or retargeted.", 409);
        }
        if (!this.store.receipt(original.commandId, original.commandDigest)) {
          throw new MoguriError("github_no_replay", "The retained PR watcher has no original admission receipt. Inspect it; another view cannot authorize replay or a second poller.", 409);
        }
        if (!independent) return finish([], { id: original.id });
      }
    }
    const leaseRoots = preview.document.remoteChange ? [...new Set([preview.document.remoteChange.common.root,
      ...preview.document.remoteChange.worktrees.map((worktree) => worktree.root)])] : [root];
    const permit = () => this.permitRebaseRecovery(preview.document.root, command.action, preview.document.git);
    if (lease && leaseRoots.some((root) => this.pendingRoots.has(root) || this.roots.has(root) || this.host.rootBusy(root, undefined, permit(), ownerSessionId) ||
      command.action.kind === "git.remote.set" && this.host.consoleBusy?.(root))) throw new MoguriError("workspace_busy", "This exact Local/shared-config boundary already has an owned writer, console or unrelated quarantine. No competing Git/GitHub intent was admitted.", 409);
    if (lease) for (const root of leaseRoots) this.pendingRoots.add(root);
    let result: CommandResult | undefined;
    const operationId = randomUUID(), inputDigest = this.store.putBlob(JSON.stringify(command)), reviewDigest = this.store.putBlob(JSON.stringify(preview.document));
    try {
      this.host.job(command.action.kind, command.scope.projectId, command.scope.workspaceId,
        (signal, progress, jobId) => this.perform(operationId, preview.document, signal, progress, jobId, toolAuthority),
        (job) => {
          if (lease && leaseRoots.some((root) => this.host.rootBusy(root, undefined, permit(), ownerSessionId) ||
            command.action.kind === "git.remote.set" && this.host.consoleBusy?.(root))) throw new MoguriError("workspace_busy", "An owned writer, console or unrelated quarantine acquired the exact shared boundary during review. No dispatch.", 409);
          if (projectWorkId) this.workAuthority(command.scope, command.action, projectWorkId);
          toolAuthority?.guard();
          this.policy(command.scope, command.action);
          const now = new Date(this.now()).toISOString(), operation: GithubOperation = {
            version: 1, id: operationId, profileId: preview.document.profileId, projectId: command.scope.projectId,
            workspaceId: command.scope.workspaceId ?? null, originSessionId: command.scope.sessionId ?? null, root: preview.document.root,
            kind: command.action.kind, actor: modelSource ? "model" : "user", ...(modelSource ? { modelSource } : {}), commandId: intent.id, commandDigest: intent.digest, reviewDigest, inputDigest,
            ...(projectWorkId ? { projectWorkId } : {}),
            ...(toolAuthority ? { toolCallDigest: toolAuthority.callDigest } : {}),
            resultDigest: null, jobId: job.id, revision: 0, status: "running", dispatched: false, cancelRequested: false,
            ...(preview.document.remoteChange ? { leaseRoots } : {}),
            ...(command.action.kind === "github.ci.watch" && command.action.prNumber !== undefined ? { ci: { version: 1 as const, target: {
              repository: command.action.repository, account: command.action.account, accountId: preview.document.accountId!,
              number: command.action.prNumber, headSha: command.action.headSha,
            }, observationDigest: null, observedAt: null, state: null, count: 0, complete: false, deadlineReached: false, cleanupUnconfirmed: false } } : {}),
            createdAt: now, updatedAt: now, diagnostic: null,
          };
          result = finish([this.event(operation), { event_type: "job.started", profile_id: operation.profileId, project_id: operation.projectId,
            session_id: operation.originSessionId, payload: { job: { ...job, operationId } } }], { id: operationId });
          if (lease) for (const root of leaseRoots) this.roots.add(root);
        }, () => { if (lease) for (const root of leaseRoots) this.roots.delete(root); this.results.delete(operationId); this.active.delete(operationId); }, this.lifecycle(operationId), command.scope.sessionId);
    } finally { if (lease) for (const root of leaseRoots) this.pendingRoots.delete(root); }
    if (!result) throw new MoguriError("github_intent", "The Git/GitHub operation and receipt were not atomically acknowledged. No dispatch was returned.", 409);
    return result;
  }
  private lifecycle(id: string): CandidateJobLifecycle {
    return {
      completed: (value, resultDigest) => {
        const result = parse(GithubOperationResultSchema, value), operation = this.operation(id);
        this.results.set(id, { value: result, digest: resultDigest });
        if (result.operationId !== id || result.kind !== operation.kind || operation.cancelRequested ||
          (result.kind === "github.ci.watch") !== (result.outcome === "ci" && result.ci !== null) ||
          result.outcome === "conflicts" && !["git.rebase", "git.revert"].includes(result.kind)) throw new MoguriError("github_partial", "Final Git/GitHub ownership, typed result or cancellation acknowledgement is missing. Inspect retained observations.", 409);
        if (result.outcome === "partial") throw new MoguriError("github_partial", "Only a partial acknowledgement was observed. No completed operation was inferred.", 409);
        if (result.outcome === "conflicts") throw new MoguriError("github_conflicts", `${result.kind === "git.revert" ? "Revert" : "Rebase"} stopped with conflicts. Both histories and the actual index/worktree are preserved; inspect the retained operation before explicit recovery.`, 409);
        const document = parse(GithubReviewDocumentSchema, JSON.parse(this.store.blob(operation.reviewDigest)));
        const branch = operation.workspaceId && operation.kind === "git.branch.rename" ? this.host.branchEvents?.(document, result.branch, operation.id) : [];
        if (operation.workspaceId && operation.kind === "git.branch.rename" && !branch) throw new MoguriError("git_workspace_binding", "The exact managed branch acknowledgement is missing. Inspect the partial original operation.", 409);
        const remote = operation.kind === "git.remote.set" ? this.host.remoteEvents?.(document) : [];
        if (operation.kind === "git.remote.set" && !remote) throw new MoguriError("remote_publication", "The shared remote changed but its current projection publication is unavailable. Inspect the retained operation; no complete success was recorded.", 409);
        return [...(branch ?? []), ...(remote ?? []), this.event({ ...operation, revision: operation.revision + 1, status: "completed", resultDigest,
          updatedAt: new Date(this.now()).toISOString(), diagnostic: null })];
      },
      failed: (error, cancelled) => {
        const operation = this.operation(id), observation = this.results.get(id);
        const cleanupUnconfirmed = Boolean(operation.ci && error instanceof MoguriError && error.code === "program_partial");
        const status = cleanupUnconfirmed ? operation.dispatched ? "partial" : "failed" :
          operation.dispatched && operation.kind !== "github.ci.watch" ? "partial" : cancelled || operation.cancelRequested || this.shutdown.signal.aborted ? "cancelled" : "failed";
        const message = status === "partial" ? operation.ci ?
          `${diagnostic(error)} Original CI read/process cleanup is unconfirmed; GitHub's workflow was not cancelled. No polling or input was replayed.`.slice(0, 3900) :
          `${diagnostic(error)} An effect may already exist. No rebase abort, rollback, input replay or automatic write retry was performed.`.slice(0, 3900) : diagnostic(error);
        return { events: [this.event({ ...operation, revision: operation.revision + 1, status,
          ...(cleanupUnconfirmed && operation.ci ? { ci: { ...operation.ci, cleanupUnconfirmed: true } } : {}),
          updatedAt: new Date(this.now()).toISOString(), cancelRequested: operation.cancelRequested || cancelled || this.shutdown.signal.aborted,
          resultDigest: observation ? observation.digest ?? this.store.putBlob(JSON.stringify(observation.value)) : null, diagnostic: message })], status, error: message };
      },
    };
  }
  private async perform(id: string, document: GithubReviewDocument, ownerSignal: AbortSignal, progress: (text: string) => void, jobId: string, toolAuthority?: GitToolAuthority): Promise<GithubOperationResult> {
    const abort = new AbortController(); this.active.set(id, abort);
    const signal = AbortSignal.any([ownerSignal, this.shutdown.signal, abort.signal, ...(toolAuthority ? [toolAuthority.signal] : [])]);
    const cancelled = () => {
      const operation = this.operation(id);
      if (operation.status === "running" && !operation.cancelRequested) this.update(id, { cancelRequested: true });
    };
    signal.addEventListener("abort", cancelled, { once: true });
    try {
      signal.throwIfAborted();
      const projectWorkId = this.operation(id).projectWorkId;
      const prCi = document.action.kind === "github.ci.watch" && document.action.prNumber !== undefined;
      if (prCi) {
        const original = this.operation(id);
        if (original.status !== "running" || original.dispatched) throw new MoguriError("github_no_replay", "The original PR read preparation is no longer undispatched.", 409);
        this.update(id, { dispatched: true });
      }
      if (projectWorkId) {
        const run = this.host.snapshot().projectWorkRuns.find((run) => run.id === projectWorkId)!;
        const project = await this.projectContext(document.scope, { account: run.account, accountId: run.accountId }, { repository: run.repository, fetchUrl: run.fetchUrl, pushUrl: run.pushUrl });
        if (document.action.kind === "git.push" && (document.action.destination ?? document.action.branch) === project.defaultBranch) throw new MoguriError("github_work_protected", "The task destination became the actual default branch before dispatch.", 403);
        signal.throwIfAborted();
      }
      const fresh = await this.preview(document.scope, document.action, signal, jobId, this.operation(id).projectWorkId, toolAuthority);
      if (fresh.preview.digest !== digest(JSON.stringify(document))) throw new MoguriError("github_review", "The exact reviewed root, Git/index/remote/resource/account or policy changed before dispatch. No effect was attempted.", 409);
      fresh.current(); await this.host.assertRoot(document.scope.projectId, document.scope.workspaceId, signal); fresh.current();
      if (this.operation(id).status !== "running" || !prCi && this.operation(id).dispatched) throw new MoguriError("github_no_replay", "This retained intent is no longer an original undispatched operation.", 409);
      progress(`Executing reviewed ${document.action.kind}; no automatic retry.`);
      if (document.action.kind === "github.ci.watch") { if (!prCi) this.update(id, { dispatched: true }); return await this.watch(id, document, signal, progress); }
      if (githubAction(document.action)) return await this.githubWrite(id, document, document.action, signal);
      this.update(id, { dispatched: true });
      return await this.gitWrite(id, document, signal);
    } finally { signal.removeEventListener("abort", cancelled); }
  }
  private async localResult(id: string, document: GithubReviewDocument, signal: AbortSignal, outcome: GithubOperationResult["outcome"] = "completed", remoteSha: string | null = null): Promise<GithubOperationResult> {
    this.effectScope(document, signal);
    const state = await this.gitState(document.root.root, signal);
    this.effectScope(document, signal);
    return { version: 1, operationId: id, kind: document.action.kind, outcome, head: state.head, branch: state.branch, status: state.status,
      rebaseInProgress: state.rebaseDigest !== null, remoteSha, resource: null, ci: null,
      diagnostic: outcome === "conflicts" ? `The actual ${document.action.kind} stopped with conflicts; inspect before explicit recovery. No automatic cleanup.` : null };
  }
  private acknowledge(id: string, document: GithubReviewDocument, resource: GithubItem | null = null, remoteSha: string | null = null): void {
    const value = parse(GithubOperationResultSchema, {
      version: 1, operationId: id, kind: document.action.kind, outcome: "partial",
      head: document.git.head, branch: document.git.branch, status: document.git.status, rebaseInProgress: document.git.rebaseDigest !== null,
      remoteSha, resource, ci: null,
      diagnostic: "An intermediate CLI/API acknowledgement was observed, not verified completion. HEAD/branch/status/rebase fields are the original pre-effect review; current source/account/destination verification may be missing. No success, rollback or replay was inferred.",
    });
    this.results.set(id, { value });
  }
  private async gitWrite(id: string, document: GithubReviewDocument, signal: AbortSignal): Promise<GithubOperationResult> {
    const action = document.action, root = document.root.root;
    this.effectScope(document, signal);
    if (action.kind === "git.remote.set") {
      const review = document.remoteChange, operation = this.operation(id);
      if (!review || operation.actor !== "user" || review.name !== action.remote ||
        review.url !== repositoryUrl(action.url)) throw new MoguriError("remote_review", "The exact actual-user remote/config review is missing. No URL was changed.", 409);
      const guard = () => {
        this.effectScope(document, signal);
        if (!this.host.consoleBusy || this.host.consoleBusy(review.common.root) || this.host.rootBusy(review.common.root, operation.jobId) || !sameDurableRoot(review.common, sourceRootSync(review.common.root))) throw new MoguriError("remote_ownership", "The shared Git directory changed ownership or identity. No alternate config was used.", 409);
        for (const worktree of review.worktrees) if (!sameDurableRoot(worktree, sourceRootSync(worktree.root)) ||
          this.host.rootBusy(worktree.root, operation.jobId) || this.host.consoleBusy(worktree.root)) throw new MoguriError("remote_ownership", "An affected linked worktree changed identity or ownership. No root/account fallback was used.", 409);
      };
      await applyRemoteChange(review, dirname(this.store.path), signal, guard, () => this.acknowledge(id, document), this.run);
      const after = await this.gitState(root, signal);
      if (after.commonDir !== document.git.commonDir || after.head !== document.git.head || after.branch !== document.git.branch ||
        after.indexDigest !== document.git.indexDigest || after.worktreeDigest !== document.git.worktreeDigest) throw new MoguriError("remote_partial", "The remote changed but actual HEAD/index/working bytes differ from the original review. Preserve them and inspect; no complete success was inferred.", 409);
      for (const worktree of review.worktrees) {
        guard();
        const fetch = (await this.git(worktree.root, ["remote", "get-url", "--all", action.remote], signal)).trim().split("\n");
        const push = (await this.git(worktree.root, ["remote", "get-url", "--push", "--all", action.remote], signal)).trim().split("\n");
        if (stable(fetch) !== stable([worktree.nextFetchUrl]) || stable(push) !== stable([worktree.nextPushUrl])) throw new MoguriError("remote_partial", "A linked worktree's effective fetch/push destination differs from the reviewed URL. No success, retry or rollback was inferred.", 409);
      }
      return this.localResult(id, document, signal);
    }
    if (action.kind === "git.branch.create" || action.kind === "git.branch.rename" || action.kind === "git.switch") {
      if (action.kind === "git.branch.create") {
        await this.git(root, ["branch", "--", action.branch, document.targetSha!], signal, true);
        this.acknowledge(id, document);
        if (action.checkout) { this.effectScope(document, signal); await this.git(root, ["switch", "--no-guess", "--no-overwrite-ignore", "--", action.branch], signal, true); }
      } else if (action.kind === "git.branch.rename") await this.git(root, ["branch", "--move", "--", action.from, action.to], signal, true);
      else await this.git(root, ["switch", "--no-guess", "--no-overwrite-ignore", "--", action.branch], signal, true);
      this.acknowledge(id, document);
      const branch = action.kind === "git.branch.rename" ? action.to : action.branch;
      const actual = (await readGit(root, ["rev-parse", "--verify", "--end-of-options", `refs/heads/${branch}`], signal)).trim();
      const after = await this.gitState(root, signal), switched = action.kind === "git.switch" || action.kind === "git.branch.create" && action.checkout;
      if (actual !== (action.kind === "git.branch.rename" ? document.git.head : document.targetSha) ||
        after.head !== (switched ? document.targetSha : document.git.head) ||
        after.branch !== (switched || action.kind === "git.branch.rename" ? branch : document.git.branch) ||
        (switched ? Boolean(after.status) : after.indexDigest !== document.git.indexDigest || after.worktreeDigest !== document.git.worktreeDigest)) {
        throw new MoguriError("github_partial", "The actual branch/HEAD/index/worktree differs from the exact reviewed branch operation. Preserve it and inspect; no force rename, rollback or retry was performed.", 409);
      }
      if (action.kind === "git.branch.rename" && (await readGit(root, ["for-each-ref", "--format=%(refname)", `refs/heads/${action.from}`], signal)).trim()) throw new MoguriError("github_partial", "The original branch ref still exists after rename acknowledgement. No deletion or retry was inferred.", 409);
      return this.localResult(id, document, signal);
    }
    if (action.kind === "git.stage" || action.kind === "git.unstage") {
      if (!document.files || !document.unaffectedIndexDigest || !document.workingTreeDigest) throw new MoguriError("git_review", "The original complete file/index review is missing. No staging effect was dispatched.", 409);
      await this.git(root, action.kind === "git.stage" ? ["add", "--", ...action.paths] :
        ["restore", "--staged", `--source=${document.git.head}`, "--", ...action.paths], signal, true);
      this.acknowledge(id, document);
      const entries = await this.indexEntries(root, signal), selected = new Set(action.paths);
      const expected = action.kind === "git.stage" ? document.files.flatMap((file) => file.blob && file.mode ? [{
        path: file.path, mode: file.mode, sha: file.blob, stage: 0,
      }] : []) : (await this.treeEntries(root, document.git.head, signal)).filter((entry) => selected.has(entry.path));
      const order = <T extends { path: string }>(values: T[]) => values.sort((a, b) => a.path.localeCompare(b.path, "en"));
      if (digest(stable(entries.filter((entry) => !selected.has(entry.path)))) !== document.unaffectedIndexDigest ||
        stable(order(entries.filter((entry) => selected.has(entry.path)))) !== stable(order(expected)) ||
        stable(await this.reviewedFiles(root, action.paths, signal)) !== stable(document.files) ||
        await this.workingTreeDigest(root, document.git.head, signal, action.paths) !== document.workingTreeDigest ||
        (await this.gitState(root, signal)).head !== document.git.head) throw new MoguriError("github_partial", "The exact staged entries, selected bytes or unrelated index/worktree changed. Inspect the retained review and current Git state; no rollback or successful stage was invented.", 409);
      return this.localResult(id, document, signal);
    }
    if (action.kind === "git.commit" || action.kind === "git.revert") {
      try {
        if (action.kind === "git.commit") {
          const directory = await mkdtemp(join(dirname(this.store.path), "git-index-")), index = join(directory, "index");
          try {
            const environment = { GIT_INDEX_FILE: index }, selected = new Set(action.paths), entries = await this.indexEntries(root, signal);
            await this.git(root, ["read-tree", document.git.head], signal, true, environment);
            for (const path of action.paths) {
              const entry = entries.find((entry) => entry.path === path);
              await this.git(root, entry ? ["update-index", "--add", "--cacheinfo", `${entry.mode},${entry.sha},${path}`] :
                ["update-index", "--force-remove", "--", path], signal, true, environment);
            }
            if (entries.some((entry) => selected.has(entry.path) && entry.stage !== 0) ||
              stable(await this.gitState(root, signal)) !== stable(document.git)) throw new MoguriError("git_commit_changed", "The captured original HEAD/index/worktree changed during selected-path commit preparation. No commit was attempted.", 409);
            this.effectScope(document, signal);
            await this.git(root, ["commit", "--no-gpg-sign", "--message", action.message], signal, true, environment);
          } finally { await rm(directory, { recursive: true, force: true }); }
        } else await this.git(root, ["revert", "--no-edit", "--no-gpg-sign", "--", document.git.head], signal, true);
      } catch (error) {
        if (!signal.aborted && action.kind === "git.revert" && (await readGit(root, ["ls-files", "--unmerged", "-z"], signal)).length) return this.localResult(id, document, signal, "conflicts");
        throw error;
      }
      this.acknowledge(id, document);
      const after = await this.gitState(root, signal);
      const parents = (await readGit(root, ["rev-list", "--parents", "--max-count=1", after.head], signal)).trim().split(" ");
      if (parents.length !== 2 || parents[1] !== document.git.head || after.branch !== document.git.branch) throw new MoguriError("github_partial", "The resulting commit does not have the captured original HEAD as its exact parent/branch. Both histories remain; no successful commit or cleanup was inferred.", 409);
      if (action.kind === "git.commit") {
        const committed = (await this.treeEntries(root, after.head, signal)).sort((a, b) => a.path.localeCompare(b.path, "en"));
        if (!document.indexEntriesDigest || after.indexDigest !== document.git.indexDigest ||
          digest(stable(committed)) !== document.indexEntriesDigest ||
          await this.workingTreeDigest(root, document.git.head, signal) !== document.workingTreeDigest) throw new MoguriError("github_partial", "The committed tree/index or remaining dirty bytes differ from the original staged review. Inspect actual hook/writer effects; no rollback or complete success was inferred.", 409);
      } else {
        const trees = await Promise.all([after.head, document.targetSha!].map((commit) => readGit(root, ["rev-parse", "--verify", `${commit}^{tree}`], signal)));
        if (trees[0] !== trees[1] || after.status) throw new MoguriError("github_partial", "The revert did not restore the exact previous committed tree with a clean index/worktree. Inspect its real outcome; no reset or automatic abort was performed.", 409);
      }
      return this.localResult(id, document, signal);
    }
    if (action.kind === "git.push" || action.kind === "git.tag.push" || action.kind === "git.tag.delete" && action.location === "remote") {
      const remote = document.remote!;
      const flags = ["push", "--porcelain", "--no-mirror", "--no-follow-tags", "--recurse-submodules=no"];
      const source = action.kind === "git.push" ? document.git.head : action.kind === "git.tag.push" ? document.targetSha! : "";
      if (action.kind === "git.push" && !action.forceWithLease && remote.sha && remote.sha !== source) {
        try { await readGit(root, ["merge-base", "--is-ancestor", remote.sha, source], signal); }
        catch (error) {
          if (signal.aborted) throw error;
          throw new MoguriError("git_non_fast_forward", "The captured destination is not a locally proven ancestor of this exact HEAD. No normal push was attempted. Explicitly refresh missing Git objects or separately review force-with-lease.", 409);
        }
      }
      if (action.kind === "git.push" || action.kind === "git.tag.push" || action.kind === "git.tag.delete") flags.push(`--force-with-lease=${remote.ref}:${remote.sha ?? ""}`);
      this.effectScope(document, signal);
      await this.git(root, [...flags, "--", remote.url, `${source}:${remote.ref}`], signal, true);
      this.acknowledge(id, document);
      const after = await this.remote(root, remote.name, remote.ref, signal, remote.url), expected = source || null;
      this.acknowledge(id, document, null, after.sha);
      if (after.url !== remote.url || after.sha !== expected) throw new MoguriError("github_partial", "Git push acknowledgement and the observed exact destination differ. Inspect the remote; no successful publication or retry was invented.", 409);
      const result = await this.localResult(id, document, signal, "completed", after.sha);
      const state = await this.gitState(root, signal);
      if (result.head !== document.git.head || state.worktreeDigest !== document.git.worktreeDigest || state.indexDigest !== document.git.indexDigest) throw new MoguriError("github_partial", "Git hooks or another writer changed the reviewed source state. The destination may have changed; inspect before any new review.", 409);
      return result;
    }
    if (action.kind === "git.tag.create") {
      await this.git(root, ["tag", ...(action.annotated ? ["--annotate", "--message", action.message] : ["--no-sign"]), "--", action.tag, document.targetSha!], signal, true);
      this.acknowledge(id, document);
      const target = (await this.git(root, ["rev-parse", "--verify", "--end-of-options", `refs/tags/${action.tag}^{commit}`], signal)).trim();
      const type = (await this.git(root, ["cat-file", "-t", `refs/tags/${action.tag}`], signal)).trim();
      if (target !== document.targetSha || type !== (action.annotated ? "tag" : "commit")) throw new MoguriError("github_partial", "The created tag did not match the exact reviewed target/type. Inspect it; no overwrite or cleanup.", 409);
    } else if (action.kind === "git.tag.delete" && action.location === "local") {
      await this.git(root, ["update-ref", "-d", `refs/tags/${action.tag}`, document.targetSha!], signal, true);
      this.acknowledge(id, document);
    } else if (action.kind === "git.rebase") {
      if (action.mode === "start") {
        await this.git(root, ["update-ref", `refs/moguri/rebase/${id}/original`, document.git.head, ""], signal, true);
        await this.git(root, ["update-ref", `refs/moguri/rebase/${id}/onto`, document.targetSha!, ""], signal, true);
        if (stable(await this.gitState(root, signal)) !== stable(document.git) || this.policy(document.scope, action) !== document.policyDigest) throw new MoguriError("github_partial", "Git state or policy changed while retaining original rebase histories. No rebase was started; inspect the retained refs and source.", 409);
      }
      try { await this.git(root, ["rebase", ...(action.mode === "start" ? ["--no-autostash", "--no-update-refs", "--", document.targetSha!] : [`--${action.mode}`])], signal, true); }
      catch (error) {
        if (signal.aborted) throw error;
        const state = await this.gitState(root, signal);
        if (state.rebaseDigest && (await this.git(root, ["ls-files", "--unmerged", "-z"], signal)).length) {
          if (action.mode === "start" && (state.rebaseOriginalHead !== document.git.head || state.rebaseOnto !== document.targetSha)) throw new MoguriError("github_partial", "The actual conflicted rebase used a different original/onto commit than the review. Preserve both histories/index and inspect; no completion or automatic abort.", 409);
          return this.localResult(id, document, signal, "conflicts");
        }
        throw error;
      }
      this.acknowledge(id, document);
      const after = await this.gitState(root, signal);
      const expectedBranch = action.mode === "start" ? document.git.branch : document.git.rebaseBranch;
      if (after.rebaseDigest || expectedBranch && after.branch !== expectedBranch || action.mode === "abort" && after.head !== document.git.rebaseOriginalHead) throw new MoguriError("github_partial", "Git did not acknowledge the requested complete rebase/abort branch/state. Preserve the index and inspect; no cleanup or retry.", 409);
      if (action.mode === "start" && after.head !== document.git.head) {
        const original = (await this.git(root, ["rev-parse", "--verify", "ORIG_HEAD"], signal)).trim();
        if (original !== document.git.head) throw new MoguriError("github_partial", "Git's actual original rebase head differs from the exact review. A concurrent external writer may have raced; both histories remain and no exact-input success was invented.", 409);
      }
      if (action.mode !== "abort") await this.git(root, ["merge-base", "--is-ancestor", action.mode === "start" ? document.targetSha! : document.git.rebaseOnto!, after.head], signal);
    } else throw new MoguriError("github_action", "This action is not a typed Git operation.", 400);
    const result = await this.localResult(id, document, signal);
    if (action.kind !== "git.rebase") {
      const state = await this.gitState(root, signal);
      if (state.head !== document.git.head || state.indexDigest !== document.git.indexDigest || state.worktreeDigest !== document.git.worktreeDigest) throw new MoguriError("github_partial", "Git hooks or another writer changed HEAD/index/worktree during tag publication. Inspect the retained root; no cleanup.", 409);
    }
    return result;
  }
  private async githubWrite(id: string, document: GithubReviewDocument, action: Extract<GithubAction, { repository: string }>, signal: AbortSignal): Promise<GithubOperationResult> {
    const root = document.root.root, base = `repos/${action.repository}`, resource = document.resource!;
    if (await this.account(root, action.account, signal) !== document.accountId) throw new MoguriError("github_account", "The exact authenticated account changed before mutation.", 409);
    const latest = visibleResource(await this.resource(root, action, signal));
    if (stable(latest) !== stable(resource)) throw new MoguriError("github_review", "The remote resource revision changed immediately before mutation. Review the live resource again; nothing was dispatched.", 409);
    const actualGit = await this.gitState(root, signal);
    if (stable(actualGit) !== stable(document.git)) throw new MoguriError("github_review", "The reviewed Git/index/worktree changed immediately before the GitHub mutation. No effect was dispatched.", 409);
    if (this.policy(document.scope, action) !== document.policyDigest || !sameDurableRoot(document.root, sourceRootSync(root)) ||
      this.host.project(document.scope.projectId, document.scope.workspaceId).path !== root) throw new MoguriError("github_stale", "Policy or exact root ownership changed before the GitHub mutation. No stale user authority was adopted.", 409);
    signal.throwIfAborted(); this.update(id, { dispatched: true });
    let path: string, method = "POST", fields: Record<string, string | number | boolean>, kind: GithubItem["kind"];
    switch (action.kind) {
      case "github.issue.create": path = `${base}/issues`; fields = { title: action.title, body: action.body }; kind = "issue"; break;
      case "github.issue.update": path = `${base}/issues/${action.number}`; method = "PATCH"; fields = { ...(action.title === undefined ? {} : { title: action.title }),
        ...(action.body === undefined ? {} : { body: action.body }), ...(action.state === undefined ? {} : { state: action.state }) }; kind = "issue"; break;
      case "github.issue.comment": case "github.pr.comment": path = `${base}/issues/${action.number}/comments`; fields = { body: action.body }; kind = "comment"; break;
      case "github.comment.update": path = `${base}/${action.channel === "review" ? "pulls" : "issues"}/comments/${action.commentId}`; method = "PATCH"; fields = { body: action.body }; kind = "comment"; break;
      case "github.comment.delete": {
        const path = `${base}/${action.channel === "review" ? "pulls" : "issues"}/comments/${action.commentId}`;
        const response = await this.api(root, path, signal, "DELETE", undefined, resource.etag?.startsWith('"') ? resource.etag : null);
        const comment = record(JSON.parse(resource.content)).comment;
        if (response.data === null) this.acknowledge(id, document, { ...item(comment, "comment"), state: "delete-acknowledged" });
        if (response.data !== null || await this.optionalApi(root, path, signal) !== null) throw new MoguriError("github_partial", "GitHub did not acknowledge deletion of the exact comment. Inspect it; no retry or alternate endpoint was attempted.", 409);
        return { ...await this.githubResult(id, document, action, signal), resource: { ...item(comment, "comment"), state: "deleted" } };
      }
      case "github.pr.create": {
        const headRepository = action.headRepository ?? action.repository, cross = headRepository.toLowerCase() !== action.repository.toLowerCase();
        path = `${base}/pulls`; fields = { title: action.title, body: action.body, base: action.base,
          head: cross ? `${headRepository.split("/")[0]}:${action.head.split(":").at(-1)}` : action.head, draft: action.draft,
          ...(cross ? { head_repo: headRepository.split("/")[1]! } : {}) }; kind = "pull"; break;
      }
      case "github.pr.update": path = `${base}/pulls/${action.number}`; method = "PATCH"; fields = { ...(action.title === undefined ? {} : { title: action.title }),
        ...(action.body === undefined ? {} : { body: action.body }), ...(action.state === undefined ? {} : { state: action.state }) }; kind = "pull"; break;
      case "github.review.submit": path = `${base}/pulls/${action.number}/reviews`; fields = { body: action.body, event: action.event, commit_id: resource.headSha! }; kind = "review"; break;
      case "github.review.reply": path = `${base}/pulls/${action.number}/comments/${action.commentId}/replies`; fields = { body: action.body }; kind = "comment"; break;
      case "github.review.comment": {
        const requested = { body: action.body, commit_id: resource.headSha!, path: action.path, line: action.line, side: action.side,
          ...(action.startLine === undefined ? {} : { start_line: action.startLine, start_side: action.startSide! }) };
        const value = await this.api(root, `${base}/pulls/${action.number}/comments`, signal, "POST", requested), data = record(value.data);
        const result = item(value.data, "comment");
        this.acknowledge(id, document, result);
        if (!result.id || string(data.pull_request_url).toLowerCase() !== `https://api.github.com/repos/${action.repository}/pulls/${action.number}`.toLowerCase() ||
          data.path !== action.path || data.line !== action.line || data.side !== action.side || data.commit_id !== resource.headSha || data.body !== action.body ||
          (data.start_line ?? null) !== (action.startLine ?? null) || (data.start_side ?? null) !== (action.startSide ?? null)) {
          throw new MoguriError("github_partial", "GitHub's response doesn't acknowledge the exact file, lines, side, head commit and text. The comment may exist; inspect the pull request's reviews before a new review.", 409);
        }
        return { ...await this.githubResult(id, document, action, signal), resource: result };
      }
      case "github.review.resolve": {
        const value = await this.api(root, "graphql", signal, "POST", { query: action.resolve ?
          "mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id isResolved}}}" :
          "mutation($id:ID!){unresolveReviewThread(input:{threadId:$id}){thread{id isResolved}}}", id: action.threadId });
        const data = record(record(value.data).data), thread = record(record(data[action.resolve ? "resolveReviewThread" : "unresolveReviewThread"]).thread);
        if (thread.id !== action.threadId || thread.isResolved !== action.resolve) throw new MoguriError("github_partial", "GitHub did not acknowledge the exact review-thread resolution.", 409);
        const observed: GithubItem = { kind: "comment", id: 0, nodeId: action.threadId, title: action.threadId, body: "", state: action.resolve ? "resolved" : "unresolved",
          url: null, updatedAt: null, author: action.account, headSha: resource.headSha, conclusion: null };
        this.acknowledge(id, document, observed);
        return { ...await this.githubResult(id, document, action, signal), resource: observed };
      }
      case "github.pr.merge": {
        const value = await this.api(root, `${base}/pulls/${action.number}/merge`, signal, "PUT", { sha: resource.headSha!, merge_method: action.method });
        const reviewedPull = record(JSON.parse(resource.content)).pull;
        this.acknowledge(id, document, { ...item(reviewedPull, "pull"), state: record(value.data).merged === true ? "merge-acknowledged" : "merge-not-acknowledged",
          conclusion: sha.test(string(record(value.data).sha)) ? `merge commit ${string(record(value.data).sha)}` : null });
        if (record(value.data).merged !== true || !sha.test(string(record(value.data).sha))) throw new MoguriError("github_partial", "GitHub did not acknowledge a merge of the exact reviewed head. No branch deletion, merge retry or alternate strategy was attempted.", 409);
        const actual = (await this.api(root, `${base}/pulls/${action.number}`, signal)).data;
        if (record(actual).merged !== true || string(record(record(actual).head).sha) !== resource.headSha ||
          record(actual).merge_commit_sha !== record(value.data).sha) throw new MoguriError("github_partial", "Merge acknowledgement and the actual PR/head/merge commit disagree. Inspect the remote result.", 409);
        return { ...await this.githubResult(id, document, action, signal), resource: item(actual, "pull") };
      }
      case "github.branch.delete": {
        const reviewed = record(record(JSON.parse(resource.content)).pull), ref = `${base}/git/refs/heads/${action.branch.split("/").map(encodeURIComponent).join("/")}`;
        await this.api(root, ref, signal, "DELETE");
        this.acknowledge(id, document, { ...item(reviewed, "pull"), state: "branch-delete-acknowledged" });
        if (await this.optionalApi(root, `${base}/git/ref/heads/${action.branch.split("/").map(encodeURIComponent).join("/")}`, signal) !== null) {
          throw new MoguriError("github_partial", `GitHub still lists branch ${action.branch}. Inspect it before a new review; no retry was attempted.`, 409);
        }
        return { ...await this.githubResult(id, document, action, signal), resource: { ...item(reviewed, "pull"), state: "branch-deleted" } };
      }
      case "github.pr.revert": {
        const reviewed = record(JSON.parse(resource.content)), nodeId = string(reviewed.node_id);
        const value = await this.api(root, "graphql", signal, "POST", { query: "mutation($id:ID!,$draft:Boolean){revertPullRequest(input:{pullRequestId:$id,draft:$draft}){revertPullRequest{number url isDraft repository{nameWithOwner}}}}",
          id: nodeId, draft: action.draft });
        const created = record(record(record(record(value.data).data).revertPullRequest).revertPullRequest), number = numeric(created.number);
        this.acknowledge(id, document, { ...item(reviewed, "pull"), state: number ? "revert-opened" : "revert-not-acknowledged", ...(number ? { conclusion: `revert pull request #${number}` } : {}) });
        if (!number || string(record(created.repository).nameWithOwner).toLowerCase() !== action.repository.toLowerCase()) {
          throw new MoguriError("github_partial", "GitHub did not acknowledge a revert pull request in this repository. Inspect the repository's pull requests before a new review.", 409);
        }
        const actual = await this.workItem(root, action.repository, number, true, signal);
        return { ...await this.githubResult(id, document, action, signal), resource: actual };
      }
      case "github.pr.draft": {
        const reviewed = record(JSON.parse(resource.content)), nodeId = string(reviewed.node_id);
        const operation = action.draft ? "convertPullRequestToDraft" : "markPullRequestReadyForReview";
        const value = await this.api(root, "graphql", signal, "POST", { query: `mutation($id:ID!){${operation}(input:{pullRequestId:$id}){pullRequest{number isDraft repository{nameWithOwner}}}}`, id: nodeId });
        const acknowledged = record(record(record(record(value.data).data)[operation]).pullRequest);
        this.acknowledge(id, document, { ...item(reviewed, "pull"), ...(typeof acknowledged.isDraft === "boolean" ? { draft: acknowledged.isDraft } : {}) });
        if (numeric(acknowledged.number) !== action.number || acknowledged.isDraft !== action.draft ||
          string(record(acknowledged.repository).nameWithOwner).toLowerCase() !== action.repository.toLowerCase()) throw new MoguriError("github_partial", "GitHub did not acknowledge the requested draft state for the exact PR. Inspect it; no retry was attempted.", 409);
        const actual = await this.workItem(root, action.repository, action.number, true, signal);
        if (actual.draft !== action.draft) throw new MoguriError("github_partial", "The PR's draft state doesn't read back as requested. Inspect it before a new review.", 409);
        return { ...await this.githubResult(id, document, action, signal), resource: actual };
      }
      case "github.issue.labels": case "github.issue.assignees": {
        const reviewed = record(JSON.parse(resource.content)), labels = action.kind === "github.issue.labels";
        const requested = labels ? action.labels : action.assignees, wanted = new Set(requested.map((name) => name.toLowerCase()));
        const value = labels ? await this.api(root, `${base}/issues/${action.number}/labels`, signal, "PUT", { labels: action.labels }) :
          await this.api(root, `${base}/issues/${action.number}`, signal, "PATCH", { assignees: action.assignees }, resource.etag?.startsWith('"') ? resource.etag : null);
        const listed = labels ? value.data : record(value.data).assignees, list = Array.isArray(listed) ? listed as unknown[] : null;
        const actualNames = !list ? [] : labels ? list.map((label) => string(record(label).name)) : logins(list);
        this.acknowledge(id, document, labels ? { ...item(reviewed, "issue"), labels: (list ?? []).map((label) => ({ name: string(record(label).name), color: string(record(label).color) || null })) } :
          item(value.data, "issue"));
        if (!list || !labels && numeric(record(value.data).number) !== action.number ||
          actualNames.length !== wanted.size || new Set(actualNames.map((name) => name.toLowerCase())).size !== wanted.size ||
          actualNames.some((name) => !wanted.has(name.toLowerCase()))) throw new MoguriError("github_partial", labels ?
          "GitHub's response doesn't list exactly the requested labels. Some may have changed; inspect the item before a new review." :
          "GitHub's response doesn't list exactly the requested assignees. It drops users it can't assign; inspect the item before a new review.", 409);
        const actual = await this.workItem(root, action.repository, action.number, Boolean(reviewed.pull_request), signal);
        return { ...await this.githubResult(id, document, action, signal), resource: actual };
      }
      case "github.pr.reviewers": {
        const value = await this.api(root, `${base}/pulls/${action.number}/requested_reviewers`, signal, action.operation === "request" ? "POST" : "DELETE", { reviewers: action.reviewers });
        const result = item(value.data, "pull");
        this.acknowledge(id, document, result);
        const requested = new Set((result.reviewers ?? []).map((name) => name.toLowerCase()));
        if (result.number !== action.number || !result.reviewers || action.reviewers.some((name) => requested.has(name.toLowerCase()) !== (action.operation === "request"))) {
          throw new MoguriError("github_partial", action.operation === "request" ? "GitHub's response doesn't list every requested reviewer. Inspect the PR before a new review." :
            "GitHub's response still lists a reviewer you removed. Inspect the PR before a new review.", 409);
        }
        return { ...await this.githubResult(id, document, action, signal), resource: result };
      }
      case "github.release.create": case "github.release.update": {
        path = action.kind === "github.release.create" ? `${base}/releases` : `${base}/releases/${action.releaseId}`;
        method = action.kind === "github.release.create" ? "POST" : "PATCH";
        const target = string(record(JSON.parse(resource.content)).targetSha);
        fields = { tag_name: action.tag, target_commitish: target, name: action.name, body: action.body, draft: action.draft, prerelease: action.prerelease }; kind = "release"; break;
      }
      case "github.release.publish": {
        const source = record(JSON.parse(resource.content)), release = record(source.resource);
        path = `${base}/releases/${action.releaseId}`; method = "PATCH";
        fields = { draft: false, tag_name: string(release.tag_name), target_commitish: string(source.targetSha) }; kind = "release"; break;
      }
      case "github.repo.settings": path = base; method = "PATCH"; fields = { ...action.settings }; kind = "settings"; break;
      default: throw new MoguriError("github_action", "This action is not a typed GitHub mutation.", 400);
    }
    const conditional = path === resource.path && method === "PATCH" && resource.etag?.startsWith('"') ? resource.etag : null;
    const response = await this.api(root, path, signal, method, fields, conditional);
    const result = item(response.data, kind);
    this.acknowledge(id, document, result);
    if (!result.id || kind === "release" && (result.tag !== fields.tag_name || result.draft !== fields.draft) ||
      "state" in fields && result.state !== fields.state || "body" in fields && result.body !== fields.body ||
      "title" in fields && result.title !== fields.title) throw new MoguriError("github_partial", "GitHub response does not acknowledge the exact reviewed fields/resource. The write may exist; inspect it before a new explicit review.", 409);
    if (action.kind === "github.repo.settings" && (Object.entries(action.settings).some(([key, value]) => record(response.data)[key] !== value) ||
      string(record(response.data).full_name).toLowerCase() !== action.repository.toLowerCase())) throw new MoguriError("github_partial", "GitHub did not acknowledge every reviewed repository setting. Some may have changed; inspect the repository before a new explicit review.", 409);
    if ("releaseId" in action && result.id !== action.releaseId || action.kind === "github.comment.update" && result.id !== action.commentId ||
      "number" in action && ["github.issue.update", "github.pr.update"].includes(action.kind) && result.number !== action.number ||
      action.kind === "github.review.submit" && result.headSha !== resource.headSha) throw new MoguriError("github_partial", "GitHub acknowledged a different resource or review head. The write may exist; no success was inferred.", 409);
    if (action.kind === "github.pr.create") {
      const reviewed = record(JSON.parse(resource.content));
      const actualHead = record(record(response.data).head), actualBase = record(record(response.data).base);
      if (actualHead.sha !== record(reviewed.head).sha || actualBase.sha !== record(reviewed.base).sha ||
        actualHead.ref !== record(reviewed.head).ref || actualBase.ref !== record(reviewed.base).ref ||
        string(record(actualHead.repo).full_name).toLowerCase() !== string(record(reviewed.head).repository).toLowerCase() ||
        string(record(actualBase.repo).full_name).toLowerCase() !== action.repository.toLowerCase()) throw new MoguriError("github_partial", "The created PR repositories/base/head raced the exact reviewed refs. Inspect the actual PR; no exact-head success was inferred.", 409);
    }
    if (kind === "release") {
      const reviewed = record(JSON.parse(resource.content)), tag = await this.tagCommit(root, action.repository, string(fields.tag_name), signal);
      if (tag.commit !== null && tag.commit !== reviewed.targetSha || fields.draft === false && tag.commit === null) throw new MoguriError("github_partial", "Release/tag acknowledgement does not match the exact reviewed commit. Inspect the release; no deletion, overwrite or retry was attempted.", 409);
    }
    return { ...await this.githubResult(id, document, action, signal), resource: result };
  }
  private async workItem(root: string, repository: string, number: number, pull: boolean, signal: AbortSignal): Promise<GithubItem> {
    const value = item((await this.api(root, `repos/${repository}/${pull ? "pulls" : "issues"}/${number}`, signal)).data, pull ? "pull" : "issue");
    if (value.number !== number) throw new MoguriError("github_partial", "GitHub returned a different issue or PR after the write. Inspect the exact item before a new review.", 409);
    return value;
  }
  private async githubResult(id: string, document: GithubReviewDocument, action: Extract<GithubAction, { repository: string }>, signal: AbortSignal): Promise<GithubOperationResult> {
    if (await this.account(document.root.root, action.account, signal) !== document.accountId ||
      !sameDurableRoot(document.root, sourceRootSync(document.root.root))) throw new MoguriError("github_partial", "The final authenticated account/root ownership was not acknowledged. A remote write may exist; inspect the original intent.", 409);
    const state = await this.gitState(document.root.root, signal);
    if (stable(state) !== stable(document.git)) throw new MoguriError("github_partial", "Another writer changed the original Git/index/worktree during the GitHub mutation. The remote effect may exist; inspect both original observations.", 409);
    return this.localResult(id, document, signal);
  }
  private async checkCiTarget(document: GithubReviewDocument, signal: AbortSignal): Promise<void> {
    const action = document.action;
    if (action.kind !== "github.ci.watch" || action.prNumber === undefined) throw new MoguriError("github_ci_target", "An original PR watch target is required.", 409);
    const context = await this.context(document.scope, action, signal);
    if (!sameDurableRoot(document.root, context.root) || context.policyDigest !== document.policyDigest) {
      throw new MoguriError("github_stale", "The original CI root or policy changed. No replacement source was accessed.", 409);
    }
    const configuration = this.host.configuration(document.scope.projectId);
    const git = await readWorkspaceGit(document.root.root, { deniedFolders: configuration.values.deniedFolders }, false, signal);
    if (git.repository?.toLowerCase() !== `https://github.com/${action.repository}`.toLowerCase()) {
      throw new MoguriError("github_stale", "The CI source repository changed. The captured PR was not retargeted.", 409);
    }
    if (await this.account(document.root.root, action.account, signal) !== document.accountId) {
      throw new MoguriError("github_stale", "The original CI numeric account changed. No different account was adopted.", 409);
    }
    await this.resource(document.root.root, action, signal);
    context.current();
  }
  private recordCiObservation(id: string, values: GithubItem[], state: GithubCiState, deadlineReached: boolean, complete: boolean, observedAt?: string): void {
    const operation = this.operation(id), ci = operation.ci;
    if (!ci || operation.status !== "running" || operation.cancelRequested) throw new MoguriError("github_ci_owner", "The exact live PR watch no longer owns this observation.", 409);
    const at = observedAt ?? new Date(this.now()).toISOString();
    const items = values.map((value) => parse(GithubItemSchema, JSON.parse(githubObservationText(value))));
    const observation: GithubCiObservation = { version: 1, target: ci.target, at, state, complete, deadlineReached, items };
    parse(GithubCiObservationSchema, observation);
    const encoded = JSON.stringify(observation);
    if (Buffer.byteLength(encoded) > 8 * 1024 * 1024) throw new MoguriError("github_limit", "The complete CI observation exceeds the existing 8-MiB GitHub read envelope. No prefix or green state was recorded.", 409);
    let observationDigest = ci.observationDigest;
    if (observationDigest) {
      const previous = parse(GithubCiObservationSchema, JSON.parse(this.store.blob(observationDigest)));
      if (stable({ ...previous, at }) !== stable(observation)) observationDigest = null;
    }
    observationDigest ??= this.store.putBlob(encoded);
    this.update(id, { ci: { ...ci, observationDigest, observedAt: at, state, count: items.length, complete, deadlineReached } });
  }
  private async ciCollection(root: string, repository: string, headSha: string, signal: AbortSignal, requireCounts = true): Promise<GithubItem[]> {
    const values: GithubItem[] = [], counts = new Map<string, { total: number; received: number }>();
    const count = (name: string, total: unknown, received: number) => {
      if (!requireCounts) return;
      if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0 || total > 1000 || received > 100) {
        throw new MoguriError("github_ci_incomplete", `The ${name} collection has no supported complete count/page. No green observation was inferred.`, 502);
      }
      const previous = counts.get(name);
      if (previous && previous.total !== total) throw new MoguriError("github_ci_incomplete", `The ${name} count changed during pagination.`, 502);
      counts.set(name, { total, received: (previous?.received ?? 0) + received });
    };
    for (let page = 1; page <= 10; page++) {
      signal.throwIfAborted();
      const response = await this.checks(root, repository, headSha, page, 100, signal); values.push(...response.items);
      count("checks", response.totals.checks, response.received.checks);
      count("statuses", response.totals.statuses, response.received.statuses);
      if (!response.next) break;
      if (page === 10) throw new MoguriError("github_limit", "CI exceeds 1,000 check/status observations. No prefix was called green.", 409);
    }
    for (let page = 1; page <= 10; page++) {
      signal.throwIfAborted();
      const response = await this.api(root, `repos/${repository}/actions/runs?head_sha=${headSha}&per_page=100&page=${page}`, signal);
      const runs = items(response.data, "workflow_runs").map((value) => item(value, "run"));
      count("runs", record(response.data).total_count, runs.length);
      if (runs.some((value) => value.headSha !== headSha)) throw new MoguriError("github_head", "CI returned a workflow run from another head.", 409);
      values.push(...runs);
      if (!response.next) break;
      if (page === 10) throw new MoguriError("github_limit", "CI exceeds 1,000 workflow runs. No omitted work was called successful.", 409);
    }
    if (requireCounts) {
      for (const [name, count] of counts) if (count.total !== count.received) throw new MoguriError("github_ci_incomplete", `The ${name} collection is incomplete against its actual count.`, 502);
      const seen = new Set<string>();
      for (const value of values) {
        const key = `${value.kind}:${value.id}`;
        if (value.id < 1 || seen.has(key)) throw new MoguriError("github_ci_incomplete", "The complete CI collection has missing or repeated original identities.", 502);
        seen.add(key);
      }
    }
    return values;
  }
  private async ciDiagnostics(document: Pick<GithubReviewDocument, "root" | "action">, values: GithubItem[], signal: AbortSignal): Promise<GithubItem[]> {
    const action = document.action;
    if (action.kind !== "github.ci.watch") throw new MoguriError("github_ci_target", "CI diagnostics need the original exact watch target.", 409);
    const result = [...values];
    for (const [index, value] of values.entries()) {
      if (value.kind !== "check" || !["failure", "startup_failure", "action_required"].includes(value.conclusion ?? "")) continue;
      signal.throwIfAborted();
      const base = `repos/${action.repository}/check-runs/${value.id}`;
      const check = record((await this.api(document.root.root, base, signal)).data), output = record(check.output);
      if (numeric(check.id) !== value.id || check.head_sha !== action.headSha) throw new MoguriError("github_head", "The diagnostic check no longer belongs to the original CI head.", 409);
      const total = output.annotations_count;
      if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0 || total > 1000) throw new MoguriError("github_ci_incomplete", "Check diagnostics have no supported complete count. Original CI failure evidence was retained.", 502);
      const text = [value.body, string(output.title), string(output.summary), string(output.text)].filter(Boolean);
      let received = 0;
      for (let page = 1; total > 0 && page <= 10; page++) {
        const response = await this.api(document.root.root, `${base}/annotations?per_page=100&page=${page}`, signal);
        const annotations = items(response.data);
        if (annotations.length > 100) throw new MoguriError("github_ci_incomplete", "A diagnostic page exceeded its complete bounded size.", 502);
        for (const entry of annotations) {
          const annotation = record(entry);
          if (typeof annotation.message !== "string" || !["notice", "warning", "failure"].includes(string(annotation.annotation_level))) {
            throw new MoguriError("github_ci_incomplete", "A diagnostic annotation has unsupported source metadata. No replacement explanation was invented.", 502);
          }
          text.push(`${string(annotation.annotation_level)}: ${string(annotation.title)}\n${annotation.message}`);
        }
        received += annotations.length;
        if (!response.next) break;
        if (page === 10) throw new MoguriError("github_limit", "Diagnostics exceed the complete 1,000-annotation bound; original CI evidence remains inspectable.", 409);
      }
      if (received !== total) throw new MoguriError("github_ci_incomplete", "Check diagnostics are incomplete against their declared count. Original CI failure evidence was retained.", 502);
      result[index] = parse(GithubItemSchema, { ...value, body: text.join("\n\n") });
    }
    return result;
  }
  private async watch(id: string, document: GithubReviewDocument, signal: AbortSignal, progress: (text: string) => void): Promise<GithubOperationResult> {
    const action = document.action;
    if (action.kind !== "github.ci.watch") throw new MoguriError("github_action", "CI watching requires an exact typed head.", 400);
    const deadline = this.now() + action.timeoutMs, root = document.root.root;
    const originalPr = action.prNumber !== undefined;
    let last: GithubItem[] = [], lastState: GithubCiState = originalPr ? "unknown" : "no-checks";
    const finish = async (state: GithubCiState, values: GithubItem[], reached: boolean): Promise<GithubOperationResult> => {
      const result = await this.localResult(id, document, signal, "ci");
      if (originalPr) {
        const ci = this.operation(id).ci!;
        this.recordCiObservation(id, values, state, reached, ci.complete, ci.observedAt ?? undefined);
      }
      const retained = originalPr ? this.operation(id).ci?.observationDigest : null;
      const items = retained ? parse(GithubCiObservationSchema, JSON.parse(this.store.blob(retained))).items : values;
      return { ...result, ci: { headSha: action.headSha, state, deadlineReached: reached, items } };
    };
    for (;;) {
      signal.throwIfAborted();
      if (this.now() >= deadline) return finish(lastState, last, true);
      const deadlineSignal = AbortSignal.timeout(Math.max(1, deadline - this.now()));
      const readSignal = AbortSignal.any([signal, deadlineSignal]);
      const values: GithubItem[] = [];
      try {
        if (originalPr) await this.checkCiTarget(document, readSignal);
        if (this.policy(document.scope, action) !== document.policyDigest || await this.account(root, action.account, readSignal) !== document.accountId) throw new MoguriError("github_stale", "CI account or policy changed. The original watcher stopped; no different head/account was adopted.", 409);
        values.push(...await this.ciCollection(root, action.repository, action.headSha, readSignal, originalPr));
        if (originalPr) await this.checkCiTarget(document, readSignal);
      } catch (error) {
        signal.throwIfAborted();
        if (originalPr && error instanceof MoguriError && error.code === "program_partial") throw error;
        if (!deadlineSignal.aborted) throw error;
        return finish(originalPr ? lastState : lastState === "failure" ? "failure" : last.length ? "pending" : "no-checks", last, true);
      }
      let actual = [...values];
      const state = originalPr ? githubPrCiState(actual) : githubCiState(actual), reached = this.now() >= deadline;
      if (originalPr && state === "failure") {
        this.recordCiObservation(id, actual, state, false, true);
        actual = await this.ciDiagnostics(document, actual, readSignal);
        await this.checkCiTarget(document, readSignal);
      }
      last = actual; lastState = state;
      if (originalPr) this.recordCiObservation(id, actual, state, false, true);
      progress(`CI ${action.headSha}: ${state}; ${actual.length} exact-head observations.`);
      if (state === "success" || state === "failure" || originalPr && ["cancelled", "timed-out", "skipped", "neutral"].includes(state) || reached) return finish(state, actual, reached);
      await this.wait(Math.min(action.pollMs, Math.max(1, deadline - this.now())), signal);
    }
  }
  recover(): void {
    const events: EventInput[] = [];
    for (const operation of this.operations().filter((operation) => operation.status === "running")) {
      const unconfirmedCi = Boolean(operation.ci && operation.dispatched);
      const status = operation.dispatched && (operation.kind !== "github.ci.watch" || unconfirmedCi) ? "partial" : "cancelled";
      const message = unconfirmedCi ? "Service lost the original CI reader's acknowledgement. Retained observations remain historical and process cleanup is unconfirmed; no poller or GitHub workflow was replayed." :
        "Service restarted during original Git/GitHub ownership. Inspect the retained exact intent and target; no command, CI watcher, rebase continuation/abort or remote write was replayed.";
      events.push(this.event({ ...operation, revision: operation.revision + 1, updatedAt: new Date(this.now()).toISOString(), status,
        ...(unconfirmedCi && operation.ci ? { ci: { ...operation.ci, cleanupUnconfirmed: true } } : {}),
        cancelRequested: true, diagnostic: message }));
      const job = this.host.snapshot().jobs.find((job) => job.id === operation.jobId);
      if (job && ["running", "waiting_input"].includes(job.status)) events.push({ event_type: "job.finished", profile_id: operation.profileId,
        project_id: operation.projectId, session_id: operation.originSessionId, payload: { jobId: operation.jobId, status, resultDigest: null, error: message, operationId: operation.id } });
    }
    if (events.length) this.host.commit(events);
  }
  invalidateGhCredentials(): void {
    this.credentialEpoch++;
    for (const [id, owner] of this.active) if (this.operation(id).kind.startsWith("github.")) owner.abort();
  }
  close(): void { this.shutdown.abort(); for (const owner of this.active.values()) owner.abort(); }
}
