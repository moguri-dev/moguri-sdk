import { MoguriClient as TransportClient, ClientError } from "../../client/src/index.ts";
import { isRecord, QuerySchema, parse, TerminalInputSchema, type PlatformQuery, type PlatformResponse, type SettingsSection, type UserSettings, type CapabilityJob, type BoardConfig, type IssueInput, type PackageManager, type SessionChanges, type SessionMode, type ProjectSettings, type TerminalInput, type Controls, type ModelOptions, type ConfigurationSpec, type ControlDefaults, type ArtifactKind, type ArtifactChanges, type ProjectArtifactChoice } from "../../protocol/src/index.ts";
import type { BudgetLimit, BudgetQuery, KupoSettings, Profile, CompactionPreview, TelemetryQuery, Session } from "../../protocol/src/index.ts";
import { executeSlash, type SlashResult } from "./slash.ts";

export * from "../../protocol/src/index.ts";
export * from "./brand.ts";
export * from "./slash.ts";
export { ClientError };
export { DraftEditor } from "../../client/src/draft.ts";
export type { ClientState } from "../../client/src/index.ts";
export const sessionTitle = (session: Session, limit = 64, fallback = "New session"): string =>
  session.title !== "New session" ? session.title : session.messages.find((message) => message.role === "user")?.text.split("\n")[0]?.slice(0, limit) || fallback;

export class MoguriSdk extends TransportClient {
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
    file: (sessionId: string, path: string, mode: "text" | "image" = "text", expectedRevision = this.draftRevision(sessionId)) => this.command({ type: "attachment.file.add", sessionId, path, mode, expectedRevision }),
    image: (sessionId: string, data: string, name = "Clipboard image", expectedRevision = this.draftRevision(sessionId)) => this.command({ type: "attachment.image.add", sessionId, data, name, expectedRevision }),
    folderPreview: (sessionId: string, path: string) => this.query({ type: "attachment.folder.preview", sessionId, path }),
    folder: (sessionId: string, path: string, expectedDigest: string, confirm: true, expectedRevision = this.draftRevision(sessionId)) => this.command({ type: "attachment.folder.add", sessionId, path, expectedDigest, confirm, expectedRevision }),
    githubPreview: (sessionId: string, url: string, access: "public" | "gh-cli" = "public") => this.query({ type: "attachment.github.preview", sessionId, url, access }),
    github: (sessionId: string, url: string, access: "public" | "gh-cli", expectedDigest: string, confirm: true, expectedRevision = this.draftRevision(sessionId)) => this.command({ type: "attachment.github.add", sessionId, url, access, expectedDigest, confirm, expectedRevision }),
    sessionPreview: (sessionId: string, sourceSessionId: string) => this.query({ type: "attachment.session.preview", sessionId, sourceSessionId }),
    session: (sessionId: string, sourceSessionId: string, expectedDigest: string, confirm: true, expectedRevision = this.draftRevision(sessionId)) => this.command({ type: "attachment.session.add", sessionId, sourceSessionId, expectedDigest, confirm, expectedRevision }),
    read: (sessionId: string, attachmentId: string) => this.query({ type: "attachment.read", sessionId, attachmentId }),
  };
  readonly sessions = {
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
  readonly budgets = {
    status: (sessionId: string) => this.query({ type: "budget.status", sessionId }),
    dashboard: (filters: Omit<Extract<BudgetQuery, { type: "budget.dashboard" }>, "type"> = {}) => this.query({ type: "budget.dashboard", ...filters }),
    calls: (filters: Omit<Extract<BudgetQuery, { type: "budget.calls" }>, "type"> = {}) => this.query({ type: "budget.calls", ...filters }),
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
    search: (projectId: string, text: string, limit = 6, workspaceId?: string) => this.query({ type: "memory.search", projectId, text, limit, ...(workspaceId ? { workspaceId } : {}) }),
    graph: (projectId: string, path = "", workspaceId?: string) => this.query({ type: "memory.graph", projectId, path, ...(workspaceId ? { workspaceId } : {}) }),
    remember: (projectId: string, text: string) => this.command({ type: "memory.remember", projectId, text }),
  };
  readonly capabilities = {
    content: (capabilityId: string) => this.query({ type: "capability.content", capabilityId }),
    toggle: (capabilityId: string, enabled: boolean, expectedRevision: number) => this.command({ type: "capability.toggle", capabilityId, enabled, expectedRevision }),
    importSkill: (projectId: string, path: string) => this.command({ type: "skill.import", projectId, path }),
    importPlugin: (projectId: string, path: string) => this.command({ type: "plugin.import", projectId, path }),
    propose: (projectId: string, kind: "skill" | "script" | "memory", name: string, content: string) => this.command({ type: "proposal.create", projectId, kind, name, content }),
    proposal: (proposalId: string) => this.query({ type: "proposal.content", proposalId }),
    decide: (proposalId: string, approve: boolean, expectedDigest: string) => this.command({ type: "proposal.decide", proposalId, approve, expectedDigest }),
  };
  readonly mcp = {
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
  readonly sandbox = { status: () => this.query({ type: "sandbox.status" }) };
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
  readonly cache = {
    inspect: (projectId: string, manager: PackageManager, workspaceId?: string) => this.query({ type: "cache.inspect", projectId, manager, ...(workspaceId ? { workspaceId } : {}) }),
    prepare: (projectId: string, manager: PackageManager, expectedDigest: string, acceptMetadataSharing: true, workspaceId?: string) => this.command({ type: "cache.prepare", projectId, manager, expectedDigest, acceptMetadataSharing, ...(workspaceId ? { workspaceId } : {}) }),
    install: (projectId: string, manager: PackageManager, expectedDigest: string, acceptMetadataSharing: true, runScripts = false, workspaceId?: string) => this.command({ type: "cache.install", projectId, manager, expectedDigest, acceptMetadataSharing, runScripts, ...(workspaceId ? { workspaceId } : {}) }),
  };
  readonly linear = {
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
