import { MoguriClient as TransportClient, ClientError } from "../../client/src/index.ts";
import { isRecord, QuerySchema, parse, TerminalInputSchema, type PlatformQuery, type PlatformResponse, type SettingsSection, type UserSettings, type CapabilityJob, type BoardConfig, type IssueInput, type SessionChanges, type SessionMode, type ProjectSettings, type TerminalInput, type Controls, type ModelOptions, type ConfigurationSpec, type ControlDefaults, type ArtifactKind, type ArtifactChanges, type ProjectArtifactChoice } from "../../protocol/src/index.ts";
import type { BudgetLimit, BudgetQuery, KupoSettings, Profile, CompactionPreview, TelemetryQuery, Session, CandidatePatch, CandidateRead, CandidateGenerationInput, CandidateGenerationResponse, CandidateRoleReference, CompoundInput, CompoundLineageInput, WinddownQuery } from "../../protocol/src/index.ts";
import type { Attachment, AttachmentAccess, DocumentReadOptions, DocumentSearchOptions, DocumentListOptions } from "../../protocol/src/index.ts";
import { lineageDraft } from "./compound.ts";
import { executeSlash, type SlashResult } from "./slash.ts";
import { responseText, type ActivityCursor } from "../../protocol/src/activity.ts";
import type { KnowledgeInput, KnowledgePromotion, KnowledgeQuery } from "../../protocol/src/knowledge.ts";
import type { HookDefinition, MarketplaceInput, MarketplaceSource } from "../../protocol/src/extensions.ts";
import { createCacheApi } from "./cache.ts";
import { createGithubApi } from "./github.ts";
import { createLinearWorkflowApi } from "./linear.ts";

export * from "../../protocol/src/index.ts";
export * from "./brand.ts";
export * from "./slash.ts";
export { ClientError };
export { DraftEditor } from "../../client/src/draft.ts";
export type { ClientState } from "../../client/src/index.ts";
export const sessionTitle = (session: Session, limit = 64, fallback = "New session"): string =>
  session.title !== "New session" ? session.title : session.messages.find((message) => message.role === "user")?.text.split("\n")[0]?.slice(0, limit) || fallback;
export const attachmentStatus = (attachment: Attachment): string => attachment.kind !== "document" ? attachment.kind :
  `${attachment.format.toUpperCase()} / ${attachment.summary.status} / ${attachment.format === "pdf" ? `${attachment.summary.pages} pages` : attachment.format === "xlsx" ? `${attachment.summary.sheets.length} sheets, ${attachment.summary.cells} cells` : `${attachment.summary.sections} sections, ${attachment.summary.tables} tables`}`;

export class MoguriSdk extends TransportClient {
  readonly github = createGithubApi(this);
  private sessionRevision(id: string): number {
    const session = this.getState().snapshot?.sessions.find((session) => session.id === id);
    if (!session) throw new ClientError("session_missing", "Connect and choose an existing session.");
    return session.revision;
  }
  private draftRevision(id: string): number {
    const session = this.getState().snapshot?.sessions.find((session) => session.id === id);
    if (!session) throw new ClientError("session_missing", "Choose an existing destination session.");
    return session.draft.revision;
  }
  readonly attachments = {
    localPath: (sessionId: string, path: string) => this.query({ type: "attachment.local.path", sessionId, path }),
    projectPath: (sessionId: string, projectId: string, path: string) => this.query({ type: "attachment.project.path", sessionId, projectId, path }),
    paste: (sessionId: string, pastedText: string, selection?: { start: number; end: number }, expectedRevision = this.draftRevision(sessionId)) => {
      const draft = this.getState().snapshot?.sessions.find((session) => session.id === sessionId)?.draft;
      if (!draft) throw new ClientError("session_missing", "Choose an existing destination session.");
      return this.command({ type: "draft.paste", sessionId, expectedRevision, text: draft.text, attachments: draft.attachments, pastedText,
        start: selection?.start ?? draft.text.length, end: selection?.end ?? draft.text.length });
    },
    file: (sessionId: string, path: string, mode: "text" | "image" | "document" | "auto" = "auto", expectedRevision = this.draftRevision(sessionId)) => this.command({ type: "attachment.file.add", sessionId, path, mode, expectedRevision }),
    document: (sessionId: string, path: string, options: { captureId?: string; expectedRevision?: number } = {}) => this.command({ type: "attachment.file.add", sessionId, path, mode: "document", captureId: options.captureId ?? crypto.randomUUID(), expectedRevision: options.expectedRevision ?? this.draftRevision(sessionId) }),
    cancelDocument: (sessionId: string, captureId: string) => this.command({ type: "attachment.document.cancel", sessionId, captureId }),
    listDocuments: (sessionId: string, options: DocumentListOptions = {}) => this.query({ ...options, type: "attachment.document.list", sessionId }),
    readDocument: (sessionId: string, attachmentId: string, options: DocumentReadOptions = {}) => this.query({ ...options, type: "attachment.document.read", sessionId, attachmentId }),
    searchDocument: (sessionId: string, attachmentId: string, options: DocumentSearchOptions) => this.query({ ...options, type: "attachment.document.search", sessionId, attachmentId }),
    original: (sessionId: string, attachmentId: string) => this.query({ type: "attachment.document.original", sessionId, attachmentId }),
    image: (sessionId: string, data: string, name = "Clipboard image", expectedRevision = this.draftRevision(sessionId)) => this.command({ type: "attachment.image.add", sessionId, data, name, expectedRevision }),
    folderPreview: (sessionId: string, path: string) => this.query({ type: "attachment.folder.preview", sessionId, path }),
    folder: (sessionId: string, path: string, expectedDigest: string, confirm: true, expectedRevision = this.draftRevision(sessionId)) => this.command({ type: "attachment.folder.add", sessionId, path, expectedDigest, confirm, expectedRevision }),
    githubPreview: (sessionId: string, url: string, access: AttachmentAccess = "public") => this.query({ type: "attachment.github.preview", sessionId, url, access }),
    github: (sessionId: string, url: string, access: AttachmentAccess, expectedDigest: string, confirm: true, expectedRevision = this.draftRevision(sessionId)) => this.command({ type: "attachment.github.add", sessionId, url, access, expectedDigest, confirm, expectedRevision }),
    sessionPreview: (sessionId: string, sourceSessionId: string) => this.query({ type: "attachment.session.preview", sessionId, sourceSessionId }),
    session: (sessionId: string, sourceSessionId: string, expectedDigest: string, confirm: true, expectedRevision = this.draftRevision(sessionId)) => this.command({ type: "attachment.session.add", sessionId, sourceSessionId, expectedDigest, confirm, expectedRevision }),
    read: (sessionId: string, attachmentId: string) => this.query({ type: "attachment.read", sessionId, attachmentId }),
  };
  readonly sessions = {
    progress: (sessionId: string) => this.query({ type: "session.progress", sessionId }),
    create: (projectId: string | null = null, title?: string, overrides?: ControlDefaults, workspaceId?: string) => this.command({ type: "session.create", projectId, ...(title ? { title } : {}), ...(overrides ? { overrides } : {}), ...(workspaceId ? { workspaceId } : {}) }),
    configure: (sessionId: string, controls: Controls, expectedRevision = this.sessionRevision(sessionId)) => this.command({ type: "session.configure", sessionId, controls, expectedRevision }),
    env: (sessionId: string, env: Controls["env"], expectedRevision = this.sessionRevision(sessionId)) => {
      const snapshot = this.getState().snapshot, session = snapshot?.sessions.find((value) => value.id === sessionId);
      if (!snapshot || !session) throw new ClientError("session_missing", "Choose an existing session.");
      const model = snapshot.provider.models.find((value) => value.id === session.controls.modelId);
      const keep = session.controls.modelId === null || Boolean(model && (!model.environments || model.environments.includes(env)));
      const { modelOptions: _, ...controls } = session.controls;
      return this.command({ type: "session.configure", sessionId, expectedRevision, controls: { ...(keep ? session.controls : controls), env, modelId: keep ? session.controls.modelId : null } });
    },
    modelOptions: (sessionId: string, modelOptions: ModelOptions, expectedRevision = this.sessionRevision(sessionId)) => {
      const session = this.getState().snapshot?.sessions.find((session) => session.id === sessionId);
      if (!session) throw new ClientError("session_missing", "Choose an existing session.");
      return this.command({ type: "session.configure", sessionId, controls: { ...session.controls, modelOptions }, expectedRevision });
    },
    context: (sessionId: string) => this.query({ type: "session.context", sessionId }),
    organize: (sessionId: string, changes: SessionChanges, expectedRevision = this.sessionRevision(sessionId)) => this.command({ type: "session.organize", sessionId, changes, expectedRevision }),
    reorder: (sessionIds: string[]) => this.command({ type: "session.reorder", sessions: sessionIds.map((sessionId) => ({ sessionId, revision: this.sessionRevision(sessionId) })) }),
    rename: (sessionId: string, title: string, expectedRevision = this.sessionRevision(sessionId)) => this.command({ type: "session.organize", sessionId, changes: { title }, expectedRevision }),
    mode: (sessionId: string, mode: SessionMode, expectedRevision = this.sessionRevision(sessionId)) => this.command({ type: "session.mode", sessionId, expectedRevision, mode }),
    spawn: (sessionId: string, kind: "agent" | "side", title?: string) => this.command({ type: "session.spawn", sessionId, kind, ...(title ? { title } : {}) }),
    delete: (sessionId: string, confirm: true, expectedRevision = this.sessionRevision(sessionId)) => this.command({ type: "session.delete", sessionId, expectedRevision, confirm }),
    fromWork: (projectId: string, source: { issueId: string } | { prUrl: string }, workspaceId?: string) => this.command({ type: "session.from-work", projectId, ...source, ...(workspaceId ? { workspaceId } : {}) }),
    group: (projectId: string, name: string, order = 0, id?: string, expectedRevision = 0) => this.command({ type: "session.group", projectId, name, order, expectedRevision, ...(id ? { id } : {}) }),
    browser: (sessionId: string, url: string) => this.command({ type: "session.browser", sessionId, url }),
  };
  readonly suggestions = {
    preview: (sessionId: string, allProjects = false) => this.query({ type: "suggestions.preview", sessionId, allProjects }),
    generate: (sessionId: string, expectedDigest: string, allProjects: boolean, confirmScope: true) => this.command({ type: "suggestions.generate", sessionId, expectedDigest, allProjects, confirmScope }),
  };
  readonly models = {
    refresh: () => this.command({ type: "provider.refresh" }),
    evidence: (modelId: string) => this.query({ type: "model.evidence", modelId }),
    setToken: (endpointId: string, token: string) => this.command({ type: "models.token.set", endpointId, token }),
    clearToken: (endpointId: string) => this.command({ type: "models.token.clear", endpointId }),
  };
  readonly compactions = {
    state: (sessionId: string) => this.query({ type: "compaction.state", sessionId }),
    preview: (sessionId: string, options: { modelId?: string; keepRecentTurns?: number } = {}) => this.query({ type: "compaction.preview", sessionId, ...options }),
    generate: (sessionId: string, preview: Pick<CompactionPreview, "digest" | "modelId" | "keepRecentTurns">, confirmCost: true) =>
      this.command({ type: "compaction.generate", sessionId, modelId: preview.modelId, keepRecentTurns: preview.keepRecentTurns, expectedDigest: preview.digest, confirmCost }),
    read: (sessionId: string, compactionId: string) => this.query({ type: "compaction.read", sessionId, compactionId }),
    apply: (sessionId: string, compactionId: string, expectedRevision: number) => this.command({ type: "compaction.apply", sessionId, compactionId, expectedRevision }),
    discard: (sessionId: string, compactionId: string, expectedRevision: number) => this.command({ type: "compaction.discard", sessionId, compactionId, expectedRevision }),
    stop: (sessionId: string, compactionId: string) => this.command({ type: "compaction.stop", sessionId, compactionId }),
    restore: (sessionId: string, expectedActiveId: string, expectedSourceDigest: string, confirm: true) => this.command({ type: "compaction.restore", sessionId, expectedActiveId, expectedSourceDigest, confirm }),
  };
  readonly profiles = {
    list: () => this.query({ type: "profile.list" }),
    create: (name: string, color: string | null = null) => this.command({ type: "profile.create", name, color, confirm: true }),
    update: (targetProfileId: string, changes: Pick<Partial<Profile>, "name" | "color">, expectedRevision: number) => this.command({ type: "profile.update", targetProfileId, expectedRevision, changes }),
    retry: (targetProfileId: string, expectedRevision: number, confirm: true) => this.command({ type: "profile.retry", targetProfileId, expectedRevision, confirm }),
    stop: (targetProfileId: string) => this.command({ type: "profile.cancel", targetProfileId }),
    defaults: (values: ControlDefaults, expectedRevision: number) => this.command({ type: "profile.global.defaults", values, expectedRevision }),
    globalBudget: (limit: BudgetLimit | null, expectedRevision: number, confirmRisk: true) => this.command({ type: "profile.global.budget", limit, expectedRevision, confirmRisk }),
    wait: async (profileId: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Profile> => {
      const deadline = Date.now() + (options.timeoutMs ?? 10_000);
      while (Date.now() < deadline) {
        options.signal?.throwIfAborted();
        const profile = (await this.query({ type: "profile.list" })).catalog.profiles.find((profile) => profile.id === profileId);
        if (!profile) throw new ClientError("profile_missing", "Profile was not registered. No Default fallback was used.");
        if (profile.status === "ready") return profile;
        if (profile.status === "partial") throw new ClientError("profile_partial", profile.diagnostic ?? "Inspect incomplete profile setup before explicitly retrying.");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new ClientError("profile_timeout", "Profile wait timed out. Setup was not cancelled or retried automatically; inspect its actual status.");
    },
    open: async (profileId: string): Promise<MoguriSdk> => {
      const profile = (await this.query({ type: "profile.list" })).catalog.profiles.find((profile) => profile.id === profileId);
      if (!profile || profile.status !== "ready") throw new ClientError("profile_unready", profile?.diagnostic ?? "Choose a ready registered profile. No Default fallback was used.");
      return new MoguriSdk(this.connection, this.resolveConnection, profileId).ready();
    },
  };
  readonly repositories = {
    preview: (sessionId: string) => this.query({ type: "repository.preview", sessionId }),
    state: (sessionId: string) => this.query({ type: "repository.state", sessionId }),
    refresh: (sessionId: string, expectedBinding: string, expectedRevision: number, confirm: true) => this.command({ type: "repository.refresh", sessionId, expectedBinding, expectedRevision, confirm }),
    clear: (sessionId: string, expectedRevision: number, confirm: true) => this.command({ type: "repository.clear", sessionId, expectedRevision, confirm }),
  };
  readonly telemetry = {
    operations: (filters: Omit<Extract<TelemetryQuery, { type: "telemetry.operations" }>, "type"> = {}) => this.query({ type: "telemetry.operations", ...filters }),
    storage: () => this.query({ type: "telemetry.storage" }),
  };
  readonly activity = {
    list: (sessionId: string, options: { before?: ActivityCursor; limit?: number } = {}) => this.query({ type: "activity.list", sessionId, ...options }),
    read: (sessionId: string, activityId: string, part: "arguments" | "output", options: { offset?: number; limit?: number } = {}) =>
      this.query({ type: "activity.read", sessionId, activityId, part, ...options }),
    turn: (sessionId: string, turnId: string) => this.query({ type: "activity.turn", sessionId, turnId }),
    response: (sessionId: string, turnId: string): string => {
      const session = this.getState().snapshot?.sessions.find((value) => value.id === sessionId);
      if (!session || !session.messages.some((message) => message.turnId === turnId)) throw new ClientError("activity_scope", "Choose an original turn in this profile's retained session.");
      return responseText(session.messages, turnId);
    },
  };
  readonly budgets = {
    status: (sessionId: string) => this.query({ type: "budget.status", sessionId }),
    dashboard: (filters: Omit<Extract<BudgetQuery, { type: "budget.dashboard" }>, "type"> = {}) => this.query({ type: "budget.dashboard", ...filters }),
    calls: (filters: Omit<Extract<BudgetQuery, { type: "budget.calls" }>, "type"> = {}) => this.query({ type: "budget.calls", ...filters }),
    plans: (filters: Omit<Extract<BudgetQuery, { type: "budget.plans" }>, "type"> = {}) => this.query({ type: "budget.plans", ...filters }),
    policy: (limit: BudgetLimit | null, expectedRevision: number, confirmRisk: true) => this.command({ type: "budget.policy", limit, expectedRevision, confirmRisk }),
  };
  readonly routing = {
    policy: () => this.settings.get()?.values.kupo ?? null,
    configure: (policy: KupoSettings, expectedSettingsRevision: number) => {
      const settings = this.settings.get();
      if (!settings) throw new ClientError("disconnected", "Connect to the actual profile before configuring routing.");
      return this.settings.update({ ...settings.values, kupo: policy }, expectedSettingsRevision);
    },
    history: (sessionId: string) => {
      const snapshot = this.getState().snapshot;
      if (!snapshot?.sessions.some((session) => session.id === sessionId)) throw new ClientError("session_missing", "Choose an existing session in this profile for routing provenance.");
      return snapshot.routings.filter((routing) => routing.sessionId === sessionId);
    },
  };
  readonly roleSequences = {
    contract: (sequenceId: string, index: number) => this.query({ type: "role.contract.read", sequenceId, index }),
    read: (sequenceId: string, index?: number) => this.query({ type: "role.sequence.read", sequenceId, ...(index === undefined ? {} : { index }) }),
    list: () => {
      const snapshot = this.getState().snapshot;
      if (!snapshot) throw new ClientError("disconnected", "Connect to this immutable profile before inspecting retained role sequences.");
      return snapshot.roleSequences;
    },
  };
  readonly compound = {
    lineageDraft: (input: CompoundLineageInput) => lineageDraft(() => {
      const snapshot = this.getState().snapshot;
      if (!snapshot) throw new ClientError("disconnected", "Connect to the actual profile before preparing an unpersisted source-backed lineage review.");
      return snapshot.provider.models;
    }, input),
    preview: (input: CompoundInput) => this.query({ type: "compound.preview", input }),
    start: (input: CompoundInput, expectedDigest: string, confirmCost: true) => this.command({ type: "compound.start", input, expectedDigest, confirmCost }),
    read: (workflowId: string) => this.query({ type: "compound.read", workflowId }),
    validationPreview: async (workflowId: string) => {
      const value = await this.compound.read(workflowId);
      if (!value.pendingValidation) throw new ClientError("compound_validation_missing", "This exact workflow has no current undecided validation review. Read its retained status; no review or command was replayed.");
      return { workflowId: value.workflow.id, sessionId: value.workflow.sessionId, revision: value.workflow.revision, review: value.pendingValidation };
    },
    review: (workflowId: string, validationId: string, expectedRevision: number, expectedDigest: string, allow: boolean) =>
      this.command({ type: "compound.review", workflowId, validationId, expectedRevision, expectedDigest, allow }),
    stop: (workflowId: string) => this.command({ type: "compound.stop", workflowId }),
    list: (sessionId?: string) => {
      const snapshot = this.getState().snapshot;
      if (!snapshot) throw new ClientError("disconnected", "Connect to the actual immutable profile before reading public workflow history.");
      return snapshot.compoundWorkflows.filter((workflow) => sessionId === undefined || workflow.sessionId === sessionId);
    },
  };
  readonly winddown = {
    status: (sessionId: string) => this.query({ type: "winddown.status", sessionId }),
    list: (sessionId?: string) => {
      const snapshot = this.getState().snapshot;
      if (!snapshot) throw new ClientError("disconnected", "Connect to the actual immutable profile before reading budget checkpoint history.");
      return snapshot.winddowns.filter((record) => sessionId === undefined || record.sessionId === sessionId);
    },
    read: (winddownId: string) => this.query({ type: "winddown.read", winddownId }),
    commitPreview: (input: Omit<Extract<WinddownQuery, { type: "winddown.commit.preview" }>, "type">) => this.query({ type: "winddown.commit.preview", ...input }),
    commit: (input: Omit<Extract<WinddownQuery, { type: "winddown.commit.preview" }>, "type">, expectedRevision: number, expectedDigest: string, confirm: true) =>
      this.command({ type: "winddown.commit", ...input, expectedRevision, expectedDigest, confirm }),
    waitCommit: async (winddownId: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}) => {
      const value = await this.winddown.read(winddownId);
      if (!value.winddown.commit) throw new ClientError("winddown_commit_missing", "No original actual-user commit job is retained. Preview and review it explicitly; nothing was retried.");
      await this.jobs.wait(value.winddown.commit.jobId, options);
      return this.winddown.read(winddownId);
    },
    stop: (winddownId: string) => this.command({ type: "winddown.stop", winddownId }),
    decline: (winddownId: string, expectedRevision: number, confirm: true) => this.command({ type: "winddown.decline", winddownId, expectedRevision, confirm }),
  };
  readonly decisions = {
    status: (sessionId: string) => this.query({ type: "decisions.status", sessionId }),
    read: (decisionId: string) => this.query({ type: "decisions.read", decisionId }),
    stop: (decisionId: string) => this.command({ type: "decisions.stop", decisionId }),
    list: (sessionId?: string) => {
      const snapshot = this.getState().snapshot;
      if (!snapshot) throw new ClientError("not_ready", "Connect before reading retained decision-provider requests.");
      if (sessionId !== undefined && !snapshot.sessions.some((session) => session.id === sessionId)) throw new ClientError("session_missing", "Choose an exact session in this immutable profile.");
      return snapshot.decisions.filter((record) => sessionId === undefined || record.sessionId === sessionId);
    },
  };
  readonly candidates = {
    generatePreview: (sessionId: string, stageWorkspaceId: string, input: CandidateGenerationInput) => this.query({ type: "candidate.generation.preview", sessionId, stageWorkspaceId, input }),
    generate: (sessionId: string, stageWorkspaceId: string, input: CandidateGenerationInput, expectedDigest: string, confirmCost: true) =>
      this.command({ type: "candidate.generate", sessionId, stageWorkspaceId, input, expectedDigest, confirmCost }),
    generation: (generationId: string) => this.query({ type: "candidate.generation.read", generationId }),
    stopGeneration: (generationId: string) => this.command({ type: "candidate.generation.stop", generationId }),
    waitGeneration: async (generationId: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Extract<CandidateGenerationResponse, { type: "candidate.generation.read" }>> => {
      const deadline = Date.now() + (options.timeoutMs ?? 180_000);
      while (Date.now() < deadline) {
        options.signal?.throwIfAborted();
        const current = this.getState().snapshot?.candidateGenerations.find((record) => record.id === generationId);
        if (this.getState().status !== "connected") throw new ClientError("disconnected", "Generation remains owned by its service. Reconnect and inspect the same record; it was not retried.");
        if (!current || current.status !== "running") {
          const result = await this.candidates.generation(generationId); options.signal?.throwIfAborted();
          if (result.generation.status !== "running") return result;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new ClientError("candidate_generation_timeout", "Generation has not settled. Inspect or explicitly stop its original owned operation; no success was inferred.");
    },
    roleProposal: (sequenceId: string) => this.query({ type: "candidate.role.proposal", sequenceId }),
    preview: (sessionId: string, stageWorkspaceId: string, patch: CandidatePatch, origin?: CandidateRoleReference) => this.query({ type: "candidate.preview", sessionId, stageWorkspaceId, patch, ...(origin ?? {}) }),
    stage: (sessionId: string, stageWorkspaceId: string, patch: CandidatePatch, expectedDigest: string, origin?: string | CandidateRoleReference) => this.command({ type: "candidate.stage", sessionId, stageWorkspaceId, patch, expectedDigest,
      ...(typeof origin === "string" ? { generationId: origin } : origin ?? {}), confirm: true }),
    read: (candidateId: string) => this.query({ type: "candidate.read", candidateId }),
    applyPreview: (candidateId: string, sessionId: string) => this.query({ type: "candidate.apply.preview", candidateId, sessionId }),
    apply: (candidateId: string, sessionId: string, expectedRevision: number, expectedDigest: string) => this.command({ type: "candidate.apply", candidateId, sessionId, expectedRevision, expectedDigest, confirm: true }),
    reject: (candidateId: string, expectedRevision: number, confirm: true) => this.command({ type: "candidate.reject", candidateId, expectedRevision, confirm }),
    stop: async (candidateId: string) => {
      const current = await this.candidates.read(candidateId), job = current.candidate.status === "staging" ? current.stageJob : current.candidate.status === "applying" ? current.applyJob : null;
      if (!job || !["running", "waiting_input"].includes(job.status)) throw new ClientError("candidate_state", "This candidate has no active owned job to stop. Partial/terminal work was not replayed.");
      return this.jobs.cancel(job.id);
    },
    wait: async (candidateId: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<CandidateRead> => {
      const current = await this.candidates.read(candidateId), jobId = current.candidate.applyIntent?.jobId ?? current.candidate.stageIntent.jobId;
      await this.jobs.wait(jobId, options);
      return this.candidates.read(candidateId);
    },
  };
  readonly artifacts = {
    create: (sessionId: string | null, artifact: { kind: ArtifactKind; name: string; text: string; projectId?: string | null; folderId?: string | null; workItemId?: string | null }) => this.command({ type: "artifact.create", sessionId, ...artifact }),
    source: (sessionId: string, sourceKind: "message" | "tool", sourceId: string) => this.query({ type: "artifact.source", sessionId, sourceKind, sourceId }),
    promote: (sessionId: string, source: { sourceKind: "message" | "tool"; sourceId: string; kind: ArtifactKind; name: string; expectedDigest: string }) => this.command({ type: "artifact.promote", sessionId, ...source }),
    read: (artifactId: string, revision?: number) => this.query({ type: "artifact.read", artifactId, ...(revision === undefined ? {} : { revision }) }),
    history: (artifactId: string, offset = 0, limit = 20) => this.query({ type: "artifact.history", artifactId, offset, limit }),
    update: (artifactId: string, changes: ArtifactChanges, expectedRevision: number) => this.command({ type: "artifact.update", artifactId, changes, expectedRevision }),
    delete: (artifactId: string, expectedRevision: number, confirm: true) => this.command({ type: "artifact.delete", artifactId, expectedRevision, confirm }),
    export: (artifactId: string) => this.query({ type: "artifact.export", artifactId }),
    projectPreview: (projectId: string) => this.query({ type: "project.artifacts.preview", projectId }),
    projectExport: (projectId: string) => this.query({ type: "project.artifacts.export", projectId }),
    materializePreview: (projectId: string, options: { workspaceId?: string; commitBranch?: string } = {}) => this.query({ type: "project.artifacts.materialize.preview", projectId, ...options }),
    materialize: (projectId: string, expectedDigest: string, options: { workspaceId?: string; commitBranch?: string } = {}) => this.command({ type: "project.artifacts.materialize", projectId, expectedDigest, confirm: true, ...options }),
    materialization: (jobId: string) => this.query({ type: "artifact.materialization", jobId }),
  };
  readonly questions = {
    answer: (questionId: string, text: string, expectedRevision: number, consumeDraft?: { sessionId: string; expectedRevision: number }) => this.command({ type: "question.answer", questionId, text, expectedRevision, ...(consumeDraft ? { consumeDraft } : {}) }),
    answerDraft: (questionId: string, expectedRevision: number) => {
      const question = this.getState().snapshot?.questions.find((question) => question.id === questionId);
      const session = this.getState().snapshot?.sessions.find((session) => session.id === question?.sessionId);
      if (!question || !session) throw new ClientError("question_missing", "Connect and review the actual pending question.");
      return this.command({ type: "question.answer", questionId, text: session.draft.text, expectedRevision, consumeDraft: { sessionId: session.id, expectedRevision: session.draft.revision } });
    },
  };
  readonly workspaces = {
    discover: (projectId: string) => this.query({ type: "workspace.discover", projectId }),
    create: (projectId: string, branch: string, options: { baseRef?: string; issueId?: string; prUrl?: string } = {}) => this.command({ type: "workspace.create", projectId, branch, ...options }),
    inspect: (workspaceId: string) => this.query({ type: "workspace.inspect", workspaceId }),
    bind: (sessionId: string, workspaceId: string | null, expectedRevision = this.sessionRevision(sessionId)) => this.command({ type: "session.workspace", sessionId, workspaceId, expectedRevision }),
    remove: (workspaceId: string, expectedRevision: number, confirm: true) => this.command({ type: "workspace.remove", workspaceId, expectedRevision, confirm }),
    reconcile: (workspaceId: string, expectedRevision: number) => this.command({ type: "workspace.reconcile", workspaceId, expectedRevision }),
    git: (sessionId: string, diff = true) => this.query({ type: "session.git", sessionId, diff }),
    files: (sessionId: string, path = ".") => this.query({ type: "session.files", sessionId, path }),
    file: (sessionId: string, path: string) => this.query({ type: "session.file", sessionId, path }),
    wait: async (workspaceId: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}) => {
      const workspace = this.getState().snapshot?.managedWorkspaces.find((value) => value.id === workspaceId);
      if (!workspace) throw new ClientError("workspace_missing", "Connect and choose an existing managed workspace.");
      if (workspace.jobId) {
        const job = await this.jobs.wait(workspace.jobId, options);
        if (job.status !== "completed") throw new ClientError("workspace_partial", job.error ?? `Workspace work ${job.status}; no success was assumed.`);
      }
      const result = this.getState().snapshot?.managedWorkspaces.find((value) => value.id === workspaceId);
      if (!result) throw new ClientError("workspace_missing", "Workspace metadata was removed while waiting.");
      return result;
    },
  };
  readonly remote = {
    status: () => this.query({ type: "remote.status" }),
    probe: () => this.command({ type: "remote.probe" }),
    reconcile: (executionId: string) => this.command({ type: "remote.reconcile", executionId }),
    acknowledge: (executionId: string, confirmInspection: true) => this.command({ type: "remote.acknowledge", executionId, confirmInspection }),
    setToken: (endpointId: string, token: string) => this.command({ type: "remote.model-token.set", endpointId, token }),
    clearToken: (endpointId: string) => this.command({ type: "remote.model-token.clear", endpointId }),
  };
  readonly metachat = {
    create: (projectId: string | null = null, parentSessionId?: string, prompt?: string) => this.command({ type: "metachat.create", projectId, ...(parentSessionId ? { parentSessionId } : {}), ...(prompt ? { prompt } : {}) }),
  };
  readonly configuration = {
    propose: (sessionId: string, proposal: ConfigurationSpec) => this.command({ type: "configuration.propose", sessionId, proposal }),
    review: (proposalId: string) => this.query({ type: "configuration.review", proposalId }),
    decide: (proposalId: string, approve: boolean, expectedDigest: string, acknowledgeRisk: boolean) => this.command({ type: "configuration.decide", proposalId, approve, expectedDigest, acknowledgeRisk }),
  };
  readonly attention = {
    acknowledge: (attentionIds: string[]) => this.command({ type: "attention.acknowledge", attentionIds }),
  };
  readonly projects = {
    add: (path: string, name?: string) => this.command({ type: "project.add", path, ...(name !== undefined ? { name } : {}) }),
    configuration: (projectId: string) => this.query({ type: "project.configuration", projectId }),
    configure: (projectId: string, settings: ProjectSettings, expectedRevision: number) => this.command({ type: "project.settings", projectId, settings, expectedRevision }),
    organize: (projectId: string, presentation: { folderId: string | null; color: string; order: number }, expectedRevision: number) => this.command({ type: "project.organize", projectId, ...presentation, expectedRevision }),
    reorder: (folderId: string | null, projects: { projectId: string; revision: number }[]) => this.command({ type: "project.reorder", folderId, projects }),
    folder: (name: string, order = 0, id?: string, expectedRevision = 0) => this.command({ type: "project.folder", name, order, expectedRevision, ...(id ? { id } : {}) }),
    relocate: (projectId: string, path: string, expectedRevision: number) => this.command({ type: "project.relocate", projectId, path, expectedRevision }),
    remove: (projectId: string, confirm: true, expectedRevision: number, artifacts?: ProjectArtifactChoice) => this.command({ type: "project.remove", projectId, expectedRevision, confirm, ...(artifacts ? { artifacts } : {}) }),
    git: (projectId: string, diff = true) => this.query({ type: "project.git", projectId, diff }),
    sources: (projectId: string) => this.query({ type: "project.sources", projectId }),
    porto: (projectId: string) => this.query({ type: "project.porto", projectId }),
    initialize: (projectId: string, branch: string, expectedRevision: number, confirmPush: true) => this.command({ type: "project.defaults", projectId, expectedRevision, branch, confirmPush }),
    importMcp: (projectId: string, expectedRevision: number, confirmReview: true, expectedDigest: string) => this.command({ type: "project.mcp.import", projectId, expectedRevision, confirmReview, expectedDigest }),
  };
  readonly prompts = {
    text: (sessionId: string, id?: string): string => {
      const session = this.getState().snapshot?.sessions.find((session) => session.id === sessionId);
      if (!session) throw new ClientError("session_missing", "Choose an existing session.");
      const queued = id ? session.queue.find((item) => item.id === id) : undefined;
      const message = id ? session.messages.find((message) => message.id === id) : session.messages.findLast((message) => message.role === "user");
      if (!queued && !message) throw new ClientError("prompt_missing", "This prompt is no longer available.");
      return queued?.text ?? message!.text;
    },
    release: (sessionId: string, messageId: string, expectedRevision: number) => this.command({ type: "queue.release", sessionId, messageId, expectedRevision }),
  };
  readonly plans = {
    read: (sessionId: string) => this.query({ type: "plan.read", sessionId }),
    save: (sessionId: string, text: string, expectedDigest: string, expectedBinding?: string) => this.command({ type: "plan.save", sessionId, text, expectedDigest, ...(expectedBinding ? { expectedBinding } : {}) }),
    capture: (sessionId: string, path?: string) => this.command({ type: "artifact.capture", sessionId, ...(path ? { path } : {}) }),
    artifact: (artifactId: string) => this.query({ type: "artifact.read", artifactId }),
    saves: (sessionId: string) => this.query({ type: "plan.saves", sessionId }),
    saveInfo: (sessionId: string, saveId: string) => this.query({ type: "plan.save-info", sessionId, saveId }),
    stopSave: (sessionId: string, saveId: string) => this.command({ type: "plan.stop-save", sessionId, saveId }),
  };
  private async terminalInput(request: TerminalInput): Promise<void> {
    parse(TerminalInputSchema, request);
    const result = await this.request("/v1/terminal", request);
    if (!isRecord(result) || result.accepted !== true) throw new ClientError("terminal_input", "Terminal input acknowledgement was not confirmed. It was not automatically replayed.");
  }
  readonly terminal = {
    openGlobal: (cols = 80, rows = 24) => this.command({ type: "terminal.global.open", cols, rows }),
    open: (sessionId: string, cols = 80, rows = 24, scriptId?: string) => this.command({ type: "terminal.open", sessionId, cols, rows, ...(scriptId ? { scriptId } : {}) }),
    input: async (terminalId: string, data: string, signal?: AbortSignal) => {
      if (!data.length) throw new ClientError("terminal_input", "Terminal input must contain at least one character.");
      const original = this.getState().snapshot?.terminals.find((terminal) => terminal.id === terminalId);
      if (!original || original.status !== "running" || this.getState().status !== "connected") throw new ClientError("terminal_input_stopped", "This terminal is not running under an attached owner. Nothing was replayed.");
      const attachmentId = original.attachmentId, connectionToken = this.connection.token;
      for (let offset = 0; offset < data.length;) {
        signal?.throwIfAborted();
        const current = this.getState().snapshot?.terminals.find((terminal) => terminal.id === terminalId);
        if (this.getState().status !== "connected" || this.connection.token !== connectionToken || current?.status !== "running" || current.attachmentId !== attachmentId) throw new ClientError("terminal_input_stopped", "The terminal controller changed during input. Some bytes may have arrived; remaining queued input was discarded, never replayed.");
        let end = Math.min(offset + 16384, data.length);
        if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1]!)) end--;
        await this.terminalInput({ action: "input", terminalId, data: data.slice(offset, end) }); offset = end;
        signal?.throwIfAborted();
      }
    },
    resize: (terminalId: string, cols: number, rows: number) => this.terminalInput({ action: "resize", terminalId, cols, rows }),
    read: (terminalId: string, offset = 0, limit = 65536) => this.query({ type: "terminal.read", terminalId, offset, limit }),
    close: (terminalId: string) => this.command({ type: "terminal.close", terminalId }),
    reconcile: (terminalId: string) => this.command({ type: "terminal.reconcile", terminalId }),
    reconcileOwner: (ownerId: string) => this.command({ type: "terminal.owner.reconcile", ownerId }),
    acknowledge: (terminalId: string, confirmInspection: true) => this.command({ type: "terminal.acknowledge", terminalId, confirmInspection }),
    acknowledgeOwner: (ownerId: string, confirmInspection: true) => this.command({ type: "terminal.owner.acknowledge", ownerId, confirmInspection }),
  };
  slash(sessionId: string, text: string, client: "desktop" | "tui" | "cli" = "desktop"): Promise<SlashResult> { return executeSlash(this, sessionId, text, client); }
  async query<Q extends PlatformQuery>(query: Q): Promise<Extract<PlatformResponse, { type: Q["type"] }>> {
    parse(QuerySchema, query);
    const result = await this.request("/v1/query", query);
    if (!isRecord(result) || result.type !== query.type) throw new ClientError("invalid_response", "The service returned an incompatible capability response.");
    return result as Extract<PlatformResponse, { type: Q["type"] }>;
  }
  readonly settings = {
    get: () => this.getState().snapshot?.settings ?? null,
    update: (settings: UserSettings, expectedRevision: number, acknowledgePromptRisk = false) =>
      this.command({ type: "settings.update", settings, expectedRevision, acknowledgePromptRisk }),
    reset: (section: SettingsSection | "all", expectedRevision: number) =>
      this.command({ type: "settings.reset", section, expectedRevision }),
  };
  readonly prompt = {
    preview: (sessionId?: string) => this.query({ type: "prompt.preview", ...(sessionId ? { sessionId } : {}) }),
    set: (text: string, expectedRevision: number, acknowledgeRisk: boolean) => {
      const values = this.getState().snapshot?.settings.values;
      if (!values) throw new ClientError("disconnected", "Connect before editing the system prompt.");
      return this.settings.update({ ...values, systemPrompt: text }, expectedRevision, acknowledgeRisk);
    },
    reset: (expectedRevision: number) => this.settings.reset("systemPrompt", expectedRevision),
  };
  readonly memory = {
    index: (projectId: string, workspaceId?: string) => this.command({ type: "memory.index", projectId, ...(workspaceId ? { workspaceId } : {}) }),
    indexSession: (sessionId: string) => this.command({ type: "memory.index", sessionId }),
    search: (projectId: string, text: string, limit = 6, workspaceId?: string) => this.query({ type: "memory.search", projectId, text, limit, ...(workspaceId ? { workspaceId } : {}) }),
    searchSession: (sessionId: string, text: string, limit = 6) => this.query({ type: "memory.search", sessionId, text, limit }),
    graph: (projectId: string, path = "", workspaceId?: string) => this.query({ type: "memory.graph", projectId, path, ...(workspaceId ? { workspaceId } : {}) }),
    graphSession: (sessionId: string, path = "") => this.query({ type: "memory.graph", sessionId, path }),
    state: (sessionId: string) => this.query({ type: "memory.state", sessionId }),
    remember: (projectId: string, text: string) => this.command({ type: "memory.remember", projectId, text }),
  };
  readonly knowledge = {
    save: (input: KnowledgeInput, id?: string, expectedRevision = 0) => this.command({ type: "knowledge.save", input, ...(id ? { id } : {}), expectedRevision }),
    list: (input: Omit<Extract<KnowledgeQuery, { type: "knowledge.list" }>, "type" | "text"> & { text?: string }) => this.query({ type: "knowledge.list", ...input, text: input.text ?? "" }),
    read: (id: string) => this.query({ type: "knowledge.read", id }),
    history: (id: string) => this.query({ type: "knowledge.history", id }),
    version: (id: string, contentDigest: string) => this.query({ type: "knowledge.version", id, contentDigest }),
    promote: (id: string, expectedRevision: number, expectedDigest: string, input: KnowledgePromotion, confirm: true) =>
      this.command({ type: "knowledge.promote", id, expectedRevision, expectedDigest, input, confirm }),
    forget: (id: string, expectedRevision: number, confirm: true) => this.command({ type: "knowledge.forget", id, expectedRevision, confirm }),
    rollback: (id: string, expectedRevision: number, contentDigest: string, confirm: true) => this.command({ type: "knowledge.rollback", id, expectedRevision, contentDigest, confirm }),
  };
  readonly containment = {
    status: () => this.query({ type: "containment.status" }),
    requireSandbox: (confirm: true) => {
      if (confirm !== true) throw new ClientError("containment_review", "Explicitly review the qualified-Sandbox requirement before changing global allowed environments.");
      return this.command({ type: "policy.set", allowedEnvs: ["Sandbox"] });
    },
  };
  readonly hooks = {
    import: (projectId: string, definition: HookDefinition) => this.command({ type: "hook.import", projectId, definition }),
  };
  readonly marketplace = {
    catalog: (input: MarketplaceSource) => this.query({ type: "marketplace.catalog", input }),
    preview: (input: MarketplaceInput) => this.query({ type: "marketplace.preview", input }),
    install: (input: MarketplaceInput, expectedDigest: string, confirm: true) => this.command({ type: "marketplace.install", input, expectedDigest, confirm }),
  };
  readonly capabilities = {
    content: (capabilityId: string) => this.query({ type: "capability.content", capabilityId }),
    toggle: (capabilityId: string, enabled: boolean, expectedRevision: number) => this.command({ type: "capability.toggle", capabilityId, enabled, expectedRevision }),
    importSkill: (projectId: string, path: string) => this.command({ type: "skill.import", projectId, path }),
    importPlugin: (projectId: string, path: string) => this.command({ type: "plugin.import", projectId, path }),
    propose: (projectId: string, kind: "skill" | "script" | "memory" | "hook", name: string, content: string) => this.command({ type: "proposal.create", projectId, kind, name, content }),
    history: (capabilityId: string, offset = 0) => this.query({ type: "capability.history", capabilityId, offset }),
    version: (capabilityId: string, contentDigest: string) => this.query({ type: "capability.version", capabilityId, contentDigest }),
    rollback: (capabilityId: string, expectedRevision: number, contentDigest: string, confirm: true) => this.command({ type: "capability.rollback", capabilityId, expectedRevision, contentDigest, confirm }),
    useSkill: (sessionId: string, capabilityId: string, expectedDigest: string, expectedDraftRevision = this.draftRevision(sessionId)) =>
      this.command({ type: "skill.use", sessionId, capabilityId, expectedDigest, expectedDraftRevision }),
    proposal: (proposalId: string) => this.query({ type: "proposal.content", proposalId }),
    decide: (proposalId: string, approve: boolean, expectedDigest: string) => this.command({ type: "proposal.decide", proposalId, approve, expectedDigest }),
  };
  readonly mcp = {
    servers: (sessionId?: string) => this.query({ type: "mcp.servers", ...(sessionId ? { sessionId } : {}) }),
    remotePreview: (sessionId: string, serverId: string) => this.query({ type: "mcp.remote.preview", sessionId, serverId }),
    grantRemote: (sessionId: string, serverId: string, expectedDigest: string, expectedRevision: number, forwardAccess: boolean, confirmReview: true) =>
      this.command({ type: "mcp.remote.grant", sessionId, serverId, expectedDigest, expectedRevision, forwardAccess, confirmReview }),
    revokeRemote: (sessionId: string, serverId: string, expectedRevision: number, confirmReview: true) =>
      this.command({ type: "mcp.remote.revoke", sessionId, serverId, expectedRevision, confirmReview }),
    remoteCalls: (sessionId: string) => this.query({ type: "mcp.remote.calls", sessionId }),
    remoteCall: (sessionId: string, operationId: string) => this.query({ type: "mcp.remote.call", sessionId, operationId }),
    oauthBegin: (serverId: string, sessionId?: string) => this.command({ type: "mcp.oauth.begin", serverId, ...(sessionId ? { sessionId } : {}) }),
    oauthCancel: (authorizationId: string) => this.command({ type: "mcp.oauth.cancel", authorizationId }),
    oauthClear: (serverId: string, sessionId?: string) => this.command({ type: "mcp.oauth.clear", serverId, ...(sessionId ? { sessionId } : {}) }),
    oauthClient: (serverId: string, clientId: string, issuer: string, clientSecret?: string, sessionId?: string, redirectUri?: string) => this.command({ type: "mcp.oauth.client", serverId, clientId, issuer, ...(clientSecret ? { clientSecret } : {}), ...(sessionId ? { sessionId } : {}), ...(redirectUri ? { redirectUri } : {}) }),
    oauthStatus: (authorizationId: string) => this.query({ type: "mcp.oauth.status", authorizationId }),
    tools: (serverId = "builtin", query = "", offset = 0, sessionId?: string) => this.query({ type: "mcp.tools", serverId, query, offset, ...(sessionId ? { sessionId } : {}) }),
    auth: (serverId: string, sessionId?: string) => this.query({ type: "mcp.auth", serverId, ...(sessionId ? { sessionId } : {}) }),
    setToken: (serverId: string, token: string, sessionId?: string) => this.command({ type: "mcp.token.set", serverId, token, ...(sessionId ? { sessionId } : {}) }),
    clearToken: (serverId: string, sessionId?: string) => this.command({ type: "mcp.token.clear", serverId, ...(sessionId ? { sessionId } : {}) }),
    call: (sessionId: string, serverId: string, tool: string, args: Record<string, unknown>, schemaDigest: string) => this.command({ type: "mcp.call", sessionId, serverId, tool, arguments: args, schemaDigest }),
    readResult: (resultId: string, offset = 0, limit = 12000) => this.query({ type: "result.read", resultId, offset, limit }),
  };
  readonly voice = {
    status: () => this.query({ type: "voice.status" }),
    download: (acceptLicense: true) => this.command({ type: "voice.download", acceptLicense }),
    record: (sessionId: string) => this.command({ type: "voice.record", sessionId }),
    transcribe: (sessionId: string, path: string) => this.command({ type: "voice.transcribe", sessionId, path }),
    stop: (jobId: string) => this.command({ type: "voice.stop", jobId }),
    insert: (sessionId: string, jobId: string, expectedRevision: number) => this.command({ type: "voice.insert", sessionId, jobId, expectedRevision }),
  };
  readonly subagents = { run: (sessionId: string, prompt: string) => this.command({ type: "subagent.run", sessionId, prompt }) };
  readonly sandbox = {
    status: () => this.query({ type: "sandbox.status" }),
    probe: () => this.command({ type: "sandbox.probe", confirm: true }),
    preview: (sessionId: string, paths: string[]) => this.query({ type: "sandbox.preview", sessionId, paths }),
    prepare: (sessionId: string, paths: string[], expectedDigest: string, expectedRevision: number) =>
      this.command({ type: "sandbox.prepare", sessionId, paths, expectedDigest, expectedRevision, confirm: true }),
    execution: (executionId: string) => this.query({ type: "sandbox.execution", executionId }),
    result: (executionId: string) => this.query({ type: "sandbox.result", executionId }),
    reconcile: (executionId: string) => this.command({ type: "sandbox.reconcile", executionId, confirm: true }),
    stop: (executionId: string) => this.command({ type: "sandbox.stop", executionId }),
    publicationPreview: (executionId: string, paths: string[]) => this.query({ type: "sandbox.publication.preview", executionId, paths }),
    publish: (executionId: string, paths: string[], expectedDigest: string, expectedRevision: number) =>
      this.command({ type: "sandbox.publish", executionId, paths, expectedDigest, expectedRevision, confirm: true }),
    publication: (publicationId: string) => this.query({ type: "sandbox.publication", publicationId }),
    waitPublication: async (publicationId: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Extract<PlatformResponse, { type: "sandbox.publication" }>> => {
      const before = await this.sandbox.publication(publicationId);
      await this.jobs.wait(before.publication.jobId, options);
      return this.sandbox.publication(publicationId);
    },
  };
  readonly issues = {
    board: (projectId: string) => this.query({ type: "board.get", projectId }),
    configure: (projectId: string, config: BoardConfig, expectedRevision: number) => this.command({ type: "board.save", projectId,
      config: { columns: config.columns, mergedColumnId: config.mergedColumnId, autoRefreshPrs: config.autoRefreshPrs, githubAccess: config.githubAccess, linear: config.linear }, expectedRevision }),
    create: (projectId: string, fields: IssueInput) => this.command({ type: "issue.create", projectId, ...fields }),
    update: (issueId: string, fields: IssueInput, expectedRevision: number) => this.command({ type: "issue.update", issueId, ...fields, expectedRevision }),
    move: (issueId: string, phaseId: string, expectedRevision: number) => this.command({ type: "issue.move", issueId, phaseId, expectedRevision }),
    archive: (issueId: string, archived: boolean, expectedRevision: number) => this.command({ type: "issue.archive", issueId, archived, expectedRevision }),
    refresh: (projectId: string) => this.command({ type: "issues.refresh", projectId }),
  };
  readonly cache = createCacheApi(this);
  readonly linear = {
    ...createLinearWorkflowApi(this),
    status: (projectId: string) => this.query({ type: "linear.status", projectId }),
    setToken: (token: string) => this.command({ type: "linear.token.set", token }),
    clearToken: () => this.command({ type: "linear.token.clear" }),
    import: (projectId: string, cursor?: string) => this.command({ type: "linear.import", projectId, ...(cursor ? { cursor } : {}) }),
  };
  readonly jobs = {
    cancel: (jobId: string) => this.command({ type: "job.cancel", jobId }),
    wait: async (jobId: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<CapabilityJob> => {
      const deadline = Date.now() + (options.timeoutMs ?? 15 * 60_000);
      while (Date.now() < deadline) {
        options.signal?.throwIfAborted();
        const job = this.getState().snapshot?.jobs.find((job) => job.id === jobId);
        if (job && !["running", "waiting_input"].includes(job.status)) return job;
        if (this.getState().status !== "connected") throw new ClientError("disconnected", "The capability is retained by the service. Reconnect before waiting again; it was not retried.");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new ClientError("job_wait_timeout", "The wait timed out. The service still owns this job; inspect it or explicitly cancel it.");
    },
  };
  async ready(timeoutMs = 10_000): Promise<this> {
    try { await this.connect(); } catch (error) { this.disconnect(); throw error; }
    const deadline = Date.now() + timeoutMs;
    while (this.getState().status !== "connected" && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    if (this.getState().status !== "connected") { this.disconnect(); throw new ClientError("connection_timeout", "Moguri protocol negotiation did not complete."); }
    return this;
  }
}
export { MoguriSdk as MoguriClient };
