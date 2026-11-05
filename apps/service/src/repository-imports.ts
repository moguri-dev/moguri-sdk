import { randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import {
  MoguriError, parse, projectIdentifier, successfulImportItem,
  RepositoryImportInputSchema, RepositoryImportReviewSchema,
  type CapabilityJob, type CommandResult, type EventInput, type Project, type RepositoryImportBatch,
  type RepositoryImportCommand, type RepositoryImportEntry, type RepositoryImportInput, type RepositoryImportItem,
  type RepositoryImportPreview, type RepositoryImportQuery, type RepositoryImportResponse, type Snapshot,
} from "../../../packages/protocol/src/index.ts";
import { cloneProject, localRootsOverlap, repositoryIdentity, repositoryUrl } from "./project-clone.ts";
import { optionalGitBinding, readGit } from "./project-git.ts";
import { sourceRoot, sourceRootSync } from "./repository-source.ts";
import { digest, type EventStore } from "./store.ts";
import type { CandidateJobLifecycle } from "./candidates.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";

interface Host {
  snapshot(): Snapshot;
  rootBusy(root: string, exceptJobId?: string): boolean;
  commit(events: EventInput[]): void;
  job(execute: (signal: AbortSignal, progress: (text: string) => void, jobId: string) => Promise<unknown>,
    start: (job: CapabilityJob) => void, lifecycle: CandidateJobLifecycle): string;
}
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
export function repositoryDirectory(input: string): string {
  const identity = repositoryIdentity(input), decoded = decodeURIComponent(identity);
  const portable = decoded.replace(/[^A-Za-z0-9._-]+/g, "--");
  return portable.length <= 180 && portable === identity.replaceAll("/", "--") ? portable :
    `${portable.slice(0, 170)}--${digest(identity).slice(0, 8)}`;
}
const registrations = (snapshot: Snapshot) => digest(JSON.stringify(snapshot.projects.map((project) => ({
  ...project, revision: snapshot.projectConfigurations.find((configuration) => configuration.projectId === project.id)?.revision ?? 0,
}))));
export function assertImportPolicy(snapshot: Snapshot): void {
  if (!snapshot.policy.allowedEnvs.includes("Local")) throw new MoguriError("repository_import_policy", "Local repository import is blocked by execution policy. No Remote or Sandbox root/account was substituted.", 403);
  if (snapshot.settings.values.permissions.tools.some((rule) => rule.decision === "deny" &&
    ["*", "run_command", "git", "git_write", "project.clone", "project.import-many"].includes(rule.tool)) ||
    snapshot.settings.values.permissions.commands.some((rule) => rule.decision === "deny" && ["project.clone", "project.import-many"].includes(rule.command))) {
    throw new MoguriError("repository_import_denied", "A hard tool/command denial blocks repository import. Reviewing a URL list cannot override it.", 403);
  }
}
function failure(error: unknown): string {
  if (error instanceof MoguriError && error.code === "program_failed") return "Git rejected this repository. Check the exact current URL and existing SSH access: a private/unavailable repository, authentication failure or moved URL is not retried. No account was authenticated or substituted.";
  if (error instanceof MoguriError && error.code === "program_partial") return "The original Git process stopped or lost its acknowledgement. Files/process cleanup may be partial; inspect this exact destination before any new action.";
  return (error instanceof MoguriError ? error.message : error instanceof Error && error.name === "AbortError" ? "Import cancelled; undispatched repositories were not started." : "Repository import failed. Inspect its original destination and filesystem permissions; no successful import or retry was inferred.").slice(0, 1500);
}
export class RepositoryImports {
  constructor(private readonly store: EventStore, private readonly host: Host) {}
  private batch(id: string): RepositoryImportBatch {
    const batch = this.host.snapshot().repositoryImports.find((batch) => batch.id === id);
    if (!batch) throw new MoguriError("repository_import_missing", "This original import batch is outside the current profile.", 404);
    return batch;
  }
  private event(batch: RepositoryImportBatch): EventInput {
    return { event_type: "repository.import_recorded", profile_id: batch.profileId, payload: { batch } };
  }
  private changed(batch: RepositoryImportBatch, changes: Partial<RepositoryImportBatch>): RepositoryImportBatch {
    return { ...batch, ...changes, revision: batch.revision + 1, updatedAt: new Date().toISOString() };
  }
  private updateItem(id: string, line: number, changes: Pick<RepositoryImportItem, "status" | "diagnostic">, events: EventInput[] = []): void {
    const batch = this.batch(id), items = batch.items.map((item) => item.line === line ? { ...item, ...changes } : item);
    this.host.commit([...events, this.event(this.changed(batch, { items }))]);
  }
  private async checkout(path: string, upstream: string, signal: AbortSignal) {
    const root = await sourceRoot(path), binding = await optionalGitBinding(path, signal);
    if (!binding) return null;
    const remotes = (await readGit(path, ["remote", "-v"], signal)).split("\n").filter((line) => line.startsWith(`${upstream}\t`) && line.endsWith(" (fetch)"));
    if (remotes.length !== 1) throw new MoguriError("repository_import_remote", "The existing checkout needs one exact configured fetch URL; no remote was guessed.", 409);
    const remote = remotes[0]!.slice(upstream.length + 1, -" (fetch)".length);
    return { root, commonDir: binding.gitCommonDir, remote: repositoryUrl(remote), identity: repositoryIdentity(remote) };
  }
  async preview(raw: RepositoryImportInput, requested?: AbortSignal): Promise<RepositoryImportPreview> {
    const input = structuredClone(parse(RepositoryImportInputSchema, raw)), snapshot = this.host.snapshot();
    assertImportPolicy(snapshot);
    if (!input.text.isWellFormed() || !isAbsolute(input.parent) || resolve(input.parent) !== input.parent || /[\0\r\n]/.test(input.parent)) {
      throw new MoguriError("repository_import_input", "Use lossless URL lines and an explicit absolute existing parent folder.");
    }
    const lines = input.text.split(/\r?\n/).map((text, index) => ({ line: index + 1, text: text.trim().replace(/^(?:[-*+\u2022]|\d+[.)])\s+/, "").trim() })).filter((line) => line.text);
    if (!lines.length || lines.length > 100) throw new MoguriError("repository_import_limit", "Review between 1 and 100 nonempty repository URL lines. No entries were truncated.");
    const parent = await sourceRoot(await realpath(input.parent)), signal = AbortSignal.any([AbortSignal.timeout(25_000), ...(requested ? [requested] : [])]);
    const registered = new Map<string, Project[]>(), warnings: string[] = [];
    if (snapshot.projects.length > 1000) throw new MoguriError("repository_import_limit", "The registration inventory exceeds this bounded review. No existing project was silently omitted.", 409);
    for (const project of snapshot.projects) {
      signal.throwIfAborted();
      try {
        const upstream = snapshot.projectConfigurations.find((configuration) => configuration.projectId === project.id)?.values.repo.upstream ?? "origin";
        const checkout = await this.checkout(project.path, upstream, signal);
        if (checkout) registered.set(checkout.identity, [...registered.get(checkout.identity) ?? [], project]);
      } catch (error) {
        signal.throwIfAborted();
        warnings.push(`Existing project ${project.name} could not be matched to a safe Git remote. Its files/registration are unchanged; no duplicate identity was inferred.`);
        console.error("Moguri import registration inspection:", project.id, error instanceof MoguriError ? error.code : "repository_read");
      }
    }
    const seen = new Set<string>(), destinations = new Map<string, string>(), entries: RepositoryImportEntry[] = [];
    for (const line of lines) {
      signal.throwIfAborted();
      let repository: string, identity: string, path: string;
      try { repository = repositoryUrl(line.text); identity = repositoryIdentity(repository); path = join(parent.root, repositoryDirectory(repository)); }
      catch (error) {
        entries.push({ line: line.line, source: "[invalid repository URL]", repository: null, identity: null, path: null, projectId: null,
          disposition: "invalid", diagnostic: failure(error) }); continue;
      }
      const base = { line: line.line, source: line.text, repository, identity, path, projectId: null, diagnostic: null };
      if (seen.has(identity)) { entries.push({ ...base, disposition: "duplicate", diagnostic: "Duplicate URL identity in this list; no second import." }); continue; }
      seen.add(identity);
      const candidates = registered.get(identity) ?? [], existing = candidates.find((project) => project.path === path) ?? (candidates.length === 1 ? candidates[0] : undefined);
      if (candidates.length > 1 && !existing) {
        entries.push({ ...base, disposition: "blocked", diagnostic: `This URL has ${candidates.length} registered checkouts at different roots. Select the intended existing project explicitly; no arbitrary registration was chosen.` }); continue;
      }
      if (existing) { entries.push({ ...base, path: existing.path, projectId: existing.id, disposition: "registered", diagnostic: "Already registered in this profile; existing sessions and drafts are preserved." }); continue; }
      const key = path.normalize("NFC").toLowerCase();
      if (destinations.has(key)) { entries.push({ ...base, disposition: "blocked", diagnostic: "Different repository identities collide at this portable destination. Choose a different parent or import separately." }); continue; }
      destinations.set(key, identity);
      const retained = snapshot.repositoryImports.find((batch) => batch.items.some((item) => item.path === path &&
        (item.status === "running" || item.status === "partial" && !item.inspection)));
      const clone = snapshot.jobs.find((job) => job.projectClone?.path === path && ["running", "waiting_input", "partial"].includes(job.status));
      if (retained || clone) { entries.push({ ...base, disposition: "blocked", diagnostic: `Inspect original ${retained ? `batch ${retained.id}` : `clone job ${clone!.id}`}. Retained uncertain intent is not absence and cannot authorize another clone.` }); continue; }
      let exists = false;
      try { await lstat(path); exists = true; }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
      if (!exists) { entries.push({ ...base, disposition: "clone" }); continue; }
      try {
        const checkout = await this.checkout(path, "origin", signal);
        if (!checkout || checkout.identity !== identity || snapshot.projects.some((project) => project.path === path)) {
          entries.push({ ...base, disposition: "blocked", diagnostic: "Destination exists but is not this exact unregistered checkout. No files will be overwritten and no alternate destination was chosen." });
        } else entries.push({ ...base, disposition: "register", ...checkout, identity, diagnostic: "Existing matching checkout: register only, without cloning, fetching or changing its files." });
      } catch (error) {
        signal.throwIfAborted();
        entries.push({ ...base, disposition: "blocked", diagnostic: `Destination could not be verified. ${failure(error)}`.slice(0, 2000) });
      }
    }
    const current = this.host.snapshot();
    assertImportPolicy(current);
    if (current.policy.revision !== snapshot.policy.revision || current.settings.permissionRevision !== snapshot.settings.permissionRevision ||
      registrations(current) !== registrations(snapshot) || !same(sourceRootSync(parent.root), parent)) throw new MoguriError("repository_import_stale", "The original parent, registrations or policy changed during review. Preview the complete list again.", 409);
    const document = parse(RepositoryImportReviewSchema, { format: "moguri-repository-import", version: 1, profileId: snapshot.profileId,
      input, parent, policyRevision: snapshot.policy.revision, permissionRevision: snapshot.settings.permissionRevision, registrationsDigest: registrations(snapshot), warnings, entries });
    return { document, digest: digest(JSON.stringify(document)) };
  }
  async query(query: RepositoryImportQuery, signal?: AbortSignal): Promise<RepositoryImportResponse> {
    if (query.type === "projects.import.preview") return { type: query.type, preview: await this.preview(query.input, signal) };
    const batch = this.batch(query.batchId);
    return { type: query.type, batch: structuredClone(batch), review: parse(RepositoryImportReviewSchema, JSON.parse(this.store.blob(batch.reviewDigest))) };
  }
  async execute(command: RepositoryImportCommand, finish: WorkspaceFinish): Promise<CommandResult> {
    if (!finish.intent) throw new MoguriError("repository_import_intent", "Import requires its original actual-user command identity.", 409);
    const intent = finish.intent, previous = this.host.snapshot().repositoryImports.find((batch) => batch.commandId === intent.id ||
      batch.items.some((item) => item.inspection?.commandId === intent.id));
    if (previous) {
      const originalDigest = previous.commandId === intent.id ? previous.commandDigest : previous.items.find((item) => item.inspection?.commandId === intent.id)?.inspection?.commandDigest;
      if (originalDigest !== intent.digest) throw new MoguriError("idempotency_conflict", "This command belongs to different original import input/inspection.", 409);
      const inspection = previous.items.find((item) => item.inspection?.commandId === intent.id)?.inspection;
      return finish([], { id: previous.id, ...(inspection ? { revision: inspection.observedRevision + 1 } : {}) });
    }
    if (command.type === "projects.import.acknowledge") {
      const batch = this.batch(command.batchId), item = batch.items.find((item) => item.line === command.line);
      if (batch.status === "running" || batch.revision !== command.expectedRevision || !item || item.status !== "partial" || item.inspection) throw new MoguriError("repository_import_inspection", "Inspect this exact terminal partial item and current batch revision before acknowledging its original uncertainty.", 409);
      const at = new Date().toISOString();
      const items = batch.items.map((entry) => entry.line !== item.line ? entry : { ...entry, inspection: {
        actor: "user" as const, commandId: intent.id, commandDigest: intent.digest, at, observedRevision: batch.revision,
      } });
      return finish([this.event({ ...this.changed(batch, { items }), updatedAt: at })], { id: batch.id, revision: batch.revision + 1 });
    }
    const review = await this.preview(command.input), document = review.document;
    if (review.digest !== command.expectedDigest) throw new MoguriError("repository_import_stale", "The exact list, destinations, registrations, existing checkout or policy changed. Preview again; no import was started.", 409);
    if (document.entries.some((entry) => ["invalid", "blocked"].includes(entry.disposition))) throw new MoguriError("repository_import_invalid", "Correct all invalid/conflicting entries before importing this exact reviewed batch. No partial unreviewed selection was made.", 409);
    const current = this.host.snapshot();
    const concurrent = current.repositoryImports.find((batch) => batch.commandId === intent.id);
    if (concurrent) {
      if (concurrent.commandDigest !== intent.digest) throw new MoguriError("idempotency_conflict", "A concurrent command owns different original input.", 409);
      return finish([], { id: concurrent.id });
    }
    if (current.repositoryImports.some((batch) => batch.status === "running")) throw new MoguriError("repository_import_busy", "One original import batch already owns this profile. Wait or cancel it before starting another.", 409);
    const activePaths = document.entries.filter((entry) => ["clone", "register"].includes(entry.disposition)).map((entry) => entry.path!);
    const leaseRoots = [...new Set([...activePaths, ...[...current.projects.map((project) => project.path),
      ...current.managedWorkspaces.filter((workspace) => workspace.status !== "removed").map((workspace) => workspace.path)]
      .filter((root) => activePaths.some((path) => path === root || path.startsWith(`${root}/`)))])];
    for (const root of leaseRoots) if (this.host.rootBusy(root)) throw new MoguriError("repository_import_busy", "An owned writer holds a reviewed destination or containing project/worktree. No import was started.", 409);
    for (const configuration of current.projectConfigurations) {
      const project = current.projects.find((project) => project.id === configuration.projectId);
      if (project && activePaths.some((path) => localRootsOverlap(project.path, path)) &&
        (configuration.values.deniedFolders.length || configuration.values.readOnlyFolders.length)) throw new MoguriError("repository_import_denied", "Local repository import cannot bypass a containing project's restricted folders.", 403);
    }
    const id = randomUUID(), items = document.entries.map((entry): RepositoryImportItem => {
      if (!entry.repository || !entry.identity || !entry.path || entry.disposition === "invalid" || entry.disposition === "blocked") throw new MoguriError("repository_import_invalid", "The complete reviewed entry is missing.", 409);
      const projectId = entry.disposition === "clone" || entry.disposition === "register" ? randomUUID() : entry.projectId;
      return { line: entry.line, repository: entry.repository, identity: entry.identity, path: entry.path, projectId, disposition: entry.disposition,
        status: entry.disposition === "registered" ? "registered" : entry.disposition === "duplicate" ? "duplicate" : "pending", diagnostic: entry.diagnostic,
        ...(entry.root ? { root: entry.root, commonDir: entry.commonDir, remote: entry.remote } : {}),
        ...(entry.disposition === "clone" ? { clone: { version: 1, projectId: projectId!, repository: entry.repository, path: entry.path,
          parent: document.parent.root, device: document.parent.device, inode: document.parent.inode, policyRevision: document.policyRevision,
          leaseRoots: leaseRoots.filter((root) => root === entry.path || entry.path!.startsWith(`${root}/`)), commandId: intent.id, commandDigest: intent.digest } } : {}) };
    });
    let result: CommandResult | undefined;
    this.host.job((signal, progress, jobId) => this.perform(id, document, signal, progress, jobId), (job) => {
      const now = new Date().toISOString(), batch: RepositoryImportBatch = {
        version: 1, id, profileId: current.profileId, commandId: intent.id, commandDigest: intent.digest,
        inputDigest: this.store.putBlob(JSON.stringify(command.input)), reviewDigest: this.store.putBlob(JSON.stringify(document)), jobId: job.id,
        revision: 0, policyRevision: document.policyRevision, permissionRevision: document.permissionRevision, status: "running",
        cancelRequested: false, leaseRoots, items, createdAt: now, updatedAt: now, diagnostic: null,
      };
      result = finish([this.event(batch), { event_type: "job.started", profile_id: batch.profileId, payload: { job: { ...job, repositoryImportId: id } } }], { id });
    }, {
      completed: () => {
        const batch = this.batch(id);
        if (!batch.items.every(successfulImportItem)) throw new MoguriError("repository_import_partial", "Some repositories failed or have partial work. Successful registrations and original directories were preserved.", 409);
        return [this.event(this.changed(batch, { status: "completed", diagnostic: null }))];
      },
      failed: (error, cancelled) => this.terminal(id, failure(error), cancelled),
    });
    if (!result) throw new MoguriError("repository_import_intent", "The original batch/receipt was not atomically admitted. No work was replayed.", 409);
    return result;
  }
  private guard(batch: RepositoryImportBatch, jobId: string, root: string): void {
    const snapshot = this.host.snapshot(); assertImportPolicy(snapshot);
    if (batch.status !== "running" || snapshot.policy.revision !== batch.policyRevision ||
      snapshot.settings.permissionRevision !== batch.permissionRevision) throw new MoguriError("repository_import_stale", "The original Local import policy/permissions changed. Remaining repositories will not use stale review.", 409);
    if (this.host.rootBusy(root, jobId)) throw new MoguriError("repository_import_busy", "Another owned writer holds this original import destination. No alternative root was selected.", 409);
  }
  private async perform(id: string, review: RepositoryImportPreview["document"], signal: AbortSignal, progress: (text: string) => void, jobId: string): Promise<unknown> {
    for (const original of this.batch(id).items) {
      signal.throwIfAborted();
      if (original.status !== "pending") continue;
      this.guard(this.batch(id), jobId, original.path);
      if (!same(sourceRootSync(review.parent.root), review.parent)) throw new MoguriError("repository_import_stale", "The original parent directory changed. No different destination was used.", 409);
      this.updateItem(id, original.line, { status: "running", diagnostic: null });
      let created = false;
      try {
        const recheck = () => this.guard(this.batch(id), jobId, original.path);
        progress(`Repository ${original.line}: ${original.repository}`);
        if (original.disposition === "clone") await cloneProject(original.clone!, signal, progress, recheck, () => { created = true; });
        else {
          const checkout = await this.checkout(original.path, "origin", signal);
          if (!checkout || checkout.identity !== original.identity || !same(checkout.root, original.root) ||
            checkout.commonDir !== original.commonDir || checkout.remote !== original.remote) throw new MoguriError("repository_import_stale", "The reviewed existing checkout/root/remote changed. No project was registered.", 409);
        }
        signal.throwIfAborted(); recheck();
        const snapshot = this.host.snapshot();
        if (snapshot.projects.some((project) => project.path === original.path)) throw new MoguriError("repository_import_stale", "Another client registered this destination after review. Its registration was preserved, not replaced.", 409);
        const project: Project = { id: original.projectId!, path: original.path,
          name: projectIdentifier(basename(original.path), snapshot.projects.map((project) => project.name)) };
        this.updateItem(id, original.line, { status: original.disposition === "clone" ? "imported" : "registered", diagnostic: null },
          [{ event_type: "project.added", profile_id: snapshot.profileId, project_id: project.id, payload: { project } }]);
      } catch (error) {
        const diagnostic = `${created ? "Possible partial clone; original files were preserved. " : ""}${failure(error)}`.slice(0, 2000);
        console.error("Moguri repository import item:", id, original.line, diagnostic);
        this.updateItem(id, original.line, { status: created ? "partial" : signal.aborted ? "cancelled" : "failed", diagnostic });
        if (signal.aborted) throw error;
      }
    }
    return { batchId: id, diagnostic: "Inspect each original repository outcome; no item was replayed." };
  }
  private terminal(id: string, diagnostic: string, cancelled: boolean): { status: "failed" | "cancelled" | "partial"; error: string; events: EventInput[] } {
    const batch = this.batch(id), items: RepositoryImportItem[] = batch.items.map((item) =>
      item.status === "pending" ? { ...item, status: "cancelled", diagnostic: "Not dispatched. The original batch ended; no clone/import was replayed." } :
      item.status === "running" ? { ...item, status: "partial", diagnostic: "Original dispatch may have filesystem effects. Inspect this exact destination; no work was replayed." } : item);
    const effects = items.some((item) => item.status === "partial" || item.disposition === "clone" && item.status === "imported" || item.disposition === "register" && item.status === "registered");
    const status = effects ? "partial" : cancelled ? "cancelled" : "failed";
    return { status, error: diagnostic, events: [this.event(this.changed(batch, { status, items, cancelRequested: batch.cancelRequested || cancelled, diagnostic }))] };
  }
  cancelEvents(jobId: string): EventInput[] {
    const batch = this.host.snapshot().repositoryImports.find((batch) => batch.jobId === jobId);
    return batch?.status === "running" && !batch.cancelRequested ? [this.event(this.changed(batch, { cancelRequested: true }))] : [];
  }
  recover(): EventInput[] {
    return this.host.snapshot().repositoryImports.filter((batch) => batch.status === "running").flatMap((batch) =>
      this.terminal(batch.id, "Service restarted. Original destinations/results remain inspectable; pending items and possible effects were not replayed.", true).events);
  }
}
