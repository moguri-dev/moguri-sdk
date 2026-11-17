import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { ControlsSchema } from "./controls.ts";
import { MoguriError } from "./core.ts";
import type { WorkItemCommentFilter } from "./markdown.ts";
import { GithubSourceBindingSchema, GithubWorkSourceSchema, type GithubItem } from "./github-workflows.ts";
import type { BoardConfig, IssuePosition, LocalIssue } from "./workspace.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const nullableId = Type.Union([id, Type.Null()]);
const date = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
const revision = Type.Integer({ minimum: 0 });
const ref = Type.String({ minLength: 1, maxLength: 240 });
export const KanbanSourceSchema = Type.Union([Type.Literal("kanban"), Type.Literal("github-issues"), Type.Literal("github-prs")]);
export type KanbanSource = Static<typeof KanbanSourceSchema>;
export const KanbanPreferencesSchema = object({
  visible: Type.Boolean(), source: KanbanSourceSchema,
  phaseIds: Type.Array(id, { maxItems: 12, uniqueItems: true }),
});
export type KanbanPreferences = Static<typeof KanbanPreferencesSchema>;
export const GithubBoardSourceSchema = object({
  repository: Type.String({ pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$" }),
  repositoryId: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  account: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}$" }),
  accountId: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}:[1-9][0-9]*$" }),
  binding: GithubSourceBindingSchema,
  remote: object({ name: Type.String({ minLength: 1, maxLength: 100 }), fetchUrl: Type.String({ minLength: 1, maxLength: 4096 }) }),
});
export const issuePosition = (issue: LocalIssue): IssuePosition => ({ issueId: issue.id, phaseId: issue.phaseId, order: issue.order ?? issue.number });
export const compareIssues = (a: LocalIssue, b: LocalIssue): number => (a.order ?? a.number) - (b.order ?? b.number) || a.number - b.number || a.id.localeCompare(b.id);
export function githubSyncSettings(board: BoardConfig): NonNullable<BoardConfig["githubSync"]> {
  return board.githubSync ?? { importIssues: false, phases: { backlog: "backlog", inProgress: "in-progress", review: "review", done: board.mergedColumnId } };
}
export const githubManagedIssue = (board: BoardConfig, issue: LocalIssue): boolean => board.autoRefreshPrs && Boolean(issue.github || issue.pullRequest);
export function githubIssuePhase(board: BoardConfig, issue: LocalIssue): string | null {
  const phases = githubSyncSettings(board).phases, requests = [...issue.github?.pullRequests ?? [], ...issue.pullRequest ? [issue.pullRequest] : []];
  let meaning: keyof typeof phases;
  if (issue.github?.state === "closed") meaning = "done";
  else {
    if (requests.some((request) => request.diagnostic || request.state === "unknown" || request.state === "open" && typeof request.draft !== "boolean")) return null;
    if (requests.some((request) => request.state === "open" && request.draft === false)) meaning = "review";
    else if (requests.some((request) => request.state === "open" && request.draft === true)) meaning = "inProgress";
    else if (issue.github?.state === "open") meaning = "backlog";
    else if (requests.some((request) => request.state === "merged" || request.state === "closed")) meaning = "done";
    else return null;
  }
  const phase = phases[meaning];
  if (!board.columns.some((column) => column.id === phase)) throw new MoguriError("github_sync_phases", "Configure the GitHub status-to-column mapping for this board. No phase was invented.", 409);
  return phase;
}
export function kanbanPreferences(board: BoardConfig): KanbanPreferences {
  return board.kanban ?? { visible: false, source: "kanban",
    phaseIds: ["in-progress", "backlog"].filter((id) => board.columns.some((column) => column.id === id) && id !== board.mergedColumnId) };
}
export function eligibleKanbanIssues(board: BoardConfig & { projectId: string }, issues: LocalIssue[], claims: ReadonlySet<string>): LocalIssue[] {
  const phases = kanbanPreferences(board).phaseIds;
  return issues.filter((issue) => issue.projectId === board.projectId && !issue.archived && issue.phaseId !== board.mergedColumnId &&
    phases.includes(issue.phaseId) && !claims.has(`kanban:${issue.id}`) && issue.github?.state !== "closed" &&
    (issue.github || !["merged", "closed"].includes(issue.pullRequest?.state ?? "unknown")))
    .sort((a, b) => phases.indexOf(a.phaseId) - phases.indexOf(b.phaseId) || compareIssues(a, b));
}
export type ContinueWorkChoice = "kanban" | "prompt";
const continueWorkFields = { profileId: id, sessionId: id, text: Type.String({ maxLength: 128 * 1024 }) };
export const ContinueWorkReviewSchema = Type.Union([
  object({ ...continueWorkFields, expectedRevision: revision }),
  object({ ...continueWorkFields, command: object({ executionId: id, inputDigest: hash, bindingDigest: hash }) }),
]);
export type ContinueWorkReview = Static<typeof ContinueWorkReviewSchema>;
export type DraftContinueWorkReview = Extract<ContinueWorkReview, { expectedRevision: number }>;
export function continueWorkInput(text: string): { issueId?: string } | null {
  const value = text.trim();
  if (/^continue work[.!]?$/i.test(value)) return {};
  const match = value.match(/^\/continue-work(?:[ \t]+([A-Za-z0-9_-]{1,128}))?$/i);
  return match ? match[1] ? { issueId: match[1] } : {} : null;
}
export const isContinueWork = (text: string): boolean => continueWorkInput(text) !== null;
export const kanbanIssueSignature = (issue: LocalIssue): string => {
  const original = [issue.id, issue.projectId, issue.title, issue.body, issue.kind, issue.phaseId, issue.archived, issue.pullRequest?.url ?? null, issue.linear];
  return JSON.stringify(issue.github ? [...original, [issue.github.repo, issue.github.number, issue.github.sourceDigest, issue.github.state]] : original);
};
const sourceFields = { key: Type.String({ minLength: 1, maxLength: 300 }), title: Type.String({ minLength: 1, maxLength: 2048 }), contentDigest: hash, digest: hash };
export const ProjectWorkSourceSchema = Type.Union([
  object({ kind: Type.Literal("kanban"), ...sourceFields, issueId: id, revision }),
  object({ kind: Type.Union([Type.Literal("github-issue"), Type.Literal("github-pr")]), ...sourceFields, github: GithubWorkSourceSchema }),
]);
export const ProjectWorkRunSchema = object({
  version: Type.Literal(1), id, profileId: id, projectId: id, originSessionId: id, commandId: id, commandDigest: hash,
  revision, createdAt: date, updatedAt: date, source: ProjectWorkSourceSchema, binding: GithubSourceBindingSchema, originControlsDigest: hash,
  account: Type.String({ minLength: 1, maxLength: 39 }), accountId: Type.String({ minLength: 3, maxLength: 128 }),
  repository: Type.String({ minLength: 3, maxLength: 140 }), remote: Type.String({ minLength: 1, maxLength: 100 }),
  fetchUrl: Type.String({ minLength: 1, maxLength: 4096 }), pushUrl: Type.String({ minLength: 1, maxLength: 4096 }),
  baseBranch: ref, baseCommit: Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }), branch: ref, destinationBranch: ref,
  controls: ControlsSchema, workspaceId: nullableId, sessionId: nullableId, turnId: nullableId,
  existingPrNumber: Type.Union([Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), Type.Null()]),
  status: Type.Union([Type.Literal("preparing"), Type.Literal("running"), Type.Literal("publishing"), Type.Literal("completed"),
    Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("partial")]),
  operationIds: Type.Array(id, { maxItems: 3, uniqueItems: true }),
  prUrl: Type.Union([Type.String({ minLength: 1, maxLength: 2048 }), Type.Null()]),
  diagnostic: Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()]),
  inspectedAt: Type.Union([date, Type.Null()]),
});
export type ProjectWorkRun = Static<typeof ProjectWorkRunSchema>;
export const activeProjectWork = (run: Pick<ProjectWorkRun, "status">): boolean => ["preparing", "running", "publishing"].includes(run.status);
export const claimedProjectWork = (run: ProjectWorkRun): boolean => activeProjectWork(run) || ["failed", "partial", "cancelled"].includes(run.status) && !run.inspectedAt;
export function projectWorkRecord(previous: ProjectWorkRun | undefined, value: unknown): ProjectWorkRun {
  const corrupt = (): never => { throw new MoguriError("project_work_corrupt", "Project work lost its exact source, delegation or no-replay lifecycle. State was preserved.", 409); };
  if (!Value.Check(ProjectWorkRunSchema, value)) return corrupt();
  const next = value;
  const sourceKey = next.source.kind === "kanban" ? `kanban:${next.source.issueId}` :
    `github:${next.source.github.repository.toLowerCase()}:${next.source.github.kind}:${next.source.github.number}`;
  if (next.profileId !== next.binding.profileId || next.projectId !== next.binding.projectId ||
    next.source.key !== sourceKey || next.source.kind !== "kanban" && (next.source.github.repository !== next.repository ||
      next.source.github.account !== next.account || (next.source.kind === "github-pr") !== (next.source.github.kind === "pull")) ||
    next.controls.env !== "Local" || !next.controls.modelId || !next.controls.automaticApprovals ||
    !["Autopilot", "Autopilot Max"].includes(next.controls.autonomy) ||
    ![next.createdAt, next.updatedAt, ...next.inspectedAt ? [next.inspectedAt] : []].every((date) => Number.isFinite(Date.parse(date))) ||
    ["running", "publishing", "completed"].includes(next.status) && (!next.workspaceId || !next.sessionId) ||
    next.status === "publishing" && !next.turnId ||
    next.status === "completed" && (!next.prUrl || !next.prUrl.startsWith(`https://github.com/${next.repository}/pull/`) || next.diagnostic) ||
    ["failed", "cancelled", "partial"].includes(next.status) && !next.diagnostic) return corrupt();
  if (!previous) {
    if (next.revision !== 0 || next.status !== "preparing" || next.sessionId || next.turnId || next.operationIds.length || next.prUrl || next.inspectedAt) return corrupt();
  } else {
    const mutable = new Set(["revision", "updatedAt", "workspaceId", "sessionId", "turnId", "status", "operationIds", "prUrl", "diagnostic", "inspectedAt"]);
    if (next.revision !== previous.revision + 1 || Object.entries(previous).some(([key, value]) => !mutable.has(key) &&
      JSON.stringify(value) !== JSON.stringify(next[key as keyof ProjectWorkRun])) ||
      previous.workspaceId && previous.workspaceId !== next.workspaceId || previous.sessionId && previous.sessionId !== next.sessionId ||
      previous.turnId && previous.turnId !== next.turnId ||
      !previous.operationIds.every((id, index) => next.operationIds[index] === id)) return corrupt();
    if (!activeProjectWork(previous)) {
      const allowed = new Set(["revision", "updatedAt", "inspectedAt"]);
      if (previous.inspectedAt || !next.inspectedAt || Object.entries(previous).some(([key, value]) => !allowed.has(key) &&
        JSON.stringify(value) !== JSON.stringify(next[key as keyof ProjectWorkRun]))) return corrupt();
    } else if (previous.inspectedAt !== next.inspectedAt || previous.status === "preparing" && !["preparing", "running", "failed", "cancelled", "partial"].includes(next.status) ||
      previous.status === "running" && !["running", "publishing", "failed", "cancelled", "partial"].includes(next.status) ||
      previous.status === "publishing" && !["publishing", "completed", "failed", "partial"].includes(next.status)) return corrupt();
  }
  return structuredClone(next);
}
export const KanbanCommandSchema = Type.Union([
  object({ type: Type.Literal("kanban.open"), projectId: id }),
  object({ type: Type.Literal("project.work.start"), sessionId: id, issueId: Type.Optional(id),
    consumeDraft: Type.Optional(object({ expectedRevision: revision })) }),
  object({ type: Type.Literal("project.work.cancel"), runId: id }),
  object({ type: Type.Literal("project.work.inspect"), runId: id, expectedRevision: revision, confirmInspection: Type.Literal(true) }),
]);
export type KanbanCommand = Static<typeof KanbanCommandSchema>;
export const isKanbanCommand = (value: unknown): value is KanbanCommand => Value.Check(KanbanCommandSchema, value);
export const KanbanQuerySchema = Type.Union([
  object({ type: Type.Literal("kanban.items"), projectId: id, sessionId: Type.Optional(id), source: KanbanSourceSchema, page: Type.Integer({ minimum: 1, maximum: 100 }) }),
  object({ type: Type.Literal("project.work.read"), runId: id }),
]);
export type KanbanQuery = Static<typeof KanbanQuerySchema>;
export const isKanbanQuery = (value: unknown): value is KanbanQuery => Value.Check(KanbanQuerySchema, value);
export type KanbanResponse =
  | { type: "kanban.items"; source: KanbanSource; local: LocalIssue[]; github: GithubItem[]; nextPage: number | null; warning: string }
  | { type: "project.work.read"; run: ProjectWorkRun; text: string; commentFilter?: WorkItemCommentFilter };
export interface KanbanSnapshot { projectWorkRuns: ProjectWorkRun[] }
export interface KanbanEventPayloads { "project.work_recorded": { run: ProjectWorkRun } }
export const ProjectWorkReadSchema = object({ action: Type.Literal("read"), source: Type.Optional(KanbanSourceSchema), page: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) });
export const ProjectWorkToolSchema = Type.Union([
  ProjectWorkReadSchema,
  object({ action: Type.Literal("publish"), title: Type.String({ minLength: 1, maxLength: 256 }), body: Type.String({ maxLength: 64 * 1024 }) }),
]);
