import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { homedir } from "node:os";
import {
  MAX_TEXT, githubItemIdentity, MoguriError, sessionOrderScope, sessionPrScope, sameSessionPrScope, type GithubResponse, type GithubWorkSource, type PullRequestLink, type SessionPrScope, type CommandResult, type EventInput, type Session, type SessionMode, type SessionWorkspaceCommand,
  type SessionWorkspaceQuery, type SessionWorkspaceResponse, type Snapshot, type TerminalInput, type RetainedArtifact, type SessionChildrenReview,
  sessionChildBindings, sessionSubtree,
  type ModelContextPreview, type ResolvedControls, type Project, type ProjectArtifactChoice, type PlanBinding, type TerminalState, type RuntimeCloseOptions,
} from "../../../packages/protocol/src/index.ts";
import type { ForgetRequest } from "./store.ts";
import { readProjectFile, writeProjectFile } from "./files.ts";
import { ProjectService } from "./project-service.ts";
import { assertFolderAccess, assertFolderName, folderPolicy } from "./project-policy.ts";
import { TerminalManager, type TerminalOptions } from "./terminals.ts";
import type { WorkspaceReadQuery, WorkspaceReadResult } from "./remote-protocol.ts";
import { remoteTerminalPeer, terminalBinding } from "./terminal-identity.ts";
import { frameDigest } from "./worker-wire.ts";
import type { RemoteConsoles } from "./remote-terminals.ts";
import { canAutoArchive } from "./session-lifecycle.ts";
import { KeepAwake, type PowerDriver } from "./keep-awake.ts";
import { assertChatHome, captureChatHome } from "./chat-workspace.ts";

export type WorkspaceFinish = ((events: EventInput[], result?: CommandResult, forget?: ForgetRequest) => CommandResult) & { intent?: { id: string; digest: string } };
export interface SessionWorkspaceOptions { terminal?: TerminalOptions; now?: () => number; power?: PowerDriver }
export interface SessionWorkspaceHost {
  snapshot(): Snapshot;
  commit(events: EventInput[], forget?: ForgetRequest): void;
  invalidate(sessionId?: string): void;
  mode(session: Session, mode: SessionMode, finish: WorkspaceFinish): CommandResult;
  spawn(session: Session, kind: "agent" | "side", title: string | undefined, finish: WorkspaceFinish): CommandResult;
  deleteSession(session: Session, finish: WorkspaceFinish, children?: SessionChildrenReview, requireChildReview?: boolean): Promise<CommandResult>;
  removeProject(id: string, finish: WorkspaceFinish, artifacts?: ProjectArtifactChoice): Promise<CommandResult>;
  retainArtifact(session: Session, path: string, text: string): RetainedArtifact;
  job(kind: string, projectId: string, execute: (signal: AbortSignal) => Promise<unknown>): string;
  validateAdmission(session: Session, attachments?: Session["draft"]["attachments"]): void;
  wake(): void;
  verifyPr(scope: SessionPrScope): Promise<PullRequestLink>;
  githubItem?(projectId: string, workspaceId: string | undefined, source: GithubWorkSource): Promise<Extract<GithubResponse, { type: "github.source" }>>;
  contextPreview(session: Session): Promise<ModelContextPreview>;
  startup(projectId: string | null): ResolvedControls;
  project(session: Pick<Session, "projectId" | "workspaceId" | "repositories">, repository?: string): Project;
  rootBusy(projectId: string, workspaceId: string | null): boolean;
  localRootBusy(root: string, ownerSessionId?: string): boolean;
  remoteRead(session: Session, query: WorkspaceReadQuery): Promise<WorkspaceReadResult>;
  nativeRead?(session: Session, query: WorkspaceReadQuery): Promise<WorkspaceReadResult>;
  remotePlanBinding(session: Session): PlanBinding;
  remoteConsoles?: RemoteConsoles;
}
export class SessionWorkspace {
  readonly projects: ProjectService;
  readonly terminals: TerminalManager;
  readonly power: KeepAwake;
  private timer?: ReturnType<typeof setInterval>;
  private powerTimer?: ReturnType<typeof setInterval>;
  private cleaning = false;
  private globalOpening?: Promise<TerminalState>;
  constructor(private readonly host: SessionWorkspaceHost, stateDir: string, private readonly options: SessionWorkspaceOptions = {}) {
    this.projects = new ProjectService(() => host.snapshot(), stateDir);
    this.power = new KeepAwake(() => this.snapshot(), options.power, options.now);
    this.terminals = new TerminalManager({
      snapshot: () => this.snapshot(),
      changed: (terminal) => {
        if (terminal.sessionId !== null && !this.host.snapshot().sessions.some((session) => session.id === terminal.sessionId)) throw new MoguriError("terminal_session_removed", "Terminal state cannot resurrect a removed session.", 409);
        this.host.commit([{ event_type: "terminal.changed", profile_id: this.snapshot().profileId, project_id: terminal.projectId, session_id: terminal.sessionId, payload: { terminal } }]);
      },
      ownerChanged: (owner) => this.host.commit([{ event_type: "terminal.owner_changed", profile_id: this.snapshot().profileId, payload: { owner } }]),
      inputAllowed: (terminal) => this.terminalInputAllowed(terminal),
      remote: host.remoteConsoles,
    }, options.terminal);
  }
  private snapshot() { return this.host.snapshot(); }
  private project(id: string | null) {
    if (id === null) throw new MoguriError("project_required", "Select a project for this workspace capability. No previous root was reused.", 409);
    const project = this.snapshot().projects.find((project) => project.id === id);
    if (!project) throw new MoguriError("project_missing", "Project is outside this profile.", 404);
    return project;
  }
  private session(id: string) {
    const session = this.snapshot().sessions.find((session) => session.id === id);
    if (!session) throw new MoguriError("session_missing", "Session was removed or is outside this profile.", 404);
    return session;
  }
  private revision(actual: number, expected: number) {
    if (actual !== expected) throw new MoguriError("revision_conflict", "Another client changed this value. Your edit is preserved; reload before applying it.", 409);
  }
  private event(session: Session, event: EventInput): EventInput { return { ...event, profile_id: this.snapshot().profileId, project_id: session.projectId, session_id: session.id }; }
  async recover(): Promise<void> {
    await this.terminals.recover();
    this.timer = setInterval(() => { void this.retention().catch((error: unknown) => console.error("Session retention failed:", error instanceof Error ? error.message : "Unknown retention failure")); }, 60_000);
    this.timer.unref();
    this.power.update();
    this.powerTimer = setInterval(() => this.power.update(), 1000);
    this.powerTimer.unref();
  }
  async retention(): Promise<{ deleted: number; archived: number }> {
    const policy = this.snapshot().settings.values.retention;
    if ((!policy.deleteArchived && !policy.archiveCompleted) || this.cleaning) return { deleted: 0, archived: 0 };
    this.cleaning = true;
    let deleted = 0, archived = 0;
    try {
      const now = this.options.now?.() ?? Date.now();
      const newlyArchived = new Set<string>();
      for (const session of this.snapshot().sessions) {
        const snapshot = this.snapshot(), current = snapshot.sessions.find((value) => value.id === session.id);
        if (current && canAutoArchive(snapshot, current, now)) {
          const tree = sessionSubtree(snapshot.sessions, current.id), children = tree.slice(1);
          const disposition = snapshot.settings.values.retention.archiveChildren;
          if ((children.length > 0 && !disposition) || disposition === "detach" && children.some((child) => child.parentSessionId === current.id && child.kind === "subagent")) continue;
          const targets = disposition === "archive" ? tree : [current];
          const detach = disposition === "detach" ? children.filter((child) => child.parentSessionId === current.id)
            .map((child) => this.event(child, { profile_id: snapshot.profileId, event_type: "session.organized", payload: { changes: { parentSessionId: null } } })) : [];
          this.host.commit([...detach, ...targets.flatMap((target) => [
            ...(target.queue.length ? [this.event(target, { profile_id: snapshot.profileId, event_type: "queue.held", payload: { messageIds: target.queue.map((item) => item.id) } })] : []),
            this.event(target, { profile_id: snapshot.profileId, event_type: "session.archived", payload: {} }),
          ])]);
          for (const target of targets) newlyArchived.add(target.id);
          archived += targets.length;
        }
      }
      for (const session of this.snapshot().sessions) {
        const snapshot = this.snapshot(), current = snapshot.sessions.find((value) => value.id === session.id);
        const policy = snapshot.settings.values.retention;
        if (!policy.deleteArchived) break;
        if (!current || newlyArchived.has(current.id) || current.status !== "archived" || !current.archivedAt ||
          Date.parse(current.archivedAt) > now - policy.afterDays * 86400_000) continue;
        const children = sessionSubtree(snapshot.sessions, current.id).slice(1), disposition = policy.deleteChildren;
        if ((children.length > 0 && !disposition) || disposition === "detach" && children.some((child) => child.parentSessionId === current.id && child.kind === "subagent")) continue;
        const review: SessionChildrenReview | undefined = children.length ? {
          action: disposition!, expected: sessionChildBindings(snapshot.sessions, current.id),
        } : undefined;
        await this.host.deleteSession(current, (events, result = {}, forget) => { this.host.commit(events, forget); return result; }, review);
        deleted += 1 + (review?.action === "delete" ? children.length : 0);
      }
      return { deleted, archived };
    } finally { this.cleaning = false; }
  }
  async close(options: RuntimeCloseOptions = {}): Promise<void> {
    clearInterval(this.timer); clearInterval(this.powerTimer);
    await Promise.all([this.power.close(), this.terminals.closeAll(options)]);
  }
  async input(request: TerminalInput): Promise<void> {
    const terminal = this.snapshot().terminals.find((terminal) => terminal.id === request.terminalId);
    if (!terminal) throw new MoguriError("terminal_missing", "Terminal is outside this profile.", 404);
    if (terminal.sessionId !== null) this.session(terminal.sessionId);
    await this.terminals.input(request);
  }
  private localTerminalPolicy(): void {
    if (!this.snapshot().policy.allowedEnvs.includes("Local") || !this.snapshot().capabilities.some((value) => value.env === "Local" && value.ready)) {
      throw new MoguriError("terminal_env", "Local user consoles are blocked by the current execution policy. No Remote or Sandbox fallback was used.", 409);
    }
  }
  private defaultTerminalRoot(): string {
    const root = this.options.terminal?.defaultRoot ?? homedir();
    if (!isAbsolute(root) || /[\0\r\n]/.test(root)) throw new MoguriError("terminal_root", "Configured HOME must be an absolute Local directory. No state-directory or project fallback was used.");
    return root;
  }
  homeRoot() { return captureChatHome(this.defaultTerminalRoot()); }
  private async globalTerminal(root: string, cols: number, rows: number, intent: NonNullable<WorkspaceFinish["intent"]>): Promise<TerminalState> {
    if (!isAbsolute(root)) throw new MoguriError("terminal_root", "Choose an explicit absolute directory for the global Local console.");
    const canonical = await realpath(root);
    const binding = terminalBinding({ profileId: this.snapshot().profileId, sessionId: null, projectId: null, workspaceId: null, root: canonical });
    const recheck = () => {
      this.localTerminalPolicy();
      if (this.host.localRootBusy(canonical)) throw new MoguriError("workspace_busy", "An owned writer holds this exact Local root. No independent terminal was started.", 409);
      if (terminalBinding(binding).digest !== binding.digest) throw new MoguriError("terminal_root_changed", "The chosen global terminal root changed. No replacement or input was replayed.", 409);
    };
    recheck();
    if (this.globalOpening) {
      const existing = await this.globalOpening; recheck();
      if (existing.binding?.digest !== binding.digest) throw new MoguriError("terminal_global_exists", "The global terminal is already starting in another exact root. Inspect it instead of replacing it.", 409);
      return existing;
    }
    const existing = this.snapshot().terminals.find((terminal) => terminal.sessionId === null && !["closed", "failed", "acknowledged"].includes(terminal.status));
    if (existing) {
      if (existing.status !== "running" || existing.binding?.digest !== binding.digest) throw new MoguriError("terminal_global_exists", "Inspect or close the original global terminal before opening another root. No shell was replaced.", 409);
      return existing;
    }
    const work = this.terminals.open(binding, cols, rows, intent, recheck);
    this.globalOpening = work;
    try { return await work; } finally { if (this.globalOpening === work) this.globalOpening = undefined; }
  }
  private terminalContext(sessionId: string, scriptId?: string, explicitRoot?: string, retainedConsole = false) {
    const session = this.session(sessionId), env = session.controls.env;
    if (session.status === "archived") throw new MoguriError("archived", "Restore this session before opening or typing into its terminal.", 409);
    if (!["Local", "Remote"].includes(env) || !this.snapshot().policy.allowedEnvs.includes(env) || !this.snapshot().capabilities.find((capability) => capability.env === env)?.ready) throw new MoguriError("terminal_env", "No qualified terminal transport exists for this environment/policy; no Local fallback.", 409);
    if (env === "Remote" && session.workspaceId !== null) throw new MoguriError("terminal_remote_workspace", "Remote consoles require an explicitly mapped project, not an implicit Local worktree.", 409);
    if (session.repositories && (env !== "Local" || !explicitRoot)) throw new MoguriError("repository_required", "Select an explicit captured repository for this folder's console. HOME and common-parent fallback are forbidden.", 409);
    const repository = session.repositories?.find((repository) => repository.root.root === explicitRoot);
    if (session.repositories && !repository) throw new MoguriError("repository_scope", "This console root is not in the original captured folder set. No other directory was opened.", 409);
    const project = repository ? this.host.project(session, repository.projectId) :
      session.projectId === null ? null : env === "Remote" ? this.project(session.projectId) : this.host.project(session);
    if (!project && (env !== "Local" || !explicitRoot)) throw new MoguriError("project_required", "Select a project, or explicitly choose a Local root for this project-free user console. No previous root was reused.", 409);
    if (!project && explicitRoot && !retainedConsole && this.host.localRootBusy(explicitRoot, session.id)) throw new MoguriError("workspace_busy", "Another or unconfirmed owned writer holds this Local root. Inspect its actual owner before opening an independent console.", 409);
    if (project && explicitRoot !== undefined && !repository) throw new MoguriError("terminal_root", "Project consoles use their bound workspace. An explicit alternate root requires a separate global console.", 409);
    if (project && env === "Local" && this.host.rootBusy(project.id, session.workspaceId)) throw new MoguriError("workspace_busy", "An owned install or artifact publication owns this root. No terminal was started.", 409);
    const configuration = project ? this.projects.configuration(project.id) : null, script = scriptId ? configuration?.values.scripts.find((script) => script.id === scriptId) : undefined;
    if (scriptId && !script) throw new MoguriError("project_script", "Choose an existing explicitly configured project script.", 404);
    const remote = env === "Remote" ? this.host.remoteConsoles?.admission() : undefined, root = env === "Remote" ? configuration?.values.remotePath : project?.path ?? explicitRoot;
    if (env === "Remote" && !remote) throw new MoguriError("terminal_remote_unqualified", "Remote console admission is not wired on this service. No Local broker was selected.", 409);
    if (!root || !root.startsWith("/") || /[\0\r\n]/.test(root)) throw new MoguriError("terminal_root", "Configure this exact execution environment's absolute project root. No previous or Local root was substituted.", 409);
    const scope = { profileId: this.snapshot().profileId, sessionId: session.id, projectId: session.repositories ? null : project?.id ?? null, workspaceId: session.workspaceId, root };
    return { session, project, script, scope, remote, signature: frameDigest([scope, env, configuration?.revision ?? null, this.snapshot().policy.revision, script ?? null, remote ?? null]) };
  }
  private async terminalAdmission(sessionId: string, scriptId?: string, explicitRoot?: string) {
    const session = this.session(sessionId);
    if (explicitRoot === undefined && session.projectId === null && !session.repositories && session.controls.env === "Local") {
      explicitRoot = session.homeRoot ? assertChatHome(session.homeRoot) : this.defaultTerminalRoot();
    }
    if (explicitRoot !== undefined) {
      if (!isAbsolute(explicitRoot)) throw new MoguriError("terminal_root", "Choose an explicit absolute Local console root.");
      explicitRoot = await realpath(explicitRoot);
    }
    const captured = this.terminalContext(sessionId, scriptId, explicitRoot);
    const binding = captured.remote && captured.project ? await this.host.remoteConsoles!.binding({ ...captured.scope, projectId: captured.project.id, workspaceId: null }, captured.remote.boundary, AbortSignal.timeout(10_000)) : terminalBinding(captured.scope);
    this.terminalRecheck(sessionId, scriptId, captured.signature, binding, explicitRoot);
    return { ...captured, binding, explicitRoot };
  }
  private terminalRecheck(sessionId: string, scriptId: string | undefined, signature: string, binding: import("../../../packages/protocol/src/index.ts").TerminalBinding, explicitRoot?: string): void {
    const current = this.terminalContext(sessionId, scriptId, explicitRoot);
    if (current.signature !== signature || binding.env === "Local" && terminalBinding(current.scope).digest !== binding.digest) throw new MoguriError("terminal_scope_changed", "Terminal root/script/authority changed during admission. Original effects remain inspectable; no launch was replayed.", 409);
  }
  private terminalInputAllowed(terminal: TerminalState): void {
    if (terminal.sessionId === null) {
      this.localTerminalPolicy();
      const binding = terminal.binding;
      if (terminal.env !== "Local" || binding?.env !== "Local" || binding.profileId !== this.snapshot().profileId ||
        binding.sessionId !== null || binding.projectId !== null || binding.workspaceId !== null || terminalBinding(binding).digest !== binding.digest) throw new MoguriError("terminal_root_changed", "The global console no longer owns its exact Local null scope and root. No input or replacement was sent.", 409);
      return;
    }
    const session = this.session(terminal.sessionId), binding = terminal.binding;
    if (!binding || terminal.env !== session.controls.env || session.status === "archived" || !this.snapshot().policy.allowedEnvs.includes(binding.env)) throw new MoguriError("terminal_root_changed", "This retained terminal no longer has its original allowed execution environment/policy. No input/resize was sent.", 409);
    if (binding.env === "Local") {
      const current = this.terminalContext(terminal.sessionId, undefined, session.projectId === null ? binding.root : undefined, true);
      if (current.remote || binding.digest !== terminalBinding(current.scope).digest) throw new MoguriError("terminal_root_changed", "The retained Local root changed. No input/resize or replacement was sent.", 409);
    } else {
      const owner = this.snapshot().terminalOwners.find((owner) => owner.id === terminal.ownerId), target = this.snapshot().settings.values.remote;
      const configuration = session.projectId ? this.projects.configuration(session.projectId) : undefined;
      if (!target || !owner?.remote || session.workspaceId !== null || owner.remote.peerDigest !== remoteTerminalPeer(target) || binding.peerDigest !== owner.remote.peerDigest ||
        binding.root !== configuration?.values.remotePath || binding.profileId !== this.snapshot().profileId || binding.projectId !== session.projectId || binding.sessionId !== session.id) {
        throw new MoguriError("terminal_root_changed", "The retained Remote peer/root/build differs from the current mapping. Its endpoint was never inspected as Local; no input or resize was sent.", 409);
      }
    }
  }
  async query(query: SessionWorkspaceQuery): Promise<SessionWorkspaceResponse> {
    switch (query.type) {
      case "project.repositories": return this.projects.repositories(this.project(query.projectId), AbortSignal.timeout(5000));
      case "terminal.default-root": return { type: query.type, root: await realpath(this.defaultTerminalRoot()) };
      case "session.context": return { type: query.type, context: await this.host.contextPreview(this.session(query.sessionId)) };
      case "project.configuration": return { type: query.type, configuration: this.projects.configuration(query.projectId) };
      case "project.sources": return this.projects.sources(this.project(query.projectId));
      case "project.git": return this.projects.gitView(this.project(query.projectId), query.diff, AbortSignal.timeout(30_000));
      case "project.porto": return { type: query.type, output: await this.projects.porto(this.project(query.projectId), AbortSignal.timeout(15_000)) };
      case "plan.read": {
        const session = this.session(query.sessionId);
        if (session.controls.env === "Sandbox") {
          if (!this.host.nativeRead) throw new MoguriError("sandbox_workspace", "This service has no qualified native plan reader. No Local source root was read.", 409);
          const result = await this.host.nativeRead(session, { type: "plan.read" });
          if (result.type !== "plan.read") throw new MoguriError("sandbox_workspace", "Native plan response changed its requested type.", 409);
          return result;
        }
        if (session.controls.env === "Remote") {
          const result = await this.host.remoteRead(session, { type: "plan.read" });
          if (result.type !== "plan.read") throw new MoguriError("remote_workspace_type", "Remote plan response did not match its request.", 409);
          return { ...result, ...this.host.remotePlanBinding(this.session(session.id)) };
        }
        if (session.controls.env !== "Local") throw new MoguriError("plan_env", "Plan workspace transport is not qualified for this environment. No local project was read as a fallback.", 409);
        const project = this.host.project(session);
        const settings = this.projects.configuration(project.id).values;
        const text = await this.projects.optional(project.path, settings.planPath, folderPolicy(settings));
        if (text === null) return { type: query.type, path: settings.planPath, text: "", digest: "absent", exists: false };
        await assertFolderAccess(project.path, settings.planPath, false, folderPolicy(settings));
        const file = await readProjectFile(project.path, settings.planPath);
        return { type: query.type, path: file.path, text: file.text, digest: file.digest, exists: true };
      }
      case "terminal.read": {
        const terminal = this.snapshot().terminals.find((terminal) => terminal.id === query.terminalId);
        if (!terminal) throw new MoguriError("terminal_missing", "Terminal is outside this profile.", 404);
        if (["starting", "reattaching", "unconfirmed", "acknowledged"].includes(terminal.status)) return { type: query.type, terminal, data: "", baseOffset: 0, nextOffset: 0 };
        return { type: query.type, ...await this.terminals.read(query.terminalId, query.offset, query.limit) };
      }
    }
  }
  async execute(command: SessionWorkspaceCommand, finish: WorkspaceFinish): Promise<CommandResult> {
    switch (command.type) {
      case "session.home": case "chat.writer.acknowledge":
        throw new MoguriError("chat_home_authority", "Home binding and original writer inspection require the owning control-plane command path.", 403);
      case "session.reorder": {
        const snapshot = this.snapshot(), ordered = command.sessions.map((entry) => this.session(entry.sessionId));
        const explicit = "projectId" in command, scope = sessionOrderScope(ordered[0]!);
        const siblings = explicit ? snapshot.sessions.filter((session) => session.projectId === command.projectId &&
          (session.parentSessionId ?? null) === command.parentSessionId &&
          (command.parentSessionId !== null || session.groupId === command.groupId) &&
          (command.parentSessionId !== null || command.projectId !== null || (session.projectFolderId ?? null) === (command.projectFolderId ?? null)) &&
          (session.status === "archived") === command.archived) : snapshot.sessions.filter((session) => sessionOrderScope(session) === scope);
        const ids = new Set(ordered.map((session) => session.id));
        if (ids.size !== ordered.length || ids.size !== siblings.length || siblings.some((session) => !ids.has(session.id))) throw new MoguriError("session_order", "Reorder the complete current sibling set within one project, group, parent, pin and archive scope. Reload before trying again.", 409);
        for (const entry of command.sessions) this.revision(this.session(entry.sessionId).revision, entry.revision);
        return finish(ordered.flatMap((session, order) => !explicit && session.order === order ? [] : [this.event(session, { event_type: "session.organized", profile_id: snapshot.profileId, payload: { changes: { order } } })]));
      }
      case "session.organize": {
        const session = this.session(command.sessionId); this.revision(session.revision, command.expectedRevision);
        if (command.changes.title !== undefined && !command.changes.title.trim()) throw new MoguriError("session_title", "A session name cannot be empty.");
        if (command.changes.parentSessionId !== undefined) {
          if (session.turnId || session.kind === "subagent") throw new MoguriError("session_busy", "Stop active work before reparenting. Model-owned subagents cannot be detached into independent authority.");
          if (session.parentSessionId && command.changes.parentSessionId === null &&
            this.snapshot().settings.values.interactions.confirmSessionDetach !== false && !command.confirmDetach) {
            throw new MoguriError("session_detach_confirmation", "Confirm detaching this child session, or change this profile's detach confirmation preference. No hierarchy was changed.", 409);
          }
          let parent = command.changes.parentSessionId;
          const visited = new Set([session.id]);
          while (parent) {
            if (visited.has(parent) || visited.size > 8) throw new MoguriError("session_cycle", "Session attachment must be acyclic and at most eight levels deep.");
            visited.add(parent); const ancestor = this.session(parent);
            if (ancestor.projectId !== session.projectId) throw new MoguriError("session_project", "Attach sessions only within the same project.");
            if (ancestor.kind === "subagent") throw new MoguriError("session_parent", "Model-owned subagents cannot adopt user sessions or change their cancellation ownership.", 409);
            parent = ancestor.parentSessionId ?? null;
          }
          const pending = [{ id: session.id, depth: visited.size - 1 }], descendants = new Set<string>();
          while (pending.length) {
            const next = pending.pop()!;
            if (descendants.has(next.id) || next.depth > 8) throw new MoguriError("session_cycle", "The complete attached subtree must remain acyclic and at most eight levels deep.");
            descendants.add(next.id);
            for (const child of this.snapshot().sessions.filter((child) => child.parentSessionId === next.id)) pending.push({ id: child.id, depth: next.depth + 1 });
          }
        }
        if (command.changes.groupId && !this.snapshot().sessionGroups.some((group) => group.id === command.changes.groupId && group.projectId === session.projectId)) throw new MoguriError("session_group", "Choose a group in this project.");
        if (command.changes.prUrl) {
          const { pullRequestLink } = await import("./project-integrations.ts");
          pullRequestLink(command.changes.prUrl);
        }
        if (command.changes.workItemUrl && githubItemIdentity(command.changes.workItemUrl).kind !== "issue") throw new MoguriError("work_item", "Choose a GitHub issue for the Work item binding.");
        if (command.changes.workItemId && !this.snapshot().issues.some((issue) => issue.id === command.changes.workItemId && issue.projectId === session.projectId)) {
          throw new MoguriError("work_item", "Choose a Kanban card from this session's own project. No cross-project card was linked.", 403);
        }
        return finish([this.event(session, { event_type: "session.organized", profile_id: this.snapshot().profileId, payload: { changes: command.changes } })], { revision: session.revision + 1 });
      }
      case "session.mode": {
        const session = this.session(command.sessionId); this.revision(session.revision, command.expectedRevision);
        return this.host.mode(session, command.mode, finish);
      }
      case "session.spawn": return this.host.spawn(this.session(command.sessionId), command.kind, command.title, finish);
      case "session.side.prompt": throw new MoguriError("side_prompt_authority", "Side prompt admission needs the owning control plane's atomic source/draft transaction. No client-only send was substituted.", 409);
      case "session.side": {
        const parent = this.session(command.sessionId);
        const existing = this.snapshot().sessions.findLast((session) => session.parentSessionId === parent.id && session.createdParentSessionId === parent.id &&
          session.kind === "side" && session.status !== "archived");
        return existing ? finish([], { id: existing.id }) : this.host.spawn(parent, "side", undefined, finish);
      }
      case "session.delete": {
        const session = this.session(command.sessionId); this.revision(session.revision, command.expectedRevision);
        return this.host.deleteSession(session, finish, command.children, true);
      }
      case "session.from-work": {
        const project = this.project(command.projectId);
        if (command.github) {
          if (command.issueId || command.prUrl || !this.host.githubItem) throw new MoguriError("github_source", "Choose one exact reviewed GitHub item, not competing source bindings.");
          const settingsRevision = this.snapshot().settings.revision, configuration = this.projects.configuration(project.id);
          const { expectedDigest, ...sourceInput } = command.github;
          const reviewed = await this.host.githubItem(project.id, command.workspaceId, sourceInput), selected = reviewed.item;
          if (reviewed.digest !== expectedDigest || this.project(project.id).path !== project.path ||
            this.snapshot().settings.revision !== settingsRevision || this.projects.configuration(project.id).revision !== configuration.revision) {
            throw new MoguriError("github_source_stale", "The reviewed item, account settings or project changed. Reload its title/body before starting a session.", 409);
          }
          const source = githubItemIdentity(selected.url ?? ""), startup = this.host.startup(project.id);
          if (command.workspaceId && startup.controls.env !== "Local") throw new MoguriError("workspace_env", "This worktree is Local only. No Remote root was inferred.", 409);
          const text = `Work on ${source.url}\n\n${selected.title}\n\n${selected.body}\n\nThe project checkout has not been changed.`;
          if (Buffer.byteLength(text) > MAX_TEXT) throw new MoguriError("github_source_limit", "The complete issue/PR body exceeds a session draft's limit. Nothing was truncated or submitted.");
          const id = randomUUID();
          return finish([{ event_type: "session.created", profile_id: this.snapshot().profileId, project_id: project.id, session_id: id,
            payload: { title: selected.title.slice(0, 160), ...startup, workspaceId: command.workspaceId ?? null,
              prUrl: source.kind === "pull" ? source.url : null, workItemUrl: source.kind === "issue" ? source.url : null,
              githubSource: { version: 1, source: reviewed.source, accountId: reviewed.accountId, binding: reviewed.binding, digest: reviewed.digest } } },
          { event_type: "draft.saved", profile_id: this.snapshot().profileId, project_id: project.id, session_id: id, payload: { text, attachments: [] } }], { id });
        }
        const issue = command.issueId ? this.snapshot().issues.find((issue) => issue.id === command.issueId && issue.projectId === project.id) : undefined;
        if (command.issueId && !issue) throw new MoguriError("work_item", "This work item does not belong to this project.");
        if (!issue && !command.prUrl) throw new MoguriError("work_item", "Choose an existing work item or explicit PR URL.");
        const { pullRequestLink } = await import("./project-integrations.ts");
        const prUrl = command.prUrl ? pullRequestLink(command.prUrl).url : issue?.pullRequest?.url ?? null;
        if (command.workspaceId) {
          this.host.project({ projectId: project.id, workspaceId: command.workspaceId });
        }
        const owner = { projectId: project.id, workspaceId: command.workspaceId ?? null, prUrl, workItemId: issue?.id ?? null };
        const scope = sessionPrScope(owner, this.snapshot());
        const verified = command.prUrl && scope ? await this.host.verifyPr(scope) : null;
        const latestScope = sessionPrScope(owner, this.snapshot());
        if (verified && (!scope || !latestScope || !sameSessionPrScope(scope, latestScope))) throw new MoguriError("session_pr_stale", "The exact project/root or GitHub access changed during PR verification. No session or stale observation was created.", 409);
        const startup = this.host.startup(project.id);
        if (command.workspaceId && startup.controls.env !== "Local") throw new MoguriError("workspace_env", "This worktree has a Local location only. No default remote root was inferred.", 409);
        const id = randomUUID();
        const events: EventInput[] = [{ event_type: "session.created", profile_id: this.snapshot().profileId, project_id: project.id, session_id: id,
          payload: { title: issue?.title ?? `PR ${prUrl}`, ...startup, workspaceId: command.workspaceId ?? null, prUrl, workItemId: issue?.id ?? null } },
          { event_type: "draft.saved", profile_id: this.snapshot().profileId, project_id: project.id, session_id: id, payload: { text: issue ? `${issue.title}\n\n${issue.body}` : `Work on ${prUrl}. The folder checkout has not been changed.`, attachments: [] } }];
        if (verified && scope) events.push({ event_type: "session.pr_observed", profile_id: this.snapshot().profileId, project_id: project.id, session_id: id,
          payload: { observation: { version: 1, profileId: this.snapshot().profileId, sessionId: id, scope, pullRequest: verified } } });
        return finish(events, { id });
      }
      case "queue.release": {
        const session = this.session(command.sessionId); this.revision(session.queueRevision, command.expectedRevision);
        if (!session.queue.some((item) => item.id === command.messageId && item.held)) throw new MoguriError("queue_claimed", "This held message was removed, released or already claimed.", 409);
        const item = session.queue.find((item) => item.id === command.messageId)!;
        if (!item.command) this.host.validateAdmission(session, item.attachments);
        const result = finish([this.event(session, { event_type: "queue.released", profile_id: this.snapshot().profileId, payload: { messageId: command.messageId } })]);
        this.host.wake(); return result;
      }
      case "project.reorder": {
        const current = this.snapshot().projects.map((project) => this.projects.configuration(project.id)).filter((configuration) => configuration.folderId === command.folderId);
        const ids = new Set(command.projects.map((project) => project.projectId));
        if (ids.size !== command.projects.length || ids.size !== current.length || current.some((project) => !ids.has(project.projectId))) throw new MoguriError("project_order", "Reorder exactly the projects in this folder. Reload after projects are added, removed or moved.", 409);
        const events = command.projects.map((item, order): EventInput => {
          const configuration = current.find((project) => project.projectId === item.projectId)!;
          this.revision(configuration.revision, item.revision);
          return { event_type: "project.configured", profile_id: this.snapshot().profileId, project_id: item.projectId, payload: { configuration: { ...configuration, order, revision: configuration.revision + 1 } } };
        });
        return finish(events);
      }
      case "project.organize":
      case "project.settings":
      case "project.relocate":
      case "project.remove":
      case "project.defaults":
      case "project.mcp.import": {
        const project = this.project(command.projectId); const current = this.projects.configuration(project.id);
        this.revision(current.revision, command.expectedRevision);
        if (command.type === "project.remove") return this.host.removeProject(project.id, finish, command.artifacts);
        if (command.type === "project.defaults") return finish([], { id: this.host.job(command.type, project.id, (signal) => this.projects.defaults(project, command.branch, signal)) });
        if (command.type === "project.relocate") {
          if (this.snapshot().sessions.some((session) => session.repositories?.some((repository) => repository.projectId === project.id) &&
            (session.turnId || this.snapshot().blockedSessions.includes(session.id)))) throw new MoguriError("project_busy", "A folder session still owns this captured root or unconfirmed work. Settle and inspect that exact owner before relocating.", 409);
          if (this.snapshot().managedWorkspaces.some((workspace) => workspace.projectId === project.id && workspace.status !== "removed")) throw new MoguriError("managed_workspaces", "Remove managed worktrees explicitly before relocating their repository/common Git directory.", 409);
          if (this.snapshot().sessions.some((session) => session.projectId === project.id && session.turnId) || this.snapshot().terminals.some((terminal) => terminal.projectId === project.id && !["closed", "failed", "acknowledged"].includes(terminal.status)) || this.snapshot().jobs.some((job) => job.projectId === project.id && ["running", "waiting_input"].includes(job.status)) || this.snapshot().blockedProjects.includes(project.id)) throw new MoguriError("project_busy", "Finish owned work and inspect unconfirmed effects before changing the attached folder.");
          if (!isAbsolute(command.path)) throw new MoguriError("project_path", "Choose an absolute, existing folder.");
          const path = await realpath(command.path);
          if (!(await stat(path)).isDirectory() || this.snapshot().projects.some((other) => other.id !== project.id && other.path === path)) throw new MoguriError("project_path", "The folder is not a distinct project directory.");
          return finish([{ event_type: "project.relocated", profile_id: this.snapshot().profileId, project_id: project.id, payload: { path, name: basename(path) } },
            { event_type: "project.configured", profile_id: this.snapshot().profileId, project_id: project.id, payload: { configuration: { ...current, revision: current.revision + 1 } } }], { revision: current.revision + 1 });
        }
        const updated = structuredClone(current); updated.revision++;
        if (command.type === "project.organize") {
          if (command.folderId && !this.snapshot().projectFolders.some((folder) => folder.id === command.folderId)) throw new MoguriError("project_folder", "Choose an existing project folder.");
          Object.assign(updated, { folderId: command.folderId, color: command.color, order: command.order });
        } else {
          updated.values = command.type === "project.mcp.import" ? await this.projects.importMcp(project, command.expectedDigest) : command.settings;
          this.projects.validate(updated.values, project.id);
          if (updated.values.repo.upstream !== current.values.repo.upstream) {
            const layout = await this.projects.repositories(project, AbortSignal.timeout(5000));
            if (!layout.complete || layout.roots.length !== 1) throw new MoguriError("project_upstream", "An upstream preference requires exactly one verified repository in the attached Local folder. No source root was inferred.", 409);
          }
        }
        const latest = this.projects.configuration(project.id); this.revision(latest.revision, command.expectedRevision);
        const result = finish([{ event_type: "project.configured", profile_id: this.snapshot().profileId, project_id: project.id, payload: { configuration: updated } }], { revision: updated.revision });
        for (const session of this.snapshot().sessions.filter((session) => session.projectId === project.id)) this.host.invalidate(session.id);
        return result;
      }
      case "project.folder":
      case "session.group": {
        const existing = command.id ? (command.type === "project.folder" ? this.snapshot().projectFolders : this.snapshot().sessionGroups).find((entry) => entry.id === command.id) : undefined;
        if (command.id && !existing) throw new MoguriError("group_missing", "This group no longer exists.");
        this.revision(existing?.revision ?? 0, command.expectedRevision);
        if (!command.name.trim()) throw new MoguriError("group_name", "Give this group a non-empty name.");
        const color = command.type === "project.folder" ? command.color ?? existing?.color : existing?.color;
        const group = { id: existing?.id ?? randomUUID(), name: command.name.trim(), order: command.order, revision: existing ? existing.revision + 1 : 0,
          ...(color !== undefined ? { color: color.toLowerCase() } : {}) };
        if (command.type === "project.folder") return finish([{ event_type: "project.folder_saved", profile_id: this.snapshot().profileId, payload: { folder: group } }], { id: group.id, revision: group.revision });
        this.project(command.projectId);
        if (existing && "projectId" in existing && existing.projectId !== command.projectId) throw new MoguriError("session_group", "Session groups cannot cross projects.");
        return finish([{ event_type: "session.group_saved", profile_id: this.snapshot().profileId, project_id: command.projectId, payload: { group: { ...group, projectId: command.projectId } } }], { id: group.id, revision: group.revision });
      }
      case "project.group": {
        if (!command.name.trim()) throw new MoguriError("group_name", "Give this folder a non-empty name.");
        const members = command.projects.map((entry) => {
          this.project(entry.projectId);
          const configuration = this.projects.configuration(entry.projectId);
          this.revision(configuration.revision, entry.revision);
          return configuration;
        });
        if (new Set(members.map((member) => member.projectId)).size !== members.length) throw new MoguriError("project_group", "Group distinct, exact projects. No duplicate member was adopted.");
        const folder = { id: randomUUID(), name: command.name.trim(), order: Math.max(-1, ...this.snapshot().projectFolders.map((folder) => folder.order)) + 1, revision: 0 };
        return finish([{ event_type: "project.folder_saved", profile_id: this.snapshot().profileId, payload: { folder } },
          ...members.map((configuration, order): EventInput => ({ event_type: "project.configured", profile_id: this.snapshot().profileId, project_id: configuration.projectId,
            payload: { configuration: { ...configuration, folderId: folder.id, order, revision: configuration.revision + 1 } } }))], { id: folder.id, revision: 0 });
      }
      case "project.ungroup": {
        const folder = this.snapshot().projectFolders.find((folder) => folder.id === command.folderId);
        if (!folder) throw new MoguriError("group_missing", "This project group no longer exists.", 409);
        this.revision(folder.revision, command.expectedRevision);
        const members = this.snapshot().projects.map((project) => this.projects.configuration(project.id)).filter((configuration) => configuration.folderId === folder.id);
        const expected = new Map(command.projects.map((project) => [project.projectId, project.revision]));
        if (expected.size !== command.projects.length || expected.size !== members.length || members.some((member) => !expected.has(member.projectId))) {
          throw new MoguriError("project_group_changed", "The group's exact members changed. Review the complete group before ungrouping; no subset was moved.", 409);
        }
        for (const member of members) this.revision(member.revision, expected.get(member.projectId)!);
        const result = finish([...members.map((configuration): EventInput => ({ event_type: "project.configured", profile_id: this.snapshot().profileId,
          project_id: configuration.projectId, payload: { configuration: { ...configuration, folderId: null, revision: configuration.revision + 1 } } })),
          { event_type: "project.folder_removed", profile_id: this.snapshot().profileId, payload: { folderId: folder.id, expectedRevision: folder.revision } }],
        { id: folder.id, revision: folder.revision + 1 });
        for (const session of this.snapshot().sessions) if (session.projectId && expected.has(session.projectId)) this.host.invalidate(session.id);
        return result;
      }
      case "session.browser": {
        const session = this.session(command.sessionId);
        let url: URL;
        try { url = new URL(command.url); } catch { throw new MoguriError("browser_url", "Use an explicit HTTP(S) preview URL."); }
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new MoguriError("browser_url", "Only HTTPS or explicit loopback HTTP previews are supported; no credentials or file URLs.");
        return finish([this.event(session, { event_type: "session.browser_changed", profile_id: this.snapshot().profileId, payload: { url: url.href } })], { revision: session.revision + 1 });
      }
      case "plan.save":
      case "artifact.capture": {
        const session = this.session(command.sessionId);
        if (session.controls.env !== "Local") throw new MoguriError("plan_env", "Plan/artifact workspace transport is not qualified for this environment. No local project was read or written as a fallback.", 409);
        const project = this.host.project(session);
        const settings = this.projects.configuration(project.id).values;
        const path = command.type === "artifact.capture" ? command.path ?? settings.planPath : settings.planPath;
        if (command.type === "plan.save") {
          if (this.host.rootBusy(project.id, session.workspaceId)) throw new MoguriError("workspace_busy", "An owned install or artifact publication owns this root. No plan write was started.", 409);
          if (session.mode !== "agent" || session.pendingMode === "read-only" || session.kind === "side" || session.status === "archived") throw new MoguriError("read_only", "This session cannot edit a plan.");
          assertFolderName(path, true, folderPolicy(settings));
          await this.projects.prepareDirectory(project.path, path);
          await assertFolderAccess(project.path, path, true, folderPolicy(settings));
          await writeProjectFile(project.path, path, command.text, command.expectedDigest);
        } else await assertFolderAccess(project.path, path, false, folderPolicy(settings));
        try {
          const file = await readProjectFile(project.path, path); this.session(session.id);
          const artifact = this.host.retainArtifact(session, path, file.text);
          return finish([{ event_type: "artifact.revised", profile_id: this.snapshot().profileId, project_id: project.id, payload: { artifact } }], { id: artifact.id });
        }
        catch (error) {
          if (command.type !== "plan.save") throw error;
          console.error("Plan file was written but independent artifact retention failed:", path);
          throw new MoguriError("plan_partial", "The plan file was written, but its retained snapshot was not committed. Inspect the file before retrying; no complete success was recorded.", 409);
        }
      }
      case "terminal.open": {
        const captured = await this.terminalAdmission(command.sessionId, command.scriptId, command.root);
        if (!finish.intent) throw new MoguriError("terminal_intent", "Terminal launch needs its canonical user command identity. No shell was started.", 409);
        const terminal = await this.terminals.open(captured.binding, command.cols, command.rows, finish.intent, () => {
          this.terminalRecheck(command.sessionId, command.scriptId, captured.signature, captured.binding, captured.explicitRoot);
        }, captured.script, captured.remote);
        return finish([], { id: terminal.id });
      }
      case "terminal.global.open":
      case "terminal.open-global": {
        if (!finish.intent) throw new MoguriError("terminal_intent", "A global launch requires its actual user command identity. No console was started.", 409);
        const terminal = await this.globalTerminal(command.type === "terminal.global.open" ? this.defaultTerminalRoot() : command.root, command.cols, command.rows, finish.intent);
        return finish([], { id: terminal.id });
      }
      case "terminal.reconcile": {
        await this.terminals.reconcile(command.terminalId); return finish([]);
      }
      case "terminal.owner.reconcile": {
        await this.terminals.reconcileOwner(command.ownerId); return finish([]);
      }
      case "terminal.owner.acknowledge": {
        const owner = this.terminals.acknowledgeOwner(command.ownerId);
        return finish([{ event_type: "terminal.owner_changed", profile_id: this.snapshot().profileId, payload: { owner } }]);
      }
      case "terminal.close": {
        const terminal = this.snapshot().terminals.find((terminal) => terminal.id === command.terminalId);
        if (!terminal) throw new MoguriError("terminal_missing", "This terminal is outside the profile.");
        const result = await this.terminals.close(terminal.id);
        if (result.status === "unconfirmed") throw new MoguriError("terminal_unconfirmed", result.diagnostic!, 409);
        return finish([]);
      }
      case "terminal.acknowledge": {
        const terminal = this.snapshot().terminals.find((terminal) => terminal.id === command.terminalId);
        if (!terminal || terminal.status !== "unconfirmed") throw new MoguriError("terminal_state", "Only an unconfirmed terminal needs explicit inspection acknowledgement.");
        this.terminals.acknowledge(terminal.id);
        return finish([{ event_type: "terminal.changed", profile_id: this.snapshot().profileId, project_id: terminal.projectId, session_id: terminal.sessionId,
          payload: { terminal: { ...terminal, status: "acknowledged", diagnostic: "The user acknowledged process inspection. This does not retrospectively prove cleanup." } } }]);
      }
      case "retention.run": {
        if (!this.snapshot().settings.values.retention.deleteArchived && !this.snapshot().settings.values.retention.archiveCompleted) throw new MoguriError("retention_disabled", "Enable automatic completed-session archive or archived-session deletion explicitly first.");
        const result = await this.retention(); return finish([], { revision: result.deleted + result.archived });
      }
    }
  }
}
