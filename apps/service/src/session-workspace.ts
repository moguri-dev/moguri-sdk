import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import {
  MoguriError, PROFILE_ID, type CommandResult, type EventInput, type Session, type SessionMode, type SessionWorkspaceCommand,
  type SessionWorkspaceQuery, type SessionWorkspaceResponse, type Snapshot, type TerminalInput, type RetainedArtifact,
  type ModelContextPreview,
} from "../../../packages/protocol/src/index.ts";
import { EventStore, type ForgetRequest } from "./store.ts";
import { readProjectFile, writeProjectFile } from "./files.ts";
import { ProjectService } from "./project-service.ts";
import { assertFolderAccess, assertFolderName, folderPolicy } from "./project-policy.ts";
import { TerminalManager, type TerminalOptions } from "./terminals.ts";

export type WorkspaceFinish = (events: EventInput[], result?: CommandResult, forget?: ForgetRequest) => CommandResult;
export interface SessionWorkspaceOptions { terminal?: TerminalOptions; now?: () => number }
export interface SessionWorkspaceHost {
  snapshot(): Snapshot;
  commit(events: EventInput[], forget?: ForgetRequest): void;
  invalidate(sessionId?: string): void;
  mode(session: Session, mode: SessionMode, finish: WorkspaceFinish): CommandResult;
  spawn(session: Session, kind: "agent" | "side", title: string | undefined, finish: WorkspaceFinish): CommandResult;
  deleteSession(session: Session, finish: WorkspaceFinish): Promise<CommandResult>;
  removeProject(id: string, finish: WorkspaceFinish): Promise<CommandResult>;
  job(kind: string, projectId: string, execute: (signal: AbortSignal) => Promise<unknown>): string;
  validateAdmission(session: Session): void;
  wake(): void;
  verifyPr(projectId: string, url: string): Promise<void>;
  contextPreview(session: Session): Promise<ModelContextPreview>;
}
export class SessionWorkspace {
  readonly projects: ProjectService;
  readonly terminals: TerminalManager;
  private timer?: ReturnType<typeof setInterval>;
  private cleaning = false;
  constructor(private readonly store: EventStore, private readonly host: SessionWorkspaceHost, stateDir: string, private readonly options: SessionWorkspaceOptions = {}) {
    this.projects = new ProjectService(() => host.snapshot(), stateDir);
    this.terminals = new TerminalManager((terminal) => {
      if (!this.host.snapshot().sessions.some((session) => session.id === terminal.sessionId)) return;
      this.host.commit([{ event_type: "terminal.changed", profile_id: PROFILE_ID, project_id: terminal.projectId, session_id: terminal.sessionId, payload: { terminal } }]);
    }, options.terminal);
  }
  private snapshot() { return this.host.snapshot(); }
  private project(id: string) {
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
  private event(session: Session, event: EventInput): EventInput { return { ...event, profile_id: PROFILE_ID, project_id: session.projectId, session_id: session.id }; }
  recover(): void {
    const events: EventInput[] = this.snapshot().terminals.filter((terminal) => ["running", "stopping"].includes(terminal.status)).map((terminal) => ({
      event_type: "terminal.changed", profile_id: PROFILE_ID, project_id: terminal.projectId, session_id: terminal.sessionId,
      payload: { terminal: { ...terminal, status: "unconfirmed", diagnostic: "Service restarted. This shell was not relaunched, input was not replayed and output was not persisted. Inspect any unconfirmed processes." } },
    }));
    if (events.length) this.host.commit(events);
    this.timer = setInterval(() => { void this.retention().catch((error: unknown) => console.error("Archived-session retention failed:", error instanceof Error ? error.message : "Unknown retention failure")); }, 60_000);
    this.timer.unref();
  }
  async retention(): Promise<{ deleted: number }> {
    const policy = this.snapshot().settings.values.retention;
    if (!policy.deleteArchived || this.cleaning) return { deleted: 0 };
    this.cleaning = true;
    let deleted = 0;
    try {
      const cutoff = (this.options.now?.() ?? Date.now()) - policy.afterDays * 86400_000;
      for (const session of this.snapshot().sessions.filter((session) => session.status === "archived" && session.archivedAt && Date.parse(session.archivedAt) <= cutoff)) {
        if (!this.snapshot().settings.values.retention.deleteArchived) break;
        await this.host.deleteSession(session, (events, result = {}, forget) => { this.host.commit(events, forget); return result; });
        deleted++;
      }
      return { deleted };
    } finally { this.cleaning = false; }
  }
  async close(): Promise<void> { clearInterval(this.timer); await this.terminals.closeAll(); }
  input(request: TerminalInput): void {
    const terminal = this.snapshot().terminals.find((terminal) => terminal.id === request.terminalId);
    if (!terminal) throw new MoguriError("terminal_missing", "Terminal is outside this profile.", 404);
    this.session(terminal.sessionId); this.terminals.input(request);
  }
  async query(query: SessionWorkspaceQuery): Promise<SessionWorkspaceResponse> {
    switch (query.type) {
      case "session.context": return { type: query.type, context: await this.host.contextPreview(this.session(query.sessionId)) };
      case "project.configuration": return { type: query.type, configuration: this.projects.configuration(query.projectId) };
      case "project.sources": return this.projects.sources(this.project(query.projectId));
      case "project.git": return this.projects.gitView(this.project(query.projectId), query.diff, AbortSignal.timeout(30_000));
      case "project.porto": return { type: query.type, output: await this.projects.porto(this.project(query.projectId), AbortSignal.timeout(15_000)) };
      case "plan.read": {
        const session = this.session(query.sessionId); const project = this.project(session.projectId);
        const settings = this.projects.configuration(project.id).values;
        const text = await this.projects.optional(project.path, settings.planPath, folderPolicy(settings));
        if (text === null) return { type: query.type, path: settings.planPath, text: "", digest: "absent", exists: false };
        await assertFolderAccess(project.path, settings.planPath, false, folderPolicy(settings));
        const file = await readProjectFile(project.path, settings.planPath);
        return { type: query.type, path: file.path, text: file.text, digest: file.digest, exists: true };
      }
      case "artifact.read": {
        const artifact = this.snapshot().artifacts.find((artifact) => artifact.id === query.artifactId);
        if (!artifact) throw new MoguriError("artifact_missing", "Artifact is outside this profile.", 404);
        return { type: query.type, text: this.store.blob(artifact.contentDigest), artifact };
      }
      case "terminal.read": {
        const terminal = this.snapshot().terminals.find((terminal) => terminal.id === query.terminalId);
        if (!terminal) throw new MoguriError("terminal_missing", "Terminal is outside this profile.", 404);
        if (["unconfirmed", "acknowledged"].includes(terminal.status)) return { type: query.type, terminal, data: "", baseOffset: 0, nextOffset: 0 };
        return { type: query.type, ...this.terminals.read(query.terminalId, query.offset, query.limit) };
      }
    }
  }
  async execute(command: SessionWorkspaceCommand, finish: WorkspaceFinish): Promise<CommandResult> {
    switch (command.type) {
      case "session.organize": {
        const session = this.session(command.sessionId); this.revision(session.revision, command.expectedRevision);
        if (command.changes.title !== undefined && !command.changes.title.trim()) throw new MoguriError("session_title", "A session name cannot be empty.");
        if (command.changes.parentSessionId !== undefined) {
          if (session.turnId || session.kind === "subagent") throw new MoguriError("session_busy", "Stop active work before reparenting. Model-owned subagents cannot be detached into independent authority.");
          let parent = command.changes.parentSessionId;
          const visited = new Set([session.id]);
          while (parent) {
            if (visited.has(parent) || visited.size > 8) throw new MoguriError("session_cycle", "Session attachment must be acyclic and at most eight levels deep.");
            visited.add(parent); const ancestor = this.session(parent);
            if (ancestor.projectId !== session.projectId) throw new MoguriError("session_project", "Attach sessions only within the same project.");
            parent = ancestor.parentSessionId ?? null;
          }
        }
        if (command.changes.groupId && !this.snapshot().sessionGroups.some((group) => group.id === command.changes.groupId && group.projectId === session.projectId)) throw new MoguriError("session_group", "Choose a group in this project.");
        if (command.changes.prUrl) {
          const { pullRequestLink } = await import("./project-integrations.ts");
          pullRequestLink(command.changes.prUrl);
        }
        return finish([this.event(session, { event_type: "session.organized", profile_id: PROFILE_ID, payload: { changes: command.changes } })], { revision: session.revision + 1 });
      }
      case "session.mode": {
        const session = this.session(command.sessionId); this.revision(session.revision, command.expectedRevision);
        return this.host.mode(session, command.mode, finish);
      }
      case "session.spawn": return this.host.spawn(this.session(command.sessionId), command.kind, command.title, finish);
      case "session.delete": {
        const session = this.session(command.sessionId); this.revision(session.revision, command.expectedRevision);
        return this.host.deleteSession(session, finish);
      }
      case "session.from-work": {
        const project = this.project(command.projectId);
        const issue = command.issueId ? this.snapshot().issues.find((issue) => issue.id === command.issueId && issue.projectId === project.id) : undefined;
        if (command.issueId && !issue) throw new MoguriError("work_item", "This work item does not belong to this project.");
        if (!issue && !command.prUrl) throw new MoguriError("work_item", "Choose an existing work item or explicit PR URL.");
        const { factoryControls } = await import("../../../packages/protocol/src/index.ts");
        const { pullRequestLink } = await import("./project-integrations.ts");
        const prUrl = command.prUrl ? pullRequestLink(command.prUrl).url : issue?.pullRequest?.url ?? null;
        if (command.prUrl) await this.host.verifyPr(project.id, prUrl!);
        const id = randomUUID();
        return finish([{ event_type: "session.created", profile_id: PROFILE_ID, project_id: project.id, session_id: id,
          payload: { title: issue?.title ?? `PR ${prUrl}`, controls: factoryControls(), prUrl, workItemId: issue?.id ?? null } },
          { event_type: "draft.saved", profile_id: PROFILE_ID, project_id: project.id, session_id: id, payload: { text: issue ? `${issue.title}\n\n${issue.body}` : `Work on ${prUrl}. The folder checkout has not been changed.`, attachments: [] } }], { id });
      }
      case "queue.release": {
        const session = this.session(command.sessionId); this.revision(session.queueRevision, command.expectedRevision);
        if (!session.queue.some((item) => item.id === command.messageId && item.held)) throw new MoguriError("queue_claimed", "This held message was removed, released or already claimed.", 409);
        this.host.validateAdmission(session);
        const result = finish([this.event(session, { event_type: "queue.released", profile_id: PROFILE_ID, payload: { messageId: command.messageId } })]);
        this.host.wake(); return result;
      }
      case "project.reorder": {
        const current = this.snapshot().projects.map((project) => this.projects.configuration(project.id)).filter((configuration) => configuration.folderId === command.folderId);
        const ids = new Set(command.projects.map((project) => project.projectId));
        if (ids.size !== command.projects.length || ids.size !== current.length || current.some((project) => !ids.has(project.projectId))) throw new MoguriError("project_order", "Reorder exactly the projects in this folder. Reload after projects are added, removed or moved.", 409);
        const events = command.projects.map((item, order): EventInput => {
          const configuration = current.find((project) => project.projectId === item.projectId)!;
          this.revision(configuration.revision, item.revision);
          return { event_type: "project.configured", profile_id: PROFILE_ID, project_id: item.projectId, payload: { configuration: { ...configuration, order, revision: configuration.revision + 1 } } };
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
        if (command.type === "project.remove") return this.host.removeProject(project.id, finish);
        if (command.type === "project.defaults") return finish([], { id: this.host.job(command.type, project.id, (signal) => this.projects.defaults(project, command.branch, signal)) });
        if (command.type === "project.relocate") {
          if (this.snapshot().sessions.some((session) => session.projectId === project.id && session.turnId) || this.snapshot().terminals.some((terminal) => terminal.projectId === project.id && ["running", "stopping", "unconfirmed"].includes(terminal.status)) || this.snapshot().jobs.some((job) => job.projectId === project.id && ["running", "waiting_input"].includes(job.status)) || this.snapshot().blockedProjects.includes(project.id)) throw new MoguriError("project_busy", "Finish owned work and inspect unconfirmed effects before changing the attached folder.");
          if (!isAbsolute(command.path)) throw new MoguriError("project_path", "Choose an absolute, existing folder.");
          const path = await realpath(command.path);
          if (!(await stat(path)).isDirectory() || this.snapshot().projects.some((other) => other.id !== project.id && other.path === path)) throw new MoguriError("project_path", "The folder is not a distinct project directory.");
          return finish([{ event_type: "project.relocated", profile_id: PROFILE_ID, project_id: project.id, payload: { path, name: basename(path) } },
            { event_type: "project.configured", profile_id: PROFILE_ID, project_id: project.id, payload: { configuration: { ...current, revision: current.revision + 1 } } }], { revision: current.revision + 1 });
        }
        const updated = structuredClone(current); updated.revision++;
        if (command.type === "project.organize") {
          if (command.folderId && !this.snapshot().projectFolders.some((folder) => folder.id === command.folderId)) throw new MoguriError("project_folder", "Choose an existing project folder.");
          Object.assign(updated, { folderId: command.folderId, color: command.color, order: command.order });
        } else {
          updated.values = command.type === "project.mcp.import" ? await this.projects.importMcp(project, command.expectedDigest) : command.settings;
          this.projects.validate(updated.values, project.id);
        }
        const latest = this.projects.configuration(project.id); this.revision(latest.revision, command.expectedRevision);
        const result = finish([{ event_type: "project.configured", profile_id: PROFILE_ID, project_id: project.id, payload: { configuration: updated } }], { revision: updated.revision });
        for (const session of this.snapshot().sessions.filter((session) => session.projectId === project.id)) this.host.invalidate(session.id);
        return result;
      }
      case "project.folder":
      case "session.group": {
        const existing = command.id ? (command.type === "project.folder" ? this.snapshot().projectFolders : this.snapshot().sessionGroups).find((entry) => entry.id === command.id) : undefined;
        if (command.id && !existing) throw new MoguriError("group_missing", "This group no longer exists.");
        this.revision(existing?.revision ?? 0, command.expectedRevision);
        if (!command.name.trim()) throw new MoguriError("group_name", "Give this group a non-empty name.");
        const group = { id: existing?.id ?? randomUUID(), name: command.name.trim(), order: command.order, revision: existing ? existing.revision + 1 : 0 };
        if (command.type === "project.folder") return finish([{ event_type: "project.folder_saved", profile_id: PROFILE_ID, payload: { folder: group } }], { id: group.id, revision: group.revision });
        this.project(command.projectId);
        if (existing && "projectId" in existing && existing.projectId !== command.projectId) throw new MoguriError("session_group", "Session groups cannot cross projects.");
        return finish([{ event_type: "session.group_saved", profile_id: PROFILE_ID, project_id: command.projectId, payload: { group: { ...group, projectId: command.projectId } } }], { id: group.id, revision: group.revision });
      }
      case "session.browser": {
        const session = this.session(command.sessionId);
        let url: URL;
        try { url = new URL(command.url); } catch { throw new MoguriError("browser_url", "Use an explicit HTTP(S) preview URL."); }
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new MoguriError("browser_url", "Only HTTPS or explicit loopback HTTP previews are supported; no credentials or file URLs.");
        return finish([this.event(session, { event_type: "session.browser_changed", profile_id: PROFILE_ID, payload: { url: url.href } })], { revision: session.revision + 1 });
      }
      case "plan.save":
      case "artifact.capture": {
        const session = this.session(command.sessionId); const project = this.project(session.projectId);
        const settings = this.projects.configuration(project.id).values;
        const path = command.type === "artifact.capture" ? command.path ?? settings.planPath : settings.planPath;
        if (command.type === "plan.save") {
          if (session.mode !== "agent" || session.pendingMode === "read-only" || session.kind === "side" || session.status === "archived") throw new MoguriError("read_only", "This session cannot edit a plan.");
          assertFolderName(path, true, folderPolicy(settings));
          await this.projects.prepareDirectory(project.path, path);
          await assertFolderAccess(project.path, path, true, folderPolicy(settings));
          await writeProjectFile(project.path, path, command.text, command.expectedDigest);
        } else await assertFolderAccess(project.path, path, false, folderPolicy(settings));
        const file = await readProjectFile(project.path, path); this.session(session.id);
        const artifact: RetainedArtifact = { id: randomUUID(), projectId: project.id, originSessionId: session.id, name: basename(path), path, contentDigest: this.store.putBlob(file.text), createdAt: new Date().toISOString() };
        return finish([{ event_type: "artifact.saved", profile_id: PROFILE_ID, project_id: project.id, payload: { artifact } }], { id: artifact.id });
      }
      case "terminal.open": {
        const session = this.session(command.sessionId); const project = this.project(session.projectId);
        if (session.status === "archived") throw new MoguriError("archived", "Unarchive this session before opening new owned terminals.");
        if (session.controls.env !== "Local" || !this.snapshot().policy.allowedEnvs.includes("Local") || !this.snapshot().capabilities.find((capability) => capability.env === "Local")?.ready) throw new MoguriError("terminal_env", "No qualified terminal transport exists for this environment; there is no Local fallback.");
        const script = command.scriptId ? this.projects.configuration(project.id).values.scripts.find((script) => script.id === command.scriptId) : undefined;
        if (command.scriptId && !script) throw new MoguriError("script_missing", "Choose a configured user script.");
        const terminal = this.terminals.open({ sessionId: session.id, projectId: project.id, root: project.path }, command.cols, command.rows, script);
        return finish([], { id: terminal.id });
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
        return finish([{ event_type: "terminal.changed", profile_id: PROFILE_ID, project_id: terminal.projectId, session_id: terminal.sessionId,
          payload: { terminal: { ...terminal, status: "acknowledged", diagnostic: "The user acknowledged process inspection. This does not retrospectively prove cleanup." } } }]);
      }
      case "retention.run": {
        if (!this.snapshot().settings.values.retention.deleteArchived) throw new MoguriError("retention_disabled", "Enable archived-session deletion explicitly first.");
        const result = await this.retention(); return finish([], { revision: result.deleted });
      }
    }
  }
}
