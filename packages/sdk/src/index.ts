import { MoguriClient as TransportClient, ClientError } from "../../client/src/index.ts";
import { isRecord, QuerySchema, parse, TerminalInputSchema, type PlatformQuery, type PlatformResponse, type SettingsSection, type UserSettings, type CapabilityJob, type BoardConfig, type IssueInput, type SessionChanges, type SessionMode, type ProjectSettings, type TerminalInput, type Controls, type ModelOptions, type ConfigurationSpec, type ControlDefaults, type ArtifactKind, type ArtifactChanges, type ProjectArtifactChoice } from "../../protocol/src/index.ts";
import { audioBase64, SpeechCaptureRequestSchema, validateSpeechWav } from "../../protocol/src/audio.ts";
import type { DashboardQuery, BudgetLimit, BudgetQuery, KupoSettings, Profile, CompactionPreview, TelemetryQuery, Session, CandidatePatch, CandidateRead, CandidateGenerationInput, CandidateGenerationResponse, CandidateRoleReference, CompoundInput, CompoundLineageInput, WinddownQuery } from "../../protocol/src/index.ts";
import type { Attachment, AttachmentAccess, DocumentReadOptions, DocumentSearchOptions, DocumentListOptions } from "../../protocol/src/index.ts";
import { lineageDraft } from "./compound.ts";
import { executeSlash, type SlashResult } from "./slash.ts";
import { responseText, type ActivityCursor } from "../../protocol/src/activity.ts";
import type { KnowledgeInput, KnowledgePromotion, KnowledgeQuery } from "../../protocol/src/knowledge.ts";
import type { HookDefinition, MarketplaceInput, MarketplaceSource } from "../../protocol/src/extensions.ts";
import { createCacheApi } from "./cache.ts";
import { createGithubApi } from "./github.ts";
import { createLinearWorkflowApi } from "./linear.ts";
import type { BrowserHostOwner, BrowserResult } from "../../protocol/src/browser.ts";
import type { RememberApproval } from "../../protocol/src/permissions.ts";
import type { KanbanSource } from "../../protocol/src/kanban.ts";
import { PRICE_PROVIDERS, type PriceProvider } from "../../protocol/src/pricing.ts";

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
  readonly browser = {
    state: (sessionId: string) => this.query({ type: "browser.state", sessionId }),
    host: {
      attach: (owner: BrowserHostOwner) => this.command({ type: "browser.host.attach", ...owner }),
      control: (owner: BrowserHostOwner, sequence: number, enabled: boolean) => this.command({ type: "browser.host.control", ...owner, sequence, enabled }),
      poll: (owner: BrowserHostOwner, url: string, title: string) => this.query({ type: "browser.host.poll", ...owner, url, title }),
      reply: (owner: BrowserHostOwner, requestId: string, result: BrowserResult) => this.command({ type: "browser.host.reply", ...owner, requestId, result }),
      detach: (owner: BrowserHostOwner) => this.command({ type: "browser.host.detach", ...owner }),
    },
  };
  readonly github = createGithubApi(this);
  readonly prices = {
    catalog: () => this.query({ type: "pricing.catalog" }),
    refresh: (providers: PriceProvider[] = [...PRICE_PROVIDERS], expectedRevision = this.getState().snapshot?.providerPriceRevision) => {
      if (expectedRevision === undefined) throw new ClientError("pricing_missing", "Connect before refreshing this profile's provider references.");
      return this.command({ type: "pricing.refresh", providers, expectedRevision });
    },
  };
  readonly kanban = {
    open: (projectId: string) => this.command({ type: "kanban.open", projectId }),
    choose: (review: import("../../protocol/src/kanban.ts").ContinueWorkReview, choice: import("../../protocol/src/kanban.ts").ContinueWorkChoice) => {
      if (review.profileId !== this.profileId) throw new ClientError("continue_work_stale", "The continuation review belongs to another profile. No prompt or task was dispatched.");
      return this.command({ type: "message.send", sessionId: review.sessionId, expectedRevision: review.expectedRevision, delivery: "queue", continueWorkChoice: choice });
    },
    items: (projectId: string, source: KanbanSource = "kanban", page = 1, sessionId?: string) => this.query({ type: "kanban.items", projectId, source, page, ...(sessionId ? { sessionId } : {}) }),
    continue: (sessionId: string, issueId?: string, expectedDraftRevision?: number) => this.command({ type: "project.work.start", sessionId,
      ...(issueId ? { issueId } : {}), ...(expectedDraftRevision !== undefined ? { consumeDraft: { expectedRevision: expectedDraftRevision } } : {}) }),
    work: (runId: string) => this.query({ type: "project.work.read", runId }),
    wait: async (runId: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}) => {
      const deadline = Date.now() + (options.timeoutMs ?? 120000);
      for (;;) {
        options.signal?.throwIfAborted();
        const { run } = await this.kanban.work(runId);
        if (run.status !== "preparing") return run;
        if (Date.now() >= deadline) throw new ClientError("project_work_wait", `The original task ${runId} is still preparing. Inspect it; do not start a replacement.`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
    cancel: (runId: string) => this.command({ type: "project.work.cancel", runId }),
    inspect: (runId: string, expectedRevision: number, confirmInspection: true) => this.command({ type: "project.work.inspect", runId, expectedRevision, confirmInspection }),
  };
  readonly approvals = {
    respond: (sessionId: string, approvalId: string, allow: boolean, remember?: RememberApproval) =>
      this.command({ type: "approval.respond", sessionId, approvalId, allow, ...(remember ? { remember } : {}) }),
    list: () => this.getState().snapshot?.settings.values.permissions.remembered ?? [],
    revoke: (id: string, expectedRevision = this.settings.get()?.revision) => {
      const current = this.settings.get();
      if (!current || expectedRevision === undefined) throw new ClientError("settings_missing", "Connect before changing remembered approvals.");
      if (!current.values.permissions.remembered?.some((grant) => grant.id === id)) throw new ClientError("approval_missing", "This remembered approval is no longer present.");
      return this.settings.update({ ...current.values, permissions: { ...current.values.permissions,
        remembered: current.values.permissions.remembered.filter((grant) => grant.id !== id) } }, expectedRevision);
    },
  };
  readonly tools = {
    catalog: (sessionId: string, query = "", offset = 0) => this.query({ type: "tooling.catalog", sessionId, query, offset }),
    execute: (sessionId: string, name: string, args: Record<string, unknown>, schemaDigest: string) => this.command({ type: "tooling.execute", sessionId, name, arguments: args, schemaDigest }),
    result: (sessionId: string, stepId: string, callId: string, offset = 0) => this.query({ type: "tooling.result", sessionId, input: { stepId, callId, offset } }),
    command: (sessionId: string, jobId: string, offset = 0, targetSessionId?: string) => this.query({ type: "tooling.command", sessionId, input: { jobId, offset, ...(targetSessionId ? { targetSessionId } : {}) } }),
    acknowledgeCommand: (sessionId: string, jobId: string, expectedDigest: string, confirmInspection: true) => this.command({ type: "tooling.command.acknowledge", sessionId, jobId, expectedDigest, confirmInspection }),
    state: (sessionId: string, sql: string, parameters?: (string | number | boolean | null)[], limit = 100) => this.query({ type: "tooling.state", sessionId, input: { sql, ...(parameters ? { parameters } : {}), limit } }),
  };
  readonly coordination = {
    preview: (sessionId: string, childId: string) => this.query({ type: "coordination.preview", sessionId, childId }),
    grant: (sessionId: string, childId: string, expectedDigest: string, enabled: boolean, confirm: true) => this.command({ type: "coordination.grant", sessionId, childId, expectedDigest, enabled, confirm }),
    read: (sessionId: string, input: import("../../protocol/src/coordination.ts").SessionContextInput) => this.query({ type: "coordination.read", sessionId, input }),
    message: (sessionId: string, targetSessionId: string, text: string) => this.command({ type: "coordination.message", sessionId, input: { targetSessionId, text } }),
    control: (sessionId: string, input: import("../../protocol/src/coordination.ts").SessionControlInput) => this.command({ type: "coordination.control", sessionId, input }),
  };
  readonly workflows = {
    start: (sessionId: string, kind: import("../../protocol/src/workflows.ts").WorkflowKind, prompt = "", expectedDraftRevision?: number) =>
      this.command({ type: "workflow.start", sessionId, kind, prompt, ...(expectedDraftRevision !== undefined ? { consumeDraft: { expectedRevision: expectedDraftRevision } } : {}) }),
  };
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
    configure: (sessionId: string, controls: Controls, expectedRevision = this.sessionRevision(sessionId), rememberModelSelection?: boolean) => {
      const current = this.getState().snapshot?.sessions.find((session) => session.id === sessionId)?.controls;
      const changed = controls.modelId !== null && Boolean(current && (controls.modelId !== current.modelId ||
        controls.modelOptions?.thinkingEffort !== current.modelOptions?.thinkingEffort));
      return this.command({ type: "session.configure", sessionId, controls, expectedRevision,
        ...((rememberModelSelection ?? changed) ? { rememberModelSelection: true } : {}) });
    },
    autonomy: (sessionId: string, autonomy: Controls["autonomy"], expectedRevision = this.sessionRevision(sessionId)) => {
      const session = this.getState().snapshot?.sessions.find((session) => session.id === sessionId);
      if (!session) throw new ClientError("session_missing", "Choose an existing session before changing autonomy.");
      return this.sessions.configure(sessionId, { ...session.controls, autonomy,
        automaticApprovals: autonomy === "Autopilot" || autonomy === "Autopilot Max" }, expectedRevision);
    },
    selectModel: (sessionId: string, modelId: string | null, expectedRevision = this.sessionRevision(sessionId)) => {
      const session = this.getState().snapshot?.sessions.find((session) => session.id === sessionId);
      if (!session) throw new ClientError("session_missing", "Choose an existing model-selection session.");
      const { modelOptions: _, ...controls } = session.controls;
      return this.sessions.configure(sessionId, { ...controls, modelId }, expectedRevision, true);
    },
    env: (sessionId: string, env: Controls["env"], expectedRevision = this.sessionRevision(sessionId)) => {
      const snapshot = this.getState().snapshot, session = snapshot?.sessions.find((value) => value.id === sessionId);
      if (!snapshot || !session) throw new ClientError("session_missing", "Choose an existing session.");
      const model = snapshot.provider.models.find((value) => value.id === session.controls.modelId);
      const keep = session.controls.modelId === null || Boolean(model && (!model.environments || model.environments.includes(env)));
      const { modelOptions: _, ...controls } = session.controls;
      return this.command({ type: "session.configure", sessionId, expectedRevision, controls: { ...(keep ? session.controls : controls), env, modelId: keep ? session.controls.modelId : null } });
    },
    modelOptions: (sessionId: string, modelOptions: ModelOptions, expectedRevision = this.sessionRevision(sessionId), rememberModelSelection?: boolean) => {
      const session = this.getState().snapshot?.sessions.find((session) => session.id === sessionId);
      if (!session) throw new ClientError("session_missing", "Choose an existing session.");
      return this.sessions.configure(sessionId, { ...session.controls, modelOptions }, expectedRevision,
        session.controls.modelId === null ? false : rememberModelSelection);
    },
    context: (sessionId: string) => this.query({ type: "session.context", sessionId }),
    organize: (sessionId: string, changes: SessionChanges, expectedRevision = this.sessionRevision(sessionId), confirmDetach?: true) =>
      this.command({ type: "session.organize", sessionId, changes, expectedRevision, ...(confirmDetach ? { confirmDetach } : {}) }),
    reorder: (...args: [sessionIds: string[]] | [projectId: string | null, parentSessionId: string | null, groupId: string | null, archived: boolean, sessions: { sessionId: string; revision: number }[]]) => {
      if (args.length === 1) return this.command({ type: "session.reorder", sessions: args[0].map((sessionId) => ({ sessionId, revision: this.sessionRevision(sessionId) })) });
      const [projectId, parentSessionId, groupId, archived, sessions] = args;
      return this.command({ type: "session.reorder", projectId, parentSessionId, groupId, archived, sessions });
    },
    rename: (sessionId: string, title: string, expectedRevision = this.sessionRevision(sessionId)) => this.command({ type: "session.organize", sessionId, changes: { title }, expectedRevision }),
    mode: (sessionId: string, mode: SessionMode, expectedRevision = this.sessionRevision(sessionId)) => this.command({ type: "session.mode", sessionId, expectedRevision, mode }),
    spawn: (sessionId: string, kind: "agent" | "side", title?: string) => this.command({ type: "session.spawn", sessionId, kind, ...(title ? { title } : {}) }),
    delete: (sessionId: string, confirm: true, expectedRevision?: number) => {
      const snapshot = this.getState().snapshot, session = snapshot?.sessions.find((session) => session.id === sessionId);
      const deleted = snapshot?.candidateCleanups.some((cleanup) => cleanup.status === "completed" && cleanup.reason.kind === "session-delete" && cleanup.reason.sessionId === sessionId);
      if (!session && !deleted && expectedRevision === undefined) throw new ClientError("session_missing", "Choose an existing session or its exact retained deletion.");
      return this.command({ type: "session.delete", sessionId, expectedRevision: expectedRevision ?? session?.revision ?? 0, confirm });
    },
    fromWork: (projectId: string, source: { issueId: string } | { prUrl: string }, workspaceId?: string) => this.command({ type: "session.from-work", projectId, ...source, ...(workspaceId ? { workspaceId } : {}) }),
    group: (projectId: string, name: string, order = 0, id?: string, expectedRevision = 0) => this.command({ type: "session.group", projectId, name, order, expectedRevision, ...(id ? { id } : {}) }),
    browser: (sessionId: string, url: string) => this.command({ type: "session.browser", sessionId, url }),
  };
  readonly suggestions = {
    preview: (sessionId: string | null = null, allProjects = sessionId === null) => this.query({ type: "suggestions.preview", sessionId, allProjects }),
    generate: (sessionId: string | null, expectedDigest: string, allProjects: boolean, confirmScope: true) => this.command({ type: "suggestions.generate", sessionId, expectedDigest, allProjects, confirmScope }),
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
    list: (sessionId: string, options: { before?: ActivityCursor; limit?: number; toolName?: string } = {}) => this.query({ type: "activity.list", sessionId, ...options }),
    read: (sessionId: string, activityId: string, part: "arguments" | "output", options: { offset?: number; limit?: number; tail?: boolean; toolName?: string } = {}) =>
      this.query({ type: "activity.read", sessionId, activityId, part, ...options }),
    turn: (sessionId: string, turnId: string) => this.query({ type: "activity.turn", sessionId, turnId }),
    response: (sessionId: string, turnId: string): string => {
      const session = this.getState().snapshot?.sessions.find((value) => value.id === sessionId);
      if (!session || !session.messages.some((message) => message.turnId === turnId)) throw new ClientError("activity_scope", "Choose an original turn in this profile's retained session.");
      return responseText(session.messages, turnId);
    },
  };
  readonly agentTerminals = {
    list: (sessionId: string, options: { before?: ActivityCursor; limit?: number } = {}) => this.activity.list(sessionId, { ...options, toolName: "run_command" }),
    read: (sessionId: string, commandId: string, options: { offset?: number; limit?: number; tail?: boolean } = {}) =>
      this.activity.read(sessionId, commandId, "output", { ...options, toolName: "run_command" }),
  };
  readonly budgets = {
    status: (sessionId: string) => this.query({ type: "budget.status", sessionId }),
    dashboard: (filters: Omit<Extract<BudgetQuery, { type: "budget.dashboard" }>, "type"> = {}) => this.query({ type: "budget.dashboard", ...filters }),
    calls: (filters: Omit<Extract<BudgetQuery, { type: "budget.calls" }>, "type"> = {}) => this.query({ type: "budget.calls", ...filters }),
    plans: (filters: Omit<Extract<BudgetQuery, { type: "budget.plans" }>, "type"> = {}) => this.query({ type: "budget.plans", ...filters }),
    policy: (limit: BudgetLimit | null, expectedRevision: number, confirmRisk: true) => this.command({ type: "budget.policy", limit, expectedRevision, confirmRisk }),
  };
  readonly dashboard = {
    overview: (filters: Omit<DashboardQuery, "type"> = {}) => this.query({ type: "dashboard.overview", ...filters }),
  };
  readonly skills = {
    find: (query = "", options: { sessionId?: string; sourceId?: string; offset?: number; expectedCatalogDigest?: string; signal?: AbortSignal } = {}) => {
      const { signal, ...filters } = options;
      return this.query({ type: "skills.find", query, offset: 0, ...filters }, signal);
    },
    read: (skillId: string, expectedDigest: string, sessionId?: string, signal?: AbortSignal) =>
      this.query({ type: "skills.read", skillId, expectedDigest, ...(sessionId ? { sessionId } : {}) }, signal),
  };
  readonly routing = {
    policy: () => this.settings.get()?.values.kupo ?? null,
    capabilities: (env?: Controls["env"]) => structuredClone((this.getState().snapshot?.routingCapabilities ?? [])
      .filter((profile) => env === undefined || profile.environments.some((value) => value === env))),
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
    eligibility: (sessionId: string) => this.query({ type: "candidate.eligibility", sessionId }),
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
    answerOther: (questionId: string, text: string, expectedRevision: number) => this.command({ type: "question.answer", questionId, text, expectedRevision, other: true }),
    answer: (questionId: string, text: string, expectedRevision: number, consumeDraft?: { sessionId: string; expectedRevision: number }) => this.command({ type: "question.answer", questionId, text, expectedRevision, ...(consumeDraft ? { consumeDraft } : {}) }),
    answerDraft: (questionId: string, expectedRevision: number, other = false) => {
      const question = this.getState().snapshot?.questions.find((question) => question.id === questionId);
      const session = this.getState().snapshot?.sessions.find((session) => session.id === question?.sessionId);
      if (!question || !session) throw new ClientError("question_missing", "Connect and review the actual pending question.");
      return this.command({ type: "question.answer", questionId, text: session.draft.text, expectedRevision, ...(other ? { other: true as const } : {}), consumeDraft: { sessionId: session.id, expectedRevision: session.draft.revision } });
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
    clone: (repository: string, path: string, confirm: true) => this.command({ type: "project.clone", repository, path, confirm }),
    configuration: (projectId: string) => this.query({ type: "project.configuration", projectId }),
    repositories: (projectId: string) => this.query({ type: "project.repositories", projectId }),
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
    open: (sessionId: string, cols = 80, rows = 24, scriptId?: string, root?: string) => this.command({ type: "terminal.open", sessionId, cols, rows, ...(scriptId ? { scriptId } : {}), ...(root ? { root } : {}) }),
    openGlobal: (...args: [cols?: number, rows?: number] | [root: string, cols?: number, rows?: number]) => {
      const [rootOrCols, colsOrRows, rows] = args;
      return typeof rootOrCols === "string" ? this.command({ type: "terminal.open-global", root: rootOrCols, cols: colsOrRows ?? 80, rows: rows ?? 24 }) :
        this.command({ type: "terminal.global.open", cols: rootOrCols ?? 80, rows: colsOrRows ?? 24 });
    },
    defaultRoot: () => this.query({ type: "terminal.default-root" }),
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
  async query<Q extends PlatformQuery>(query: Q, signal?: AbortSignal): Promise<Extract<PlatformResponse, { type: Q["type"] }>> {
    parse(QuerySchema, query);
    const result = await this.request("/v1/query", query, signal);
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
  readonly runtime = {
    status: () => this.query({ type: "runtime.status" }),
    retryPower: () => this.command({ type: "runtime.power.retry" }),
  };
  readonly application = {
    status: () => this.query({ type: "application.status" }),
    configure: (changes: Partial<import("../../protocol/src/application.ts").ApplicationPreferences>, expectedRevision: number) => this.command({ type: "application.configure", changes, expectedRevision }),
    updates: {
      status: () => this.query({ type: "application.update.status" }),
      credential: () => this.query({ type: "application.update.credential" }),
      read: (id: string) => this.query({ type: "application.update.read", id }),
      history: () => this.query({ type: "application.update.history" }),
      check: (automatic = false, commandId?: string) => this.command({ type: "application.update.check", automatic }, commandId),
      cancel: (id: string) => this.command({ type: "application.update.cancel", id }),
      setToken: async (token: string | null): Promise<void> => {
        const value = await this.request("/v1/application", { action: "update-token", token });
        if (!isRecord(value) || value.configured !== (token !== null)) throw new ClientError("update_credential_ack", "The updater's exact separate secret change was not acknowledged.");
      },
      installPreview: (id: string) => this.query({ type: "application.update.install_preview", id }),
      install: async (id: string, expectedDigest: string, desktopPid: number, confirm: true): Promise<{ id: string; journal: string; intentDigest: string }> => {
        const value = await this.request("/v1/application", { action: "update-install", id, expectedDigest, desktopPid, confirm });
        if (!isRecord(value) || value.id !== id || value.accepted !== true || typeof value.journal !== "string" || typeof value.intentDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.intentDigest)) throw new ClientError("update_install_ack", "The exact original installation was not acknowledged. Inspect retained intent; no install or restart was replayed.");
        return { id, journal: value.journal, intentDigest: value.intentDigest };
      },
    },
    storage: {
      status: () => this.query({ type: "application.storage.status" }),
      preview: (path: string) => this.query({ type: "application.storage.preview", path }),
      relocate: async (path: string, expectedDigest: string, confirm: true, id: string = crypto.randomUUID()): Promise<{ id: string; keyId: string }> => {
        const result = await this.request("/v1/application", { action: "storage-relocate", id, path, expectedDigest, confirm });
        if (!isRecord(result) || result.id !== id || result.accepted !== true || typeof result.keyId !== "string") throw new ClientError("storage_acknowledgement", "The original relocation was not acknowledged. Inspect its retained intent; no copy was retried.");
        return { id, keyId: result.keyId };
      },
    },
  };
  readonly notifications = {
    list: () => structuredClone(this.getState().snapshot?.notificationSounds ?? []),
    importSound: (name: string, bytes: Uint8Array, commandId?: string) => this.command({ type: "notification.sound.import", name, audio: audioBase64(bytes) }, commandId),
    sound: (id: string) => this.query({ type: "notification.sound.read", id }),
    removeSound: (id: string, expectedDigest: string, confirm: true) => this.command({ type: "notification.sound.remove", id, expectedDigest, confirm }),
  };
  readonly integrations = {
    githubConnection: () => this.query({ type: "github.connection" }),
    sqlStatus: () => this.query({ type: "integrations.sql.status" }),
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
    startCapture: async (sessionId: string, id: string = crypto.randomUUID()): Promise<{ id: string; token: string }> => {
      if (this.getState().status !== "connected") throw new ClientError("disconnected", "Reconnect the original profile before capturing audio.");
      const request = parse(SpeechCaptureRequestSchema, { action: "start", sessionId, id });
      const result = await this.request("/v1/voice", request);
      if (!isRecord(result) || result.id !== id || typeof result.token !== "string" || !/^[a-f0-9-]{36}$/.test(result.token)) throw new ClientError("speech_capture_response", "The service did not acknowledge the exact original capture. No microphone was started.");
      await this.refresh(); return { id, token: result.token };
    },
    uploadCapture: async (sessionId: string, id: string, token: string, bytes: Uint8Array): Promise<void> => {
      validateSpeechWav(bytes);
      const request = parse(SpeechCaptureRequestSchema, { action: "upload", sessionId, id, token, audio: audioBase64(bytes) });
      const result = await this.request("/v1/voice", request);
      if (!isRecord(result) || result.id !== id || result.accepted !== true) throw new ClientError("speech_capture_response", "The original audio intake was not acknowledged. It was not retried or sent to another recognizer.");
      await this.refresh();
    },
    cancelCapture: async (sessionId: string, id: string, token: string): Promise<void> => {
      const request = parse(SpeechCaptureRequestSchema, { action: "cancel", sessionId, id, token });
      const result = await this.request("/v1/voice", request);
      if (!isRecord(result) || result.id !== id || result.accepted !== true) throw new ClientError("speech_capture_response", "Cancellation was not accepted by the original capture. No different profile or microphone was contacted.");
    },
    status: () => this.query({ type: "voice.status" }),
    download: (acceptLicense: true) => this.command({ type: "voice.download", acceptLicense }),
    record: (sessionId: string) => this.command({ type: "voice.record", sessionId }),
    transcribe: (sessionId: string, path: string) => this.command({ type: "voice.transcribe", sessionId, path }),
    stop: (jobId: string) => this.command({ type: "voice.stop", jobId }),
    transcript: async (sessionId: string, jobId: string): Promise<string> => {
      const job = this.getState().snapshot?.jobs.find((job) => job.id === jobId);
      if (!job || job.sessionId !== sessionId || !["voice.record", "voice.transcribe", "voice.capture"].includes(job.kind) || job.status !== "completed") throw new ClientError("speech_result", "Choose a completed local transcript from this session. No other result was substituted.");
      let text = "", offset: number | null = 0;
      do {
        const page = await this.mcp.readResult(jobId, offset, 32768);
        text += page.text;
        if (text.length > 1024 * 1024 || page.nextOffset !== null && (page.nextOffset !== offset + page.text.length || page.nextOffset <= offset)) throw new ClientError("speech_result", "The local transcript exceeded its bounded result or returned invalid pages. No text was truncated.");
        offset = page.nextOffset;
      } while (offset !== null);
      const result: unknown = JSON.parse(text);
      if (!isRecord(result) || result.source !== "local" || typeof result.text !== "string" || !result.text.trim() || result.text.length > 128 * 1024) throw new ClientError("speech_result", "The retained result is not a complete bounded local transcript.");
      return result.text;
    },
    insert: (sessionId: string, jobId: string, expectedRevision: number) => this.command({ type: "voice.insert", sessionId, jobId, expectedRevision }),
  };
  readonly subagents = { run: (sessionId: string, prompt: string) => this.command({ type: "subagent.run", sessionId, prompt }) };
  readonly sandbox = {
    setup: {
      status: () => this.query({ type: "sandbox.setup.status" }),
      review: (version?: string) => this.query({ type: "sandbox.setup.review", ...(version ? { version } : {}) }),
      check: (automatic = false) => this.command({ type: "sandbox.setup.check", automatic }),
      prepare: (version: string) => this.command({ type: "sandbox.setup.prepare", version, confirm: true }),
      apply: (review: { version: string; digest: string; settingsRevision: number }) => this.command({ type: "sandbox.setup.apply",
        version: review.version, expectedDigest: review.digest, expectedRevision: review.settingsRevision, confirm: true }),
      operation: (operationId: string) => this.query({ type: "sandbox.setup.operation", operationId }),
      cancel: (operationId: string) => this.command({ type: "sandbox.setup.cancel", operationId }),
      wait: async (operationId: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Extract<PlatformResponse, { type: "sandbox.setup.operation" }>> => {
        const deadline = Date.now() + (options.timeoutMs ?? 10 * 60_000);
        while (true) {
          options.signal?.throwIfAborted();
          const result = await this.sandbox.setup.operation(operationId);
          if (["completed", "available", "review", "failed", "partial", "cancelled"].includes(result.operation.status)) return result;
          if (Date.now() >= deadline) throw new ClientError("sandbox_setup_timeout", "The exact native setup is still active. Inspect its original operation; no installation or model was retried.");
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      },
    },
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
      config: { columns: config.columns, mergedColumnId: config.mergedColumnId, autoRefreshPrs: config.autoRefreshPrs, githubAccess: config.githubAccess, linear: config.linear,
        ...(config.kanban ? { kanban: config.kanban } : {}), ...(config.githubSync ? { githubSync: config.githubSync } : {}) }, expectedRevision }),
    create: (projectId: string, fields: IssueInput) => this.command({ type: "issue.create", projectId, ...fields }),
    update: (issueId: string, fields: IssueInput, expectedRevision: number) => this.command({ type: "issue.update", issueId, ...fields, expectedRevision }),
    move: (issueId: string, phaseId: string, expectedRevision: number) => this.command({ type: "issue.move", issueId, phaseId, expectedRevision }),
    reorder: (issueId: string, phaseId: string, beforeIssueId: string | null, expectedOrder: import("../../protocol/src/workspace.ts").IssuePosition[], expectedRevision: number) =>
      this.command({ type: "issue.reorder", issueId, phaseId, beforeIssueId, expectedOrder, expectedRevision }),
    archive: (issueId: string, archived: boolean, expectedRevision: number) => this.command({ type: "issue.archive", issueId, archived, expectedRevision }),
    refresh: (projectId: string) => this.command({ type: "issues.refresh", projectId }),
  };
  readonly cache = createCacheApi(this);
  readonly linear = {
    ...createLinearWorkflowApi(this),
    connection: (verify = false) => this.query({ type: "linear.connection", verify }),
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
