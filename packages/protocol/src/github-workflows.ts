import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";
import { ModelAdviceSourceSchema } from "./questions.ts";

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
export const GithubActionSchema = Type.Union([
  object({ kind: Type.Literal("git.push"), remote, branch: ref, forceWithLease: Type.Boolean() }),
  object({ kind: Type.Literal("git.rebase"), mode: Type.Literal("start"), onto: ref }),
  object({ kind: Type.Literal("git.rebase"), mode: Type.Union([Type.Literal("continue"), Type.Literal("abort")]) }),
  object({ kind: Type.Literal("git.tag.create"), tag: ref, target: ref, annotated: Type.Boolean(), message: Type.String({ maxLength: 4096 }) }),
  object({ kind: Type.Literal("git.tag.push"), remote, tag: ref }),
  object({ kind: Type.Literal("git.tag.delete"), tag: ref, location: Type.Literal("local") }),
  object({ kind: Type.Literal("git.tag.delete"), tag: ref, location: Type.Literal("remote"), remote }),
  GithubIssueCreateActionSchema,
  object({ kind: Type.Literal("github.issue.update"), ...github, number, title: Type.Optional(title), body: Type.Optional(body),
    state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed")])) }),
  object({ kind: Type.Literal("github.issue.comment"), ...github, number, body: Type.String({ minLength: 1, maxLength: 64 * 1024 }) }),
  object({ kind: Type.Literal("github.pr.create"), ...github, title, body, base: ref, head: ref,
    headRepository: Type.Optional(repository), draft: Type.Boolean() }),
  object({ kind: Type.Literal("github.pr.update"), ...github, number, title: Type.Optional(title), body: Type.Optional(body),
    state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed")])) }),
  object({ kind: Type.Literal("github.pr.comment"), ...github, number, body: Type.String({ minLength: 1, maxLength: 64 * 1024 }) }),
  object({ kind: Type.Literal("github.comment.update"), ...github, number, commentId: number,
    channel: Type.Union([Type.Literal("conversation"), Type.Literal("review")]), body: Type.String({ minLength: 1, maxLength: 64 * 1024 }) }),
  object({ kind: Type.Literal("github.comment.delete"), ...github, number, commentId: number,
    channel: Type.Union([Type.Literal("conversation"), Type.Literal("review")]) }),
  object({ kind: Type.Literal("github.review.submit"), ...github, number,
    event: Type.Union([Type.Literal("APPROVE"), Type.Literal("REQUEST_CHANGES"), Type.Literal("COMMENT")]), body }),
  object({ kind: Type.Literal("github.review.reply"), ...github, number, commentId: number, body: Type.String({ minLength: 1, maxLength: 64 * 1024 }) }),
  object({ kind: Type.Literal("github.review.resolve"), ...github, number, threadId: Type.String({ pattern: "^[A-Za-z0-9_=-]{1,200}$" }), resolve: Type.Boolean() }),
  object({ kind: Type.Literal("github.pr.merge"), ...github, number,
    method: Type.Union([Type.Literal("merge"), Type.Literal("squash"), Type.Literal("rebase")]) }),
  object({ kind: Type.Literal("github.release.create"), ...github, ...release }),
  object({ kind: Type.Literal("github.release.update"), ...github, releaseId: number, ...release }),
  object({ kind: Type.Literal("github.release.publish"), ...github, releaseId: number }),
  object({ kind: Type.Literal("github.ci.watch"), ...github, headSha: gitHash,
    timeoutMs: Type.Integer({ minimum: 100, maximum: 30 * 60 * 1000 }), pollMs: Type.Integer({ minimum: 50, maximum: 30_000 }) }),
]);
export type GithubAction = Static<typeof GithubActionSchema>;
const operationKind = Type.Union([
  Type.Literal("git.push"), Type.Literal("git.rebase"), Type.Literal("git.tag.create"), Type.Literal("git.tag.push"), Type.Literal("git.tag.delete"),
  Type.Literal("github.issue.create"), Type.Literal("github.issue.update"), Type.Literal("github.issue.comment"),
  Type.Literal("github.pr.create"), Type.Literal("github.pr.update"), Type.Literal("github.pr.comment"), Type.Literal("github.pr.merge"),
  Type.Literal("github.comment.update"), Type.Literal("github.comment.delete"),
  Type.Literal("github.review.submit"), Type.Literal("github.review.reply"), Type.Literal("github.review.resolve"),
  Type.Literal("github.release.create"), Type.Literal("github.release.update"), Type.Literal("github.release.publish"), Type.Literal("github.ci.watch"),
]);

export const GithubGitStateSchema = object({
  commonDir: Type.String({ minLength: 1, maxLength: 4096 }), head: gitHash, branch: ref,
  indexDigest: hash, statusDigest: hash, worktreeDigest: hash, status: Type.String({ maxLength: 64 * 1024 }),
  rebaseDigest: maybeHash, rebaseOriginalHead: maybeGit, rebaseOnto: maybeGit, rebaseBranch: Type.Union([ref, Type.Null()]),
});
export type GithubGitState = Static<typeof GithubGitStateSchema>;
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
    content: Type.String({ maxLength: 256 * 1024 }),
  }), Type.Null()]),
  accountId: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
  warnings: Type.Array(Type.String({ minLength: 1, maxLength: 4000 }), { maxItems: 12 }),
  confirmations: Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 8 }),
});
export type GithubReviewDocument = Static<typeof GithubReviewDocumentSchema>;
export interface GithubPreview { document: GithubReviewDocument; digest: string }
export const GithubInspectionSchema = object({
  actor: Type.Literal("user"), at: timestamp, commandId: id, commandDigest: hash,
  operationId: id, observedRevision: count, inputDigest: hash,
});
export type GithubInspection = Static<typeof GithubInspectionSchema>;
export const GithubOperationSchema = object({
  version: Type.Literal(1), id, profileId: id, projectId: id, workspaceId: Type.Union([id, Type.Null()]),
  originSessionId: Type.Union([id, Type.Null()]), root: GithubReviewDocumentSchema.properties.root,
  kind: operationKind, actor: Type.Union([Type.Literal("user"), Type.Literal("model")]), modelSource: Type.Optional(ModelAdviceSourceSchema),
  commandId: id, commandDigest: hash, reviewDigest: hash, inputDigest: hash, resultDigest: maybeHash, jobId: id,
  revision: count, status: Type.Union([Type.Literal("running"), Type.Literal("completed"), Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("partial")]),
  dispatched: Type.Boolean(), cancelRequested: Type.Boolean(), createdAt: timestamp, updatedAt: timestamp,
  diagnostic: Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()]),
  inspection: Type.Optional(GithubInspectionSchema),
});
export type GithubOperation = Static<typeof GithubOperationSchema>;
export interface GithubSnapshot { githubOperations: GithubOperation[] }
export interface GithubEventPayloads { "github.operation_recorded": { operation: GithubOperation } }
export function githubRootQuarantined(snapshot: Pick<GithubSnapshot, "githubOperations">, root: string): boolean {
  return snapshot.githubOperations.some((operation) => operation.root.root === root && operation.kind.startsWith("git.") &&
    operation.status === "partial" && !operation.inspection);
}

export function projectGithubOperation(previous: GithubOperation | undefined, value: unknown): GithubOperation {
  const corrupt = (): never => { throw new MoguriError("github_corrupt", "Git/GitHub intent, scope or lifecycle is corrupt. State was preserved; no operation was replayed.", 409); };
  if (!Value.Check(GithubOperationSchema, value)) return corrupt();
  const next = value;
  if (next.actor === "model" && (!next.modelSource || next.kind !== "github.issue.create" || !next.originSessionId) ||
    next.actor === "user" && next.modelSource) return corrupt();
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
      JSON.stringify(next.root) !== JSON.stringify(previous.root) || JSON.stringify(next.modelSource) !== JSON.stringify(previous.modelSource) || previous.dispatched && !next.dispatched ||
      previous.cancelRequested && !next.cancelRequested) return corrupt();
  }
  return structuredClone(next);
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
export const GithubSessionSourceSchema = object({ ...GithubWorkSourceSchema.properties, expectedDigest: hash });
export type GithubSessionSource = Static<typeof GithubSessionSourceSchema>;
export const GithubSourceBindingSchema = object({
  env: Type.Literal("Local"), profileId: id, projectId: id, workspaceId: Type.Union([id, Type.Null()]),
  root: GithubReviewDocumentSchema.properties.root, configurationRevision: count, policyRevision: count, permissionRevision: count,
});
export type GithubSourceBinding = Static<typeof GithubSourceBindingSchema>;
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
  object({ resource: Type.Union([Type.Literal("issues"), Type.Literal("pulls"), Type.Literal("releases")]), ...github, ...page }),
  object({ resource: Type.Union([Type.Literal("issue"), Type.Literal("pull"), Type.Literal("reviews"), Type.Literal("comments"), Type.Literal("review-comments"), Type.Literal("threads")]), ...github, number, ...page }),
  object({ resource: Type.Literal("checks"), ...github, headSha: gitHash, ...page }),
  object({ resource: Type.Literal("runs"), ...github, headSha: Type.Optional(gitHash), ...page }),
  object({ resource: Type.Union([Type.Literal("run"), Type.Literal("logs")]), ...github, runId: number, ...page }),
  object({ resource: Type.Literal("release"), ...github, releaseId: number, ...page }),
]);
export type GithubBrowse = Static<typeof GithubBrowseSchema>;
export const GithubQuerySchema = Type.Union([
  object({ type: Type.Literal("github.repositories"), source: Type.Union([Type.Literal("account"), Type.Literal("public")]),
    query: Type.String({ maxLength: 200 }), account: Type.Optional(account),
    accountId: Type.Optional(Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}:[1-9][0-9]*$" })), ...page }),
  object({ type: Type.Literal("github.project"), scope: GithubScopeSchema }),
  object({ type: Type.Literal("github.source"), scope: GithubScopeSchema, source: GithubWorkSourceSchema }),
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
    Type.Literal("status"), Type.Literal("run"), Type.Literal("release"), Type.Literal("logs")]),
  id: count, number: Type.Optional(number), title: Type.String({ maxLength: 2048 }), body: Type.String({ maxLength: 512 * 1024 }),
  state: Type.String({ maxLength: 100 }), url: nullableText(4096), updatedAt: nullableText(100), author: nullableText(128),
  headSha: maybeGit, conclusion: nullableText(100), tag: Type.Optional(Type.String({ maxLength: 1024 })), target: Type.Optional(Type.String({ maxLength: 1024 })),
  draft: Type.Optional(Type.Boolean()), prerelease: Type.Optional(Type.Boolean()), base: Type.Optional(Type.String({ maxLength: 1024 })), head: Type.Optional(Type.String({ maxLength: 1024 })),
  nodeId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});
export type GithubItem = Static<typeof GithubItemSchema>;
export const GithubOperationResultSchema = object({
  version: Type.Literal(1), operationId: id, kind: operationKind,
  outcome: Type.Union([Type.Literal("completed"), Type.Literal("conflicts"), Type.Literal("ci"), Type.Literal("partial")]),
  head: gitHash, branch: ref, status: Type.String({ maxLength: 64 * 1024 }), rebaseInProgress: Type.Boolean(),
  remoteSha: maybeGit, resource: Type.Union([GithubItemSchema, Type.Null()]),
  ci: Type.Union([object({ headSha: gitHash,
    state: Type.Union([Type.Literal("no-checks"), Type.Literal("pending"), Type.Literal("failure"), Type.Literal("success")]),
    deadlineReached: Type.Boolean(), items: Type.Array(GithubItemSchema, { maxItems: 3000 }) }), Type.Null()]),
  diagnostic: nullableText(4000),
});
export type GithubOperationResult = Static<typeof GithubOperationResultSchema>;
export type GithubResponse =
  | { type: "github.repositories"; boundary: "controller-gh-account-not-ssh"; account: string; accountId: string;
      source: "account" | "public"; repositories: GithubRepository[]; page: number; nextPage: number | null; warning: string }
  | { type: "github.project"; boundary: "controller-gh-account-not-ssh"; account: string; accountId: string;
      repository: string; defaultBranch: string; branch: string; url: string; binding: GithubSourceBinding; warning: string }
  | { type: "github.source"; source: GithubWorkSource; accountId: string; binding: GithubSourceBinding; item: GithubItem; digest: string; warning: string }
  | { type: "github.preview"; preview: GithubPreview }
  | { type: "github.browse"; boundary: "controller-gh-account-not-ssh"; account: string; accountId: string; repository: string; resource: GithubBrowse["resource"];
      page: number; perPage: number; nextPage: number | null; items: GithubItem[]; warning: string }
  | { type: "github.read"; operation: GithubOperation; document: GithubReviewDocument; result: GithubOperationResult | null }
  | { type: "github.history"; operations: GithubOperation[]; total: number };
