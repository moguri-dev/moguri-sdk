import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";
import { ModelAdviceSourceSchema } from "./questions.ts";
import type { WorkItemCommentFilter } from "./markdown.ts";
import type { StoredEvent } from "./index.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const gitHash = Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" });
const maybeHash = Type.Union([hash, Type.Null()]);
const maybeGit = Type.Union([gitHash, Type.Null()]);
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const number = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const ref = Type.String({ minLength: 1, maxLength: 240 });
const title = Type.String({ minLength: 1, maxLength: 256 });
const body = Type.String({ maxLength: 64 * 1024 });
const timestamp = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
const repository = Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}/(?!\\.{1,2}$)[A-Za-z0-9_.-]{1,100}$", maxLength: 140 });
const account = Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}$" });
const remote = Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$" });

export const GithubScopeSchema = object({
  env: Type.Literal("Local"), projectId: id, workspaceId: Type.Optional(id), sessionId: Type.Optional(id),
});
export type GithubScope = Static<typeof GithubScopeSchema>;
const github = { repository, account };
const release = { tag: ref, target: ref, name: title, body, draft: Type.Boolean(), prerelease: Type.Boolean() };
export const GithubIssueCreateActionSchema = object({ kind: Type.Literal("github.issue.create"), ...github, title, body });
const paths = Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { minItems: 1, maxItems: 100, uniqueItems: true });
export const GitActionSchema = Type.Union([
  object({ kind: Type.Literal("git.branch.create"), branch: ref, start: ref, checkout: Type.Boolean() }),
  object({ kind: Type.Literal("git.branch.rename"), from: ref, to: ref }),
  object({ kind: Type.Literal("git.switch"), branch: ref }),
  object({ kind: Type.Literal("git.revert"), commit: gitHash }),
  object({ kind: Type.Literal("git.stage"), paths }),
  object({ kind: Type.Literal("git.unstage"), paths }),
  object({ kind: Type.Literal("git.commit"), paths, message: Type.String({ minLength: 1, maxLength: 4096 }) }),
  object({ kind: Type.Literal("git.push"), remote, branch: ref, destination: Type.Optional(ref), forceWithLease: Type.Boolean() }),
  object({ kind: Type.Literal("git.rebase"), mode: Type.Literal("start"), onto: ref }),
  object({ kind: Type.Literal("git.rebase"), mode: Type.Union([Type.Literal("continue"), Type.Literal("abort")]) }),
  object({ kind: Type.Literal("git.tag.create"), tag: ref, target: ref, annotated: Type.Boolean(), message: Type.String({ maxLength: 4096 }) }),
  object({ kind: Type.Literal("git.tag.push"), remote, tag: ref }),
  object({ kind: Type.Literal("git.tag.delete"), tag: ref, location: Type.Literal("local") }),
  object({ kind: Type.Literal("git.tag.delete"), tag: ref, location: Type.Literal("remote"), remote }),
]);
export type GitAction = Static<typeof GitActionSchema>;
export const RepositoryRemoteActionSchema = object({
  kind: Type.Literal("git.remote.set"), remote, url: Type.String({ minLength: 1, maxLength: 2048 }),
});
export const GitReadSchema = Type.Union([
  object({ action: Type.Literal("status") }),
  object({ action: Type.Literal("branches") }),
  object({ action: Type.Literal("log"), head: Type.Optional(gitHash), offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }),
  object({ action: Type.Literal("show"), commit: gitHash }),
  object({ action: Type.Literal("diff"), staged: Type.Optional(Type.Boolean()), path: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })) }),
]);
export type GitRead = Static<typeof GitReadSchema>;
export const GitWriteToolSchema = object({
  action: Type.Union([Type.Literal("preview"), Type.Literal("execute")]), input: GitActionSchema,
  expectedDigest: Type.Optional(hash), confirmations: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 8 })),
});
const comment = Type.String({ minLength: 1, maxLength: 64 * 1024 });
const labelName = Type.String({ minLength: 1, maxLength: 100, pattern: "^[^\\u0000-\\u001f\\u007f]+$" });
/** Protocol 116: editable repository settings. Visibility, archiving and transfer stay outside every typed workflow. */
export const RepositorySettingsSchema = Type.Object({
  description: Type.Optional(Type.String({ maxLength: 350 })), homepage: Type.Optional(Type.String({ maxLength: 2048 })),
  default_branch: Type.Optional(ref),
  has_issues: Type.Optional(Type.Boolean()), has_projects: Type.Optional(Type.Boolean()), has_wiki: Type.Optional(Type.Boolean()), has_discussions: Type.Optional(Type.Boolean()),
  allow_merge_commit: Type.Optional(Type.Boolean()), allow_squash_merge: Type.Optional(Type.Boolean()), allow_rebase_merge: Type.Optional(Type.Boolean()),
  allow_auto_merge: Type.Optional(Type.Boolean()), allow_update_branch: Type.Optional(Type.Boolean()), delete_branch_on_merge: Type.Optional(Type.Boolean()),
  web_commit_signoff_required: Type.Optional(Type.Boolean()),
}, { additionalProperties: false, minProperties: 1 });
export type RepositorySettings = Static<typeof RepositorySettingsSchema>;
/**
 * GitHub writes an approved model tool call (`github_write`) may preview and execute. Each one still needs the same exact
 * review, confirmations and tool approval as a user action. Merges, comment deletion, PR reviews/approvals, issue creation
 * (its own adapter), CI watches and remote changes stay outside this set.
 */
export const GithubModelActionSchema = Type.Union([
  object({ kind: Type.Literal("github.issue.update"), ...github, number, title: Type.Optional(title), body: Type.Optional(body),
    state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed")])) }),
  object({ kind: Type.Literal("github.issue.comment"), ...github, number, body: comment }),
  object({ kind: Type.Literal("github.pr.create"), ...github, title, body, base: ref, head: ref,
    headRepository: Type.Optional(repository), draft: Type.Boolean() }),
  object({ kind: Type.Literal("github.pr.update"), ...github, number, title: Type.Optional(title), body: Type.Optional(body),
    state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed")])) }),
  object({ kind: Type.Literal("github.pr.comment"), ...github, number, body: comment }),
  /** Protocol 118 (D64): convert an open PR to draft or mark it ready for review. Users and approved agent tool calls may both do this. */
  object({ kind: Type.Literal("github.pr.draft"), ...github, number, draft: Type.Boolean() }),
  object({ kind: Type.Literal("github.comment.update"), ...github, number, commentId: number,
    channel: Type.Union([Type.Literal("conversation"), Type.Literal("review")]), body: comment }),
  object({ kind: Type.Literal("github.review.reply"), ...github, number, commentId: number, body: comment }),
  object({ kind: Type.Literal("github.review.resolve"), ...github, number, threadId: Type.String({ pattern: "^[A-Za-z0-9_=-]{1,200}$" }), resolve: Type.Boolean() }),
  object({ kind: Type.Literal("github.release.create"), ...github, ...release }),
  object({ kind: Type.Literal("github.release.update"), ...github, releaseId: number, ...release }),
  object({ kind: Type.Literal("github.release.publish"), ...github, releaseId: number }),
  object({ kind: Type.Literal("github.repo.settings"), ...github, settings: RepositorySettingsSchema }),
]);
export type GithubModelAction = Static<typeof GithubModelActionSchema>;
export const isGithubModelAction = (action: { kind: string }): boolean => GITHUB_MODEL_ACTION_KINDS.has(action.kind) &&
  (action.kind !== "github.pr.create" || (action as { draft?: unknown }).draft === true);
const GITHUB_MODEL_ACTION_KINDS = new Set(["github.issue.update", "github.issue.comment", "github.pr.create", "github.pr.update", "github.pr.comment", "github.pr.draft",
  "github.comment.update", "github.review.reply", "github.review.resolve", "github.release.create", "github.release.update", "github.release.publish", "github.repo.settings"]);
export const GithubWriteToolSchema = object({
  action: Type.Union([Type.Literal("preview"), Type.Literal("execute")]), input: GithubModelActionSchema,
  expectedDigest: Type.Optional(hash), confirmations: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 8 })),
});
export const GithubActionSchema = Type.Union([
  GitActionSchema,
  RepositoryRemoteActionSchema,
  GithubIssueCreateActionSchema,
  ...GithubModelActionSchema.anyOf,
  object({ kind: Type.Literal("github.comment.delete"), ...github, number, commentId: number,
    channel: Type.Union([Type.Literal("conversation"), Type.Literal("review")]) }),
  object({ kind: Type.Literal("github.review.submit"), ...github, number,
    event: Type.Union([Type.Literal("APPROVE"), Type.Literal("REQUEST_CHANGES"), Type.Literal("COMMENT")]), body }),
  object({ kind: Type.Literal("github.pr.merge"), ...github, number,
    method: Type.Union([Type.Literal("merge"), Type.Literal("squash"), Type.Literal("rebase")]) }),
  /**
   * Protocol 118 (D65), user-only: one inline review comment on the reviewed PR head (POST /pulls/{n}/comments with commit_id). `line` is
   * the new-file line for side RIGHT or the old-file line for side LEFT; optional startLine/startSide make a multi-line comment.
   */
  object({ kind: Type.Literal("github.review.comment"), ...github, number, path: Type.String({ minLength: 1, maxLength: 4096 }),
    line: Type.Integer({ minimum: 1 }), side: Type.Union([Type.Literal("LEFT"), Type.Literal("RIGHT")]),
    startLine: Type.Optional(Type.Integer({ minimum: 1 })), startSide: Type.Optional(Type.Union([Type.Literal("LEFT"), Type.Literal("RIGHT")])), body: comment }),
  /** Protocol 118 (D64), user-only: replace an issue's or PR's whole label set (PUT /issues/{n}/labels). */
  object({ kind: Type.Literal("github.issue.labels"), ...github, number, labels: Type.Array(labelName, { maxItems: 100, uniqueItems: true }) }),
  /** Protocol 118 (D64), user-only: replace an issue's or PR's assignees (PATCH /issues/{n}). */
  object({ kind: Type.Literal("github.issue.assignees"), ...github, number, assignees: Type.Array(account, { maxItems: 10, uniqueItems: true }) }),
  /** Protocol 118 (D64), user-only: request or remove PR reviewers (POST or DELETE /pulls/{n}/requested_reviewers), one call. */
  object({ kind: Type.Literal("github.pr.reviewers"), ...github, number, operation: Type.Union([Type.Literal("request"), Type.Literal("remove")]),
    reviewers: Type.Array(account, { minItems: 1, maxItems: 15, uniqueItems: true }) }),
  /** Protocol 120 (D71), user-only: delete a merged PR's head branch in the same repository (DELETE /git/refs/heads/{branch}) at the reviewed head. */
  object({ kind: Type.Literal("github.branch.delete"), ...github, number, branch: ref }),
  /** Protocol 120 (D71), user-only: open a pull request that reverts a merged one (GraphQL revertPullRequest). */
  object({ kind: Type.Literal("github.pr.revert"), ...github, number, draft: Type.Boolean() }),
  object({ kind: Type.Literal("github.ci.watch"), ...github, headSha: gitHash,
    prNumber: Type.Optional(number), accountId: Type.Optional(Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}:[1-9][0-9]*$" })),
    timeoutMs: Type.Integer({ minimum: 100, maximum: 30 * 60 * 1000 }), pollMs: Type.Integer({ minimum: 50, maximum: 30_000 }) }),
]);
export type GithubAction = Static<typeof GithubActionSchema>;
const operationKind = Type.Union([
  Type.Literal("git.remote.set"),
  Type.Literal("git.branch.create"), Type.Literal("git.branch.rename"), Type.Literal("git.switch"), Type.Literal("git.revert"),
  Type.Literal("git.stage"), Type.Literal("git.unstage"), Type.Literal("git.commit"),
  Type.Literal("git.push"), Type.Literal("git.rebase"), Type.Literal("git.tag.create"), Type.Literal("git.tag.push"), Type.Literal("git.tag.delete"),
  Type.Literal("github.issue.create"), Type.Literal("github.issue.update"), Type.Literal("github.issue.comment"),
  Type.Literal("github.pr.create"), Type.Literal("github.pr.update"), Type.Literal("github.pr.comment"), Type.Literal("github.pr.merge"),
  Type.Literal("github.comment.update"), Type.Literal("github.comment.delete"),
  Type.Literal("github.review.submit"), Type.Literal("github.review.reply"), Type.Literal("github.review.resolve"),
  Type.Literal("github.release.create"), Type.Literal("github.release.update"), Type.Literal("github.release.publish"), Type.Literal("github.ci.watch"),
  Type.Literal("github.repo.settings"),
  Type.Literal("github.pr.draft"), Type.Literal("github.issue.labels"), Type.Literal("github.issue.assignees"), Type.Literal("github.pr.reviewers"),
  Type.Literal("github.review.comment"),
  Type.Literal("github.branch.delete"), Type.Literal("github.pr.revert"),
]);

export const GithubGitStateSchema = object({
  configDigest: Type.Optional(hash),
  commonDir: Type.String({ minLength: 1, maxLength: 4096 }), head: gitHash, branch: ref,
  indexDigest: hash, statusDigest: hash, worktreeDigest: hash, status: Type.String({ maxLength: 64 * 1024 }),
  rebaseDigest: maybeHash, rebaseOriginalHead: maybeGit, rebaseOnto: maybeGit, rebaseBranch: Type.Union([ref, Type.Null()]),
});
export type GithubGitState = Static<typeof GithubGitStateSchema>;
const rootIdentity = object({
  root: Type.String({ minLength: 1, maxLength: 4096 }), device: Type.String({ pattern: "^[0-9]+$" }), inode: Type.String({ pattern: "^[0-9]+$" }),
});
export const RepositoryRemoteReviewSchema = object({
  version: Type.Literal(1), name: remote, url: Type.String({ minLength: 1, maxLength: 2048 }),
  common: rootIdentity, config: object({
    path: Type.String({ minLength: 1, maxLength: 4096 }), device: Type.String({ pattern: "^[0-9]+$" }), inode: Type.String({ pattern: "^[0-9]+$" }),
    mode: Type.Integer({ minimum: 0, maximum: 511 }), digest: hash, replacementDigest: hash, unrelatedDigest: hash,
  }),
  fetchUrl: Type.String({ minLength: 1, maxLength: 4096 }), pushUrls: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 1 }),
  worktrees: Type.Array(object({ ...rootIdentity.properties, configDigest: hash,
    fetchUrl: Type.String({ minLength: 1, maxLength: 4096 }), pushUrl: Type.String({ minLength: 1, maxLength: 4096 }),
    nextFetchUrl: Type.String({ minLength: 1, maxLength: 4096 }), nextPushUrl: Type.String({ minLength: 1, maxLength: 4096 }),
  }), { minItems: 1, maxItems: 1000 }),
});
export type RepositoryRemoteReview = Static<typeof RepositoryRemoteReviewSchema>;
export const GithubReviewDocumentSchema = object({
  format: Type.Literal("moguri-github-review"), version: Type.Literal(1), profileId: id, scope: GithubScopeSchema,
  root: object({ root: Type.String({ minLength: 1, maxLength: 4096 }), device: Type.String({ pattern: "^[0-9]+$" }), inode: Type.String({ pattern: "^[0-9]+$" }) }),
  policyDigest: hash, action: GithubActionSchema, git: GithubGitStateSchema,
  remote: Type.Union([object({ name: remote, url: Type.String({ minLength: 1, maxLength: 4096 }), ref, sha: maybeGit }), Type.Null()]),
  targetSha: maybeGit,
  resource: Type.Union([object({
    path: Type.String({ minLength: 1, maxLength: 2048 }), digest: hash,
    etag: Type.Union([Type.String({ minLength: 1, maxLength: 512 }), Type.Null()]),
    headSha: maybeGit, state: Type.Union([Type.String({ maxLength: 100 }), Type.Null()]),
    content: Type.String({ maxLength: 256 * 1024 }), contentViewDigest: Type.Optional(hash),
  }), Type.Null()]),
  accountId: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
  warnings: Type.Array(Type.String({ minLength: 1, maxLength: 4000 }), { maxItems: 12 }),
  confirmations: Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 8 }),
  files: Type.Optional(Type.Array(object({
    path: Type.String({ minLength: 1, maxLength: 4096 }), digest: maybeHash, blob: maybeGit,
    mode: Type.Union([Type.Literal("100644"), Type.Literal("100755"), Type.Null()]), bytes: count,
  }), { maxItems: 100 })),
  unaffectedIndexDigest: Type.Optional(hash), indexEntriesDigest: Type.Optional(hash), workingTreeDigest: Type.Optional(hash),
  managedBranch: Type.Optional(object({ revision: count, changeSetId: id, branch: ref, baseCommit: gitHash })),
  remoteChange: Type.Optional(RepositoryRemoteReviewSchema),
});
export type GithubReviewDocument = Static<typeof GithubReviewDocumentSchema>;
export interface GithubPreview { document: GithubReviewDocument; digest: string }
export const GithubInspectionSchema = object({
  actor: Type.Literal("user"), at: timestamp, commandId: id, commandDigest: hash,
  operationId: id, observedRevision: count, inputDigest: hash,
});
export type GithubInspection = Static<typeof GithubInspectionSchema>;
export const GithubCiTargetSchema = object({
  repository, account, accountId: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}:[1-9][0-9]*$" }), number, headSha: gitHash,
});
export type GithubCiTarget = Static<typeof GithubCiTargetSchema>;
export const GithubCiStateSchema = Type.Union([
  Type.Literal("no-checks"), Type.Literal("queued"), Type.Literal("running"), Type.Literal("pending"),
  Type.Literal("failure"), Type.Literal("success"), Type.Literal("cancelled"), Type.Literal("timed-out"),
  Type.Literal("skipped"), Type.Literal("neutral"), Type.Literal("unknown"),
]);
export type GithubCiState = Static<typeof GithubCiStateSchema>;
export const GithubCiWatchSchema = object({
  version: Type.Literal(1), target: GithubCiTargetSchema, observationDigest: maybeHash,
  observedAt: Type.Union([timestamp, Type.Null()]), state: Type.Union([GithubCiStateSchema, Type.Null()]),
  count: Type.Integer({ minimum: 0, maximum: 3000 }), complete: Type.Boolean(), deadlineReached: Type.Boolean(), cleanupUnconfirmed: Type.Boolean(),
});
export type GithubCiWatch = Static<typeof GithubCiWatchSchema>;
export const GithubOperationSchema = object({
  leaseRoots: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { minItems: 1, maxItems: 1001, uniqueItems: true })),
  version: Type.Literal(1), id, profileId: id, projectId: id, workspaceId: Type.Union([id, Type.Null()]),
  originSessionId: Type.Union([id, Type.Null()]), root: GithubReviewDocumentSchema.properties.root,
  kind: operationKind, actor: Type.Union([Type.Literal("user"), Type.Literal("model")]), modelSource: Type.Optional(ModelAdviceSourceSchema),
  projectWorkId: Type.Optional(id),
  toolCallDigest: Type.Optional(hash),
  commandId: id, commandDigest: hash, reviewDigest: hash, inputDigest: hash, resultDigest: maybeHash, jobId: id,
  revision: count, status: Type.Union([Type.Literal("running"), Type.Literal("completed"), Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("partial")]),
  dispatched: Type.Boolean(), cancelRequested: Type.Boolean(), createdAt: timestamp, updatedAt: timestamp,
  diagnostic: Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()]),
  inspection: Type.Optional(GithubInspectionSchema),
  ci: Type.Optional(GithubCiWatchSchema),
});
export type GithubOperation = Static<typeof GithubOperationSchema>;
export interface GithubSnapshot { githubOperations: GithubOperation[] }
export interface GithubEventPayloads { "github.operation_recorded": { operation: GithubOperation } }
export function githubRootQuarantined(snapshot: Pick<GithubSnapshot, "githubOperations">, root: string): boolean {
  return snapshot.githubOperations.some((operation) => (operation.root.root === root || operation.leaseRoots?.includes(root)) && operation.kind.startsWith("git.") &&
    operation.status === "partial" && !operation.inspection);
}

/** Operation kinds an approved model tool call may own: Local Git writes and, since protocol 116, the reviewed GitHub subset. */
const modelToolKind = (kind: string) => kind.startsWith("git.") && kind !== "git.remote.set" || GITHUB_MODEL_ACTION_KINDS.has(kind);
export function projectGithubOperation(previous: GithubOperation | undefined, value: unknown): GithubOperation {
  const corrupt = (): never => { throw new MoguriError("github_corrupt", "Git/GitHub intent, scope or lifecycle is corrupt. State was preserved; no operation was replayed.", 409); };
  if (!Value.Check(GithubOperationSchema, value)) return corrupt();
  const next = value;
  if (next.ci && (next.kind !== "github.ci.watch" || next.actor !== "user" ||
    (next.ci.observationDigest === null) !== (next.ci.observedAt === null) ||
    (next.ci.observationDigest === null) !== (next.ci.state === null) ||
    next.ci.observationDigest === null && (next.ci.count !== 0 || next.ci.complete || next.ci.deadlineReached) ||
    next.ci.observationDigest !== null && !next.dispatched)) return corrupt();
  if (next.kind === "git.remote.set" && (next.actor !== "user" || !next.leaseRoots?.includes(next.root.root)) ||
    next.kind !== "git.remote.set" && next.leaseRoots !== undefined) return corrupt();
  if (next.actor === "model" && (!next.modelSource || !next.originSessionId ||
    (next.projectWorkId ? !["git.push", "github.pr.create", "github.pr.update"].includes(next.kind) :
      next.kind !== "github.issue.create" && !(modelToolKind(next.kind) && next.toolCallDigest))) ||
    next.actor === "user" && (next.modelSource || next.projectWorkId || next.toolCallDigest) ||
    next.toolCallDigest && (next.actor !== "model" || next.projectWorkId || !modelToolKind(next.kind))) return corrupt();
  if (![next.createdAt, next.updatedAt].every((value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value) ||
    !next.root.root.startsWith("/") || next.root.root.includes("\0") || !next.root.root.isWellFormed() ||
    next.status === "completed" && (!next.dispatched || !next.resultDigest || next.cancelRequested || next.diagnostic !== null) ||
    next.status === "running" && (next.resultDigest !== null || next.diagnostic !== null) ||
    next.status !== "running" && next.status !== "completed" && !next.diagnostic ||
    next.status === "cancelled" && next.dispatched && next.kind !== "github.ci.watch" || next.status === "partial" && !next.dispatched ||
    next.inspection && (next.status !== "partial" || !next.kind.startsWith("git.") || next.inspection.operationId !== next.id ||
      next.inspection.inputDigest !== next.inputDigest || next.inspection.commandId === next.commandId || !Number.isFinite(Date.parse(next.inspection.at)) ||
      new Date(next.inspection.at).toISOString() !== next.inspection.at)) return corrupt();
  if (!previous) {
    if (next.revision !== 0 || next.status !== "running" || next.dispatched || next.cancelRequested || next.createdAt !== next.updatedAt) return corrupt();
  } else {
    if (previous.status !== "running") {
      const allowed = new Set(["revision", "updatedAt", "inspection"]);
      if (previous.status !== "partial" || previous.inspection || !next.inspection ||
        next.revision !== previous.revision + 1 || next.inspection.observedRevision !== previous.revision || next.inspection.at !== next.updatedAt ||
        Object.entries(previous).some(([key, value]) => !allowed.has(key) && JSON.stringify(value) !== JSON.stringify(next[key as keyof GithubOperation])) ||
        Object.keys(next).some((key) => !allowed.has(key) && !Object.hasOwn(previous, key))) return corrupt();
      return structuredClone(next);
    }
    const immutable = ["version", "id", "profileId", "projectId", "workspaceId", "originSessionId", "kind", "actor", "commandId",
      "commandDigest", "reviewDigest", "inputDigest", "jobId", "createdAt"] as const;
    if (next.inspection || next.revision !== previous.revision + 1 || immutable.some((key) => previous[key] !== next[key]) ||
      next.projectWorkId !== previous.projectWorkId || next.toolCallDigest !== previous.toolCallDigest ||
      JSON.stringify(next.root) !== JSON.stringify(previous.root) || JSON.stringify(next.leaseRoots) !== JSON.stringify(previous.leaseRoots) ||
      Boolean(next.ci) !== Boolean(previous.ci) || JSON.stringify(next.ci?.target) !== JSON.stringify(previous.ci?.target) ||
      previous.ci?.cleanupUnconfirmed && !next.ci?.cleanupUnconfirmed ||
      JSON.stringify(next.modelSource) !== JSON.stringify(previous.modelSource) || previous.dispatched && !next.dispatched ||
      previous.cancelRequested && !next.cancelRequested) return corrupt();
  }
  return structuredClone(next);
}
export function hasGithubPrCiHistory(events: readonly StoredEvent[]): boolean {
  return events.some((event) => event.event_type === "github.operation_recorded" && event.payload.operation.ci !== undefined ||
    event.event_type === "attention.raised" && (event.payload.attention.reason === "ci" || event.payload.attention.operationRevision !== undefined));
}

export const GithubCommandSchema = Type.Union([
  object({ type: Type.Literal("github.execute"), scope: GithubScopeSchema, action: GithubActionSchema, expectedDigest: hash,
    confirm: Type.Literal(true), confirmations: Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 8 }) }),
  object({ type: Type.Literal("github.acknowledge"), operationId: id, expectedRevision: count, expectedInputDigest: hash, confirm: Type.Literal(true) }),
]);
export type GithubCommand = Static<typeof GithubCommandSchema>;
const page = { page: Type.Integer({ minimum: 1, maximum: 100 }), perPage: Type.Integer({ minimum: 1, maximum: 100 }) };
export const GithubRepositorySchema = object({
  id: number, fullName: repository, description: Type.String({ maxLength: 4096 }),
  url: Type.String({ maxLength: 2048 }), sshUrl: Type.String({ maxLength: 2048 }), cloneUrl: Type.String({ maxLength: 2048 }),
  visibility: Type.Union([Type.Literal("public"), Type.Literal("private"), Type.Literal("internal")]),
  defaultBranch: ref, relationship: Type.Union([Type.Literal("owner"), Type.Literal("organization"), Type.Literal("accessible"), Type.Literal("public")]),
  licenseId: Type.Union([Type.String({ maxLength: 100 }), Type.Null()]), openSource: Type.Union([Type.Boolean(), Type.Null()]),
});
export type GithubRepository = Static<typeof GithubRepositorySchema>;
export const GithubWorkSourceSchema = object({
  kind: Type.Union([Type.Literal("issue"), Type.Literal("pull")]), repository, account, number,
  accountId: Type.Optional(Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}:[1-9][0-9]*$" })),
});
export type GithubWorkSource = Static<typeof GithubWorkSourceSchema>;
export const GithubPullSourceSchema = object({ ...GithubWorkSourceSchema.properties, kind: Type.Literal("pull") });
export type GithubPullSource = Static<typeof GithubPullSourceSchema>;
export const GithubSessionSourceSchema = object({ ...GithubWorkSourceSchema.properties, expectedDigest: hash });
export type GithubSessionSource = Static<typeof GithubSessionSourceSchema>;
export const GithubSourceBindingSchema = object({
  env: Type.Literal("Local"), profileId: id, projectId: id, workspaceId: Type.Union([id, Type.Null()]),
  root: GithubReviewDocumentSchema.properties.root, configurationRevision: count, policyRevision: count, permissionRevision: count,
});
export type GithubSourceBinding = Static<typeof GithubSourceBindingSchema>;
/** Owner key for comparisons. The device number is boot-scoped (macOS renumbers it at boot), so retained roots match by canonical path and inode. */
export const githubSourceOwner = (binding: GithubSourceBinding) => ({
  env: binding.env, profileId: binding.profileId, projectId: binding.projectId, workspaceId: binding.workspaceId,
  root: { root: binding.root.root, inode: binding.root.inode },
});
/** A complete binding for comparisons, without the boot-scoped device number. */
export const durableSourceBinding = (binding: GithubSourceBinding) => ({ ...binding, root: { root: binding.root.root, inode: binding.root.inode } });
export function githubCiOperationMatches(operation: GithubOperation, source: Pick<GithubCiTarget, "repository" | "accountId" | "number">, binding: GithubSourceBinding): boolean {
  const target = operation.ci?.target;
  return Boolean(target && operation.profileId === binding.profileId && operation.projectId === binding.projectId &&
    operation.workspaceId === binding.workspaceId && operation.root.root === binding.root.root && operation.root.inode === binding.root.inode &&
    target.accountId === source.accountId && target.number === source.number &&
    target.repository.toLowerCase() === source.repository.toLowerCase());
}
export const GithubProjectResponseSchema = object({
  type: Type.Literal("github.project"), boundary: Type.Literal("controller-gh-account-not-ssh"), account, accountId: id,
  repository, defaultBranch: ref, branch: Type.String({ maxLength: 4096 }), url: Type.String({ maxLength: 2048 }),
  binding: GithubSourceBindingSchema, warning: Type.String({ maxLength: 8192 }),
  remote: object({ name: Type.String({ maxLength: 100 }), fetchUrl: Type.String({ maxLength: 4096 }), pushUrls: Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 100 }) }),
});
export const GithubSessionOriginSchema = object({
  version: Type.Literal(1), source: GithubWorkSourceSchema,
  accountId: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}:[1-9][0-9]*$" }), binding: GithubSourceBindingSchema, digest: hash,
});
export type GithubSessionOrigin = Static<typeof GithubSessionOriginSchema>;
export function githubItemIdentity(input: string): { url: string; kind: "issue" | "pull"; repository: string; number: number } {
  let url: URL;
  try { url = new URL(input); } catch { throw new MoguriError("github_source", "Use a canonical GitHub issue or pull request URL."); }
  const match = url.pathname.match(/^\/([A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100})\/(issues|pull)\/([1-9]\d*)\/?$/);
  if (url.protocol !== "https:" || url.host !== "github.com" || url.username || url.password || url.search || url.hash || !match ||
    !Number.isSafeInteger(Number(match[3])) || [".", ".."].includes(match[1]!.split("/")[1]!)) throw new MoguriError("github_source", "Use an exact credential-free github.com issue or pull request URL.");
  return { url: `https://github.com/${match[1]}/${match[2]}/${match[3]}`, kind: match[2] === "pull" ? "pull" : "issue", repository: match[1]!, number: Number(match[3]) };
}
export const GithubBrowseSchema = Type.Union([
  object({ resource: Type.Literal("search"), ...github, ...page, query: Type.String({ minLength: 1, maxLength: 2000 }) }),
  object({ resource: Type.Union([Type.Literal("issues"), Type.Literal("pulls"), Type.Literal("releases")]), ...github, ...page,
    state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")])) }),
  object({ resource: Type.Union([Type.Literal("issue"), Type.Literal("pull"), Type.Literal("reviews"), Type.Literal("comments"), Type.Literal("review-comments"), Type.Literal("threads")]), ...github, number, ...page }),
  object({ resource: Type.Literal("files"), ...github, number, headSha: gitHash, ...page }),
  object({ resource: Type.Literal("jobs"), ...github, runId: number, headSha: gitHash, ...page }),
  object({ resource: Type.Literal("checks"), ...github, headSha: gitHash, ...page }),
  object({ resource: Type.Literal("runs"), ...github, headSha: Type.Optional(gitHash), ...page }),
  object({ resource: Type.Union([Type.Literal("run"), Type.Literal("logs")]), ...github, runId: number, ...page }),
  object({ resource: Type.Literal("release"), ...github, releaseId: number, ...page }),
  /** Protocol 116: tags, releases by tag or latest, check-run annotations, file contents, repository settings and rules. */
  object({ resource: Type.Union([Type.Literal("tags"), Type.Literal("rulesets")]), ...github, ...page }),
  object({ resource: Type.Union([Type.Literal("release-latest"), Type.Literal("settings")]), ...github, ...page }),
  object({ resource: Type.Literal("release-tag"), ...github, tag: ref, ...page }),
  object({ resource: Type.Literal("annotations"), ...github, checkRunId: number, headSha: gitHash, ...page }),
  object({ resource: Type.Literal("contents"), ...github, path: Type.String({ maxLength: 4096 }), ref: Type.Optional(ref), ...page }),
  object({ resource: Type.Literal("branch-rules"), ...github, branch: ref, ...page }),
  /**
   * Protocol 118 (D64): a PR's commits (kind "commit") and its timeline (commits, reviews, comments and "event" items), plus the
   * repository's labels (kind "label") and assignable users (kind "user") for the Code change editors.
   */
  object({ resource: Type.Union([Type.Literal("commits"), Type.Literal("timeline")]), ...github, number, ...page }),
  object({ resource: Type.Union([Type.Literal("labels"), Type.Literal("assignees")]), ...github, ...page }),
]);
export type GithubBrowse = Static<typeof GithubBrowseSchema>;
export const GithubReadToolSchema = Type.Union([
  object({ action: Type.Literal("project") }),
  object({ action: Type.Literal("browse"), input: GithubBrowseSchema }),
]);
export const GithubQuerySchema = Type.Union([
  object({ type: Type.Literal("git.read"), scope: GithubScopeSchema, input: GitReadSchema }),
  object({ type: Type.Literal("github.repositories"), source: Type.Union([Type.Literal("account"), Type.Literal("public")]),
    query: Type.String({ maxLength: 200 }), account: Type.Optional(account),
    accountId: Type.Optional(Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}:[1-9][0-9]*$" })), ...page }),
  object({ type: Type.Literal("github.project"), scope: GithubScopeSchema }),
  object({ type: Type.Literal("github.branch"), scope: GithubScopeSchema, repository, account, branch: ref, accountId: Type.String({ minLength: 3, maxLength: 128 }) }),
  object({ type: Type.Literal("github.source"), scope: GithubScopeSchema, source: GithubWorkSourceSchema }),
  object({ type: Type.Literal("github.ci"), scope: GithubScopeSchema, source: GithubPullSourceSchema, binding: Type.Optional(GithubSourceBindingSchema) }),
  object({ type: Type.Literal("github.preview"), scope: GithubScopeSchema, action: GithubActionSchema }),
  object({ type: Type.Literal("github.browse"), scope: GithubScopeSchema, input: GithubBrowseSchema }),
  object({ type: Type.Literal("github.read"), operationId: id }),
  object({ type: Type.Literal("github.history"), projectId: Type.Optional(id), offset: Type.Integer({ minimum: 0 }), limit: Type.Integer({ minimum: 1, maximum: 100 }) }),
]);
export type GithubQuery = Static<typeof GithubQuerySchema>;
export const isGithubCommand = (value: unknown): value is GithubCommand => Value.Check(GithubCommandSchema, value);
export const isGithubQuery = (value: unknown): value is GithubQuery => Value.Check(GithubQuerySchema, value);

const nullableText = (maxLength: number) => Type.Union([Type.String({ maxLength }), Type.Null()]);
export const GithubItemSchema = object({
  kind: Type.Union([Type.Literal("issue"), Type.Literal("pull"), Type.Literal("review"), Type.Literal("comment"), Type.Literal("check"),
    Type.Literal("status"), Type.Literal("run"), Type.Literal("release"), Type.Literal("logs"), Type.Literal("file"), Type.Literal("job"),
    Type.Literal("tag"), Type.Literal("annotation"), Type.Literal("content"), Type.Literal("settings"), Type.Literal("ruleset"), Type.Literal("rule"),
    Type.Literal("commit"), Type.Literal("event"), Type.Literal("label"), Type.Literal("user")]),
  id: count, number: Type.Optional(number), title: Type.String({ maxLength: 2048 }), body: Type.String({ maxLength: 512 * 1024 }),
  state: Type.String({ maxLength: 100 }), url: nullableText(4096), updatedAt: nullableText(100), author: nullableText(128),
  headSha: maybeGit, conclusion: nullableText(100), tag: Type.Optional(Type.String({ maxLength: 1024 })), target: Type.Optional(Type.String({ maxLength: 1024 })),
  draft: Type.Optional(Type.Boolean()), prerelease: Type.Optional(Type.Boolean()), base: Type.Optional(Type.String({ maxLength: 1024 })), head: Type.Optional(Type.String({ maxLength: 1024 })),
  headRepository: Type.Optional(Type.String({ minLength: 3, maxLength: 140 })),
  nodeId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  path: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })), line: Type.Optional(Type.Integer({ minimum: 1 })),
  additions: Type.Optional(count), deletions: Type.Optional(count), patch: Type.Optional(nullableText(512 * 1024)),
  steps: Type.Optional(Type.Array(object({ name: Type.String({ maxLength: 2048 }), status: Type.String({ maxLength: 100 }), conclusion: nullableText(100) }), { maxItems: 1000 })),
  readyToMerge: Type.Optional(Type.Boolean()), mergeState: Type.Optional(nullableText(100)),
  /**
   * Protocol 118 (D64). Issues and PRs: labels, assignees, requested reviewers (users), creation time and, for PRs, commit and changed-file
   * counts. Checks, runs and jobs: start time, the GitHub app slug and, for GitHub Actions check runs, the workflow run ID. Commits use
   * headSha for the commit SHA and title for the message's first line. Events carry GitHub's event name in state, its subject in title
   * (new title, label, login or ref) and, for "renamed", the previous title in body.
   */
  labels: Type.Optional(Type.Array(object({ name: Type.String({ maxLength: 100 }), color: nullableText(16) }), { maxItems: 100 })),
  assignees: Type.Optional(Type.Array(Type.String({ maxLength: 128 }), { maxItems: 100 })),
  reviewers: Type.Optional(Type.Array(Type.String({ maxLength: 128 }), { maxItems: 100 })),
  createdAt: Type.Optional(nullableText(100)), startedAt: Type.Optional(nullableText(100)),
  app: Type.Optional(nullableText(128)), runId: Type.Optional(count),
  commits: Type.Optional(count), changedFiles: Type.Optional(count),
});
export type GithubItem = Static<typeof GithubItemSchema>;
export const GithubCiObservationSchema = object({
  version: Type.Literal(1), target: GithubCiTargetSchema, at: timestamp, state: GithubCiStateSchema,
  complete: Type.Boolean(), deadlineReached: Type.Boolean(), items: Type.Array(GithubItemSchema, { maxItems: 3000 }),
});
export type GithubCiObservation = Static<typeof GithubCiObservationSchema>;
export function githubPrCiState(values: GithubItem[]): GithubCiState {
  if (!values.length) return "no-checks";
  const states = values.map((value): GithubCiState => {
    if (value.kind === "status") return value.state === "success" ? "success" :
      ["failure", "error"].includes(value.state) ? "failure" : value.state === "pending" ? "pending" : "unknown";
    if (value.state === "in_progress") return "running";
    if (["queued", "waiting", "requested", "pending"].includes(value.state)) return "queued";
    if (value.state !== "completed") return "unknown";
    if (["failure", "startup_failure", "action_required"].includes(value.conclusion ?? "")) return "failure";
    if (value.conclusion === "cancelled") return "cancelled";
    if (value.conclusion === "timed_out") return "timed-out";
    if (value.conclusion === "success" || value.conclusion === "skipped" || value.conclusion === "neutral") return value.conclusion;
    return "unknown";
  });
  for (const state of ["failure", "cancelled", "timed-out", "running", "queued", "pending", "unknown", "skipped", "neutral"] as const) {
    if (states.includes(state)) return state;
  }
  return "success";
}
export const GithubOperationResultSchema = object({
  version: Type.Literal(1), operationId: id, kind: operationKind,
  outcome: Type.Union([Type.Literal("completed"), Type.Literal("conflicts"), Type.Literal("ci"), Type.Literal("partial")]),
  head: gitHash, branch: ref, status: Type.String({ maxLength: 64 * 1024 }), rebaseInProgress: Type.Boolean(),
  remoteSha: maybeGit, resource: Type.Union([GithubItemSchema, Type.Null()]),
  ci: Type.Union([object({ headSha: gitHash,
    state: GithubCiStateSchema,
    deadlineReached: Type.Boolean(), items: Type.Array(GithubItemSchema, { maxItems: 3000 }) }), Type.Null()]),
  diagnostic: nullableText(4000),
});
export type GithubOperationResult = Static<typeof GithubOperationResultSchema>;
export type GithubResponse =
  | { type: "git.read"; root: GithubReviewDocument["root"]; git: GithubGitState; data: GitReadData }
  | { type: "github.repositories"; boundary: "controller-gh-account-not-ssh"; account: string; accountId: string;
      source: "account" | "public"; repositories: GithubRepository[]; page: number; nextPage: number | null; warning: string }
  | Static<typeof GithubProjectResponseSchema>
  | { type: "github.branch"; branch: string; sha: string; accountId: string; binding: GithubSourceBinding }
  | { type: "github.source"; source: GithubWorkSource; accountId: string; binding: GithubSourceBinding; item: GithubItem; digest: string; warning: string }
  | { type: "github.ci"; source: GithubPullSource; accountId: string; binding: GithubSourceBinding; item: GithubItem;
      watches: GithubOperation[]; currentWatchId: string | null; verifiedAt: string; warning: string }
  | { type: "github.preview"; preview: GithubPreview }
  | { type: "github.browse"; boundary: "controller-gh-account-not-ssh"; account: string; accountId: string; repository: string; resource: GithubBrowse["resource"];
      page: number; perPage: number; nextPage: number | null; items: GithubItem[]; warning: string }
  | { type: "github.read"; operation: GithubOperation; document: GithubReviewDocument; result: GithubOperationResult | null;
      ciObservation?: GithubCiObservation; commentFilter?: WorkItemCommentFilter }
  | { type: "github.history"; operations: GithubOperation[]; total: number };
export type GitReadData =
  | { action: "status"; status: string }
  | { action: "branches"; branches: { name: string; sha: string; upstream: string | null }[] }
  | { action: "log"; head: string; commits: { sha: string; parents: string[]; subject: string }[]; nextOffset: number | null }
  | { action: "show" | "diff"; text: string };
