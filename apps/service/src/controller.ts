import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { basename, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { realpath, stat } from "node:fs/promises";
import type { Message } from "@earendil-works/pi-ai";
import {
  CommandSchema, isPlatformCommand, isQuestionCommand, isRecord, MAX_TEXT, MoguriError, parse, PROFILE_ID, projectEvents, PROTOCOL_VERSION, resolveControls, UserQuestionSchema,
  type CommandEnvelope, type CommandResult, type Controls, type EventInput, type Session, type Snapshot, type StoredEvent, type ToolCall,
  type SessionMode, type ControlDefaults,
  type ExecutionCommand, type RemoteExecution, type Usage, type ProjectArtifactChoice, type QuestionCommand, type UserQuestion,
} from "../../../packages/protocol/src/index.ts";
import { readProjectFile } from "./files.ts";
import { digest, EventStore, type ForgetRequest } from "./store.ts";
import { CopilotAdapter, type ProviderAdapter } from "./provider.ts";
import { validateTool } from "./tools.ts";
import { effectiveTools } from "./tools.ts";
import { PlatformRuntime, type PlatformOptions } from "./platform.ts";
import { authorizeTool } from "./permissions.ts";
import { assistantMessage, toolCalls, WorkerRequestSchema, type ParentMessage, type WorkerRequest } from "./worker-protocol.ts";
import { assertSessionTool, folderPolicy } from "./project-policy.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import { contextHasImages, estimateModelContext, modelRequest, validateModelOptions, validateContextSize } from "./model-controls.ts";
import { attentionEvents } from "./attention.ts";
import { ModelRegistry, localEndpointUrl } from "./model-registry.ts";
import { RemoteRuntime } from "./remote.ts";
import { McpKeychain } from "./gateway.ts";
import { localWorker, type WorkerConnection, type WorkerFrame } from "./worker-connection.ts";
import { frameDigest } from "./worker-wire.ts";
import type { BridgeStatus } from "./remote-protocol.ts";

interface Run {
  sessionId: string;
  turnId: string;
  child: WorkerConnection;
  executionId?: string;
  abort: AbortController;
  stepId?: string;
  inFlight: boolean;
  calls: Map<string, ToolCall>;
  granted: Set<string>;
  approval?: { id: string; requestId: string; call: ToolCall; policyRevision: number };
  chain: Promise<void>;
  stopTimer?: ReturnType<typeof setTimeout>;
  done: boolean;
  stderr: string;
  declaredTools: Set<string>;
  repositoryContext?: string;
}
interface ExternalRun {
  sessionId: string; turnId: string; jobId: string; stepId: string; call: ToolCall; approvalId: string;
  policyRevision: number; permissionRevision: number; abort: AbortController; started: boolean;
  execute: (signal: AbortSignal) => Promise<unknown>;
}
export class ControlPlane extends EventEmitter {
  private history: StoredEvent[];
  private projection;
  private readonly runs = new Map<string, Run>();
  private readonly paused = new Set<string>();
  private readonly dispatching = new Map<string, { digest: string; result: Promise<CommandResult> }>();
  private shuttingDown = false;
  private providerMetadata = "";
  readonly platform: PlatformRuntime;
  private externalRuns = new Map<string, ExternalRun>();
  private writerReservations = new Map<string, string>();
  private deletingSessions = new Set<string>();
  private deletingProjects = new Set<string>();
  private questionWaits = new Map<string, { run: Run; requestId: string }>();
  readonly provider: ModelRegistry;
  readonly remote: RemoteRuntime;
  private readonly remoteModels: ModelRegistry;
  private readonly workerFrame = new AsyncLocalStorage<{ frame: WorkerFrame; recorded: boolean }>();
  constructor(readonly store: EventStore, provider: ProviderAdapter = new CopilotAdapter(), private readonly workerPath = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.mjs", import.meta.url)), platformOptions: PlatformOptions & { stateDir?: string } = {}) {
    super();
    this.history = store.events();
    this.projection = projectEvents(this.history);
    this.remote = new RemoteRuntime(platformOptions.stateDir ?? dirname(store.path), () => this.projection.settings.values.remote, workerPath, {
      ...platformOptions.remote, changed: () => { this.provider?.synchronize(); platformOptions.remote?.changed?.(); this.emit("change", []); },
    });
    this.remoteModels = new ModelRegistry({
      state: { status: "disconnected", models: [], login: null, diagnostic: null }, onChange: () => {},
      refresh: async () => {}, cancel: async () => {}, logout: async () => {},
      login: () => { throw new MoguriError("remote_account", "Configure the remote endpoint's explicit account, not a second Copilot login."); },
      prepare: async () => { throw new MoguriError("remote_model", "This remote model is no longer configured. No provider was substituted.", 409); },
    }, () => this.remote.readiness.ready ? this.projection.settings.values.remote?.models ?? [] : [], {
      includeCopilot: false, environments: ["Remote"], vault: platformOptions.remote?.modelsVault ?? new McpKeychain("dev.moguri.profile.default.remote-models"),
      idPrefix: () => {
        const target = this.projection.settings.values.remote;
        return `remote.${frameDigest(target ? [target.id, target.host, target.port, target.user, target.hostKey] : null).slice(0, 16)}.local`;
      },
      fetch: async (input, init) => {
        const url = input instanceof Request ? input.url : input.toString(), target = this.remote.assertReady();
        const endpoint = target.models.find((endpoint) => endpoint.enabled && new URL("models", localEndpointUrl(endpoint.baseUrl)).href === url);
        if (!endpoint) throw new MoguriError("remote_model_scope", "Remote discovery is limited to the explicitly configured endpoint.", 403);
        const header = new Headers(init?.headers).get("Authorization");
        return this.remote.catalog(endpoint.baseUrl, header?.startsWith("Bearer ") ? header.slice(7) : null, init?.signal ?? AbortSignal.timeout(5000));
      },
    });
    this.provider = new ModelRegistry(provider, () => this.projection.settings.values.localModels, {
      ...platformOptions.models, additional: this.remoteModels,
      copilotEnvironments: () => this.remote.readiness.ready && this.projection.settings.values.remote?.allowCopilot ? ["Local", "Remote"] : ["Local"],
    });
    this.platform = new PlatformRuntime(store, platformOptions.stateDir ?? dirname(store.path), {
      snapshot: () => this.snapshot(), events: () => this.events(0), commit: (events, forget) => this.commit(events, undefined, forget),
      invalidateApprovals: (id) => this.invalidateApprovals(id),
      externalCall: (session, call, execute) => this.externalCall(session, call, execute),
      subagent: (session, prompt) => this.subagent(session, prompt),
      stopOwnedSession: (id) => this.stop(id),
      cancelExternalJob: (id) => {
        const external = [...this.externalRuns.values()].find((run) => run.jobId === id);
        if (!external) return false;
        this.stop(external.sessionId); return true;
      },
      wake: () => queueMicrotask(() => this.pumpAll()),
      mode: (session, mode, finish) => this.changeMode(session, mode, finish),
      spawnUser: (session, kind, title, finish) => this.spawnUser(session, kind, title, finish),
      deleteSession: (session, finish) => this.deleteSession(session, finish),
      removeProject: (id, finish, artifacts) => this.removeProject(id, finish, artifacts),
      validateAdmission: (session, attachments = []) => {
        if (session.status === "archived") throw new MoguriError("archived", "Restore the session before running queued work.");
        this.available(session.controls, true, session);
        this.imageModel(session, attachments);
        if (this.blocked(session)) throw new MoguriError("workspace_unconfirmed", "Inspect and resume this workspace first.", 409);
        this.paused.delete(session.id);
      },
      closingProject: (id) => this.deletingProjects.has(id),
      contextPreview: (session) => this.previewContext(session),
      validateControls: (controls) => this.available(controls),
      startup: (projectId) => this.startup(projectId),
      modelCredential: async (id, token, finish) => {
        if (this.runs.size) throw new MoguriError("provider_busy", "Stop active model work before changing a local endpoint account.", 409);
        await this.provider.token(id, token);
        const settings = this.projection.settings;
        const result = finish([{ event_type: "settings.updated", profile_id: PROFILE_ID, payload: { settings: settings.values, revision: settings.revision + 1, permissionRevision: settings.permissionRevision + 1 } }]);
        this.invalidateApprovals(); return result;
      },
      remoteStatus: () => this.remote.readiness,
      remoteCommand: (command, finish) => this.remoteCommand(command, finish),
      repositoryContext: (session) => this.repositoryContext(session),
    }, platformOptions);
    this.provider.onChange = () => {
      const metadata = { status: this.provider.state.status, diagnostic: this.provider.state.diagnostic };
      const signature = JSON.stringify(metadata);
      if (signature !== this.providerMetadata) {
        this.providerMetadata = signature;
        this.commit([{ event_type: "provider.changed", profile_id: PROFILE_ID, payload: metadata }]);
      } else this.emit("change", []);
    };
  }
  async initialize(): Promise<void> {
    this.platform.recover();
    const interruptedExecutions = this.projection.executions.filter((execution) => ["launching", "running", "stopping"].includes(execution.status));
    if (interruptedExecutions.length) this.commit(interruptedExecutions.map((execution) => ({
      event_type: "execution.changed", profile_id: PROFILE_ID, project_id: execution.projectId, session_id: execution.sessionId, turn_id: execution.turnId,
      payload: { executionId: execution.id, status: "unconfirmed", cancellation: "unconfirmed", cleanup: "unconfirmed", diagnostic: "Control plane restarted. Reconcile the existing remote run; no replacement or effect was replayed." },
    })));
    for (const session of [...this.projection.sessions]) {
      if (session.turnId) {
        const completed = new Set(this.history.filter((event) => event.turn_id === session.turnId && event.event_type === "tool.completed").map((event) => event.event_type === "tool.completed" ? event.payload.call.id : ""));
        const unfinished = this.history.filter((event) => event.turn_id === session.turnId && event.event_type === "model.completed")
          .flatMap((event) => event.event_type === "model.completed" ? event.payload.message.toolCalls ?? [] : []).filter((call) => !completed.has(call.id));
        this.commit([
          ...this.cancelledQuestions(session, "Service restarted. No answer or replacement question was invented."),
          ...unfinished.map((call) => this.event(session, "tool.completed", { call, text: "Service restarted before a durable tool result. Execution and cleanup are unconfirmed; this tool was not replayed.", isError: true, outcome: "unconfirmed" })),
          this.event(session, "turn.finished", {
            outcome: "partial",
            diagnostic: "Moguri restarted during this turn. Provider usage and process cleanup may be incomplete. Inspect the workspace before continuing; no operation was retried.",
          }),
        ]);
      }
      if (session.queue.length) {
        this.paused.add(session.id);
        this.commit([this.event(this.session(session.id), "session.blocked", { diagnostic: "Saved queue recovered. Review it, then explicitly Resume queued work." })]);
      }
    }
    await this.provider.refresh();
  }
  snapshot(): Snapshot {
    return {
      protocolVersion: PROTOCOL_VERSION, seq: this.history.at(-1)?.seq ?? 0, profileId: PROFILE_ID,
      ...this.projection, provider: this.provider.state,
      capabilities: [
        { env: "Local", ready: process.platform === "darwin", reason: process.platform === "darwin" ? "Runs directly on this Mac. Shell commands are not sandboxed." : "Local supervision is validated on macOS only in this checkpoint." },
        { env: "Sandbox", ready: false, reason: "SendBox worker transport and guest artifacts are not validated in this checkpoint. No Local fallback." },
        { env: "Remote", ready: this.remote.readiness.ready && this.remote.readiness.configDigest === frameDigest(this.projection.settings.values.remote), reason: this.remote.readiness.diagnostic },
      ],
    };
  }
  events(after: number): StoredEvent[] { return this.history.filter((event) => event.seq > after && event.profile_id === PROFILE_ID); }
  private commit(events: EventInput[], receipt?: { id: string; digest: string; result: CommandResult }, forget?: ForgetRequest): void {
    const context = this.workerFrame.getStore();
    if (context && !context.recorded) {
      const execution = this.projection.executions.find((value) => value.id === context.frame.executionId);
      if (!execution) throw new MoguriError("remote_frame", "The owned remote frame has no execution identity.", 409);
      events = [...events, { event_type: "execution.frame_recorded", profile_id: PROFILE_ID, project_id: execution.projectId, session_id: execution.sessionId, turn_id: execution.turnId, payload: context.frame }];
    }
    const appended = this.store.commit(events, receipt, forget, (primary) => {
      const next = { ...this.snapshot(), ...projectEvents([...this.history, ...primary]) };
      const answers = primary.some((event) => event.event_type === "question.answered") ? this.platform.artifacts.answerEvents(next, primary) : [];
      return [...answers, ...attentionEvents(next, primary)];
    });
    if (context) context.recorded = true;
    if (forget) this.history = this.store.events(); else this.history.push(...appended);
    this.projection = projectEvents(this.history);
    this.emit("change", appended);
    this.remote.synchronize();
    this.provider.synchronize();
  }
  private remoteWorkspace(session: Session): string | null {
    if (session.projectId === null) return null;
    const path = this.platform.sessions.projects.configuration(session.projectId).values.remotePath;
    if (!path || !path.startsWith("/") || /[\0\r\n]/.test(path)) throw new MoguriError("remote_workspace", "Configure this project's explicit absolute remote workspace. Its local folder was not reused.", 409);
    return path;
  }
  private async repositoryContext(session: Session): Promise<string> {
    if (!session.projectId) return "";
    const project = this.platform.managed.project(session);
    return session.controls.env === "Remote" ? this.remote.context(this.remoteWorkspace(session)!, this.platform.sessions.projects.configuration(project.id).values) : this.platform.sessions.projects.context(project);
  }
  private executionStatus(id: string, status: BridgeStatus): void {
    const execution = this.projection.executions.find((value) => value.id === id);
    if (!execution || status.runId !== id) return;
    this.commit([{ event_type: "execution.changed", profile_id: PROFILE_ID, project_id: execution.projectId, session_id: execution.sessionId, turn_id: execution.turnId,
      payload: { executionId: id, status: status.status, cancellation: status.cancellation, cleanup: status.cleanup, diagnostic: status.diagnostic, ...(status.workerPid ? { workerPid: status.workerPid } : {}) } }]);
    queueMicrotask(() => this.pumpAll());
  }
  private modelUsage(session: Session, request: Extract<WorkerRequest, { kind: "model.complete" }>): Usage {
    const message = assistantMessage(request.message), prior = session.usage.find((usage) => usage.stepId === request.stepId);
    return {
      stepId: request.stepId, modelId: prior?.modelId ?? message.model, providerId: prior?.providerId, apiModelId: prior?.apiModelId, source: prior?.source,
      role: session.kind === "side" ? "side" : session.kind === "subagent" ? "subagent" : "solver",
      inputTokens: request.usageReported ? message.usage.input : null, outputTokens: request.usageReported ? message.usage.output : null,
      cacheReadTokens: request.usageReported ? message.usage.cacheRead : null, totalTokens: request.usageReported ? message.usage.totalTokens : null,
      estimatedUsd: null, providerReportedUsd: null, billedUsd: null, requestMs: request.generationMs,
      quality: request.usageReported ? "provider-reported" : "unknown", outcome: message.stopReason,
      contextWindow: prior?.contextWindow, contextEstimate: prior?.contextEstimate, thinkingEffort: prior?.thinkingEffort,
    };
  }
  private async remoteCommand(command: ExecutionCommand, finish: WorkspaceFinish): Promise<CommandResult> {
    if (command.type === "remote.probe") { await this.remote.probe(); await this.remoteModels.refresh(); this.emit("change", []); return finish([]); }
    if (command.type === "remote.model-token.set" || command.type === "remote.model-token.clear") {
      if ([...this.runs.values()].some((run) => run.executionId)) throw new MoguriError("provider_busy", "Stop owned remote work before changing its endpoint account.", 409);
      this.remote.assertReady();
      await this.remoteModels.token(command.endpointId, command.type === "remote.model-token.set" ? command.token : undefined);
      const settings = this.projection.settings;
      const result = finish([{ event_type: "settings.updated", profile_id: PROFILE_ID, payload: { settings: settings.values, revision: settings.revision + 1, permissionRevision: settings.permissionRevision + 1 } }]);
      this.invalidateApprovals(); return result;
    }
    const execution = this.projection.executions.find((value) => value.id === command.executionId);
    if (!execution) throw new MoguriError("remote_execution", "This remote execution is outside the profile.", 404);
    if (this.runs.get(execution.sessionId)?.executionId === execution.id) throw new MoguriError("remote_active", "Stop/wait for this live execution before offline reconciliation or inspection acknowledgement.", 409);
    if (command.type === "remote.acknowledge") return finish([{ event_type: "execution.changed", profile_id: PROFILE_ID, project_id: execution.projectId, session_id: execution.sessionId, turn_id: execution.turnId,
      payload: { executionId: execution.id, status: execution.status, cancellation: execution.cancellation, cleanup: "acknowledged", diagnostic: "The user acknowledged remote process inspection. This does not retrospectively prove containment or successful cleanup." } }]);
    const inspection = await this.remote.inspect(execution);
    if (inspection.status.runId !== execution.id || inspection.info.workerDigest !== execution.workerDigest) throw new MoguriError("remote_identity", "Remote inspection changed its owned run/build identity. No result was applied.", 409);
    const events: EventInput[] = [];
    const session = this.session(execution.sessionId);
    let cursor = execution.lastSequence;
    for (const frame of inspection.frames) {
      if (frame.sequence !== cursor + 1 || frameDigest(frame.request) !== frame.digest) throw new MoguriError("remote_frame", "Late remote frame identity/digest/sequence is invalid.", 409);
      cursor = frame.sequence;
      const scope = { profile_id: PROFILE_ID, project_id: execution.projectId, session_id: execution.sessionId, turn_id: execution.turnId, ...("stepId" in frame.request ? { step_id: frame.request.stepId } : {}) };
      if (frame.request.kind === "model.complete") {
        const stepId = frame.request.stepId;
        const prior = session.usage.find((usage) => usage.stepId === stepId);
        if (prior?.quality === "unknown" && frame.request.usageReported && assistantMessage(frame.request.message).model === prior.apiModelId) events.push({ ...scope, event_type: "model.late_usage", payload: { usage: this.modelUsage(session, frame.request), executionId: execution.id, sequence: frame.sequence } });
      }
      if (frame.request.kind === "tool.complete") {
        const call = frame.request.call;
        const declared = this.history.some((event) => event.event_type === "model.completed" && event.turn_id === execution.turnId && event.payload.message.toolCalls?.some((value) => frameDigest(value) === frameDigest(call)));
        if (declared) events.push({ ...scope, event_type: "tool.completed", payload: { call, text: frame.request.text, isError: frame.request.isError, outcome: frame.request.outcome } });
      }
      events.push({ ...scope, event_type: "execution.frame_recorded", payload: { executionId: execution.id, sequence: frame.sequence, digest: frame.digest } });
    }
    events.push({ event_type: "execution.changed", profile_id: PROFILE_ID, project_id: execution.projectId, session_id: execution.sessionId, turn_id: execution.turnId,
      payload: { executionId: execution.id, status: inspection.status.status, cancellation: inspection.status.cancellation, cleanup: inspection.status.cleanup,
        diagnostic: `${inspection.status.diagnostic ?? "Owned remote status inspected."} Late receipts do not replay tools or rewrite the original partial turn as successful.`, ...(inspection.status.workerPid ? { workerPid: inspection.status.workerPid } : {}) } });
    return finish(events);
  }
  private startup(projectId: string | null, overrides: ControlDefaults = {}) {
    const configuration = projectId ? this.platform.sessions.projects.configuration(projectId) : null;
    const settings = this.projection.settings;
    return resolveControls([
      { source: "global", values: settings.values.startup.global },
      { source: "profile", values: settings.values.startup.profile },
      { source: "project", values: configuration?.values.defaults ?? {} },
      { source: "session", values: overrides },
    ], { settingsRevision: settings.revision, projectRevision: configuration?.revision ?? null });
  }
  private session(id: string): Session {
    const session = this.projection.sessions.find((session) => session.id === id);
    if (!session) throw new MoguriError("not_found", "Session not found in the active profile.", 404);
    return session;
  }
  private blocked(session: Session): boolean { return this.projection.blockedSessions.includes(session.id) || Boolean(session.workspaceId && this.projection.blockedWorkspaces.includes(session.workspaceId)) || Boolean(session.projectId && !session.workspaceId && this.projection.blockedProjects.includes(session.projectId)); }
  private projectRequired(id: string | null) {
    const project = this.projection.projects.find((project) => project.id === id);
    if (!project) throw new MoguriError("project_required", "Select a project for this workspace operation. No previous project was reused.", 409);
    return project;
  }
  private event<K extends EventInput["event_type"]>(session: Session, type: K, payload: Extract<EventInput, { event_type: K }>["payload"], stepId?: string): EventInput {
    return { event_type: type, payload, profile_id: PROFILE_ID, project_id: session.projectId, session_id: session.id, turn_id: session.turnId, step_id: stepId } as EventInput;
  }
  private invalidateApprovals(sessionId?: string): void {
    for (const run of this.runs.values()) if (run.approval) {
      if (sessionId && run.sessionId !== sessionId) continue;
      const approval = run.approval;
      run.approval = undefined;
      this.commit([this.event(this.session(run.sessionId), "tool.decided", { approvalId: approval.id, allow: false, actor: "policy" }, run.stepId)]);
      this.reply(run, { kind: "reply", requestId: approval.requestId, error: "Policy or permissions changed. Obtain a new exact-argument approval." });
    }
    for (const external of [...this.externalRuns.values()]) if (!external.started && (!sessionId || external.sessionId === sessionId)) this.finishExternal(external, "stopped", "Permissions changed. The external tool was not executed.");
  }
  private changeMode(session: Session, mode: SessionMode, finish: WorkspaceFinish): CommandResult {
    if (session.mode === mode && !session.pendingMode) return finish([], { revision: session.revision });
    if ((session.kind === "side" || session.kind === "subagent") && mode !== "read-only") throw new MoguriError("question_only", "Question-only side sessions and model subagents cannot acquire edit authority.", 403);
    const active = session.turnId && this.runs.has(session.id);
    const result = active ? finish([
      this.event(session, "session.mode_requested", { mode }),
      this.event(session, "queue.enqueued", { item: { id: randomUUID(), text: mode === "read-only" ? "/read-only" : "/agent", attachments: [], delivery: "steer", targetTurnId: session.turnId!, mode } }),
    ], { revision: session.revision + 1 }) : finish([this.event(session, "session.mode_changed", { mode })], { revision: session.revision + 1 });
    this.invalidateApprovals(session.id);
    return result;
  }
  private spawnUser(parent: Session, kind: "agent" | "side", title: string | undefined, finish: WorkspaceFinish): CommandResult {
    if (parent.status === "archived") throw new MoguriError("archived", "Restore this source session before spawning linked work.");
    if (kind === "agent" && (parent.kind !== "agent" || parent.mode !== "agent" || parent.pendingMode === "read-only")) throw new MoguriError("question_only", "Read-only context cannot spawn a writable child. Switch the agent session at a safe steer first.");
    let ancestor: Session | undefined = parent;
    let depth = 0;
    while (ancestor) { if (++depth >= 8) throw new MoguriError("session_depth", "Nested sessions are bounded to eight levels."); ancestor = ancestor.parentSessionId ? this.session(ancestor.parentSessionId) : undefined; }
    const id = randomUUID();
    return finish([{ event_type: "session.created", profile_id: PROFILE_ID, project_id: parent.projectId, session_id: id, payload: {
      title: title?.trim() || (kind === "side" ? "Side chat" : "Subsession"), controls: { ...parent.controls, autonomy: "Manual" },
      parentSessionId: parent.id, kind, mode: kind === "side" ? "read-only" : "agent", contextDigest: this.store.putBlob(JSON.stringify(this.context(parent.id))),
      inheritedImages: contextHasImages(this.context(parent.id)),
      workspaceId: parent.workspaceId,
      prUrl: parent.prUrl, workItemId: parent.workItemId,
    } }], { id });
  }
  private descendants(id: string): Session[] {
    const values = [this.session(id)];
    for (let index = 0; index < values.length; index++) {
      for (const child of this.projection.sessions.filter((session) => session.parentSessionId === values[index]!.id)) if (!values.some((entry) => entry.id === child.id)) values.push(child);
    }
    return values;
  }
  private async settleOwned(id: string): Promise<void> {
    const sessions = this.descendants(id);
    this.stop(id);
    for (const session of sessions) {
      await this.platform.settleSession(session.id);
      await this.platform.sessions.terminals.closeSession(session.id);
    }
    const deadline = Date.now() + 6500;
    const active = () => sessions.some((session) => this.runs.has(session.id) || this.externalRuns.has(session.id)) ||
      this.projection.executions.some((execution) => sessions.some((session) => session.id === execution.sessionId) && this.remote.owns(execution.id));
    while (active() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    if (sessions.some((session) => this.runs.has(session.id) || this.externalRuns.has(session.id))) throw new MoguriError("cleanup_unconfirmed", "Owned work has not settled. Nothing was deleted; inspect processes first.", 409);
    if (this.projection.terminals.some((terminal) => sessions.some((session) => session.id === terminal.sessionId) && terminal.status === "unconfirmed")) throw new MoguriError("cleanup_unconfirmed", "A previous terminal has unconfirmed cleanup. Inspect and acknowledge it before deletion.", 409);
    if (this.projection.executions.some((execution) => sessions.some((session) => session.id === execution.sessionId) && !["owned-worker-stopped", "acknowledged"].includes(execution.cleanup))) throw new MoguriError("remote_cleanup", "Reconcile or explicitly acknowledge inspection of owned remote execution before deletion. SSH exit is not cleanup proof.", 409);
    for (const session of sessions) {
      const inspected = this.history.findLast((event) => event.event_type === "session.resumed" && (session.projectId ? this.projection.sessions.find((value) => value.id === event.session_id)?.projectId === session.projectId && this.projection.sessions.find((value) => value.id === event.session_id)?.workspaceId === session.workspaceId : event.session_id === session.id))?.seq ?? 0;
      const uncertainTool = this.history.findLast((event) => event.session_id === session.id && event.event_type === "tool.completed" && ["partial", "unconfirmed"].includes(event.payload.outcome))?.seq ?? 0;
      const processes = this.session(session.id).processes.filter((process) => ["running", "unconfirmed"].includes(process.outcome));
      const uncertainProcess = Math.max(0, ...processes.map((process) => this.history.findLast((event) => event.session_id === session.id && event.turn_id === process.turnId && ["process.started", "turn.finished"].includes(event.event_type))?.seq ?? 0));
      if (Math.max(uncertainTool, uncertainProcess) > inspected) throw new MoguriError("cleanup_unconfirmed", "Owned tool/process effects remain unconfirmed. Inspect them and explicitly Resume after inspection before forgetting this session.", 409);
    }
  }
  private async deleteSession(session: Session, finish: WorkspaceFinish): Promise<CommandResult> {
    if (this.deletingSessions.has(session.id)) throw new MoguriError("session_busy", "This session is already being removed.", 409);
    const owned = this.descendants(session.id).map((session) => session.id);
    for (const id of owned) this.deletingSessions.add(id);
    try {
      await this.settleOwned(session.id);
      const current = this.session(session.id);
      for (const execution of this.projection.executions.filter((value) => value.sessionId === session.id)) await this.remote.forget(execution);
      const detach = this.projection.sessions.filter((child) => child.parentSessionId === session.id).map((child) => this.event(child, "session.organized", { changes: { parentSessionId: null } }));
      const result = finish([...detach, { event_type: "session.deleted", profile_id: PROFILE_ID, project_id: session.projectId, payload: { deletedSessionId: session.id, usage: current.usage } }], { id: session.id }, { sessions: [session.id] });
      this.paused.delete(session.id); return result;
    } finally { for (const id of owned) this.deletingSessions.delete(id); }
  }
  private async removeProject(id: string, finish: WorkspaceFinish, choice?: ProjectArtifactChoice): Promise<CommandResult> {
    if (this.projection.managedWorkspaces.some((workspace) => workspace.projectId === id && workspace.status !== "removed")) throw new MoguriError("managed_workspaces", "Remove each clean owned worktree explicitly before removing the project. Its filesystem/branch was not silently deleted.", 409);
    if (this.deletingProjects.has(id)) throw new MoguriError("project_busy", "This project is already being removed.", 409);
    await this.platform.artifacts.removal(id, choice);
    this.deletingProjects.add(id);
    try {
      const revision = this.platform.sessions.projects.configuration(id).revision;
      const sessions = this.projection.sessions.filter((session) => session.projectId === id);
      await this.platform.cancelProject(id);
      for (const session of sessions) if (this.projection.sessions.some((current) => current.id === session.id)) await this.settleOwned(session.id);
      for (const execution of this.projection.executions.filter((value) => value.projectId === id)) await this.remote.forget(execution);
      this.revision(this.platform.sessions.projects.configuration(id).revision, revision);
      const usage = [...this.projection.sessions.filter((session) => session.projectId === id).flatMap((session) => session.usage),
        ...this.history.flatMap((event) => event.event_type === "session.deleted" && event.project_id === id ? event.payload.usage : [])];
      const servers = this.history.flatMap((event) => event.event_type === "project.configured" && event.project_id === id ? event.payload.configuration.values.mcpServers : [])
        .filter((server) => server.id.startsWith(`p-${id.slice(0, 8)}-`) && !this.projection.settings.values.mcpServers.some((global) => global.id === server.id));
      const credentials = new Set(servers.map((server) => server.id));
      try {
        const cleared = new Set<string>();
        for (const server of servers) if (server.transport.type === "http" && server.transport.auth === "oauth") {
          const key = this.platform.gateway.oauth.key(server);
          if (!cleared.has(key)) { await this.platform.gateway.oauth.clear(server); cleared.add(key); }
        }
        for (const serverId of credentials) {
          const signal = AbortSignal.timeout(15_000);
          if (await this.platform.gateway.vault.read(serverId, signal) !== null) await this.platform.gateway.vault.remove(serverId, signal);
        }
      } catch (error) {
        console.error("Project credential cleanup was not acknowledged:", error instanceof Error ? error.message : "Unknown secret-backend error");
        throw new MoguriError("project_secrets", "Project credential cleanup is unconfirmed. Unlock the configured secret backend and retry; project records were preserved.", 503);
      }
      const artifacts = await this.platform.artifacts.removal(id, choice);
      return finish([...artifacts.events, { event_type: "project.removed", profile_id: PROFILE_ID, payload: { deletedProjectId: id, usage, ...(choice ? { artifactChoice: choice.action } : {}) } }], { id }, { projects: [id], artifacts: artifacts.forget });
    } finally { this.deletingProjects.delete(id); }
  }
  private subagent(parent: Session, prompt: string): string {
    if (!this.projection.settings.values.subagents.enabled || parent.kind !== "agent" || parent.mode !== "agent" || parent.pendingMode === "read-only") throw new MoguriError("subagents_disabled", "Only explicitly enabled, depth-one read-only subagents are supported.", 409);
    if (this.projection.sessions.filter((session) => session.kind === "subagent" && (session.turnId || session.queue.length)).length >= this.projection.settings.values.subagents.maxParallel) throw new MoguriError("subagent_limit", "The bounded subagent limit is already in use.", 409);
    this.available(parent.controls, true, parent);
    const id = randomUUID();
    const item = { id: randomUUID(), text: prompt, attachments: [], delivery: "queue" as const };
    this.commit([
      { event_type: "session.created", profile_id: PROFILE_ID, project_id: parent.projectId, session_id: id, payload: { title: `Read-only: ${prompt.slice(0, 60)}`, controls: { ...parent.controls, autonomy: "Manual" }, parentSessionId: parent.id, readOnly: true, workspaceId: parent.workspaceId, inheritedImages: contextHasImages(this.context(parent.id)), contextDigest: this.store.putBlob(JSON.stringify(this.context(parent.id))) } },
      { event_type: "queue.enqueued", profile_id: PROFILE_ID, project_id: parent.projectId, session_id: id, payload: { item } },
    ]);
    queueMicrotask(() => this.pumpAll());
    return id;
  }
  private externalCall(session: Session, call: ToolCall, execute: (signal: AbortSignal) => Promise<unknown>): string {
    if (session.projectId && (this.platform.workspace.isBusy(session.projectId, session.workspaceId) || this.platform.artifacts.isBusy(session.projectId, session.workspaceId))) throw new MoguriError("workspace_busy", "A managed install or artifact publication owns this workspace. Wait for it to settle.", 409);
    if (session.kind !== "agent" || session.mode !== "agent" || session.pendingMode === "read-only") throw new MoguriError("subagent_readonly", "Read-only sessions cannot own external tool calls.", 403);
    if (session.turnId || session.queue.length || session.status === "archived") throw new MoguriError("session_busy", "Use an idle, restored session for an external MCP client. The active agent already owns its turn.", 409);
    if (this.otherWriter(session)) throw new MoguriError("workspace_busy", "Another session owns this workspace. Wait for it to settle before requesting an external MCP call.", 409);
    if (this.blocked(session)) throw new MoguriError("workspace_unconfirmed", "Inspect and explicitly resume this workspace before requesting new external tool work.", 409);
    if (session.controls.env !== "Local" || !this.projection.policy.allowedEnvs.includes("Local") || !this.snapshot().capabilities.find((capability) => capability.env === "Local")?.ready) throw new MoguriError("mcp_env", "A qualified, policy-allowed MCP execution environment is required; no Local fallback.", 403);
    const project = session.projectId ? this.platform.managed.project(session) : undefined;
    const authorization = authorizeTool(this.projection.settings.values, call, project?.path ?? null);
    if (authorization.decision === "deny") throw new MoguriError("tool_denied", authorization.reason, 403);
    const turnId = randomUUID();
    const stepId = randomUUID();
    const jobId = randomUUID();
    const approvalId = randomUUID();
    const scope = { profile_id: PROFILE_ID, project_id: session.projectId, session_id: session.id, turn_id: turnId, step_id: stepId };
    const external: ExternalRun = { sessionId: session.id, turnId, stepId, jobId, call, approvalId, policyRevision: this.projection.policy.revision, permissionRevision: this.projection.settings.permissionRevision, abort: new AbortController(), execute, started: false };
    this.externalRuns.set(session.id, external);
    this.commit([
      { ...scope, event_type: "turn.started", payload: { item: { id: randomUUID(), text: `External MCP request: ${String(call.arguments.serverId)}/${String(call.arguments.tool)}`, attachments: [], delivery: "queue" }, controls: session.controls, policyRevision: this.projection.policy.revision } },
      { ...scope, event_type: "job.started", payload: { job: { id: jobId, kind: "mcp.call", sessionId: session.id, projectId: session.projectId, workspaceId: session.workspaceId, parentTurnId: turnId, status: "waiting_input", progress: "Exact external-tool approval required", resultDigest: null, error: null } } },
      { ...scope, event_type: "tool.requested", payload: { approval: { id: approvalId, stepId, call, policyRevision: external.policyRevision, permissionRevision: external.permissionRevision } } },
    ]);
    return jobId;
  }
  private executeExternal(external: ExternalRun): void {
    external.started = true;
    const session = this.session(external.sessionId);
    this.commit([this.event(session, "tool.started", { call: external.call }, external.stepId), this.event(session, "job.progress", { jobId: external.jobId, progress: "Running approved MCP tool", status: "running" }, external.stepId)]);
    void external.execute(external.abort.signal).then((result) => {
      if (external.abort.signal.aborted || !this.externalRuns.has(external.sessionId)) return;
      const failed = result !== null && typeof result === "object" && "isError" in result && result.isError === true;
      this.finishExternal(external, failed ? "failed" : "completed", failed ? "The MCP tool returned an error result." : null, result);
    }).catch((error: unknown) => {
      if (!this.externalRuns.has(external.sessionId)) return;
      this.finishExternal(external, "partial", error instanceof MoguriError ? error.message : "External MCP result/effects are unconfirmed; no automatic retry.");
    });
  }
  private finishExternal(external: ExternalRun, outcome: "completed" | "stopped" | "failed" | "partial", diagnostic: string | null, result?: unknown): void {
    if (!this.externalRuns.has(external.sessionId)) return;
    this.externalRuns.delete(external.sessionId);
    const session = this.session(external.sessionId);
    const text = result === undefined ? diagnostic ?? "Tool was not executed." : JSON.stringify(result);
    this.commit([
      this.event(session, "tool.completed", { call: external.call, text: text.slice(0, MAX_TEXT), isError: outcome !== "completed", outcome }, external.stepId),
      this.event(session, "job.finished", { jobId: external.jobId, status: outcome === "stopped" ? "cancelled" : outcome, resultDigest: result === undefined ? null : this.store.putBlob(JSON.stringify(result)), error: diagnostic }, external.stepId),
      this.event(session, "turn.finished", { outcome, diagnostic }, external.stepId),
    ]);
    if (outcome === "partial" || outcome === "failed") this.paused.add(session.id);
    queueMicrotask(() => this.pumpAll());
  }
  private revision(actual: number, expected: number): void {
    if (actual !== expected) throw new MoguriError("revision_conflict", "Another client changed this data. Reload the current version before editing.", 409);
  }
  private async previewContext(session: Session) {
    const project = this.projection.projects.find((project) => project.id === session.projectId);
    const model = this.provider.state.models.find((model) => model.id === session.controls.modelId);
    const messages = this.context(session.id);
    if (session.draft.text || session.draft.attachments.length) messages.push(this.contextItem({ text: session.draft.text, attachments: session.draft.attachments }));
    const settings = this.platform.sessions.projects.values(project?.id);
    const tools = effectiveTools(this.projection.settings.values, session.kind === "subagent", session.pendingMode === "read-only" ? "read-only" : session.mode, folderPolicy(settings), { project: Boolean(project), metachat: session.kind === "metachat", env: session.controls.env });
    const systemPrompt = await this.platform.effectivePrompt(session);
    return { estimatedTokens: estimateModelContext({ systemPrompt, messages, tools }), contextWindow: model ? session.controls.modelOptions?.contextWindow ?? model.contextWindow : null, modelMaximum: model?.contextWindow ?? null, source: "estimated" as const };
  }
  private available(controls: Controls, requireModel = true, session?: Session): void {
    if (session?.workspaceId) {
      if (controls.env !== "Local") throw new MoguriError("workspace_env", "This managed worktree has a Local binding only. No remote or sandbox root was inferred.", 409);
      this.platform.managed.project(session);
    }
    if (!this.projection.policy.allowedEnvs.includes(controls.env)) throw new MoguriError("env_denied", `${controls.env} is excluded by the user-only allowed-env policy.`, 403);
    const capability = this.snapshot().capabilities.find((capability) => capability.env === controls.env);
    if (!capability?.ready) throw new MoguriError("env_unavailable", capability?.reason ?? "Execution environment unavailable.", 409);
    if (controls.autonomy === "Autopilot Max") throw new MoguriError("autonomy_unavailable", "Autopilot Max requires an evaluated decision provider. It cannot silently self-approve.", 409);
    if (controls.autonomy === "Autopilot" && !this.projection.settings.values.permissions.tools.some((rule) => rule.decision === "allow") && !this.projection.settings.values.permissions.commands.some((rule) => rule.decision === "allow")) throw new MoguriError("delegation_required", "Configure explicit bounded tool or exact-command delegations before selecting Autopilot.", 409);
    if (controls.budget.kind !== "unlimited") throw new MoguriError("budget_unavailable", "Finite budgets are not enforceable in this checkpoint. No cap has been applied.", 409);
    if (requireModel && session && session.kind === "agent" && session.mode === "agent" && this.projection.executions.some((execution) => (session.projectId ? execution.projectId === session.projectId : execution.sessionId === session.id) && this.runs.get(execution.sessionId)?.executionId !== execution.id && !["owned-worker-stopped", "acknowledged"].includes(execution.cleanup))) throw new MoguriError("remote_cleanup", "Owned remote cleanup is still pending/unconfirmed. Wait for its terminal status, reconcile it, or explicitly acknowledge actual process inspection before new work.", 409);
    if (controls.env === "Remote") {
      this.remote.assertReady();
      if (session) this.remoteWorkspace(session);
    }
    const model = this.provider.state.models.find((model) => model.id === controls.modelId);
    if (requireModel && !model || controls.modelId !== null && !model) {
      throw new MoguriError("model_unavailable", "Connect Copilot or configure a local endpoint, then explicitly select an available model. No provider was substituted.", 409);
    }
    if (model?.environments && !model.environments.includes(controls.env)) throw new MoguriError("model_env", "This model has not been discovered/approved in the selected environment. No endpoint or execution location was substituted.", 409);
    validateModelOptions(model, controls.modelOptions);
  }
  private attachments(session: Session, attachments: Session["draft"]["attachments"]): void {
    if (!session.projectId && attachments.some((attachment) => attachment.kind === "project_file")) throw new MoguriError("project_required", "Project-free chats cannot reuse workspace attachments.");
    for (const attachment of attachments) {
      const known = this.history.some((event) => event.profile_id === PROFILE_ID && event.session_id === session.id && event.event_type === "draft.saved" &&
        event.payload.attachments.some((item) => JSON.stringify(item) === JSON.stringify(attachment)));
      if (!known || digest(this.store.blob(attachment.digest)) !== attachment.digest) throw new MoguriError("attachment_denied", "Attachment snapshot is not authorized for this session.", 403);
    }
    const maximum = attachments.every((attachment) => attachment.kind === "project_file") ? 512 * 1024 : 12 * 1024 * 1024;
    if (attachments.reduce((bytes, attachment) => bytes + attachment.bytes, 0) > maximum) throw new MoguriError("attachment_limit", `Captured context exceeds its ${maximum / 1024} KiB limit.`);
  }
  private imageModel(session: Session, attachments: Session["draft"]["attachments"]): void {
    const model = this.provider.state.models.find((model) => model.id === session.controls.modelId);
    if (!model?.imageInput && (attachments.some((attachment) => attachment.kind === "image") || contextHasImages(this.context(session.id)))) throw new MoguriError("model_images", "Select an image-capable model before admitting this complete context. The draft/queue was preserved; no image was dropped.", 409);
  }
  dispatch(raw: unknown): Promise<CommandResult> {
    const envelope = parse(CommandSchema, raw);
    const hash = digest(JSON.stringify(envelope.command));
    const pending = this.dispatching.get(envelope.id);
    if (pending) {
      if (pending.digest !== hash) return Promise.reject(new MoguriError("idempotency_conflict", "A command ID was reused with different arguments.", 409));
      return pending.result;
    }
    const result = this.perform(envelope).finally(() => this.dispatching.delete(envelope.id));
    this.dispatching.set(envelope.id, { digest: hash, result });
    return result;
  }
  private async perform(raw: unknown): Promise<CommandResult> {
    if (this.shuttingDown) throw new MoguriError("shutting_down", "Moguri is shutting down. The draft was not sent.", 503);
    const envelope = parse(CommandSchema, raw);
    const commandDigest = digest(JSON.stringify(envelope.command));
    const existing = this.store.receipt(envelope.id, commandDigest);
    if (existing) return existing;
    const command = envelope.command;
    const projectId = "projectId" in command ? command.projectId : "sessionId" in command ? this.projection.sessions.find((session) => session.id === command.sessionId)?.projectId : undefined;
    if (projectId && this.deletingProjects.has(projectId) || "sessionId" in command && typeof command.sessionId === "string" && this.deletingSessions.has(command.sessionId)) throw new MoguriError("workspace_removing", "Owned work is settling for removal. No new mutation was admitted.", 409);
    if (command.type === "project.reorder" && command.projects.some((project) => this.deletingProjects.has(project.projectId))) throw new MoguriError("workspace_removing", "A project is being removed. Reload before reordering.", 409);
    const finish: WorkspaceFinish = (events, result = {}, forget) => {
      if (!forget && events.some((event) => event.project_id && this.deletingProjects.has(event.project_id) || event.session_id && this.deletingSessions.has(event.session_id))) throw new MoguriError("workspace_removing", "This workspace is being removed. No late state was resurrected.", 409);
      this.commit(events, { id: envelope.id, digest: commandDigest, result }, forget);
      return result;
    };
    if (isQuestionCommand(command)) return this.answerQuestion(command, finish);
    if (isPlatformCommand(command)) return this.platform.execute(command, finish);
    switch (command.type) {
      case "project.add": {
        if (!isAbsolute(command.path)) throw new MoguriError("invalid_project", "Use an absolute project directory. Relative paths depend on the client, not the service.");
        const path = await realpath(command.path);
        if (!(await stat(path)).isDirectory()) throw new MoguriError("invalid_project", "A project must be an existing local directory.");
        const existing = this.projection.projects.find((project) => project.path === path);
        if (existing) return finish([], { id: existing.id });
        const project = { id: randomUUID(), name: basename(path), path };
        return finish([{ event_type: "project.added", profile_id: PROFILE_ID, project_id: project.id, payload: { project } }], { id: project.id });
      }
      case "session.create": {
        const projectId = command.projectId ?? null;
        if (projectId !== null) this.projectRequired(projectId);
        const startup = this.startup(projectId, command.overrides);
        if (command.workspaceId) {
          this.platform.managed.project({ projectId, workspaceId: command.workspaceId });
          if (startup.controls.env !== "Local") throw new MoguriError("workspace_env", "Managed worktree sessions need compatible Local controls. No other location was inferred.", 409);
        }
        const id = randomUUID();
        const changeSet = command.workspaceId ? this.projection.changeSets.find((value) => value.workspaceId === command.workspaceId) : undefined;
        return finish([{ event_type: "session.created", profile_id: PROFILE_ID, project_id: projectId, session_id: id, payload: { title: command.title ?? "New session", ...startup, workspaceId: command.workspaceId ?? null, workItemId: changeSet?.issueId ?? null, prUrl: changeSet?.prUrl ?? null } }], { id });
      }
      case "provider.login": {
        if (this.runs.size) throw new MoguriError("provider_busy", "Stop active turns before changing the provider account.", 409);
        this.provider.login();
        return finish([]);
      }
      case "provider.cancel": await this.provider.cancel(); return finish([]);
      case "provider.logout":
        if (this.runs.size) throw new MoguriError("provider_busy", "Stop active turns before signing out.", 409);
        await this.provider.logout();
        return finish([]);
      case "provider.refresh": await this.provider.refresh(); return finish([]);
      case "policy.set": {
        const policy = { revision: this.projection.policy.revision + 1, allowedEnvs: command.allowedEnvs };
        const finishingTurnIds = command.allowedEnvs.includes("Local") ? [] : this.projection.sessions.filter((session) => session.turnId && session.controls.env === "Local").map((session) => session.turnId!);
        const result = finish([{ event_type: "policy.updated", profile_id: PROFILE_ID, payload: { policy, finishingTurnIds } }]);
        this.invalidateApprovals();
        return result;
      }
      default: break;
    }
    const session = this.session(command.sessionId);
    if (session.status === "archived" && command.type !== "session.restore") throw new MoguriError("archived", "Restore this session before editing or resuming it.", 409);
    switch (command.type) {
      case "session.configure":
        if (session.turnId) throw new MoguriError("turn_active", "Stop the current turn before changing its controls.", 409);
        this.revision(session.revision, command.expectedRevision);
        this.available(command.controls, false, session);
        return finish([this.event(session, "session.configured", { controls: command.controls })], { revision: session.revision + 1 });
      case "session.archive": {
        await this.settleOwned(session.id);
        const current = this.session(session.id);
        return finish([...(current.queue.length ? [this.event(current, "queue.held", { messageIds: current.queue.map((item) => item.id) })] : []), this.event(current, "session.archived", {})]);
      }
      case "session.restore":
        if (session.status !== "archived") throw new MoguriError("not_archived", "This session is not archived.", 409);
        return finish([this.event(session, "session.restored", {})]);
      case "session.resume":
        if (session.turnId || (!session.queue.length && !this.blocked(session))) throw new MoguriError("not_resumable", "There is no paused work or failed workspace to resume.", 409);
        if (session.queue.length && session.queue.every((item) => item.delivery === "steer") && !this.blocked(session)) {
          throw new MoguriError("unapplied_steer", "An unapplied steer belongs to its old turn. Explicitly queue it as a new turn or remove it.", 409);
        }
        if (session.queue.some((item) => item.delivery !== "steer")) this.available(session.controls, true, session);
        this.paused.delete(session.id);
        finish([...session.queue.filter((item) => item.held && item.delivery !== "steer").map((item) => this.event(session, "queue.released", { messageId: item.id })), this.event(session, "session.resumed", {})]);
        this.pumpAll();
        return {};
      case "draft.save":
        this.revision(session.draft.revision, command.expectedRevision);
        this.attachments(session, command.attachments);
        return finish([this.event(session, "draft.saved", { text: command.text, attachments: command.attachments })], { revision: session.draft.revision + 1 });
      case "attachment.add": {
        this.revision(session.draft.revision, command.expectedRevision);
        const project = this.platform.managed.project(session);
        const snapshot = await readProjectFile(project.path, command.path);
        const current = this.session(session.id);
        this.revision(current.draft.revision, command.expectedRevision);
        const attachments = current.draft.attachments.filter((attachment) => attachment.path !== snapshot.path);
        if (attachments.length >= 16 || attachments.reduce((sum, item) => sum + item.bytes, snapshot.bytes) > 512 * 1024) throw new MoguriError("attachment_limit", "Use at most 16 project text files and 512 KiB of attached text.");
        const contentDigest = this.store.putBlob(snapshot.text);
        attachments.push({ id: randomUUID(), kind: "project_file", path: snapshot.path, digest: contentDigest, bytes: snapshot.bytes });
        return finish([this.event(current, "draft.saved", { text: current.draft.text, attachments })], { revision: current.draft.revision + 1 });
      }
      case "message.send": {
        this.revision(session.draft.revision, command.expectedRevision);
        if (command.held && command.delivery !== "queue") throw new MoguriError("queue_delivery", "Only an ordinary queued prompt can be held without admission.");
        if (!command.held) {
          this.available(session.controls, true, session);
          this.imageModel(session, session.draft.attachments);
          if (this.blocked(session)) throw new MoguriError("workspace_unconfirmed", "A prior turn failed or has unconfirmed effects. Inspect the workspace, then explicitly Resume after inspection before starting new work.", 409);
        }
        if (!session.draft.text.trim() && !session.draft.attachments.length) throw new MoguriError("empty_message", "Write a prompt or attach a project file first.");
        if (session.queue.length >= 100) throw new MoguriError("queue_limit", "The queue is limited to 100 unclaimed messages.");
        if (command.delivery === "steer" && (!session.turnId || session.status === "stopping")) throw new MoguriError("steer_unavailable", "Steer needs a running turn. Use Queue for the next turn.");
        this.attachments(session, session.draft.attachments);
        const item = { id: randomUUID(), text: session.draft.text, attachments: session.draft.attachments, delivery: command.delivery,
          ...(command.delivery === "steer" ? { targetTurnId: session.turnId! } : {}), ...(command.held ? { held: true } : {}) };
        finish([
          this.event(session, "queue.enqueued", { item }),
          ...(command.delivery === "interrupt" && session.turnId ? [this.event(session, "queue.reordered", { messageIds: [item.id, ...session.queue.map((item) => item.id)] })] : []),
          this.event(session, "draft.saved", { text: "", attachments: [] }),
        ], { id: item.id });
        if (!command.held) this.paused.delete(session.id);
        if (command.delivery === "interrupt" && session.turnId) this.stop(session.id);
        if (!command.held) this.pumpAll();
        return { id: item.id };
      }
      case "queue.edit":
      case "queue.remove":
      case "queue.make-turn":
      case "queue.reorder":
        this.revision(session.queueRevision, command.expectedRevision);
        if (command.type === "queue.reorder") {
          if (new Set(command.messageIds).size !== session.queue.length || command.messageIds.length !== session.queue.length ||
            command.messageIds.some((id) => !session.queue.some((item) => item.id === id))) throw new MoguriError("queue_conflict", "Reorder must contain every unclaimed message exactly once.", 409);
          return finish([this.event(session, "queue.reordered", { messageIds: command.messageIds })]);
        }
        if (!session.queue.some((item) => item.id === command.messageId)) throw new MoguriError("queue_claimed", "This message has already been claimed or removed.", 409);
        if (command.type === "queue.make-turn") {
          if (session.queue.find((item) => item.id === command.messageId)?.delivery !== "steer") throw new MoguriError("not_steer", "Only an unclaimed steer needs conversion to a new queued turn.", 409);
          const result = finish([this.event(session, "queue.delivery_changed", { messageId: command.messageId, delivery: "queue" })]);
          if (!this.paused.has(session.id)) this.pumpAll();
          return result;
        }
        if (command.type === "queue.edit") {
          if (!command.text.trim()) throw new MoguriError("empty_message", "Queued messages cannot be empty.");
          return finish([this.event(session, "queue.edited", { messageId: command.messageId, text: command.text })]);
        }
        return finish([this.event(session, "queue.removed", { messageId: command.messageId })]);
      case "session.stop":
        finish([]);
        this.stop(session.id);
        return {};
      case "approval.respond": {
        const external = this.externalRuns.get(session.id);
        if (external) {
          if (external.started || external.approvalId !== command.approvalId || external.policyRevision !== this.projection.policy.revision || external.permissionRevision !== this.projection.settings.permissionRevision) throw new MoguriError("approval_stale", "This external tool approval expired or changed.", 409);
          finish([this.event(session, "tool.decided", { approvalId: external.approvalId, allow: command.allow, actor: "user" }, external.stepId)]);
          if (!command.allow) this.finishExternal(external, "stopped", "External MCP request denied by the user.");
          else this.executeExternal(external);
          return {};
        }
        const run = this.runs.get(session.id);
        const approval = run?.approval;
        if (!run || !approval || approval.id !== command.approvalId || run.abort.signal.aborted ||
          approval.policyRevision !== this.projection.policy.revision ||
          session.pendingApproval?.permissionRevision !== this.projection.settings.permissionRevision) throw new MoguriError("approval_stale", "This approval expired, was cancelled, or was already answered.", 409);
        validateTool(approval.call);
        const configuration = this.platform.sessions.projects.values(session.projectId);
        const mode = session.pendingMode === "read-only" ? "read-only" : session.mode;
        if (command.allow && !effectiveTools(this.projection.settings.values, session.kind === "subagent", mode, folderPolicy(configuration), { project: session.projectId !== null, metachat: session.kind === "metachat" }).some((tool) => tool.name === approval.call.name)) throw new MoguriError("read_only", "This capability is no longer permitted by session/project policy.", 403);
        run.approval = undefined;
        const events: EventInput[] = [this.event(session, "tool.decided", { approvalId: approval.id, allow: command.allow, actor: "user" }, run.stepId)];
        if (command.allow) events.push(this.event(session, "tool.started", { call: approval.call }, run.stepId));
        finish(events);
        if (command.allow) run.granted.add(approval.call.id);
        this.reply(run, { kind: "reply", requestId: approval.requestId, value: { allow: command.allow, mode, folders: folderPolicy(configuration) } });
        return {};
      }
    }
  }
  private contextItem(item: { text: string; attachments: Session["draft"]["attachments"] }): Message {
    const text = item.text + item.attachments.filter((attachment) => attachment.kind !== "image").map((attachment) => `\n\n<untrusted-attachment kind="${attachment.kind}" name=${JSON.stringify(attachment.path)} sha256="${attachment.digest}">\n${this.store.blob(attachment.digest)}\n</untrusted-attachment>`).join("");
    const images = item.attachments.filter((attachment) => attachment.kind === "image");
    return { role: "user", content: images.length ? [{ type: "text", text }, ...images.map((attachment) => ({ type: "image" as const, data: this.store.blob(attachment.digest), mimeType: attachment.mimeType }))] : text, timestamp: Date.now() };
  }
  private context(sessionId: string): Message[] {
    const messages: Message[] = [];
    for (const event of this.history) if (event.profile_id === PROFILE_ID && event.session_id === sessionId) {
      if (event.event_type === "session.created" && event.payload.contextDigest) {
        const context: unknown = JSON.parse(this.store.blob(event.payload.contextDigest));
        if (Array.isArray(context)) messages.push(...context as Message[]);
      } else if (event.event_type === "turn.started" || event.event_type === "steer.applied") messages.push(this.contextItem(event.payload.item));
      else if (event.event_type === "model.completed") messages.push(assistantMessage(JSON.parse(this.store.blob(event.payload.contextDigest))));
      else if (event.event_type === "tool.completed") messages.push({
        role: "toolResult", toolCallId: event.payload.call.id, toolName: event.payload.call.name,
        content: [{ type: "text", text: event.payload.text }], isError: event.payload.isError, timestamp: Date.parse(event.timestamp),
      });
    }
    return messages;
  }
  private pumpAll(): void {
    if (this.shuttingDown) return;
    for (const session of this.projection.sessions) {
      if (session.projectId && (this.deletingProjects.has(session.projectId) || this.platform.workspace.isBusy(session.projectId, session.workspaceId) || this.platform.artifacts.isBusy(session.projectId, session.workspaceId)) || this.deletingSessions.has(session.id) || session.turnId || !session.queue.some((item) => item.delivery !== "steer" && !item.held) || session.status === "archived" || this.paused.has(session.id) || this.blocked(session)) continue;
      if (session.kind === "subagent" && !this.projection.settings.values.subagents.enabled) {
        const diagnostic = "Optional subagents were disabled. Explicitly enable and resume this child, or cancel it.";
        if (session.lastError !== diagnostic) this.commit([this.event(session, "session.blocked", { diagnostic })]);
        continue;
      }
      if (session.kind === "subagent" && [...this.runs.values()].filter((run) => this.session(run.sessionId).kind === "subagent").length >= this.projection.settings.values.subagents.maxParallel) continue;
      if (session.kind === "agent" && (session.pendingMode ?? session.mode) === "agent" && this.otherWriter(session)) continue;
      const item = session.queue.find((item) => item.delivery !== "steer" && !item.held)!;
      try { this.available(session.controls, true, session); this.imageModel(session, item.attachments); } catch (error) {
        const diagnostic = error instanceof Error ? error.message : "Queued turn admission failed.";
        if (session.lastError !== diagnostic) this.commit([this.event(session, "session.blocked", { diagnostic })]);
        continue;
      }
      const turnId = randomUUID();
      const promptDigest = this.store.putBlob(this.platform.prompt(session));
      this.commit([...(session.pendingMode ? [this.event(session, "session.mode_changed", { mode: session.pendingMode })] : []), { ...this.event(session, "turn.started", { item, controls: session.controls, policyRevision: this.projection.policy.revision, promptDigest }), turn_id: turnId }]);
      const current = this.session(session.id);
      try {
        const context = this.context(current.id); validateContextSize(context);
        const project = current.projectId ? this.platform.managed.project(current) : undefined;
        let execution: RemoteExecution | undefined;
        if (current.controls.env === "Remote") {
          const target = this.remote.assertReady();
          execution = { id: randomUUID(), sessionId: current.id, projectId: current.projectId, turnId, target, workspace: this.remoteWorkspace(current), workerDigest: this.remote.readiness.workerDigest!,
            configDigest: frameDigest(target), createdAt: new Date().toISOString(), status: "launching", cancellation: "none", cleanup: "pending", diagnostic: null, lastSequence: 0, workerPid: null };
          this.commit([{ ...this.event(current, "execution.started", { execution }), turn_id: turnId }]);
        }
        const child = execution ? this.remote.launch(execution, (status) => this.executionStatus(execution!.id, status)) : localWorker(this.workerPath, turnId);
        const run: Run = { sessionId: current.id, turnId, child, executionId: execution?.id, abort: new AbortController(), calls: new Map(), granted: new Set(), inFlight: false, chain: Promise.resolve(), done: false, stderr: "", declaredTools: new Set() };
        this.runs.set(current.id, run);
        child.events.on("stderr", (data) => { run.stderr = (run.stderr + data).slice(-4096); });
        child.events.on("message", (message: unknown, frame) => {
          run.chain = run.chain.then(async () => {
            if (run.done) return;
            const request = parse(WorkerRequestSchema, message);
            if (frame) {
              const execution = this.projection.executions.find((value) => value.id === run.executionId);
              if (!execution || frame.executionId !== execution.id || frameDigest(request) !== frame.digest) throw new MoguriError("remote_frame", "Remote frame does not belong to this exact execution.", 409);
              if (frame.sequence <= execution.lastSequence) {
                const known = this.history.find((event) => event.event_type === "execution.frame_recorded" && event.payload.executionId === execution.id && event.payload.sequence === frame.sequence);
                if (known?.event_type !== "execution.frame_recorded" || known.payload.digest !== frame.digest) throw new MoguriError("remote_frame", "A replay changed an already recorded remote frame.", 409);
                if ("requestId" in request) this.reply(run, { kind: "reply", requestId: request.requestId, ...(request.kind === "model.complete" || request.kind === "tool.complete" || request.kind === "finished" ? { value: { accepted: true } } : { error: "This request was already recorded; authority and side effects are not replayed." }) });
              } else {
                if (frame.sequence !== execution.lastSequence + 1) throw new MoguriError("remote_cursor", "Remote frame sequence has a gap. No operation was replayed.", 409);
                const context = { frame, recorded: false };
                await this.workerFrame.run(context, async () => { await this.workerMessage(run, request); if (!context.recorded) this.commit([]); });
              }
              child.acknowledge?.(frame.sequence);
            } else await this.workerMessage(run, request);
          }).catch((error: unknown) => {
            console.error("Moguri worker protocol failure:", error instanceof MoguriError ? error.code : "worker_error");
            this.finishRun(run, "partial", "Worker protocol failed. Inspect the workspace; cleanup is unconfirmed.");
            run.child.kill("SIGTERM");
          });
        });
        child.events.on("error", (error) => { this.finishRun(run, execution ? "partial" : "failed", execution ? error.message : "Could not start the agent worker. Rebuild Moguri and check the bundled Node runtime."); if (execution) child.kill("SIGTERM"); });
        child.events.on("exit", (code, signal) => {
          void run.chain.then(() => {
            if (!run.done) this.finishRun(run, "partial", `Worker exited unexpectedly (${signal ?? code ?? "unknown"}). Usage and process cleanup are unconfirmed. No operation was retried.`);
          });
        });
        this.reply(run, { kind: "start", root: execution ? execution.workspace : project?.path ?? null, context, readOnly: current.kind === "subagent" });
      } catch {
        this.commit([this.event(current, "turn.finished", { outcome: "failed", diagnostic: "Agent worker launch failed. Rebuild Moguri and retry explicitly." })]);
      }
    }
  }
  private otherWriter(session: Session): boolean {
    if (session.projectId === null) return false;
    if (this.platform.artifacts.isBusy(session.projectId, session.workspaceId)) return true;
    const key = this.platform.managed.leaseKey(session)!;
    return this.projection.sessions.some((other) => other.id !== session.id && this.platform.managed.leaseKey(other) === key && other.turnId && other.kind === "agent" && other.mode === "agent") ||
      Boolean(this.writerReservations.has(key) && this.writerReservations.get(key) !== session.id);
  }
  private async assertCurrentTool(session: Session, call: ToolCall): Promise<void> {
    const current = this.session(session.id);
    const configuration = current.projectId ? this.platform.sessions.projects.configuration(current.projectId) : null;
    const permission = this.projection.settings.permissionRevision;
    const policy = this.projection.policy.revision;
    if (current.controls.env === "Local" && current.projectId) await this.platform.managed.assert(current);
    const root = current.controls.env === "Remote" ? this.remoteWorkspace(current) : current.projectId ? this.platform.managed.project(current).path : null;
    const execution = this.projection.executions.find((value) => value.id === this.runs.get(current.id)?.executionId);
    if (execution && (execution.workspace !== root || execution.configDigest !== frameDigest(this.projection.settings.values.remote))) throw new MoguriError("remote_changed", "Remote workspace/target changed after turn admission. No new effect was authorized in the old worker.", 409);
    await assertSessionTool(current, root, this.platform.sessions.projects.values(current.projectId), call, current.controls.env === "Local");
    if (this.session(current.id).revision !== current.revision || configuration && this.platform.sessions.projects.configuration(configuration.projectId).revision !== configuration.revision ||
      this.projection.settings.permissionRevision !== permission || this.projection.policy.revision !== policy) throw new MoguriError("policy_changed", "Session or project policy changed during authorization. No new effect was admitted.", 409);
  }
  private reply(run: Run, message: ParentMessage): void {
    if (run.child.connected) run.child.send(message, (error) => {
      if (error && !run.done) this.finishRun(run, "partial", "The worker control channel failed. Cleanup is unconfirmed.");
    });
  }
  private cancelledQuestions(session: Session, diagnostic: string): EventInput[] {
    return this.projection.questions.filter((question) => question.sessionId === session.id && question.status === "open").map((question) => ({
      ...this.event(session, "question.cancelled", { questionId: question.id, diagnostic }), turn_id: question.turnId, step_id: question.stepId,
    }));
  }
  private releaseQuestionWaits(sessionId: string): void {
    for (const [id, waiting] of this.questionWaits) if (waiting.run.sessionId === sessionId) {
      this.questionWaits.delete(id);
      this.reply(waiting.run, { kind: "reply", requestId: waiting.requestId, value: { text: "Question cancelled. No user answer or permission was supplied.", isError: true, outcome: "stopped" } });
    }
  }
  private askQuestion(run: Run, request: Extract<WorkerRequest, { kind: "delegate" }>): void {
    const session = this.session(run.sessionId), input = parse(UserQuestionSchema, request.call.arguments);
    if (session.pendingQuestionId || !session.controls.modelId || run.abort.signal.aborted) throw new MoguriError("question_state", "Only one current model question may wait for the actual user.", 409);
    if (!input.question.trim() || Buffer.byteLength(input.question) > 16 * 1024 || !input.allowFreeform && !input.choices.length || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.question) || input.choices.some((choice) => /[\r\n\u0000-\u001f\u007f]/.test(choice))) throw new MoguriError("question_input", "Use a bounded, readable clarification with at least one actual answer path. No question or answer was invented.");
    const question: UserQuestion = { ...input, id: randomUUID(), sessionId: session.id, projectId: session.projectId, workspaceId: session.workspaceId, turnId: run.turnId, stepId: request.stepId, callId: request.call.id, modelId: session.controls.modelId,
      sourceEventId: null, revision: 0, createdAt: new Date().toISOString(), status: "open", answer: null, diagnostic: null };
    this.commit([this.event(session, "question.asked", { question }, request.stepId)]);
    this.questionWaits.set(question.id, { run, requestId: request.requestId });
  }
  private answerQuestion(command: QuestionCommand, finish: WorkspaceFinish): CommandResult {
    const question = this.projection.questions.find((question) => question.id === command.questionId);
    if (!question) throw new MoguriError("question_missing", "Question is missing or outside this profile.", 404);
    this.revision(question.revision, command.expectedRevision);
    const session = this.session(question.sessionId), waiting = this.questionWaits.get(question.id);
    if (question.status !== "open" || session.turnId !== question.turnId || !waiting || waiting.run.done || waiting.run.abort.signal.aborted || this.runs.get(session.id) !== waiting.run || this.deletingProjects.has(session.projectId ?? "") || this.deletingSessions.has(session.id)) throw new MoguriError("question_closed", "This question was answered, cancelled or interrupted. No answer was applied to another turn.", 409);
    if (!command.text.trim() || Buffer.byteLength(command.text) > 32 * 1024 || !question.allowFreeform && !question.choices.includes(command.text)) throw new MoguriError("question_answer", "Choose one exact offered answer, or use non-empty freeform text only when this question permits it.");
    const events: EventInput[] = [this.event(session, "question.answered", { questionId: question.id, answer: { text: command.text, actor: "user", modelId: null, sourceCallId: null, answeredAt: new Date().toISOString() } }, question.stepId)];
    if (command.consumeDraft) {
      if (command.consumeDraft.sessionId !== session.id || session.draft.revision !== command.consumeDraft.expectedRevision || session.draft.text !== command.text) throw new MoguriError("revision_conflict", "The saved draft changed. Your answer/draft was preserved; review the current text before answering.", 409);
      events.push(this.event(session, "draft.saved", { text: "", attachments: session.draft.attachments }));
    }
    const result = finish(events, { id: question.id, revision: question.revision + 1 });
    this.questionWaits.delete(question.id);
    this.reply(waiting.run, { kind: "reply", requestId: waiting.requestId, value: { text: JSON.stringify({ questionId: question.id, answer: command.text, actor: "user", permissionGrant: false }), isError: false, outcome: "completed" } });
    return result;
  }
  private async workerMessage(run: Run, request: WorkerRequest): Promise<void> {
    const session = this.session(run.sessionId);
    if (request.kind === "ack") {
      if (run.abort.signal.aborted) {
        const execution = this.projection.executions.find((value) => value.id === run.executionId);
        this.commit([this.event(session, "turn.stop_acknowledged", {}), ...(execution ? [{ ...this.event(session, "execution.changed", { executionId: execution.id, status: "stopping", cancellation: "acknowledged", cleanup: execution.cleanup, diagnostic: "Owned remote worker acknowledged cancellation." }) }] : [])]);
      }
      return;
    }
    if (request.kind === "finished") {
      this.finishRun(run, request.outcome, request.diagnostic);
      this.reply(run, { kind: "reply", requestId: request.requestId, value: { accepted: true } });
      return;
    }
    if (request.kind === "boundary") {
      if (run.abort.signal.aborted) { this.reply(run, { kind: "reply", requestId: request.requestId, error: "Turn stopping." }); return; }
      try {
        if (run.executionId) {
          const execution = this.projection.executions.find((value) => value.id === run.executionId);
          if (!execution || execution.workspace !== this.remoteWorkspace(session) || execution.configDigest !== frameDigest(this.projection.settings.values.remote)) throw new MoguriError("remote_changed", "The target/workspace changed during this turn. No new model access was sent to the old worker.", 409);
          if (session.controls.modelId && !session.controls.modelId.startsWith("remote.") && !this.projection.settings.values.remote?.allowCopilot) throw new MoguriError("remote_credential", "Explicitly allow scoped Copilot access on this verified host before dispatching it.", 403);
        }
        let before = this.session(run.sessionId);
        if (before.controls.env === "Local" && before.projectId) await this.platform.managed.assert(before);
        if (before.pendingMode === "agent" && before.mode !== "agent") {
          while (this.otherWriter(before)) { run.abort.signal.throwIfAborted(); await new Promise((resolve) => setTimeout(resolve, 30)); before = this.session(run.sessionId); }
          const key = this.platform.managed.leaseKey(before);
          if (key) this.writerReservations.set(key, before.id);
        }
        const prepared = await this.provider.prepare(session.controls.modelId!, run.abort.signal);
        if (run.executionId && !session.controls.modelId!.startsWith("remote.")) await this.remote.verifyCopilot(prepared, run.abort.signal);
        if (run.done || run.abort.signal.aborted) return;
        let current = this.session(run.sessionId);
        const steers = current.queue.filter((item) => item.delivery === "steer" && item.targetTurnId === run.turnId);
        if (current.pendingMode && steers.some((item) => item.mode)) {
          this.commit([this.event(current, "session.mode_changed", { mode: current.pendingMode }, request.stepId)]);
          current = this.session(run.sessionId);
        }
        run.stepId = request.stepId;
        run.inFlight = false;
        run.calls.clear();
        run.granted.clear();
        const project = this.projection.projects.find((project) => project.id === current.projectId);
        const projectSettings = this.platform.sessions.projects.values(project?.id);
        const tools = effectiveTools(this.projection.settings.values, current.kind === "subagent", current.mode, folderPolicy(projectSettings), { project: Boolean(project), metachat: current.kind === "metachat", env: current.controls.env });
        run.declaredTools = new Set(tools.map((tool) => tool.name));
        const started = this.history.find((event) => event.event_type === "turn.started" && event.turn_id === run.turnId);
        const prompt = started?.event_type === "turn.started" && started.payload.promptDigest ? this.store.blob(started.payload.promptDigest) : this.platform.prompt(current);
        run.repositoryContext ??= await this.repositoryContext(current);
        const effectivePrompt = await this.platform.effectivePrompt(current, prompt, run.repositoryContext);
        if (run.done || run.abort.signal.aborted) return;
        const configured = modelRequest(prepared.model, current.controls.modelOptions, {
          systemPrompt: effectivePrompt, messages: [...this.context(current.id), ...steers.map((item) => this.contextItem(item))], tools,
        });
        run.inFlight = true;
        this.commit([
          ...steers.map((item) => this.event(current, "steer.applied", { item }, request.stepId)),
          this.event(current, "turn.prompt_bound", { promptDigest: this.store.putBlob(effectivePrompt) }, request.stepId),
          this.event(current, "model.started", { modelId: current.controls.modelId!, providerId: this.provider.state.models.find((model) => model.id === current.controls.modelId)?.providerId ?? prepared.model.provider, apiModelId: prepared.model.id, source: this.provider.state.models.find((model) => model.id === current.controls.modelId)?.source ?? "copilot", contextWindow: configured.model.contextWindow, contextEstimate: configured.estimatedTokens, ...(configured.thinkingEffort ? { thinkingEffort: configured.thinkingEffort } : {}) }, request.stepId),
        ]);
        this.reply(run, { kind: "reply", requestId: request.requestId, value: { ...prepared, model: configured.model, maxTokens: configured.maxTokens, thinkingEffort: configured.thinkingEffort, steers: steers.map((item) => this.contextItem(item)), systemPrompt: effectivePrompt, tools, mode: current.mode, folders: folderPolicy(projectSettings) } });
      } catch (error) {
        this.reply(run, { kind: "reply", requestId: request.requestId, error: error instanceof MoguriError ? error.message : "Copilot model access failed or context is too large. Reconnect, check the selected model, or start a new session. No fallback was used." });
      } finally { const key = this.platform.managed.leaseKey(session); if (key && this.writerReservations.get(key) === session.id) this.writerReservations.delete(key); }
      return;
    }
    if (request.stepId !== run.stepId) throw new Error("Worker step does not own this turn.");
    if (request.kind === "delta") {
      if (!run.inFlight) throw new Error("Unexpected model delta.");
      this.commit([this.event(session, "assistant.delta", { text: request.text }, request.stepId)]);
      return;
    }
    if (request.kind === "model.complete") {
      if (!run.inFlight) throw new Error("Duplicate model completion.");
      run.inFlight = false;
      const message = assistantMessage(request.message);
      const safeMessage = { ...message, errorMessage: message.errorMessage ? "Provider request failed." : undefined, diagnostics: undefined };
      const calls = toolCalls(message);
      for (const call of calls) run.calls.set(call.id, call);
      const contextDigest = this.store.putBlob(JSON.stringify(safeMessage));
      this.commit([this.event(session, "model.completed", {
        contextDigest,
        message: {
          id: request.stepId, turnId: run.turnId, role: "assistant",
          text: message.content.filter((block) => block.type === "text").map((block) => block.text).join(""),
          reasoning: message.content.filter((block) => block.type === "thinking" && !block.redacted).map((block) => block.type === "thinking" ? block.thinking : "").join(""),
          toolCalls: calls, timestamp: new Date(message.timestamp).toISOString(), outcome: message.stopReason,
        },
        usage: this.modelUsage(session, request),
      }, request.stepId)]);
      this.reply(run, { kind: "reply", requestId: request.requestId, value: { accepted: true } });
      return;
    }
    if (request.kind === "output") {
      if (!run.granted.has(request.callId)) throw new Error("Output does not belong to an approved tool.");
      this.commit([this.event(session, "tool.output", { callId: request.callId, text: request.text }, request.stepId)]);
      return;
    }
    if (request.kind === "process") {
      if (!run.granted.has(request.callId)) throw new Error("Process does not belong to an approved tool.");
      this.commit([this.event(session, "process.started", { callId: request.callId, pid: request.pid, processGroup: request.pid, env: session.controls.env }, request.stepId)]);
      return;
    }
    if (request.kind === "delegate") {
      if (!run.granted.has(request.call.id)) throw new Error("Capability was not approved.");
      const declared = run.calls.get(request.call.id);
      if (!declared || digest(JSON.stringify(declared)) !== digest(JSON.stringify(request.call))) throw new Error("Delegated arguments changed after approval.");
      if (request.call.name === "ask_user") {
        try { this.askQuestion(run, request); }
        catch (error) { this.reply(run, { kind: "reply", requestId: request.requestId, value: { text: error instanceof MoguriError ? error.message : "Question relay failed; no user answer was recorded.", isError: true, outcome: "failed" } }); }
        return;
      }
      if (session.controls.env === "Remote" && (request.call.name === "mcp_gateway" || request.call.name === "memory_search" || request.call.name === "moguri_config" && isRecord(request.call.arguments.proposal) && request.call.arguments.proposal.target === "repo-instructions")) {
        this.reply(run, { kind: "reply", requestId: request.requestId, error: "This capability has no qualified remote workspace transport. No local host operation or repository fallback was used." }); return;
      }
      void this.platform.delegate(session, request.call, run.abort.signal).then((result) => this.reply(run, { kind: "reply", requestId: request.requestId, value: result })).catch((error: unknown) => {
        this.reply(run, { kind: "reply", requestId: request.requestId, value: { text: error instanceof MoguriError ? error.message : "Capability failed; effects and cleanup may be unconfirmed.", isError: true, outcome: run.abort.signal.aborted || request.call.name === "mcp_gateway" ? "partial" : "failed" } });
      });
      return;
    }
    const declared = run.calls.get(request.call.id);
    if (!declared || digest(JSON.stringify(declared)) !== digest(JSON.stringify(request.call))) throw new Error("Tool arguments changed after model completion.");
    if (request.kind === "approval") {
      try {
        if (run.abort.signal.aborted) throw new Error("Turn stopping.");
        if (run.approval) throw new Error("Another tool approval is already pending.");
        validateTool(request.call);
        if (!run.declaredTools.has(request.call.name)) throw new MoguriError("tool_unavailable", "This capability was not enabled or declared for this turn.");
        const project = session.projectId ? this.platform.managed.project(session) : undefined;
        await this.assertCurrentTool(session, request.call);
        const authorization = authorizeTool(this.projection.settings.values, request.call, session.controls.env === "Remote" ? this.remoteWorkspace(session) : project?.path ?? null);
        if (authorization.decision === "deny") throw new MoguriError("tool_denied", authorization.reason, 403);
        const approval = { id: randomUUID(), stepId: request.stepId, call: request.call, policyRevision: this.projection.policy.revision, permissionRevision: this.projection.settings.permissionRevision,
          recommendation: session.controls.autonomy === "Guided" ? session.messages.filter((message) => message.role === "assistant").at(-1)?.text.slice(0, 1200) || "The model supplied no recommendation. A human must decide." : undefined };
        if (authorization.decision === "allow" || request.call.name === "ask_user" || session.kind === "metachat" && request.call.name === "moguri_config") {
          run.granted.add(request.call.id);
          this.commit([this.event(session, "tool.requested", { approval }, request.stepId), this.event(session, "tool.decided", { approvalId: approval.id, allow: true, actor: request.call.name === "ask_user" || session.kind === "metachat" && request.call.name === "moguri_config" ? "policy" : "delegation", ruleId: authorization.ruleId }, request.stepId), this.event(session, "tool.started", { call: request.call }, request.stepId)]);
          this.reply(run, { kind: "reply", requestId: request.requestId, value: { allow: true, mode: session.mode, folders: folderPolicy(this.platform.sessions.projects.values(session.projectId)) } });
          return;
        }
        run.approval = { ...approval, requestId: request.requestId };
        this.commit([this.event(session, "tool.requested", { approval }, request.stepId)]);
      } catch (error) { this.reply(run, { kind: "reply", requestId: request.requestId, error: error instanceof Error ? error.message : "Tool denied." }); }
      return;
    }
    if (request.kind === "tool.complete") {
      run.calls.delete(request.call.id);
      run.granted.delete(request.call.id);
      this.commit([this.event(session, "tool.completed", { call: request.call, text: request.text.slice(0, MAX_TEXT + 4096), isError: request.isError, outcome: request.outcome }, request.stepId)]);
      this.reply(run, { kind: "reply", requestId: request.requestId, value: { accepted: true } });
    }
  }
  private stop(sessionId: string): void {
    for (const session of this.projection.sessions) if (session.parentSessionId === sessionId) this.stop(session.id);
    this.platform.stopSession(sessionId);
    const current = this.session(sessionId);
    if (current.parentSessionId && !current.turnId && current.queue.length) {
      this.commit(current.kind === "subagent" ? [...current.queue.map((item) => this.event(current, "queue.removed", { messageId: item.id })), this.event(current, "turn.finished", { outcome: "stopped", diagnostic: "Owned subagent cancelled before admission. No model request was started." })] :
        [this.event(current, "queue.held", { messageIds: current.queue.map((item) => item.id) })]);
    }
    const external = this.externalRuns.get(sessionId);
    if (external) {
      external.abort.abort();
      this.commit([this.event(this.session(sessionId), "turn.stop_requested", {}), this.event(this.session(sessionId), "turn.stop_acknowledged", {})]);
      this.finishExternal(external, external.started ? "partial" : "stopped", external.started ? "External MCP cancellation requested; remote effects and process cleanup may be unconfirmed." : "Unstarted external MCP request cancelled.");
      return;
    }
    const run = this.runs.get(sessionId);
    if (!run || run.abort.signal.aborted) return;
    this.commit([this.event(this.session(sessionId), "turn.stop_requested", {}), ...this.cancelledQuestions(this.session(sessionId), "Owning turn was stopped. No answer was supplied.")]);
    this.releaseQuestionWaits(sessionId);
    run.abort.abort();
    this.reply(run, { kind: "stop" });
    run.stopTimer = setTimeout(() => {
      if (!run.done) {
        run.child.kill("SIGTERM");
        this.finishRun(run, "partial", "Worker did not confirm cancellation within 5 seconds. Inspect owned processes; cleanup is unconfirmed.");
      }
    }, 5000);
  }
  private finishRun(run: Run, outcome: "completed" | "stopped" | "failed" | "partial", diagnostic: string | null): void {
    if (run.done) return;
    run.done = true;
    clearTimeout(run.stopTimer);
    if (run.abort.signal.aborted && outcome === "completed") { outcome = "stopped"; diagnostic = "Stop was requested before the turn settled."; }
    if (run.inFlight) {
      outcome = outcome === "completed" ? "partial" : outcome;
      diagnostic = `${diagnostic ?? "Turn interrupted."} The in-flight request's final usage is unavailable.`;
    }
    const session = this.session(run.sessionId);
    const execution = this.projection.executions.find((value) => value.id === run.executionId);
    if (run.granted.size) { outcome = "partial"; diagnostic = "A tool was approved but its execution result or cleanup was not confirmed. Inspect the workspace before continuing."; }
    this.commit([
      ...this.cancelledQuestions(session, "Owning turn ended. No pending answer was invented."),
      ...(session.pendingMode ? [
        ...session.queue.filter((item) => item.mode && item.targetTurnId === run.turnId).map((item) => this.event(session, "queue.removed", { messageId: item.id })),
        this.event(session, "session.mode_changed", { mode: session.pendingMode }),
      ] : []),
      ...[...run.calls.values()].map((call) => this.event(session, "tool.completed", {
        call, text: run.granted.has(call.id) ? "Tool execution or cleanup is unconfirmed; no automatic retry." : "Tool was not executed before the turn ended.",
        isError: true, outcome: run.granted.has(call.id) ? "unconfirmed" : "stopped",
      }, run.stepId)),
      this.event(session, "turn.finished", { outcome, diagnostic }, run.stepId),
      ...(execution && !["owned-worker-stopped", "acknowledged"].includes(execution.cleanup) ? [this.event(session, "execution.changed", { executionId: execution.id, status: "unconfirmed", cancellation: execution.cancellation, cleanup: "unconfirmed", diagnostic: "Turn settled locally; remote worker/descendant cleanup awaits its actual terminal status or explicit reconciliation." })] : []),
    ]);
    this.runs.delete(run.sessionId);
    this.releaseQuestionWaits(run.sessionId);
    if (outcome === "partial" || outcome === "failed") for (const current of this.projection.sessions) {
      if (session.projectId ? this.platform.managed.leaseKey(current) === this.platform.managed.leaseKey(session) : current.id === session.id) this.paused.add(current.id);
    }
    queueMicrotask(() => this.pumpAll());
  }
  async close(): Promise<void> {
    this.shuttingDown = true;
    await this.provider.close();
    for (const id of this.externalRuns.keys()) this.stop(id);
    for (const id of this.runs.keys()) this.stop(id);
    await this.platform.close();
    const deadline = Date.now() + 6000;
    while (this.runs.size && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    await this.remote.close();
    this.removeAllListeners();
  }
}
export const envelope = (command: CommandEnvelope["command"]): CommandEnvelope => ({ id: randomUUID(), profileId: PROFILE_ID, command });
