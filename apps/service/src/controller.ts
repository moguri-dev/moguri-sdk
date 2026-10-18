import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { basename, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { realpath, stat } from "node:fs/promises";
import type { Message } from "@earendil-works/pi-ai";
import {
  CommandSchema, factoryControls, isPlatformCommand, MAX_TEXT, MoguriError, parse, PROFILE_ID, projectEvents, PROTOCOL_VERSION,
  type CommandEnvelope, type CommandResult, type Controls, type EventInput, type Session, type Snapshot, type StoredEvent, type ToolCall,
} from "../../../packages/protocol/src/index.ts";
import { readProjectFile } from "./files.ts";
import { digest, EventStore } from "./store.ts";
import { CopilotAdapter, type ProviderAdapter } from "./provider.ts";
import { validateTool } from "./tools.ts";
import { effectiveTools } from "./tools.ts";
import { PlatformRuntime, type PlatformOptions } from "./platform.ts";
import { authorizeTool } from "./permissions.ts";
import { assistantMessage, toolCalls, WorkerRequestSchema, type ParentMessage, type WorkerRequest } from "./worker-protocol.ts";

interface Run {
  sessionId: string;
  turnId: string;
  child: ChildProcess;
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
  constructor(readonly store: EventStore, readonly provider: ProviderAdapter = new CopilotAdapter(), private readonly workerPath = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.mjs", import.meta.url)), platformOptions: PlatformOptions & { stateDir?: string } = {}) {
    super();
    this.history = store.events();
    this.projection = projectEvents(this.history);
    this.platform = new PlatformRuntime(store, platformOptions.stateDir ?? dirname(store.path), {
      snapshot: () => this.snapshot(), commit: (events) => this.commit(events),
      invalidateApprovals: () => this.invalidateApprovals(),
      externalCall: (session, call, execute) => this.externalCall(session, call, execute),
      subagent: (session, prompt) => this.subagent(session, prompt),
      stopOwnedSession: (id) => this.stop(id),
      cancelExternalJob: (id) => {
        const external = [...this.externalRuns.values()].find((run) => run.jobId === id);
        if (!external) return false;
        this.stop(external.sessionId); return true;
      },
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
    for (const session of [...this.projection.sessions]) {
      if (session.turnId) {
        const completed = new Set(this.history.filter((event) => event.turn_id === session.turnId && event.event_type === "tool.completed").map((event) => event.event_type === "tool.completed" ? event.payload.call.id : ""));
        const unfinished = this.history.filter((event) => event.turn_id === session.turnId && event.event_type === "model.completed")
          .flatMap((event) => event.event_type === "model.completed" ? event.payload.message.toolCalls ?? [] : []).filter((call) => !completed.has(call.id));
        this.commit([
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
        { env: "Remote", ready: false, reason: "SSH worker transport is not implemented in this checkpoint. No Local fallback." },
      ],
    };
  }
  events(after: number): StoredEvent[] { return this.history.filter((event) => event.seq > after && event.profile_id === PROFILE_ID); }
  private commit(events: EventInput[], receipt?: { id: string; digest: string; result: CommandResult }): void {
    const appended = this.store.commit(events, receipt);
    this.history.push(...appended);
    this.projection = projectEvents(this.history);
    this.emit("change", appended);
  }
  private session(id: string): Session {
    const session = this.projection.sessions.find((session) => session.id === id);
    if (!session) throw new MoguriError("not_found", "Session not found in the active profile.", 404);
    return session;
  }
  private event<K extends EventInput["event_type"]>(session: Session, type: K, payload: Extract<EventInput, { event_type: K }>["payload"], stepId?: string): EventInput {
    return { event_type: type, payload, profile_id: PROFILE_ID, project_id: session.projectId, session_id: session.id, turn_id: session.turnId, step_id: stepId } as EventInput;
  }
  private invalidateApprovals(): void {
    for (const run of this.runs.values()) if (run.approval) {
      const approval = run.approval;
      run.approval = undefined;
      this.commit([this.event(this.session(run.sessionId), "tool.decided", { approvalId: approval.id, allow: false, actor: "policy" }, run.stepId)]);
      this.reply(run, { kind: "reply", requestId: approval.requestId, error: "Policy or permissions changed. Obtain a new exact-argument approval." });
    }
    for (const external of [...this.externalRuns.values()]) if (!external.started) this.finishExternal(external, "stopped", "Permissions changed. The external tool was not executed.");
  }
  private subagent(parent: Session, prompt: string): string {
    if (!this.projection.settings.values.subagents.enabled || parent.readOnly || parent.parentSessionId) throw new MoguriError("subagents_disabled", "Only explicitly enabled, depth-one read-only subagents are supported.", 409);
    if (this.projection.sessions.filter((session) => session.parentSessionId && (session.turnId || session.queue.length)).length >= this.projection.settings.values.subagents.maxParallel) throw new MoguriError("subagent_limit", "The bounded subagent limit is already in use.", 409);
    this.available(parent.controls);
    const id = randomUUID();
    const item = { id: randomUUID(), text: prompt, attachments: [], delivery: "queue" as const };
    this.commit([
      { event_type: "session.created", profile_id: PROFILE_ID, project_id: parent.projectId, session_id: id, payload: { title: `Read-only: ${prompt.slice(0, 60)}`, controls: { ...parent.controls, autonomy: "Manual" }, parentSessionId: parent.id, readOnly: true, contextDigest: this.store.putBlob(JSON.stringify(this.context(parent.id))) } },
      { event_type: "queue.enqueued", profile_id: PROFILE_ID, project_id: parent.projectId, session_id: id, payload: { item } },
    ]);
    queueMicrotask(() => this.pumpAll());
    return id;
  }
  private externalCall(session: Session, call: ToolCall, execute: (signal: AbortSignal) => Promise<unknown>): string {
    if (session.readOnly) throw new MoguriError("subagent_readonly", "Read-only subagents cannot own external tool calls.", 403);
    if (session.turnId || session.queue.length || session.status === "archived") throw new MoguriError("session_busy", "Use an idle, restored session for an external MCP client. The active agent already owns its turn.", 409);
    if (this.projection.sessions.some((owner) => owner.projectId === session.projectId && owner.turnId && !owner.readOnly)) throw new MoguriError("workspace_busy", "Another session owns this workspace. Wait for it to settle before requesting an external MCP call.", 409);
    if (this.projection.blockedProjects.includes(session.projectId)) throw new MoguriError("workspace_unconfirmed", "Inspect and explicitly resume this workspace before requesting new external tool work.", 409);
    if (session.controls.env !== "Local" || !this.projection.policy.allowedEnvs.includes("Local") || !this.snapshot().capabilities.find((capability) => capability.env === "Local")?.ready) throw new MoguriError("mcp_env", "A qualified, policy-allowed MCP execution environment is required; no Local fallback.", 403);
    const project = this.projection.projects.find((project) => project.id === session.projectId)!;
    const authorization = authorizeTool(this.projection.settings.values, call, project.path);
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
      { ...scope, event_type: "job.started", payload: { job: { id: jobId, kind: "mcp.call", sessionId: session.id, projectId: session.projectId, parentTurnId: turnId, status: "waiting_input", progress: "Exact external-tool approval required", resultDigest: null, error: null } } },
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
  private available(controls: Controls): void {
    if (!this.projection.policy.allowedEnvs.includes(controls.env)) throw new MoguriError("env_denied", `${controls.env} is excluded by the user-only allowed-env policy.`, 403);
    const capability = this.snapshot().capabilities.find((capability) => capability.env === controls.env);
    if (!capability?.ready) throw new MoguriError("env_unavailable", capability?.reason ?? "Execution environment unavailable.", 409);
    if (controls.autonomy === "Autopilot Max") throw new MoguriError("autonomy_unavailable", "Autopilot Max requires an evaluated decision provider. It cannot silently self-approve.", 409);
    if (controls.autonomy === "Autopilot" && !this.projection.settings.values.permissions.tools.some((rule) => rule.decision === "allow") && !this.projection.settings.values.permissions.commands.some((rule) => rule.decision === "allow")) throw new MoguriError("delegation_required", "Configure explicit bounded tool or exact-command delegations before selecting Autopilot.", 409);
    if (controls.budget.kind !== "unlimited") throw new MoguriError("budget_unavailable", "Finite budgets are not enforceable in this checkpoint. No cap has been applied.", 409);
    if (!controls.modelId || controls.modelId === "kupo" || !this.provider.state.models.some((model) => model.id === controls.modelId)) {
      throw new MoguriError("model_unavailable", "Sign in to GitHub Copilot and explicitly select an available fixed model.", 409);
    }
  }
  private attachments(session: Session, attachments: Session["draft"]["attachments"]): void {
    for (const attachment of attachments) {
      const known = this.history.some((event) => event.profile_id === PROFILE_ID && event.session_id === session.id && event.event_type === "draft.saved" &&
        event.payload.attachments.some((item) => JSON.stringify(item) === JSON.stringify(attachment)));
      if (!known || digest(this.store.blob(attachment.digest)) !== attachment.digest) throw new MoguriError("attachment_denied", "Attachment snapshot is not authorized for this session.", 403);
    }
    if (attachments.reduce((bytes, attachment) => bytes + attachment.bytes, 0) > 512 * 1024) throw new MoguriError("attachment_limit", "Attached text must fit within 512 KiB.");
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
    const finish = (events: EventInput[], result: CommandResult = {}) => {
      this.commit(events, { id: envelope.id, digest: commandDigest, result });
      return result;
    };
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
        const project = this.projection.projects.find((project) => project.id === command.projectId);
        if (!project) throw new MoguriError("not_found", "Project not found in the active profile.", 404);
        const id = randomUUID();
        return finish([{ event_type: "session.created", profile_id: PROFILE_ID, project_id: project.id, session_id: id, payload: { title: command.title ?? "New session", controls: factoryControls() } }], { id });
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
        this.available(command.controls);
        return finish([this.event(session, "session.configured", { controls: command.controls })], { revision: session.revision + 1 });
      case "session.archive":
        if (session.turnId || session.queue.length) throw new MoguriError("session_busy", "Stop active work and empty the queue before archiving.", 409);
        return finish([this.event(session, "session.archived", {})]);
      case "session.restore":
        if (session.status !== "archived") throw new MoguriError("not_archived", "This session is not archived.", 409);
        return finish([this.event(session, "session.restored", {})]);
      case "session.resume":
        if (session.turnId || (!session.queue.length && !this.projection.blockedProjects.includes(session.projectId))) throw new MoguriError("not_resumable", "There is no paused work or failed workspace to resume.", 409);
        if (session.queue.length && session.queue.every((item) => item.delivery === "steer") && !this.projection.blockedProjects.includes(session.projectId)) {
          throw new MoguriError("unapplied_steer", "An unapplied steer belongs to its old turn. Explicitly queue it as a new turn or remove it.", 409);
        }
        this.available(session.controls);
        this.paused.delete(session.id);
        finish([this.event(session, "session.resumed", {})]);
        this.pumpAll();
        return {};
      case "draft.save":
        this.revision(session.draft.revision, command.expectedRevision);
        this.attachments(session, command.attachments);
        return finish([this.event(session, "draft.saved", { text: command.text, attachments: command.attachments })], { revision: session.draft.revision + 1 });
      case "attachment.add": {
        this.revision(session.draft.revision, command.expectedRevision);
        const project = this.projection.projects.find((project) => project.id === session.projectId)!;
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
        this.available(session.controls);
        if (this.projection.blockedProjects.includes(session.projectId)) throw new MoguriError("workspace_unconfirmed", "A prior turn failed or has unconfirmed effects. Inspect the workspace, then explicitly Resume after inspection before starting new work.", 409);
        if (!session.draft.text.trim() && !session.draft.attachments.length) throw new MoguriError("empty_message", "Write a prompt or attach a project file first.");
        if (session.queue.length >= 100) throw new MoguriError("queue_limit", "The queue is limited to 100 unclaimed messages.");
        if (command.delivery === "steer" && (!session.turnId || session.status === "stopping")) throw new MoguriError("steer_unavailable", "Steer needs a running turn. Use Queue for the next turn.");
        this.attachments(session, session.draft.attachments);
        const item = { id: randomUUID(), text: session.draft.text, attachments: session.draft.attachments, delivery: command.delivery,
          ...(command.delivery === "steer" ? { targetTurnId: session.turnId! } : {}) };
        finish([
          this.event(session, "queue.enqueued", { item }),
          ...(command.delivery === "interrupt" && session.turnId ? [this.event(session, "queue.reordered", { messageIds: [item.id, ...session.queue.map((item) => item.id)] })] : []),
          this.event(session, "draft.saved", { text: "", attachments: [] }),
        ], { id: item.id });
        this.paused.delete(session.id);
        if (command.delivery === "interrupt" && session.turnId) this.stop(session.id);
        this.pumpAll();
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
        run.approval = undefined;
        const events: EventInput[] = [this.event(session, "tool.decided", { approvalId: approval.id, allow: command.allow, actor: "user" }, run.stepId)];
        if (command.allow) events.push(this.event(session, "tool.started", { call: approval.call }, run.stepId));
        finish(events);
        if (command.allow) run.granted.add(approval.call.id);
        this.reply(run, { kind: "reply", requestId: approval.requestId, value: { allow: command.allow } });
        return {};
      }
    }
  }
  private contextItem(item: { text: string; attachments: Session["draft"]["attachments"] }): Message {
    const attached = item.attachments.map((attachment) => `\n\n<attached_project_file path=${JSON.stringify(attachment.path)} sha256="${attachment.digest}">\n${this.store.blob(attachment.digest)}\n</attached_project_file>`).join("");
    return { role: "user", content: item.text + attached, timestamp: Date.now() };
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
      if (session.turnId || !session.queue.some((item) => item.delivery !== "steer") || session.status === "archived" || this.paused.has(session.id) || this.projection.blockedProjects.includes(session.projectId)) continue;
      if (session.readOnly && !this.projection.settings.values.subagents.enabled) {
        const diagnostic = "Optional subagents were disabled. Explicitly enable and resume this child, or cancel it.";
        if (session.lastError !== diagnostic) this.commit([this.event(session, "session.blocked", { diagnostic })]);
        continue;
      }
      if (session.readOnly && [...this.runs.values()].filter((run) => this.session(run.sessionId).readOnly).length >= this.projection.settings.values.subagents.maxParallel) continue;
      if (!session.readOnly && this.projection.sessions.some((owner) => owner.projectId === session.projectId && owner.turnId && !owner.readOnly)) continue;
      try { this.available(session.controls); } catch (error) {
        const diagnostic = error instanceof Error ? error.message : "Queued turn admission failed.";
        if (session.lastError !== diagnostic) this.commit([this.event(session, "session.blocked", { diagnostic })]);
        continue;
      }
      const item = session.queue.find((item) => item.delivery !== "steer")!;
      const turnId = randomUUID();
      const promptDigest = this.store.putBlob(this.platform.prompt(session));
      this.commit([{ ...this.event(session, "turn.started", { item, controls: session.controls, policyRevision: this.projection.policy.revision, promptDigest }), turn_id: turnId }]);
      const current = this.session(session.id);
      try {
        const project = this.projection.projects.find((project) => project.id === current.projectId)!;
        const child = fork(this.workerPath, [], {
          execPath: process.execPath, execArgv: this.workerPath.endsWith(".ts") ? ["--import", "tsx"] : [],
          stdio: ["ignore", "ignore", "pipe", "ipc"],
          env: { PATH: process.env.PATH, HOME: process.env.HOME, MOGURI_TURN_ID: turnId },
        });
        const run: Run = { sessionId: current.id, turnId, child, abort: new AbortController(), calls: new Map(), granted: new Set(), inFlight: false, chain: Promise.resolve(), done: false, stderr: "", declaredTools: new Set() };
        this.runs.set(current.id, run);
        child.stderr?.on("data", (data: Buffer) => { run.stderr = (run.stderr + data.toString()).slice(-4096); });
        child.on("message", (message: unknown) => {
          run.chain = run.chain.then(async () => {
            if (run.done) return;
            const request = parse(WorkerRequestSchema, message);
            await this.workerMessage(run, request);
          }).catch((error: unknown) => {
            console.error("Moguri worker protocol failure:", error instanceof MoguriError ? error.code : "worker_error");
            this.finishRun(run, "partial", "Worker protocol failed. Inspect the workspace; cleanup is unconfirmed.");
            run.child.kill("SIGTERM");
          });
        });
        child.on("error", () => this.finishRun(run, "failed", "Could not start the agent worker. Rebuild Moguri and check the bundled Node runtime."));
        child.on("exit", (code, signal) => {
          void run.chain.then(() => {
            if (!run.done) this.finishRun(run, "partial", `Worker exited unexpectedly (${signal ?? code ?? "unknown"}). Usage and process cleanup are unconfirmed. No operation was retried.`);
          });
        });
        this.reply(run, { kind: "start", root: project.path, context: this.context(current.id), readOnly: current.readOnly ?? false });
      } catch {
        this.commit([this.event(current, "turn.finished", { outcome: "failed", diagnostic: "Agent worker launch failed. Rebuild Moguri and retry explicitly." })]);
      }
    }
  }
  private reply(run: Run, message: ParentMessage): void {
    if (run.child.connected) run.child.send(message, (error) => {
      if (error && !run.done) this.finishRun(run, "partial", "The worker control channel failed. Cleanup is unconfirmed.");
    });
  }
  private async workerMessage(run: Run, request: WorkerRequest): Promise<void> {
    const session = this.session(run.sessionId);
    if (request.kind === "ack") {
      if (run.abort.signal.aborted) this.commit([this.event(session, "turn.stop_acknowledged", {})]);
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
        const prepared = await this.provider.prepare(session.controls.modelId!, run.abort.signal);
        if (run.done || run.abort.signal.aborted) return;
        if (Buffer.byteLength(JSON.stringify(this.context(session.id))) > 1024 * 1024) throw new MoguriError("context_limit", "The conversation exceeds the checkpoint's 1 MiB context limit. Start a new session; existing history is preserved.");
        const current = this.session(run.sessionId);
        const steers = current.queue.filter((item) => item.delivery === "steer" && item.targetTurnId === run.turnId);
        run.stepId = request.stepId;
        run.inFlight = false;
        run.calls.clear();
        run.granted.clear();
        const tools = effectiveTools(this.projection.settings.values, current.readOnly ?? false);
        run.declaredTools = new Set(tools.map((tool) => tool.name));
        const started = this.history.find((event) => event.event_type === "turn.started" && event.turn_id === run.turnId);
        const prompt = started?.event_type === "turn.started" && started.payload.promptDigest ? this.store.blob(started.payload.promptDigest) : this.platform.prompt(current);
        const memory = this.projection.settings.values.memory.enabled && this.projection.settings.values.memory.useInContext ?
          await this.platform.memory.search(this.projection.projects.find((project) => project.id === current.projectId)!, current.messages.filter((message) => message.role === "user").at(-1)?.text ?? "project", 4) : [];
        if (run.done || run.abort.signal.aborted) return;
        run.inFlight = true;
        this.commit([
          ...steers.map((item) => this.event(current, "steer.applied", { item }, request.stepId)),
          this.event(current, "model.started", { modelId: prepared.model.id }, request.stepId),
        ]);
        this.reply(run, { kind: "reply", requestId: request.requestId, value: { ...prepared, steers: steers.map((item) => this.contextItem(item)), systemPrompt: prompt + (memory.length ? `\n<untrusted-repository-memory>\n${JSON.stringify(memory).slice(0, 8000)}\n</untrusted-repository-memory>` : ""), tools } });
      } catch {
        this.reply(run, { kind: "reply", requestId: request.requestId, error: "Copilot model access failed or context is too large. Reconnect, check the selected model, or start a new session. No fallback was used." });
      }
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
        usage: {
          stepId: request.stepId, modelId: message.model, role: session.parentSessionId ? "subagent" : "solver",
          inputTokens: request.usageReported ? message.usage.input : null,
          outputTokens: request.usageReported ? message.usage.output : null,
          cacheReadTokens: request.usageReported ? message.usage.cacheRead : null,
          totalTokens: request.usageReported ? message.usage.totalTokens : null,
          estimatedUsd: null, providerReportedUsd: null, billedUsd: null, requestMs: request.generationMs,
          quality: request.usageReported ? "provider-reported" : "unknown", outcome: message.stopReason,
        },
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
      this.commit([this.event(session, "process.started", { callId: request.callId, pid: request.pid, processGroup: request.pid }, request.stepId)]);
      return;
    }
    if (request.kind === "delegate") {
      if (!run.granted.has(request.call.id)) throw new Error("Capability was not approved.");
      const declared = run.calls.get(request.call.id);
      if (!declared || digest(JSON.stringify(declared)) !== digest(JSON.stringify(request.call))) throw new Error("Delegated arguments changed after approval.");
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
        const project = this.projection.projects.find((project) => project.id === session.projectId)!;
        const authorization = authorizeTool(this.projection.settings.values, request.call, project.path);
        if (authorization.decision === "deny") throw new MoguriError("tool_denied", authorization.reason, 403);
        const approval = { id: randomUUID(), stepId: request.stepId, call: request.call, policyRevision: this.projection.policy.revision, permissionRevision: this.projection.settings.permissionRevision,
          recommendation: session.controls.autonomy === "Guided" ? session.messages.filter((message) => message.role === "assistant").at(-1)?.text.slice(0, 1200) || "The model supplied no recommendation. A human must decide." : undefined };
        if (authorization.decision === "allow") {
          run.granted.add(request.call.id);
          this.commit([this.event(session, "tool.requested", { approval }, request.stepId), this.event(session, "tool.decided", { approvalId: approval.id, allow: true, actor: "delegation", ruleId: authorization.ruleId }, request.stepId), this.event(session, "tool.started", { call: request.call }, request.stepId)]);
          this.reply(run, { kind: "reply", requestId: request.requestId, value: { allow: true } });
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
      this.commit([...current.queue.map((item) => this.event(current, "queue.removed", { messageId: item.id })), this.event(current, "turn.finished", { outcome: "stopped", diagnostic: "Owned subagent cancelled before admission. No model request was started." })]);
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
    this.commit([this.event(this.session(sessionId), "turn.stop_requested", {})]);
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
    if (run.granted.size) { outcome = "partial"; diagnostic = "A tool was approved but its execution result or cleanup was not confirmed. Inspect the workspace before continuing."; }
    this.commit([
      ...[...run.calls.values()].map((call) => this.event(session, "tool.completed", {
        call, text: run.granted.has(call.id) ? "Tool execution or cleanup is unconfirmed; no automatic retry." : "Tool was not executed before the turn ended.",
        isError: true, outcome: run.granted.has(call.id) ? "unconfirmed" : "stopped",
      }, run.stepId)),
      this.event(session, "turn.finished", { outcome, diagnostic }, run.stepId),
    ]);
    this.runs.delete(run.sessionId);
    if (outcome === "partial" || outcome === "failed") for (const current of this.projection.sessions) {
      if (current.projectId === session.projectId) this.paused.add(current.id);
    }
    queueMicrotask(() => this.pumpAll());
  }
  async close(): Promise<void> {
    this.shuttingDown = true;
    await this.provider.cancel();
    for (const id of this.externalRuns.keys()) this.stop(id);
    for (const id of this.runs.keys()) this.stop(id);
    await this.platform.close();
    const deadline = Date.now() + 6000;
    while (this.runs.size && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    this.removeAllListeners();
  }
}
export const envelope = (command: CommandEnvelope["command"]): CommandEnvelope => ({ id: randomUUID(), profileId: PROFILE_ID, command });
