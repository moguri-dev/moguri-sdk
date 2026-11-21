import { MoguriClient as TransportClient, ClientError } from "../../client/src/index.ts";
import { filterInboxAttention, interruptedSessions, isRecord, QuerySchema, parse, retryFailure, selectModelControls, skillListGroups, TerminalInputSchema, type AttentionFilters, type PlatformQuery, type PlatformResponse, type SettingsSection, type UserSettings, type CapabilityJob, type BoardConfig, type IssueInput, type SessionChanges, type SessionMode, type ProjectSettings, type TerminalInput, type Controls, type ModelOptions, type ConfigurationSpec, type ControlDefaults, type ArtifactKind, type ArtifactChanges, type ProjectArtifactChoice, type VoiceModelInspection } from "../../protocol/src/index.ts";
import { audioBase64, SpeechCaptureRequestSchema, validateSpeechWav } from "../../protocol/src/audio.ts";
import type { DashboardQuery, BudgetLimit, BudgetQuery, KupoSettings, Profile, CompactionPreview, TelemetryQuery, Session, Snapshot, Project, SessionHomeRoot, CandidatePatch, CandidateRead, CandidateGenerationInput, CandidateGenerationResponse, CandidateRoleReference, CompoundInput, CompoundLineageInput, WinddownQuery, ModelCatalogue } from "../../protocol/src/index.ts";
import type { Attachment, AttachmentAccess, AutomationDefinition, DocumentReadOptions, DocumentSearchOptions, DocumentListOptions, HostedProviderId } from "../../protocol/src/index.ts";
import { kupoProfileDraft, lineageDraft } from "./compound.ts";
import { executeSlash, type SlashResult } from "./slash.ts";
import { runInTerminal } from "./terminal-run.ts";
import { createCommandsApi } from "./commands.ts";
import { responseText, type ActivityCursor } from "../../protocol/src/activity.ts";
import type { KnowledgeInput, KnowledgePromotion, KnowledgeQuery } from "../../protocol/src/knowledge.ts";
import type { HookDefinition, MarketplaceInput, MarketplaceSource } from "../../protocol/src/extensions.ts";
import { createCacheApi } from "./cache.ts";
import { createGithubApi } from "./github.ts";
import { createMyWorkApi } from "./my-work.ts";
import { createGitApi } from "./git.ts";
import { createLinearWorkflowApi } from "./linear.ts";
import type { BrowserHostOwner, BrowserResult } from "../../protocol/src/browser.ts";
import type { RememberApproval } from "../../protocol/src/permissions.ts";
import { canonicalWebSite, effectiveWebAllowances, type WebScope } from "../../protocol/src/web-policy.ts";
import type { KanbanSource } from "../../protocol/src/kanban.ts";
import { PRICE_PROVIDERS, type PriceProvider } from "../../protocol/src/pricing.ts";
import type { CandidateWorkspace } from "../../protocol/src/candidate-workspaces.ts";
import type { OtlpInput, OtlpReview } from "../../protocol/src/telemetry-export.ts";
export * from "../../protocol/src/candidate-workspaces.ts";

export * from "../../protocol/src/index.ts";
export * from "./brand.ts";
export * from "./conversation.ts";
export * from "./session-summary.ts";
export * from "./session-ids.ts";
export * from "./slash.ts";
export { parseShellCommand } from "./terminal-run.ts";
export * from "./slash-catalog.ts";
export { executeOtlpCommand } from "./telemetry-export.ts";
export { executeStainlessCommand, type StainlessCommandOutput } from "./stainless.ts";
export { automationsSummary, executeAutomationsCommand } from "./automations.ts";
export { executeInterruptedCommand, interruptedSummary } from "./interrupted.ts";
export type { CommandViewContext, CommandViewHandler, CommandViewOutcome, CommandClientAttachment, CommandClientOptions } from "./commands.ts";
export { ClientError };
export { DraftEditor, pendingInputStatus } from "../../client/src/draft.ts";
export type { DraftDictation, DraftPendingInput } from "../../client/src/draft.ts";
export type { ClientState, ClientRequestTiming } from "../../client/src/index.ts";
export const sessionTitle = (session: Session, limit = 64, fallback = "New session"): string =>
  session.titleSource === "factory" ? fallback.slice(0, limit) : session.title;
export function sessionRepositoryProposal(session: Session | null | undefined, snapshot: Pick<Snapshot, "projects" | "settings"> | null | undefined):
  { root: SessionHomeRoot; project: Project | null; confirm: boolean } | null {
  const proposal = session?.repositoryProposal;
  if (!snapshot || proposal?.status !== "pending") return null;
  return { root: proposal.root, project: snapshot.projects.find((project) => project.path === proposal.root.root) ?? null,
    confirm: snapshot.settings.values.interactions.confirmRepositoryImport !== false };
}
export const attachmentStatus = (attachment: Attachment): string => attachment.kind !== "document" ? attachment.kind :
  `${attachment.format.toUpperCase()} / ${attachment.summary.status} / ${attachment.format === "pdf" ? `${attachment.summary.pages} pages` : attachment.format === "xlsx" ? `${attachment.summary.sheets.length} sheets, ${attachment.summary.cells} cells` : `${attachment.summary.sections} sections, ${attachment.summary.tables} tables`}`;

export class MoguriSdk extends TransportClient {
  readonly chatOutputs = {
    renderHtml: async (sessionId: string, title: string, html: string) => {
      const tool = (await this.tools.catalog(sessionId, "render_html")).tools.find((tool) => tool.name === "render_html");
      if (!tool) throw new ClientError("html_unavailable", "Interactive output is unavailable in this original session/Env. No host fallback.");
      return this.tools.execute(sessionId, tool.name, { title, html }, tool.schemaDigest);
    },
  };
  readonly apps = {
    run: async (sessionId: string, input: import("../../protocol/src/playwright-tools.ts").PlaywrightToolInput) => {
      const tool = (await this.tools.catalog(sessionId, "playwright")).tools.find((tool) => tool.name === "playwright");
      if (!tool) throw new ClientError("playwright_unavailable", "Owned app execution is unavailable in this session/Env/policy. No personal app or host fallback.");
      return this.tools.execute(sessionId, tool.name, input, tool.schemaDigest);
    },
  };
  readonly scheduledPrompts = {
    list: (sessionId?: string) => (this.getState().snapshot?.scheduledPrompts ?? []).filter((prompt) => sessionId === undefined || prompt.sessionId === sessionId),
    create: (sessionId: string, timing: import("../../protocol/src/scheduled-prompts.ts").ScheduledTiming, expectedRevision = this.draftRevision(sessionId)) =>
      this.command({ type: "prompt.schedule", sessionId, expectedRevision, timing }),
    sendNow: (id: string, expectedRevision?: number) => {
      const prompt = this.scheduledPrompt(id);
      return this.command({ type: "prompt.send_now", sessionId: prompt.sessionId, scheduledPromptId: id, expectedRevision: expectedRevision ?? prompt.revision });
    },
    cancel: (id: string, expectedRevision?: number) => {
      const prompt = this.scheduledPrompt(id);
      return this.command({ type: "prompt.cancel", sessionId: prompt.sessionId, scheduledPromptId: id, expectedRevision: expectedRevision ?? prompt.revision });
    },
  };
  private scheduledPrompt(id: string) {
    const prompt = this.getState().snapshot?.scheduledPrompts.find((prompt) => prompt.id === id);
    if (!prompt) throw new ClientError("schedule_missing", "Choose an original scheduled prompt in this connected profile.");
    return prompt;
  }
  /**
   * Recurring schedules and declarative workflows (protocol 115). Each run starts a new chat in the automation's project, or,
   * when `projectId` is null (protocol 117, D58), an ordinary project-free chat. `list(null)` lists only project-free automations.
   */
  readonly automations = {
    list: (projectId?: string | null) => (this.getState().snapshot?.automations ?? []).filter((automation) => projectId === undefined || automation.projectId === projectId),
    runs: (automationId?: string) => (this.getState().snapshot?.automationRuns ?? []).filter((run) => automationId === undefined || run.automationId === automationId),
    create: (projectId: string | null, definition: AutomationDefinition, options: { enabled: boolean; controls?: ControlDefaults }) =>
      this.command({ type: "automation.create", projectId, definition, enabled: options.enabled, ...(options.controls ? { controls: options.controls } : {}) }),
    update: (id: string, definition: AutomationDefinition, controls?: ControlDefaults, expectedRevision = this.automationRecord(id).revision) =>
      this.command({ type: "automation.update", automationId: id, expectedRevision, definition, ...(controls ? { controls } : {}) }),
    enable: (id: string, expectedRevision = this.automationRecord(id).revision) => this.command({ type: "automation.enable", automationId: id, expectedRevision }),
    pause: (id: string, expectedRevision = this.automationRecord(id).revision) => this.command({ type: "automation.pause", automationId: id, expectedRevision }),
    delete: (id: string, options: { stopRunning?: boolean; expectedRevision?: number } = {}) => this.command({ type: "automation.delete", automationId: id,
      expectedRevision: options.expectedRevision ?? this.automationRecord(id).revision, ...(options.stopRunning ? { stopRunning: true as const } : {}) }),
    runNow: (id: string, expectedRevision = this.automationRecord(id).revision) => this.command({ type: "automation.run_now", automationId: id, expectedRevision }),
    stopRun: (runId: string) => this.command({ type: "automation.stop_run", runId }),
  };
  private automationRecord(id: string) {
    const automation = this.getState().snapshot?.automations.find((automation) => automation.id === id);
    if (!automation) throw new ClientError("automation_missing", "Choose an automation in this connected profile.");
    return automation;
  }
  readonly scriptReviews = {
    read: (sessionId: string, reviewId: string) => this.query({ type: "script.review.read", sessionId, reviewId }),
    approve: (sessionId: string, reviewId: string, expectedDigest: string, expectedRevision: number,
      expectedSessionRevision = this.sessionRevision(sessionId), commandId: string = crypto.randomUUID()) =>
      this.command({ type: "script.review.approve", sessionId, reviewId, expectedDigest, expectedRevision, expectedSessionRevision }, commandId),
    force: (sessionId: string, reviewId: string, expectedDigest: string, expectedRevision: number,
      expectedSessionRevision = this.sessionRevision(sessionId), commandId: string = crypto.randomUUID()) =>
      this.command({ type: "script.review.force", sessionId, reviewId, expectedDigest, expectedRevision, expectedSessionRevision, confirmUnsafe: true }, commandId),
  };
  readonly repositoryTrust = {
    get: (projectId: string) => this.getState().snapshot?.repositoryTrusts.find((trust) => trust.projectId === projectId),
    preview: (projectId: string) => this.query({ type: "repository.trust.preview", projectId }),
    trust: (preview: import("../../protocol/src/repository-trust.ts").RepositoryTrustPreview) => {
      if (preview.profileId !== this.profileId) throw new ClientError("repository_trust_profile", "Review repository trust in its exact connected profile. No cross-profile decision was sent.");
      return this.command({ type: "repository.trust.approve", projectId: preview.projectId, expectedRevision: preview.expectedRevision,
        baselineDigest: preview.baselineDigest, confirmExistingScripts: true });
    },
    revoke: (projectId: string, expectedRevision: number) => this.command({ type: "repository.trust.revoke", projectId, expectedRevision }),
  };
  readonly commands = createCommandsApi(this, async (command, connection) => {
    if (this.connection !== connection) throw new ClientError("command_connection_changed", "The original command connection changed. Its UI action was not acknowledged through a replacement service.");
    const result = await this.request("/v1/commands", { id: crypto.randomUUID(), profileId: this.profileId, command });
    if (!isRecord(result) || typeof result.id !== "string" || command.type === "slash.client.complete" && typeof result.revision !== "number") {
      throw new ClientError("command_response", "The original client acknowledgement did not return a valid exact response.");
    }
    return { id: result.id, ...(typeof result.revision === "number" ? { revision: result.revision } : {}) };
  });
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
  /** Optional Stainless browser: detection, an owned headless compatibility check and "Open in Stainless" for Local previews. */
  readonly stainless = {
    status: async () => (await this.query({ type: "stainless.status" })).stainless,
    check: async () => { await this.command({ type: "stainless.check" }); return this.stainless.status(); },
    open: (sessionId: string, url: string) => this.command({ type: "stainless.open", sessionId, url }),
  };
  readonly github = createGithubApi(this);
  readonly myWork = createMyWorkApi(this);
  readonly git = createGitApi(this);
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
      if (!("expectedRevision" in review) || review.profileId !== this.profileId) throw new ClientError("continue_work_stale", "Use the exact original draft review, or the owning queued client claim. No prompt or task was dispatched.");
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
  readonly webAllowlist = {
    list: (sessionId?: string) => {
      const snapshot = this.getState().snapshot, entries = snapshot?.settings.values.permissions.webAllowlist ?? [];
      if (!sessionId) return entries;
      const session = snapshot?.sessions.find((entry) => entry.id === sessionId);
      if (!session) throw new ClientError("session_missing", "Choose an existing session in this profile.");
      return effectiveWebAllowances(entries, { sessionId, projectId: session.projectId, env: session.controls.env });
    },
    add: (site: string, scope: WebScope, expectedRevision = this.settings.get()?.revision) => {
      const current = this.settings.get(), snapshot = this.getState().snapshot;
      if (!current || !snapshot || expectedRevision === undefined) throw new ClientError("settings_missing", "Connect this profile before changing its Local website allowlist.");
      if (scope.kind === "session" && !snapshot.sessions.some((session) => session.id === scope.sessionId) ||
        scope.kind === "project" && !snapshot.projects.some((project) => project.id === scope.projectId)) throw new ClientError("web_allowlist_scope", "Choose an original session or project in this profile.");
      const entry = { id: crypto.randomUUID(), site: canonicalWebSite(site), scope };
      return this.settings.update({ ...current.values, permissions: { ...current.values.permissions,
        webAllowlist: [...(current.values.permissions.webAllowlist ?? []), entry] } }, expectedRevision);
    },
    remove: (id: string, expectedRevision = this.settings.get()?.revision) => {
      const current = this.settings.get();
      if (!current || expectedRevision === undefined) throw new ClientError("settings_missing", "Connect before removing a website allowance.");
      if (!current.values.permissions.webAllowlist?.some((entry) => entry.id === id)) throw new ClientError("web_allowlist_missing", "This website allowance is no longer present.");
      return this.settings.update({ ...current.values, permissions: { ...current.values.permissions,
        webAllowlist: current.values.permissions.webAllowlist.filter((entry) => entry.id !== id) } }, expectedRevision);
    },
  };
  readonly tools = {
    history: (sessionId: string, input: import("../../protocol/src/tooling.ts").HistoryReadInput = {}) => this.query({ type: "tooling.history", sessionId, input }),
    catalog: async (sessionId: string, query = "", offset = 0) => { await this.prepareHome(sessionId); return this.query({ type: "tooling.catalog", sessionId, query, offset }); },
    execute: (sessionId: string, name: string, args: Record<string, unknown>, schemaDigest: string) => this.command({ type: "tooling.execute", sessionId, name, arguments: args, schemaDigest }),
    result: (sessionId: string, stepId: string, callId: string, offset = 0) => this.query({ type: "tooling.result", sessionId, input: { stepId, callId, offset } }),
    results: (sessionId: string, options: { before?: { sequence: number; id: string }; limit?: number } = {}) => this.query({ type: "tooling.results", sessionId, ...options }),
    resultById: (sessionId: string, operationId: string, options: { offset?: number; expectedDigest?: string; expectedRevision?: number } = {}) =>
      this.query({ type: "tooling.result", sessionId, input: { operationId, ...options } }),
    command: (sessionId: string, jobId: string, offset = 0, targetSessionId?: string) => this.query({ type: "tooling.command", sessionId, input: { jobId, offset, ...(targetSessionId ? { targetSessionId } : {}) } }),
    acknowledgeCommand: (sessionId: string, jobId: string, expectedDigest: string, confirmInspection: true) => this.command({ type: "tooling.command.acknowledge", sessionId, jobId, expectedDigest, confirmInspection }),
    state: (sessionId: string, sql: string, parameters?: (string | number | boolean | null)[], limit = 100) => this.query({ type: "tooling.state", sessionId, input: { sql, ...(parameters ? { parameters } : {}), limit } }),
    /** The profile's built-in tools grouped into toolsets, plus the foundational scripts. Listing grants nothing to any chat. */
    toolsets: async () => (await this.query({ type: "tooling.toolsets" })).catalog,
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
  /** Fix broken CI and automatic conflict resolution (protocol 113). Flags are ordinary settings and repository overrides. */
  readonly prAutomation = {
    /** The session's CI retries and conflict resolutions, oldest first. */
    records: (sessionId: string) => (this.getState().snapshot?.prAutomation ?? []).filter((record) => record.sessionId === sessionId),
    /** Stops further automatic reruns of one check. A rerun GitHub already started keeps running. */
    cancel: (recordId: string, expectedRevision?: number) => {
      const record = this.getState().snapshot?.prAutomation?.find((value) => value.id === recordId);
      if (!record && expectedRevision === undefined) throw new ClientError("pr_automation_missing", "Choose an existing CI retry. Nothing was cancelled.");
      return this.command({ type: "pr_automation.cancel", recordId, expectedRevision: expectedRevision ?? record!.revision });
    },
  };
  private async prepareHome(id: string): Promise<void> {
    const session = this.getState().snapshot?.sessions.find((session) => session.id === id);
    if (session && session.projectId === null && !session.repositories && !session.readOnly && ["agent", "side"].includes(session.kind) &&
      session.controls.env === "Local" && !session.homeRoot) await this.sessions.home(id, session.revision);
  }
  private sessionRevision(id: string): number {
    const session = this.getState().snapshot?.sessions.find((session) => session.id === id);
    if (!session) throw new ClientError("session_missing", "Connect and choose an existing session.");
    return session.revision;
  }
  private workspaceFolder(id: string) {
    const folder = this.getState().snapshot?.workspaceFolders.find((folder) => folder.id === id);
    if (!folder) throw new ClientError("workspace_folder_missing", "Connect and choose a workspace folder you added.");
    return folder;
  }
  private settingsRevision(): number {
    const snapshot = this.getState().snapshot;
    if (!snapshot) throw new ClientError("profile_missing", "Connect this profile before changing model availability.");
    return snapshot.settings.revision;
  }
  private async stageQueued(sessionId: string, queueItemId: string, command: Parameters<TransportClient["command"]>[0]): Promise<{ id: string; attachment: Attachment }> {
    const result = await this.command(command), { attachments } = await this.query({ type: "attachment.staged", sessionId, queueItemId });
    const attachment = attachments.find((value) => value.id === result.id);
    if (!result.id || !attachment) throw new ClientError("attachment_staging", "The capture wasn't staged for this queued prompt. Attach it again; nothing was saved.");
    return { id: result.id, attachment };
  }
  private queueRevision(id: string): number {
    const session = this.getState().snapshot?.sessions.find((session) => session.id === id);
    if (!session) throw new ClientError("session_missing", "Choose an existing session.");
    return session.queueRevision;
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
    /** Captures for one queued prompt's edit: each returns the staged `attachment`, saved only by `prompts.edit`. */
    queued: {
      file: (sessionId: string, queueItemId: string, path: string, mode: "text" | "image" | "document" | "auto" = "auto") =>
        this.stageQueued(sessionId, queueItemId, { type: "attachment.file.add", sessionId, queueItemId, path, mode, expectedRevision: this.queueRevision(sessionId) }),
      document: (sessionId: string, queueItemId: string, path: string, captureId: string = crypto.randomUUID()) =>
        this.stageQueued(sessionId, queueItemId, { type: "attachment.file.add", sessionId, queueItemId, path, mode: "document", captureId, expectedRevision: this.queueRevision(sessionId) }),
      image: (sessionId: string, queueItemId: string, data: string, name = "Clipboard image") =>
        this.stageQueued(sessionId, queueItemId, { type: "attachment.image.add", sessionId, queueItemId, data, name, expectedRevision: this.queueRevision(sessionId) }),
      folder: (sessionId: string, queueItemId: string, path: string, expectedDigest: string, confirm: true) =>
        this.stageQueued(sessionId, queueItemId, { type: "attachment.folder.add", sessionId, queueItemId, path, expectedDigest, confirm, expectedRevision: this.queueRevision(sessionId) }),
      github: (sessionId: string, queueItemId: string, url: string, access: AttachmentAccess, expectedDigest: string, confirm: true) =>
        this.stageQueued(sessionId, queueItemId, { type: "attachment.github.add", sessionId, queueItemId, url, access, expectedDigest, confirm, expectedRevision: this.queueRevision(sessionId) }),
      session: (sessionId: string, queueItemId: string, sourceSessionId: string, expectedDigest: string, confirm: true) =>
        this.stageQueued(sessionId, queueItemId, { type: "attachment.session.add", sessionId, queueItemId, sourceSessionId, expectedDigest, confirm, expectedRevision: this.queueRevision(sessionId) }),
      list: (sessionId: string, queueItemId: string) => this.query({ type: "attachment.staged", sessionId, queueItemId }),
    },
  };
  readonly sessions = {
    get: (id: string) => this.getState().snapshot?.sessions.find((session) => session.id === id),
    waitPreview: (sessionId: string, targetSessionId: string) => this.query({ type: "session.wait.preview", sessionId, targetSessionId }),
    waitFor: (preview: import("../../protocol/src/session-controls.ts").SessionWaitPreview, confirm: true) =>
      this.command({ type: "session.wait", sessionId: preview.sessionId, targetSessionId: preview.targetSessionId, expectedDigest: preview.digest, confirm }),
    cancelWait: (sessionId: string, waitId?: string, expectedRevision?: number) => {
      const wait = this.getState().snapshot?.sessions.find((session) => session.id === sessionId)?.wait;
      if (!wait && (!waitId || expectedRevision === undefined)) throw new ClientError("session_wait_missing", "Choose the actual retained dependency; no newer wait was guessed.");
      return this.command({ type: "session.wait.cancel", sessionId, waitId: waitId ?? wait!.id, expectedRevision: expectedRevision ?? wait!.revision });
    },
    bulkPreview: (input: import("../../protocol/src/session-controls.ts").BulkSessionInput) => this.query({ type: "sessions.bulk.preview", input }),
    /** Read-only check of a linked PR's reviews, merge state and CI that decides which Code Change follow-up actions apply. Nothing is retained. */
    prStatus: (sessionId: string, url: string) => this.query({ type: "session.pr_status", sessionId, url }),
    bulk: (preview: import("../../protocol/src/session-controls.ts").BulkSessionPreview, confirm: true, options: { confirmRunning?: true } = {}) =>
      this.command({ type: "sessions.bulk", input: preview.input, expectedDigest: preview.digest, confirm, ...(options.confirmRunning ? { confirmRunning: true as const } : {}) }),
    associatePr: (sessionId: string, source: import("../../protocol/src/github-workflows.ts").GithubSessionSource, expectedRevision = this.sessionRevision(sessionId)) =>
      this.command({ type: "session.pr.associate", sessionId, source, expectedRevision }),
    kupoMode: (sessionId: string, kupoMode: import("../../protocol/src/kupo-modes.ts").KupoMode, expectedRevision = this.sessionRevision(sessionId)) => {
      const session = this.getState().snapshot?.sessions.find((session) => session.id === sessionId);
      if (!session || session.controls.modelId !== "kupo" || this.settings.get()?.values.kupo.workflow !== "auto") throw new ClientError("routing_mode", "Choose automatic Kupo in this actual session before selecting its mode. Fixed-model effort and legacy policies are unchanged.");
      return this.sessions.configure(sessionId, { ...session.controls, kupoMode }, expectedRevision, true);
    },
    retry: (sessionId: string, failureId?: string, expectedRevision?: number) => {
      const snapshot = this.getState().snapshot, session = snapshot?.sessions.find((session) => session.id === sessionId);
      const failure = failureId ? snapshot?.modelFailures.find((failure) => failure.id === failureId && failure.sessionId === sessionId) :
        session && snapshot ? retryFailure(session, snapshot.modelFailures) : undefined;
      if (!failure) throw new ClientError("model_retry_missing", "This chat has no eligible original model failure. No prompt, tool or model request was replayed.");
      return this.command({ type: "session.retry", sessionId, failureId: failure.id, expectedRevision: expectedRevision ?? failure.revision });
    },
    /** Chats a quit, restart or crash interrupted (protocol 115). */
    interrupted: () => interruptedSessions(this.getState().snapshot?.sessions ?? []),
    /** Release the chat's waiting prompts and, when a turn was running, queue the continue workflow ahead of them. */
    continueInterrupted: (sessionId: string) => this.command({ type: "session.continue", sessionId }),
    /** Continue every interrupted chat; one chat's failure doesn't stop the others. */
    continueAllInterrupted: async () => {
      const results: { sessionId: string; error: string | null }[] = [];
      for (const session of interruptedSessions(this.getState().snapshot?.sessions ?? [])) {
        try { await this.command({ type: "session.continue", sessionId: session.id }); results.push({ sessionId: session.id, error: null }); }
        catch (error) { results.push({ sessionId: session.id, error: error instanceof Error ? error.message : "The chat could not be continued." }); }
      }
      return results;
    },
    dismissInterruption: (sessionId: string) => this.command({ type: "session.interruption.dismiss", sessionId }),
    progress: (sessionId: string) => this.query({ type: "session.progress", sessionId }),
    create: (projectId: string | null = null, title?: string, overrides?: ControlDefaults, workspaceId?: string, workspaceMode?: ProjectSettings["repo"]["workspaceMode"]) =>
      this.command({ type: "session.create", projectId, ...(title !== undefined ? { title } : {}), ...(overrides ? { overrides } : {}), ...(workspaceId ? { workspaceId } : {}), ...(workspaceMode ? { workspaceMode } : {}) }),
    titles: (sessionId: string) => { this.sessionRevision(sessionId); return (this.getState().snapshot?.chatTitles ?? []).filter((title) => title.sessionId === sessionId); },
    home: (sessionId: string, expectedRevision = this.sessionRevision(sessionId)) => this.command({ type: "session.home", sessionId, expectedRevision }),
    bindProject: (sessionId: string, projectId: string, expectedRevision = this.sessionRevision(sessionId)) =>
      this.command({ type: "session.project.bind", sessionId, projectId, expectedRevision }),
    importRepository: (sessionId: string, path: string, confirm: true, expectedRevision = this.sessionRevision(sessionId)) =>
      this.command({ type: "session.repository.import", sessionId, expectedRevision, path, confirm }),
    dismissRepository: (sessionId: string, expectedRevision = this.sessionRevision(sessionId)) =>
      this.command({ type: "session.repository.dismiss", sessionId, expectedRevision }),
    side: (sessionId: string) => this.command({ type: "session.side", sessionId }),
    askSide: (sessionId: string, prompt: string, expectedDraftRevision?: number) => this.command({ type: "session.side.prompt", sessionId, prompt,
      ...(expectedDraftRevision === undefined ? {} : { expectedDraftRevision }) }),
    createFolder: (projectFolderId: string, title?: string, overrides?: ControlDefaults) => {
      const snapshot = this.getState().snapshot;
      if (!snapshot?.projectFolders.some((folder) => folder.id === projectFolderId)) throw new ClientError("project_folder", "Choose an existing folder in this profile.");
      const folderProjects = snapshot.projectConfigurations.filter((configuration) => configuration.folderId === projectFolderId)
        .sort((a, b) => a.order - b.order).map((configuration) => ({ projectId: configuration.projectId, revision: configuration.revision }));
      return this.command({ type: "session.create", projectFolderId, folderProjects, ...(title !== undefined ? { title } : {}), ...(overrides ? { overrides } : {}) });
    },
    configure: (sessionId: string, controls: Controls, expectedRevision = this.sessionRevision(sessionId), rememberModelSelection?: boolean) => {
      const current = this.getState().snapshot?.sessions.find((session) => session.id === sessionId)?.controls;
      const changed = controls.modelId !== null && Boolean(current && (controls.modelId !== current.modelId ||
        controls.modelOptions?.thinkingEffort !== current.modelOptions?.thinkingEffort));
      return this.command({ type: "session.configure", sessionId, controls, expectedRevision,
        ...((rememberModelSelection ?? changed) ? { rememberModelSelection: true } : {}) });
    },
    autonomy: (sessionId: string, autonomy: Controls["autonomy"], expectedRevision = this.sessionRevision(sessionId)) => {
      return this.command({ type: "session.autonomy", sessionId, autonomy, expectedRevision });
    },
    yolo: (sessionId: string, expectedRevision = this.sessionRevision(sessionId)) => this.command({ type: "session.yolo", sessionId, expectedRevision }),
    selectModel: async (sessionId: string, modelId: string | null, expectedRevision = this.sessionRevision(sessionId)) => {
      const snapshot = this.getState().snapshot, session = snapshot?.sessions.find((session) => session.id === sessionId);
      if (!session) throw new ClientError("session_missing", "Choose an existing model-selection session.");
      const model = modelId === null ? null : snapshot?.provider.models.find((model) => model.id === modelId);
      if (modelId !== null && !model) throw new ClientError("model_unavailable", "Explicitly choose an available model. No other model or provider was substituted.");
      return this.sessions.configure(sessionId, selectModelControls(session.controls, model ?? null), expectedRevision, true);
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
      const { preferredThinkingEffort: _, ...controls } = session.controls;
      const keepPreference = rememberModelSelection !== true && modelOptions.thinkingEffort === session.controls.modelOptions?.thinkingEffort;
      return this.sessions.configure(sessionId, { ...(keepPreference ? session.controls : controls), modelOptions }, expectedRevision,
        session.controls.modelId === null ? false : rememberModelSelection);
    },
    context: (sessionId: string) => this.query({ type: "session.context", sessionId }),
    organize: (sessionId: string, changes: SessionChanges, expectedRevision = this.sessionRevision(sessionId), confirmDetach?: true) =>
      this.command({ type: "session.organize", sessionId, changes, expectedRevision, ...(confirmDetach ? { confirmDetach } : {}) }),
    reorder: (...args: [sessionIds: string[]] | [projectId: string | null, parentSessionId: string | null, groupId: string | null, archived: boolean, sessions: { sessionId: string; revision: number }[]]) => {
      if (args.length === 1) return this.command({ type: "session.reorder", sessions: args[0].map((sessionId) => ({ sessionId, revision: this.sessionRevision(sessionId) })) });
      const [projectId, parentSessionId, groupId, archived, sessions] = args;
      const projectFolderId = projectId === null && parentSessionId === null ? this.getState().snapshot?.sessions.find((session) => session.id === sessions[0]?.sessionId)?.projectFolderId : undefined;
      return this.command({ type: "session.reorder", projectId, parentSessionId, groupId, archived, sessions, ...(projectFolderId ? { projectFolderId } : {}) });
    },
    rename: (sessionId: string, title: string, expectedRevision = this.sessionRevision(sessionId)) => this.command({ type: "session.organize", sessionId, changes: { title }, expectedRevision }),
    mode: (sessionId: string, mode: SessionMode, expectedRevision = this.sessionRevision(sessionId)) => this.command({ type: "session.mode", sessionId, expectedRevision, mode }),
    spawn: (sessionId: string, kind: "agent" | "side", title?: string) => this.command({ type: "session.spawn", sessionId, kind, ...(title ? { title } : {}) }),
    spawnPrompt: (sessionId: string, prompt: string, expectedDraftRevision?: number) => this.command({ type: "session.spawn.prompt", sessionId, prompt,
      ...(expectedDraftRevision === undefined ? {} : { expectedDraftRevision }) }),
    /** `confirmRunning` records that the user saw a warning that this stops running work; without it the service refuses a running tree. */
    delete: (sessionId: string, confirm: true, expectedRevision?: number, children?: import("../../protocol/src/index.ts").SessionChildrenReview, options: { confirmRunning?: true } = {}) => {
      const snapshot = this.getState().snapshot, session = snapshot?.sessions.find((session) => session.id === sessionId);
      const deleted = snapshot?.candidateCleanups.some((cleanup) => cleanup.status === "completed" && cleanup.reason.kind === "session-delete" && cleanup.reason.sessionId === sessionId);
      if (!session && !deleted && expectedRevision === undefined) throw new ClientError("session_missing", "Choose an existing session or its exact retained deletion.");
      return this.command({ type: "session.delete", sessionId, expectedRevision: expectedRevision ?? session?.revision ?? 0, confirm, ...(children ? { children } : {}),
        ...(options.confirmRunning ? { confirmRunning: true as const } : {}) });
    },
    fromWork: (projectId: string, source: { issueId: string } | { prUrl: string }, workspaceId?: string) => this.command({ type: "session.from-work", projectId, ...source, ...(workspaceId ? { workspaceId } : {}) }),
    group: (projectId: string, name: string, order = 0, id?: string, expectedRevision = 0) => this.command({ type: "session.group", projectId, name, order, expectedRevision, ...(id ? { id } : {}) }),
    browser: (sessionId: string, url: string) => this.command({ type: "session.browser", sessionId, url }),
    /** Records the user's Agent control choice for this chat (D61). On stays on until the user turns it off; the desktop Browser pane applies it with a fresh control identity. */
    browserControl: (sessionId: string, enabled: boolean) => this.command({ type: "session.browser.control", sessionId, enabled }),
  };
  readonly suggestions = {
    preview: (sessionId: string | null = null, allProjects = sessionId === null) => this.query({ type: "suggestions.preview", sessionId, allProjects }),
    generate: (sessionId: string | null, expectedDigest: string, allProjects: boolean, confirmScope: true) => this.command({ type: "suggestions.generate", sessionId, expectedDigest, allProjects, confirmScope }),
  };
  readonly models = {
    readinessTarget: (sessionId: string, modelId: string, signal?: AbortSignal) =>
      this.query({ type: "model.readiness.target", sessionId, modelId }, signal),
    readiness: (sessionId: string, modelId: string, mode: import("../../protocol/src/model-readiness.ts").ModelReadinessMode = "informational", signal?: AbortSignal) =>
      this.query({ type: "model.readiness", sessionId, modelId, mode }, signal),
    runtimePreview: (sessionId: string, modelId: string, signal?: AbortSignal) =>
      this.query({ type: "model.runtime.preview", sessionId, modelId }, signal),
    reviewRuntime: (sessionId: string, modelId: string, expectedDigest: string) =>
      this.command({ type: "model.runtime.review", sessionId, modelId, expectedDigest }),
    readinessWithRuntimeReview: (sessionId: string, modelId: string, runtimeReviewId: string,
      mode: import("../../protocol/src/model-readiness.ts").ModelReadinessMode = "informational", signal?: AbortSignal) =>
      this.query({ type: "model.readiness", sessionId, modelId, mode, runtimeReviewId }, signal),
    catalogue: (): ModelCatalogue => {
      const catalogue = this.getState().snapshot?.provider.catalogue;
      if (!catalogue) throw new ClientError("model_catalogue", "The current service has not supplied this profile's model inventory. No default catalogue was substituted.");
      return catalogue;
    },
    setEnabled: (apiModelId: string, enabled: boolean, expectedRevision = this.settingsRevision()) =>
      this.command({ type: "models.model.set", apiModelId, enabled, expectedRevision }),
    selectSource: (apiModelId: string, modelId: string, expectedRevision = this.settingsRevision()) =>
      this.command({ type: "models.source.select", apiModelId, modelId, expectedRevision }),
    setProviderEnabled: async (providerId: string, enabled: boolean, expectedRevision = this.settingsRevision()) => {
      const provider = this.models.catalogue().providers.find((entry) => entry.id === providerId);
      if (!provider) throw new ClientError("model_provider", "Choose a provider from this actual profile's inventory.");
      const result = await this.command({ type: "models.provider.set", providerId, enabled, expectedRevision });
      if (enabled && provider.scope === "copilot") {
        try { await this.models.refresh(); }
        catch (error) { throw new ClientError("model_refresh", `The provider preference was saved, but metadata refresh failed. Inspect its actual connection; no login or inference was started. ${error instanceof Error ? error.message : ""}`); }
      }
      return result;
    },
    refresh: () => this.command({ type: "provider.refresh" }),
    evidence: (modelId: string) => this.query({ type: "model.evidence", modelId }),
    setToken: (endpointId: string, token: string) => this.command({ type: "models.token.set", endpointId, token }),
    clearToken: (endpointId: string) => this.command({ type: "models.token.clear", endpointId }),
    /** Hosted provider accounts: keys and OAuth credentials stay in the service's secret backend. */
    hosted: {
      setKey: (providerId: "openrouter" | "anthropic" | "openai", key: string, expectedRevision = this.settingsRevision()) =>
        this.command({ type: "models.hosted.key.set", providerId, key, expectedRevision }),
      login: (providerId: "openrouter" | "chatgpt", expectedRevision = this.settingsRevision()) => this.command({ type: "models.hosted.login", providerId, expectedRevision }),
      submitCode: (providerId: "openrouter" | "chatgpt", code: string) => this.command({ type: "models.hosted.code", providerId, code }),
      cancel: (providerId: HostedProviderId) => this.command({ type: "models.hosted.cancel", providerId }),
      remove: (providerId: HostedProviderId, expectedRevision = this.settingsRevision()) => this.command({ type: "models.hosted.remove", providerId, expectedRevision }),
    },
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
    /** `/compact`: one explicit metered summary of older turns, applied when it completes valid and smaller. Originals stay restorable. */
    compact: async (sessionId: string, options: { modelId?: string; keepRecentTurns?: number } = {}) => {
      const { preview } = await this.query({ type: "compaction.preview", sessionId, ...options });
      const result = await this.command({ type: "compaction.generate", sessionId, modelId: preview.modelId, keepRecentTurns: preview.keepRecentTurns,
        expectedDigest: preview.digest, confirmCost: true, apply: "on-success" });
      return { ...result, preview };
    },
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
    export: {
      status: () => this.query({ type: "telemetry.export.status" }),
      review: (input: OtlpInput) => this.query({ type: "telemetry.export.review", input }),
      apply: (review: OtlpReview) => this.command({ type: "telemetry.export.configure", review, confirm: true }),
      /** Stores a credential header value in this profile's secret backend, bound to the exact collector origin and header name. */
      setCredential: (endpoint: string, name: string, value: string) => this.command({ type: "telemetry.export.credential.set", endpoint, name, value }),
      removeCredential: (endpoint: string, name: string) => this.command({ type: "telemetry.export.credential.remove", endpoint, name }),
    },
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
  /** Live, in-memory turn analytics for running and recent sessions; the service never stores or exports it. */
  readonly analytics = {
    overview: async () => {
      const result = await this.query({ type: "analytics.overview" });
      if (result.type !== "analytics.overview") throw new ClientError("analytics_response", "Analytics returned another response.");
      return result.analytics;
    },
    session: async (sessionId: string) => {
      const result = await this.query({ type: "analytics.session", sessionId });
      if (result.type !== "analytics.session") throw new ClientError("analytics_response", "Analytics returned another response.");
      return result.session;
    },
  };
  readonly skills = {
    inspect: (sessionId: string, skillId: string, expectedDigest: string, signal?: AbortSignal) =>
      this.query({ type: "skill.inspect", sessionId, skillId, expectedDigest }, signal),
    admit: (input: Omit<Extract<import("../../protocol/src/skill-admission.ts").SkillAdmissionCommand, { type: "skill.admit" }>, "type" | "confirmReviewed">) =>
      this.command({ type: "skill.admit", ...input, confirmReviewed: true }),
    revoke: (sessionId: string, admissionId: string, expectedRevision: number, reason: string) =>
      this.command({ type: "skill.revoke", sessionId, admissionId, expectedRevision, reason, confirm: true }),
    audit: (sessionId: string) => this.query({ type: "skill.audit", sessionId }),
    /** Saves an Ed25519 publisher key once in this profile, for later `saved-ed25519` admissions. Saving is not identity verification. */
    savePublisher: (identity: string, publicKey: string) => this.command({ type: "skill.publisher.save", identity, publicKey, confirmTrusted: true }),
    /** Permanently blocks a publisher key fingerprint or one exact skill artifact digest in this profile. */
    block: (kind: "key" | "artifact", digest: string, reason: string) => this.command({ type: "skill.trust.block", kind, digest, reason, confirm: true }),
    consume: (sessionId: string, skillId: string, expectedDigest: string, signal?: AbortSignal) =>
      this.query({ type: "skill.consume", sessionId, skillId, expectedDigest }, signal),
    use: (sessionId: string, skillId: string, expectedDigest: string, expectedDraftRevision: number, replacementText?: string) =>
      this.command({ type: "skill.use", sessionId, capabilityId: skillId, expectedDigest, expectedDraftRevision,
        ...(replacementText === undefined ? {} : { replacementText }) }),
    find: (query = "", options: { sessionId?: string; sourceId?: string; offset?: number; expectedCatalogDigest?: string; signal?: AbortSignal } = {}) => {
      const { signal, ...filters } = options;
      return this.query({ type: "skills.find", query, offset: 0, ...filters }, signal);
    },
    read: (skillId: string, expectedDigest: string, sessionId?: string, signal?: AbortSignal) =>
      this.query({ type: "skills.read", skillId, expectedDigest, ...(sessionId ? { sessionId } : {}) }, signal),
    /** Installs one exact skill from an enabled source, disabled, into a project or (null) every project. Installing grants no tools. */
    install: (projectId: string | null, skillId: string, expectedDigest: string) => this.command({ type: "skill.install", projectId, skillId, expectedDigest }),
    /** D57. Metadata of every skill in the enabled sources, with each unreadable source's error. Never session-scoped; grants nothing. */
    sources: async (signal?: AbortSignal) => {
      const result = await this.query({ type: "skills.list" }, signal);
      if (result.type !== "skills.list") throw new ClientError("skills_response", "The skill list returned another response.");
      return { skills: result.skills, failures: result.failures };
    },
    /** D57. Every skill the profile knows, grouped by where it came from: personal repositories, marketplace providers, folders, plugins and projects. */
    list: async (signal?: AbortSignal) => {
      const { skills, failures } = await this.skills.sources(signal), snapshot = this.getState().snapshot;
      if (!snapshot) throw new ClientError("skills_snapshot", "Reconnect this profile before listing skills.");
      return { groups: skillListGroups({ registry: snapshot.registry, projects: snapshot.projects, sources: snapshot.settings.values.skillSources ?? [],
        switches: snapshot.settings.values.skillSwitches, sourceSkills: skills, failures }), failures };
    },
    /** D57. Turns one source skill on or off; saves immediately. A marketplace skill must be trusted before it can be turned on. */
    setEnabled: (sourceId: string, path: string, enabled: boolean) =>
      this.command({ type: "skill.source.toggle", sourceId, path, enabled }),
    /**
     * D57. The actual user trusts this exact marketplace skill (its SKILL.md and complete package) for every chat in the profile. The
     * service re-reads the source first. Trusting is not a permission: it grants no tools and approves nothing.
     */
    trust: (sourceId: string, path: string, expectedDigest: string, expectedPackageDigest: string) =>
      this.command({ type: "skill.trust", sourceId, path, expectedDigest, expectedPackageDigest, confirm: true }),
  };
  readonly checkpoints = {
    list: (sessionId: string, offset = 0, limit = 20) => this.query({ type: "checkpoints.list", sessionId, offset, limit }),
    read: (sessionId: string, checkpointId: string) => this.query({ type: "checkpoints.read", sessionId, checkpointId }),
    preview: (sessionId: string, checkpointId: string, mode: import("../../protocol/src/turn-checkpoints.ts").RewindMode, signal?: AbortSignal) =>
      this.query({ type: "rewind.preview", sessionId, checkpointId, mode }, signal),
    settle: (sessionId: string) => this.command({ type: "rewind.settle", sessionId, confirmStop: true }),
    apply: (sessionId: string, checkpointId: string, mode: import("../../protocol/src/turn-checkpoints.ts").RewindMode, expectedDigest: string,
      decisions: import("../../protocol/src/turn-checkpoints.ts").RewindFileDecision[] = [], commandId?: string) =>
      this.command({ type: "rewind.apply", sessionId, checkpointId, mode, expectedDigest, decisions, confirm: true }, commandId),
    inspect: (sessionId: string, rewindId: string) => this.query({ type: "rewind.inspect", sessionId, rewindId }),
    acknowledge: (sessionId: string, rewindId: string, expectedRevision: number, expectedDigest: string) =>
      this.command({ type: "rewind.acknowledge", sessionId, rewindId, expectedRevision, expectedDigest, confirmInspected: true }),
    stop: (sessionId: string, rewindId: string) => this.command({ type: "rewind.stop", sessionId, rewindId }),
    prune: (sessionId: string, checkpointId: string, expectedRevision: number) =>
      this.command({ type: "checkpoint.prune", sessionId, checkpointId, expectedRevision, confirm: true }),
    pruneCapture: (sessionId: string, captureId: string, expectedRevision: number) =>
      this.command({ type: "checkpoint.capture.prune", sessionId, captureId, expectedRevision, confirm: true }),
  };
  readonly routing = {
    options: (sessionId: string, options?: ModelOptions) => this.query({ type: "routing.options", sessionId, ...(options ? { options } : {}) }),
    modes: (sessionId: string) => this.query({ type: "routing.modes", sessionId }),
    profileDraft: (input: import("../../protocol/src/kupo-modes.ts").KupoModelProfileInput) => kupoProfileDraft(this.profileId, () => this.getState().snapshot?.provider.models ?? [], input),
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
    sourcePreview: (winddownId: string, paths: string[]) => this.query({ type: "winddown.source.preview", winddownId, paths }),
    acceptSource: (winddownId: string, paths: string[], expectedRevision: number, expectedDigest: string, confirm: true) =>
      this.command({ type: "winddown.source.accept", winddownId, paths, expectedRevision, expectedDigest, confirm }),
    inspectCommit: (winddownId: string) => this.query({ type: "winddown.commit.inspect", winddownId }),
    reconcileCommit: (winddownId: string, expectedRevision: number, expectedDigest: string, confirm: true) =>
      this.command({ type: "winddown.commit.reconcile", winddownId, expectedRevision, expectedDigest, confirm }),
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
    transports: (filter: { sessionId?: string; ownerId?: string } = {}) => this.query({ type: "candidate.transports", ...filter }),
    transport: (transportId: string) => this.query({ type: "candidate.transport.read", transportId }),
    reconcileTransport: (transportId: string, expectedRevision: number) => this.command({ type: "candidate.transport.reconcile", transportId, expectedRevision }),
    source: (sessionId: string, paths: string[]) => this.query({ type: "candidate.source", sessionId, paths }),
    workspaces: (sessionId: string) => this.query({ type: "candidate.workspaces", sessionId }),
    workspace: (workspaceId: string) => this.query({ type: "candidate.workspace.read", workspaceId }),
    workspacePreview: (sessionId: string, name: string) => this.query({ type: "candidate.workspace.preview", sessionId, name }),
    createWorkspace: (sessionId: string, name: string, expectedDigest: string, confirm: true) =>
      this.command({ type: "candidate.workspace.create", sessionId, name, expectedDigest, confirm }),
    stopWorkspace: (workspaceId: string) => this.command({ type: "candidate.workspace.stop", workspaceId }),
    waitWorkspace: async (workspaceId: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<CandidateWorkspace> => {
      const deadline = Date.now() + (options.timeoutMs ?? 180_000);
      while (Date.now() < deadline) {
        options.signal?.throwIfAborted();
        const { workspace } = await this.candidates.workspace(workspaceId);
        options.signal?.throwIfAborted();
        if (workspace.status !== "creating") return workspace;
        if (this.getState().status !== "connected") throw new ClientError("disconnected", "Original workspace intent remains owned by the service. Reconnect and inspect the same identity; no creation was replayed.");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new ClientError("candidate_workspace_timeout", "Original workspace creation is unsettled. Inspect or explicitly stop it; no resource was adopted, recreated or deleted.");
    },
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
    /** Metadata of build outputs and agent-written files for a project (or null for project-free chats), each linked to its session when known. */
    library: async (projectId: string | null) => (await this.query({ type: "artifacts.library", projectId })).library,
  };
  readonly questions = {
    answerOther: (questionId: string, text: string, expectedRevision: number) => this.command({ type: "question.answer", questionId, text, expectedRevision, other: true }),
    /** Explicitly skips the pending question; the model is told the user did not answer. */
    skip: (questionId: string, expectedRevision: number) => this.command({ type: "question.answer", questionId, expectedRevision, skip: true }),
    answer: (questionId: string, text: string, expectedRevision: number, consumeDraft?: { sessionId: string; expectedRevision: number }) => this.command({ type: "question.answer", questionId, text, expectedRevision, ...(consumeDraft ? { consumeDraft } : {}) }),
    answerDraft: (questionId: string, expectedRevision: number, other = false) => {
      const question = this.getState().snapshot?.questions.find((question) => question.id === questionId);
      const session = this.getState().snapshot?.sessions.find((session) => session.id === question?.sessionId);
      if (!question || !session) throw new ClientError("question_missing", "Connect and review the actual pending question.");
      return this.command({ type: "question.answer", questionId, text: session.draft.text, expectedRevision, ...(other ? { other: true as const } : {}), consumeDraft: { sessionId: session.id, expectedRevision: session.draft.revision } });
    },
  };
  readonly workspaces = {
    home: async (sessionId: string) => {
      await this.prepareHome(sessionId);
      const snapshot = this.getState().snapshot, session = snapshot?.sessions.find((session) => session.id === sessionId);
      if (!snapshot || !session?.homeRoot || session.projectId !== null || session.controls.env !== "Local" || session.readOnly ||
        !["agent", "side"].includes(session.kind)) throw new ClientError("chat_home_scope", "Choose an ordinary project-free Local chat to inspect its captured Home. No other environment or root was substituted.");
      const root = session.homeRoot;
      return { root, writers: snapshot.chatWriters.filter((writer) => ["active", "unconfirmed"].includes(writer.status) &&
        writer.root.root === root.root && writer.root.device === root.device && writer.root.inode === root.inode) };
    },
    acknowledgeHomeWriter: (sessionId: string, writerId: string, expectedRevision: number, confirmInspection: true) =>
      this.command({ type: "chat.writer.acknowledge", sessionId, writerId, expectedRevision, confirmInspection }),
    discover: (projectId: string) => this.query({ type: "workspace.discover", projectId }),
    create: (projectId: string, branch: string, options: { baseRef?: string; issueId?: string; prUrl?: string } = {}) => this.command({ type: "workspace.create", projectId, branch, ...options }),
    inspect: (workspaceId: string) => this.query({ type: "workspace.inspect", workspaceId }),
    bind: (sessionId: string, workspaceId: string | null, expectedRevision = this.sessionRevision(sessionId)) => this.command({ type: "session.workspace", sessionId, workspaceId, expectedRevision }),
    remove: (workspaceId: string, expectedRevision: number, confirm: true) => this.command({ type: "workspace.remove", workspaceId, expectedRevision, confirm }),
    reconcile: (workspaceId: string, expectedRevision: number) => this.command({ type: "workspace.reconcile", workspaceId, expectedRevision }),
    git: (sessionId: string, diff = true, repository?: string) => this.query({ type: "session.git", sessionId, diff, ...(repository ? { repository } : {}) }),
    files: async (sessionId: string, path = ".", repository?: string) => { await this.prepareHome(sessionId); return this.query({ type: "session.files", sessionId, path, ...(repository ? { repository } : {}) }); },
    file: async (sessionId: string, path: string, repository?: string) => { await this.prepareHome(sessionId); return this.query({ type: "session.file", sessionId, path, ...(repository ? { repository } : {}) }); },
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
    list: (filters: AttentionFilters = {}) => {
      const snapshot = this.getState().snapshot;
      if (!snapshot) throw new ClientError("attention_unavailable", "Connect to the actual profile before reading Inbox.");
      return filterInboxAttention(snapshot, filters);
    },
    acknowledge: (attentionIds: string[]) => this.command({ type: "attention.acknowledge", attentionIds }),
    delete: (attentionIds: string[]) => this.command({ type: "attention.delete", attentionIds }),
  };
  readonly projects = {
    remotePreview: (projectId: string, remote: string, url: string, workspaceId?: string) =>
      this.github.preview({ env: "Local", projectId, ...(workspaceId ? { workspaceId } : {}) }, { kind: "git.remote.set", remote, url }),
    setRemote: (review: import("../../protocol/src/github-workflows.ts").GithubPreview, confirmations: string[], confirm: true, commandId?: string) => {
      if (review.document.action.kind !== "git.remote.set") throw new ClientError("remote_review", "Choose the exact reviewed repository remote change.");
      return this.github.execute(review, confirmations, confirm, commandId);
    },
    imports: {
      preview: (input: import("../../protocol/src/repository-imports.ts").RepositoryImportInput, signal?: AbortSignal) =>
        this.query({ type: "projects.import.preview", input }, signal),
      start: (review: import("../../protocol/src/repository-imports.ts").RepositoryImportPreview, confirm: true, commandId?: string) =>
        this.command({ type: "projects.import.start", input: review.document.input, expectedDigest: review.digest, confirm }, commandId),
      read: (batchId: string) => this.query({ type: "projects.import.read", batchId }),
      list: () => [...(this.getState().snapshot?.repositoryImports ?? [])].reverse(),
      cancel: async (batchId: string) => this.jobs.cancel((await this.projects.imports.read(batchId)).batch.jobId),
      acknowledge: (batchId: string, line: number, expectedRevision: number, confirmInspection: true, commandId?: string) =>
        this.command({ type: "projects.import.acknowledge", batchId, line, expectedRevision, confirmInspection }, commandId),
      wait: async (batchId: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}) => {
        const { batch } = await this.projects.imports.read(batchId);
        await this.jobs.wait(batch.jobId, options);
        return this.projects.imports.read(batchId);
      },
    },
    folders: {
      list: () => [...(this.getState().snapshot?.workspaceFolders ?? [])],
      preview: (path: string, signal?: AbortSignal) => this.query({ type: "projects.folders.preview", path }, signal),
      /** Trusts the reviewed folder, registers the chosen repositories as read-only projects and keeps the folder in sync when `sync` is true. */
      import: (review: import("../../protocol/src/workspace-folders.ts").WorkspaceFolderPreview, include: string[], sync: boolean, trust: true, commandId?: string) =>
        this.command({ type: "projects.folders.import", path: review.document.root.root, expectedDigest: review.digest, include, sync, trust }, commandId),
      configure: (folderId: string, sync: boolean, expectedRevision = this.workspaceFolder(folderId).revision) =>
        this.command({ type: "projects.folders.configure", folderId, expectedRevision, sync }),
      check: (folderId: string) => this.command({ type: "projects.folders.check", folderId }),
      remove: (folderId: string, expectedRevision = this.workspaceFolder(folderId).revision) =>
        this.command({ type: "projects.folders.remove", folderId, expectedRevision }),
      status: () => this.query({ type: "projects.folders.status" }),
    },
    /** Commands in the project's own files that look like they build an installer. Read-only; nothing runs. */
    installers: async (projectId: string) => {
      const result = await this.query({ type: "project.installers", projectId });
      if (result.type !== "project.installers") throw new ClientError("project_installers", "The installer lookup returned another response.");
      return result.candidates;
    },
    group: (name: string, projects: { projectId: string; revision: number }[]) => this.command({ type: "project.group", name, projects }),
    add: (path: string, name?: string) => this.command({ type: "project.add", path, ...(name !== undefined ? { name } : {}) }),
    clone: (repository: string, path: string, confirm: true) => this.command({ type: "project.clone", repository, path, confirm }),
    configuration: (projectId: string) => this.query({ type: "project.configuration", projectId }),
    repositories: (projectId: string) => this.query({ type: "project.repositories", projectId }),
    configure: (projectId: string, settings: ProjectSettings, expectedRevision: number) => this.command({ type: "project.settings", projectId, settings, expectedRevision }),
    organize: (projectId: string, presentation: { folderId: string | null; color: string; order: number }, expectedRevision: number) => this.command({ type: "project.organize", projectId, ...presentation, expectedRevision }),
    reorder: (folderId: string | null, projects: { projectId: string; revision: number }[]) => this.command({ type: "project.reorder", folderId, projects }),
    folder: (name: string, order = 0, id?: string, expectedRevision = 0, color?: string) =>
      this.command({ type: "project.folder", name, order, expectedRevision, ...(id ? { id } : {}), ...(color !== undefined ? { color } : {}) }),
    ungroup: (folderId: string, projects: { projectId: string; revision: number }[], expectedRevision: number) =>
      this.command({ type: "project.ungroup", folderId, projects, expectedRevision }),
    relocate: (projectId: string, path: string, expectedRevision: number) => this.command({ type: "project.relocate", projectId, path, expectedRevision }),
    remove: (projectId: string, confirm: true, expectedRevision: number, artifacts?: ProjectArtifactChoice, options: { confirmRunning?: true } = {}) =>
      this.command({ type: "project.remove", projectId, expectedRevision, confirm, ...(artifacts ? { artifacts } : {}), ...(options.confirmRunning ? { confirmRunning: true as const } : {}) }),
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
    /** Steer a queued prompt into the running turn, or run it next when the chat is idle. */
    sendNow: (sessionId: string, messageId: string, expectedRevision = this.queueRevision(sessionId)) => this.command({ type: "queue.send-now", sessionId, messageId, expectedRevision }),
    /** Save a queued prompt's text and, optionally, its complete attachment list (kept ones plus captures staged with `attachments.queued`). */
    edit: (sessionId: string, messageId: string, text: string, attachments?: Attachment[], expectedRevision = this.queueRevision(sessionId)) =>
      this.command({ type: "queue.edit", sessionId, messageId, text, ...(attachments ? { attachments } : {}), expectedRevision }),
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
    /** `!command`: type one line plus Enter into this chat's user console, opening one only when none is running. No model call. */
    run: (sessionId: string, command: string, signal?: AbortSignal) => runInTerminal(this, sessionId, command, signal),
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
    disk: {
      status: () => this.query({ type: "application.virtual_disk.status" }),
      /** A size in GiB creates or resizes Moguri's virtual disk for session worktrees; null turns it off. */
      configure: (sizeGiB: number | null, expectedRevision: number) => this.command({ type: "application.virtual_disk.configure", sizeGiB, expectedRevision }),
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
    delete: (capabilityId: string, expectedRevision: number, confirm: true) => this.command({ type: "capability.delete", capabilityId, expectedRevision, confirm }),
    importSkill: (projectId: string, path: string) => this.command({ type: "skill.import", projectId, path }),
    importPlugin: (projectId: string, path: string) => this.command({ type: "plugin.import", projectId, path }),
    propose: (projectId: string | null, kind: "skill" | "script" | "memory" | "hook", name: string, content: string) => this.command({ type: "proposal.create", projectId, kind, name, content }),
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
    tools: async (serverId = "builtin", query = "", offset = 0, sessionId?: string) => {
      if (sessionId && serverId !== "builtin") await this.prepareHome(sessionId);
      return this.query({ type: "mcp.tools", serverId, query, offset, ...(sessionId ? { sessionId } : {}) });
    },
    auth: (serverId: string, sessionId?: string) => this.query({ type: "mcp.auth", serverId, ...(sessionId ? { sessionId } : {}) }),
    setToken: (serverId: string, token: string, sessionId?: string) => this.command({ type: "mcp.token.set", serverId, token, ...(sessionId ? { sessionId } : {}) }),
    clearToken: (serverId: string, sessionId?: string) => this.command({ type: "mcp.token.clear", serverId, ...(sessionId ? { sessionId } : {}) }),
    call: (sessionId: string, serverId: string, tool: string, args: Record<string, unknown>, schemaDigest: string) => this.command({ type: "mcp.call", sessionId, serverId, tool, arguments: args, schemaDigest }),
    readResult: (resultId: string, offset = 0, limit = 12000) => this.query({ type: "result.read", resultId, offset, limit }),
  };
  readonly voice = {
    startCapture: async (sessionId: string, id: string = crypto.randomUUID(), options: { streaming?: true } = {}): Promise<{ id: string; token: string }> => {
      if (this.getState().status !== "connected") throw new ClientError("disconnected", "Reconnect the original profile before capturing audio.");
      const request = parse(SpeechCaptureRequestSchema, { action: "start", sessionId, id, ...(options.streaming ? { streaming: true } : {}) });
      const result = await this.request("/v1/voice", request);
      if (!isRecord(result) || result.id !== id || typeof result.token !== "string" || !/^[a-f0-9-]{36}$/.test(result.token)) throw new ClientError("speech_capture_response", "The service did not acknowledge the exact original capture. No microphone was started.");
      if (options.streaming && result.streaming !== true) throw new ClientError("speech_capture_response", "The service did not acknowledge streaming for this exact capture. No batch or cloud fallback was used.");
      return { id, token: result.token };
    },
    appendCapture: async (sessionId: string, id: string, token: string, sequence: number, bytes: Uint8Array): Promise<void> => {
      if (!bytes.length || bytes.length % 2 || bytes.length > 64 * 1024) throw new ClientError("speech_audio", "Use one bounded little-endian PCM16 frame.");
      const result = await this.request("/v1/voice", parse(SpeechCaptureRequestSchema, { action: "append", sessionId, id, token, sequence, audio: audioBase64(bytes) }));
      if (!isRecord(result) || result.id !== id || result.accepted !== true) throw new ClientError("speech_capture_response", "The owning capture did not acknowledge this audio frame. It was not replayed.");
    },
    finishCapture: async (sessionId: string, id: string, token: string, sequence: number): Promise<void> => {
      const result = await this.request("/v1/voice", parse(SpeechCaptureRequestSchema, { action: "finish", sessionId, id, token, sequence }));
      if (!isRecord(result) || result.id !== id || result.accepted !== true) throw new ClientError("speech_capture_response", "The original capture did not accept its final buffer. It was not replayed.");
    },
    readCapture: async (sessionId: string, id: string, token: string): Promise<{ text: string; revision: number }> => {
      const result = await this.request("/v1/voice", parse(SpeechCaptureRequestSchema, { action: "read", sessionId, id, token }));
      if (!isRecord(result) || result.id !== id || result.accepted !== true || typeof result.text !== "string" ||
        typeof result.revision !== "number" || !Number.isSafeInteger(result.revision) || result.revision < 0) throw new ClientError("speech_capture_response", "The original streamed transcript was not acknowledged. No text was inserted.");
      return { text: result.text, revision: result.revision };
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
    enable: (acceptLicense: true, expectedRevision = this.settings.get()?.revision) => {
      if (expectedRevision === undefined) throw new ClientError("settings_missing", "Connect before reviewing the exact voice model.");
      return this.command({ type: "voice.enable", acceptLicense, expectedRevision });
    },
    disable: (confirm: true, expectedRevision = this.settings.get()?.revision) => {
      if (expectedRevision === undefined) throw new ClientError("settings_missing", "Connect the original profile before disabling and removing its managed voice model.");
      return this.command({ type: "voice.disable", confirm, expectedRevision });
    },
    prepare: () => this.command({ type: "voice.prepare" }),
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
    /**
     * Searches for speech models only when called. Without a path it checks Handy's model folder and the Hugging Face cache;
     * with a path it checks that file or folder. Nothing is trusted or saved.
     */
    discoverModels: async (path?: string, signal?: AbortSignal) => {
      const result = await this.query({ type: "voice.models.discover", ...(path !== undefined ? { path } : {}) }, signal);
      if (result.type !== "voice.models.discover") throw new ClientError("speech_model_discovery", "The model search returned another response.");
      return result.discovery;
    },
    /** Starts a read-only review job: header, streaming capability and full SHA-256. The file is never copied, moved or deleted. */
    inspectModel: (path: string) => this.command({ type: "voice.model.inspect", path }),
    /** Reads a completed review so the user can approve its exact digest. */
    inspection: async (jobId: string): Promise<VoiceModelInspection> => {
      const job = this.getState().snapshot?.jobs.find((job) => job.id === jobId);
      if (!job || job.kind !== "voice.inspect" || job.status !== "completed") throw new ClientError("speech_model_review", job?.error ?? "Choose a completed model review from this profile.");
      const page = await this.mcp.readResult(jobId, 0, 32768);
      if (page.nextOffset !== null) throw new ClientError("speech_model_review", "The model review exceeded its bounded result.");
      const value: unknown = JSON.parse(page.text);
      if (!isRecord(value) || typeof value.path !== "string" || typeof value.sha256 !== "string" || typeof value.name !== "string" || value.streaming !== true) {
        throw new ClientError("speech_model_review", "The retained result is not a complete model review.");
      }
      return value as unknown as VoiceModelInspection;
    },
    /** Locks the reviewed path, size and SHA-256 as this profile's dictation model and enables dictation. */
    trustModel: (jobId: string, expectedRevision = this.settings.get()?.revision) => {
      if (expectedRevision === undefined) throw new ClientError("settings_missing", "Connect the original profile before trusting a model.");
      return this.command({ type: "voice.model.trust", jobId, expectedRevision });
    },
    /** Switches back to the managed Nemotron model. The external file is left untouched. */
    useManagedModel: (expectedRevision = this.settings.get()?.revision) => {
      if (expectedRevision === undefined) throw new ClientError("settings_missing", "Connect the original profile before switching models.");
      return this.command({ type: "voice.model.managed", expectedRevision });
    },
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
    publicationPreview: (executionId: string, paths: string[], repository?: string) => this.query({ type: "sandbox.publication.preview", executionId, paths, ...(repository ? { repository } : {}) }),
    publish: (executionId: string, paths: string[], expectedDigest: string, expectedRevision: number, repository?: string) =>
      this.command({ type: "sandbox.publish", executionId, paths, expectedDigest, expectedRevision, confirm: true, ...(repository ? { repository } : {}) }),
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
    const deadline = performance.now() + timeoutMs;
    while (this.getState().status !== "connected" && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    if (this.getState().status !== "connected") {
      const diagnostic = this.getState().error;
      this.disconnect();
      throw new ClientError("connection_timeout", `Moguri protocol negotiation did not complete.${diagnostic ? ` ${diagnostic}` : " The authenticated event handshake was not ready; inspect the matching service log and selected profile."} No commands were resent or saved state reset.`);
    }
    return this;
  }
}
export { MoguriSdk as MoguriClient };
