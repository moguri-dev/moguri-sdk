import { randomUUID } from "node:crypto";
import { mkdir, lstat, realpath } from "node:fs/promises";
import { lstatSync, realpathSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import {
  MoguriError, type ManagedWorkspace, type WorkspaceInspection, type Project, type Session, type Snapshot,
  type ManagedWorkspaceCommand, type ManagedWorkspaceQuery, type ManagedWorkspaceResponse, type EventInput, type CommandResult, type CapabilityJob, type GitWorkspaceRegistration,
} from "../../../packages/protocol/src/index.ts";
import { runProgram } from "./program.ts";
import { profileIndexId } from "./store.ts";
import { listProjectFiles, readProjectFile } from "./files.ts";
import { assertFolderAccess, folderPolicy, matchesFolder } from "./project-policy.ts";
import type { ProjectService } from "./project-service.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import { pullRequestLink } from "./project-integrations.ts";
import { gitReadFilters } from "./project-git.ts";
import type { WorkspaceReadQuery, WorkspaceReadResult } from "./remote-protocol.ts";

interface Host {
  snapshot(): Snapshot;
  project(id: string): Project;
  commit(events: EventInput[]): void;
  wake(): void;
  writeBusy(projectId: string, workspaceId: string): boolean;
  remoteRead(session: Session, query: WorkspaceReadQuery): Promise<WorkspaceReadResult>;
  nativeRead?(session: Session, query: WorkspaceReadQuery): Promise<WorkspaceReadResult>;
  job(kind: string, projectId: string, execute: (signal: AbortSignal, progress: (text: string) => void) => Promise<unknown>, start: (job: CapabilityJob) => void, settled: () => void, workspaceId: string): string;
}
export class ManagedWorkspaces {
  private readonly active = new Set<string>();
  constructor(private readonly stateDir: string, private readonly host: Host, private readonly settings: () => ProjectService) {}
  private workspace(id: string): ManagedWorkspace {
    const workspace = this.host.snapshot().managedWorkspaces.find((value) => value.id === id);
    if (!workspace) throw new MoguriError("workspace_missing", "Managed workspace is outside this profile.", 404);
    return workspace;
  }
  private session(id: string): Session {
    const session = this.host.snapshot().sessions.find((value) => value.id === id);
    if (!session) throw new MoguriError("session_missing", "Choose an existing session.", 404);
    return session;
  }
  private event(workspace: ManagedWorkspace): EventInput {
    return { event_type: "workspace.saved", profile_id: this.host.snapshot().profileId, project_id: workspace.projectId, payload: { workspace } };
  }
  private saved(id: string, changes: Partial<ManagedWorkspace>): ManagedWorkspace {
    const current = this.workspace(id), value = { ...current, ...changes, revision: current.revision + 1 };
    this.host.commit([this.event(value)]); return value;
  }
  private job(id: string, kind: string, projectId: string, execute: (signal: AbortSignal, progress: (text: string) => void) => Promise<unknown>, start: (job: CapabilityJob) => void): string {
    this.active.add(id);
    try { return this.host.job(kind, projectId, execute, start, () => { this.active.delete(id); this.host.wake(); }, id); }
    catch (error) { this.active.delete(id); throw error; }
  }
  private git(project: Project, args: string[], signal: AbortSignal, extra: string[] = []) {
    return runProgram("git", ["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "submodule.recurse=false", ...extra, "--literal-pathspecs", ...args], {
      cwd: project.path, signal, timeoutMs: 30_000, maxBytes: 512 * 1024, label: "Managed workspace Git operation",
      env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_LFS_SKIP_SMUDGE: "1", GIT_TERMINAL_PROMPT: "0" },
    });
  }
  private async filters(project: Project, signal: AbortSignal): Promise<string[]> {
    return gitReadFilters(project.path, signal);
  }
  private async registrations(project: Project, signal: AbortSignal): Promise<GitWorkspaceRegistration[]> {
    const text = await this.git(project, ["worktree", "list", "--porcelain", "-z"], signal), registrations: GitWorkspaceRegistration[] = [];
    let current: GitWorkspaceRegistration | undefined;
    for (const field of text.split("\0")) {
      if (field.startsWith("worktree ")) {
        if (current) registrations.push(current);
        const path = field.slice(9), managed = this.host.snapshot().managedWorkspaces.find((workspace) => workspace.projectId === project.id && workspace.path === path && workspace.status !== "removed");
        current = { path, branch: null, head: null, locked: false, managedId: managed?.id ?? null };
      } else if (current && field.startsWith("HEAD ")) current.head = field.slice(5);
      else if (current && field.startsWith("branch ")) current.branch = field.slice(7).replace(/^refs\/heads\//, "");
      else if (current && (field === "locked" || field.startsWith("locked "))) current.locked = true;
    }
    if (current) registrations.push(current);
    return registrations;
  }
  private async parent(projectId: string): Promise<string> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) throw new MoguriError("workspace_identity", "Project identity is unsafe for an owned workspace.");
    const root = await realpath(this.stateDir), parent = join(root, "worktrees", projectId);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const metadata = await lstat(parent);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || metadata.mode & 0o077 || await realpath(parent) !== parent) throw new MoguriError("workspace_ownership", "The managed worktree parent is not canonical/private/user-owned. Inspect it; no arbitrary path was used.", 409);
    return parent;
  }
  private expectedPath(workspace: ManagedWorkspace): void {
    const expected = join(realpathSync(this.stateDir), "worktrees", workspace.projectId, workspace.id);
    if (workspace.path !== expected) throw new MoguriError("workspace_ownership", "This path is not the exact owned workspace location. No deletion or fallback was attempted.", 409);
  }
  project(session: Pick<Session, "projectId" | "workspaceId">): Project {
    if (!session.projectId) throw new MoguriError("project_required", "Select a project for this workspace capability. No previous root was reused.", 409);
    const project = this.host.project(session.projectId);
    if (!session.workspaceId) return project;
    const workspace = this.workspace(session.workspaceId);
    this.expectedPath(workspace);
    if (workspace.projectId !== project.id || workspace.status !== "ready" || !workspace.identity) throw new MoguriError("workspace_unready", "This managed workspace is missing, partial, removed or belongs to another project. No base folder was substituted.", 409);
    let metadata;
    try { metadata = lstatSync(workspace.path, { bigint: true }); }
    catch { throw new MoguriError("workspace_changed", "The managed root is unavailable. Inspect/reconcile it; no base folder was reused.", 409); }
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || String(metadata.dev) !== workspace.identity.device || String(metadata.ino) !== workspace.identity.inode || realpathSync(workspace.path) !== workspace.path) throw new MoguriError("workspace_changed", "The managed directory identity changed. Inspect it before continuing; no fallback root.", 409);
    return { ...project, path: workspace.path };
  }
  indexScope(session: Pick<Session, "projectId" | "workspaceId">) {
    const project = this.project(session);
    return { id: profileIndexId(this.host.snapshot().profileId, session.workspaceId ?? project.id), path: project.path };
  }
  leaseKey(session: Session): string | null { return session.projectId ? `${session.projectId}:${session.workspaceId ?? "base"}` : null; }
  async assert(session: Pick<Session, "projectId" | "workspaceId">, signal?: AbortSignal): Promise<void> {
    this.project(session);
    if (!session.workspaceId) return;
    const inspection = await this.inspect(session.workspaceId, signal);
    if (!inspection.registered || !inspection.canonical || inspection.diagnostic) throw new MoguriError("workspace_changed", inspection.diagnostic ?? "Managed Git/workspace binding changed. Inspect it before admitting another effect.", 409);
  }
  async inspect(id: string, requestedSignal?: AbortSignal): Promise<WorkspaceInspection> {
    const workspace = this.workspace(id), project = this.host.project(workspace.projectId), signal = requestedSignal ? AbortSignal.any([requestedSignal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
    const disabledFilters = await this.filters(project, signal);
    this.expectedPath(workspace);
    const registration = (await this.registrations(project, signal)).find((registration) => registration.path === workspace.path), registered = Boolean(registration), locked = Boolean(registration?.locked);
    let metadata;
    try { metadata = await lstat(workspace.path, { bigint: true }); }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      return { workspace, registered, locked, exists: false, canonical: false, branch: null, head: null, status: null, diagnostic: registered ? "Git still registers this missing root. No repair or replay was performed." : "The owned root is absent and not registered." };
    }
    const canonical = metadata.isDirectory() && !metadata.isSymbolicLink() && await realpath(workspace.path) === workspace.path;
    if (!canonical) return { workspace, registered, locked, exists: true, canonical: false, branch: null, head: null, status: null, diagnostic: "The owned root became a symlink/non-directory. No file or Git operation was run there." };
    const current = { ...project, path: workspace.path };
    const common = await realpath((await this.git(current, ["rev-parse", "--path-format=absolute", "--git-common-dir"], signal, disabledFilters)).trim());
    const branch = (await this.git(current, ["branch", "--show-current"], signal, disabledFilters)).trim(), head = (await this.git(current, ["rev-parse", "--verify", "HEAD"], signal, disabledFilters)).trim();
    const status = (await this.git(current, ["status", "--porcelain=v1", "--untracked-files=normal"], signal, disabledFilters)).trim();
    const changed = workspace.identity && (workspace.identity.device !== String(metadata.dev) || workspace.identity.inode !== String(metadata.ino));
    return { workspace, registered, locked, exists: true, canonical, branch, head, status, diagnostic: !registered || common !== workspace.gitCommonDir || branch !== workspace.branch || changed ? "Workspace registration, repository, branch or directory identity changed. Reconcile only after actual inspection." : null };
  }
  recover(): void {
    for (const workspace of this.host.snapshot().managedWorkspaces.filter((value) => value.status === "creating" || value.status === "removing")) this.saved(workspace.id, { status: "partial", diagnostic: "Service restarted during Git creation/removal. Existing state was not retried; inspect and reconcile the exact owned root." });
  }
  async query(query: ManagedWorkspaceQuery): Promise<ManagedWorkspaceResponse> {
    if (query.type === "workspace.discover") {
      return { type: query.type, registrations: await this.registrations(this.host.project(query.projectId), AbortSignal.timeout(15_000)) };
    }
    if (query.type === "workspace.inspect") return { type: query.type, inspection: await this.inspect(query.workspaceId) };
    const session = this.session(query.sessionId);
    if (session.controls.env === "Sandbox") {
      if (!this.host.nativeRead) throw new MoguriError("sandbox_workspace", "This service has no qualified native file broker. No Local source root was read.", 409);
      const request: WorkspaceReadQuery = query.type === "session.git" ? { type: query.type, diff: query.diff } : { type: query.type, path: query.path };
      const result = await this.host.nativeRead(session, request);
      if (result.type !== query.type) throw new MoguriError("sandbox_workspace", "Native file response changed its exact requested type. No fallback.", 409);
      return result;
    }
    if (session.controls.env === "Remote") {
      const request: WorkspaceReadQuery = query.type === "session.git" ? { type: query.type, diff: query.diff } : { type: query.type, path: query.path };
      const result = await this.host.remoteRead(session, request);
      if (result.type === "plan.read") throw new MoguriError("remote_workspace_type", "Remote file/Git response did not match its request.", 409);
      return result;
    }
    if (session.controls.env !== "Local") throw new MoguriError("workspace_env", "This file/Git surface has no qualified transport for the selected environment. No Local fallback.", 409);
    const project = this.project(session), settings = this.settings().values(project.id);
    if (query.type === "session.git") {
      const signal = AbortSignal.timeout(30_000), disabledFilters = await this.filters(project, signal);
      return { ...await this.settings().gitView(project, query.diff, signal, disabledFilters), type: query.type };
    }
    await assertFolderAccess(project.path, query.path, false, folderPolicy(settings));
    if (query.type === "session.files") return { type: query.type, path: query.path, entries: (await listProjectFiles(project.path, query.path)).filter((entry) => !matchesFolder(entry, settings.deniedFolders)) };
    return { type: query.type, ...await readProjectFile(project.path, query.path) };
  }
  async execute(command: ManagedWorkspaceCommand, finish: WorkspaceFinish): Promise<CommandResult> {
    if (command.type === "session.workspace") {
      const session = this.session(command.sessionId);
      if (session.revision !== command.expectedRevision) throw new MoguriError("revision_conflict", "Session changed. Reload before binding a workspace.", 409);
      if (session.turnId || session.messages.length || session.queue.length || session.status === "archived") throw new MoguriError("workspace_session", "Bind only a fresh idle session. Existing conversation/queued intent is not silently moved to another branch.", 409);
      if (command.workspaceId && session.controls.env !== "Local") throw new MoguriError("workspace_env", "Managed worktree location is currently qualified for Local only. No remote mapping is inferred.", 409);
      this.project({ projectId: session.projectId, workspaceId: command.workspaceId });
      return finish([{ event_type: "session.workspace_bound", profile_id: this.host.snapshot().profileId, project_id: session.projectId, session_id: session.id, payload: { workspaceId: command.workspaceId } }], { revision: session.revision + 1 });
    }
    if (!this.host.snapshot().policy.allowedEnvs.includes("Local")) throw new MoguriError("workspace_env", "Local Git workspace maintenance is excluded by allowed-env policy. No protected-environment fallback.", 403);
    if (command.type === "workspace.create") {
      const project = this.host.project(command.projectId), settings = this.settings().configuration(project.id);
      if (command.branch === settings.values.repo.mainBranch || ["main", "master"].includes(command.branch)) throw new MoguriError("workspace_branch", "Use a new non-protected work branch. Managed creation does not replace main/master.");
      const signal = AbortSignal.timeout(15_000);
      await this.git(project, ["check-ref-format", "--branch", command.branch], signal);
      const baseCommit = (await this.git(project, ["rev-parse", "--verify", "--end-of-options", `${command.baseRef ?? settings.values.repo.mainBranch}^{commit}`], signal)).trim();
      const common = await realpath((await this.git(project, ["rev-parse", "--path-format=absolute", "--git-common-dir"], signal)).trim());
      const disabledFilters = await this.filters(project, signal);
      if (this.settings().configuration(project.id).revision !== settings.revision || this.host.project(project.id).path !== project.path) throw new MoguriError("workspace_changed", "Project configuration/root changed during worktree planning. Nothing was created.", 409);
      if (command.issueId && !this.host.snapshot().issues.some((issue) => issue.id === command.issueId && issue.projectId === project.id)) throw new MoguriError("workspace_issue", "Choose an existing ticket from this project.");
      const id = randomUUID(), changeSetId = randomUUID(), parent = await this.parent(project.id);
      if (!this.host.snapshot().policy.allowedEnvs.includes("Local") || this.settings().configuration(project.id).revision !== settings.revision || this.host.project(project.id).path !== project.path) throw new MoguriError("workspace_changed", "Project/policy changed during preparation. No Git mutation was admitted.", 409);
      const prUrl = command.prUrl ? pullRequestLink(command.prUrl).url : null;
      let workspace: ManagedWorkspace = { id, projectId: project.id, path: join(parent, id), branch: command.branch, baseCommit, gitCommonDir: common, status: "creating", revision: 0, createdAt: new Date().toISOString(), jobId: null, diagnostic: null, identity: null, changeSetId };
      this.job(id, "workspace.create", project.id, async (signal, progress) => {
        let started = false;
        try {
          progress("Creating an owned isolated checkout; hooks, filters and submodule fetching stay disabled.");
          started = true;
          await this.git(project, ["worktree", "add", "--no-checkout", "--lock", "--reason", `Moguri ${id}`, "-b", workspace.branch, workspace.path, baseCommit], signal, disabledFilters);
          const target = { ...project, path: workspace.path };
          await this.git(target, ["read-tree", baseCommit], signal, disabledFilters);
          await this.git(target, ["checkout-index", "--all"], signal, disabledFilters);
          signal.throwIfAborted();
          const metadata = await lstat(workspace.path, { bigint: true });
          this.saved(id, { status: "ready", identity: { device: String(metadata.dev), inode: String(metadata.ino) }, diagnostic: null });
          return { workspaceId: id, changeSetId, baseCommit, branch: workspace.branch };
        } catch (error) {
          this.saved(id, { status: "partial", diagnostic: started ? "Git creation/cancellation may be partial. Inspect the retained root/branch; nothing was retried or deleted." : "Creation was not started. Reconcile the retained intent before retrying." });
          throw new MoguriError("workspace_partial", error instanceof Error ? `${error.message} Inspect the existing workspace/branch; do not repeat creation blindly.` : "Workspace creation is partial; inspect before retrying.", 409);
        }
      }, (job) => {
        workspace = { ...workspace, jobId: job.id };
        finish([this.event(workspace), { event_type: "change_set.saved", profile_id: this.host.snapshot().profileId, project_id: project.id, payload: { changeSet: { id: changeSetId, projectId: project.id, workspaceId: id, branch: workspace.branch, baseCommit, issueId: command.issueId ?? null, prUrl, createdAt: workspace.createdAt } } },
          { event_type: "job.started", profile_id: this.host.snapshot().profileId, project_id: project.id, payload: { job } }], { id });
      });
      return { id };
    }
    const workspace = this.workspace(command.workspaceId);
    if (this.host.writeBusy(workspace.projectId, workspace.id)) throw new MoguriError("workspace_busy", "An owned writer holds this source/staging worktree. Stop/wait before maintenance.", 409);
    if (workspace.revision !== command.expectedRevision || this.active.has(workspace.id)) throw new MoguriError("workspace_conflict", "Workspace changed or still owns a job. Reload/wait before this action.", 409);
    const inspection = await this.inspect(workspace.id);
    if (command.type === "workspace.reconcile") {
      if (this.workspace(workspace.id).revision !== command.expectedRevision) throw new MoguriError("workspace_conflict", "Workspace changed during inspection.", 409);
      const absent = !inspection.registered && !inspection.exists;
      if (!absent && (inspection.diagnostic || !inspection.registered || !inspection.canonical)) throw new MoguriError("workspace_unconfirmed", inspection.diagnostic ?? "Workspace is not safely reconcilable.", 409);
      const metadata = absent ? null : await lstat(workspace.path, { bigint: true });
      return finish([this.event({ ...workspace, status: absent ? "removed" : "ready", identity: metadata ? { device: String(metadata.dev), inode: String(metadata.ino) } : workspace.identity, revision: workspace.revision + 1, diagnostic: absent ? "User inspected: owned root and registration are absent. The branch was not deleted." : "User inspected matching Git/root identity. No operation was replayed." })], { revision: workspace.revision + 1 });
    }
    if (this.workspace(workspace.id).revision !== command.expectedRevision || this.active.has(workspace.id)) throw new MoguriError("workspace_conflict", "Another client changed or claimed this worktree during inspection.", 409);
    if (!this.host.snapshot().policy.allowedEnvs.includes("Local")) throw new MoguriError("workspace_env", "Allowed-env policy changed during inspection. No Local removal was admitted.", 403);
    if (workspace.status !== "ready" || inspection.diagnostic || inspection.status || !inspection.registered || !inspection.canonical) throw new MoguriError("workspace_dirty", inspection.diagnostic ?? "Remove only a clean, registered, ready worktree. Dirty/untracked content was preserved.", 409);
    if (this.host.snapshot().sessions.some((session) => session.workspaceId === workspace.id)) throw new MoguriError("workspace_bound", "This worktree still has sessions, including archived ones. Delete/unbind fresh sessions explicitly first; retention never silently removes their root.", 409);
    const project = this.host.project(workspace.projectId);
    this.job(workspace.id, "workspace.remove", project.id, async (signal) => {
      try {
        const disabledFilters = await this.filters(project, signal);
        if (inspection.locked) await this.git(project, ["worktree", "unlock", workspace.path], signal, disabledFilters);
        await this.git(project, ["worktree", "remove", workspace.path], signal, disabledFilters);
        this.saved(workspace.id, { status: "removed", diagnostic: "Clean owned worktree removed. Its branch and independent artifacts were preserved." });
        return { workspaceId: workspace.id, branchPreserved: workspace.branch };
      } catch (error) {
        this.saved(workspace.id, { status: "partial", diagnostic: "Removal or cancellation was partial. Root/branch were not force-deleted; inspect and reconcile." });
        throw new MoguriError("workspace_partial", error instanceof Error ? error.message : "Worktree removal partial.", 409);
      }
    }, (job) => finish([this.event({ ...workspace, status: "removing", revision: workspace.revision + 1, jobId: job.id }), { event_type: "job.started", profile_id: this.host.snapshot().profileId, project_id: project.id, payload: { job } }], { id: workspace.id }));
    return { id: workspace.id };
  }
  ownedRoot(path: string): ManagedWorkspace | undefined {
    return this.host.snapshot().managedWorkspaces.find((workspace) => {
      if (workspace.status !== "ready") return false;
      const child = relative(workspace.path, path);
      if (isAbsolute(child) || child === ".." || child.startsWith("../")) return false;
      try { this.project({ projectId: workspace.projectId, workspaceId: workspace.id }); }
      catch (error) { if (error instanceof MoguriError) return false; throw error; }
      return true;
    });
  }
}
