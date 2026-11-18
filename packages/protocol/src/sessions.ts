import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { McpServerSchema, SandboxSchema } from "./config.ts";
import type { ModelContextPreview } from "./model.ts";
import { ControlDefaultsSchema } from "./controls.ts";
import { ProjectArtifactChoiceSchema, type RetainedArtifact } from "./artifacts.ts";
import type { PlanBinding } from "./plan-saves.ts";
import type { TerminalState } from "./terminals.ts";
import { WorkflowGuidanceSchema } from "./preferences.ts";
import { GithubSessionSourceSchema } from "./github-workflows.ts";
export * from "./terminals.ts";
export type { RetainedArtifact } from "./artifacts.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const revision = Type.Integer({ minimum: 0 });
const path = Type.String({ minLength: 1, maxLength: 4096 });
const nullableId = Type.Union([id, Type.Null()]);
export const SessionModeSchema = Type.Union([Type.Literal("agent"), Type.Literal("read-only")]);
export type SessionMode = Static<typeof SessionModeSchema>;
export type SessionKind = "agent" | "side" | "subagent" | "metachat";
export const ProjectWorkspaceModeSchema = Type.Union([Type.Literal("worktree"), Type.Literal("checkout")]);
export const ProjectPullRequestModeSchema = Type.Union([Type.Literal("draft"), Type.Literal("none")]);
/** Whether the agent captures screenshots of user-interface changes on its own. */
export const ProjectScreenshotModeSchema = Type.Union([Type.Literal("ui-changes"), Type.Literal("off")]);
/** Whether the agent builds the project's installer when a session's work is done. Unset means Moguri still has to ask the user. */
export const ProjectInstallerModeSchema = Type.Union([Type.Literal("build"), Type.Literal("skip")]);
/** One command that looks like it builds an installer (DMG, MSI, AppImage and similar), found in the project's own files. */
export interface InstallerCandidate { source: "package.json" | "Makefile"; name: string; script: string; run: string }
export const SessionWorkspaceOriginSchema = Type.Union([
  Type.Literal("default-worktree"), Type.Literal("explicit-worktree"), Type.Literal("explicit-checkout"),
]);
export type SessionWorkspaceOrigin = Static<typeof SessionWorkspaceOriginSchema>;
export const SessionChildrenActionSchema = Type.Union([Type.Literal("archive"), Type.Literal("delete"), Type.Literal("detach")]);
export type SessionChildrenAction = Static<typeof SessionChildrenActionSchema>;
export const SessionChildrenReviewSchema = object({
  action: SessionChildrenActionSchema,
  expected: Type.Array(object({ sessionId: id, parentSessionId: id }), { maxItems: 1000 }),
});
export type SessionChildrenReview = Static<typeof SessionChildrenReviewSchema>;
export interface SessionTreeNode { id: string; parentSessionId?: string }
export function sessionSubtree<T extends SessionTreeNode>(sessions: readonly T[], sessionId: string): T[] {
  const root = sessions.find((session) => session.id === sessionId);
  if (!root) return [];
  const result = [root], visited = new Set([root.id]);
  for (let index = 0; index < result.length; index++) {
    for (const child of sessions) if (child.parentSessionId === result[index]!.id && !visited.has(child.id)) {
      visited.add(child.id); result.push(child);
    }
  }
  return result;
}
export interface RunningSessionNode extends SessionTreeNode { title: string; turnId: string | null; status: string; pendingApproval?: unknown; pendingQuestionId?: string | null }
/**
 * Sessions in the given subtrees whose current work an archive or delete would stop: an active turn (including one waiting for an
 * approval or answer) or a running owned job. Every client warns before such an action and the service refuses it without `confirmRunning`.
 */
export function runningSessions<T extends RunningSessionNode>(sessions: readonly T[], jobs: readonly { sessionId?: string | null; status: string }[], rootIds: readonly string[]): T[] {
  const seen = new Set<string>(), result: T[] = [];
  for (const id of rootIds) for (const session of sessionSubtree(sessions, id)) {
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    // A blocked or paused session also shows waiting_input, but with no turn, approval or question it has no work to stop.
    if (session.turnId || session.status === "running" || session.status === "stopping" ||
      session.status === "waiting_input" && Boolean(session.pendingApproval || session.pendingQuestionId) ||
      jobs.some((job) => job.sessionId === session.id && ["running", "waiting_input"].includes(job.status))) result.push(session);
  }
  return result;
}
/** Human list of running session titles for warnings, bounded to three names. */
export function runningSessionNames(running: readonly { title: string }[]): string {
  const names = running.slice(0, 3).map((session) => `"${session.title || "Untitled session"}"`);
  return running.length > 3 ? `${names.join(", ")} and ${running.length - 3} more` : names.join(running.length === 2 ? " and " : ", ");
}
export function sessionChildBindings<T extends SessionTreeNode>(sessions: readonly T[], sessionId: string): SessionChildrenReview["expected"] {
  return sessionSubtree(sessions, sessionId).slice(1).map((session) => {
    if (!session.parentSessionId) throw new Error("An attached child session must retain its parent identity.");
    return { sessionId: session.id, parentSessionId: session.parentSessionId };
  }).sort((a, b) => a.sessionId.localeCompare(b.sessionId));
}
export const ProjectSettingsSchema = object({
  repo: object({
    upstream: Type.String({ minLength: 1, maxLength: 100 }), mainBranch: Type.String({ minLength: 1, maxLength: 200 }),
    branchPattern: Type.String({ minLength: 1, maxLength: 200 }),
    githubAccess: Type.Union([Type.Literal("public"), Type.Literal("gh-cli")]),
    workspaceMode: Type.Optional(ProjectWorkspaceModeSchema), pullRequests: Type.Optional(ProjectPullRequestModeSchema),
    screenshots: Type.Optional(ProjectScreenshotModeSchema), installers: Type.Optional(ProjectInstallerModeSchema),
    installerCommand: Type.Optional(Type.String({ minLength: 1, maxLength: 1000, pattern: "^[^\\u0000\\r\\n]+$" })),
  }),
  sandbox: Type.Union([SandboxSchema, Type.Null()]),
  scripts: Type.Array(object({ id, name: Type.String({ minLength: 1, maxLength: 80 }), command: Type.String({ minLength: 1, maxLength: 16384 }) }), { maxItems: 30 }),
  port: Type.Union([Type.Integer({ minimum: 1, maximum: 65535 }), Type.Null()]),
  porto: object({ enabled: Type.Boolean(), project: Type.String({ maxLength: 128 }), executable: path }),
  readOnlyFolders: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 100 }),
  deniedFolders: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 100 }),
  instructionsPath: path, instructions: Type.String({ maxLength: 64 * 1024 }), mcpPath: path,
  mcpServers: Type.Array(McpServerSchema, { maxItems: 32 }), planPath: path,
  defaults: ControlDefaultsSchema,
  remotePath: Type.Union([path, Type.Null()]),
  guidance: Type.Optional(WorkflowGuidanceSchema),
});
export type ProjectSettings = Static<typeof ProjectSettingsSchema>;
/** Safe Git ref prefix: path segments of letters, digits, ".", "_" and "-", optionally ending with "/" or "-". */
export const BRANCH_PREFIX_PATTERN = "^(?!.*\\.\\.)(?!.*\\.lock(?:/|$))(?:[A-Za-z0-9_][A-Za-z0-9._-]*(?:/[A-Za-z0-9_][A-Za-z0-9._-]*)*/?)?$";
/** The branch name Moguri generates from a project's pattern, with the profile's optional prefix in front. */
export function generatedBranchName(pattern: string, slug: string, id: string, prefix = ""): string {
  const name = pattern.replaceAll("{slug}", slug).replaceAll("{id}", id);
  return prefix && !name.startsWith(prefix) ? `${prefix}${name}` : name;
}
export const projectWorkflowDefaults = (settings: ProjectSettings) => ({
  workspaceMode: settings.repo.workspaceMode ?? "worktree",
  pullRequests: settings.repo.pullRequests ?? "draft",
  screenshots: settings.repo.screenshots ?? "ui-changes",
  installers: settings.repo.installers ?? "ask",
});
export const defaultProjectSettings = (): ProjectSettings => ({
  repo: { upstream: "origin", mainBranch: "main", branchPattern: "moguri/{slug}-{id}", githubAccess: "public" },
  sandbox: null, scripts: [], port: null, porto: { enabled: false, project: "", executable: "porto" },
  readOnlyFolders: [], deniedFolders: [], instructionsPath: "AGENTS.md", instructions: "", mcpPath: "mcp.json", mcpServers: [], planPath: "docs/plan.md",
  defaults: {},
  remotePath: null,
});
export interface ProjectConfiguration { projectId: string; revision: number; folderId: string | null; color: string; order: number; values: ProjectSettings }
export const defaultProjectConfiguration = (projectId: string): ProjectConfiguration => ({
  projectId, revision: 0, folderId: null, color: "#a8d7bc", order: 0, values: defaultProjectSettings(),
});
export interface NavigationFolder { id: string; name: string; order: number; revision: number; color?: string }
export const SessionHomeRootSchema = object({
  root: Type.String({ minLength: 1, maxLength: 4096, pattern: "^/[^\\u0000\\r\\n]*$" }),
  device: Type.String({ pattern: "^[0-9]+$", maxLength: 40 }), inode: Type.String({ pattern: "^[0-9]+$", maxLength: 40 }),
});
export type SessionHomeRoot = Static<typeof SessionHomeRootSchema>;
export const SessionRepositoryProposalSchema = object({
  root: SessionHomeRootSchema, turnId: id, observedAt: Type.String({ format: "date-time" }),
  status: Type.Union([Type.Literal("pending"), Type.Literal("dismissed")]),
});
export type SessionRepositoryProposal = Static<typeof SessionRepositoryProposalSchema>;
export const insideLocalRoot = (parent: string, child: string): boolean =>
  child !== parent && child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
export const ChatWriterSchema = object({
  id, profileId: id, sessionId: id, turnId: id, root: SessionHomeRootSchema, revision,
  status: Type.Union([Type.Literal("active"), Type.Literal("settled"), Type.Literal("unconfirmed"), Type.Literal("acknowledged")]),
  startedAt: Type.String({ format: "date-time" }), updatedAt: Type.String({ format: "date-time" }),
  backgroundJobs: Type.Array(id, { maxItems: 100, uniqueItems: true }),
  diagnostic: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
  inspection: Type.Optional(object({ sessionId: id, actor: Type.Literal("user") })),
});
export type ChatWriter = Static<typeof ChatWriterSchema>;
export { SessionRepositorySchema, SessionRepositoriesSchema } from "./repository-roots.ts";
export type { SessionRepository } from "./repository-roots.ts";
export interface SessionGroup extends NavigationFolder { projectId: string }
export const ProjectCloneIntentSchema = object({
  version: Type.Literal(1), projectId: id, repository: Type.String({ minLength: 1, maxLength: 2048 }), path, parent: path,
  device: Type.String({ minLength: 1, maxLength: 40 }), inode: Type.String({ minLength: 1, maxLength: 40 }),
  leaseRoots: Type.Array(path, { minItems: 1, maxItems: 1000 }),
  policyRevision: revision, commandId: id, commandDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
});
export type ProjectCloneIntent = Static<typeof ProjectCloneIntentSchema>;
export interface SessionWorkspaceSnapshot {
  projectConfigurations: ProjectConfiguration[]; projectFolders: NavigationFolder[]; sessionGroups: SessionGroup[];
  artifacts: RetainedArtifact[]; terminals: TerminalState[]; chatWriters: ChatWriter[];
}
export const SessionChangesSchema = object({
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })), pinned: Type.Optional(Type.Boolean()), unread: Type.Optional(Type.Boolean()),
  order: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  groupId: Type.Optional(nullableId), parentSessionId: Type.Optional(nullableId), prUrl: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 2048 }), Type.Null()])),
  workItemUrl: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 2048 }), Type.Null()])),
  workItemId: Type.Optional(nullableId),
});
export type SessionChanges = Static<typeof SessionChangesSchema>;
export const SessionWorkspaceCommandSchema = Type.Union([
  object({ type: Type.Literal("session.home"), sessionId: id, expectedRevision: revision }),
  object({ type: Type.Literal("chat.writer.acknowledge"), sessionId: id, writerId: id, expectedRevision: revision, confirmInspection: Type.Literal(true) }),
  object({ type: Type.Literal("session.project.bind"), sessionId: id, projectId: id, expectedRevision: revision }),
  object({ type: Type.Literal("session.repository.import"), sessionId: id, expectedRevision: revision, path, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("session.repository.dismiss"), sessionId: id, expectedRevision: revision }),
  object({ type: Type.Literal("session.organize"), sessionId: id, expectedRevision: revision, changes: SessionChangesSchema, confirmDetach: Type.Optional(Type.Literal(true)) }),
  object({ type: Type.Literal("session.pr.associate"), sessionId: id, expectedRevision: revision, source: GithubSessionSourceSchema }),
  object({ type: Type.Literal("session.reorder"), sessions: Type.Array(object({ sessionId: id, revision }), { minItems: 1, maxItems: 1000 }) }),
  object({ type: Type.Literal("session.reorder"), projectId: nullableId, parentSessionId: nullableId, groupId: nullableId, projectFolderId: Type.Optional(nullableId), archived: Type.Boolean(),
    sessions: Type.Array(object({ sessionId: id, revision }), { minItems: 1, maxItems: 1000 }) }),
  object({ type: Type.Literal("session.mode"), sessionId: id, expectedRevision: revision, mode: SessionModeSchema }),
  object({ type: Type.Literal("session.spawn"), sessionId: id, kind: Type.Union([Type.Literal("agent"), Type.Literal("side")]), title: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })) }),
  object({ type: Type.Literal("session.spawn.prompt"), sessionId: id, prompt: Type.String({ minLength: 1, maxLength: 8000 }),
    expectedDraftRevision: Type.Optional(revision) }),
  object({ type: Type.Literal("session.side"), sessionId: id }),
  object({ type: Type.Literal("session.side.prompt"), sessionId: id, prompt: Type.String({ minLength: 1, maxLength: 128 * 1024 }),
    expectedDraftRevision: Type.Optional(revision) }),
  object({ type: Type.Literal("session.from-work"), projectId: id, workspaceId: Type.Optional(id), issueId: Type.Optional(id),
    prUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })), github: Type.Optional(GithubSessionSourceSchema) }),
  object({ type: Type.Literal("session.delete"), sessionId: id, expectedRevision: revision, confirm: Type.Literal(true), children: Type.Optional(SessionChildrenReviewSchema),
    confirmRunning: Type.Optional(Type.Literal(true)) }),
  object({ type: Type.Literal("queue.release"), sessionId: id, messageId: id, expectedRevision: revision }),
  object({ type: Type.Literal("project.organize"), projectId: id, expectedRevision: revision, folderId: nullableId, color: Type.String({ pattern: "^#[a-fA-F0-9]{6}$" }), order: Type.Integer({ minimum: 0 }) }),
  object({ type: Type.Literal("project.reorder"), folderId: nullableId, projects: Type.Array(object({ projectId: id, revision }), { minItems: 1, maxItems: 1000 }) }),
  object({ type: Type.Literal("project.settings"), projectId: id, expectedRevision: revision, settings: ProjectSettingsSchema }),
  object({ type: Type.Literal("project.relocate"), projectId: id, expectedRevision: revision, path }),
  object({ type: Type.Literal("project.remove"), projectId: id, expectedRevision: revision, confirm: Type.Literal(true), artifacts: Type.Optional(ProjectArtifactChoiceSchema),
    confirmRunning: Type.Optional(Type.Literal(true)) }),
  object({ type: Type.Literal("project.defaults"), projectId: id, expectedRevision: revision, branch: Type.String({ minLength: 1, maxLength: 200 }), confirmPush: Type.Literal(true) }),
  object({ type: Type.Literal("project.mcp.import"), projectId: id, expectedRevision: revision, confirmReview: Type.Literal(true), expectedDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }) }),
  object({ type: Type.Literal("project.folder"), id: Type.Optional(id), name: Type.String({ minLength: 1, maxLength: 80 }), order: Type.Integer({ minimum: 0 }), expectedRevision: revision,
    color: Type.Optional(Type.String({ pattern: "^#[a-fA-F0-9]{6}$" })) }),
  object({ type: Type.Literal("project.group"), name: Type.String({ minLength: 1, maxLength: 80 }),
    projects: Type.Array(object({ projectId: id, revision }), { minItems: 2, maxItems: 1000 }) }),
  object({ type: Type.Literal("project.ungroup"), folderId: id, expectedRevision: revision,
    projects: Type.Array(object({ projectId: id, revision }), { maxItems: 1000 }) }),
  object({ type: Type.Literal("session.group"), projectId: id, id: Type.Optional(id), name: Type.String({ minLength: 1, maxLength: 80 }), order: Type.Integer({ minimum: 0 }), expectedRevision: revision }),
  object({ type: Type.Literal("session.browser"), sessionId: id, url: Type.String({ minLength: 1, maxLength: 2048 }) }),
  object({ type: Type.Literal("artifact.capture"), sessionId: id, path: Type.Optional(path) }),
  object({ type: Type.Literal("plan.save"), sessionId: id, text: Type.String({ maxLength: 128 * 1024 }), expectedDigest: Type.String({ pattern: "^(absent|[a-f0-9]{64})$" }), expectedBinding: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })) }),
  object({ type: Type.Literal("terminal.open"), sessionId: id, root: Type.Optional(path), scriptId: Type.Optional(id), cols: Type.Integer({ minimum: 10, maximum: 500 }), rows: Type.Integer({ minimum: 2, maximum: 200 }) }),
  object({ type: Type.Literal("terminal.global.open"), cols: Type.Integer({ minimum: 10, maximum: 500 }), rows: Type.Integer({ minimum: 2, maximum: 200 }) }),
  object({ type: Type.Literal("terminal.open-global"), root: path, cols: Type.Integer({ minimum: 10, maximum: 500 }), rows: Type.Integer({ minimum: 2, maximum: 200 }) }),
  object({ type: Type.Literal("terminal.close"), terminalId: id }),
  object({ type: Type.Literal("terminal.reconcile"), terminalId: id }),
  object({ type: Type.Literal("terminal.acknowledge"), terminalId: id, confirmInspection: Type.Literal(true) }),
  object({ type: Type.Literal("terminal.owner.reconcile"), ownerId: id }),
  object({ type: Type.Literal("terminal.owner.acknowledge"), ownerId: id, confirmInspection: Type.Literal(true) }),
  object({ type: Type.Literal("retention.run") }),
]);
export type SessionWorkspaceCommand = Static<typeof SessionWorkspaceCommandSchema>;
export function compareSessions(a: { pinned: boolean; order?: number; createdAt: string; id: string }, b: { pinned: boolean; order?: number; createdAt: string; id: string }): number {
  return Number(b.pinned) - Number(a.pinned) || (a.order ?? 0) - (b.order ?? 0) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}
export const compareSessionOrder = compareSessions;
export const sessionOrderScope = (session: { projectId: string | null; groupId: string | null; projectFolderId?: string; parentSessionId?: string; pinned: boolean; status: string }): string =>
  JSON.stringify([session.projectId, session.parentSessionId ? null : session.groupId, session.parentSessionId ?? null, session.pinned, session.status === "archived",
    ...(!session.parentSessionId && session.projectFolderId ? [session.projectFolderId] : [])]);
export function projectIdentifier(name: string, taken: Iterable<string> = []): string {
  const base = name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "project";
  const names = new Set([...taken].map((value) => value.toLowerCase()));
  let candidate = base, suffix = 2;
  while (names.has(candidate.toLowerCase())) candidate = `${base}-${suffix++}`;
  return candidate;
}
export const isSessionWorkspaceCommand = (value: unknown): value is SessionWorkspaceCommand => Value.Check(SessionWorkspaceCommandSchema, value);
export const TerminalInputSchema = Type.Union([
  object({ action: Type.Literal("input"), terminalId: id, data: Type.String({ minLength: 1, maxLength: 16384 }) }),
  object({ action: Type.Literal("resize"), terminalId: id, cols: Type.Integer({ minimum: 10, maximum: 500 }), rows: Type.Integer({ minimum: 2, maximum: 200 }) }),
]);
export type TerminalInput = Static<typeof TerminalInputSchema>;
export const SessionWorkspaceQuerySchema = Type.Union([
  object({ type: Type.Literal("project.repositories"), projectId: id }),
  object({ type: Type.Literal("session.context"), sessionId: id }),
  object({ type: Type.Literal("project.configuration"), projectId: id }),
  object({ type: Type.Literal("project.git"), projectId: id, diff: Type.Boolean() }),
  object({ type: Type.Literal("project.sources"), projectId: id }),
  object({ type: Type.Literal("project.porto"), projectId: id }),
  object({ type: Type.Literal("project.installers"), projectId: id }),
  object({ type: Type.Literal("plan.read"), sessionId: id }),
  object({ type: Type.Literal("terminal.read"), terminalId: id, offset: Type.Integer({ minimum: 0 }), limit: Type.Integer({ minimum: 1, maximum: 65536 }) }),
  object({ type: Type.Literal("terminal.default-root") }),
]);
export type SessionWorkspaceQuery = Static<typeof SessionWorkspaceQuerySchema>;
export const isSessionWorkspaceQuery = (value: unknown): value is SessionWorkspaceQuery => Value.Check(SessionWorkspaceQuerySchema, value);
export type SessionWorkspaceResponse =
  | ({ type: "project.repositories" } & ProjectRepositoryLayout)
  | { type: "session.context"; context: ModelContextPreview }
  | { type: "project.configuration"; configuration: ProjectConfiguration }
  | { type: "project.git"; branch: string; repository: string | null; status: string; diff: string }
  | { type: "project.sources"; instructions: string | null; mcp: string | null; instructionsPath: string; mcpPath: string; mcpDigest: string | null }
  | { type: "project.porto"; output: string }
  | { type: "project.installers"; candidates: InstallerCandidate[] }
  | { type: "terminal.default-root"; root: string }
  | ({ type: "plan.read"; path: string; text: string; digest: string; exists: boolean } & Partial<PlanBinding>)
  | { type: "terminal.read"; terminal: TerminalState; data: string; baseOffset: number; nextOffset: number };
export interface ProjectRepositoryLayout { roots: string[]; complete: boolean; diagnostic: string }
