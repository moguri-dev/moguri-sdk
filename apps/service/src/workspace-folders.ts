import { randomUUID } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import {
  MoguriError, projectIdentifier, folderRelativePath, WORKSPACE_FOLDER_MAX_REPOSITORIES, WORKSPACE_FOLDER_SCAN_DEPTH, WORKSPACE_FOLDER_SYNC_MS,
  type CommandResult, type EventInput, type Project, type Snapshot, type WorkspaceFolder, type WorkspaceFolderCommand,
  type WorkspaceFolderEntry, type WorkspaceFolderObservation, type WorkspaceFolderPreview, type WorkspaceFolderQuery,
  type WorkspaceFolderResponse, type WorkspaceFolderReview,
} from "../../../packages/protocol/src/index.ts";
import { sourceRoot, type SourceRoot } from "./repository-source.ts";
import { digest } from "./store.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";

export interface DiscoveredRepository { path: string; relative: string; name: string }
export interface FolderDiscovery {
  root: SourceRoot; repositories: DiscoveredRepository[]; linkedWorktrees: number; complete: boolean; diagnostic: string | null;
}
export interface DiscoveryLimits { depth: number; entries: number; ms: number; repositories: number }
const DEFAULT_LIMITS: DiscoveryLimits = { depth: WORKSPACE_FOLDER_SCAN_DEPTH, entries: 20_000, ms: 10_000, repositories: WORKSPACE_FOLDER_MAX_REPOSITORIES };
const SKIPPED_DIRECTORIES = new Set(["node_modules"]);
const missing = (error: unknown) => error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR"].includes(String(error.code));
const inside = (root: string, path: string) => path === root || path.startsWith(root === "/" ? "/" : `${root}/`);

/** A directory is a repository when it holds a real `.git` directory with HEAD and objects. `.git` files are linked worktrees or submodules. */
async function gitMarker(directory: string): Promise<"repository" | "linked" | null> {
  let metadata;
  try { metadata = await lstat(join(directory, ".git")); } catch (error) { if (missing(error)) return null; throw error; }
  if (metadata.isFile()) return "linked";
  if (!metadata.isDirectory()) return null;
  try {
    const [head, objects] = await Promise.all([lstat(join(directory, ".git", "HEAD")), lstat(join(directory, ".git", "objects"))]);
    return head.isFile() && objects.isDirectory() ? "repository" : null;
  } catch (error) { if (missing(error)) return null; throw error; }
}

/** Read-only, bounded discovery. It never follows links, enters dot folders or node_modules, or descends below a repository root. */
export async function discoverRepositories(path: string, skip: readonly string[], signal: AbortSignal, limits: DiscoveryLimits = DEFAULT_LIMITS): Promise<FolderDiscovery> {
  if (!isAbsolute(path)) throw new MoguriError("workspace_folder_path", "Choose an absolute folder path.", 400);
  let canonical;
  try { canonical = await realpath(path); } catch (error) {
    if (missing(error)) throw new MoguriError("workspace_folder_missing", "This folder doesn't exist.", 404);
    throw error;
  }
  const root = await sourceRoot(canonical).catch(() => { throw new MoguriError("workspace_folder_path", "Choose a real folder, not a file or link.", 400); });
  const deadline = Date.now() + limits.ms, repositories: DiscoveredRepository[] = [], pending = [{ directory: canonical, depth: 0 }];
  let entries = 0, linkedWorktrees = 0, complete = true, diagnostic: string | null = null;
  const stop = (reason: string) => { complete = false; diagnostic = reason; pending.length = 0; };
  while (pending.length) {
    signal.throwIfAborted();
    if (Date.now() >= deadline) { stop("The scan took too long and stopped early. Choose a smaller folder to see everything."); break; }
    const { directory, depth } = pending.shift()!;
    if (skip.some((excluded) => inside(excluded, directory))) continue;
    const marker = await gitMarker(directory);
    if (marker === "linked") { linkedWorktrees++; continue; }
    if (marker === "repository") {
      if (repositories.length >= limits.repositories) { stop(`Found more than ${limits.repositories} repositories. Choose a smaller folder.`); break; }
      const relative = folderRelativePath(canonical, directory)!;
      repositories.push({ path: directory, relative, name: basename(directory) || directory });
      continue;
    }
    if (depth >= limits.depth) continue;
    let children;
    try { children = await readdir(directory, { withFileTypes: true }); } catch (error) {
      if (missing(error) || error instanceof Error && "code" in error && ["EACCES", "EPERM"].includes(String(error.code))) continue;
      throw error;
    }
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      if (++entries > limits.entries) { stop("The folder has too many entries and the scan stopped early. Choose a smaller folder."); break; }
      if (child.isDirectory() && !child.name.startsWith(".") && !SKIPPED_DIRECTORIES.has(child.name)) pending.push({ directory: join(directory, child.name), depth: depth + 1 });
    }
  }
  const after = await sourceRoot(canonical).catch(() => null);
  if (!after || after.device !== root.device || after.inode !== root.inode) throw new MoguriError("workspace_folder_changed", "The folder was moved or replaced during the scan. Choose it again.", 409);
  repositories.sort((left, right) => left.relative.localeCompare(right.relative));
  return { root, repositories, linkedWorktrees, complete, diagnostic };
}

interface Host {
  snapshot(): Snapshot;
  commit(events: EventInput[]): void;
  /** Folders discovery must never enter, such as Moguri's own state directory. */
  skip(): string[];
}
const registrationsDigest = (snapshot: Snapshot) => digest(JSON.stringify(snapshot.projects.map((project) => [project.id, project.path, project.workspaceFolderId ?? null]).sort()));
const projectPending = (snapshot: Snapshot, path: string) =>
  snapshot.jobs.some((job) => job.projectClone?.path === path && ["running", "waiting_input"].includes(job.status)) ||
  snapshot.repositoryImports.some((batch) => batch.items.some((item) => item.path === path &&
    (batch.status === "running" && ["pending", "running"].includes(item.status) || item.status === "partial" && !item.inspection)));

export class WorkspaceFolders {
  private readonly observations = new Map<string, WorkspaceFolderObservation>();
  private readonly shutdown = new AbortController();
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  constructor(private readonly host: Host, private readonly interval = WORKSPACE_FOLDER_SYNC_MS) {}
  /** Runs one operation at a time so scans and registrations never interleave. */
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
  start(): void {
    if (this.timer || this.shutdown.signal.aborted) return;
    this.syncAll();
    this.timer = setInterval(() => this.syncAll(), this.interval); this.timer.unref();
  }
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.shutdown.abort();
  }
  private syncAll(): void {
    for (const folder of this.host.snapshot().workspaceFolders) if (folder.sync) {
      void this.serial(() => this.check(folder.id)).catch((error: unknown) => {
        if (!this.shutdown.signal.aborted) console.error("Moguri workspace folder sync:", folder.id, error instanceof Error ? error.message : error);
      });
    }
  }
  private folder(id: string): WorkspaceFolder {
    const folder = this.host.snapshot().workspaceFolders.find((folder) => folder.id === id);
    if (!folder) throw new MoguriError("workspace_folder_missing", "This workspace folder is no longer tracked in this profile.", 404);
    return folder;
  }
  private event(folder: WorkspaceFolder): EventInput {
    return { event_type: "workspace_folder.saved", profile_id: folder.profileId, payload: { folder } };
  }
  private allowed(snapshot: Snapshot): void {
    if (!snapshot.policy.allowedEnvs.includes("Local")) throw new MoguriError("workspace_folder_policy", "Your execution policy blocks Local, so Moguri can't read folders on this Mac.", 403);
  }
  private projects(snapshot: Snapshot, folder: WorkspaceFolder, entries: { path: string }[]): EventInput[] {
    const names = snapshot.projects.map((project) => project.name), events: EventInput[] = [];
    for (const entry of entries) {
      if (snapshot.projects.some((project) => project.path === entry.path)) continue;
      if (projectPending(snapshot, entry.path)) throw new MoguriError("workspace_folder_busy", "A clone or URL import still owns one of these folders. Finish or inspect it first.", 409);
      const project: Project = { id: randomUUID(), name: projectIdentifier(basename(entry.path) || "project", names), path: entry.path, workspaceFolderId: folder.id };
      names.push(project.name);
      events.push({ event_type: "project.added", profile_id: snapshot.profileId, project_id: project.id, payload: { project } });
    }
    return events;
  }
  async preview(path: string, signal?: AbortSignal): Promise<WorkspaceFolderPreview> {
    const snapshot = this.host.snapshot();
    this.allowed(snapshot);
    const abort = signal ? AbortSignal.any([signal, this.shutdown.signal]) : this.shutdown.signal;
    const discovery = await discoverRepositories(path, this.host.skip(), abort);
    const root = discovery.root.root;
    if (this.host.skip().some((skipped) => inside(skipped, root))) throw new MoguriError("workspace_folder_path", "Choose a folder outside Moguri's own storage.", 400);
    const current = this.host.snapshot();
    const folder = current.workspaceFolders.find((folder) => folder.root.root === root);
    const overlap = current.workspaceFolders.find((other) => other.root.root !== root && (inside(other.root.root, root) || inside(root, other.root.root)));
    if (overlap) throw new MoguriError("workspace_folder_overlap", `This folder overlaps a folder you already added (${overlap.root.root}). Remove that one first, or choose it instead.`, 409);
    const entries: WorkspaceFolderEntry[] = discovery.repositories.map((repository) => {
      const project = current.projects.find((project) => project.path === repository.path);
      return { ...repository, disposition: project ? "registered" : folder?.excluded.includes(repository.relative) ? "excluded" : "new", projectId: project?.id ?? null };
    });
    const document: WorkspaceFolderReview = {
      format: "moguri-workspace-folder", version: 1, profileId: current.profileId, root: discovery.root,
      folderId: folder?.id ?? null, folderRevision: folder?.revision ?? null, policyRevision: current.policy.revision,
      registrationsDigest: registrationsDigest(current), complete: discovery.complete, diagnostic: discovery.diagnostic,
      linkedWorktrees: discovery.linkedWorktrees, entries,
    };
    return { document, digest: digest(JSON.stringify(document)) };
  }
  /** Scans one folder. With sync on it registers new repositories; it never removes projects. Unchanged checks append nothing. */
  private async check(folderId: string): Promise<WorkspaceFolderObservation> {
    const folder = this.folder(folderId), previous = this.observations.get(folderId);
    const observation: WorkspaceFolderObservation = { folderId, status: "checking", checkedAt: previous?.checkedAt ?? null, complete: previous?.complete ?? false,
      diagnostic: previous?.diagnostic ?? null, added: 0, available: 0, missing: previous?.missing ?? [] };
    this.observations.set(folderId, observation);
    const settle = (changes: Partial<WorkspaceFolderObservation>) => {
      const value = { ...observation, ...changes, status: "idle" as const, checkedAt: new Date().toISOString() };
      if (this.host.snapshot().workspaceFolders.some((entry) => entry.id === folderId)) this.observations.set(folderId, value);
      else this.observations.delete(folderId);
      return value;
    };
    try {
      this.allowed(this.host.snapshot());
      const actual = await sourceRoot(folder.root.root).catch(() => null);
      if (!actual || actual.device !== folder.root.device || actual.inode !== folder.root.inode) {
        return settle({ complete: false, diagnostic: "The folder is missing or was replaced. Sync is paused until it's back; no projects were changed.", added: 0, available: 0 });
      }
      const discovery = await discoverRepositories(folder.root.root, this.host.skip(), this.shutdown.signal);
      const snapshot = this.host.snapshot(), current = snapshot.workspaceFolders.find((entry) => entry.id === folderId);
      if (!current) return settle({});
      const fresh = discovery.repositories.filter((repository) => !current.excluded.includes(repository.relative) &&
        !snapshot.projects.some((project) => project.path === repository.path) && !projectPending(snapshot, repository.path));
      const missingProjects: string[] = [];
      for (const project of snapshot.projects.filter((project) => project.workspaceFolderId === folderId)) {
        try { await lstat(project.path); } catch (error) { if (missing(error)) missingProjects.push(project.id); else throw error; }
      }
      let added = 0;
      if (current.sync && fresh.length) {
        const latest = this.host.snapshot(), events = this.projects(latest, current,
          fresh.filter((repository) => !latest.projects.some((project) => project.path === repository.path) && !projectPending(latest, repository.path)));
        if (events.length) { this.host.commit(events); added = events.length; }
      }
      return settle({ complete: discovery.complete, diagnostic: discovery.diagnostic, added, available: current.sync ? 0 : fresh.length, missing: missingProjects });
    } catch (error) {
      settle({ complete: false, diagnostic: (error instanceof MoguriError ? error.message : "Checking this folder failed. Try again.").slice(0, 2000), added: 0, available: 0 });
      throw error;
    }
  }
  status(): WorkspaceFolderObservation[] {
    return this.host.snapshot().workspaceFolders.map((folder) => structuredClone(this.observations.get(folder.id) ?? {
      folderId: folder.id, status: "idle", checkedAt: null, complete: false, diagnostic: null, added: 0, available: 0, missing: [],
    }));
  }
  async query(query: WorkspaceFolderQuery, signal?: AbortSignal): Promise<WorkspaceFolderResponse> {
    if (query.type === "projects.folders.status") return { type: query.type, folders: this.status() };
    return { type: query.type, preview: await this.serial(() => this.preview(query.path, signal)) };
  }
  async execute(command: WorkspaceFolderCommand, finish: WorkspaceFinish): Promise<CommandResult> {
    if (command.type === "projects.folders.check") {
      this.folder(command.folderId);
      await this.serial(() => this.check(command.folderId));
      return finish([], { id: command.folderId });
    }
    if (command.type === "projects.folders.configure" || command.type === "projects.folders.remove") {
      const folder = this.folder(command.folderId);
      if (folder.revision !== command.expectedRevision) throw new MoguriError("revision_conflict", "This folder changed in another window. Review it again.", 409);
      if (command.type === "projects.folders.remove") {
        this.observations.delete(folder.id);
        return finish([{ event_type: "workspace_folder.removed", profile_id: folder.profileId, payload: { folderId: folder.id } }], { id: folder.id });
      }
      if (folder.sync === command.sync) return finish([], { id: folder.id, revision: folder.revision });
      const next = { ...folder, sync: command.sync, revision: folder.revision + 1, updatedAt: new Date().toISOString() };
      const result = finish([this.event(next)], { id: folder.id, revision: next.revision });
      if (next.sync) void this.serial(() => this.check(folder.id)).catch((error: unknown) => console.error("Moguri workspace folder sync:", folder.id, error instanceof Error ? error.message : error));
      return result;
    }
    const intent = finish.intent;
    if (!intent) throw new MoguriError("workspace_folder_intent", "Trusting a folder needs your own command.", 409);
    const replay = this.host.snapshot().workspaceFolders.find((folder) => folder.trust.commandId === intent.id);
    if (replay) {
      if (replay.trust.commandDigest !== intent.digest) throw new MoguriError("idempotency_conflict", "This command belongs to a different folder import.", 409);
      return finish([], { id: replay.id, revision: replay.revision });
    }
    return this.serial(async () => {
      const review = await this.preview(command.path), document = review.document;
      if (review.digest !== command.expectedDigest) throw new MoguriError("workspace_folder_stale", "The folder, its repositories or your projects changed since the review. Review it again; nothing was imported.", 409);
      const selectable = document.entries.filter((entry) => entry.disposition !== "registered");
      if (command.include.some((relative) => !selectable.some((entry) => entry.relative === relative))) {
        throw new MoguriError("workspace_folder_selection", "Choose only repositories listed as new in this review.", 409);
      }
      const snapshot = this.host.snapshot(), existing = snapshot.workspaceFolders.find((folder) => folder.root.root === document.root.root);
      const now = new Date().toISOString(), trust = { actor: "user" as const, commandId: intent.id, commandDigest: intent.digest, at: now };
      const left = selectable.filter((entry) => !command.include.includes(entry.relative)).map((entry) => entry.relative);
      const folder: WorkspaceFolder = existing ? {
        ...existing, sync: command.sync, trust, revision: existing.revision + 1, updatedAt: now,
        excluded: [...new Set([...existing.excluded.filter((relative) => !command.include.includes(relative)), ...left])].sort(),
      } : {
        version: 1, id: randomUUID(), profileId: snapshot.profileId, root: document.root, sync: command.sync, excluded: [...left].sort(),
        trust, revision: 0, createdAt: now, updatedAt: now,
      };
      const included = document.entries.filter((entry) => command.include.includes(entry.relative));
      const events = [this.event(folder), ...this.projects(snapshot, folder, included)];
      const result = finish(events, { id: folder.id, revision: folder.revision });
      this.observations.set(folder.id, { folderId: folder.id, status: "idle", checkedAt: now, complete: document.complete, diagnostic: document.diagnostic,
        added: events.length - 1, available: 0, missing: [] });
      return result;
    });
  }
}
