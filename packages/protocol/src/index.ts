import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { PlatformCommandSchema, defaultSettings, type UserSettings, type CapabilityEntry, type Proposal, type CapabilityJob, type PlatformSnapshot, type IssueBoard, type LocalIssue, type CacheReceipt, type SessionMode, type SessionKind, type SessionChanges, type ProjectConfiguration, type NavigationFolder, type SessionGroup, type RetainedArtifact, type TerminalState } from "./platform.ts";
export * from "./platform.ts";
export * from "./model.ts";
import type { ThinkingEffort } from "./model.ts";
import { ControlsSchema, ControlDefaultsSchema, controlKeys, type Controls, type DefaultsSnapshot } from "./controls.ts";
import { defaultProjectSettings } from "./sessions.ts";
import type { ProviderConnection } from "./providers.ts";
import type { RemoteExecution } from "./execution.ts";
import type { ManagedWorkspace, ChangeSet } from "./worktrees.ts";
export * from "./controls.ts";
export * from "./providers.ts";
import type { McpAuthorization } from "./oauth.ts";
import type { ConfigurationProposal, Attention, SuggestionSource } from "./engagement.ts";
import { AttachmentSchema, type Attachment } from "./inputs.ts";
import { legacyArtifact, type LegacyRetainedArtifact, type ProjectArtifactChoice } from "./artifacts.ts";
export * from "./inputs.ts";

export const PROTOCOL_VERSION = 10;
export const PROFILE_ID = "default";
export const MAX_TEXT = 128 * 1024;
const id = Type.String({ minLength: 1, maxLength: 128 });
const text = Type.String({ maxLength: MAX_TEXT });
const revision = Type.Integer({ minimum: 0 });
const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });

const attachments = Type.Array(AttachmentSchema, { maxItems: 16 });
const sessionId = { sessionId: id };

export const CommandSchema = object({
  id,
  profileId: Type.Literal("default"),
  command: Type.Union([
    object({ type: Type.Literal("project.add"), path: Type.String({ minLength: 1, maxLength: 4096 }) }),
    object({ type: Type.Literal("session.create"), projectId: Type.Optional(Type.Union([id, Type.Null()])), title: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })), overrides: Type.Optional(ControlDefaultsSchema), workspaceId: Type.Optional(id) }),
    object({ type: Type.Literal("session.configure"), ...sessionId, expectedRevision: revision, controls: ControlsSchema }),
    object({ type: Type.Literal("session.archive"), ...sessionId }),
    object({ type: Type.Literal("session.restore"), ...sessionId }),
    object({ type: Type.Literal("session.resume"), ...sessionId }),
    object({ type: Type.Literal("draft.save"), ...sessionId, expectedRevision: revision, text, attachments }),
    object({ type: Type.Literal("attachment.add"), ...sessionId, expectedRevision: revision, path: Type.String({ minLength: 1, maxLength: 4096 }) }),
    object({ type: Type.Literal("message.send"), ...sessionId, expectedRevision: revision, delivery: Type.Union([Type.Literal("queue"), Type.Literal("steer"), Type.Literal("interrupt")]), held: Type.Optional(Type.Boolean()) }),
    object({ type: Type.Literal("queue.edit"), ...sessionId, messageId: id, expectedRevision: revision, text }),
    object({ type: Type.Literal("queue.remove"), ...sessionId, messageId: id, expectedRevision: revision }),
    object({ type: Type.Literal("queue.make-turn"), ...sessionId, messageId: id, expectedRevision: revision }),
    object({ type: Type.Literal("queue.reorder"), ...sessionId, messageIds: Type.Array(id, { maxItems: 100 }), expectedRevision: revision }),
    object({ type: Type.Literal("session.stop"), ...sessionId }),
    object({ type: Type.Literal("approval.respond"), ...sessionId, approvalId: id, allow: Type.Boolean() }),
    object({ type: Type.Literal("provider.login") }),
    object({ type: Type.Literal("provider.cancel") }),
    object({ type: Type.Literal("provider.logout") }),
    object({ type: Type.Literal("provider.refresh") }),
    object({ type: Type.Literal("policy.set"), allowedEnvs: Type.Array(Type.Union([Type.Literal("Local"), Type.Literal("Sandbox"), Type.Literal("Remote")]), { minItems: 1, uniqueItems: true }) }),
    PlatformCommandSchema,
  ]),
});
export type CommandEnvelope = Static<typeof CommandSchema>;
export type Command = CommandEnvelope["command"];
export type CommandResult = { id?: string; revision?: number };

export class MoguriError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}
export function parse<T extends TSchema>(schema: T, value: unknown): Static<T> {
  if (!Value.Check(schema, value)) throw new MoguriError("invalid_request", "The request does not match the protocol schema.");
  return value;
}
export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export interface Project { id: string; name: string; path: string }
export interface ToolCall { id: string; name: string; arguments: Record<string, unknown> }
export interface PublicMessage {
  id: string;
  turnId: string;
  role: "user" | "assistant" | "tool" | "notice";
  text: string;
  timestamp: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  outcome?: string;
  attachments?: Attachment[];
}
export interface Usage {
  stepId: string;
  modelId: string;
  providerId?: string;
  apiModelId?: string;
  source?: "copilot" | "local";
  role: "solver" | "subagent" | "side";
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  totalTokens: number | null;
  estimatedUsd: number | null;
  providerReportedUsd: number | null;
  billedUsd: number | null;
  requestMs: number;
  quality: "provider-reported" | "unknown";
  outcome: string;
  contextWindow?: number;
  contextEstimate?: number;
  thinkingEffort?: ThinkingEffort;
}
export interface QueueItem {
  id: string;
  text: string;
  attachments: Attachment[];
  delivery: "queue" | "steer" | "interrupt";
  targetTurnId?: string;
  held?: boolean;
  mode?: SessionMode;
}
export interface Approval { id: string; stepId: string; call: ToolCall; policyRevision: number; permissionRevision?: number; recommendation?: string }
export interface OwnedProcess { callId: string; pid: number; processGroup: number; turnId: string; outcome: string; env?: Controls["env"] }
export type SessionStatus = "idle" | "queued" | "running" | "waiting_input" | "stopping" | "completed" | "stopped" | "failed" | "partial" | "archived";
export interface Session {
  id: string;
  projectId: string | null;
  workspaceId: string | null;
  title: string;
  controls: Controls;
  defaults?: DefaultsSnapshot;
  revision: number;
  status: SessionStatus;
  beforeArchive?: SessionStatus;
  draft: { revision: number; text: string; attachments: Attachment[] };
  queue: QueueItem[];
  queueRevision: number;
  messages: PublicMessage[];
  usage: Usage[];
  processes: OwnedProcess[];
  turnId: string | null;
  pendingApproval: Approval | null;
  lastError: string | null;
  localFinishing: boolean;
  createdAt: string;
  updatedAt: string;
  parentSessionId?: string;
  readOnly?: boolean;
  mode: SessionMode;
  pendingMode: SessionMode | null;
  kind: SessionKind;
  pinned: boolean;
  unread: boolean;
  groupId: string | null;
  archivedAt: string | null;
  prUrl: string | null;
  workItemId: string | null;
  browserUrl: string | null;
  suggestionSources?: SuggestionSource[];
  inheritedImages?: boolean;
}
export interface ModelInfo { id: string; name: string; contextWindow: number; imageInput: boolean; thinkingLevels?: ThinkingEffort[]; providerId?: string; source?: "copilot" | "local"; apiModelId?: string; maxTokens?: number; environments?: Controls["env"][] }
export interface ProviderState {
  status: "disconnected" | "connecting" | "connected" | "error";
  models: ModelInfo[];
  login: { code: string; url: string; expiresAt: number } | null;
  diagnostic: string | null;
  connections?: ProviderConnection[];
}
export interface Policy { revision: number; allowedEnvs: Controls["env"][] }
export interface Snapshot extends PlatformSnapshot {
  protocolVersion: number;
  seq: number;
  profileId: "default";
  projects: Project[];
  sessions: Session[];
  provider: ProviderState;
  policy: Policy;
  blockedProjects: string[];
  blockedSessions: string[];
  blockedWorkspaces: string[];
  capabilities: { env: Controls["env"]; ready: boolean; reason: string }[];
}
export interface Connection {
  protocolVersion: number;
  baseUrl: string;
  wsUrl: string;
  token: string;
  pid: number;
}

export interface EventPayloads {
  "project.added": { project: Project };
  "session.created": { title: string; controls: Controls; defaults?: DefaultsSnapshot; parentSessionId?: string; readOnly?: boolean; contextDigest?: string; inheritedImages?: boolean; kind?: SessionKind; mode?: SessionMode; prUrl?: string | null; workItemId?: string | null; suggestionSources?: SuggestionSource[]; workspaceId?: string | null };
  "session.workspace_bound": { workspaceId: string | null };
  "workspace.saved": { workspace: ManagedWorkspace };
  "change_set.saved": { changeSet: ChangeSet };
  "session.configured": { controls: Controls };
  "session.archived": Record<string, never>;
  "session.restored": Record<string, never>;
  "session.resumed": Record<string, never>;
  "session.blocked": { diagnostic: string };
  "draft.saved": { text: string; attachments: Attachment[] };
  "queue.enqueued": { item: QueueItem };
  "queue.edited": { messageId: string; text: string };
  "queue.removed": { messageId: string };
  "queue.reordered": { messageIds: string[] };
  "queue.delivery_changed": { messageId: string; delivery: "queue" };
  "turn.started": { item: QueueItem; controls: Controls; policyRevision: number; promptDigest?: string };
  "steer.applied": { item: QueueItem };
  "model.started": { modelId: string; providerId?: string; apiModelId?: string; source?: "copilot" | "local"; contextWindow?: number; contextEstimate?: number; thinkingEffort?: ThinkingEffort };
  "assistant.delta": { text: string };
  "model.completed": { message: PublicMessage; contextDigest: string; usage: Usage };
  "model.late_usage": { usage: Usage; executionId: string; sequence: number };
  "execution.started": { execution: RemoteExecution };
  "execution.changed": { executionId: string; status: RemoteExecution["status"]; cancellation: RemoteExecution["cancellation"]; cleanup: RemoteExecution["cleanup"]; diagnostic: string | null; workerPid?: number };
  "execution.frame_recorded": { executionId: string; sequence: number; digest: string };
  "tool.requested": { approval: Approval };
  "tool.decided": { approvalId: string; allow: boolean; actor: "user" | "policy" | "delegation"; ruleId?: string };
  "tool.started": { call: ToolCall };
  "tool.output": { callId: string; text: string };
  "process.started": { callId: string; pid: number; processGroup: number; env?: Controls["env"] };
  "tool.completed": { call: ToolCall; text: string; isError: boolean; outcome: string };
  "turn.stop_requested": Record<string, never>;
  "turn.stop_acknowledged": Record<string, never>;
  "turn.finished": { outcome: "completed" | "stopped" | "failed" | "partial"; diagnostic: string | null };
  "policy.updated": { policy: Policy; finishingTurnIds: string[] };
  "provider.changed": { status: ProviderState["status"]; diagnostic: string | null };
  "mcp.oauth_changed": { authorization: McpAuthorization };
  "configuration.proposed": { proposal: ConfigurationProposal };
  "configuration.decided": { proposalId: string; approve: boolean; actor: "user" };
  "attention.raised": { attention: Attention };
  "attention.acknowledged": { attentionIds: string[] };
  "attention.cleared": { attentionIds: string[] };
  "settings.updated": { settings: UserSettings; revision: number; permissionRevision: number };
  "capability.saved": { entry: CapabilityEntry };
  "capability.proposed": { proposal: Proposal };
  "proposal.decided": { proposalId: string; approve: boolean; actor: "user" };
  "job.started": { job: CapabilityJob };
  "job.progress": { jobId: string; progress: string; status?: "running" };
  "job.finished": { jobId: string; status: CapabilityJob["status"]; resultDigest: string | null; error: string | null };
  "board.saved": { board: IssueBoard };
  "issue.saved": { issue: LocalIssue; actor: "user" | "github" | "linear" };
  "cache.prepared": { receipt: CacheReceipt };
  "session.organized": { changes: SessionChanges };
  "session.mode_requested": { mode: SessionMode };
  "session.mode_changed": { mode: SessionMode };
  "session.browser_changed": { url: string };
  "session.deleted": { deletedSessionId: string; usage: Usage[] };
  "project.removed": { deletedProjectId: string; usage: Usage[]; artifactChoice?: ProjectArtifactChoice["action"] };
  "project.relocated": { path: string; name: string };
  "project.configured": { configuration: ProjectConfiguration };
  "project.folder_saved": { folder: NavigationFolder };
  "session.group_saved": { group: SessionGroup };
  "artifact.saved": { artifact: LegacyRetainedArtifact };
  "artifact.revised": { artifact: RetainedArtifact };
  "artifact.deleted": { artifactId: string };
  "terminal.changed": { terminal: TerminalState };
  "turn.prompt_bound": { promptDigest: string };
  "queue.released": { messageId: string };
  "queue.held": { messageIds: string[] };
}
export type EventType = keyof EventPayloads;
interface EventMetadata {
  profile_id: string;
  project_id?: string | null;
  session_id?: string | null;
  turn_id?: string | null;
  step_id?: string | null;
  correlation_id?: string | null;
}
export type EventInput = { [K in EventType]: EventMetadata & { event_type: K; payload: EventPayloads[K] } }[EventType];
export type StoredEvent = EventInput & {
  seq: number;
  id: string;
  schema_version: 1;
  timestamp: string;
  work_item_id: null;
  parent_event_id: null;
  artifact_id?: string | null;
};
export const eventTypes: readonly EventType[] = [
  "project.added", "session.created", "session.configured", "session.archived", "session.restored", "session.resumed", "session.blocked",
  "draft.saved", "queue.enqueued", "queue.edited", "queue.removed", "queue.reordered", "queue.delivery_changed", "turn.started",
  "steer.applied", "model.started", "assistant.delta", "model.completed", "tool.requested", "tool.decided",
  "tool.started", "tool.output", "process.started", "tool.completed", "turn.stop_requested", "turn.stop_acknowledged",
  "turn.finished", "policy.updated", "provider.changed", "mcp.oauth_changed",
  "settings.updated", "capability.saved", "capability.proposed", "proposal.decided", "job.started", "job.progress", "job.finished",
  "board.saved", "issue.saved", "cache.prepared",
  "session.organized", "session.mode_requested", "session.mode_changed", "session.browser_changed", "session.deleted", "project.removed",
  "project.relocated", "project.configured", "project.folder_saved", "session.group_saved", "artifact.saved", "terminal.changed", "turn.prompt_bound", "queue.released", "queue.held",
  "configuration.proposed", "configuration.decided", "attention.raised", "attention.acknowledged", "attention.cleared",
  "model.late_usage", "execution.started", "execution.changed", "execution.frame_recorded",
  "workspace.saved", "change_set.saved", "session.workspace_bound", "artifact.revised", "artifact.deleted",
];

export function projectEvents(events: StoredEvent[]): { projects: Project[]; sessions: Session[]; policy: Policy; blockedProjects: string[]; blockedSessions: string[]; blockedWorkspaces: string[] } & PlatformSnapshot {
  const projects = new Map<string, Project>();
  const sessions = new Map<string, Session>();
  let policy: Policy = { revision: 0, allowedEnvs: ["Local", "Sandbox", "Remote"] };
  const blockedProjects = new Set<string>();
  const blockedSessions = new Set<string>();
  const blockedWorkspaces = new Set<string>();
  let settings: PlatformSnapshot["settings"] = { revision: 0, permissionRevision: 0, values: defaultSettings(), defaults: defaultSettings() };
  const registry = new Map<string, CapabilityEntry>();
  const proposals = new Map<string, Proposal>();
  const jobs = new Map<string, CapabilityJob>();
  const oauthAuthorizations = new Map<string, McpAuthorization>();
  const configurationProposals = new Map<string, ConfigurationProposal>();
  const attention = new Map<string, Attention>();
  const boards = new Map<string, IssueBoard>();
  const issues = new Map<string, LocalIssue>();
  const dependencyCaches = new Map<string, CacheReceipt>();
  const projectConfigurations = new Map<string, ProjectConfiguration>();
  const projectFolders = new Map<string, NavigationFolder>();
  const sessionGroups = new Map<string, SessionGroup>();
  const artifacts = new Map<string, RetainedArtifact>();
  const terminals = new Map<string, TerminalState>();
  const executions = new Map<string, RemoteExecution>();
  const managedWorkspaces = new Map<string, ManagedWorkspace>();
  const changeSets = new Map<string, ChangeSet>();
  for (const event of events) {
    if (event.profile_id !== PROFILE_ID) continue;
    if (event.event_type === "session.deleted") {
      sessions.delete(event.payload.deletedSessionId);
      blockedSessions.delete(event.payload.deletedSessionId);
      for (const [id, terminal] of terminals) if (terminal.sessionId === event.payload.deletedSessionId) terminals.delete(id);
      for (const [id, entry] of attention) if (entry.sessionId === event.payload.deletedSessionId) attention.delete(id);
      for (const [id, execution] of executions) if (execution.sessionId === event.payload.deletedSessionId) executions.delete(id);
    }
    if (event.event_type === "project.removed") {
      projects.delete(event.payload.deletedProjectId);
      projectConfigurations.delete(event.payload.deletedProjectId);
      for (const [id, session] of sessions) if (session.projectId === event.payload.deletedProjectId) sessions.delete(id);
      for (const map of [boards, issues, dependencyCaches, sessionGroups, artifacts, terminals, configurationProposals, attention, oauthAuthorizations, executions, managedWorkspaces, changeSets]) for (const [id, value] of map) if (value.projectId === event.payload.deletedProjectId) map.delete(id);
    }
    if (event.event_type === "project.configured") projectConfigurations.set(event.payload.configuration.projectId, { ...structuredClone(event.payload.configuration), values: { ...defaultProjectSettings(), ...structuredClone(event.payload.configuration.values) } });
    if (event.event_type === "mcp.oauth_changed") oauthAuthorizations.set(event.payload.authorization.id, { ...event.payload.authorization });
    if (event.event_type === "configuration.proposed") configurationProposals.set(event.payload.proposal.id, { ...event.payload.proposal });
    if (event.event_type === "configuration.decided") { const proposal = configurationProposals.get(event.payload.proposalId); if (proposal) proposal.status = event.payload.approve ? "applied" : "rejected"; }
    if (event.event_type === "attention.raised") attention.set(event.payload.attention.id, { ...event.payload.attention });
    if (event.event_type === "attention.acknowledged") for (const id of event.payload.attentionIds) { const entry = attention.get(id); if (entry) entry.acknowledged = true; }
    if (event.event_type === "attention.cleared") for (const id of event.payload.attentionIds) { const entry = attention.get(id); if (entry) entry.active = false; }
    if (event.event_type === "project.folder_saved") projectFolders.set(event.payload.folder.id, { ...event.payload.folder });
    if (event.event_type === "session.group_saved") sessionGroups.set(event.payload.group.id, { ...event.payload.group });
    if (event.event_type === "artifact.saved") artifacts.set(event.payload.artifact.id, legacyArtifact(event.payload.artifact, event.id));
    if (event.event_type === "artifact.revised") artifacts.set(event.payload.artifact.id, structuredClone(event.payload.artifact));
    if (event.event_type === "artifact.deleted") artifacts.delete(event.payload.artifactId);
    if (event.event_type === "workspace.saved") {
      managedWorkspaces.set(event.payload.workspace.id, structuredClone(event.payload.workspace));
      if (event.payload.workspace.status === "partial") blockedWorkspaces.add(event.payload.workspace.id);
      if (event.payload.workspace.status === "removed") blockedWorkspaces.delete(event.payload.workspace.id);
    }
    if (event.event_type === "change_set.saved") changeSets.set(event.payload.changeSet.id, structuredClone(event.payload.changeSet));
    if (event.event_type === "terminal.changed") {
      terminals.set(event.payload.terminal.id, { ...event.payload.terminal });
      if (event.payload.terminal.status === "unconfirmed") {
        if (event.payload.terminal.workspaceId) blockedWorkspaces.add(event.payload.terminal.workspaceId);
        else blockedProjects.add(event.payload.terminal.projectId);
      }
    }
    if (event.event_type === "execution.started") executions.set(event.payload.execution.id, structuredClone(event.payload.execution));
    if (event.event_type === "execution.changed") {
      const execution = executions.get(event.payload.executionId);
      if (execution) Object.assign(execution, event.payload);
    }
    if (event.event_type === "execution.frame_recorded") {
      const execution = executions.get(event.payload.executionId);
      if (execution) execution.lastSequence = Math.max(execution.lastSequence, event.payload.sequence);
    }
    if (event.event_type === "board.saved") boards.set(event.payload.board.projectId, structuredClone(event.payload.board));
    if (event.event_type === "issue.saved") issues.set(event.payload.issue.id, structuredClone(event.payload.issue));
    if (event.event_type === "cache.prepared") dependencyCaches.set(`${event.payload.receipt.projectId}:${event.payload.receipt.workspaceId ?? "base"}:${event.payload.receipt.manager}`, { ...event.payload.receipt });
    if (event.event_type === "settings.updated") settings = { revision: event.payload.revision, permissionRevision: event.payload.permissionRevision, defaults: defaultSettings(), values: { ...defaultSettings(), ...event.payload.settings } };
    if (event.event_type === "capability.saved") registry.set(event.payload.entry.id, { ...event.payload.entry });
    if (event.event_type === "capability.proposed") proposals.set(event.payload.proposal.id, { ...event.payload.proposal });
    if (event.event_type === "proposal.decided") {
      const proposal = proposals.get(event.payload.proposalId);
      if (proposal) proposal.status = event.payload.approve ? "approved" : "rejected";
    }
    if (event.event_type === "job.started") jobs.set(event.payload.job.id, { ...event.payload.job });
    if (event.event_type === "job.progress") {
      const job = jobs.get(event.payload.jobId);
      if (job) { job.progress = event.payload.progress; if (event.payload.status) job.status = event.payload.status; }
    }
    if (event.event_type === "job.finished") {
      const job = jobs.get(event.payload.jobId);
      if (job) Object.assign(job, { status: event.payload.status, resultDigest: event.payload.resultDigest, error: event.payload.error });
      if (job && ["cache.install", "project.defaults"].includes(job.kind) && event.payload.status === "partial" && job.projectId) {
        if (job.workspaceId) blockedWorkspaces.add(job.workspaceId); else blockedProjects.add(job.projectId);
      }
    }
    if (event.event_type === "turn.finished" && ["partial", "failed"].includes(event.payload.outcome) && event.project_id) {
      const workspaceId = event.session_id ? sessions.get(event.session_id)?.workspaceId : null;
      if (workspaceId) blockedWorkspaces.add(workspaceId); else blockedProjects.add(event.project_id);
    }
    if (event.event_type === "turn.finished" && ["partial", "failed"].includes(event.payload.outcome) && !event.project_id && event.session_id) blockedSessions.add(event.session_id);
    if (event.event_type === "session.resumed" && event.project_id) {
      const workspaceId = event.session_id ? sessions.get(event.session_id)?.workspaceId : null;
      if (workspaceId) blockedWorkspaces.delete(workspaceId); else blockedProjects.delete(event.project_id);
    }
    if (event.event_type === "session.resumed" && event.session_id) blockedSessions.delete(event.session_id);
    if (event.event_type === "project.added") projects.set(event.payload.project.id, event.payload.project);
    if (event.event_type === "project.relocated" && event.project_id) {
      const project = projects.get(event.project_id);
      if (project) projects.set(project.id, { ...project, ...event.payload });
    }
    if (event.event_type === "policy.updated") {
      policy = event.payload.policy;
      for (const session of sessions.values()) session.localFinishing = session.turnId !== null && event.payload.finishingTurnIds.includes(session.turnId);
    }
    if (event.event_type === "session.created") {
      if (!event.session_id) throw new Error("Invalid session.created event scope.");
      sessions.set(event.session_id, {
        id: event.session_id, projectId: event.project_id ?? null, workspaceId: event.payload.workspaceId ?? null, title: event.payload.title,
        controls: structuredClone(event.payload.controls), defaults: event.payload.defaults ? structuredClone(event.payload.defaults) : undefined, revision: 0, status: "idle", draft: { revision: 0, text: "", attachments: [] },
        queue: [], queueRevision: 0, messages: [], usage: [], processes: [], turnId: null, pendingApproval: null,
        lastError: null, localFinishing: false, createdAt: event.timestamp, updatedAt: event.timestamp,
        parentSessionId: event.payload.parentSessionId, readOnly: event.payload.readOnly,
        mode: event.payload.mode ?? (event.payload.readOnly ? "read-only" : "agent"), pendingMode: null,
        kind: event.payload.kind ?? (event.payload.readOnly ? "subagent" : "agent"), pinned: false, unread: false, groupId: null, archivedAt: null,
        prUrl: event.payload.prUrl ?? null, workItemId: event.payload.workItemId ?? null, browserUrl: null,
        suggestionSources: event.payload.suggestionSources,
        inheritedImages: event.payload.inheritedImages,
      });
    }
    const session = event.session_id ? sessions.get(event.session_id) : undefined;
    if (!session) continue;
    session.updatedAt = event.timestamp;
    const addUser = (item: QueueItem) => session.messages.push({
      id: item.id, turnId: event.turn_id ?? "", role: "user", text: item.text +
        (item.attachments.length ? `\n\nAttached: ${item.attachments.map((attachment) => attachment.path).join(", ")}` : ""),
      timestamp: event.timestamp, attachments: item.attachments.length ? structuredClone(item.attachments) : undefined,
    });
    switch (event.event_type) {
      case "session.configured":
        if (session.defaults) for (const key of controlKeys) if (JSON.stringify(session.controls[key]) !== JSON.stringify(event.payload.controls[key])) session.defaults.sources[key] = "session";
        session.controls = structuredClone(event.payload.controls); session.revision++; break;
      case "session.organized": {
        const changes = event.payload.changes;
        if (changes.title !== undefined) session.title = changes.title;
        if (changes.pinned !== undefined) session.pinned = changes.pinned;
        if (changes.unread !== undefined) session.unread = changes.unread;
        if (changes.groupId !== undefined) session.groupId = changes.groupId;
        if (changes.parentSessionId !== undefined) session.parentSessionId = changes.parentSessionId ?? undefined;
        if (changes.prUrl !== undefined) session.prUrl = changes.prUrl;
        session.revision++; break;
      }
      case "session.mode_requested": session.pendingMode = event.payload.mode; session.revision++; break;
      case "session.mode_changed": session.mode = event.payload.mode; session.pendingMode = null; session.revision++; break;
      case "session.browser_changed": session.browserUrl = event.payload.url; session.revision++; break;
      case "session.workspace_bound": session.workspaceId = event.payload.workspaceId; session.revision++; break;
      case "session.archived": session.beforeArchive = session.status; session.status = "archived"; session.archivedAt = event.timestamp; break;
      case "session.restored": session.status = session.beforeArchive ?? "idle"; session.archivedAt = null; break;
      case "session.resumed": session.status = session.queue.length ? "queued" : "idle"; session.lastError = null; break;
      case "session.blocked": session.status = "waiting_input"; session.lastError = event.payload.diagnostic; break;
      case "draft.saved": session.draft = { ...event.payload, revision: session.draft.revision + 1 }; break;
      case "queue.enqueued":
        session.queue.push(structuredClone(event.payload.item)); session.queueRevision++;
        if (!session.turnId) session.status = "queued";
        break;
      case "queue.edited": {
        const item = session.queue.find((item) => item.id === event.payload.messageId);
        if (item) item.text = event.payload.text;
        session.queueRevision++;
        break;
      }
      case "queue.removed": session.queue = session.queue.filter((item) => item.id !== event.payload.messageId); session.queueRevision++; break;
      case "queue.delivery_changed": {
        const item = session.queue.find((item) => item.id === event.payload.messageId);
        if (item) { item.delivery = event.payload.delivery; delete item.targetTurnId; }
        session.queueRevision++;
        break;
      }
      case "queue.released": {
        const item = session.queue.find((item) => item.id === event.payload.messageId);
        if (item) item.held = false;
        session.queueRevision++; break;
      }
      case "queue.held":
        for (const item of session.queue) if (event.payload.messageIds.includes(item.id)) item.held = true;
        session.queueRevision++; break;
      case "queue.reordered": {
        const items = new Map(session.queue.map((item) => [item.id, item]));
        session.queue = event.payload.messageIds.map((id) => items.get(id)).filter((item): item is QueueItem => item !== undefined);
        session.queueRevision++;
        break;
      }
      case "turn.started":
        session.turnId = event.turn_id ?? null; session.status = "running"; session.lastError = null; session.localFinishing = false;
        session.queue = session.queue.filter((item) => item.id !== event.payload.item.id); session.queueRevision++;
        addUser(event.payload.item);
        break;
      case "steer.applied":
        session.queue = session.queue.filter((item) => item.id !== event.payload.item.id); session.queueRevision++;
        addUser(event.payload.item);
        break;
      case "model.started":
        session.messages.push({ id: event.step_id ?? event.id, turnId: event.turn_id ?? "", role: "assistant", text: "", timestamp: event.timestamp });
        session.usage.push({
          stepId: event.step_id ?? event.id, modelId: event.payload.modelId, role: session.kind === "side" ? "side" : session.kind === "subagent" ? "subagent" : "solver",
          inputTokens: null, outputTokens: null, cacheReadTokens: null, totalTokens: null,
          estimatedUsd: null, providerReportedUsd: null, billedUsd: null, requestMs: 0, quality: "unknown", outcome: "running",
          contextWindow: event.payload.contextWindow, contextEstimate: event.payload.contextEstimate, thinkingEffort: event.payload.thinkingEffort,
          providerId: event.payload.providerId, apiModelId: event.payload.apiModelId, source: event.payload.source,
        });
        break;
      case "assistant.delta": {
        const message = session.messages.find((message) => message.id === event.step_id);
        if (message) message.text += event.payload.text;
        break;
      }
      case "model.completed": {
        const index = session.messages.findIndex((message) => message.id === event.payload.message.id);
        if (index >= 0) session.messages[index] = event.payload.message;
        else session.messages.push(event.payload.message);
        const usageIndex = session.usage.findIndex((usage) => usage.stepId === event.payload.usage.stepId);
        if (usageIndex >= 0) session.usage[usageIndex] = event.payload.usage; else session.usage.push(event.payload.usage);
        break;
      }
      case "model.late_usage": {
        const usageIndex = session.usage.findIndex((usage) => usage.stepId === event.payload.usage.stepId);
        if (usageIndex >= 0) session.usage[usageIndex] = structuredClone(event.payload.usage);
        break;
      }
      case "tool.requested": session.pendingApproval = event.payload.approval; session.status = "waiting_input"; break;
      case "tool.decided": session.pendingApproval = null; if (session.status !== "stopping") session.status = "running"; break;
      case "tool.started":
        session.messages.push({ id: event.payload.call.id, turnId: event.turn_id ?? "", role: "tool", text: `${event.payload.call.name}\n`, timestamp: event.timestamp, toolCalls: [event.payload.call], outcome: "running" });
        break;
      case "tool.output": {
        const message = session.messages.find((message) => message.id === event.payload.callId);
        if (message) message.text = (message.text + event.payload.text).slice(-MAX_TEXT);
        break;
      }
      case "process.started": session.processes.push({ ...event.payload, turnId: event.turn_id ?? "", outcome: "running" }); break;
      case "tool.completed": {
        const message: PublicMessage = {
          id: event.payload.call.id, turnId: event.turn_id ?? "", role: "tool", text: event.payload.text,
          timestamp: event.timestamp, toolCalls: [event.payload.call], outcome: event.payload.outcome,
        };
        const index = session.messages.findIndex((item) => item.id === message.id);
        if (index >= 0) session.messages[index] = message; else session.messages.push(message);
        for (const process of session.processes) if (process.callId === event.payload.call.id) process.outcome = event.payload.outcome;
        break;
      }
      case "turn.stop_requested": session.status = "stopping"; break;
      case "turn.stop_acknowledged": break;
      case "turn.finished":
        session.status = event.payload.outcome; session.turnId = null; session.pendingApproval = null;
        session.lastError = event.payload.diagnostic; session.localFinishing = false;
        for (const usage of session.usage) if (usage.outcome === "running") usage.outcome = "unconfirmed";
        for (const process of session.processes) if (process.outcome === "running") process.outcome = "unconfirmed";
        if (event.payload.diagnostic) session.messages.push({
          id: event.id, turnId: event.turn_id ?? "", role: "notice", text: event.payload.diagnostic, timestamp: event.timestamp, outcome: event.payload.outcome,
        });
        break;
    }
  }
  return { projects: [...projects.values()], sessions: [...sessions.values()], policy, blockedProjects: [...blockedProjects], blockedSessions: [...blockedSessions], blockedWorkspaces: [...blockedWorkspaces],
    settings, registry: [...registry.values()], proposals: [...proposals.values()], jobs: [...jobs.values()], oauthAuthorizations: [...oauthAuthorizations.values()],
    configurationProposals: [...configurationProposals.values()], attention: [...attention.values()],
    boards: [...boards.values()], issues: [...issues.values()], dependencyCaches: [...dependencyCaches.values()],
    projectConfigurations: [...projectConfigurations.values()], projectFolders: [...projectFolders.values()], sessionGroups: [...sessionGroups.values()],
    artifacts: [...artifacts.values()], terminals: [...terminals.values()], executions: [...executions.values()], managedWorkspaces: [...managedWorkspaces.values()], changeSets: [...changeSets.values()] };
}
