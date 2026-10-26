import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { McpServerSchema, SandboxSchema } from "./config.ts";
import type { ModelContextPreview } from "./model.ts";
import { ControlDefaultsSchema } from "./controls.ts";
import { ProjectArtifactChoiceSchema, type RetainedArtifact } from "./artifacts.ts";
import type { PlanBinding } from "./plan-saves.ts";
import type { TerminalState } from "./terminals.ts";
import { WorkflowGuidanceSchema } from "./preferences.ts";
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
export const ProjectSettingsSchema = object({
  repo: object({
    upstream: Type.String({ minLength: 1, maxLength: 100 }), mainBranch: Type.String({ minLength: 1, maxLength: 200 }),
    branchPattern: Type.String({ minLength: 1, maxLength: 200 }),
    githubAccess: Type.Union([Type.Literal("public"), Type.Literal("gh-cli")]),
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
export interface NavigationFolder { id: string; name: string; order: number; revision: number }
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
  artifacts: RetainedArtifact[]; terminals: TerminalState[];
}
export const SessionChangesSchema = object({
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })), pinned: Type.Optional(Type.Boolean()), unread: Type.Optional(Type.Boolean()),
  order: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  groupId: Type.Optional(nullableId), parentSessionId: Type.Optional(nullableId), prUrl: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 2048 }), Type.Null()])),
});
export type SessionChanges = Static<typeof SessionChangesSchema>;
export const SessionWorkspaceCommandSchema = Type.Union([
  object({ type: Type.Literal("session.organize"), sessionId: id, expectedRevision: revision, changes: SessionChangesSchema, confirmDetach: Type.Optional(Type.Literal(true)) }),
  object({ type: Type.Literal("session.reorder"), sessions: Type.Array(object({ sessionId: id, revision }), { minItems: 1, maxItems: 1000 }) }),
  object({ type: Type.Literal("session.reorder"), projectId: nullableId, parentSessionId: nullableId, groupId: nullableId, archived: Type.Boolean(),
    sessions: Type.Array(object({ sessionId: id, revision }), { minItems: 1, maxItems: 1000 }) }),
  object({ type: Type.Literal("session.mode"), sessionId: id, expectedRevision: revision, mode: SessionModeSchema }),
  object({ type: Type.Literal("session.spawn"), sessionId: id, kind: Type.Union([Type.Literal("agent"), Type.Literal("side")]), title: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })) }),
  object({ type: Type.Literal("session.from-work"), projectId: id, workspaceId: Type.Optional(id), issueId: Type.Optional(id), prUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })) }),
  object({ type: Type.Literal("session.delete"), sessionId: id, expectedRevision: revision, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("queue.release"), sessionId: id, messageId: id, expectedRevision: revision }),
  object({ type: Type.Literal("project.organize"), projectId: id, expectedRevision: revision, folderId: nullableId, color: Type.String({ pattern: "^#[a-fA-F0-9]{6}$" }), order: Type.Integer({ minimum: 0 }) }),
  object({ type: Type.Literal("project.reorder"), folderId: nullableId, projects: Type.Array(object({ projectId: id, revision }), { minItems: 1, maxItems: 1000 }) }),
  object({ type: Type.Literal("project.settings"), projectId: id, expectedRevision: revision, settings: ProjectSettingsSchema }),
  object({ type: Type.Literal("project.relocate"), projectId: id, expectedRevision: revision, path }),
  object({ type: Type.Literal("project.remove"), projectId: id, expectedRevision: revision, confirm: Type.Literal(true), artifacts: Type.Optional(ProjectArtifactChoiceSchema) }),
  object({ type: Type.Literal("project.defaults"), projectId: id, expectedRevision: revision, branch: Type.String({ minLength: 1, maxLength: 200 }), confirmPush: Type.Literal(true) }),
  object({ type: Type.Literal("project.mcp.import"), projectId: id, expectedRevision: revision, confirmReview: Type.Literal(true), expectedDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }) }),
  object({ type: Type.Literal("project.folder"), id: Type.Optional(id), name: Type.String({ minLength: 1, maxLength: 80 }), order: Type.Integer({ minimum: 0 }), expectedRevision: revision }),
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
export const sessionOrderScope = (session: { projectId: string | null; groupId: string | null; parentSessionId?: string; pinned: boolean; status: string }): string =>
  JSON.stringify([session.projectId, session.groupId, session.parentSessionId ?? null, session.pinned, session.status === "archived"]);
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
  | { type: "terminal.default-root"; root: string }
  | ({ type: "plan.read"; path: string; text: string; digest: string; exists: boolean } & Partial<PlanBinding>)
  | { type: "terminal.read"; terminal: TerminalState; data: string; baseOffset: number; nextOffset: number };
export interface ProjectRepositoryLayout { roots: string[]; complete: boolean; diagnostic: string }
