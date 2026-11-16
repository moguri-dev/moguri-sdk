import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import * as vec from "sqlite-vec";
import { Value } from "typebox/value";
import { hasMilestoneCandidateHistory, hasMilestoneModelHistory } from "../../../packages/protocol/src/milestone-models.ts";
import { hasGithubPrCiHistory } from "../../../packages/protocol/src/github-workflows.ts";
import { hasMyWorkHistory } from "../../../packages/protocol/src/my-work.ts";
import { hasBackgroundServiceHistory } from "../../../packages/protocol/src/application.ts";
import { hasScriptInboxHistory, hasNativeScriptHistory, NATIVE_SCRIPT_SCHEMA } from "../../../packages/protocol/src/script-reviews.ts";
import { hasRepositoryWorkflowHistory } from "../../../packages/protocol/src/repository-trust.ts";
import { issueContent } from "./observation-content.ts";
import { hasNativeCandidateIdentityHistory, NATIVE_CANDIDATE_IDENTITY_SCHEMA } from "../../../packages/protocol/src/candidate-workspaces.ts";
import { attachmentDigests, eventTypes, hasChatTitleHistory, hasLiveDeliveryHistory, hasCombinedWorkspaceHistory, hasSessionControlsHistory, hasVoiceShortcutHistory, isRecord, MoguriError, PROFILE_ID, PROTOCOL_VERSION, projectCandidateGeneration, type CandidateGenerationRecord, type CommandResult, type EventInput, type StoredEvent } from "../../../packages/protocol/src/index.ts";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const workspaceSchemaMarkers = ["queued_slash_schema", "project_folder_actions_schema", "sandbox_multi_root_schema"] as const;
const combinedSchemaMarkers = ["model_selection_continuity_schema", "theme_catalog_schema", ...workspaceSchemaMarkers, "theme_model_workspace_convergence_schema"] as const;
const recoverySchemaMarkers = ["session_request_recovery_schema", "builtin_git_schema"] as const;
const commandToolSchemaMarkers = ["workflow_commands_schema", "tool_preferences_schema"] as const;
const safetyReviewSchemaMarkers = ["work_item_comments_schema", "repository_script_review_schema"] as const;
const intakeSchemaMarkers = ["model_failure_recovery_schema", "scheduled_prompts_schema", "kupo_modes_schema"] as const;
const ownedTransportSchemaMarkers = ["scheduled_native_preparation_schema", "owned_model_transport_schema", "transport_finishing_schema"] as const;
const retryCheckpointSchemaMarkers = ["native_retry_restaging_schema", "transport_checkpoint_schema"] as const;
export const sessionControlsSchemaMarkers = ["session_coordination_controls_schema", "session_pr_associations_schema", "voice_lifecycle_schema", "chat_outputs_schema", "language_app_tools_schema"] as const;
export const voiceShortcutSchemaMarker = "voice_shortcut_schema";
export const eventReadIndexesSchemaMarker = "event_read_indexes_schema";
export const chatTitlesSchemaMarker = "chat_titles_schema";
export const liveDeliverySchemaMarker = "live_delivery_schema";
export const repositoryManagementSchemaMarkers = ["repository_import_batches_schema", "repository_remote_changes_schema"] as const;
export const milestoneCapabilitySchemaMarkers = ["model_runtime_readiness_schema", "kupo_options_schema", "candidate_transports_schema"] as const;
export const githubPrCiSchemaMarker = "github_pr_ci_watch_schema";
export const myWorkSchemaMarker = "my_work_inbox_schema";
export const backgroundServiceSchemaMarker = "background_service_schema";
export const otlpExportSchemaMarker = "otlp_export_schema";
export const skillsRewindSchemaMarkers = ["local_skill_admission_schema", "turn_checkpoints_schema"] as const;
export const inboxSkillSchemaMarkers = ["session_inbox_schema", "explicit_skill_load_schema"] as const;
export const scriptInboxSchemaMarkers = ["script_review_inbox_schema", "tool_failure_schema"] as const;
export const repositoryWorkflowSchemaMarkers = ["repository_trust_schema", "project_workflow_defaults_schema", "partial_tool_recovery_schema"] as const;
export const nativeCandidateIdentitySchemaMarker = NATIVE_CANDIDATE_IDENTITY_SCHEMA;
export const nativeScriptSchemaMarker = NATIVE_SCRIPT_SCHEMA;
export const chatRepositoryBindingSchemaMarker = "chat_repository_binding_schema";
const chatRepositoryBindingEvents = ["session.repository_observed", "session.repository_dismissed", "session.project_bound"] as const;
export const capabilityDeletionSchemaMarker = "capability_deletion_schema";
export const externalVoiceModelSchemaMarker = "external_voice_model_schema";
export const claudeAgentSchemaMarker = "claude_agent_harness_schema";
const claudeAgentEvents = ["agent.session_bound", "agent.step_started", "agent.message", "agent.usage"];
const eventReadIndexes = [
  "CREATE INDEX events_profile_sequence ON events(json_extract(data,'$.profile_id'),seq)",
  "CREATE INDEX events_type_sequence ON events(json_extract(data,'$.event_type'),seq)",
] as const;
const startupHeader = "json_extract(data,'$.schema_version','$.event_type','$.id','$.timestamp','$.profile_id')";
const startupHeaderIndex = `CREATE INDEX events_startup_headers ON events(seq,${startupHeader},json_type(data,'$.payload'))`;
export const profileIndexId = (profileId: string, id: string) => profileId === PROFILE_ID ? id : `profile/${profileId}/${id}`;
interface Sealed { retention: 1; scope: string; iv: string; tag: string; data: string }
interface Scope { scope: string; projectId: string | null; sessionId: string | null }
export interface ForgetRequest { sessions?: string[]; projects?: string[]; artifacts?: string[]; checkpoints?: { sessionId: string; id: string }[] }
function seal(text: string, key: Buffer, scope: string, aad: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return { retention: 1, scope, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}
function unseal(value: unknown, key: Buffer, aad: string): string {
  if (!isRecord(value) || value.retention !== 1 || typeof value.iv !== "string" || typeof value.tag !== "string" || typeof value.data !== "string") throw new Error("Invalid retention payload. State was preserved.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
    decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(value.data, "base64")), decipher.final()]).toString("utf8");
  } catch { throw new Error("Retention payload or OS-keychain key is missing/corrupt. Restore the original key and state; do not delete your data."); }
}
function initialKey(path: string): Buffer {
  if (path !== ":memory:") throw new Error("Persistent EventStore requires an explicit retention key. Use the Moguri service/Node SDK to resolve its OS-keychain backend.");
  return randomBytes(32);
}
const artifactIdentity = (input: EventInput): string | null => input.event_type === "checkpoint.capture_recorded" ? `turn-checkpoint/${input.payload.capture.checkpointId}` :
  input.event_type === "checkpoint.recorded" ? `turn-checkpoint/${input.payload.checkpoint.id}` :
  input.event_type === "candidate.saved" ? input.payload.candidate.id :
  input.event_type === "my_work.source_recorded" ? `my-work-source/${input.payload.source.id}` :
  input.event_type === "my_work.refresh_recorded" ? input.payload.refresh.id :
  input.event_type === "candidate.transport_recorded" ? input.payload.transport.ownerKind === "candidate" ? input.payload.transport.ownerId : null :
  input.event_type === "repository.import_recorded" ? `repository-import/${input.payload.batch.id}` :
  input.event_type === "candidate.owner_bound" ? input.payload.owner.id :
  input.event_type === "model.completed" ? input.payload.candidateGenerationId ?? null :
  input.event_type === "notification.sound_saved" ? `notification-sound/${input.payload.sound.id}` :
  input.event_type === "github.operation_recorded" || input.event_type === "linear.operation_recorded" ? input.payload.operation.id :
  input.event_type === "knowledge.saved" ? `knowledge/${input.payload.record.id}` :
  input.event_type === "project.work_recorded" ? `project-work/${input.payload.run.id}` :
  input.event_type === "sandbox.execution_recorded" ? input.payload.execution.id :
  input.event_type === "sandbox.frame_recorded" ? input.payload.executionId :
  input.event_type === "sandbox.publication_recorded" ? input.payload.publication.id :
  input.event_type === "role.sequence_recorded" ? input.payload.sequence.id :
  input.event_type === "compound.recorded" ? input.payload.workflow.id :
  input.event_type === "winddown.recorded" ? input.payload.winddown.id :
  input.event_type === "decision.recorded" ? input.payload.decision.id :
  input.event_type === "candidate.generation_recorded" ? input.payload.generation.id :
  input.event_type === "artifact.saved" || input.event_type === "artifact.revised" ? input.payload.artifact.id :
  input.event_type === "job.started" ? (input.payload.job.repositoryImportId ? `repository-import/${input.payload.job.repositoryImportId}` : input.payload.job.operationId ?? input.payload.job.candidate?.candidateId ?? input.payload.job.sandboxPublicationId ?? input.payload.job.compoundWorkflowId ?? input.payload.job.winddownId ?? null) :
  input.event_type === "job.progress" || input.event_type === "job.finished" ? (input.payload.repositoryImportId ? `repository-import/${input.payload.repositoryImportId}` : input.payload.operationId ?? input.payload.candidateId ?? input.payload.sandboxPublicationId ?? input.payload.compoundWorkflowId ?? input.payload.winddownId ?? null) : null;
const artifactScope = (profileId: string, id: string): Scope => ({ scope: `profile/${profileId}/artifact/${encodeURIComponent(id)}`, projectId: null, sessionId: null });
function scopeFor(input: EventInput, artifactId: string | null = null): Scope {
  if ((input.event_type === "checkpoint.recorded" || input.event_type === "checkpoint.capture_recorded") && artifactId?.startsWith("turn-checkpoint/")) {
    const projectId = input.project_id ?? null, sessionId = input.session_id ?? null;
    if (!sessionId) throw new Error("A checkpoint needs its exact session retention owner.");
    return { scope: `profile/${input.profile_id}${projectId ? `/project/${projectId}` : ""}/session/${sessionId}/checkpoint/${encodeURIComponent(artifactId.slice("turn-checkpoint/".length))}`, projectId, sessionId };
  }
  if (artifactId) return artifactScope(input.profile_id, artifactId);
  if (input.event_type === "budget.plan_recorded") return { scope: `profile/${input.profile_id}`, projectId: null, sessionId: null };
  const projectId = input.project_id ?? null;
  const sessionId = input.session_id ?? null;
  return { scope: `profile/${input.profile_id}${projectId ? `/project/${projectId}` : ""}${sessionId ? `/session/${sessionId}` : ""}`, projectId, sessionId };
}
function references(input: EventInput): string[] {
  switch (input.event_type) {
    case "checkpoint.capture_recorded": return input.payload.capture.workspaceDigest ? [input.payload.capture.workspaceDigest] : [];
    case "checkpoint.recorded": return [input.payload.checkpoint.stateDigest, input.payload.checkpoint.beforeDigest, input.payload.checkpoint.terminal?.afterDigest ?? null].filter((hash): hash is string => hash !== null);
    case "rewind.recorded": return [input.payload.record.inputDigest, input.payload.record.contextDigest, input.payload.record.parentContextDigest ?? null, input.payload.record.planDigest ?? null, input.payload.record.resultDigest ?? null].filter((hash): hash is string => hash !== null);
    case "session.rewound": return [input.payload.contextDigest, ...(input.payload.parentContextDigest ? [input.payload.parentContextDigest] : [])];
    case "skill.admission_recorded": return [input.payload.admission.snapshotDigest];
    case "my_work.refresh_recorded": return [input.payload.refresh.inputDigest, input.payload.refresh.resultDigest,
      ...input.payload.refresh.sources.map((source) => source.observationDigest)].filter((value): value is string => value !== null);
    case "candidate.transport_recorded": return input.payload.transport.resultDigest ? [input.payload.transport.resultDigest] : [];
    case "repository.import_recorded": return [input.payload.batch.inputDigest, input.payload.batch.reviewDigest];
    case "chat.title_recorded": return [input.payload.title.inputDigest, input.payload.title.actualInputDigest, input.payload.title.resultDigest].filter((value): value is string => value !== null);
    case "model.request_bound": return [input.payload.inputDigest];
    case "model.failure_recorded": return input.payload.failure.requestDigest ? [input.payload.failure.requestDigest] : [];
    case "prompt.schedule_recorded": return input.payload.prompt.attachments.flatMap(attachmentDigests);
    case "slash.command_recorded": return [input.payload.execution.inputDigest, input.payload.execution.resultDigest].filter((value): value is string => value !== null);
    case "slash.live_recorded": return [input.payload.control.inputDigest];
    case "slash.continuation_chosen": return [input.payload.choice.inputDigest];
    case "tool.completed": return [...(input.payload.rawDigest ? [input.payload.rawDigest] : []), ...(input.payload.attachments ?? []).flatMap(attachmentDigests)];
    case "script.review_recorded": return [input.payload.review.source.digest,
      ...(input.payload.review.nativeExecution?.resultDigest ? [input.payload.review.nativeExecution.resultDigest] : [])];
    case "script.review_approved": return [input.payload.approval.sourceDigest];
    case "repository.trust_recorded": return [input.payload.trust.baselineDigest];
    case "repository.script_reserved": return [input.payload.attempt.baselineDigest, input.payload.attempt.sourceDigest];
    case "candidate.owner_bound": {
      const evidence = input.payload.owner.generationEvidence;
      return evidence ? [evidence.inputDigest, evidence.resultDigest, evidence.proposalDocumentDigest] : [];
    }
    case "notification.sound_saved": return [input.payload.sound.contentDigest];
    case "github.operation_recorded": return [input.payload.operation.inputDigest, input.payload.operation.reviewDigest,
      input.payload.operation.resultDigest, input.payload.operation.ci?.observationDigest ?? null].filter((hash): hash is string => hash !== null);
    case "linear.operation_recorded": return [input.payload.operation.inputDigest, input.payload.operation.resultDigest].filter((hash): hash is string => hash !== null);
    case "knowledge.saved": return [input.payload.record.contentDigest];
    case "project.work_recorded": return [input.payload.run.source.contentDigest];
    case "sandbox.workspace_recorded": return [input.payload.workspace.inputDigest];
    case "sandbox.execution_recorded": return [input.payload.execution.inputDigest, input.payload.execution.resultDigest].filter((hash): hash is string => hash !== null);
    case "sandbox.publication_recorded": return [input.payload.publication.inputDigest, input.payload.publication.resultDigest,
      input.payload.publication.documentDigest, input.payload.publication.operationDigest].filter((hash): hash is string => hash !== null);
    case "queue.enqueued": return input.payload.item.attachments.flatMap(attachmentDigests);
    case "queue.edited": return input.payload.attachments?.flatMap(attachmentDigests) ?? [];
    case "session.created": return [...(input.payload.contextDigest ? [input.payload.contextDigest] : []), ...(input.payload.parentSnapshotDigest ? [input.payload.parentSnapshotDigest] : []), ...(input.payload.pasteFiles ?? []).flatMap(attachmentDigests), ...(input.payload.documents ?? []).flatMap(attachmentDigests)];
    case "turn.started": return [...(input.payload.promptDigest ? [input.payload.promptDigest] : []), ...input.payload.item.attachments.flatMap(attachmentDigests),
      ...(input.payload.sideContext ? [input.payload.sideContext.contextDigest, ...input.payload.sideContext.pasteFiles.flatMap(attachmentDigests), ...input.payload.sideContext.documents.flatMap(attachmentDigests)] : [])];
    case "turn.prompt_bound": return [input.payload.promptDigest];
    case "turn.control_started": return [input.payload.purpose === "plan.save" ? input.payload.intentDigest : input.payload.promptDigest];
    case "plan.save_recorded": return [input.payload.save.inputDigest, input.payload.save.resultDigest].filter((hash): hash is string => hash !== null);
    case "mcp.remote_recorded": return [input.payload.call.intentDigest, input.payload.call.resultDigest].filter((hash): hash is string => hash !== null);
    case "compaction.saved": return [input.payload.compaction.inputDigest, input.payload.compaction.resultDigest, input.payload.compaction.replacementDigest].filter((hash): hash is string => hash !== null);
    case "draft.saved": return input.payload.attachments.flatMap(attachmentDigests);
    case "skill.used": case "skill.loaded": return [input.payload.contentDigest];
    case "steer.applied": return input.payload.item.attachments.flatMap(attachmentDigests);
    case "model.completed": return [input.payload.contextDigest];
    case "agent.message": return [input.payload.contextDigest];
    case "routing.response_selected": return [input.payload.contextDigest];
    case "capability.saved": return [input.payload.entry.contentDigest];
    case "capability.proposed": return [input.payload.proposal.contentDigest];
    case "artifact.saved": return [input.payload.artifact.contentDigest];
    case "artifact.revised": return [input.payload.artifact.contentDigest, ...(input.payload.artifact.sources ?? []).flatMap((source) => source.decisionOrigin ?
      [source.decisionOrigin.inputDigest, source.decisionOrigin.modelInputDigest, source.decisionOrigin.resultDigest, source.decisionOrigin.adviceDigest] : [])];
    case "question.answered": {
      const origin = input.payload.answer.decisionOrigin;
      return origin ? [origin.inputDigest, origin.modelInputDigest, origin.resultDigest, origin.adviceDigest] : [];
    }
    case "tool.decided":
    case "steering.applied": {
      const origin = input.payload.decisionOrigin;
      return origin ? [origin.inputDigest, origin.modelInputDigest, origin.resultDigest, origin.adviceDigest] : [];
    }
    case "candidate.saved": {
      const candidate = input.payload.candidate, origin = candidate.roleOrigin;
      return [candidate.documentDigest, candidate.stageResultDigest, candidate.applyResultDigest,
        ...(origin ? [origin.sequenceInputDigest, origin.roleInputDigest, origin.resultDigest] : []),
        ...(candidate.compoundOrigin ? [candidate.compoundOrigin.workflowInputDigest, candidate.compoundOrigin.roleInputDigest, candidate.compoundOrigin.resultDigest] : [])].filter((hash): hash is string => hash !== null);
    }
    case "candidate.generation_recorded": return [input.payload.generation.inputDigest, input.payload.generation.resultDigest, input.payload.generation.proposalDocumentDigest].filter((hash): hash is string => hash !== null);
    case "role.sequence_recorded": return [input.payload.sequence.inputDigest, ...input.payload.sequence.steps.flatMap((step) => [step.inputDigest, step.resultDigest])].filter((hash): hash is string => hash !== null);
    case "compound.recorded": return [input.payload.workflow.inputDigest, ...input.payload.workflow.steps.flatMap((step) => [step.inputDigest, step.resultDigest]),
      ...input.payload.workflow.validations.flatMap((validation) => [validation.documentDigest, validation.resultDigest])].filter((hash): hash is string => hash !== null);
    case "winddown.recorded": return [input.payload.winddown.inputDigest, input.payload.winddown.step.inputDigest, input.payload.winddown.step.resultDigest,
      input.payload.winddown.commitDocumentDigest, input.payload.winddown.commit?.resultDigest ?? null, input.payload.winddown.commit?.inspection?.inputDigest ?? null,
      ...(input.payload.winddown.version !== 1 && input.payload.winddown.remoteAcceptance ? [input.payload.winddown.remoteAcceptance.inputDigest] : [])].filter((hash): hash is string => hash !== null);
    case "decision.recorded": return [input.payload.decision.inputDigest, input.payload.decision.actualInputDigest, input.payload.decision.resultDigest, input.payload.decision.adviceDigest].filter((hash): hash is string => hash !== null);
    case "configuration.proposed": return [input.payload.proposal.contentDigest, input.payload.proposal.baseDigest];
    case "job.started": return input.payload.job.resultDigest ? [input.payload.job.resultDigest] : [];
    case "job.finished": return input.payload.resultDigest ? [input.payload.resultDigest] : [];
    default: return [];
  }
}
export class EventStore {
  readonly db: DatabaseSync;
  private keys = new Map<string, Buffer>();
  private pending = new Map<string, string>();
  constructor(readonly path: string, private readonly masterKey = initialKey(path), keyId: string = randomUUID(), readonly profileId: string = PROFILE_ID) {
    if (masterKey.byteLength !== 32) throw new Error("A retention master key must contain exactly 32 bytes.");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(profileId)) throw new Error("A store view needs an explicit safe profile identity. No Default fallback was used.");
    this.db = new DatabaseSync(path, { allowExtension: true });
    try {
      const version = Number(this.db.prepare("PRAGMA user_version").get()?.user_version);
      if (version > PROTOCOL_VERSION) throw new Error("This state uses a newer schema. Upgrade Moguri; do not delete your data.");
      const retentionTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='retention_metadata'").get();
      this.validateInteractionLineage(version, Boolean(retentionTable));
      if (version < 70 && retentionTable && this.db.prepare("SELECT value FROM retention_metadata WHERE id='model_preferences_schema'").get()) {
        throw new Error("Invalid pre-70 model preference lineage marker. State was preserved.");
      }
      if (version < 68 && retentionTable && this.db.prepare("SELECT value FROM retention_metadata WHERE id='composer_workflows_schema'").get()) {
        throw new Error("Invalid pre-68 composer workflow lineage marker. State was preserved.");
      }
      if (version < 67 && retentionTable && this.db.prepare("SELECT value FROM retention_metadata WHERE id='side_context_schema'").get()) {
        throw new Error("Invalid pre-67 side context lineage marker. State was preserved.");
      }
      if (version < 66 && retentionTable && this.db.prepare("SELECT value FROM retention_metadata WHERE id='retained_telemetry_schema'").get()) {
        throw new Error("Invalid pre-66 retained telemetry lineage marker. State was preserved.");
      }
      if (version < 64 && retentionTable && this.db.prepare("SELECT value FROM retention_metadata WHERE id='kanban_interactions_schema'").get()) {
        throw new Error("Invalid pre-64 Kanban interactions lineage marker. State was preserved.");
      }
      if (version < 65 && retentionTable && this.db.prepare("SELECT value FROM retention_metadata WHERE id='session_reliability_schema'").get()) {
        throw new Error("Invalid pre-65 session reliability lineage marker. State was preserved.");
      }
      if (version < 63 && retentionTable && this.db.prepare("SELECT value FROM retention_metadata WHERE id='session_kupo_kanban_schema'").get()) {
        throw new Error("Invalid pre-63 session/Kupo/Kanban lineage marker. State was preserved.");
      }
      if (version < 61 && retentionTable && this.db.prepare("SELECT value FROM retention_metadata WHERE id='automatic_kupo_schema'").get()) {
        throw new Error("Invalid pre-61 automatic Kupo lineage marker. State was preserved.");
      }
      if (version < 62 && retentionTable &&
        this.db.prepare("SELECT value FROM retention_metadata WHERE id='project_kanban_schema'").get()) {
        throw new Error("Invalid pre-62 project Kanban lineage marker. State was preserved.");
      }
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON");
      if (version === 0) this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, data TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE receipts (id TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL);
        CREATE TABLE blobs (digest TEXT PRIMARY KEY, content TEXT NOT NULL);
        CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
        CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
        PRAGMA user_version=1;
        COMMIT;
      `);
      if (version < 2) this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE memory_files (project_id TEXT NOT NULL,path TEXT NOT NULL,digest TEXT NOT NULL,mtime REAL NOT NULL,size INTEGER NOT NULL,PRIMARY KEY(project_id,path));
        CREATE TABLE memory_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT NOT NULL,path TEXT NOT NULL,digest TEXT NOT NULL,text TEXT NOT NULL);
        CREATE INDEX memory_chunks_scope ON memory_chunks(project_id,path);
        CREATE TABLE memory_graph_nodes (project_id TEXT NOT NULL,id TEXT NOT NULL,path TEXT NOT NULL,label TEXT NOT NULL,kind TEXT NOT NULL,PRIMARY KEY(project_id,id));
        CREATE TABLE memory_graph_edges (project_id TEXT NOT NULL,source TEXT NOT NULL,target TEXT NOT NULL,kind TEXT NOT NULL,PRIMARY KEY(project_id,source,target,kind));
        PRAGMA user_version=2;
        COMMIT;
      `);
      if (version < 3) this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE dependency_cache_objects (cache_key TEXT PRIMARY KEY,integrity TEXT NOT NULL,bytes INTEGER NOT NULL,verified_at TEXT NOT NULL);
        PRAGMA user_version=3;
        COMMIT;
      `);
      if (version < 4) this.migrateRetention(keyId);
      if (version < 5) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('model_controls_schema','1');
        PRAGMA user_version=5; COMMIT;`);
      if (version < 6) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('engagement_schema','1');
        PRAGMA user_version=6; COMMIT;`);
      if (version < 7) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('runtime_foundation_schema','1');
        PRAGMA user_version=7; COMMIT;`);
      if (version < 8) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('execution_transport_schema','1');
        PRAGMA user_version=8; COMMIT;`);
      if (version < 9) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('managed_workspace_schema','1');
        PRAGMA user_version=9; COMMIT;`);
      const existing = this.db.prepare("SELECT scope,payload FROM retention_keys LIMIT 1").get();
      if (existing) this.key({ scope: String(existing.scope), projectId: null, sessionId: null }, false);
      if (version < 10) this.migrateArtifacts();
      if (version < 11) this.db.exec(`BEGIN IMMEDIATE; INSERT INTO retention_metadata(id,value) VALUES ('structured_question_schema','1'); PRAGMA user_version=11; COMMIT;`);
      if (version < 12) this.db.exec(`BEGIN IMMEDIATE; INSERT INTO retention_metadata(id,value) VALUES ('artifact_repository_schema','1'); PRAGMA user_version=12; COMMIT;`);
      if (version < 13) this.db.exec(`BEGIN IMMEDIATE; INSERT INTO retention_metadata(id,value) VALUES ('budget_ledger_schema','1'); PRAGMA user_version=13; COMMIT;`);
      if (version < 14) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE receipts_v14(profile_id TEXT NOT NULL,id TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(profile_id,id));
        INSERT INTO receipts_v14 SELECT 'default',id,digest,result FROM receipts;
        DROP TABLE receipts; ALTER TABLE receipts_v14 RENAME TO receipts;
        INSERT INTO retention_metadata(id,value) VALUES ('profile_scope_schema','1');
        PRAGMA user_version=14; COMMIT;`);
      if (version < 15) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('guided_advice_schema','1');
        PRAGMA user_version=15; COMMIT;`);
      if (version < 16) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('single_routing_schema','1');
        PRAGMA user_version=16; COMMIT;`);
      if (version < 17) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('remote_workspace_read_schema','1');
        PRAGMA user_version=17; COMMIT;`);
      if (version < 18) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('stream_telemetry_schema','1');
        PRAGMA user_version=18; COMMIT;`);
      if (version < 19) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('context_compaction_schema','1');
        PRAGMA user_version=19; COMMIT;`);
      if (version < 20) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('remote_plan_save_schema','1');
        PRAGMA user_version=20; COMMIT;`);
      if (version < 21) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('operation_metrics_schema','1');
        PRAGMA user_version=21; COMMIT;`);
      if (version < 22) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('repository_attribution_schema','1');
        PRAGMA user_version=22; COMMIT;`);
      if (version < 23) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('terminal_ownership_schema','1');
        PRAGMA user_version=23; COMMIT;`);
      if (version < 24) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('remote_mcp_schema','1');
        PRAGMA user_version=24; COMMIT;`);
      if (version < 25) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('remote_terminal_schema','1');
        PRAGMA user_version=25; COMMIT;`);
      if (version < 26) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('remote_repository_schema','1');
        PRAGMA user_version=26; COMMIT;`);
      if (version < 27) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE memory_scopes(locator TEXT PRIMARY KEY,scope_id TEXT NOT NULL UNIQUE,profile_id TEXT NOT NULL,project_id TEXT NOT NULL,workspace_id TEXT,metadata TEXT NOT NULL);
        CREATE INDEX memory_scopes_owner ON memory_scopes(profile_id,project_id,workspace_id);
        INSERT INTO retention_metadata(id,value) VALUES ('remote_memory_schema','1');
        PRAGMA user_version=27; COMMIT;`);
      if (version < 28) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('candidate_workflow_schema','1');
        PRAGMA user_version=28; COMMIT;`);
      if (version < 29) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('candidate_execution_schema','1');
        PRAGMA user_version=29; COMMIT;`);
      if (version < 30) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('budget_planning_schema','1');
        PRAGMA user_version=30; COMMIT;`);
      if (version < 31) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('candidate_generation_schema','1');
        PRAGMA user_version=31; COMMIT;`);
      if (version < 32) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('role_sequence_schema','1');
        PRAGMA user_version=32; COMMIT;`);
      if (version < 33) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('candidate_role_schema','1');
        PRAGMA user_version=33; COMMIT;`);
      if (version < 34) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('model_evidence_schema','1');
        PRAGMA user_version=34; COMMIT;`);
      if (version < 35) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('owned_role_contract_schema','1');
        PRAGMA user_version=35; COMMIT;`);
      if (version < 36) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('paste_file_schema','1');
        PRAGMA user_version=36; COMMIT;`);
      if (version < 37) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('native_execution_schema','1');
        PRAGMA user_version=37; COMMIT;`);
      if (version < 38) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('compound_workflow_schema','1');
        PRAGMA user_version=38; COMMIT;`);
      if (version < 39) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('budget_winddown_schema','1');
        PRAGMA user_version=39; COMMIT;`);
      if (version < 40) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('owned_decision_schema','1');
        PRAGMA user_version=40; COMMIT;`);
      if (version < 41) this.db.exec("BEGIN IMMEDIATE; PRAGMA user_version=41; COMMIT;");
      if (version < 42) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('task_progress_schema','1');
        PRAGMA user_version=42; COMMIT;`);
      if (version < 43) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('document_attachment_schema','1');
        PRAGMA user_version=43; COMMIT;`);
      if (version < 53) this.migrateDesktopMerge(version);
      if (version < 54) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('session_indicators_schema','1');
        PRAGMA user_version=54; COMMIT;`);
      if (this.db.prepare("SELECT value FROM retention_metadata WHERE id='session_indicators_schema'").get()?.value !== "1") {
        throw new Error("Missing or invalid retained session indicator schema marker. State was preserved.");
      }
      if (version < 55) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('model_defaults_schema','1');
        PRAGMA user_version=55; COMMIT;`);
      if (this.db.prepare("SELECT value FROM retention_metadata WHERE id='model_defaults_schema'").get()?.value !== "1") {
        throw new Error("Missing or invalid retained model default schema marker. State was preserved.");
      }
      if (version < 56) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('browser_control_schema','1');
        PRAGMA user_version=56; COMMIT;`);
      if (this.db.prepare("SELECT value FROM retention_metadata WHERE id='browser_control_schema'").get()?.value !== "1") {
        throw new Error("Missing or invalid browser control schema marker. State was preserved.");
      }
      const candidateMarker = this.db.prepare("SELECT value FROM retention_metadata WHERE id='candidate_retention_schema'").get();
      const toolingMarker = this.db.prepare("SELECT value FROM retention_metadata WHERE id='lean_tooling_schema'").get();
      const convergenceMarker = this.db.prepare("SELECT value FROM retention_metadata WHERE id='lean_tooling_convergence_schema'").get();
      const tooling57 = version === 57 && toolingMarker?.value === "1" && !candidateMarker && !convergenceMarker;
      if (version === 57 && !tooling57 && !(candidateMarker?.value === "1" && !toolingMarker && !convergenceMarker) ||
        version < 57 && (toolingMarker || convergenceMarker)) throw new Error("Invalid protocol-57 lineage markers. State was preserved.");
      if (version < 57) this.migrateCandidateRetention();
      else if (tooling57) this.migrateCandidateRetention(true);
      if (this.db.prepare("SELECT value FROM retention_metadata WHERE id='candidate_retention_schema'").get()?.value !== "1") {
        throw new Error("Missing or invalid candidate retention schema marker. State was preserved.");
      }
      if (version < 58 && !tooling57) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('lean_tooling_schema','1');
        INSERT INTO retention_metadata(id,value) VALUES ('lean_tooling_convergence_schema','1');
        PRAGMA user_version=58; COMMIT;`);
      if (this.db.prepare("SELECT value FROM retention_metadata WHERE id='lean_tooling_schema'").get()?.value !== "1" ||
        this.db.prepare("SELECT value FROM retention_metadata WHERE id='lean_tooling_convergence_schema'").get()?.value !== "1") {
        throw new Error("Missing or invalid lean tooling/convergence schema marker. State was preserved.");
      }
      this.migrateWorkflowFeatures(version);
      if (version < 64) {
        if (this.events().some((event) => event.event_type === "session.continue_work_chosen" ||
          event.event_type === "issue.saved" && (event.payload.issue.order !== undefined || event.payload.issue.github) ||
          event.event_type === "board.saved" && (event.payload.board.githubSync || event.payload.board.githubSource))) {
          throw new Error("Kanban interaction history cannot be relabelled without its original schema marker. State was preserved.");
        }
        this.db.exec(`BEGIN IMMEDIATE;
          INSERT INTO retention_metadata(id,value) VALUES ('kanban_interactions_schema','1');
          PRAGMA user_version=64; COMMIT;`);
      }
      if (this.db.prepare("SELECT value FROM retention_metadata WHERE id='kanban_interactions_schema'").get()?.value !== "1") {
        throw new Error("Missing or invalid Kanban interactions schema marker. State was preserved.");
      }
      if (version < 65) {
        if (this.events().some((event) => event.event_type === "session.created" && (Object.hasOwn(event.payload, "repositories") || Object.hasOwn(event.payload, "projectFolderId")) ||
          event.event_type === "settings.updated" && event.payload.settings.permissions.remembered?.some((grant) => grant.target.kind === "tool" && grant.target.argumentsDigest === undefined))) {
          throw new Error("Session reliability history cannot be relabelled without its original schema marker. State was preserved.");
        }
        this.db.exec(`BEGIN IMMEDIATE;
          INSERT INTO retention_metadata(id,value) VALUES ('session_reliability_schema','1');
          PRAGMA user_version=65; COMMIT;`);
      }
      if (this.db.prepare("SELECT value FROM retention_metadata WHERE id='session_reliability_schema'").get()?.value !== "1") {
        throw new Error("Missing or invalid session reliability schema marker. State was preserved.");
      }
      if (version < 66) {
        this.db.exec(`BEGIN IMMEDIATE;
          INSERT INTO retention_metadata(id,value) VALUES ('retained_telemetry_schema','1');
          PRAGMA user_version=66; COMMIT;`);
      }
      if (this.db.prepare("SELECT value FROM retention_metadata WHERE id='retained_telemetry_schema'").get()?.value !== "1") {
        throw new Error("Missing or invalid retained telemetry schema marker. State was preserved.");
      }
      if (version < 67) {
        if (this.events().some((event) => event.event_type === "turn.started" && event.payload.sideContext !== undefined)) {
          throw new Error("Side context history cannot be relabelled without its original schema marker. State was preserved.");
        }
        this.db.exec(`BEGIN IMMEDIATE;
          INSERT INTO retention_metadata(id,value) VALUES ('side_context_schema','1');
          PRAGMA user_version=67; COMMIT;`);
      }
      if (this.db.prepare("SELECT value FROM retention_metadata WHERE id='side_context_schema'").get()?.value !== "1") {
        throw new Error("Missing or invalid side context schema marker. State was preserved.");
      }
      if (version < 68) {
        if (this.events().some((event) => (event.event_type === "queue.enqueued" || event.event_type === "turn.started") && event.payload.item.sidePromptOrigin !== undefined)) {
          throw new Error("Composer side prompt history cannot be relabelled without its original schema marker. State was preserved.");
        }
        this.db.exec(`BEGIN IMMEDIATE;
          INSERT INTO retention_metadata(id,value) VALUES ('composer_workflows_schema','1');
          PRAGMA user_version=68; COMMIT;`);
      }
      if (this.db.prepare("SELECT value FROM retention_metadata WHERE id='composer_workflows_schema'").get()?.value !== "1") {
        throw new Error("Missing or invalid composer workflow schema marker. State was preserved.");
      }
      if (version < 69) this.db.exec("PRAGMA user_version=69;");
      if (version < 70) {
        if (this.events().some((event) => event.event_type === "settings.updated" && Object.hasOwn(event.payload.settings, "modelPreferences"))) {
          throw new Error("Model preference history cannot be relabelled without its original schema marker. State was preserved.");
        }
        this.db.exec(`BEGIN IMMEDIATE;
          INSERT INTO retention_metadata(id,value) VALUES ('model_preferences_schema','1');
          PRAGMA user_version=70; COMMIT;`);
      }
      if (this.db.prepare("SELECT value FROM retention_metadata WHERE id='model_preferences_schema'").get()?.value !== "1") {
        throw new Error("Missing or invalid model preference schema marker. State was preserved.");
      }
      if (version < 71) this.db.exec("PRAGMA user_version=71;");
      if (version < 72) {
        if (this.db.prepare("SELECT value FROM retention_metadata WHERE id='chat_home_schema'").get()) {
          throw new Error("Premature Home-backed chat schema marker. State was preserved without relabelling.");
        }
        if (this.events().some((event) => event.event_type === "session.home_bound" || event.event_type === "chat.writer_recorded" ||
          event.event_type === "session.created" && event.payload.homeRoot !== undefined)) {
          throw new Error("Home-backed chat history cannot be relabelled without its original schema marker. State was preserved.");
        }
        this.db.exec(`BEGIN IMMEDIATE;
          INSERT INTO retention_metadata(id,value) VALUES ('chat_home_schema','1');
          PRAGMA user_version=72; COMMIT;`);
      }
      if (this.db.prepare("SELECT value FROM retention_metadata WHERE id='chat_home_schema'").get()?.value !== "1") {
        throw new Error("Missing or invalid Home-backed chat schema marker. State was preserved.");
      }
      if (version < 73) {
        if (this.db.prepare("SELECT value FROM retention_metadata WHERE id='native_web_policy_schema'").get()) {
          throw new Error("Premature native website policy schema marker. State was preserved without relabelling.");
        }
        if (this.events().some((event) => event.event_type === "settings.updated" && Object.hasOwn(event.payload.settings.permissions, "webAllowlist"))) {
          throw new Error("Website allowance history cannot be relabelled without its original schema marker. State was preserved.");
        }
        this.db.exec(`BEGIN IMMEDIATE;
          INSERT INTO retention_metadata(id,value) VALUES ('native_web_policy_schema','1');
          PRAGMA user_version=73; COMMIT;`);
      }
      if (this.db.prepare("SELECT value FROM retention_metadata WHERE id='native_web_policy_schema'").get()?.value !== "1") {
        throw new Error("Missing or invalid native website policy schema marker. State was preserved.");
      }
      if (version < 74) this.db.exec("PRAGMA user_version=74;");
      if (version < 75) this.db.exec("PRAGMA user_version=75;");
      if (version < 76) this.db.exec("PRAGMA user_version=76;");
      if (version < 80) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          for (const id of combinedSchemaMarkers) if (!this.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(id)) {
            this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(id);
          }
          this.db.exec("PRAGMA user_version=80; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 81) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          for (const id of recoverySchemaMarkers) this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(id);
          this.db.exec("PRAGMA user_version=81; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 82) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          for (const id of commandToolSchemaMarkers) this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(id);
          this.db.exec("PRAGMA user_version=82; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 83) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          for (const id of safetyReviewSchemaMarkers) this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(id);
          this.db.exec("PRAGMA user_version=83; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 84) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          for (const id of intakeSchemaMarkers) this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(id);
          this.db.exec("PRAGMA user_version=84; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 85) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          for (const id of ownedTransportSchemaMarkers) this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(id);
          this.db.exec("PRAGMA user_version=85; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 86) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          for (const id of retryCheckpointSchemaMarkers) this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(id);
          this.db.exec("PRAGMA user_version=86; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 87) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          for (const id of sessionControlsSchemaMarkers) this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(id);
          this.db.exec("PRAGMA user_version=87; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 88) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(voiceShortcutSchemaMarker);
          this.db.exec("PRAGMA user_version=88; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 89) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          for (const sql of eventReadIndexes) this.db.exec(sql);
          this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(eventReadIndexesSchemaMarker);
          this.db.exec("PRAGMA user_version=89; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 90) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(chatTitlesSchemaMarker);
          this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(liveDeliverySchemaMarker);
          this.db.exec("PRAGMA user_version=90; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 91) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          for (const id of repositoryManagementSchemaMarkers) this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(id);
          this.db.exec("PRAGMA user_version=91; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 92) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          for (const id of milestoneCapabilitySchemaMarkers) this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(id);
          this.db.exec("PRAGMA user_version=92; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 93) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(githubPrCiSchemaMarker);
          this.db.exec("PRAGMA user_version=93; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 94) {
        this.db.exec("BEGIN IMMEDIATE");
        try { this.db.exec("PRAGMA user_version=94; COMMIT;"); }
        catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 95) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(myWorkSchemaMarker);
          this.db.exec("PRAGMA user_version=95; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 96) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(backgroundServiceSchemaMarker);
          this.db.exec("PRAGMA user_version=96; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 97) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(otlpExportSchemaMarker);
          this.db.exec("PRAGMA user_version=97; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 98) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          for (const marker of skillsRewindSchemaMarkers) this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(marker);
          this.db.exec("PRAGMA user_version=98; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 99) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          for (const marker of inboxSkillSchemaMarkers) this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(marker);
          this.db.exec("PRAGMA user_version=99; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 100) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          for (const marker of scriptInboxSchemaMarkers) this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(marker);
          this.db.exec("PRAGMA user_version=100; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 101) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          for (const marker of repositoryWorkflowSchemaMarkers) this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(marker);
          this.db.exec("PRAGMA user_version=101; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 102) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(nativeCandidateIdentitySchemaMarker);
          this.db.exec("PRAGMA user_version=102; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 103) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(nativeScriptSchemaMarker);
          this.db.exec("PRAGMA user_version=103; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 104) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          const existing = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='events_startup_headers'").get();
          if (existing && existing.sql !== startupHeaderIndex) throw new Error("Invalid event read index events_startup_headers. Original state was preserved.");
          if (!existing) this.db.exec(startupHeaderIndex);
          this.db.exec("PRAGMA user_version=104; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 105) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(chatRepositoryBindingSchemaMarker);
          this.db.exec("PRAGMA user_version=105; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 106) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(capabilityDeletionSchemaMarker);
          this.db.exec("PRAGMA user_version=106; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 107) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(externalVoiceModelSchemaMarker);
          this.db.exec("PRAGMA user_version=107; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      if (version < 108) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(claudeAgentSchemaMarker);
          this.db.exec("PRAGMA user_version=108; COMMIT;");
        } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
      }
      for (const row of this.db.prepare(`SELECT seq,${startupHeader} AS header,json_type(data,'$.payload') AS payload_type
        FROM events INDEXED BY events_startup_headers ORDER BY seq`).all()) {
        const header: unknown = JSON.parse(String(row.header));
        if (!Array.isArray(header)) throw new Error(`Unsupported or corrupt durable event header at sequence ${row.seq}. State was preserved.`);
        this.validEvent({ schema_version: header[0], event_type: header[1], id: header[2], timestamp: header[3], profile_id: header[4],
          payload: row.payload_type === "object" ? {} : null }, Number(row.seq));
      }
    } catch (error) { this.db.close(); throw error; }
  }
  private validateInteractionLineage(version: number, hasMetadata: boolean): void {
    const marker = (id: string) => hasMetadata ? this.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(id)?.value : undefined;
    const require = (id: string, label: string) => { if (marker(id) !== "1") throw new Error(`Missing or invalid ${label} schema marker. Original state was preserved.`); };
    if (version >= 104 && this.db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='events_startup_headers' AND tbl_name='events'").get()?.sql !== startupHeaderIndex) {
      throw new Error("Missing or invalid event read index events_startup_headers. Original state was preserved; no index or history was silently rebuilt.");
    }
    const recoveryLineage = () => {
      for (const id of milestoneCapabilitySchemaMarkers) {
        if (version < 92 && marker(id) !== undefined) throw new Error("Premature milestone capability schema marker. Original state was preserved.");
        if (version >= 92) require(id, "milestone capability");
      }
      if (version >= 4 && version < 92) {
        const events = this.readEvents(0, true, version < 10);
        if (hasMilestoneModelHistory(events) || hasMilestoneCandidateHistory(events)) {
          throw new Error("Actual milestone capability history cannot become a pre-92 lineage. Original state was preserved.");
        }
      }
      if (version < 93 && marker(githubPrCiSchemaMarker) !== undefined) throw new Error("Premature PR CI-watch schema marker. Original state was preserved.");
      if (version >= 93) require(githubPrCiSchemaMarker, "PR CI-watch");
      if (version >= 4 && version < 93 && hasGithubPrCiHistory(this.readEvents(0, true, version < 10))) {
        throw new Error("Actual PR CI-watch history cannot become a pre-93 lineage. Original state was preserved.");
      }
      if (version < 95 && marker(myWorkSchemaMarker) !== undefined) throw new Error("Premature My Work inbox schema marker. Original state was preserved.");
      if (version >= 95) require(myWorkSchemaMarker, "My Work inbox");
      if (version >= 4 && version < 95 && hasMyWorkHistory(this.readEvents(0, true, version < 10))) {
        throw new Error("Actual My Work inbox history cannot become a pre-95 lineage. Original state was preserved.");
      }
      if (version < 96 && marker(backgroundServiceSchemaMarker) !== undefined) throw new Error("Premature background service schema marker. Original state was preserved.");
      if (version >= 96) require(backgroundServiceSchemaMarker, "background service");
      if (version < 97 && marker(otlpExportSchemaMarker) !== undefined) throw new Error("Premature OTLP export schema marker. Original state was preserved.");
      if (version >= 97) require(otlpExportSchemaMarker, "OTLP export");
      if (version >= 4 && version < 97 && this.db.prepare("SELECT 1 FROM events WHERE json_extract(data,'$.event_type')='telemetry.export_configured' LIMIT 1").get()) {
        throw new Error("Actual OTLP export history cannot become a pre-97 lineage. Original state was preserved.");
      }
      if (version >= 4 && version < 96 && hasBackgroundServiceHistory(this.decodeEvents(this.db.prepare(
        "SELECT seq,data FROM events WHERE json_extract(data,'$.event_type')='application.configured' ORDER BY seq",
      ).iterate(), true, version < 10))) {
        throw new Error("Actual background service preference history cannot become a pre-96 lineage. Original state was preserved.");
      }
      for (const id of repositoryManagementSchemaMarkers) {
        if (version < 91 && marker(id) !== undefined) throw new Error("Premature repository management schema marker. Original state was preserved.");
        if (version >= 91) require(id, "repository management");
      }
      if (version >= 4 && version < 91 && this.readEvents(0, true, version < 10).some((event) =>
        event.event_type === "repository.import_recorded" ||
        event.event_type === "github.operation_recorded" && event.payload.operation.kind === "git.remote.set")) {
        throw new Error("Actual repository management history cannot become a pre-91 lineage. Original state was preserved.");
      }
      if (version < 88 && marker(voiceShortcutSchemaMarker) !== undefined) throw new Error("Premature voice shortcut schema marker. Original state was preserved.");
      if (version >= 88) require(voiceShortcutSchemaMarker, "voice shortcut");
      if (version >= 4 && version < 88 && hasVoiceShortcutHistory(this.readEvents(0, true, version < 10))) {
        throw new Error("Actual voice shortcut preference history cannot become a pre-88 lineage. Original state was preserved.");
      }
      if (version < 89 && marker(eventReadIndexesSchemaMarker) !== undefined) throw new Error("Premature event read indexes schema marker. Original state was preserved.");
      if (version >= 89) {
        require(eventReadIndexesSchemaMarker, "event read indexes");
        for (const sql of eventReadIndexes) {
          const name = sql.split(" ")[2]!;
          if (this.db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=? AND tbl_name='events'").get(name)?.sql !== sql) {
            throw new Error(`Missing or invalid event read index ${name}. Original state was preserved; no index or history was silently rebuilt.`);
          }
        }
      }
      for (const id of [chatTitlesSchemaMarker, liveDeliverySchemaMarker]) {
        if (version < 90 && marker(id) !== undefined) throw new Error("Premature chat naming/live delivery schema marker. Original state was preserved.");
        if (version >= 90) require(id, "chat naming/live delivery");
      }
      if (version >= 4 && version < 90) {
        const history = this.readEvents(0, true, version < 10);
        if (hasChatTitleHistory(history) || hasLiveDeliveryHistory(history)) throw new Error("Actual chat naming/live delivery history cannot become a pre-90 lineage. Original state was preserved.");
      }
      for (const id of sessionControlsSchemaMarkers) {
        if (version < 87 && marker(id) !== undefined) throw new Error(`Premature session controls/tools schema marker ${id}. Original state was preserved.`);
        if (version >= 87) require(id, "session controls/tools");
      }
      if (version >= 4 && version < 87 && hasSessionControlsHistory(this.readEvents(0, true, version < 10))) {
        throw new Error("Actual session controls/tools history cannot become a pre-87 lineage. Original state was preserved.");
      }
      for (const id of recoverySchemaMarkers) {
        if (version < 81 && marker(id) !== undefined) throw new Error(`Premature session request/Git schema marker ${id}. Original state was preserved.`);
        if (version >= 81) require(id, "session request/Git recovery");
      }
      for (const id of commandToolSchemaMarkers) {
        if (version < 82 && marker(id) !== undefined) throw new Error(`Premature command/tool preference schema marker ${id}. Original state was preserved.`);
        if (version >= 82) require(id, "command/tool preference");
      }
      for (const id of safetyReviewSchemaMarkers) {
        if (version < 83 && marker(id) !== undefined) throw new Error(`Premature content/script review schema marker ${id}. Original state was preserved.`);
        if (version >= 83) require(id, "content/script review");
      }
      if (version >= 4 && version < 83 && this.readEvents(0, true, version < 10).some((event) =>
        event.event_type === "script.review_recorded" ||
        (event.event_type === "queue.enqueued" || event.event_type === "turn.started") && event.payload.item.command?.name === "script-review" ||
        (event.event_type === "tool.requested" ? event.payload.approval.call : event.event_type === "tool.started" || event.event_type === "tool.completed" ? event.payload.call : null)?.name === "review_script" ||
        (event.event_type === "tool.requested" ? event.payload.approval.call : event.event_type === "tool.started" || event.event_type === "tool.completed" ? event.payload.call : null)?.name === "run_script")) {
        throw new Error("Actual content/script review history cannot become a pre-83 lineage. Original state was preserved.");
      }
      if (version >= 4 && version < 82 && this.readEvents(0, true, version < 10).some((event) =>
        event.event_type === "session.resumed" && event.payload.continuation ||
        event.event_type === "settings.updated" && event.payload.settings.toolPreferences !== undefined ||
        (event.event_type === "queue.enqueued" || event.event_type === "turn.started") && (event.payload.item.spawnPromptOrigin ||
          event.payload.item.workflow && !["review", "security", "performance", "debug"].includes(event.payload.item.workflow.kind) ||
          event.payload.item.command && ["impeccable", "continue", "orchestrate", "spawn", "spar", "critique", "roast-me", "tool-preferences"].includes(event.payload.item.command.name)) ||
        event.event_type === "tool.requested" && event.payload.approval.call.directMcp ||
        (event.event_type === "tool.started" || event.event_type === "tool.completed") && event.payload.call.directMcp)) {
        throw new Error("Actual workflow/tool delivery history cannot become a pre-82 lineage. Original state was preserved.");
      }
      for (const id of intakeSchemaMarkers) {
        if (version < 84 && marker(id) !== undefined) throw new Error(`Premature recovery/scheduling/Kupo schema marker ${id}. Original state was preserved.`);
        if (version >= 84) require(id, "recovery/scheduling/Kupo");
      }
      if (version >= 4 && version < 84 && this.readEvents(0, true, version < 10).some((event) =>
        ["prompt.schedule_recorded", "model.request_bound", "model.authorization_changed", "model.failure_recorded", "recovery.cycle_recorded", "turn.retry_started", "routing.roles_planned", "routing.role_started"].includes(event.event_type) ||
        event.event_type === "budget.plan_recorded" && event.payload.plan.purpose === "routing" ||
        event.event_type === "compaction.saved" && event.payload.compaction.automatic !== undefined ||
        event.event_type === "context.changed" && event.payload.actor === "kupo-policy" || event.event_type === "routing.context_rebound" ||
        (event.event_type === "tool.requested" ? event.payload.approval.call : event.event_type === "tool.started" || event.event_type === "tool.completed" ? event.payload.call : null)?.name === "read_tool_result" &&
          (event.event_type === "tool.requested" ? event.payload.approval.call : event.event_type === "tool.started" || event.event_type === "tool.completed" ? event.payload.call : null)?.arguments.action === "history" ||
        (event.event_type === "session.created" || event.event_type === "session.configured") && event.payload.controls.kupoMode !== undefined ||
        event.event_type === "model.selection_remembered" && event.payload.selection?.kupoMode !== undefined ||
        event.event_type === "routing.started" && event.payload.routing.mode !== undefined ||
        event.event_type === "settings.updated" && (event.payload.settings.interactions?.idleScheduleAction !== undefined ||
          event.payload.settings.startup?.global?.kupoMode !== undefined || event.payload.settings.startup?.profile?.kupoMode !== undefined ||
          event.payload.settings.kupo?.workflow === "auto" && (event.payload.settings.kupo.modelProfiles !== undefined || event.payload.settings.kupo.automaticLimits !== undefined || event.payload.settings.kupo.autoCompaction !== undefined)) ||
        event.event_type === "project.configured" && event.payload.configuration.values?.defaults?.kupoMode !== undefined ||
        event.event_type === "global.controls_changed" && event.payload.values.kupoMode !== undefined)) {
        throw new Error("Actual recovery/scheduling/Kupo history cannot become a pre-84 lineage. Original state was preserved.");
      }
      for (const id of ownedTransportSchemaMarkers) {
        if (version < 85 && marker(id) !== undefined) throw new Error(`Premature owned transport schema marker ${id}. Original state was preserved.`);
        if (version >= 85) require(id, "scheduled native/owned model/finishing transport");
      }
      if (version >= 4 && version < 85 && this.readEvents(0, true, version < 10).some((event) =>
        event.event_type === "sandbox.workspace_recorded" && event.payload.workspace.preparation?.version === 2 ||
        event.event_type === "decision.recorded" && Object.hasOwn(event.payload.decision, "transport") ||
        event.event_type === "winddown.recorded" && Object.hasOwn(event.payload.winddown, "transport"))) {
        throw new Error("Actual scheduled native/owned model/finishing history cannot become a pre-85 lineage. Original state was preserved.");
      }
      for (const id of retryCheckpointSchemaMarkers) {
        if (version < 86 && marker(id) !== undefined) throw new Error(`Premature native retry/checkpoint schema marker ${id}. Original state was preserved.`);
        if (version >= 86) require(id, "native retry/transport checkpoint");
      }
      if (version >= 4 && version < 86 && this.readEvents(0, true, version < 10).some((event) =>
        event.event_type === "model.request_bound" && event.payload.nativeRestaging ||
        event.event_type === "sandbox.workspace_recorded" && event.payload.workspace.preparation?.version === 3 ||
        event.event_type === "settings.updated" && event.payload.settings.interactions?.nativeRetryRestaging !== undefined ||
        event.event_type === "winddown.recorded" && (event.payload.winddown.version === 3 || event.payload.winddown.commit?.inspection))) {
        throw new Error("Actual native retry/checkpoint history cannot become a pre-86 lineage. Original state was preserved.");
      }
      for (const id of skillsRewindSchemaMarkers) {
        if (version < 98 && marker(id) !== undefined) throw new Error("Premature skill admission/checkpoint schema marker. Original state was preserved.");
        if (version >= 98) require(id, "skill admission/checkpoint");
      }
      if (version >= 4 && version < 98 && this.db.prepare("SELECT 1 FROM events WHERE json_extract(data,'$.event_type') IN ('skill.admission_recorded','skill.consumed','checkpoint.recorded','checkpoint.forgotten','checkpoint.capture_recorded','checkpoint.capture_forgotten','rewind.recorded','session.rewound') LIMIT 1").get()) {
        throw new Error("Actual skill admission/rewind history cannot become a pre-98 lineage. Original state was preserved.");
      }
      for (const id of inboxSkillSchemaMarkers) {
        if (version < 99 && marker(id) !== undefined) throw new Error("Premature Inbox/explicit skill-load schema marker. Original state was preserved.");
        if (version >= 99) require(id, "Inbox/explicit skill-load");
      }
      if (version >= 4 && version < 99 && this.db.prepare("SELECT 1 FROM events WHERE json_extract(data,'$.event_type') IN ('attention.deleted','skill.loaded') LIMIT 1").get()) {
        throw new Error("Actual Inbox deletion/explicit skill-load history cannot become a pre-99 lineage. Original state was preserved.");
      }
      for (const id of scriptInboxSchemaMarkers) {
        if (version < 100 && marker(id) !== undefined) throw new Error("Premature script Inbox/tool failure schema marker. Original state was preserved.");
        if (version >= 100) require(id, "script Inbox/tool failure");
      }
      for (const id of repositoryWorkflowSchemaMarkers) {
        if (version < 101 && marker(id) !== undefined) throw new Error("Premature repository workflow/recovery schema marker. Original state was preserved.");
        if (version >= 101) require(id, "repository workflow/recovery");
      }
      if (version < 102 && marker(nativeCandidateIdentitySchemaMarker) !== undefined) throw new Error("Premature native candidate identity schema marker. Original state was preserved.");
      if (version >= 102) require(nativeCandidateIdentitySchemaMarker, "native candidate identity");
      if (version < 103 && marker(nativeScriptSchemaMarker) !== undefined) throw new Error("Premature native script execution schema marker. Original state was preserved.");
      if (version >= 103) require(nativeScriptSchemaMarker, "native script execution");
      if (version >= 4 && version < 103 && (this.db.prepare("SELECT 1 FROM events WHERE json_extract(data,'$.event_type')='script.review_recorded' AND json_type(data,'$.turn_id')='text' LIMIT 1").get() ||
        hasNativeScriptHistory(this.decodeEvents(this.db.prepare("SELECT seq,data FROM events WHERE json_extract(data,'$.event_type')='script.review_recorded' ORDER BY seq").iterate(), true, version < 10)))) {
        throw new Error("Actual native script grants/results cannot become a pre-103 lineage. Original state was preserved.");
      }
      if (version >= 4 && version < 102 && hasNativeCandidateIdentityHistory(this.decodeEvents(this.db.prepare(
        "SELECT seq,data FROM events WHERE json_extract(data,'$.event_type') IN ('candidate.transport_recorded','candidate.workspace_recorded','candidate.saved','sandbox.workspace_recorded') ORDER BY seq").iterate(), true, version < 10))) {
        throw new Error("Actual versioned native identity grants cannot become a pre-102 lineage. Original state was preserved.");
      }
      if (version >= 4 && version < 101 && (this.db.prepare("SELECT 1 FROM events WHERE json_extract(data,'$.event_type') IN ('repository.trust_recorded','repository.script_reserved','turn.recovery_entered') LIMIT 1").get() ||
        hasRepositoryWorkflowHistory(this.decodeEvents(this.db.prepare("SELECT seq,data FROM events WHERE json_extract(data,'$.event_type') IN ('tool.completed','session.created','session.workspace_bound','project.configured') ORDER BY seq").iterate(), true, version < 10)))) {
        throw new Error("Actual repository workflow/partial recovery history cannot become a pre-101 lineage. Original state was preserved.");
      }
      if (version >= 4 && version < 100 && (this.db.prepare("SELECT 1 FROM events WHERE json_extract(data,'$.event_type')='script.review_approved' LIMIT 1").get() ||
        hasScriptInboxHistory(this.decodeEvents(this.db.prepare(`SELECT seq,data FROM events WHERE json_extract(data,'$.event_type')
          IN ('script.review_recorded','attention.raised','tool.completed') ORDER BY seq`).iterate(), true, version < 10)))) {
        throw new Error("Actual script Inbox/approval/tool failure history cannot become a pre-100 lineage. Original state was preserved.");
      }
      if (version < 105 && marker(chatRepositoryBindingSchemaMarker) !== undefined) throw new Error("Premature chat repository binding schema marker. Original state was preserved.");
      if (version >= 105) require(chatRepositoryBindingSchemaMarker, "chat repository binding");
      if (version >= 4 && version < 105 && (this.db.prepare(`SELECT 1 FROM events WHERE json_extract(data,'$.event_type') IN (${chatRepositoryBindingEvents.map(() => "?").join(",")}) LIMIT 1`).get(...chatRepositoryBindingEvents) ||
        this.decodeEvents(this.db.prepare("SELECT seq,data FROM events WHERE json_extract(data,'$.event_type')='settings.updated' ORDER BY seq").iterate(), true, version < 10)
          .some((event) => event.event_type === "settings.updated" && event.payload.settings.interactions?.confirmRepositoryImport !== undefined))) {
        throw new Error("Actual chat repository observations, bindings or import preferences cannot become a pre-105 lineage. Original state was preserved.");
      }
      if (version < 106 && marker(capabilityDeletionSchemaMarker) !== undefined) throw new Error("Premature skill deletion schema marker. Original state was preserved.");
      if (version >= 106) require(capabilityDeletionSchemaMarker, "skill deletion");
      if (version >= 4 && version < 106 && this.db.prepare("SELECT 1 FROM events WHERE json_extract(data,'$.event_type')='capability.deleted' LIMIT 1").get()) {
        throw new Error("Actual skill deletions cannot become a pre-106 lineage. Original state was preserved.");
      }
      if (version < 107 && marker(externalVoiceModelSchemaMarker) !== undefined) throw new Error("Premature external voice model schema marker. Original state was preserved.");
      if (version >= 107) require(externalVoiceModelSchemaMarker, "external voice model");
      if (version >= 4 && version < 107 && this.decodeEvents(this.db.prepare("SELECT seq,data FROM events WHERE json_extract(data,'$.event_type') IN ('job.started','settings.updated','skill.admission_recorded','draft.saved','question.answered') ORDER BY seq").iterate(), true, version < 10)
        .some((event) => event.event_type === "job.started" && event.payload.job.kind === "voice.inspect" ||
          event.event_type === "draft.saved" && event.payload.attachments.some((attachment) => attachment.kind === "skill") ||
          event.event_type === "question.answered" && event.payload.answer.skipped !== undefined ||
          event.event_type === "settings.updated" && event.payload.settings.voice?.model !== undefined ||
          event.event_type === "skill.admission_recorded" && event.payload.admission.basis !== undefined)) {
        throw new Error("Actual external voice model reviews, trusted voice selections, trusted-folder skill admissions, skill attachments or skipped questions cannot become a pre-107 lineage. Original state was preserved.");
      }
      if (version < 108 && marker(claudeAgentSchemaMarker) !== undefined) throw new Error("Premature Claude Agent schema marker. Original state was preserved.");
      if (version >= 108) require(claudeAgentSchemaMarker, "Claude Agent harness");
      if (version >= 4 && version < 108 && (this.db.prepare(`SELECT 1 FROM events WHERE json_extract(data,'$.event_type') IN (${claudeAgentEvents.map(() => "?").join(",")}) LIMIT 1`).get(...claudeAgentEvents) ||
        this.decodeEvents(this.db.prepare("SELECT seq,data FROM events WHERE json_extract(data,'$.event_type') IN ('settings.updated','tool.requested','tool.completed') ORDER BY seq").iterate(), true, version < 10)
          .some((event) => event.event_type === "settings.updated" && (event.payload.settings.claudeAgent !== undefined || event.payload.settings.codexAgent !== undefined ||
            event.payload.settings.hostedProviders !== undefined || event.payload.settings.hostedDeviceId !== undefined ||
            (event.payload.settings.localModels as typeof event.payload.settings.localModels | undefined ?? []).some((endpoint) => endpoint.auth === "header" || endpoint.headers !== undefined || endpoint.discovery !== undefined)) ||
            (event.event_type === "tool.requested" ? event.payload.approval.call : event.event_type === "tool.completed" ? event.payload.call : undefined)?.harness !== undefined))) {
        throw new Error("Actual agent harness sessions, harness tools, hosted provider accounts or endpoint header settings cannot become a pre-108 lineage. Original state was preserved.");
      }
    };
    const model = marker("model_selection_continuity_schema"), theme = marker("theme_catalog_schema"), convergence = marker("theme_model_workspace_convergence_schema");
    for (const id of workspaceSchemaMarkers) {
      if (version < 79 && marker(id) !== undefined) throw new Error(`Premature workspace schema marker ${id}. Original state was preserved.`);
      if (version >= 79) require(id, "workspace");
    }
    if (version < 80 && convergence !== undefined) throw new Error("Premature combined theme/model/workspace schema marker. Original state was preserved.");
    if (version < 77 && model !== undefined) throw new Error("Premature model selection continuity schema marker. Original state was preserved.");
    if (version < 78 && theme !== undefined) throw new Error("Premature theme catalogue schema marker. Original state was preserved.");
    if (version === 77) require("model_selection_continuity_schema", "model selection continuity");
    if (version === 78) {
      require("theme_catalog_schema", "theme catalogue");
      if (model !== undefined) throw new Error("Invalid standalone theme-78 lineage: a model marker is not part of that source. Original state was preserved.");
    }
    if (version === 79) {
      require("model_selection_continuity_schema", "model selection continuity");
      if (theme !== undefined) throw new Error("Invalid standalone workspace-79 lineage: its source did not support themes. Original state was preserved.");
    }
    if (version >= 80) {
      require("model_selection_continuity_schema", "model selection continuity");
      require("theme_catalog_schema", "theme catalogue");
      require("theme_model_workspace_convergence_schema", "combined theme/model/workspace");
    }
    if (version < 4 || version >= 81) { recoveryLineage(); return; }
    const events = this.readEvents(0, true, version < 10);
    if (events.some((event) => event.event_type === "session.configured" && event.payload.autonomySelection ||
      event.event_type === "workspace.saved" && event.payload.branchOperation ||
      event.event_type === "tool.started" && ["git_read", "git_write"].includes(event.payload.call.name) ||
      event.event_type === "github.operation_recorded" && (event.payload.operation.toolCallDigest ||
        ["git.branch.create", "git.branch.rename", "git.switch", "git.revert", "git.commit", "git.stage", "git.unstage"].includes(event.payload.operation.kind)))) {
      throw new Error("Session request/Git history cannot be relabelled without its original recovery markers. Original state was preserved.");
    }
    if (version >= 80) { recoveryLineage(); return; }
    if (model === undefined && events.some((event) =>
      (event.event_type === "session.created" || event.event_type === "session.configured") && event.payload.controls.preferredThinkingEffort !== undefined ||
      event.event_type === "model.selection_remembered" && event.payload.selection?.preferredThinkingEffort !== undefined ||
      event.event_type === "settings.updated" && (event.payload.settings.startup?.global?.preferredThinkingEffort !== undefined || event.payload.settings.startup?.profile?.preferredThinkingEffort !== undefined) ||
      event.event_type === "project.configured" && event.payload.configuration.values?.defaults?.preferredThinkingEffort !== undefined ||
      event.event_type === "global.controls_changed" && event.payload.values.preferredThinkingEffort !== undefined)) {
      throw new Error("Model effort preference history cannot be relabelled without its original continuity marker. Original state was preserved.");
    }
    if (theme === undefined && events.some((event) => event.event_type === "settings.updated" &&
      event.payload.settings.appearance?.palette !== undefined && !["moguri", "ocean", "orchid", "custom"].includes(event.payload.settings.appearance.palette))) {
      throw new Error("New theme history cannot be relabelled without its original catalogue marker. Original state was preserved.");
    }
    const retiredCombined = this.db.prepare("SELECT 1 FROM events WHERE json_extract(data,'$.event_type') LIKE 'slash.%' LIMIT 1").get();
    if (hasCombinedWorkspaceHistory(events) || retiredCombined) throw new Error("Combined80 queued/native group runtime history cannot be relabelled as a standalone predecessor. Original state was preserved.");
    if (version >= 79) { recoveryLineage(); return; }
    const futureHistory = events.some((event) => event.event_type === "project.folder_removed" ||
      event.event_type === "project.folder_saved" && event.payload.folder.color !== undefined);
    const retiredFuture = this.db.prepare("SELECT 1 FROM events WHERE json_extract(data,'$.event_type')='project.folder_removed' LIMIT 1").get();
    if (futureHistory || retiredFuture) throw new Error("Workspace interaction history cannot be relabelled as pre-79 state. Original state was preserved.");
    recoveryLineage();
  }
  private migrateWorkflowFeatures(version: number): void {
    const marker = (id: string) => this.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(id)?.value;
    const workflow = marker("session_github_workflows_schema"), convergence = marker("session_github_convergence_schema");
    const automatic = marker("automatic_kupo_schema"), kanban = marker("project_kanban_schema");
    const workflow59 = version === 59 && workflow === "1" && convergence === undefined &&
      marker("workspace_experience_schema") === undefined && marker("session_navigation_schema") === undefined;
    const required = [
      ["workspace_experience_schema", "workspace experience"],
      ["session_navigation_schema", "session navigation"],
      ["session_github_workflows_schema", "session/GitHub workflow"],
      ["session_github_convergence_schema", "session/GitHub workflow"],
      ["automatic_kupo_schema", "automatic Kupo"],
      ["project_kanban_schema", "project Kanban"],
      ["session_kupo_kanban_schema", "session/Kupo/Kanban convergence"],
    ] as const;
    const validate = () => {
      for (const [id, label] of required) if (marker(id) !== "1") throw new Error(`Missing or invalid ${label} schema marker. State was preserved.`);
    };
    if (version >= 63) { validate(); return; }
    if (version < 61 && (workflow !== undefined || convergence !== undefined) && !workflow59) throw new Error("Invalid pre-61 session/GitHub workflow lineage markers. State was preserved.");
    if ((workflow === undefined) !== (convergence === undefined) && !workflow59 ||
      workflow !== undefined && workflow !== "1" || convergence !== undefined && convergence !== "1") {
      throw new Error("Missing or invalid session/GitHub workflow schema marker. State was preserved.");
    }
    if (automatic !== undefined && automatic !== "1") throw new Error("Missing or invalid automatic Kupo schema marker. State was preserved.");
    if (kanban !== undefined && kanban !== "1" || version === 62 && kanban !== "1") throw new Error("Missing or invalid project Kanban schema marker. State was preserved.");
    if (version >= 61 && workflow === undefined && automatic === undefined) throw new Error("Missing session/GitHub workflow and automatic Kupo lineage markers. State was preserved.");
    if (version === 62 && (workflow !== "1" || convergence !== "1")) throw new Error("Invalid schema-62 session/GitHub/Kanban lineage markers. State was preserved.");
    const events = this.events();
    if (automatic === undefined && events.some((event) => event.event_type === "routing.response_selected" ||
      event.event_type === "routing.started" && event.payload.routing.policy.workflow === "auto" ||
      event.event_type === "model.started" && event.payload.kupoPhase || event.event_type === "model.completed" && event.payload.kupo)) {
      throw new Error("Automatic Kupo history cannot be relabelled without its original schema marker. Original state was preserved.");
    }
    if (workflow === undefined && events.some((event) =>
      (event.event_type === "session.created" || event.event_type === "session.configured") && event.payload.controls.automaticApprovals !== undefined ||
      event.event_type === "session.created" && (event.payload.workItemUrl || event.payload.githubSource) ||
      event.event_type === "session.organized" && event.payload.changes.workItemUrl !== undefined ||
      event.event_type === "tool.decided" && event.payload.actor === "autonomy" ||
      event.event_type === "settings.updated" && event.payload.settings.permissions.remembered?.length)) {
      throw new Error("Session/GitHub workflow history lost its original schema marker. Original state was preserved.");
    }
    if (kanban === undefined && events.some((event) => event.event_type === "project.work_recorded" || event.event_type === "pricing.catalog_recorded" ||
      event.event_type === "session.created" && event.payload.purpose ||
      event.event_type === "session.organized" && event.payload.changes.workItemId !== undefined ||
      event.event_type === "board.saved" && event.payload.board.kanban ||
      event.event_type === "budget.recorded" && event.payload.entry.rate?.source === "provider-api-equivalent" ||
      event.event_type === "settings.updated" && event.payload.settings.budgets.useProviderRatesForLimits)) {
      throw new Error("Project Kanban history lost its original schema marker. Original state was preserved.");
    }
    if (!workflow59) {
      if (version < 59) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('workspace_experience_schema','1');
        PRAGMA user_version=59; COMMIT;`);
      if (marker("workspace_experience_schema") !== "1") throw new Error("Missing or invalid workspace experience schema marker. State was preserved.");
      if (version < 60) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('session_navigation_schema','1');
        PRAGMA user_version=60; COMMIT;`);
      if (marker("session_navigation_schema") !== "1") throw new Error("Missing or invalid session navigation schema marker. State was preserved.");
      if (version < 61) this.db.exec(`BEGIN IMMEDIATE;
        INSERT INTO retention_metadata(id,value) VALUES ('automatic_kupo_schema','1');
        INSERT INTO retention_metadata(id,value) VALUES ('session_github_workflows_schema','1');
        INSERT INTO retention_metadata(id,value) VALUES ('session_github_convergence_schema','1');
        PRAGMA user_version=61; COMMIT;`);
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const [id] of required) if (marker(id) === undefined) this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?, '1')").run(id);
      this.db.exec("PRAGMA user_version=63; COMMIT;");
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
    validate();
  }
  private migrateDesktopMerge(version: number): void {
    const markers = [
      ["workspace_entry_schema", 44], ["settings_preferences_schema", 45], ["client_voice_capture_schema", 46],
      ["notification_sound_schema", 47], ["application_preferences_schema", 48], ["state_location_schema", 49],
      ["private_update_schema", 50], ["session_interactions_schema", 51], ["managed_sandbox_schema", 52],
    ] as const;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const desktop = this.db.prepare("SELECT value FROM retention_metadata WHERE id='desktop_interaction_schema'").get();
      if (desktop && desktop.value !== "1") throw new Error("Invalid desktop schema provenance. State was preserved.");
      const repairBranch = version >= 44 && desktop?.value === "1";
      for (const [id, introduced] of markers) {
        const row = this.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(id);
        if (!row) {
          if (!repairBranch && version >= introduced) throw new Error(`Missing retained schema marker ${id}. State was preserved.`);
          this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?,?)").run(id, "1");
        } else if (row.value !== "1") throw new Error(`Invalid retained schema marker ${id}. State was preserved.`);
      }
      if (!desktop) this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES ('desktop_interaction_schema','1')").run();
      this.db.exec("PRAGMA user_version=53; COMMIT;");
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
  }
  private migrateCandidateRetention(convergeTooling57 = false): void {
    const rows = this.db.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all();
    const live = new Map<string, StoredEvent>(), generations = new Map<string, CandidateGenerationRecord>(), artifacts = new Set<string>();
    for (const row of rows) {
      const data = this.validEvent(JSON.parse(String(row.data)), Number(row.seq)), scope = scopeFor(data, data.artifact_id ?? null), key = this.key(scope, false);
      if (!key) continue;
      const event = this.validEvent({ ...data, payload: JSON.parse(unseal(data.payload, key, `event:${data.id}`)) }, data.seq);
      live.set(event.id, event);
      if (event.event_type === "artifact.saved" || event.event_type === "artifact.revised") artifacts.add(`${event.profile_id}/${event.payload.artifact.id}`);
      if (event.event_type === "artifact.deleted") artifacts.delete(`${event.profile_id}/${event.payload.artifactId}`);
      if (event.event_type === "candidate.generation_recorded") {
        const id = `${event.profile_id}/${event.payload.generation.id}`;
        generations.set(id, projectCandidateGeneration(generations.get(id), event.payload.generation));
      }
    }
    const moved = new Map<string, { event: StoredEvent; previous: Scope }>();
    for (const event of live.values()) if (event.event_type === "model.completed" && !event.payload.candidateGenerationId && event.payload.usage.role === "draft") {
      const generation = generations.get(`${event.profile_id}/${event.turn_id}`);
      if (!generation || !artifacts.has(`${event.profile_id}/${generation.id}`) || generation.profileId !== event.profile_id ||
        generation.sessionId !== event.session_id || generation.projectId !== event.project_id || generation.stepId !== event.step_id ||
        generation.stepId !== event.payload.usage.stepId || generation.modelId !== event.payload.usage.modelId || generation.resultDigest !== event.payload.contextDigest) continue;
      moved.set(event.id, { previous: scopeFor(event, event.artifact_id ?? null),
        event: { ...event, artifact_id: generation.id, payload: { ...event.payload, candidateGenerationId: generation.id } } });
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (moved.size) {
        const needed = new Set([...live.values()].flatMap((event) => {
          const actual = moved.get(event.id)?.event ?? event, scope = scopeFor(actual, artifactIdentity(actual));
          return references(actual).map((hash) => JSON.stringify([scope.scope, hash]));
        }));
        this.db.exec("CREATE TABLE events_v57(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,data TEXT NOT NULL,payload TEXT NOT NULL)");
        for (const row of rows) {
          const entry = moved.get(String(row.id));
          if (!entry) {
            this.db.prepare("INSERT INTO events_v57 VALUES (?,?,?,?)").run(Number(row.seq), String(row.id), String(row.data), String(row.payload));
            continue;
          }
          const scope = scopeFor(entry.event, artifactIdentity(entry.event));
          for (const hash of references(entry.event)) {
            this.bind(hash, scope);
            if (entry.previous.scope !== scope.scope && !needed.has(JSON.stringify([entry.previous.scope, hash]))) this.db.prepare("DELETE FROM blob_payloads WHERE digest=? AND scope=?").run(hash, entry.previous.scope);
          }
          const payload = seal(JSON.stringify(entry.event.payload), this.key(scope, true)!, scope.scope, `event:${entry.event.id}`);
          const { seq: _seq, ...data } = entry.event;
          this.db.prepare("INSERT INTO events_v57 VALUES (?,?,?,?)").run(entry.event.seq, entry.event.id, JSON.stringify({ ...data, payload }), JSON.stringify(payload));
        }
        this.db.exec(`DROP TABLE events; ALTER TABLE events_v57 RENAME TO events;
          CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
          CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;`);
      }
      this.db.exec(`INSERT INTO retention_metadata(id,value) VALUES ('candidate_retention_schema','1');
        ${convergeTooling57 ? "INSERT INTO retention_metadata(id,value) VALUES ('lean_tooling_convergence_schema','1'); PRAGMA user_version=58;" : "PRAGMA user_version=57;"}
        COMMIT;`);
      if (moved.size) this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); this.keys.clear(); throw error; }
  }
  private key(scope: Scope, create: boolean): Buffer | null {
    const cached = this.keys.get(scope.scope);
    if (cached) return cached;
    const row = this.db.prepare("SELECT payload FROM retention_keys WHERE scope=?").get(scope.scope);
    if (row) {
      const key = Buffer.from(unseal(JSON.parse(String(row.payload)), this.masterKey, `key:${scope.scope}`), "base64");
      if (key.byteLength !== 32) throw new Error("Invalid retained scope key. State was preserved.");
      this.keys.set(scope.scope, key); return key;
    }
    if (this.db.prepare("SELECT scope FROM retention_forgotten WHERE scope=?").get(scope.scope)) {
      if (create) throw new MoguriError("deleted_scope", "This session/project was deleted. No late work was resurrected.", 409);
      return null;
    }
    if (!create) throw new Error("A retained payload key is missing without a deletion record. State was preserved.");
    const key = randomBytes(32);
    this.db.prepare("INSERT INTO retention_keys VALUES (?,?,?,?)").run(scope.scope, scope.projectId, scope.sessionId, JSON.stringify(seal(key.toString("base64"), this.masterKey, scope.scope, `key:${scope.scope}`)));
    this.keys.set(scope.scope, key); return key;
  }
  private bind(hash: string, scope: Scope, legacy?: Map<string, string>): void {
    if (this.db.prepare("SELECT digest FROM blob_payloads WHERE digest=? AND scope=?").get(hash, scope.scope)) return;
    const content = legacy?.get(hash) ?? this.pending.get(hash) ?? this.blob(hash);
    if (digest(content) !== hash) throw new Error(`Corrupt content snapshot ${hash}.`);
    this.db.prepare("INSERT INTO blob_payloads VALUES (?,?,?)").run(hash, scope.scope, JSON.stringify(seal(content, this.key(scope, true)!, scope.scope, `blob:${hash}:${scope.scope}`)));
  }
  private migrateRetention(keyId: string): void {
    const rows = this.db.prepare("SELECT seq,id,data FROM events ORDER BY seq").all();
    const blobs = new Map(this.db.prepare("SELECT digest,content FROM blobs").all().map((row) => [String(row.digest), String(row.content)]));
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE retention_metadata(id TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE retention_keys(scope TEXT PRIMARY KEY,project_id TEXT,session_id TEXT,payload TEXT NOT NULL);
      CREATE TABLE retention_forgotten(scope TEXT PRIMARY KEY,forgotten_at TEXT NOT NULL);
      CREATE TABLE blob_payloads(digest TEXT NOT NULL,scope TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(digest,scope));
      CREATE TABLE events_v4(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,data TEXT NOT NULL,payload TEXT NOT NULL);`);
    try {
      this.db.prepare("INSERT INTO retention_metadata VALUES ('key_id',?)").run(keyId);
      for (const row of rows) {
        const raw: unknown = JSON.parse(String(row.data));
        const event = this.validEvent(raw, Number(row.seq));
        const scope = scopeFor(event);
        for (const hash of references(event)) this.bind(hash, scope, blobs);
        const payload = seal(JSON.stringify(event.payload), this.key(scope, true)!, scope.scope, `event:${event.id}`);
        this.db.prepare("INSERT INTO events_v4(seq,id,data,payload) VALUES (?,?,?,?)").run(event.seq, event.id, JSON.stringify({ ...raw as Record<string, unknown>, payload }), JSON.stringify(payload));
      }
      this.db.exec(`DROP TABLE events; ALTER TABLE events_v4 RENAME TO events;
        CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
        CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
        DROP TABLE blobs; PRAGMA user_version=4; COMMIT;`);
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); this.keys.clear(); throw error; }
  }
  private migrateArtifacts(): void {
    const rows = this.db.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all();
    const live: Array<{ event: StoredEvent; scope: Scope }> = [];
    for (const row of rows) {
      const event = this.validEvent(JSON.parse(String(row.data)), Number(row.seq));
      const encrypted: unknown = event.payload, normal = scopeFor(event, event.artifact_id ?? null), legacy = scopeFor(event);
      if (!isRecord(encrypted) || encrypted.scope !== normal.scope && encrypted.scope !== legacy.scope) throw new Error("Retained event scope is corrupt. State was preserved.");
      const scope = encrypted.scope === normal.scope ? normal : legacy, key = this.key(scope, false);
      if (key) live.push({ event: this.validEvent({ ...event, payload: JSON.parse(unseal(encrypted, key, `event:${event.id}`)) }, event.seq), scope });
    }
    const needed = new Set(live.flatMap(({ event }) => references(event).map((hash) => JSON.stringify([scopeFor(event, artifactIdentity(event)).scope, hash]))));
    const byId = new Map(live.map((entry) => [entry.event.id, entry]));
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE events_v10(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,data TEXT NOT NULL,payload TEXT NOT NULL);`);
    try {
      for (const row of rows) {
        const entry = byId.get(String(row.id)), id = entry ? artifactIdentity(entry.event) : null;
        if (!entry || !id) {
          this.db.prepare("INSERT INTO events_v10 VALUES (?,?,?,?)").run(Number(row.seq), String(row.id), String(row.data), String(row.payload));
          continue;
        }
        const scope = scopeFor(entry.event, id);
        for (const hash of references(entry.event)) {
          this.bind(hash, scope);
          if (entry.scope.scope !== scope.scope && !needed.has(JSON.stringify([entry.scope.scope, hash]))) this.db.prepare("DELETE FROM blob_payloads WHERE digest=? AND scope=?").run(hash, entry.scope.scope);
        }
        const payload = seal(JSON.stringify(entry.event.payload), this.key(scope, true)!, scope.scope, `event:${entry.event.id}`);
        const { seq: _seq, ...data } = entry.event;
        this.db.prepare("INSERT INTO events_v10 VALUES (?,?,?,?)").run(entry.event.seq, entry.event.id, JSON.stringify({ ...data, artifact_id: id, payload }), JSON.stringify(payload));
      }
      this.db.exec(`DROP TABLE events; ALTER TABLE events_v10 RENAME TO events;
        CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
        CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
        INSERT INTO retention_metadata(id,value) VALUES ('retained_artifact_schema','1');
        PRAGMA user_version=10; COMMIT;`);
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); this.keys.clear(); throw error; }
  }
  receipt(id: string, expectedDigest: string): CommandResult | undefined {
    const row = this.db.prepare("SELECT digest,result FROM receipts WHERE profile_id=? AND id=?").get(this.profileId, id);
    if (!row) return undefined;
    if (row.digest !== expectedDigest) throw new MoguriError("idempotency_conflict", "A command ID was reused with different arguments.", 409);
    return JSON.parse(String(row.result)) as CommandResult;
  }
  retentionIdentity(): string {
    const id = this.db.prepare("SELECT value FROM retention_metadata WHERE id='key_id'").get()?.value;
    if (typeof id !== "string") throw new Error("The root retention identity is missing. Preserve state; no replacement profile key was invented.");
    return id;
  }
  view(profileId: string): EventStore {
    return new EventStore(this.path, this.masterKey, this.retentionIdentity(), profileId);
  }
  commit(inputs: EventInput[], receipt?: { id: string; digest: string; result: CommandResult }, forget?: ForgetRequest, derive?: (events: StoredEvent[]) => EventInput[]): StoredEvent[] {
    const events: StoredEvent[] = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const append = (value: EventInput) => {
        const input = value.event_type === "candidate.transport_recorded" && value.payload.transport.ownerKind === "read" ?
          { ...value, session_id: value.payload.transport.sessionId } : value;
        const data = {
          project_id: null, session_id: null, turn_id: null, step_id: null, correlation_id: null,
          ...input, id: randomUUID(), schema_version: 1, timestamp: new Date().toISOString(), work_item_id: null, parent_event_id: null, artifact_id: artifactIdentity(input),
        };
        const scope = scopeFor(input, data.artifact_id);
        for (const hash of references(input)) this.bind(hash, scope);
        const payload = seal(JSON.stringify(input.payload), this.key(scope, true)!, scope.scope, `event:${data.id}`);
        const row = this.db.prepare("INSERT INTO events (id,data,payload) VALUES (?,?,?)").run(data.id, JSON.stringify({ ...data, payload }), JSON.stringify(payload));
        events.push({ ...data, seq: Number(row.lastInsertRowid) } as StoredEvent);
      };
      for (const input of inputs) append(input);
      const derived = derive?.(events) ?? [];
      for (const input of derived) append(input);
      if (receipt) this.db.prepare("INSERT INTO receipts VALUES (?,?,?,?)").run(this.profileId, receipt.id, receipt.digest, JSON.stringify(receipt.result));
      for (const input of inputs) if (input.event_type === "project.relocated" && input.project_id) this.clearProjectIndex(input.project_id);
      for (const input of inputs) if (input.event_type === "workspace.saved" && input.payload.workspace.status === "removed") this.clearProjectIndex(input.payload.workspace.id);
      if (forget) this.forget(forget);
      this.db.exec("COMMIT");
      for (const input of [...inputs, ...derived]) for (const hash of references(input)) this.pending.delete(hash);
      if (forget) { this.keys.clear(); this.pending.clear(); this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); }
      return events;
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); this.keys.clear(); throw error; }
  }
  private validEvent(event: unknown, seq: number): StoredEvent {
    if (!isRecord(event) || event.schema_version !== 1 || typeof event.event_type !== "string" ||
      !eventTypes.includes(event.event_type as EventInput["event_type"]) || !isRecord(event.payload) ||
      typeof event.id !== "string" || typeof event.timestamp !== "string" || typeof event.profile_id !== "string") {
      throw new Error(`Unsupported or corrupt durable event at sequence ${seq}. State was preserved.`);
    }
    return { ...event, seq } as StoredEvent;
  }
  events(after = 0, previous?: readonly StoredEvent[]): StoredEvent[] { return this.readEvents(after, false, false, previous); }
  /**
   * Drops history that only recorded background polling: a card revision whose next revision of the same card differs only in
   * observation times or revision counter, and an `issues.refresh` job whose outcome the project's next refresh repeats.
   * Earlier releases appended both every minute. Latest states and every change stay retained. Ordinary starts only count
   * events since the previous pass; a full pass runs once `threshold` polling events have accumulated.
   */
  compactPollingHistory(threshold = 1_000): { issues: number; jobs: number; ms: number } {
    const began = Date.now(), marker = "polling_compaction_seq";
    const watermark = Number(this.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker)?.value ?? 0);
    const pending = Number(this.db.prepare(`SELECT count(*) AS count FROM events WHERE json_extract(data,'$.event_type') IN ('issue.saved','job.started') AND seq>?
      AND (json_extract(data,'$.event_type')='issue.saved' OR json_extract(data,'$.session_id') IS NULL)`).get(watermark)?.count);
    if (!(pending >= threshold)) return { issues: 0, jobs: 0, ms: Date.now() - began };
    const through = Number(this.db.prepare("SELECT COALESCE(MAX(seq),0) AS seq FROM events").get()?.seq);
    const decode = (row: Record<string, SQLOutputValue>): StoredEvent | null => {
      const data = this.validEvent(JSON.parse(String(row.data)), Number(row.seq)), key = this.key(scopeFor(data, data.artifact_id ?? null), false);
      return key ? this.validEvent({ ...data, payload: JSON.parse(unseal(data.payload, key, `event:${data.id}`)) }, data.seq) : null;
    };
    const redundant: number[] = [], cards = new Map<string, { seq: number; actor: string; content: unknown }>();
    let issues = 0;
    for (const row of this.db.prepare("SELECT seq,data FROM events WHERE json_extract(data,'$.event_type')='issue.saved' ORDER BY seq").iterate()) {
      const event = decode(row);
      if (event?.event_type !== "issue.saved") continue;
      const owner = JSON.stringify([event.profile_id, event.project_id ?? null, event.payload.issue.id]), previous = cards.get(owner);
      const content = issueContent(event.payload.issue);
      if (previous && previous.actor === event.payload.actor && isDeepStrictEqual(previous.content, content)) { redundant.push(previous.seq); issues++; }
      cards.set(owner, { seq: event.seq, actor: event.payload.actor, content });
    }
    const refreshes = new Map<string, { owner: string; scope: string; seqs: number[]; outcome?: string; digest: string | null }>();
    for (const row of this.db.prepare(`SELECT seq,data FROM events WHERE json_extract(data,'$.event_type') IN ('job.started','job.progress','job.finished')
      AND json_extract(data,'$.session_id') IS NULL ORDER BY seq`).iterate()) {
      const event = decode(row);
      if (event?.event_type === "job.started") {
        const job = event.payload.job;
        if (job.kind === "issues.refresh" && job.projectId && !job.sessionId && !event.artifact_id) {
          refreshes.set(job.id, { owner: JSON.stringify([event.profile_id, job.projectId]), scope: scopeFor(event).scope, seqs: [event.seq], digest: null });
        }
      } else if (event?.event_type === "job.progress" || event?.event_type === "job.finished") {
        const job = refreshes.get(event.payload.jobId);
        if (!job) continue;
        job.seqs.push(event.seq);
        if (event.event_type === "job.finished") { job.outcome = JSON.stringify([event.payload.status, event.payload.error]); job.digest = event.payload.resultDigest; }
      }
    }
    const later = new Map<string, string | undefined>(), grants = new Map<string, { scope: string; digest: string }>();
    let jobs = 0;
    for (const job of [...refreshes.values()].reverse()) {
      if (job.outcome !== undefined && later.get(job.owner) === job.outcome) {
        redundant.push(...job.seqs); jobs++;
        if (job.digest) grants.set(JSON.stringify([job.scope, job.digest]), { scope: job.scope, digest: job.digest });
      }
      later.set(job.owner, job.outcome);
    }
    const trigger = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='events_no_delete' AND tbl_name='events'").get()?.sql;
    if (typeof trigger !== "string") throw new Error("The append-only event trigger is missing. State was preserved; no history was compacted.");
    // Payloads are encrypted and VACUUM rewrites the file, so zero-filling freed pages would only add gigabytes of writes.
    this.db.exec("PRAGMA secure_delete=OFF; BEGIN IMMEDIATE");
    try {
      if (redundant.length) {
        this.db.exec("DROP TRIGGER events_no_delete");
        const remove = this.db.prepare("DELETE FROM events WHERE seq=? AND json_extract(data,'$.event_type') IN ('issue.saved','job.started','job.progress','job.finished')");
        for (const seq of redundant) remove.run(seq);
        this.db.exec(trigger);
      }
      if (grants.size) {
        // A result blob keeps its retention grant while any remaining event in that scope still references it.
        const scopes = new Set([...grants.values()].map((grant) => grant.scope)), needed = new Set<string>();
        for (const row of this.db.prepare("SELECT seq,data FROM events WHERE json_extract(data,'$.session_id') IS NULL ORDER BY seq").iterate()) {
          const data = this.validEvent(JSON.parse(String(row.data)), Number(row.seq)), scope = scopeFor(data, data.artifact_id ?? null).scope;
          if (!scopes.has(scope)) continue;
          const event = decode(row);
          if (!event) throw new Error("A retained event lost its retention key during compaction. State was preserved.");
          for (const hash of references(event)) needed.add(JSON.stringify([scope, hash]));
        }
        const forget = this.db.prepare("DELETE FROM blob_payloads WHERE digest=? AND scope=?");
        for (const [key, grant] of grants) if (!needed.has(key)) forget.run(grant.digest, grant.scope);
      }
      this.db.prepare("INSERT INTO retention_metadata(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(marker, String(through));
      this.db.exec("COMMIT");
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
    finally { this.db.exec("PRAGMA secure_delete=ON"); this.keys.clear(); }
    if (redundant.length) this.db.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE)");
    return { issues, jobs, ms: Date.now() - began };
  }
  /** Event counts by type and file size, read from the type index and page metadata without decrypting history. */
  historyHealth(): { events: number; bytes: number; types: Array<{ type: string; count: number }> } {
    const types = this.db.prepare(`SELECT json_extract(data,'$.event_type') AS type,count(*) AS count FROM events INDEXED BY events_type_sequence
      GROUP BY json_extract(data,'$.event_type') ORDER BY count DESC`).all().map((row) => ({ type: String(row.type), count: Number(row.count) }));
    const pages = Number(this.db.prepare("PRAGMA page_count").get()?.page_count), size = Number(this.db.prepare("PRAGMA page_size").get()?.page_size);
    return { events: types.reduce((total, entry) => total + entry.count, 0), bytes: pages * size, types };
  }
  revision(): { external: number; local: number } {
    const external = this.db.prepare("PRAGMA data_version").get()?.data_version;
    const local = this.db.prepare("SELECT total_changes() AS count").get()?.count;
    if (typeof external !== "number" || typeof local !== "number" || !Number.isSafeInteger(external) || !Number.isSafeInteger(local) ||
      external < 0 || local < 0) throw new MoguriError("store_revision", "The retained store revision is unavailable. No cached source was substituted.", 409);
    return { external, local };
  }
  eventsOfTypes(types: readonly EventInput["event_type"][], after = 0): StoredEvent[] {
    if (!types.length) return [];
    if (types.some((type) => !eventTypes.includes(type))) throw new MoguriError("event_filter", "Choose known retained event types. No broader history was substituted.");
    const rows = this.db.prepare(`SELECT seq,data FROM events INDEXED BY events_type_sequence
      WHERE json_extract(data,'$.event_type') IN (${types.map(() => "?").join(",")})
      AND json_extract(data,'$.profile_id')=? AND seq>? ORDER BY seq`).iterate(...types, this.profileId, after);
    return this.decodeEvents(rows, false);
  }
  globalBudgetSequence(): number {
    const value = Number(this.db.prepare("SELECT COALESCE(MAX(seq),0) AS seq FROM events WHERE json_extract(data,'$.event_type') IN ('budget.recorded','budget.plan_recorded')").get()?.seq ?? 0);
    if (!Number.isSafeInteger(value) || value < 0) throw new MoguriError("budget_sequence", "Global accounting sequence is invalid. No cached or free capacity was substituted.", 409);
    return value;
  }
  private readEvents(after: number, allProfiles: boolean, legacyArtifactScopes = false, previous?: readonly StoredEvent[]): StoredEvent[] {
    const rows = allProfiles ? this.db.prepare("SELECT seq,data FROM events WHERE seq>? ORDER BY seq").iterate(after) :
      this.db.prepare("SELECT seq,data FROM events WHERE json_extract(data,'$.profile_id')=? AND seq>? ORDER BY seq").iterate(this.profileId, after);
    return this.decodeEvents(rows, allProfiles, legacyArtifactScopes, previous);
  }
  private decodeEvents(rows: Iterable<Record<string, SQLOutputValue>>, allProfiles: boolean, legacyArtifactScopes = false, previous?: readonly StoredEvent[]): StoredEvent[] {
    // A previous read's key memo cannot outlive a peer's scope deletion or key change.
    this.keys.clear();
    const issueLinks = new Map(previous?.flatMap((event) => event.event_type === "issue.saved" && event.profile_id === this.profileId && event.payload.issue.github ?
      [[event.id, event.payload.issue.github] as const] : []) ?? []);
    const events: StoredEvent[] = [];
    for (const row of rows) {
      const event: unknown = JSON.parse(String(row.data));
      const data = this.validEvent(event, Number(row.seq));
      if (!allProfiles && data.profile_id !== this.profileId) continue;
      const encrypted: unknown = data.payload, legacy = scopeFor(data);
      const scope = legacyArtifactScopes && isRecord(encrypted) && encrypted.scope === legacy.scope ? legacy : scopeFor(data, data.artifact_id ?? null);
      const key = this.key(scope, false);
      if (!key) continue;
      const decoded = this.validEvent({ ...data, payload: JSON.parse(unseal(data.payload, key, `event:${data.id}`)) }, Number(row.seq));
      if (!legacyArtifactScopes && artifactIdentity(decoded) !== (data.artifact_id ?? null)) throw new Error("Artifact retention identity is corrupt. State was preserved.");
      if (decoded.event_type === "issue.saved") {
        // Reuse a validation witness only after authenticating the freshly decoded row and exact metadata.
        const checked = issueLinks.get(decoded.id);
        if (checked && Value.Equal(checked, decoded.payload.issue.github)) decoded.payload.issue.github = checked;
      }
      events.push(decoded);
    }
    return events;
  }
  putBlob(content: string): string {
    const hash = digest(content);
    this.pending.set(hash, content);
    if ([...this.pending.values()].reduce((bytes, text) => bytes + Buffer.byteLength(text), 0) > 64 * 1024 * 1024) { this.pending.delete(hash); throw new MoguriError("blob_limit", "Uncommitted content exceeded its 64 MiB bound."); }
    return hash;
  }
  blob(hash: string): string {
    const pending = this.pending.get(hash);
    if (pending !== undefined) return pending;
    for (const row of this.db.prepare("SELECT scope,payload FROM blob_payloads WHERE digest=? AND (scope=? OR scope GLOB ?)").all(hash, `profile/${this.profileId}`, `profile/${this.profileId}/*`)) {
      const key = this.key({ scope: String(row.scope), projectId: null, sessionId: null }, false);
      if (!key) continue;
      const text = unseal(JSON.parse(String(row.payload)), key, `blob:${hash}:${row.scope}`);
      if (digest(text) !== hash) throw new Error(`Corrupt content snapshot ${hash}.`);
      return text;
    }
    throw new Error(`Missing or deleted content snapshot ${hash}.`);
  }
  private forget(request: ForgetRequest): void {
    const scopes = new Set<string>();
    for (const id of request.sessions ?? []) for (const row of this.db.prepare("SELECT scope FROM retention_keys WHERE session_id=? AND scope GLOB ?").all(id, `profile/${this.profileId}/*`)) scopes.add(String(row.scope));
    for (const id of request.projects ?? []) {
      for (const row of this.db.prepare("SELECT scope FROM retention_keys WHERE project_id=? AND scope GLOB ?").all(id, `profile/${this.profileId}/*`)) scopes.add(String(row.scope));
      this.clearProjectIndex(id);
    }
    for (const id of request.artifacts ?? []) scopes.add(artifactScope(this.profileId, id).scope);
    for (const checkpoint of request.checkpoints ?? []) {
      const suffix = `/checkpoint/${encodeURIComponent(checkpoint.id)}`;
      for (const row of this.db.prepare("SELECT scope FROM retention_keys WHERE session_id=? AND scope GLOB ? AND substr(scope,-?)=?")
        .all(checkpoint.sessionId, `profile/${this.profileId}/*`, suffix.length, suffix)) scopes.add(String(row.scope));
    }
    for (const scope of scopes) {
      this.db.prepare("INSERT OR REPLACE INTO retention_forgotten VALUES (?,?)").run(scope, new Date().toISOString());
      this.db.prepare("DELETE FROM blob_payloads WHERE scope=?").run(scope);
      this.db.prepare("DELETE FROM retention_keys WHERE scope=?").run(scope);
    }
  }
  private clearProjectIndex(id: string): void {
    const scoped = this.db.prepare("SELECT locator,scope_id FROM memory_scopes WHERE profile_id=? AND (project_id=? OR workspace_id=?)").all(this.profileId, id, id);
    const ids = new Set([profileIndexId(this.profileId, id), ...scoped.map((row) => String(row.scope_id))]);
    const vectors = this.db.prepare("SELECT name FROM sqlite_master WHERE name='memory_vectors'").get();
    if (vectors) vec.load(this.db);
    for (const scope of ids) {
      if (vectors) this.db.prepare("DELETE FROM memory_vectors WHERE project_id=?").run(scope);
      for (const table of ["memory_files", "memory_chunks", "memory_graph_nodes", "memory_graph_edges"]) this.db.prepare(`DELETE FROM ${table} WHERE project_id=?`).run(scope);
    }
    this.db.prepare("DELETE FROM memory_scopes WHERE profile_id=? AND (project_id=? OR workspace_id=?)").run(this.profileId, id, id);
  }
  close(): void { this.keys.clear(); this.pending.clear(); this.db.close(); }
}
