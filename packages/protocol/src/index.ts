import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MAX_TEXT, MoguriError } from "./core.ts";
export { MAX_TEXT, MoguriError, parse, isRecord } from "./core.ts";
import { PlatformCommandSchema, defaultSettings, normalizeSettings, type ApplicationConfiguration, type ApplicationUpdate, type StorageMove, type NotificationSound, type UserSettings, type CapabilityEntry, type Proposal, type CapabilityJob, type PlatformSnapshot, type IssueBoard, type LocalIssue, type CacheReceipt, type SessionMode, type SessionKind, type SessionChanges, type ProjectConfiguration, type NavigationFolder, type RetainedArtifact, type TerminalState, type SessionGroup } from "./platform.ts";
export * from "./platform.ts";
export * from "./model.ts";
export * from "./search.ts";
import type { ThinkingEffort, ModelStreamObservation } from "./model.ts";
import { ModelSelectionSchema, modelSelection, type ModelSelection } from "./model.ts";
import { ControlsSchema, ControlDefaultsSchema, controlKeys, type Controls, type DefaultsSnapshot } from "./controls.ts";
import { RememberApprovalSchema } from "./permissions.ts";
import type { SessionTelemetry } from "./activity.ts";
import {
  defaultProjectSettings, projectIdentifier, ProjectCloneIntentSchema, SessionRepositoriesSchema, SessionHomeRootSchema, ChatWriterSchema,
  SessionChildrenReviewSchema, type SessionRepository, type SessionHomeRoot, type ChatWriter,
} from "./sessions.ts";
export { sessionChildBindings, sessionSubtree } from "./sessions.ts";
export type { SessionChildrenAction, SessionChildrenReview } from "./sessions.ts";
import type { ProviderConnection, ModelCatalogue } from "./providers.ts";
import type { RemoteExecution } from "./execution.ts";
import type { ManagedWorkspace, ChangeSet } from "./worktrees.ts";
export * from "./controls.ts";
export * from "./providers.ts";
import type { McpAuthorization } from "./oauth.ts";
import type { ConfigurationProposal, Attention, SuggestionSource } from "./engagement.ts";
import { AttachmentSchema, type Attachment } from "./inputs.ts";
import { legacyArtifact, normalizeArtifact, type LegacyRetainedArtifact, type LegacyVersionedArtifact, type ProjectArtifactChoice } from "./artifacts.ts";
import type { UserQuestion, QuestionAnswer, ModelAdviceSource } from "./questions.ts";
import type { BudgetEntry, BudgetLimit, ModelRole } from "./budgets.ts";
import { BudgetPlanSchema, projectBudgetPlan, validateBudgetPlanEntries, type BudgetPlan } from "./budget-plans.ts";
import type { GlobalBudgetPolicy, GlobalPreferences, Profile } from "./profiles.ts";
import type { RoutingTurn, RoutingPlan, KupoResponsePhase, KupoObservation } from "./routing.ts";
export { routingModelReady, routingWorkingWindow } from "./routing.ts";
export type { BoundedRoutingModel } from "./routing.ts";
import type { ContextCompaction } from "./compaction.ts";
import type { RemotePlanSave } from "./plan-saves.ts";
import { OperationEntrySchema, type OperationEntry, type OperationCoverage } from "./telemetry.ts";
import { RepositoryObservationSchema, type RepositoryObservation, type RepositoryCapture } from "./repositories.ts";
import { TerminalOwnerSchema, TerminalStateSchema, type TerminalOwner } from "./terminals.ts";
import { RemoteMcpCallSchema, type RemoteMcpCall } from "./mcp.ts";
import { MemoryIndexIntentSchema } from "./memory.ts";
import { CandidateJobIntentSchema, CandidateRecordSchema, projectCandidateRecord, type CandidateRecord } from "./candidates.ts";
import { CandidateGenerationRecordSchema, projectCandidateGeneration, type CandidateGenerationRecord } from "./candidate-generations.ts";
import { projectCandidateOwners, projectCandidateCleanup, type CandidateOwner, type CandidateCleanup } from "./candidate-retention.ts";
import { RoleSequenceRecordSchema, projectRoleSequence, validateRoleSequenceLedger, successfulRoleEntry, type RoleSequenceRecord } from "./role-sequences.ts";
import { projectSandboxPublication, sandboxRepositories, type SandboxWorkspace, type SandboxExecution, type SandboxPublication } from "./sandbox.ts";
import type { SandboxSetupOperation } from "./sandbox-management.ts";
import { CompoundWorkflowSchema, projectCompoundWorkflow, validateCompoundLedger, type CompoundWorkflow } from "./compound.ts";
import { WinddownRecordSchema, projectWinddown, validateWinddownLedger, type WinddownRecord } from "./winddown.ts";
import { DecisionRecordSchema, DecisionEvidenceSchema, projectDecision, validateDecisionLedger, type DecisionRecord, type DecisionEvidence } from "./decisions.ts";
import { projectKnowledge, type KnowledgeEventPayloads, type KnowledgeRecord } from "./knowledge.ts";
import { GithubSessionOriginSchema, projectGithubOperation, type GithubEventPayloads, type GithubOperation, type GithubSessionOrigin } from "./github-workflows.ts";
import { projectLinearOperation, type LinearEventPayloads, type LinearOperation } from "./linear-workflows.ts";
import type { DependencyRegistry, WorkspaceEventPayloads } from "./workspace.ts";
import type { TaskPlan, TaskProgressReport } from "./progress.ts";
import { SessionPrObservationSchema, sameSessionPrScope, sessionPrScope, type SessionPrObservation } from "./session-status.ts";
import { CoordinationLinkSchema, CoordinationMessageSchema, type CoordinationLink, type CoordinationMessage, type CoordinationTaskOrigin } from "./coordination.ts";
import type { WorkflowKind } from "./workflows.ts";
import { GithubBoardSourceSchema, isContinueWork, projectWorkRecord, type KanbanEventPayloads, type ProjectWorkRun } from "./kanban.ts";
import { BoardConfigSchema, GithubIssueLinkSchema } from "./workspace.ts";
import { ProviderPriceCatalogSchema, PROVIDER_PRICE_SOURCES, type PricingEventPayloads, type ProviderPriceCatalog } from "./pricing.ts";
export * from "./session-status.ts";
export * from "./inputs.ts";
export * from "./memory.ts";
export * from "./audio.ts";
export * from "./shortcuts.ts";
export * from "./queued-commands.ts";
import { CommandClientSchema, CommandDraftSourceSchema, LiveSlashControlSchema, QueuedContinuationChoiceSchema, parseSlashInput, projectCommandExecution, type CommandDraftSource, type CommandExecution, type QueuedSlash, type LiveSlashControl, type QueuedContinuationChoice } from "./queued-commands.ts";

export const PROTOCOL_VERSION = 82;
export const QUERY_TIMEOUT_MS = 30_000;
export const QUERY_REPLY_GRACE_MS = 2_000;
export const PROFILE_ID = "default";
const id = Type.String({ minLength: 1, maxLength: 128 });
const text = Type.String({ maxLength: MAX_TEXT });
const revision = Type.Integer({ minimum: 0 });
const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });

const attachments = Type.Array(AttachmentSchema, { maxItems: 16 });
const sessionId = { sessionId: id };

export const CommandSchema = object({
  id,
  profileId: id,
  command: Type.Union([
    object({ type: Type.Literal("project.add"), path: Type.String({ minLength: 1, maxLength: 4096 }), name: Type.Optional(Type.String({ minLength: 1, maxLength: 80, pattern: "^[A-Za-z0-9_-]+$" })) }),
    object({ type: Type.Literal("session.create"), projectId: Type.Optional(Type.Union([id, Type.Null()])), projectFolderId: Type.Optional(id),
      folderProjects: Type.Optional(Type.Array(object({ projectId: id, revision: Type.Integer({ minimum: 0 }) }), { minItems: 1, maxItems: 1000 })),
      title: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })), overrides: Type.Optional(ControlDefaultsSchema), workspaceId: Type.Optional(id) }),
    object({ type: Type.Literal("session.configure"), ...sessionId, expectedRevision: revision, controls: ControlsSchema, rememberModelSelection: Type.Optional(Type.Literal(true)) }),
    object({ type: Type.Literal("session.autonomy"), ...sessionId, expectedRevision: revision, autonomy: ControlsSchema.properties.autonomy }),
    object({ type: Type.Literal("session.yolo"), ...sessionId, expectedRevision: revision }),
    object({ type: Type.Literal("session.archive"), ...sessionId, expectedRevision: Type.Optional(revision), children: Type.Optional(SessionChildrenReviewSchema) }),
    object({ type: Type.Literal("session.restore"), ...sessionId }),
    object({ type: Type.Literal("session.resume"), ...sessionId }),
    object({ type: Type.Literal("draft.save"), ...sessionId, expectedRevision: revision, text, attachments }),
    object({ type: Type.Literal("draft.paste"), ...sessionId, expectedRevision: revision, text, attachments, pastedText: text,
      start: Type.Integer({ minimum: 0, maximum: MAX_TEXT }), end: Type.Integer({ minimum: 0, maximum: MAX_TEXT }) }),
    object({ type: Type.Literal("attachment.add"), ...sessionId, expectedRevision: revision, path: Type.String({ minLength: 1, maxLength: 4096 }) }),
    object({ type: Type.Literal("message.send"), ...sessionId, expectedRevision: revision, delivery: Type.Union([Type.Literal("queue"), Type.Literal("steer"), Type.Literal("interrupt")]), held: Type.Optional(Type.Boolean()),
      client: Type.Optional(CommandClientSchema),
      continueWorkChoice: Type.Optional(Type.Union([Type.Literal("kanban"), Type.Literal("prompt")])) }),
    object({ type: Type.Literal("queue.edit"), ...sessionId, messageId: id, expectedRevision: revision, text }),
    object({ type: Type.Literal("queue.remove"), ...sessionId, messageId: id, expectedRevision: revision }),
    object({ type: Type.Literal("queue.make-turn"), ...sessionId, messageId: id, expectedRevision: revision }),
    object({ type: Type.Literal("queue.reorder"), ...sessionId, messageIds: Type.Array(id, { maxItems: 100 }), expectedRevision: revision }),
    object({ type: Type.Literal("session.stop"), ...sessionId }),
    object({ type: Type.Literal("approval.respond"), ...sessionId, approvalId: id, allow: Type.Boolean(), remember: Type.Optional(RememberApprovalSchema) }),
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
export type CommandResult = { id?: string; revision?: number; commandClaim?: import("./queued-commands.ts").CommandClaim };

export interface Project { id: string; name: string; path: string }
export const ToolCallSchema = Type.Object({
  id: Type.String(), name: Type.String(), arguments: Type.Record(Type.String(), Type.Unknown()),
  directMcp: Type.Optional(object({ name: Type.String({ pattern: "^mcp_direct_[a-f0-9]{40}$" }), serverId: id,
    tool: Type.String({ minLength: 1, maxLength: 160 }), schemaDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    bindingDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }) })),
  hook: Type.Optional(object({ id, revision, contentDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    trigger: Type.Union([Type.Literal("turn.start"), Type.Literal("turn.end")]), actor: Type.Literal("user-configured-hook") })),
});
export interface ToolCall {
  id: string; name: string; arguments: Record<string, unknown>;
  directMcp?: { name: string; serverId: string; tool: string; schemaDigest: string; bindingDigest: string };
  hook?: { id: string; revision: number; contentDigest: string; trigger: "turn.start" | "turn.end"; actor: "user-configured-hook" };
}
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
export const SideContextSchema = object({
  parentSessionId: id, throughSeq: Type.Integer({ minimum: 0 }), contextDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  inheritedImages: Type.Boolean(), pasteFiles: Type.Array(AttachmentSchema), documents: Type.Array(AttachmentSchema),
});
export interface SideContext {
  parentSessionId: string; throughSeq: number; contextDigest: string; inheritedImages: boolean;
  pasteFiles: Extract<Attachment, { kind: "paste_file" }>[];
  documents: Extract<Attachment, { kind: "document" }>[];
}
export interface Usage {
  stepId: string;
  modelId: string;
  providerId?: string;
  apiModelId?: string;
  source?: "copilot" | "local";
  role: ModelRole;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens?: number | null;
  stream?: ModelStreamObservation | null;
  telemetryDiagnostic?: string | null;
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
  origin?: CoordinationTaskOrigin;
  workflow?: { kind: WorkflowKind };
  sidePromptOrigin?: { sessionId: string; commandDigest: string };
  spawnPromptOrigin?: { sessionId: string; commandDigest: string };
  command?: QueuedSlash;
}
export interface Approval { id: string; stepId: string; call: ToolCall; policyRevision: number; permissionRevision?: number; recommendation?: string; recommendationSource?: ModelAdviceSource }
export interface OwnedProcess { callId: string; pid: number; processGroup: number; turnId: string; stepId?: string; outcome: string; env?: Controls["env"] }
export type SessionStatus = "idle" | "queued" | "running" | "waiting_input" | "stopping" | "completed" | "stopped" | "failed" | "partial" | "archived";
export interface Session {
  id: string;
  projectId: string | null;
  workspaceId: string | null;
  sandboxWorkspaceId?: string | null;
  title: string;
  controls: Controls;
  defaults?: DefaultsSnapshot;
  revision: number;
  status: SessionStatus;
  beforeArchive?: SessionStatus;
  draft: { revision: number; text: string; attachments: Attachment[]; source?: CommandDraftSource };
  queue: QueueItem[];
  queueRevision: number;
  messages: PublicMessage[];
  usage: Usage[];
  processes: OwnedProcess[];
  turnId: string | null;
  pendingApproval: Approval | null;
  pendingQuestionId: string | null;
  lastError: string | null;
  localFinishing: boolean;
  createdAt: string;
  updatedAt: string;
  parentSessionId?: string;
  createdParentSessionId?: string;
  coordinationParentId?: string;
  parentSnapshotDigest?: string;
  readOnly?: boolean;
  mode: SessionMode;
  pendingMode: SessionMode | null;
  kind: SessionKind;
  purpose?: "kanban";
  projectFolderId?: string;
  repositories?: SessionRepository[];
  homeRoot?: SessionHomeRoot;
  pinned: boolean;
  order?: number;
  taskPlan?: TaskPlan;
  unread: boolean;
  groupId: string | null;
  archivedAt: string | null;
  completedAt?: string;
  finishedAt?: string;
  prUrl: string | null;
  prObservation?: SessionPrObservation | null;
  workItemId: string | null;
  workItemUrl?: string | null;
  githubSource?: GithubSessionOrigin;
  browserUrl: string | null;
  suggestionSources?: SuggestionSource[];
  inheritedImages?: boolean;
  sideContext?: SideContext & { turnId: string; capturedAt: string };
  activeCompactionId?: string | null;
}
export interface ModelInfo { id: string; name: string; contextWindow: number; supportedContextWindows?: number[]; imageInput: boolean; toolInput?: boolean; thinkingLevels?: ThinkingEffort[]; providerId?: string; source?: "copilot" | "local"; apiModelId?: string; maxTokens?: number; environments?: Controls["env"][]; synthetic?: boolean; endpointBoundary?: "loopback" | "network" }
export interface ProviderState {
  status: "disconnected" | "connecting" | "connected" | "error";
  models: ModelInfo[];
  login: { code: string; url: string; expiresAt: number } | null;
  diagnostic: string | null;
  connections?: ProviderConnection[];
  catalogue?: ModelCatalogue;
}
export interface Policy { revision: number; allowedEnvs: Controls["env"][] }
export interface Snapshot extends PlatformSnapshot {
  sessionTelemetry: Record<string, SessionTelemetry>;
  protocolVersion: number;
  seq: number;
  profileId: string;
  profile?: Profile;
  profileCatalogRevision?: number;
  globalBudgetPolicy?: GlobalBudgetPolicy;
  globalBudgetSequence?: number;
  routingDiagnostics?: string[];
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
  storeId?: string;
}

export interface EventPayloads extends KnowledgeEventPayloads, GithubEventPayloads, LinearEventPayloads, WorkspaceEventPayloads, KanbanEventPayloads, PricingEventPayloads {
  "slash.command_recorded": { execution: CommandExecution };
  "slash.live_recorded": { control: LiveSlashControl };
  "slash.continuation_chosen": { choice: QueuedContinuationChoice };
  "project.added": { project: Project };
  "session.created": { title: string; controls: Controls; defaults?: DefaultsSnapshot; parentSessionId?: string; coordinationParentId?: string; parentSnapshotDigest?: string; readOnly?: boolean; contextDigest?: string; inheritedImages?: boolean; pasteFiles?: Extract<Attachment, { kind: "paste_file" }>[]; documents?: Extract<Attachment, { kind: "document" }>[]; kind?: SessionKind; purpose?: "kanban"; projectFolderId?: string; repositories?: SessionRepository[]; homeRoot?: SessionHomeRoot; mode?: SessionMode; prUrl?: string | null; workItemId?: string | null; workItemUrl?: string | null; githubSource?: GithubSessionOrigin; suggestionSources?: SuggestionSource[]; workspaceId?: string | null };
  "session.home_bound": { root: SessionHomeRoot };
  "chat.writer_recorded": { writer: ChatWriter };
  "coordination.linked": { link: CoordinationLink };
  "coordination.message": { message: CoordinationMessage };
  "coordination.delivered": { messageId: string; turnId: string; stepId: string };
  "command.inspected": { jobId: string; root: string; actor: "user" };
  "process.ended": { callId: string; pid: number; outcome: "completed" | "stopped" | "failed" | "partial" };
  "session.workspace_bound": { workspaceId: string | null };
  "session.pr_observed": { observation: SessionPrObservation };
  "session.sandbox_bound": { workspaceId: string };
  "sandbox.workspace_recorded": { workspace: SandboxWorkspace };
  "sandbox.execution_recorded": { execution: SandboxExecution };
  "sandbox.frame_recorded": { executionId: string; sequence: number; digest: string };
  "sandbox.publication_recorded": { publication: SandboxPublication };
  "sandbox.setup_recorded": { operation: SandboxSetupOperation };
  "workspace.saved": { workspace: ManagedWorkspace; branchOperation?: { operationId: string; previousBranch: string } };
  "change_set.saved": { changeSet: ChangeSet };
  "question.asked": { question: UserQuestion };
  "question.answered": { questionId: string; answer: QuestionAnswer };
  "question.cancelled": { questionId: string; diagnostic: string };
  "session.configured": { controls: Controls; autonomySelection?: { actor: "user"; commandId: string; commandDigest: string; autonomy: Controls["autonomy"] } };
  "session.continue_work_chosen": { choice: "kanban" | "prompt"; draftRevision: number; actor: "user" };
  "model.selection_remembered": { selection: ModelSelection | null; sourceSessionId: string; sourceProjectId: string | null; actor: "user" };
  "session.archived": Record<string, never>;
  "session.restored": Record<string, never>;
  "session.resumed": { continuation?: { sourceTurnId: string; finishedSequence: number; actor: "user" } };
  "session.blocked": { diagnostic: string };
  "draft.saved": { text: string; attachments: Attachment[]; source?: CommandDraftSource };
  "skill.used": { capabilityId: string; name: string; contentDigest: string; bytes: number; startedAt: string; loadMs: number; actor: "user" };
  "queue.enqueued": { item: QueueItem };
  "queue.edited": { messageId: string; text: string; attachments?: Attachment[]; command?: QueuedSlash | null };
  "queue.removed": { messageId: string };
  "queue.reordered": { messageIds: string[] };
  "queue.delivery_changed": { messageId: string; delivery: "queue" };
  "turn.started": { item: QueueItem; controls: Controls; policyRevision: number; promptDigest?: string; repositoryCapture?: RepositoryCapture; sideContext?: SideContext };
  "turn.control_started":
    | { purpose: "compaction"; compactionId: string; controls: Controls; policyRevision: number; promptDigest: string }
    | { purpose: "candidate.generate"; generationId: string; controls: Controls; policyRevision: number; promptDigest: string }
    | { purpose: "role.sequence"; sequenceId: string; controls: Controls; policyRevision: number; promptDigest: string }
    | { purpose: "compound.workflow"; workflowId: string; controls: Controls; policyRevision: number; promptDigest: string }
    | { purpose: "plan.save"; saveId: string; controls: Controls; policyRevision: number; intentDigest: string };
  "plan.save_recorded": { save: RemotePlanSave };
  "compaction.saved": { compaction: ContextCompaction };
  "context.changed": { activeCompactionId: string | null; actor: "user"; sourceDigest: string };
  "steer.applied": { item: QueueItem };
  "steering.applied": { decisionId: string; modelId: string; providerId: string; sourceStepId: string; text: string; decisionOrigin: DecisionEvidence };
  "model.started": { modelId: string; providerId?: string; apiModelId?: string; source?: "copilot" | "local"; contextWindow?: number; contextEstimate?: number; thinkingEffort?: ThinkingEffort; role?: ModelRole; kupoPhase?: KupoResponsePhase };
  "routing.started": { routing: RoutingTurn };
  "routing.planned": { routingId: string; classifierStepId: string | null; plan: RoutingPlan };
  "routing.finished": { routingId: string; status: "completed" | "stopped" | "failed" | "partial"; diagnostic: string | null };
  "routing.response_selected": { routingId: string; sourceStepId: string; reviewStepId: string; contextDigest: string };
  "assistant.delta": { text: string };
  "model.completed": { message: PublicMessage; contextDigest: string; usage: Usage; candidateGenerationId?: string; kupo?: KupoObservation };
  "model.late_usage": { usage: Usage; executionId: string; sequence: number };
  "execution.started": { execution: RemoteExecution };
  "execution.changed": { executionId: string; status: RemoteExecution["status"]; cancellation: RemoteExecution["cancellation"]; cleanup: RemoteExecution["cleanup"]; diagnostic: string | null; workerPid?: number };
  "execution.frame_recorded": { executionId: string; sequence: number; digest: string };
  "tool.requested": { approval: Approval };
  "tool.decided": { approvalId: string; allow: boolean; actor: "user" | "policy" | "delegation" | "autonomy" | "decision-provider"; ruleId?: string; decisionId?: string; decisionOrigin?: DecisionEvidence };
  "tool.started": { call: ToolCall };
  "tool.output": { callId: string; text: string };
  "process.started": { callId: string; pid: number; processGroup: number; env?: Controls["env"] };
  "tool.completed": { call: ToolCall; text: string; isError: boolean; outcome: string; rawDigest?: string; rawComplete?: boolean };
  "task.progress_reported": { report: TaskProgressReport };
  "task.plan_updated": { plan: TaskPlan };
  "turn.stop_requested": { holdQueue?: true };
  "turn.stop_acknowledged": Record<string, never>;
  "turn.finished": { outcome: "completed" | "stopped" | "failed" | "partial"; diagnostic: string | null; workspaceEffects?: "none" | "possible" };
  "policy.updated": { policy: Policy; finishingTurnIds: string[] };
  "provider.changed": { status: ProviderState["status"]; diagnostic: string | null };
  "mcp.oauth_changed": { authorization: McpAuthorization };
  "configuration.proposed": { proposal: ConfigurationProposal };
  "configuration.decided": { proposalId: string; approve: boolean; actor: "user" };
  "attention.raised": { attention: Attention };
  "attention.acknowledged": { attentionIds: string[] };
  "attention.cleared": { attentionIds: string[] };
  "settings.updated": { settings: UserSettings; revision: number; permissionRevision: number };
  "application.configured": ApplicationConfiguration;
  "application.storage_recorded": { operation: StorageMove };
  "application.update_recorded": { update: ApplicationUpdate };
  "notification.sound_saved": { sound: NotificationSound };
  "notification.sound_removed": { id: string; commandId: string };
  "capability.saved": { entry: CapabilityEntry };
  "capability.proposed": { proposal: Proposal };
  "proposal.decided": { proposalId: string; approve: boolean; actor: "user" };
  "job.started": { job: CapabilityJob };
  "job.progress": { jobId: string; progress: string; status?: "running"; candidateId?: string; sandboxPublicationId?: string; compoundWorkflowId?: string; winddownId?: string; operationId?: string };
  "job.finished": { jobId: string; status: CapabilityJob["status"]; resultDigest: string | null; error: string | null; candidateId?: string; sandboxPublicationId?: string; compoundWorkflowId?: string; winddownId?: string; operationId?: string };
  "board.saved": { board: IssueBoard };
  "issue.saved": { issue: LocalIssue; actor: "user" | "github" | "linear" };
  "cache.prepared": { receipt: CacheReceipt };
  "session.organized": { changes: SessionChanges & { order?: number } };
  "session.mode_requested": { mode: SessionMode };
  "session.mode_changed": { mode: SessionMode };
  "session.browser_changed": { url: string };
  "session.deleted": { deletedSessionId: string; usage: Usage[] };
  "project.removed": { deletedProjectId: string; usage: Usage[]; artifactChoice?: ProjectArtifactChoice["action"] };
  "project.relocated": { path: string; name: string };
  "project.configured": { configuration: ProjectConfiguration };
  "project.folder_saved": { folder: NavigationFolder };
  "project.folder_removed": { folderId: string; expectedRevision: number };
  "session.group_saved": { group: SessionGroup };
  "artifact.saved": { artifact: LegacyRetainedArtifact };
  "artifact.revised": { artifact: LegacyVersionedArtifact };
  "artifact.deleted": { artifactId: string; candidateIntents?: { commandId: string; commandDigest: string }[]; generationIntent?: { commandId: string; commandDigest: string }; roleSequenceIntent?: { commandId: string; commandDigest: string }; compoundIntent?: { commandId: string; commandDigest: string }; decisionIntent?: { sessionId: string; turnId: string; sourceDigest: string } };
  "candidate.saved": { candidate: CandidateRecord };
  "candidate.generation_recorded": { generation: CandidateGenerationRecord };
  "candidate.owner_bound": { owner: CandidateOwner };
  "candidate.cleanup_recorded": { cleanup: CandidateCleanup };
  "candidate.usage_retained": { generationId: string; sessionId: string; usage: Usage };
  "role.sequence_recorded": { sequence: RoleSequenceRecord };
  "compound.recorded": { workflow: CompoundWorkflow };
  "winddown.recorded": { winddown: WinddownRecord };
  "decision.recorded": { decision: DecisionRecord };
  "budget.recorded": { entry: BudgetEntry };
  "budget.plan_recorded": { plan: BudgetPlan };
  "operation.recorded": { entry: OperationEntry };
  "operation.coverage_started": { version: 1; priorHistory: "retained-events-only" };
  "repository.recorded": { observation: RepositoryObservation };
  "budget.policy_changed": { limit: BudgetLimit | null; revision: number };
  "budget.blocked": { sessionId: string; ownerSessionId: string; stepId: string; diagnostic: string; remainingTokens: number | null; remainingUsd: number | null };
  "profile.saved": { profile: Profile };
  "global.controls_changed": GlobalPreferences;
  "global.policy_changed": { policy: Policy };
  "global.budget_changed": GlobalBudgetPolicy;
  "terminal.changed": { terminal: TerminalState };
  "terminal.owner_changed": { owner: TerminalOwner };
  "mcp.remote_recorded": { call: RemoteMcpCall };
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
  "coordination.linked", "coordination.message", "coordination.delivered", "command.inspected", "process.ended",
  "project.added", "session.created", "session.home_bound", "chat.writer_recorded", "slash.command_recorded", "slash.live_recorded", "slash.continuation_chosen", "session.configured", "session.continue_work_chosen", "model.selection_remembered", "session.pr_observed", "session.archived", "session.restored", "session.resumed", "session.blocked",
  "draft.saved", "skill.used", "queue.enqueued", "queue.edited", "queue.removed", "queue.reordered", "queue.delivery_changed", "turn.started",
  "steer.applied", "steering.applied", "model.started", "assistant.delta", "model.completed", "tool.requested", "tool.decided",
  "tool.started", "tool.output", "process.started", "tool.completed", "turn.stop_requested", "turn.stop_acknowledged",
  "turn.finished", "task.progress_reported", "task.plan_updated", "policy.updated", "provider.changed", "mcp.oauth_changed",
  "settings.updated", "application.configured", "application.storage_recorded", "application.update_recorded", "notification.sound_saved", "notification.sound_removed", "capability.saved", "capability.proposed", "proposal.decided", "job.started", "job.progress", "job.finished",
  "board.saved", "issue.saved", "cache.prepared",
  "session.organized", "session.mode_requested", "session.mode_changed", "session.browser_changed", "session.deleted", "project.removed",
  "project.relocated", "project.configured", "project.folder_saved", "project.folder_removed", "session.group_saved", "artifact.saved", "terminal.changed", "terminal.owner_changed", "turn.prompt_bound", "queue.released", "queue.held",
  "configuration.proposed", "configuration.decided", "attention.raised", "attention.acknowledged", "attention.cleared",
  "model.late_usage", "execution.started", "execution.changed", "execution.frame_recorded",
  "session.sandbox_bound", "sandbox.workspace_recorded", "sandbox.execution_recorded", "sandbox.frame_recorded", "sandbox.publication_recorded", "sandbox.setup_recorded",
  "workspace.saved", "change_set.saved", "session.workspace_bound", "artifact.revised", "artifact.deleted", "question.asked", "question.answered", "question.cancelled",
  "budget.recorded", "budget.plan_recorded", "budget.policy_changed", "budget.blocked", "operation.recorded", "operation.coverage_started",
  "profile.saved", "global.controls_changed", "global.policy_changed", "global.budget_changed",
  "routing.started", "routing.planned", "routing.finished", "routing.response_selected",
  "turn.control_started", "compaction.saved", "context.changed", "plan.save_recorded", "repository.recorded", "mcp.remote_recorded",
  "candidate.saved", "candidate.generation_recorded", "candidate.owner_bound", "candidate.cleanup_recorded", "candidate.usage_retained", "role.sequence_recorded", "compound.recorded", "winddown.recorded", "decision.recorded",
  "knowledge.saved", "knowledge.forgotten",
  "github.operation_recorded", "linear.operation_recorded", "cache.registry.saved", "cache.registry.removed",
  "project.work_recorded",
  "pricing.catalog_recorded",
];

export function projectEvents(events: StoredEvent[], profileId: string = PROFILE_ID): { projects: Project[]; sessions: Session[]; policy: Policy; blockedProjects: string[]; blockedSessions: string[]; blockedWorkspaces: string[] } & PlatformSnapshot {
  const projects = new Map<string, Project>();
  const sessions = new Map<string, Session>();
  let nextSessionOrder = 0;
  let lastModelSelection: ModelSelection | null = null;
  let policy: Policy = { revision: 0, allowedEnvs: ["Local", "Sandbox", "Remote"] };
  const blockedProjects = new Set<string>();
  const blockedSessions = new Set<string>();
  const blockedWorkspaces = new Set<string>();
  const chatWriters = new Map<string, ChatWriter>();
  let settings: PlatformSnapshot["settings"] = { revision: 0, permissionRevision: 0, values: defaultSettings(), defaults: defaultSettings() };
  const registry = new Map<string, CapabilityEntry>();
  const proposals = new Map<string, Proposal>();
  const knowledge = new Map<string, KnowledgeRecord>();
  const coordinationLinks = new Map<string, CoordinationLink>();
  const coordinationMessages = new Map<string, CoordinationMessage>();
  const githubOperations = new Map<string, GithubOperation>();
  const projectWorkRuns = new Map<string, ProjectWorkRun>();
  let providerPriceCatalogs: ProviderPriceCatalog[] = [], providerPriceRevision = 0;
  const linearOperations = new Map<string, LinearOperation>();
  const dependencyRegistries = new Map<string, DependencyRegistry>();
  const jobs = new Map<string, CapabilityJob>();
  const commandExecutions = new Map<string, CommandExecution>();
  const liveControls = new Map<string, { sessionId: string; control: LiveSlashControl }>();
  const continuationChoices = new Set<string>();
  const oauthAuthorizations = new Map<string, McpAuthorization>();
  const configurationProposals = new Map<string, ConfigurationProposal>();
  const attention = new Map<string, Attention>();
  const notificationSounds = new Map<string, NotificationSound>();
  const boards = new Map<string, IssueBoard>();
  const issues = new Map<string, LocalIssue>();
  const dependencyCaches = new Map<string, CacheReceipt>();
  const projectConfigurations = new Map<string, ProjectConfiguration>();
  const projectFolders = new Map<string, NavigationFolder>();
  const sessionGroups = new Map<string, SessionGroup>();
  const artifacts = new Map<string, RetainedArtifact>();
  const candidates = new Map<string, CandidateRecord>();
  const questions = new Map<string, UserQuestion>();
  const routings = new Map<string, RoutingTurn>();
  const kupoResults = new Map<string, Extract<StoredEvent, { event_type: "model.completed" }>>();
  const compactions = new Map<string, ContextCompaction>();
  const planSaves = new Map<string, RemotePlanSave>();
  const budgetEntries = new Map<string, BudgetEntry>();
  const budgetPlans = new Map<string, BudgetPlan>();
  const candidateGenerations = new Map<string, CandidateGenerationRecord>();
  const candidateCleanups = new Map<string, CandidateCleanup>();
  const roleSequences = new Map<string, RoleSequenceRecord>();
  const compoundWorkflows = new Map<string, CompoundWorkflow>();
  const winddowns = new Map<string, WinddownRecord>();
  const decisions = new Map<string, DecisionRecord>();
  const roleSequenceControls = new Map<string, StoredEvent[]>(), roleSequenceTurns = new Set<string>();
  for (const event of events) if (event.profile_id === profileId && event.event_type === "turn.control_started" && (event.payload.purpose === "role.sequence" || event.payload.purpose === "compound.workflow")) {
    const id = event.payload.purpose === "role.sequence" ? event.payload.sequenceId : event.payload.workflowId;
    roleSequenceControls.set(id, [...roleSequenceControls.get(id) ?? [], event]);
    if (typeof event.turn_id === "string") roleSequenceTurns.add(event.turn_id);
  }
  const operationEntries = new Map<string, OperationEntry>();
  let operationCoverage: OperationCoverage | null = null;
  const repositoryObservations = new Map<string, RepositoryObservation>();
  let budgetPolicy: PlatformSnapshot["budgetPolicy"] = { revision: 0, limit: null };
  const terminals = new Map<string, TerminalState>();
  const terminalOwners = new Map<string, TerminalOwner>();
  const remoteMcpCalls = new Map<string, RemoteMcpCall>();
  const executions = new Map<string, RemoteExecution>();
  const sandboxWorkspaces = new Map<string, SandboxWorkspace>();
  const sandboxExecutions = new Map<string, SandboxExecution>();
  const sandboxPublications = new Map<string, SandboxPublication>();
  const managedWorkspaces = new Map<string, ManagedWorkspace>();
  const changeSets = new Map<string, ChangeSet>();
  const removedModelSources = new Set<string>(), removedModelProjects = new Set<string>();
  for (const event of events) if (event.profile_id === profileId) {
    if (event.event_type === "session.deleted") removedModelSources.add(event.payload.deletedSessionId);
    if (event.event_type === "project.removed") removedModelProjects.add(event.payload.deletedProjectId);
  }
  for (const event of events) {
    if (event.profile_id !== profileId) continue;
    if (event.event_type === "candidate.cleanup_recorded") {
      const cleanup = projectCandidateCleanup(candidateCleanups.get(event.payload.cleanup.id), event.payload.cleanup);
      if (event.project_id || event.session_id || event.turn_id || event.step_id || event.artifact_id || cleanup.profileId !== profileId) {
        throw new MoguriError("candidate_retention_corrupt", "Candidate cleanup must remain in its exact profile-owned recovery compartment.", 409);
      }
      candidateCleanups.set(cleanup.id, cleanup);
      for (const root of cleanup.quarantinedRoots) {
        if (root.workspaceId) blockedWorkspaces.add(root.workspaceId); else blockedProjects.add(root.projectId);
      }
    }
    if (event.event_type === "model.selection_remembered") {
      const selection = event.payload.selection, source = sessions.get(event.payload.sourceSessionId);
      const actual = source ? modelSelection(source.controls) : undefined;
      const retainedSource = removedModelSources.has(event.payload.sourceSessionId) ||
        event.payload.sourceProjectId !== null && removedModelProjects.has(event.payload.sourceProjectId);
      if (event.project_id !== null || event.session_id !== null || event.turn_id !== null || event.artifact_id != null || event.payload.actor !== "user" ||
        typeof event.payload.sourceSessionId !== "string" || !event.payload.sourceSessionId || event.payload.sourceSessionId.length > 128 ||
        event.payload.sourceProjectId !== null && typeof event.payload.sourceProjectId !== "string" ||
        !source && !retainedSource || source && source.projectId !== event.payload.sourceProjectId ||
        selection !== null && !Value.Check(ModelSelectionSchema, selection) ||
        source && (selection?.modelId !== actual?.modelId || selection?.thinkingEffort !== actual?.thinkingEffort ||
          selection?.preferredThinkingEffort !== actual?.preferredThinkingEffort)) {
        throw new MoguriError("model_preference_corrupt", "Remembered model selection lost its exact profile/user/source controls. No inferred choice or model fallback was used.", 409);
      }
      lastModelSelection = selection ? structuredClone(selection) : null;
      continue;
    }
    if (event.event_type === "knowledge.saved") {
      const record = event.payload.record;
      if (record.profileId !== profileId || event.artifact_id !== `knowledge/${record.id}` || record.projectId !== (event.project_id ?? null) || record.sessionId !== (event.session_id ?? null)) throw new MoguriError("knowledge_corrupt", "Knowledge event scope disagrees with its original owner.", 409);
      knowledge.set(record.id, projectKnowledge(knowledge.get(record.id), record));
    }
    if (event.event_type === "knowledge.forgotten") knowledge.delete(event.payload.id);
    if (event.event_type === "github.operation_recorded") {
      const operation = event.payload.operation;
      if (operation.profileId !== profileId || operation.projectId !== event.project_id || (event.session_id ?? null) !== operation.originSessionId || event.artifact_id !== operation.id) throw new MoguriError("github_corrupt", "Git/GitHub operation lost its exact independent profile/root retention owner.", 409);
      githubOperations.set(operation.id, projectGithubOperation(githubOperations.get(operation.id), operation));
    }
    if (event.event_type === "project.work_recorded") {
      const run = event.payload.run;
      if (run.profileId !== profileId || event.project_id !== run.projectId || event.session_id || event.artifact_id !== `project-work/${run.id}`) {
        throw new MoguriError("project_work_corrupt", "Project work lost its independent profile/source retention owner.", 409);
      }
      projectWorkRuns.set(run.id, projectWorkRecord(projectWorkRuns.get(run.id), run));
    }
    if (event.event_type === "pricing.catalog_recorded") {
      const next = event.payload;
      if (event.project_id || event.session_id || event.artifact_id || next.actor !== "user" || next.revision !== providerPriceRevision + 1 ||
        !Value.Check(Type.Array(ProviderPriceCatalogSchema, { minItems: 1, maxItems: 4 }), next.catalogs) ||
        new Set(next.catalogs.map((catalog) => catalog.provider)).size !== next.catalogs.length ||
        next.catalogs.some((catalog) => catalog.sourceUrl !== PROVIDER_PRICE_SOURCES[catalog.provider] ||
          !Number.isFinite(Date.parse(catalog.observedAt)) || new Set(catalog.prices.map((price) => price.modelId)).size !== catalog.prices.length)) {
        throw new MoguriError("pricing_corrupt", "Provider prices lost their exact official source, date or revision. Historical rates were preserved.", 409);
      }
      providerPriceCatalogs = structuredClone(next.catalogs); providerPriceRevision = next.revision;
    }
    if (event.event_type === "linear.operation_recorded") {
      const operation = event.payload.operation;
      if (operation.profileId !== profileId || operation.projectId !== event.project_id || (event.session_id ?? null) !== operation.sessionId || event.artifact_id !== operation.id) throw new MoguriError("linear_corrupt", "Linear operation lost its independent profile/workspace retention owner.", 409);
      linearOperations.set(operation.id, projectLinearOperation(linearOperations.get(operation.id), operation));
    }
    if (event.event_type === "cache.registry.saved") {
      const registry = event.payload.registry, previous = dependencyRegistries.get(registry.id);
      if (registry.profileId !== profileId || !registry.id || registry.revision !== (previous ? previous.revision + 1 : 0) ||
        !registry.credentialRevision || previous && previous.profileId !== registry.profileId) throw new MoguriError("cache_registry_corrupt", "Registry configuration changed its exact profile or revision. No credential or archive was adopted.", 409);
      dependencyRegistries.set(registry.id, structuredClone(registry));
    }
    if (event.event_type === "cache.registry.removed") dependencyRegistries.delete(event.payload.registryId);
    if (event.event_type === "mcp.remote_recorded") {
      const call = event.payload.call;
      if (!Value.Check(RemoteMcpCallSchema, call) || call.profileId !== profileId || call.sessionId !== event.session_id ||
        call.projectId !== event.project_id || call.turnId !== event.turn_id || call.stepId !== event.step_id) throw new MoguriError("remote_mcp_corrupt", "Remote MCP intent/result metadata is invalid or outside its exact owning scope. State was preserved.", 409);
      const previous = remoteMcpCalls.get(call.id);
      const immutable: readonly (keyof RemoteMcpCall)[] = ["id", "profileId", "sessionId", "projectId", "turnId", "stepId", "callId", "actor",
        "commandId", "commandDigest", "env", "root", "hostFingerprint", "peerDigest", "resourceDigest", "scopeDigest", "helperDigest", "serverId", "tool", "argumentsDigest", "intentDigest", "createdAt"];
      if (!previous && (call.revision !== 0 || call.phase !== "intent" || call.resultDigest !== null || call.accessForwarded !== false) ||
        previous && (call.revision !== previous.revision + 1 || immutable.some((key) => call[key] !== previous[key]) ||
          previous.resultDigest !== null && call.resultDigest !== previous.resultDigest ||
          previous.executionId !== null && call.executionId !== previous.executionId ||
          previous.jobId !== null && call.jobId !== previous.jobId || previous.accessForwarded && !call.accessForwarded)) {
        throw new MoguriError("remote_mcp_corrupt", "Remote MCP revision, original scope or retained result changed. No effect or result was adopted.", 409);
      }
      remoteMcpCalls.set(call.id, structuredClone(call));
    }
    if (event.event_type === "terminal.owner_changed") {
      if (event.project_id || event.session_id || !Value.Check(TerminalOwnerSchema, event.payload.owner) || event.payload.owner.profileId !== profileId) throw new MoguriError("terminal_owner_corrupt", "Terminal owner metadata is invalid or outside its independent profile. State was preserved.", 409);
      const owner = event.payload.owner, previous = terminalOwners.get(owner.id);
      if (previous && (["profileId", "protocol", "buildDigest", "scopeDigest", "createdAt", "env"].some((key) =>
        previous[key as keyof TerminalOwner] !== owner[key as keyof TerminalOwner]) || JSON.stringify(previous.remote) !== JSON.stringify(owner.remote) ||
        previous.directory !== null && previous.directory !== owner.directory || previous.endpoint !== null && previous.endpoint !== owner.endpoint ||
        previous.pid !== null && previous.pid !== owner.pid || previous.cleanup === "removed" && owner.cleanup !== "removed")) {
        throw new MoguriError("terminal_owner_corrupt", "Original terminal owner peer/build/path/PID or removed cleanup identity changed. No process or endpoint was adopted.", 409);
      }
      terminalOwners.set(owner.id, structuredClone(owner));
    }
    if (event.event_type === "repository.recorded") {
      if (event.project_id || event.session_id || event.turn_id || event.step_id || !Value.Check(RepositoryObservationSchema, event.payload.observation) || event.payload.observation.profileId !== profileId) throw new MoguriError("repository_corrupt", "Repository observation is invalid or outside its independent owning profile. State was preserved.", 409);
      const observation = event.payload.observation;
      if (observation.remote && observation.env !== "Remote" ||
        observation.lookupBoundary === "remote-gh-cli" && (observation.env !== "Remote" || observation.access !== "gh-cli" || !observation.remote) ||
        observation.access === "public" && observation.lookupBoundary !== "control-plane-public" ||
        observation.access === "gh-cli" && observation.lookupBoundary !== (observation.env === "Remote" ? "remote-gh-cli" : "control-plane-gh-cli")) {
        throw new MoguriError("repository_corrupt", "Repository access, execution host and retained lookup boundary disagree. No alternate account was adopted.", 409);
      }
      repositoryObservations.set(event.payload.observation.scopeKey, structuredClone(event.payload.observation));
    }
    if (event.event_type === "operation.recorded") {
      if (event.project_id || event.session_id || event.turn_id || event.step_id || !Value.Check(OperationEntrySchema, event.payload.entry) || event.payload.entry.profileId !== profileId) throw new MoguriError("telemetry_corrupt", "A retained operation entry is invalid, not profile-root retained or outside its owning profile. State was preserved.", 409);
      operationEntries.set(event.payload.entry.id, structuredClone(event.payload.entry));
    }
    if (event.event_type === "operation.coverage_started") {
      if (event.project_id || event.session_id || event.turn_id || event.step_id || event.payload.version !== 1 || event.payload.priorHistory !== "retained-events-only") throw new MoguriError("telemetry_corrupt", "Unsupported or non-root operation coverage metadata. State was preserved.", 409);
      operationCoverage ??= { ...event.payload, since: event.timestamp, sourceSeq: event.seq };
    }
    if (event.event_type === "budget.recorded") {
      const entry = event.payload.entry, previous = budgetEntries.get(entry.id), path = entry.scopePath;
      if (path && (path.length < 1 || path.length > 8 || new Set(path).size !== path.length || path[0] !== entry.sessionId || path.at(-1) !== entry.ownerSessionId) ||
        previous && JSON.stringify(previous.scopePath) !== JSON.stringify(path)) throw new MoguriError("budget_owner", "An accounting update changed or lost its original coordination capacity path.", 409);
      budgetEntries.set(entry.id, structuredClone(entry));
    }
    if (event.event_type === "candidate.usage_retained") {
      const { usage, sessionId, generationId } = event.payload, entry = budgetEntries.get(usage.stepId);
      if (event.project_id || event.session_id || event.turn_id || event.step_id || event.artifact_id ||
        !entry || entry.sessionId !== sessionId || entry.turnId !== generationId || entry.modelId !== usage.modelId ||
        entry.role !== "draft" || usage.role !== "draft" || usage.quality === "provider-reported" && entry.reportedTokens !== usage.totalTokens) {
        throw new MoguriError("candidate_retention_corrupt", "Retained usage lost its exact original candidate model/accounting owner. No proposal or charge was invented.", 409);
      }
      const session = sessions.get(sessionId), index = session?.usage.findIndex((value) => value.stepId === usage.stepId);
      if (session && index !== undefined && index >= 0) session.usage[index] = structuredClone(usage);
      const messageIndex = session?.messages.findIndex((message) => message.id === usage.stepId && message.role === "notice");
      if (session && messageIndex !== undefined && messageIndex >= 0) session.messages[messageIndex] = { ...session.messages[messageIndex]!,
        text: "Candidate proposal permanently deleted. Original model usage remains in accounting; no work was replayed.", outcome: "deleted" };
    }
    if (event.event_type === "budget.plan_recorded") {
      if (event.project_id || event.session_id || event.turn_id || event.step_id || !Value.Check(BudgetPlanSchema, event.payload.plan) || event.payload.plan.profileId !== profileId) throw new MoguriError("budget_plan_corrupt", "Planned accounting must remain independently retained in its exact profile. State was preserved.", 409);
      const plan = projectBudgetPlan(budgetPlans.get(event.payload.plan.id), event.payload.plan);
      budgetPlans.set(plan.id, plan);
    }
    if (event.event_type === "budget.policy_changed") budgetPolicy = structuredClone(event.payload);
    if (event.event_type === "compaction.saved") compactions.set(event.payload.compaction.id, structuredClone(event.payload.compaction));
    if (event.event_type === "plan.save_recorded") planSaves.set(event.payload.save.id, structuredClone(event.payload.save));
    if (event.event_type === "routing.started") routings.set(event.payload.routing.id, structuredClone(event.payload.routing));
    if (event.event_type === "routing.planned") {
      const routing = routings.get(event.payload.routingId);
      if (routing) Object.assign(routing, { status: "ready", classifierStepId: event.payload.classifierStepId, plan: structuredClone(event.payload.plan) });
    }
    if (event.event_type === "routing.finished") {
      const routing = routings.get(event.payload.routingId);
      if (routing) Object.assign(routing, { status: event.payload.status, diagnostic: event.payload.diagnostic });
    }
    if (event.event_type === "model.completed" && event.payload.kupo) kupoResults.set(event.payload.usage.stepId, event);
    if (event.event_type === "session.deleted") {
      sessions.delete(event.payload.deletedSessionId);
      blockedSessions.delete(event.payload.deletedSessionId);
      for (const [id, terminal] of terminals) if (terminal.sessionId === event.payload.deletedSessionId) terminals.delete(id);
      for (const [id, entry] of attention) if (entry.sessionId === event.payload.deletedSessionId) attention.delete(id);
      for (const [id, execution] of executions) if (execution.sessionId === event.payload.deletedSessionId) executions.delete(id);
      for (const [id, question] of questions) if (question.sessionId === event.payload.deletedSessionId) questions.delete(id);
      for (const [id, routing] of routings) if (routing.sessionId === event.payload.deletedSessionId) routings.delete(id);
      for (const [id, compaction] of compactions) if (compaction.sessionId === event.payload.deletedSessionId) compactions.delete(id);
      for (const [id, save] of planSaves) if (save.sessionId === event.payload.deletedSessionId) planSaves.delete(id);
      for (const [id, call] of remoteMcpCalls) if (call.sessionId === event.payload.deletedSessionId) remoteMcpCalls.delete(id);
      for (const [id, workspace] of sandboxWorkspaces) if (workspace.sessionId === event.payload.deletedSessionId) sandboxWorkspaces.delete(id);
      for (const [id, execution] of commandExecutions) if (execution.sessionId === event.payload.deletedSessionId) commandExecutions.delete(id);
    }
    if (event.event_type === "project.removed") {
      projects.delete(event.payload.deletedProjectId);
      projectConfigurations.delete(event.payload.deletedProjectId);
      for (const [id, session] of sessions) if (session.projectId === event.payload.deletedProjectId) sessions.delete(id);
      for (const map of [boards, issues, dependencyCaches, sessionGroups, artifacts, terminals, configurationProposals, attention, oauthAuthorizations, executions, managedWorkspaces, changeSets, questions, routings, compactions, planSaves, remoteMcpCalls, sandboxWorkspaces]) for (const [id, value] of map) if (value.projectId === event.payload.deletedProjectId) map.delete(id);
      for (const [id, execution] of commandExecutions) if (execution.projectId === event.payload.deletedProjectId) commandExecutions.delete(id);
    }
    if (event.event_type === "slash.live_recorded") {
      const control = event.payload.control, previous = liveControls.get(control.id);
      if (!Value.Check(LiveSlashControlSchema, control) || !event.session_id || !sessions.has(event.session_id) ||
        control.phase === "intent" && previous || control.phase !== "intent" && (!previous || previous.sessionId !== event.session_id ||
          previous.control.phase !== "intent" || JSON.stringify([previous.control.action, previous.control.actor, previous.control.inputDigest, previous.control.targetTurnId, previous.control.approvalId]) !==
          JSON.stringify([control.action, control.actor, control.inputDigest, control.targetTurnId, control.approvalId]))) {
        throw new MoguriError("live_control_history", "Live control history lost its original actual-user intent or completion target. Nothing was replayed.", 409);
      }
      liveControls.set(control.id, { sessionId: event.session_id, control: structuredClone(control) });
    }
    if (event.event_type === "slash.continuation_chosen") {
      const choice = event.payload.choice, execution = commandExecutions.get(choice.executionId);
      if (!Value.Check(QueuedContinuationChoiceSchema, choice) || !execution || execution.name !== "continue-work" || execution.status !== "claimed" ||
        execution.stopRequested || execution.inputDigest !== choice.inputDigest || execution.bindingDigest !== choice.bindingDigest ||
        execution.profileId !== event.profile_id || execution.projectId !== event.project_id || execution.sessionId !== event.session_id ||
        !execution.projectId || !sessions.has(execution.sessionId) || continuationChoices.has(execution.id)) {
        throw new MoguriError("command_choice_history", "Queued continuation lost its exact original user, claim or input. No choice or delegation was reconstructed.", 409);
      }
      continuationChoices.add(execution.id);
    }
    if (event.event_type === "slash.command_recorded") {
      const next = event.payload.execution, previous = commandExecutions.get(next.id), owner = sessions.get(next.sessionId);
      if (!owner || next.profileId !== event.profile_id || next.sessionId !== event.session_id || next.projectId !== event.project_id) {
        throw new MoguriError("command_history", "Queued command history is outside its original owning profile/session/project.", 409);
      }
      if (!previous) {
        const head = owner.queue.find((item) => item.delivery !== "steer" && !item.held), parsed = head && parseSlashInput(head.text);
        if (!head?.command || head.origin || head.workflow || head.sidePromptOrigin || head.spawnPromptOrigin || head.mode || head.id !== next.queueItemId ||
          head.command.actor !== "user" || head.command.name !== next.name || head.command.client !== next.client ||
          head.command.bindingDigest !== next.bindingDigest || !parsed || parsed.name !== next.name || parsed.argument !== head.command.argument) {
          throw new MoguriError("command_history", "Queued command claim lost its exact ordered user input. No model prompt or authority was substituted.", 409);
        }
        owner.queue = owner.queue.filter((item) => item.id !== head.id); owner.queueRevision++;
      }
      commandExecutions.set(next.id, projectCommandExecution(previous, next));
      if (!owner.turnId && ["failed", "partial", "cancelled"].includes(next.status)) {
        owner.status = "waiting_input";
        if (next.diagnostic) owner.lastError = next.diagnostic;
      }
    }
    if (event.event_type === "project.configured") projectConfigurations.set(event.payload.configuration.projectId, { ...structuredClone(event.payload.configuration), values: { ...defaultProjectSettings(), ...structuredClone(event.payload.configuration.values) } });
    if (event.event_type === "mcp.oauth_changed") oauthAuthorizations.set(event.payload.authorization.id, { ...event.payload.authorization });
    if (event.event_type === "configuration.proposed") configurationProposals.set(event.payload.proposal.id, { ...event.payload.proposal });
    if (event.event_type === "configuration.decided") { const proposal = configurationProposals.get(event.payload.proposalId); if (proposal) proposal.status = event.payload.approve ? "applied" : "rejected"; }
    if (event.event_type === "attention.raised") attention.set(event.payload.attention.id, { ...event.payload.attention });
    if (event.event_type === "attention.acknowledged") for (const id of event.payload.attentionIds) { const entry = attention.get(id); if (entry) entry.acknowledged = true; }
    if (event.event_type === "attention.cleared") for (const id of event.payload.attentionIds) { const entry = attention.get(id); if (entry) entry.active = false; }
    if (event.event_type === "project.folder_saved") projectFolders.set(event.payload.folder.id, { ...event.payload.folder });
    if (event.event_type === "project.folder_removed") {
      const folder = projectFolders.get(event.payload.folderId);
      if (!folder || folder.revision !== event.payload.expectedRevision || [...projectConfigurations.values()].some((configuration) => configuration.folderId === folder.id)) {
        throw new Error("Invalid retained project-folder removal. Original state was preserved.");
      }
      projectFolders.delete(folder.id);
    }
    if (event.event_type === "session.group_saved") sessionGroups.set(event.payload.group.id, { ...event.payload.group });
    if (event.event_type === "artifact.saved" || event.event_type === "artifact.revised") {
      const artifact = event.event_type === "artifact.saved" ? legacyArtifact(event.payload.artifact, event.id) : normalizeArtifact(structuredClone(event.payload.artifact));
      const candidate = candidates.get(artifact.id);
      if (candidate && (artifact.kind !== "report" || artifact.contentDigest !== candidate.documentDigest)) throw new MoguriError("candidate_corrupt", "A bound candidate artifact cannot replace its immutable proposal document.", 409);
      const sequence = roleSequences.get(artifact.id);
      if (sequence && (artifact.kind !== "report" || artifact.contentDigest !== sequence.inputDigest)) throw new MoguriError("role_sequence_corrupt", "A retained role input cannot be replaced through generic artifact editing.", 409);
      const compound = compoundWorkflows.get(artifact.id);
      if (compound && (artifact.kind !== "report" || artifact.contentDigest !== compound.inputDigest)) throw new MoguriError("compound_corrupt", "A retained public workflow cannot replace its original reviewed input.", 409);
      const winddown = winddowns.get(artifact.id);
      if (winddown && (artifact.kind !== "report" || artifact.contentDigest !== winddown.inputDigest)) throw new MoguriError("winddown_corrupt", "A budget checkpoint cannot replace its original retained input.", 409);
      const decision = decisions.get(artifact.id);
      if (decision && (artifact.kind !== "report" || artifact.contentDigest !== decision.inputDigest)) throw new MoguriError("decision_corrupt", "Original typed decision input/provenance cannot be replaced through artifact metadata.", 409);
      artifacts.set(artifact.id, artifact);
    }
    if (event.event_type === "artifact.deleted") { artifacts.delete(event.payload.artifactId); candidates.delete(event.payload.artifactId); roleSequences.delete(event.payload.artifactId); compoundWorkflows.delete(event.payload.artifactId); winddowns.delete(event.payload.artifactId); decisions.delete(event.payload.artifactId); sandboxExecutions.delete(event.payload.artifactId); sandboxPublications.delete(event.payload.artifactId); }
    if (event.event_type === "decision.recorded") {
      const value = event.payload.decision;
      if (!Value.Check(DecisionRecordSchema, value)) throw new MoguriError("decision_corrupt", "Unsupported retained owned decision metadata.", 409);
      const artifact = artifacts.get(value.id), previous = decisions.get(value.id);
      if (event.project_id || event.session_id || event.turn_id || event.step_id || event.artifact_id !== value.id || value.profileId !== profileId ||
        !artifact || artifact.kind !== "report" || artifact.contentDigest !== value.inputDigest ||
        !previous && (artifact.originSessionId !== value.sessionId || artifact.projectId !== value.projectId || artifact.workspaceId !== value.workspaceId) ||
        candidates.has(value.id) || roleSequences.has(value.id) || compoundWorkflows.has(value.id) || winddowns.has(value.id) || candidateGenerations.has(value.id) ||
        [...decisions.values()].some((record) => record.id !== value.id && record.sourceDigest === value.sourceDigest && record.sessionId === value.sessionId && record.turnId === value.turnId))
        throw new MoguriError("decision_corrupt", "The exact original decision source/model/report must have one independent profile-owned intent. No duplicate paid call or adopted owner.", 409);
      decisions.set(value.id, projectDecision(previous, value));
    }
    if (event.event_type === "winddown.recorded") {
      const value = event.payload.winddown;
      if (!Value.Check(WinddownRecordSchema, value)) throw new MoguriError("winddown_corrupt", "Unsupported original budget checkpoint state.", 409);
      const artifact = artifacts.get(value.id);
      if (event.project_id || event.session_id || event.turn_id || event.step_id || event.artifact_id !== value.id || value.profileId !== profileId ||
        !artifact || artifact.kind !== "report" || artifact.contentDigest !== value.inputDigest ||
        !winddowns.has(value.id) && (artifact.originSessionId !== value.sessionId || artifact.projectId !== value.projectId || artifact.workspaceId !== value.workspaceId) ||
        candidates.has(value.id) || roleSequences.has(value.id) || compoundWorkflows.has(value.id) ||
        [...winddowns.values()].some((record) => record.id !== value.id && record.sessionId === value.sessionId && record.turnId === value.turnId)) throw new MoguriError("winddown_corrupt", "One original profile/owner/turn must retain the exact independent checkpoint report.", 409);
      winddowns.set(value.id, projectWinddown(winddowns.get(value.id), value));
    }
    if (event.event_type === "compound.recorded") {
      const value = event.payload.workflow;
      if (!Value.Check(CompoundWorkflowSchema, value)) throw new MoguriError("compound_corrupt", "Unsupported retained public compound metadata.", 409);
      const artifact = artifacts.get(value.id), previous = compoundWorkflows.get(value.id);
      if (event.project_id || event.session_id || event.turn_id || event.step_id || value.profileId !== profileId || event.artifact_id !== value.id ||
        !artifact || artifact.kind !== "report" || artifact.contentDigest !== value.inputDigest ||
        !previous && (artifact.originSessionId !== value.sessionId || artifact.projectId !== value.projectId || artifact.workspaceId !== value.workspaceId) ||
        candidates.has(value.id) || roleSequences.has(value.id) || candidateGenerations.has(value.id)) throw new MoguriError("compound_corrupt", "Public workflow lost its independently retained exact profile, report, source or input grant.", 409);
      compoundWorkflows.set(value.id, projectCompoundWorkflow(previous, value));
      const owner = sessions.get(value.sessionId);
      if (owner) for (const validation of value.validations) if (validation.dispatched && validation.resultDigest && validation.decision &&
        (validation.status === "passed" || validation.status === "failed")) {
        for (const process of owner.processes) if (process.turnId === value.id && process.callId === validation.id && ["running", "unconfirmed"].includes(process.outcome)) {
          process.outcome = validation.status === "passed" ? "completed" : "failed";
        }
      }
    }
    if (event.event_type === "role.sequence_recorded") {
      const value = event.payload.sequence;
      if (!Value.Check(RoleSequenceRecordSchema, value)) throw new MoguriError("role_sequence_corrupt", "Role metadata has an unsupported shape/version. Original state was preserved.", 409);
      const previous = roleSequences.get(value.id), artifact = artifacts.get(value.id);
      if (event.project_id || event.session_id || event.turn_id || event.step_id ||
        value.profileId !== profileId || event.artifact_id !== value.id || !artifacts.has(value.id) ||
        candidates.has(value.id) || candidateGenerations.has(value.id) || artifact?.kind !== "report" ||
        artifact.contentDigest !== value.inputDigest || !previous && (artifact.originSessionId !== value.sessionId || artifact.projectId !== value.projectId || artifact.workspaceId !== value.workspaceId)) throw new MoguriError("role_sequence_corrupt", "Role metadata must retain its exact independent profile/report/input grant.", 409);
      roleSequences.set(value.id, projectRoleSequence(previous, value));
    }
    if (event.event_type === "candidate.generation_recorded") {
      if (event.project_id || event.session_id || event.turn_id || event.step_id || !Value.Check(CandidateGenerationRecordSchema, event.payload.generation) ||
        event.payload.generation.profileId !== profileId || event.artifact_id !== event.payload.generation.id || roleSequences.has(event.payload.generation.id)) throw new MoguriError("candidate_generation_corrupt", "Generation must retain its original exact profile/artifact compartment. State was preserved.", 409);
      const generation = projectCandidateGeneration(candidateGenerations.get(event.payload.generation.id), event.payload.generation);
      candidateGenerations.set(generation.id, generation);
    }
    if (event.event_type === "model.completed" && event.payload.candidateGenerationId) {
      const generation = candidateGenerations.get(event.payload.candidateGenerationId);
      if (!generation || event.artifact_id !== generation.id || event.turn_id !== generation.id || event.session_id !== generation.sessionId ||
        event.project_id !== generation.projectId || event.step_id !== generation.stepId || event.payload.usage.stepId !== generation.stepId ||
        event.payload.usage.modelId !== generation.modelId || event.payload.usage.role !== "draft") {
        throw new MoguriError("candidate_generation_corrupt", "Generation output must use its canonical proposal compartment, not an unrelated session or report.", 409);
      }
    }
    if (event.event_type === "candidate.saved") {
      const candidate = event.payload.candidate;
      if (!Value.Check(CandidateRecordSchema, candidate)) throw new MoguriError("candidate_corrupt", "Candidate metadata has an unsupported shape/version. State was preserved.", 409);
      const artifact = artifacts.get(candidate.id);
      if (candidate.profileId !== profileId || candidate.projectId !== event.project_id ||
        event.session_id || event.artifact_id !== candidate.id || roleSequences.has(candidate.id) || !artifact || artifact.kind !== "report" || artifact.contentDigest !== candidate.documentDigest) {
        throw new MoguriError("candidate_corrupt", "Candidate metadata is invalid or outside its exact independent artifact/profile. State was preserved.", 409);
      }
      const origin = candidate.roleOrigin ?? candidate.compoundOrigin;
      if (origin && !artifact.sources.some((source) => source.actor === "model" && source.eventId === origin.observationEventId &&
        source.modelId === origin.modelId && source.messageId === origin.stepId && source.contentDigest === origin.resultDigest)) {
        throw new MoguriError("candidate_corrupt", "Candidate role provenance lost its independently retained exact model observation.", 409);
      }
      const validated = projectCandidateRecord(candidates.get(candidate.id), candidate);
      const intents = [validated.stageIntent, validated.applyIntent].filter((intent) => intent !== null);
      if ([...candidates.values()].some((other) => other.id !== candidate.id && [other.stageIntent, other.applyIntent].some((owned) =>
        owned && intents.some((intent) => intent.commandId === owned.commandId || intent.jobId === owned.jobId)))) {
        throw new MoguriError("candidate_corrupt", "Original candidate command/job intent was duplicated across independent records.", 409);
      }
      candidates.set(candidate.id, validated);
    }
    if (event.event_type === "question.asked") questions.set(event.payload.question.id, { ...structuredClone(event.payload.question), recommendation: structuredClone(event.payload.question.recommendation ?? null), sourceEventId: event.id });
    if (event.event_type === "question.answered") {
      const question = questions.get(event.payload.questionId);
      if (event.payload.answer.other && event.payload.answer.actor !== "user") throw new MoguriError("question_corrupt", "Only an actual user can submit an explicit Other answer. State was preserved.", 409);
      if (event.payload.answer.actor === "decision-provider") {
        const answer = event.payload.answer, record = decisions.get(answer.decisionId ?? ""), origin = answer.decisionOrigin, entry = budgetEntries.get(answer.sourceCallId ?? "");
        if (!question || question.allowFreeform || question.status !== "open" || !question.choices.includes(answer.text) ||
          !Value.Check(DecisionEvidenceSchema, origin) || origin.decisionId !== answer.decisionId || origin.stepId !== answer.sourceCallId ||
          !entry || entry.sessionId !== event.session_id || entry.turnId !== event.turn_id || entry.modelId !== answer.modelId || entry.providerId !== answer.providerId ||
          entry.role !== "decision" || !successfulRoleEntry(entry) ||
          record && (record.status !== "applied" || record.source.kind !== "question" || record.source.questionId !== question.id ||
          record.source.questionRevision !== question.revision || record.source.parentStepId !== question.stepId || record.source.callId !== question.callId ||
          record.sessionId !== event.session_id || record.turnId !== event.turn_id || record.stepId !== event.payload.answer.sourceCallId ||
          record.modelId !== answer.modelId || record.providerId !== answer.providerId || origin.inputDigest !== record.inputDigest || origin.modelInputDigest !== record.actualInputDigest ||
          origin.resultDigest !== record.resultDigest || origin.adviceDigest !== record.adviceDigest)) throw new MoguriError("decision_corrupt", "An automated technical answer lost its exact original pending choice, actual known model actor or independently retained evidence.", 409);
      } else if (event.payload.answer.decisionId !== undefined || event.payload.answer.decisionOrigin !== undefined) throw new MoguriError("decision_corrupt", "Provider advice cannot impersonate a human answer.", 409);
      if (question) Object.assign(question, { answer: structuredClone(event.payload.answer), status: "answered", revision: question.revision + 1 });
    }
    if (event.event_type === "question.cancelled") {
      const question = questions.get(event.payload.questionId);
      if (question) Object.assign(question, { status: "cancelled", diagnostic: event.payload.diagnostic, revision: question.revision + 1 });
    }
    if (event.event_type === "workspace.saved") {
      const proof = event.payload.branchOperation;
      if (proof) {
        const previous = managedWorkspaces.get(event.payload.workspace.id), operation = githubOperations.get(proof.operationId), next = event.payload.workspace;
        if (!previous || !operation || operation.kind !== "git.branch.rename" || operation.workspaceId !== next.id ||
          operation.projectId !== next.projectId || operation.root.root !== next.path || previous.branch !== proof.previousBranch ||
          next.identity?.device !== operation.root.device || next.identity.inode !== operation.root.inode ||
          next.revision !== previous.revision + 1 || previous.status !== "ready" || next.status !== "ready" ||
          (["projectId", "path", "baseCommit", "gitCommonDir", "createdAt", "changeSetId", "jobId"] as const).some((key) =>
            previous[key] !== next[key]) ||
          JSON.stringify(previous.identity) !== JSON.stringify(next.identity)) throw new MoguriError("workspace_branch_corrupt", "Managed branch metadata lost its original verified Git operation/root/change set. State was preserved.", 409);
      }
      managedWorkspaces.set(event.payload.workspace.id, structuredClone(event.payload.workspace));
      if (event.payload.workspace.status === "partial") blockedWorkspaces.add(event.payload.workspace.id);
      if (event.payload.workspace.status === "removed") blockedWorkspaces.delete(event.payload.workspace.id);
    }
    if (event.event_type === "change_set.saved") changeSets.set(event.payload.changeSet.id, structuredClone(event.payload.changeSet));
    if (event.event_type === "terminal.changed") {
      const terminal = event.payload.terminal, previous = terminals.get(terminal.id);
      if (!Value.Check(TerminalStateSchema, terminal)) throw new MoguriError("terminal_corrupt", "Terminal state is invalid. Retained history was preserved.", 409);
      if (terminal.binding && terminal.env !== terminal.binding.env) throw new MoguriError("terminal_corrupt", "Terminal execution env differs from its captured binding. No boundary was relabeled.", 409);
      if (terminal.sessionId === null || terminal.projectId === null) {
        const owner = terminal.ownerId ? terminalOwners.get(terminal.ownerId) : undefined;
        if (terminal.env !== "Local" || terminal.binding?.env !== "Local" || terminal.binding.profileId !== profileId ||
          terminal.binding.sessionId !== terminal.sessionId || terminal.binding.projectId !== terminal.projectId ||
          terminal.sessionId === null && terminal.projectId !== null || terminal.workspaceId != null || terminal.binding.workspaceId !== null ||
          !owner || owner.remote || terminal.sessionId !== event.session_id || terminal.projectId !== event.project_id) throw new MoguriError("terminal_corrupt", "Independent Local console lost its exact owner, null scope, profile or captured root. No session/project was inferred.", 409);
      }
      if (terminal.env === "Remote") {
        const owner = terminal.ownerId ? terminalOwners.get(terminal.ownerId) : undefined;
        if (!owner?.remote || terminal.binding?.env !== "Remote" || terminal.binding.peerDigest !== owner.remote.peerDigest ||
          terminal.binding.profileId !== profileId || terminal.binding.projectId !== terminal.projectId || terminal.binding.sessionId !== terminal.sessionId ||
          terminal.projectId !== event.project_id || terminal.sessionId !== event.session_id) throw new MoguriError("terminal_corrupt", "Remote terminal does not own its exact retained peer/profile/session/root. No Local metadata was substituted.", 409);
      }
      if (previous && (previous.ownerId !== undefined && previous.ownerId !== terminal.ownerId ||
        previous.binding !== undefined && JSON.stringify(previous.binding) !== JSON.stringify(terminal.binding) ||
        previous.launchDigest !== undefined && previous.launchDigest !== terminal.launchDigest ||
        previous.commandId !== undefined && previous.commandId !== terminal.commandId ||
        previous.commandDigest !== undefined && previous.commandDigest !== terminal.commandDigest ||
        previous.env !== undefined && previous.env !== terminal.env ||
        previous.pid !== null && previous.pid !== terminal.pid)) throw new MoguriError("terminal_corrupt", "Original terminal launch/root/peer/command/PID changed. No shell or input was replayed.", 409);
      terminals.set(terminal.id, { ...terminal });
      if (event.payload.terminal.status === "unconfirmed") {
        if (event.payload.terminal.workspaceId) blockedWorkspaces.add(event.payload.terminal.workspaceId);
        else if (event.payload.terminal.projectId) blockedProjects.add(event.payload.terminal.projectId);
      }
    }
    if (event.event_type === "execution.started") executions.set(event.payload.execution.id, structuredClone(event.payload.execution));
    if (event.event_type === "sandbox.workspace_recorded") {
      const workspace = event.payload.workspace, previous = sandboxWorkspaces.get(workspace.id);
      if (workspace.repositories) {
        const repositories = sandboxRepositories(workspace.repositories), session = sessions.get(workspace.sessionId);
        if (workspace.projectId !== null || workspace.sourceWorkspaceId !== null || workspace.sourceRoot !== null || workspace.sourceHead !== null ||
          !session?.repositories || JSON.stringify(session.repositories) !== JSON.stringify(repositories.map(({ projectId, name, root }) => ({ projectId, name, root })))) {
          throw new MoguriError("sandbox_repository_history", "A composite workspace lost its exact root-less captured session scope.", 409);
        }
      }
      if (previous && Boolean(previous.repositories) !== Boolean(workspace.repositories)) throw new MoguriError("sandbox_repository_history", "Legacy and composite workspace authority cannot be relabelled.", 409);
      sandboxWorkspaces.set(workspace.id, structuredClone(workspace));
    }
    if (event.event_type === "sandbox.publication_recorded") {
      const publication = projectSandboxPublication(sandboxPublications.get(event.payload.publication.id), event.payload.publication);
      if (publication.profileId !== profileId || event.artifact_id !== publication.id) throw new MoguriError("sandbox_publication_corrupt", "Native publication lost its exact independent profile/report authority.", 409);
      sandboxPublications.set(publication.id, structuredClone(publication));
      if (publication.status === "partial" && (publication.attemptedPaths.length || publication.createdDirectories.length)) {
        if (publication.workspaceId) blockedWorkspaces.add(publication.workspaceId); else blockedProjects.add(publication.projectId);
      }
    }
    if (event.event_type === "sandbox.execution_recorded") {
      if (event.payload.execution.profileId !== event.profile_id) throw new Error("Native execution cannot cross its retained profile authority.");
      const next = event.payload.execution, previous = sandboxExecutions.get(next.id);
      if (next.repositories) {
        sandboxRepositories(next.repositories);
        if (next.projectId !== null || next.sourceWorkspaceId !== null || next.sourceRoot !== null || next.root !== null) throw new MoguriError("sandbox_repository_history", "Composite execution cannot acquire an implicit first/default project root.", 409);
      }
      if (previous && JSON.stringify(previous.repositories) !== JSON.stringify(next.repositories)) throw new MoguriError("sandbox_repository_history", "An original execution's captured native mapping cannot be replaced or added later.", 409);
      sandboxExecutions.set(event.payload.execution.id, structuredClone(event.payload.execution));
    }
    if (event.event_type === "sandbox.frame_recorded") {
      const execution = sandboxExecutions.get(event.payload.executionId);
      if (execution) execution.lastSequence = Math.max(execution.lastSequence, event.payload.sequence);
    }
    if (event.event_type === "execution.changed") {
      const execution = executions.get(event.payload.executionId);
      if (execution) Object.assign(execution, event.payload);
    }
    if (event.event_type === "execution.frame_recorded") {
      const execution = executions.get(event.payload.executionId);
      if (execution) execution.lastSequence = Math.max(execution.lastSequence, event.payload.sequence);
    }
    if (event.event_type === "board.saved") {
      const { projectId, revision, githubSource: source, ...config } = event.payload.board;
      if (!Value.Check(BoardConfigSchema, config) || !projectId || !Number.isSafeInteger(revision) || revision < 0 ||
        event.project_id !== projectId) throw new MoguriError("github_sync_corrupt", "The retained board configuration lost its exact project or schema. State was preserved.", 409);
      if (source && (!Value.Check(GithubBoardSourceSchema, source) || source.binding.projectId !== event.payload.board.projectId ||
        source.binding.profileId !== event.profile_id || source.binding.workspaceId !== null)) throw new MoguriError("github_sync_corrupt", "The retained GitHub board source lost its exact profile/root ownership. State was preserved.", 409);
      boards.set(event.payload.board.projectId, structuredClone(event.payload.board));
    }
    if (event.event_type === "issue.saved") {
      const issue = event.payload.issue, link = issue.github;
      if (issue.order !== undefined && (!Number.isSafeInteger(issue.order) || issue.order < 0) || link &&
        (!Value.Check(GithubIssueLinkSchema, link) || link.url !== `https://github.com/${link.repo}/issues/${link.number}` ||
          !Number.isFinite(Date.parse(link.checkedAt)) || !Number.isFinite(Date.parse(link.updatedAt)))) {
        throw new MoguriError("github_sync_corrupt", "The retained card lost its exact order or GitHub source identity. State was preserved.", 409);
      }
      issues.set(issue.id, structuredClone(issue));
    }
    if (event.event_type === "cache.prepared") dependencyCaches.set(`${event.payload.receipt.projectId}:${event.payload.receipt.workspaceId ?? "base"}:${event.payload.receipt.manager}`, { ...event.payload.receipt });
    if (event.event_type === "settings.updated") settings = { revision: event.payload.revision, permissionRevision: event.payload.permissionRevision, defaults: defaultSettings(), values: normalizeSettings(event.payload.settings) };
    if (event.event_type === "notification.sound_saved") notificationSounds.set(event.payload.sound.id, structuredClone(event.payload.sound));
    if (event.event_type === "notification.sound_removed") notificationSounds.delete(event.payload.id);
    if (event.event_type === "capability.saved") registry.set(event.payload.entry.id, { ...event.payload.entry });
    if (event.event_type === "capability.proposed") proposals.set(event.payload.proposal.id, { ...event.payload.proposal });
    if (event.event_type === "proposal.decided") {
      const proposal = proposals.get(event.payload.proposalId);
      if (proposal) proposal.status = event.payload.approve ? "approved" : "rejected";
    }
    if (event.event_type === "job.started") {
      const job = event.payload.job;
      if (job.projectClone || job.kind === "project.clone") {
        if (!Value.Check(ProjectCloneIntentSchema, job.projectClone) || job.kind !== "project.clone" || job.projectId !== null || job.sessionId !== null ||
          job.parentTurnId !== null || job.workspaceId != null || job.operationId || job.candidate || job.memory ||
          event.session_id != null || event.project_id != null || event.artifact_id != null || jobs.has(job.id) ||
          [...jobs.values()].some((other) => other.projectClone?.commandId === job.projectClone?.commandId)) throw new MoguriError("clone_corrupt", "Clone job lost its independent original command and exact Local destination. No effects were replayed.", 409);
        const intent = job.projectClone!;
        if (!intent.leaseRoots.includes(intent.path) || intent.leaseRoots.some((root) => root !== intent.path && !intent.path.startsWith(`${root}/`)) ||
          !intent.path.startsWith(intent.parent === "/" ? "/" : `${intent.parent}/`)) throw new MoguriError("clone_corrupt", "Clone leases no longer belong to the exact destination and its containing roots. No alternate authority was inferred.", 409);
      }
      if (job.operationId) {
        const operation = githubOperations.get(job.operationId) ?? linearOperations.get(job.operationId);
        const sessionId = operation && ("originSessionId" in operation ? operation.originSessionId : operation.sessionId);
        const kind = operation && ("kind" in operation ? operation.kind : `linear.${operation.action}`);
        if (!operation || event.artifact_id !== operation.id || operation.jobId !== job.id || operation.projectId !== job.projectId ||
          operation.projectId !== event.project_id || jobs.has(job.id) || job.sessionId !== sessionId || (event.session_id ?? null) !== sessionId ||
          (job.workspaceId ?? null) !== operation.workspaceId || job.kind !== kind || job.resultDigest !== null || job.error !== null ||
          operation.status !== "running" || job.status !== "running") throw new MoguriError("workflow_corrupt", "A workflow job lost its independently retained original intent. No new effects were adopted.", 409);
      }
      if (job.candidate || ["candidate.stage", "candidate.apply"].includes(job.kind)) {
        const reference = job.candidate;
        if (!reference || !Value.Check(CandidateJobIntentSchema, reference)) throw new MoguriError("candidate_corrupt", "Candidate job has no exact typed original intent.", 409);
        const candidate = candidates.get(reference.candidateId), intent = reference.phase === "stage" ? candidate?.stageIntent : candidate?.applyIntent;
        const workspaceId = reference.phase === "stage" ? candidate?.stage.workspaceId : candidate?.source.workspaceId;
        if (!candidate || !intent || job.memory || jobs.has(job.id) || job.kind !== `candidate.${reference.phase}` ||
          job.id !== intent.jobId || reference.commandId !== intent.commandId || reference.commandDigest !== intent.commandDigest ||
          job.projectId !== candidate.projectId || event.project_id !== job.projectId || job.sessionId !== (intent.sessionId ?? null) || (event.session_id ?? null) !== job.sessionId ||
          (job.workspaceId ?? null) !== workspaceId || event.artifact_id !== candidate.id ||
          job.status !== "running" || job.resultDigest !== null || job.error !== null ||
          [...jobs.values()].some((other) => other.candidate?.commandId === reference.commandId || other.memory?.commandId === reference.commandId)) {
          throw new MoguriError("candidate_corrupt", "Candidate job changed its original artifact/command/root/phase or replayed admission.", 409);
        }
      }
      if (job.memory && (!Value.Check(MemoryIndexIntentSchema, job.memory) || job.kind !== "memory.index" ||
        job.memory.target.profileId !== profileId || job.memory.target.projectId !== job.projectId || job.sessionId !== event.session_id ||
        job.projectId !== event.project_id || (job.workspaceId ?? null) !== job.memory.target.workspaceId)) {
        throw new MoguriError("memory_corrupt", "Repository memory job intent changed its original owning profile/session/root.", 409);
      }
      if (job.sandboxPublicationId) {
        const publication = sandboxPublications.get(job.sandboxPublicationId);
        if (!publication || job.candidate || job.memory || jobs.has(job.id) || job.kind !== "sandbox.publish" || job.id !== publication.jobId ||
          event.artifact_id !== publication.id || job.projectId !== publication.projectId || event.project_id !== publication.projectId ||
          job.sessionId !== null || (event.session_id ?? null) !== null || (job.workspaceId ?? null) !== publication.workspaceId ||
          job.status !== "running" || job.resultDigest !== null || job.error !== null) throw new MoguriError("sandbox_publication_corrupt", "Native publication job lost its original independently retained user/root intent.", 409);
      }
      if (job.winddownId) {
        const record = winddowns.get(job.winddownId), intent = record?.commit;
        if (!record || !intent || record.status !== "committing" || job.candidate || job.memory || job.sandboxPublicationId || jobs.has(job.id) ||
          job.kind !== "winddown.commit" || job.id !== intent.jobId || event.artifact_id !== record.id ||
          job.projectId !== record.projectId || event.project_id !== record.projectId || job.sessionId !== record.sessionId || event.session_id !== record.sessionId ||
          (job.workspaceId ?? null) !== record.workspaceId || job.status !== "running" || job.resultDigest !== null || job.error !== null) throw new MoguriError("winddown_corrupt", "Accepted-work Git job lost its exact separate actual-user source/ref intent.", 409);
      }
      if (job.memory && ([...jobs.values()].some((entry) => entry.id !== job.id && entry.memory?.commandId === job.memory?.commandId) ||
        jobs.get(job.id)?.memory && JSON.stringify(jobs.get(job.id)!.memory) !== JSON.stringify(job.memory))) {
        throw new MoguriError("memory_corrupt", "Original repository memory command intent was duplicated or changed.", 409);
      }
      jobs.set(job.id, { ...job });
    }
    if (event.event_type === "job.progress" || event.event_type === "job.finished") {
      const job = jobs.get(event.payload.jobId);
      if ((event.payload.operationId ?? null) !== (job?.operationId ?? null)) throw new MoguriError("workflow_corrupt", "Workflow lifecycle changed its original independent operation owner.", 409);
      if (job?.operationId) {
        const operation = githubOperations.get(job.operationId) ?? linearOperations.get(job.operationId);
        if (!operation || event.artifact_id !== operation.id || event.project_id !== operation.projectId || (event.session_id ?? null) !== job.sessionId ||
          (job.workspaceId ?? null) !== operation.workspaceId || job.kind !== ("kind" in operation ? operation.kind : `linear.${operation.action}`) || job.status !== "running" ||
          event.event_type === "job.finished" && (operation.status !== event.payload.status ||
            event.payload.status === "completed" && (event.payload.resultDigest !== operation.resultDigest || event.payload.error !== null))) throw new MoguriError("workflow_corrupt", "Workflow job hid its actual terminal state, result or original retention owner.", 409);
      }
      if ((event.payload.winddownId ?? null) !== (job?.winddownId ?? null)) throw new MoguriError("winddown_corrupt", "Accepted-work job lifecycle changed its original independent artifact owner.", 409);
      if (job?.winddownId) {
        const record = winddowns.get(job.winddownId), intent = record?.commit;
        if (!record || !intent || event.artifact_id !== record.id || event.project_id !== record.projectId || event.session_id !== record.sessionId ||
          job.status !== "running" || event.event_type === "job.finished" && (event.payload.status === "completed" &&
            (record.status !== "completed" || intent.resultDigest === null || intent.resultDigest !== event.payload.resultDigest || event.payload.error !== null) ||
            ["failed", "cancelled"].includes(event.payload.status) && intent.publicationAttempted)) throw new MoguriError("winddown_corrupt", "Accepted-work job replayed terminal state or hid possible ref publication/unknown cleanup.", 409);
      }
      if ((event.payload.sandboxPublicationId ?? null) !== (job?.sandboxPublicationId ?? null)) throw new MoguriError("sandbox_publication_corrupt", "Native publication lifecycle changed its artifact owner.", 409);
      if (job?.sandboxPublicationId) {
        const publication = sandboxPublications.get(job.sandboxPublicationId);
        if (!publication || event.artifact_id !== publication.id || event.project_id !== publication.projectId || (event.session_id ?? null) !== null ||
          job.status !== "running" || event.event_type === "job.finished" && (event.payload.status === "completed" &&
            (publication.status !== "completed" || publication.operationDigest === null || publication.operationDigest !== event.payload.resultDigest || event.payload.error !== null) ||
            ["failed", "cancelled"].includes(event.payload.status) && publication.attemptedPaths.length > 0)) {
          throw new MoguriError("sandbox_publication_corrupt", "Native publication job hid possible effects, replayed terminal work or lost its exact result.", 409);
        }
      }
      if ((event.payload.candidateId ?? null) !== (job?.candidate?.candidateId ?? null) ||
        job?.candidate && ((event.artifact_id ?? null) !== job.candidate.candidateId || event.project_id !== job.projectId || (event.session_id ?? null) !== job.sessionId)) {
        throw new MoguriError("candidate_corrupt", "Candidate job lifecycle lost its independent artifact owner.", 409);
      }
      if (job?.candidate) {
        const candidate = candidates.get(job.candidate.candidateId);
        if (job.status !== "running" || !candidate) throw new MoguriError("candidate_corrupt", "Candidate job progress/outcome cannot replay or upgrade terminal work.", 409);
        if (event.event_type === "job.finished") {
          const stage = job.candidate.phase === "stage", digest = stage ? candidate.stageResultDigest : candidate.applyResultDigest;
          if (!["completed", "failed", "cancelled", "partial"].includes(event.payload.status) ||
            event.payload.status === "completed" && (candidate.status !== (stage ? "staged" : "applied") || digest === null || event.payload.resultDigest !== digest || event.payload.error !== null) ||
            ["failed", "cancelled"].includes(event.payload.status) && (candidate.status === "partial" || (stage ? candidate.stagedPaths.length : candidate.attemptedPaths.length) > 0)) {
            throw new MoguriError("candidate_corrupt", "Candidate job outcome is not its actual verified result or hides possible effects.", 409);
          }
        }
      }
    }
    if (event.event_type === "command.inspected") {
      const job = jobs.get(event.payload.jobId);
      if (!job?.commandJob || job.status !== "partial" || job.sessionId !== event.session_id || job.commandJob.root !== event.payload.root || event.payload.actor !== "user") throw new MoguriError("command_scope", "Command inspection lost its exact original root/owner.", 409);
      job.commandJob = { ...job.commandJob, inspected: true };
    }
    if (event.event_type === "job.progress") {
      const job = jobs.get(event.payload.jobId);
      if (job) { job.progress = event.payload.progress; if (event.payload.status) job.status = event.payload.status; }
    }
    if (event.event_type === "job.finished") {
      const job = jobs.get(event.payload.jobId);
      if (job) Object.assign(job, { status: event.payload.status, resultDigest: event.payload.resultDigest, error: event.payload.error });
      if (job && (job.kind.startsWith("git.") || ["command.watch", "cache.install", "project.defaults", "project.artifacts.materialize", "candidate.stage", "candidate.apply", "compound.validate", "winddown.commit"].includes(job.kind)) && event.payload.status === "partial" && job.projectId) {
        if (job.workspaceId) blockedWorkspaces.add(job.workspaceId); else blockedProjects.add(job.projectId);
      }
    }
    if (event.event_type === "chat.writer_recorded") {
      const writer = event.payload.writer, previous = chatWriters.get(writer.id);
      if (!Value.Check(ChatWriterSchema, writer) || event.project_id || event.session_id || writer.profileId !== (event.profile_id ?? PROFILE_ID) ||
        (writer.status === "acknowledged") !== Boolean(writer.inspection) ||
        previous && (writer.revision !== previous.revision + 1 ||
          JSON.stringify([writer.id, writer.profileId, writer.sessionId, writer.turnId, writer.root, writer.startedAt]) !==
          JSON.stringify([previous.id, previous.profileId, previous.sessionId, previous.turnId, previous.root, previous.startedAt]) ||
          previous.status === "active" && writer.status === "acknowledged" ||
          previous.status !== "active" && !(previous.status === "unconfirmed" && writer.status === "acknowledged") ||
          previous.backgroundJobs.some((id) => !writer.backgroundJobs.includes(id))) ||
        !previous && (writer.revision !== 0 || writer.status !== "active" || writer.inspection || writer.backgroundJobs.length || writer.startedAt !== writer.updatedAt)) {
        throw new MoguriError("chat_writer_corrupt", "The independently retained Home writer lost its exact original owner/root or terminal transition. No cleanup or replacement was inferred.", 409);
      }
      chatWriters.set(writer.id, structuredClone(writer));
    }
    if (event.event_type === "turn.finished" && event.payload.workspaceEffects !== "none" && ["partial", "failed"].includes(event.payload.outcome) && event.project_id) {
      const workspaceId = event.session_id ? sessions.get(event.session_id)?.workspaceId : null;
      if (workspaceId) blockedWorkspaces.add(workspaceId); else blockedProjects.add(event.project_id);
    }
    if (event.event_type === "turn.finished" && event.payload.workspaceEffects !== "none" && ["partial", "failed"].includes(event.payload.outcome) && !event.project_id && event.session_id) blockedSessions.add(event.session_id);
    if (event.event_type === "session.resumed" && event.project_id) {
      const workspaceId = event.session_id ? sessions.get(event.session_id)?.workspaceId : null;
      if (workspaceId) blockedWorkspaces.delete(workspaceId); else blockedProjects.delete(event.project_id);
    }
    if (event.event_type === "session.resumed" && event.session_id) blockedSessions.delete(event.session_id);
    if (event.event_type === "project.added") {
      const project = event.payload.project;
      projects.set(project.id, { ...project, name: projectIdentifier(project.name, [...projects.values()].filter((entry) => entry.id !== project.id).map((entry) => entry.name)) });
    }
    if (event.event_type === "project.relocated" && event.project_id) {
      const project = projects.get(event.project_id);
      if (project) projects.set(project.id, { ...project, ...event.payload, name: projectIdentifier(event.payload.name, [...projects.values()].filter((entry) => entry.id !== project.id).map((entry) => entry.name)) });
    }
    if (event.event_type === "policy.updated") {
      policy = event.payload.policy;
      for (const session of sessions.values()) session.localFinishing = session.turnId !== null && event.payload.finishingTurnIds.includes(session.turnId);
    }
    if (event.event_type === "session.created") {
      if (!event.session_id) throw new Error("Invalid session.created event scope.");
      const repositories = event.payload.repositories;
      const homeRoot = event.payload.homeRoot;
      if (homeRoot && (!Value.Check(SessionHomeRootSchema, homeRoot) || event.project_id || repositories || event.payload.workspaceId ||
        event.payload.controls.env !== "Local" || event.payload.readOnly || event.payload.kind && !["agent", "side"].includes(event.payload.kind))) {
        throw new MoguriError("chat_home_corrupt", "A Home binding requires an ordinary project-free Local chat, not a synthetic project or private role.", 409);
      }
      if (repositories || event.payload.projectFolderId) {
        const inherited = event.payload.parentSessionId ? sessions.get(event.payload.parentSessionId) : undefined;
        if (event.project_id || event.payload.workspaceId || !event.payload.projectFolderId || !projectFolders.has(event.payload.projectFolderId) ||
          !Value.Check(SessionRepositoriesSchema, repositories) ||
          new Set(repositories.map((repository) => repository.projectId)).size !== repositories.length ||
          new Set(repositories.map((repository) => repository.name.toLowerCase())).size !== repositories.length ||
          new Set(repositories.map((repository) => repository.root.root)).size !== repositories.length ||
          inherited?.repositories && (inherited.projectFolderId !== event.payload.projectFolderId || JSON.stringify(inherited.repositories) !== JSON.stringify(repositories)) ||
          !inherited?.repositories && repositories.some((repository) => projects.get(repository.projectId)?.path !== repository.root.root)) {
          throw new MoguriError("session_repositories_corrupt", "The folder session lost its exact original project/root set. No member, common parent or replacement root was inferred.", 409);
        }
      }
      if (event.payload.purpose && (event.payload.purpose !== "kanban" || !event.project_id ||
        event.payload.workspaceId || event.payload.kind && event.payload.kind !== "agent" ||
        [...sessions.values()].some((session) => session.projectId === event.project_id && session.purpose === "kanban"))) {
        throw new MoguriError("kanban_chat_corrupt", "A project Kanban chat must have one exact project owner, not a different workspace or duplicate chat.", 409);
      }
      const origin = event.payload.githubSource;
      if (origin) {
        if (!Value.Check(GithubSessionOriginSchema, origin) || !event.project_id ||
          origin.binding.profileId !== (event.profile_id ?? PROFILE_ID) || origin.binding.projectId !== event.project_id ||
          origin.binding.workspaceId !== (event.payload.workspaceId ?? null) ||
          !origin.accountId.startsWith(`${origin.source.account.toLowerCase()}:`) || origin.source.accountId !== undefined && origin.source.accountId !== origin.accountId ||
          (origin.source.kind === "pull" ? event.payload.prUrl : event.payload.workItemUrl) !==
          `https://github.com/${origin.source.repository}/${origin.source.kind === "pull" ? "pull" : "issues"}/${origin.source.number}`) {
          throw new MoguriError("github_source_corrupt", "The session's reviewed GitHub source lost its original account, repository or item binding.", 409);
        }
      }
      sessions.set(event.session_id, {
        id: event.session_id, projectId: event.project_id ?? null, workspaceId: event.payload.workspaceId ?? null, sandboxWorkspaceId: null, title: event.payload.title,
        controls: structuredClone(event.payload.controls), defaults: event.payload.defaults ? structuredClone(event.payload.defaults) : undefined, revision: 0, status: "idle", draft: { revision: 0, text: "", attachments: [] },
        queue: [], queueRevision: 0, messages: [], usage: [], processes: [], turnId: null, pendingApproval: null, pendingQuestionId: null,
        lastError: null, localFinishing: false, createdAt: event.timestamp, updatedAt: event.timestamp,
        parentSessionId: event.payload.parentSessionId, createdParentSessionId: event.payload.parentSessionId, coordinationParentId: event.payload.coordinationParentId, parentSnapshotDigest: event.payload.parentSnapshotDigest, readOnly: event.payload.readOnly,
        mode: event.payload.mode ?? (event.payload.readOnly ? "read-only" : "agent"), pendingMode: null,
        kind: event.payload.kind ?? (event.payload.readOnly ? "subagent" : "agent"), pinned: false, order: nextSessionOrder++, unread: false, groupId: null, archivedAt: null,
        ...(event.payload.purpose ? { purpose: event.payload.purpose } : {}),
        ...(repositories ? { projectFolderId: event.payload.projectFolderId, repositories: structuredClone(repositories) } : {}),
        ...(homeRoot ? { homeRoot: structuredClone(homeRoot) } : {}),
        prUrl: event.payload.prUrl ?? null, prObservation: null, workItemId: event.payload.workItemId ?? null, workItemUrl: event.payload.workItemUrl ?? null,
        ...(origin ? { githubSource: structuredClone(origin) } : {}), browserUrl: null,
        suggestionSources: event.payload.suggestionSources,
        inheritedImages: event.payload.inheritedImages,
        activeCompactionId: null,
      });
    }
    const session = event.session_id ? sessions.get(event.session_id) : undefined;
    if (!session) continue;
    if (event.event_type === "session.home_bound") {
      if (session.projectId || session.workspaceId || session.repositories || session.homeRoot || session.readOnly ||
        !["agent", "side"].includes(session.kind) || session.controls.env !== "Local" ||
        !Value.Check(SessionHomeRootSchema, event.payload.root)) throw new MoguriError("chat_home_corrupt", "Home can bind once to the original project-free Local chat. No existing root or private owner was replaced.", 409);
      session.homeRoot = structuredClone(event.payload.root); session.revision++; session.updatedAt = event.timestamp;
    }
    if (event.event_type === "coordination.linked") {
      const link = event.payload.link, previous = coordinationLinks.get(link.childId);
      if (!Value.Check(CoordinationLinkSchema, link) || link.origin.actor === "service" || event.session_id !== link.childId ||
        session.createdParentSessionId !== link.parentId || session.projectId !== event.project_id ||
        link.revision !== (previous?.revision ?? -1) + 1 || previous && previous.parentId !== link.parentId) throw new MoguriError("coordination_corrupt", "A coordination grant changed its actual birth owner, scope or revision.", 409);
      coordinationLinks.set(link.childId, structuredClone(link));
    }
    if (event.event_type === "coordination.message") {
      const message = event.payload.message;
      if (!Value.Check(CoordinationMessageSchema, message) || message.toSessionId !== session.id || message.deliveredTo !== null ||
        coordinationMessages.has(message.id)) throw new MoguriError("coordination_corrupt", "A session message lost its original recipient, actor or unique identity.", 409);
      coordinationMessages.set(message.id, structuredClone(message));
      session.messages.push({ id: `coordination:${message.id}`, turnId: event.turn_id ?? "", role: "notice",
        text: `From session ${message.fromSessionId} (${message.origin.actor}): ${message.text}`, timestamp: event.timestamp });
      session.unread = true;
    }
    if (event.event_type === "coordination.delivered") {
      const message = coordinationMessages.get(event.payload.messageId);
      if (!message || message.toSessionId !== session.id || message.deliveredTo || session.turnId !== event.payload.turnId || event.turn_id !== event.payload.turnId) throw new MoguriError("coordination_corrupt", "Message delivery lost its exact recipient/turn or was replayed.", 409);
      message.deliveredTo = { turnId: event.payload.turnId, stepId: event.payload.stepId };
    }
    if (event.event_type === "session.pr_observed") {
      const observation = event.payload.observation;
      const scope = sessionPrScope(session, { issues: [...issues.values()], managedWorkspaces: [...managedWorkspaces.values()], changeSets: [...changeSets.values()],
        projects: [...projects.values()], projectConfigurations: [...projectConfigurations.values()] });
      if (!Value.Check(SessionPrObservationSchema, observation) || observation.profileId !== profileId || observation.sessionId !== session.id ||
        event.project_id !== session.projectId || !scope || !sameSessionPrScope(scope, observation.scope) || observation.pullRequest.url !== scope.url) {
        throw new MoguriError("session_pr_scope", "A PR observation lost its exact session/profile/root/access binding. State was preserved.", 409);
      }
      session.prObservation = structuredClone(observation);
      continue;
    }
    session.updatedAt = event.timestamp;
    const addUser = (item: QueueItem) => session.messages.push({
      id: item.id, turnId: event.turn_id ?? "", role: item.origin ? "notice" : "user", text: (item.origin ? `Delegated by session ${item.origin.fromSessionId} (${item.origin.origin.actor}): ` : "") + item.text +
        (item.attachments.length ? `\n\nAttached: ${item.attachments.map((attachment) => attachment.path).join(", ")}` : ""),
      timestamp: event.timestamp, attachments: item.attachments.length ? structuredClone(item.attachments) : undefined,
    });
    switch (event.event_type) {
      case "question.asked": session.pendingQuestionId = event.payload.question.id; session.status = "waiting_input"; break;
      case "question.answered":
      case "question.cancelled":
        if (session.pendingQuestionId === event.payload.questionId) {
          session.pendingQuestionId = null;
          if (session.turnId && session.status === "waiting_input") session.status = "running";
        }
        break;
      case "session.continue_work_chosen":
        if (event.payload.actor !== "user" || !["kanban", "prompt"].includes(event.payload.choice) ||
          event.payload.draftRevision !== session.draft.revision || !session.projectId || !isContinueWork(session.draft.text)) {
          throw new MoguriError("continue_work_corrupt", "The continuation choice lost its exact actual-user draft and owner. No route or permission was reconstructed.", 409);
        }
        break;
      case "session.configured":
        if (event.payload.autonomySelection && (event.payload.autonomySelection.actor !== "user" ||
          !event.payload.autonomySelection.commandId || !/^[a-f0-9]{64}$/.test(event.payload.autonomySelection.commandDigest) ||
          event.payload.autonomySelection.autonomy !== event.payload.controls.autonomy ||
          event.payload.controls.automaticApprovals !== ["Autopilot", "Autopilot Max"].includes(event.payload.controls.autonomy))) {
          throw new MoguriError("autonomy_consent_corrupt", "Explicit autonomy selection lost its actual user command or selected consent. Original state was preserved.", 409);
        }
        if (session.defaults) for (const key of controlKeys) if (JSON.stringify(session.controls[key]) !== JSON.stringify(event.payload.controls[key])) session.defaults.sources[key] = "session";
        session.controls = structuredClone(event.payload.controls); session.revision++; break;
      case "session.organized": {
        const changes = event.payload.changes;
        if (changes.title !== undefined) session.title = changes.title;
        if (changes.pinned !== undefined) session.pinned = changes.pinned;
        if (changes.order !== undefined) { session.order = changes.order; nextSessionOrder = Math.max(nextSessionOrder, changes.order + 1); }
        if (changes.unread !== undefined) session.unread = changes.unread;
        if (changes.groupId !== undefined) session.groupId = changes.groupId;
        if (changes.parentSessionId !== undefined) session.parentSessionId = changes.parentSessionId ?? undefined;
        if (changes.prUrl !== undefined) {
          if (changes.prUrl !== session.prUrl) { session.prObservation = null; if (session.githubSource?.source.kind === "pull") delete session.githubSource; }
          session.prUrl = changes.prUrl;
        }
        if (changes.workItemUrl !== undefined) {
          if (changes.workItemUrl !== session.workItemUrl && session.githubSource?.source.kind === "issue") delete session.githubSource;
          session.workItemUrl = changes.workItemUrl;
        }
        if (changes.workItemId !== undefined) session.workItemId = changes.workItemId;
        session.revision++; break;
      }
      case "task.plan_updated": {
        const plan = event.payload.plan;
        if (plan.turnId !== event.turn_id || plan.source.actor !== "model" || plan.source.stepId !== event.step_id ||
          plan.revision !== (session.taskPlan?.revision ?? -1) + 1 || plan.steps.length < 2 || plan.steps.length > 50) {
          throw new MoguriError("plan_corrupt", "The task plan lost its actual model, turn or revision. State was preserved.", 409);
        }
        session.taskPlan = structuredClone(plan); break;
      }
      case "session.mode_requested": session.pendingMode = event.payload.mode; session.revision++; break;
      case "session.mode_changed": session.mode = event.payload.mode; session.pendingMode = null; session.revision++; break;
      case "session.browser_changed": session.browserUrl = event.payload.url; session.revision++; break;
      case "session.workspace_bound": session.workspaceId = event.payload.workspaceId; session.revision++; break;
      case "session.sandbox_bound": session.sandboxWorkspaceId = event.payload.workspaceId; session.revision++; break;
      case "context.changed": session.activeCompactionId = event.payload.activeCompactionId; session.revision++; break;
      case "session.archived": session.beforeArchive = session.status; session.status = "archived"; session.archivedAt = event.timestamp; break;
      case "session.restored": session.status = session.beforeArchive ?? "idle"; session.archivedAt = null; break;
      case "session.resumed": session.status = session.queue.some((item) => !item.command) ? "queued" : "idle"; session.lastError = null; break;
      case "session.blocked": session.status = "waiting_input"; session.lastError = event.payload.diagnostic; break;
      case "draft.saved": {
        const source = event.payload.source, owner = source ? commandExecutions.get(source.executionId) : undefined;
        if (source && (!Value.Check(CommandDraftSourceSchema, source) || !owner || owner.status !== "running" || owner.stopRequested ||
          owner.profileId !== event.profile_id || owner.sessionId !== session.id || owner.queueItemId !== source.inputId)) {
          throw new MoguriError("command_draft_history", "Draft provenance lost its exact original user-command owner. No current draft or source was inferred.", 409);
        }
        session.draft = { ...event.payload, revision: session.draft.revision + 1 }; break;
      }
      case "queue.enqueued":
        session.queue.push(structuredClone(event.payload.item)); session.queueRevision++;
        if (!session.turnId && !event.payload.item.command) session.status = "queued";
        break;
      case "queue.edited": {
        const item = session.queue.find((item) => item.id === event.payload.messageId);
        if (item) {
          item.text = event.payload.text; delete item.origin; delete item.workflow; delete item.sidePromptOrigin; delete item.spawnPromptOrigin;
          if (event.payload.attachments) item.attachments = event.payload.attachments;
          if (event.payload.command === null) delete item.command;
          else if (event.payload.command !== undefined) item.command = structuredClone(event.payload.command);
        }
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
        if (event.payload.sideContext) {
          const capture = event.payload.sideContext;
          if (!Value.Check(SideContextSchema, capture) || session.kind !== "side" || session.mode !== "read-only" || !event.turn_id ||
            capture.parentSessionId !== session.createdParentSessionId || capture.throughSeq >= event.seq ||
            capture.pasteFiles.some((file) => file.kind !== "paste_file") || capture.documents.some((file) => file.kind !== "document")) {
            throw new MoguriError("side_context_corrupt", "Side context lost its exact read-only birth-parent/turn/source binding. History was preserved.", 409);
          }
          session.sideContext = { ...structuredClone(capture), turnId: event.turn_id, capturedAt: event.timestamp };
        }
        session.turnId = event.turn_id ?? null; session.status = "running"; session.lastError = null; session.localFinishing = false;
        session.queue = session.queue.filter((item) => item.id !== event.payload.item.id); session.queueRevision++;
        addUser(event.payload.item);
        break;
      case "turn.control_started":
        session.turnId = event.turn_id ?? null; session.status = "running"; session.lastError = null; session.localFinishing = false;
        break;
      case "steer.applied":
        session.queue = session.queue.filter((item) => item.id !== event.payload.item.id); session.queueRevision++;
        addUser(event.payload.item);
        break;
      case "steering.applied": {
        const { decisionOrigin: origin } = event.payload, record = decisions.get(event.payload.decisionId), entry = budgetEntries.get(event.payload.sourceStepId);
        if (!Value.Check(DecisionEvidenceSchema, origin) || origin.decisionId !== event.payload.decisionId || origin.stepId !== event.payload.sourceStepId ||
          !entry || entry.sessionId !== session.id || entry.turnId !== event.turn_id || entry.role !== "steering" || !successfulRoleEntry(entry) ||
          entry.modelId !== event.payload.modelId || entry.providerId !== event.payload.providerId ||
          record && (record.status !== "applied" || record.kind !== "steering" || record.sessionId !== session.id || record.turnId !== event.turn_id ||
            record.stepId !== origin.stepId || record.inputDigest !== origin.inputDigest || record.actualInputDigest !== origin.modelInputDigest ||
            record.resultDigest !== origin.resultDigest || record.adviceDigest !== origin.adviceDigest) ||
          !event.payload.text.trim() || event.payload.text.length > 1024) throw new MoguriError("decision_corrupt", "A steer lost its actual decision-provider owner/provenance.", 409);
        session.messages.push({ id: event.id, turnId: event.turn_id ?? "", role: "notice", text: `Decision-provider steer (${entry.modelId}): ${event.payload.text}`, timestamp: event.timestamp });
        break;
      }
      case "model.started":
        for (const routing of routings.values()) if (routing.turnId === event.turn_id && routing.status === "ready" && event.payload.role !== "router") routing.status = "running";
        session.messages.push({ id: event.step_id ?? event.id, turnId: event.turn_id ?? "", role: event.payload.kupoPhase || roleSequenceTurns.has(event.turn_id ?? "") || ["router", "compaction", "draft", "checkpoint", "decision", "steering"].includes(event.payload.role ?? "") ? "notice" : "assistant",
          text: event.payload.kupoPhase ? `Kupo ${event.payload.kupoPhase}: proposed tool requests remain unexecuted until response selection and normal permissions.` : roleSequenceTurns.has(event.turn_id ?? "") ? "An owned role is producing untrusted data, not a user answer or approval." : event.payload.role === "router" ? "Kupo is evaluating the eligible model pool." : event.payload.role === "compaction" ? "Generating a reviewed context proposal; original context is unchanged." : event.payload.role === "draft" ? "Generating an unaccepted code proposal; source and staging files are unchanged." : event.payload.role === "checkpoint" ? "Reserved metadata-only budget checkpoint; no source or Git approval." : ["decision", "steering"].includes(event.payload.role ?? "") ? "Bounded decision-provider advice inside explicit policy. Human intervention and deterministic authority win." : "", timestamp: event.timestamp });
        session.usage.push({
          stepId: event.step_id ?? event.id, modelId: event.payload.modelId, role: event.payload.role ?? (session.kind === "side" ? "side" : session.kind === "subagent" ? "subagent" : "solver"),
          inputTokens: null, outputTokens: null, cacheReadTokens: null, totalTokens: null,
          estimatedUsd: null, providerReportedUsd: null, billedUsd: null, requestMs: 0, quality: "unknown", outcome: "running",
          contextWindow: event.payload.contextWindow, contextEstimate: event.payload.contextEstimate, thinkingEffort: event.payload.thinkingEffort,
          providerId: event.payload.providerId, apiModelId: event.payload.apiModelId, source: event.payload.source,
        });
        break;
      case "assistant.delta": {
        const message = session.messages.find((message) => message.id === event.step_id);
        if (message && message.role !== "notice") message.text += event.payload.text;
        break;
      }
      case "model.completed": {
        const message: PublicMessage = roleSequenceTurns.has(event.turn_id ?? "") ? { ...event.payload.message, role: "notice",
          text: "Owned role result retained independently. It is untrusted data, not a user answer, code approval or automatic instructions.", reasoning: undefined, toolCalls: [] } : event.payload.message;
        const index = session.messages.findIndex((message) => message.id === event.payload.message.id);
        if (index >= 0) session.messages[index] = message;
        else session.messages.push(message);
        const usageIndex = session.usage.findIndex((usage) => usage.stepId === event.payload.usage.stepId);
        if (usageIndex >= 0) session.usage[usageIndex] = event.payload.usage; else session.usage.push(event.payload.usage);
        break;
      }
      case "routing.response_selected": {
        const { routingId, sourceStepId, reviewStepId, contextDigest } = event.payload;
        const routing = routings.get(routingId), source = kupoResults.get(sourceStepId), review = kupoResults.get(reviewStepId);
        const response = source?.payload.kupo?.response, verdict = review?.payload.kupo, plan = routing?.plan;
        const sourceModel = plan?.pattern === "cascade" && source?.payload.kupo?.phase === "escalation" ? plan.escalationId : plan?.modelId;
        const reviewModel = plan?.pattern === "cascade" ? plan.escalationId : plan?.pattern === "critique" ? plan.criticId : null;
        if (!routing || routing.policy.workflow !== "auto" || routing.status !== "running" || routing.turnId !== event.turn_id ||
          routing.sessionId !== session.id || !response || response.id !== sourceStepId || response.role !== "assistant" ||
          source?.session_id !== session.id || source.turn_id !== event.turn_id || source.step_id !== sourceStepId || source.payload.contextDigest !== contextDigest ||
          source.payload.kupo?.routingId !== routingId || !review || review.session_id !== session.id || review.turn_id !== event.turn_id ||
          verdict?.routingId !== routingId || routing.selectedStepIds?.includes(sourceStepId) ||
          source.payload.usage.quality !== "provider-reported" || review.payload.usage.quality !== "provider-reported" ||
          source.payload.usage.modelId !== sourceModel || review.payload.usage.modelId !== reviewModel || review.payload.usage.role !== "critic" ||
          !(source.payload.kupo.phase === "draft" && verdict.responseStepId === sourceStepId && verdict.verdict === "pass" ||
            source.payload.kupo.phase === "escalation" && plan?.pattern === "cascade" && verdict.phase === "gate" && verdict.verdict === "escalate" && verdict.responseStepId === source.payload.kupo.responseStepId ||
            source.payload.kupo.phase === "revision" && plan?.pattern === "critique" && verdict.phase === "critic" && verdict.verdict === "revise" && verdict.responseStepId === source.payload.kupo.responseStepId)) {
          throw new MoguriError("routing_corrupt", "A selected Kupo response lost its original metered model, review or owning turn. No response or tool authority was reconstructed.", 409);
        }
        routing.selectedStepIds = [...routing.selectedStepIds ?? [], sourceStepId];
        const index = session.messages.findIndex((message) => message.id === sourceStepId);
        if (index < 0) throw new MoguriError("routing_corrupt", "The selected original Kupo response is missing. State was preserved.", 409);
        session.messages.splice(index, 1);
        session.messages.push(structuredClone(response));
        break;
      }
      case "model.late_usage": {
        const usageIndex = session.usage.findIndex((usage) => usage.stepId === event.payload.usage.stepId);
        if (usageIndex >= 0) session.usage[usageIndex] = structuredClone(event.payload.usage);
        break;
      }
      case "tool.requested": session.pendingApproval = event.payload.approval; session.status = "waiting_input"; break;
      case "tool.decided":
        if (event.payload.actor === "autonomy" && (!event.payload.allow || !session.controls.automaticApprovals ||
          !["Autopilot", "Autopilot Max"].includes(session.controls.autonomy) || event.payload.ruleId !== `autonomy:${session.id}`)) {
          throw new MoguriError("approval_corrupt", "Automatic tool approval lost its actual user-selected session delegation.", 409);
        }
        if (event.payload.actor === "decision-provider") {
          const origin = event.payload.decisionOrigin, record = decisions.get(event.payload.decisionId ?? ""), entry = budgetEntries.get(origin?.stepId ?? "");
          if (!Value.Check(DecisionEvidenceSchema, origin) || origin.decisionId !== event.payload.decisionId ||
            !entry || entry.sessionId !== session.id || entry.turnId !== event.turn_id || entry.role !== "decision" || !successfulRoleEntry(entry) ||
            session.pendingApproval?.id !== event.payload.approvalId || session.pendingApproval.stepId !== event.step_id || !event.payload.ruleId ||
            record && (record.status !== "applied" || record.source.kind !== "tool" || record.source.approvalId !== event.payload.approvalId ||
            record.source.delegationId !== event.payload.ruleId || record.sessionId !== session.id || record.turnId !== event.turn_id ||
            record.source.parentStepId !== event.step_id || record.applied?.choice !== (event.payload.allow ? "allow" : "deny") ||
            record.stepId !== origin.stepId || record.inputDigest !== origin.inputDigest || record.actualInputDigest !== origin.modelInputDigest ||
            record.resultDigest !== origin.resultDigest || record.adviceDigest !== origin.adviceDigest || record.modelId !== entry.modelId || record.providerId !== entry.providerId))
            throw new MoguriError("decision_corrupt", "Tool advice lost its exact pending request, existing delegation or actual model actor.", 409);
        } else if (event.payload.decisionId !== undefined || event.payload.decisionOrigin !== undefined) throw new MoguriError("decision_corrupt", "A provider decision cannot impersonate human/policy approval.", 409);
        session.pendingApproval = null; if (session.status !== "stopping") session.status = "running"; break;
      case "tool.started":
        session.messages.push({ id: event.payload.call.id, turnId: event.turn_id ?? "", role: "tool", text: `${event.payload.call.name}\n`, timestamp: event.timestamp, toolCalls: [event.payload.call], outcome: "running" });
        break;
      case "tool.output": {
        const message = session.messages.find((message) => message.id === event.payload.callId);
        if (message) message.text = (message.text + event.payload.text).slice(-MAX_TEXT);
        break;
      }
      case "process.started": session.processes.push({ ...event.payload, turnId: event.turn_id ?? "", stepId: event.step_id ?? undefined, outcome: "running" }); break;
      case "process.ended": {
        const process = session.processes.find((process) => process.callId === event.payload.callId && process.pid === event.payload.pid && process.turnId === event.turn_id && process.stepId === event.step_id);
        if (!process) throw new MoguriError("process_owner", "Process completion has no original owned process observation.", 409);
        process.outcome = event.payload.outcome; break;
      }
      case "tool.completed": {
        const message: PublicMessage = {
          id: event.payload.call.id, turnId: event.turn_id ?? "", role: "tool", text: event.payload.text,
          timestamp: event.timestamp, toolCalls: [event.payload.call], outcome: event.payload.outcome,
        };
        const index = session.messages.findIndex((item) => item.id === message.id);
        if (index >= 0) session.messages[index] = message; else session.messages.push(message);
        for (const process of session.processes) if (process.callId === event.payload.call.id && !(event.payload.call.name === "debug" && event.payload.call.arguments.action === "start")) process.outcome = event.payload.outcome;
        break;
      }
      case "turn.stop_requested":
        session.status = "stopping";
        if (event.payload.holdQueue && session.queue.some((item) => !item.held)) {
          for (const item of session.queue) item.held = true;
          session.queueRevision++;
        }
        break;
      case "turn.stop_acknowledged": break;
      case "turn.finished":
        session.status = event.payload.outcome; session.turnId = null; session.pendingApproval = null; session.pendingQuestionId = null;
        session.finishedAt = event.timestamp;
        if (event.payload.outcome === "completed") session.completedAt = event.timestamp;
        session.lastError = event.payload.diagnostic; session.localFinishing = false;
        for (const usage of session.usage) if (usage.outcome === "running") usage.outcome = "unconfirmed";
        for (const process of session.processes) if (process.outcome === "running") process.outcome = "unconfirmed";
        if (event.payload.diagnostic) session.messages.push({
          id: event.id, turnId: event.turn_id ?? "", role: "notice", text: event.payload.diagnostic, timestamp: event.timestamp, outcome: event.payload.outcome,
        });
        break;
    }
  }
  validateBudgetPlanEntries([...budgetPlans.values()], [...budgetEntries.values()]);
  validateRoleSequenceLedger([...roleSequences.values()], [...budgetPlans.values()], [...budgetEntries.values()]);
  validateCompoundLedger([...compoundWorkflows.values()], [...budgetPlans.values()], [...budgetEntries.values()]);
  validateWinddownLedger([...winddowns.values()], [...budgetPlans.values()], [...budgetEntries.values()]);
  validateDecisionLedger([...decisions.values()], [...budgetEntries.values()]);
  for (const artifact of artifacts.values()) for (const source of artifact.sources) if (source.decisionOrigin) {
    const origin = source.decisionOrigin, entry = budgetEntries.get(origin.stepId);
    if (!Value.Check(DecisionEvidenceSchema, origin) || source.actor !== "decision-provider" || source.messageId !== origin.stepId ||
      !source.modelId || entry?.modelId !== source.modelId || entry.sessionId !== source.sessionId || entry.role !== "decision" || !successfulRoleEntry(entry))
      throw new MoguriError("decision_corrupt", "Independent automated-answer evidence lost its exact actual model/step/known charge, or changed the provider actor into a human.", 409);
  }
  for (const sequence of roleSequences.values()) if (sessions.has(sequence.sessionId)) {
    const controls = roleSequenceControls.get(sequence.id) ?? [];
    const control = controls[0];
    if (controls.length !== 1 || !control || control.event_type !== "turn.control_started" || control.payload.purpose !== "role.sequence" ||
      control.turn_id !== sequence.id || control.session_id !== sequence.sessionId || control.project_id !== sequence.projectId ||
      control.payload.promptDigest !== sequence.inputDigest || control.payload.controls.env !== sequence.env) throw new MoguriError("role_sequence_corrupt", "Role metadata lost its exact original owning control turn. No model or root authority was adopted.", 409);
  }
  return { projects: [...projects.values()], sessions: [...sessions.values()], policy, blockedProjects: [...blockedProjects], blockedSessions: [...blockedSessions], blockedWorkspaces: [...blockedWorkspaces],
    coordinationLinks: [...coordinationLinks.values()].filter((link) => sessions.has(link.parentId) && sessions.has(link.childId)),
    coordinationMessages: [...coordinationMessages.values()].filter((message) => sessions.has(message.toSessionId)),
    settings, lastModelSelection, chatWriters: [...chatWriters.values()], notificationSounds: [...notificationSounds.values()], registry: [...registry.values()], proposals: [...proposals.values()], knowledge: [...knowledge.values()],
    githubOperations: [...githubOperations.values()], linearOperations: [...linearOperations.values()], dependencyRegistries: [...dependencyRegistries.values()],
    jobs: [...jobs.values()], commandExecutions: [...commandExecutions.values()], oauthAuthorizations: [...oauthAuthorizations.values()], compactions: [...compactions.values()], planSaves: [...planSaves.values()],
    configurationProposals: [...configurationProposals.values()], attention: [...attention.values()],
    boards: [...boards.values()], issues: [...issues.values()], dependencyCaches: [...dependencyCaches.values()], projectWorkRuns: [...projectWorkRuns.values()],
    providerPriceCatalogs, providerPriceRevision,
    projectConfigurations: [...projectConfigurations.values()], projectFolders: [...projectFolders.values()], sessionGroups: [...sessionGroups.values()],
    sandboxPublications: [...sandboxPublications.values()].filter((publication) => artifacts.has(publication.id)),
    compoundWorkflows: [...compoundWorkflows.values()].filter((workflow) => artifacts.has(workflow.id)),
    winddowns: [...winddowns.values()].filter((record) => artifacts.has(record.id)),
    decisions: [...decisions.values()].filter((record) => artifacts.has(record.id)),
    candidateOwners: projectCandidateOwners(events, profileId).filter((owner) => artifacts.has(owner.id)), candidateCleanups: [...candidateCleanups.values()],
    artifacts: [...artifacts.values()], candidates: [...candidates.values()].filter((candidate) => artifacts.has(candidate.id)), candidateGenerations: [...candidateGenerations.values()].filter((generation) => artifacts.has(generation.id)), roleSequences: [...roleSequences.values()].filter((sequence) => artifacts.has(sequence.id)), questions: [...questions.values()], routings: [...routings.values()], budgetEntries: [...budgetEntries.values()], budgetPlans: [...budgetPlans.values()], budgetPolicy, operationEntries: [...operationEntries.values()], operationCoverage, repositoryObservations: [...repositoryObservations.values()], terminals: [...terminals.values()], terminalOwners: [...terminalOwners.values()], remoteMcpCalls: [...remoteMcpCalls.values()], executions: [...executions.values()], sandboxWorkspaces: [...sandboxWorkspaces.values()], sandboxExecutions: [...sandboxExecutions.values()].filter((execution) => artifacts.has(execution.id)), managedWorkspaces: [...managedWorkspaces.values()], changeSets: [...changeSets.values()] };
}
