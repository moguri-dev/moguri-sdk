import { createHash, randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import {
  legacyArtifact, normalizeArtifact, parse, ArtifactMaterializationSchema, MoguriError, PROFILE_ID, type ArtifactCommand, type ArtifactExport, type ArtifactKind, type ArtifactQuery,
  type ArtifactResponse, type ArtifactSource, type ArtifactSourcePreview, type CommandResult, type EventInput, type ProjectArtifactChoice,
  type ProjectArtifactPreview, type RetainedArtifact, type Session, type Snapshot, type StoredEvent, type ArtifactMaterializationPreview, type ArtifactMaterialization,
  type ArtifactMaterializeOptions, type CapabilityJob, type Project,
} from "../../../packages/protocol/src/index.ts";
import { digest, EventStore } from "./store.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import type { ProjectService } from "./project-service.ts";
import { assertFolderName, folderPolicy } from "./project-policy.ts";
import { writeArtifactExport } from "./artifact-export.ts";

interface Host {
  snapshot(): Snapshot; events(): StoredEvent[]; closingProject(id: string): boolean; wake(): void;
  root(projectId: string, workspaceId: string | null): Project;
  assertRoot(projectId: string, workspaceId: string | null): Promise<void>;
  projects(): ProjectService;
  job(projectId: string, workspaceId: string | null, execute: (signal: AbortSignal, progress: (message: string) => void, id: string) => Promise<unknown>, start: (job: CapabilityJob) => void, settled: () => void): string;
}
export class ArtifactRuntime {
  private busy = new Set<string>();
  constructor(private readonly store: EventStore, private readonly host: Host) {}
  isBusy(projectId: string, workspaceId?: string | null): boolean { return this.busy.has(`${projectId}:${workspaceId ?? "base"}`); }
  private artifact(id: string): RetainedArtifact {
    const artifact = this.host.snapshot().artifacts.find((artifact) => artifact.id === id);
    if (!artifact) throw new MoguriError("artifact_missing", "Artifact is missing, deleted or outside this profile.", 404);
    return artifact;
  }
  private session(id: string): Session {
    const session = this.host.snapshot().sessions.find((session) => session.id === id);
    if (!session) throw new MoguriError("session_missing", "Choose an existing source session.", 404);
    return session;
  }
  private writable(projectId: string | null): void {
    if (projectId && this.host.closingProject(projectId)) throw new MoguriError("project_removing", "This project is being removed. No artifact was added or changed.", 409);
  }
  private content(text: string): string {
    if (Buffer.byteLength(text) > 128 * 1024) throw new MoguriError("artifact_limit", "Artifact text exceeds 128 KiB. Retain an explicitly selected smaller document; nothing was truncated.");
    return this.store.putBlob(text);
  }
  private named(name: string): string {
    const value = name.trim();
    if (!value || value.length > 160 || /[\u0000-\u001f\u007f]/.test(value)) throw new MoguriError("artifact_name", "Use a non-empty artifact name of at most 160 characters without control characters.");
    return value;
  }
  private create(session: { id: string | null; projectId: string | null; workspaceId: string | null }, kind: ArtifactKind, name: string, text: string, origin: RetainedArtifact["origin"], sources: ArtifactSource[], path: string | null = null): RetainedArtifact {
    this.writable(session.projectId);
    const now = new Date().toISOString();
    return { id: randomUUID(), projectId: session.projectId, workspaceId: session.workspaceId, originSessionId: session.id, kind, name: this.named(name),
      path, folderId: null, workItemId: null, contentDigest: this.content(text), revision: 0, status: "active", createdAt: now, updatedAt: now, origin, edited: false, sources };
  }
  private associations(projectId: string | null, values: { folderId?: string | null; workItemId?: string | null }) {
    const folderId = values.folderId ?? null, workItemId = values.workItemId ?? null;
    if (folderId && !this.host.snapshot().projectFolders.some((folder) => folder.id === folderId)) throw new MoguriError("artifact_folder", "Choose an existing profile navigation folder, or no folder.");
    if (workItemId && (!projectId || !this.host.snapshot().issues.some((issue) => issue.id === workItemId && issue.projectId === projectId))) throw new MoguriError("artifact_work_item", "Choose a work item from this artifact's own project, or clear the association.");
    return { folderId, workItemId };
  }
  capture(session: Session, path: string, text: string): RetainedArtifact {
    return this.create(session, "plan", basename(path), text, "file", [{ eventId: null, sessionId: session.id, messageId: null, actor: "unknown", modelId: null, outcome: null, contentDigest: digest(text) }], path);
  }
  answerEvents(snapshot: Snapshot, events: StoredEvent[]): EventInput[] {
    if (!snapshot.settings.values.artifacts.retainAnswers) return [];
    return events.flatMap((event) => {
      if (event.event_type !== "question.answered") return [];
      const question = snapshot.questions.find((question) => question.id === event.payload.questionId);
      if (!question) throw new MoguriError("question_missing", "The exact answered question is not retained; no artifact was invented.", 409);
      const answer = event.payload.answer, text = `# Question\n\n${question.question}\n\n# Answer\n\n${answer.text}\n`;
      const artifact = this.create({ id: question.sessionId, projectId: question.projectId, workspaceId: question.workspaceId }, "answer", `Answer: ${question.question.replace(/\s+/g, " ").slice(0, 140)}`, text, "question", [
        { eventId: question.sourceEventId, sessionId: question.sessionId, messageId: question.callId, actor: "model", modelId: question.modelId, outcome: null, contentDigest: digest(question.question) },
        { eventId: event.id, sessionId: question.sessionId, messageId: null, actor: answer.actor, modelId: answer.modelId, outcome: null, contentDigest: digest(answer.text) },
      ]);
      return [this.event({ ...artifact, questionId: question.id })];
    });
  }
  checkpointEvents(snapshot: Snapshot, events: StoredEvent[]): EventInput[] {
    return events.flatMap((event) => {
      if (event.event_type !== "budget.blocked") return [];
      const session = snapshot.sessions.find((session) => session.id === event.payload.ownerSessionId);
      if (!session) throw new MoguriError("budget_checkpoint", "The budget checkpoint has no actual owning session. No source facts were invented.", 409);
      const text = `# Budget checkpoint\n\n${event.payload.diagnostic}\n\n` +
        `Session: ${session.id}\nStep: ${event.payload.stepId}\nRemaining tokens: ${event.payload.remainingTokens ?? "unlimited or unknown"}\nRemaining estimated USD: ${event.payload.remainingUsd ?? "unlimited or unknown"}\n\n` +
        "Existing work, pending diff and source events were preserved. This checkpoint performed no extra model call or Git commit. A commit needs accepted changes, qualified transport and explicit Git authorization; no clean final commit is claimed.\n";
      return [this.event(this.create(session, "report", "Budget checkpoint", text, "checkpoint", [{ eventId: event.id, sessionId: event.payload.sessionId, messageId: null, actor: "tool", modelId: null, outcome: "blocked", contentDigest: digest(text) }]))];
    });
  }
  private event(artifact: RetainedArtifact): EventInput { return { event_type: "artifact.revised", profile_id: PROFILE_ID, project_id: artifact.projectId, payload: { artifact } }; }
  private revisions(id: string): RetainedArtifact[] {
    this.artifact(id);
    return this.host.events().flatMap((event) => event.event_type === "artifact.saved" && event.payload.artifact.id === id ? [legacyArtifact(event.payload.artifact, event.id)] :
      event.event_type === "artifact.revised" && event.payload.artifact.id === id ? [normalizeArtifact(event.payload.artifact)] : []);
  }
  private source(sessionId: string, kind: "message" | "tool", id: string): ArtifactSourcePreview {
    this.session(sessionId);
    const event = this.host.events().find((event) => event.session_id === sessionId && (kind === "tool" ?
      event.event_type === "tool.completed" && event.payload.call.id === id :
      event.event_type === "model.completed" && event.payload.message.id === id ||
      (event.event_type === "turn.started" || event.event_type === "steer.applied") && event.payload.item.id === id));
    if (!event) throw new MoguriError("artifact_source", "Choose a canonical completed message or terminal tool result. A streamed fragment is not a completed source.", 409);
    let text: string, actor: ArtifactSource["actor"], modelId: string | null = null, outcome: string | null = null;
    if (event.event_type === "tool.completed") { text = event.payload.text; actor = "tool"; outcome = event.payload.outcome; }
    else if (event.event_type === "model.completed") { text = event.payload.message.text; actor = "model"; modelId = event.payload.usage.modelId; outcome = event.payload.usage.outcome; }
    else if (event.event_type === "turn.started" || event.event_type === "steer.applied") { text = event.payload.item.text; actor = "user"; }
    else throw new MoguriError("artifact_source", "This source has no supported canonical text.");
    if (Buffer.byteLength(text) > 128 * 1024) throw new MoguriError("artifact_limit", "This source exceeds 128 KiB. Retain an explicitly selected manual excerpt; no source text was silently dropped.");
    const source: ArtifactSource = { eventId: event.id, sessionId, messageId: id, actor, modelId, outcome, contentDigest: digest(text) };
    return { text, source, digest: digest(JSON.stringify({ source, text, kind })) };
  }
  preview(projectId: string): ProjectArtifactPreview {
    if (!this.host.snapshot().projects.some((project) => project.id === projectId)) throw new MoguriError("project_missing", "Project is outside this profile.", 404);
    const artifacts = this.host.snapshot().artifacts.filter((artifact) => artifact.projectId === projectId).sort((a, b) => a.id.localeCompare(b.id));
    const records = artifacts.map(({ id, name, kind, revision, status }) => ({ id, name, kind, revision, status }));
    return { projectId, artifacts: records, digest: digest(JSON.stringify({ projectId, artifacts: artifacts.map((artifact) => ({ ...artifact, revisions: this.revisions(artifact.id).map(({ revision, contentDigest }) => ({ revision, contentDigest })) })) })) };
  }
  private export(artifacts: RetainedArtifact[], filename: string): ArtifactExport {
    let bytes = 0;
    const documents = artifacts.map((artifact) => ({ artifact, revisions: this.revisions(artifact.id).map((revision) => {
      const text = this.store.blob(revision.contentDigest);
      bytes += Buffer.byteLength(text) + Buffer.byteLength(JSON.stringify(revision));
      if (bytes > 8 * 1024 * 1024) throw new MoguriError("artifact_export_limit", "The exact export exceeds 8 MiB. Export documents individually or retain them; nothing was truncated.");
      return { artifact: revision, text };
    }) }));
    const text = JSON.stringify({ format: "moguri-artifacts", schemaVersion: 1, documents }, null, 2);
    if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new MoguriError("artifact_export_limit", "The exact export exceeds 8 MiB. Export documents individually or retain them; nothing was truncated.");
    return { filename, mediaType: "application/json", text, digest: digest(text) };
  }
  async removal(projectId: string, choice?: ProjectArtifactChoice): Promise<{ events: EventInput[]; forget: string[] }> {
    const preview = this.preview(projectId);
    if (!choice && preview.artifacts.length) throw new MoguriError("artifact_choice", "Preview this project's artifacts and explicitly choose retain, export/materialize then delete, or delete before removal.", 409);
    if (choice && choice.expectedDigest !== preview.digest) throw new MoguriError("artifact_conflict", "The artifact set changed. Review a fresh removal preview; nothing was deleted.", 409);
    if (choice?.action === "export") {
      const exported = this.export(preview.artifacts.map(({ id }) => this.artifact(id)), "moguri-project-artifacts.json");
      if (choice.exportedDigest !== exported.digest) throw new MoguriError("artifact_export", "Retrieve and save the exact export before explicitly confirming its digest for deletion.", 409);
    }
    if (choice?.action === "materialize") {
      if (!choice.materializationId) throw new MoguriError("artifact_materialization", "Complete and inspect an exact repository materialization before deleting stored copies.", 409);
      const { job, result } = this.materialization(choice.materializationId);
      if (job.status !== "completed" || !result || job.projectId !== projectId || result.setDigest !== preview.digest) throw new MoguriError("artifact_materialization", "This materialization is not a completed copy of the current exact artifact set. Stored copies were preserved.", 409);
      await this.verifyCopy(result);
      if (result.commit) await this.host.projects().verifyArtifactCommit(this.host.root(projectId, result.workspaceId), result.path, result.commit, AbortSignal.timeout(30_000));
      if (this.preview(projectId).digest !== preview.digest) throw new MoguriError("artifact_conflict", "The artifact set changed during copy verification. Stored copies were preserved.", 409);
    }
    if (choice?.action === "retain") return { events: preview.artifacts.map(({ id }) => { const artifact = this.artifact(id); return this.event({ ...artifact, projectId: null, workItemId: null, revision: artifact.revision + 1, updatedAt: new Date().toISOString() }); }), forget: [] };
    return { events: preview.artifacts.map(({ id }): EventInput => ({ event_type: "artifact.deleted", profile_id: PROFILE_ID, payload: { artifactId: id } })), forget: preview.artifacts.map(({ id }) => id) };
  }
  private async destination(projectId: string, workspaceId: string | null): Promise<{ project: Project; rootIdentity: string }> {
    const project = this.host.root(projectId, workspaceId), settings = this.host.projects().configuration(projectId).values;
    assertFolderName("artifacts", true, folderPolicy(settings));
    await this.host.assertRoot(projectId, workspaceId);
    const metadata = await lstat(project.path, { bigint: true });
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(project.path) !== project.path) throw new MoguriError("artifact_root", "The selected repository root is not a canonical directory. No fallback root was used.", 409);
    const directory = join(project.path, "artifacts");
    const existing = await lstat(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink() || await realpath(directory) !== directory)) throw new MoguriError("artifact_directory", "The artifacts destination must be a real canonical directory, not a symlink.", 409);
    return { project, rootIdentity: digest(JSON.stringify({ root: project.path, device: String(metadata.dev), inode: String(metadata.ino) })) };
  }
  private async verifyCopy(expected: ArtifactMaterializationPreview): Promise<void> {
    if (expected.path !== `artifacts/moguri-${expected.setDigest}.json`) throw new MoguriError("artifact_copy_path", "The materialization is not an exact owned repository-copy path. Stored documents were preserved.", 409);
    const { project, rootIdentity } = await this.destination(expected.projectId, expected.workspaceId);
    if (project.path !== expected.root || rootIdentity !== expected.rootIdentity) throw new MoguriError("artifact_root_changed", "The materialized copy's root identity changed. Stored copies were preserved.", 409);
    assertFolderName(expected.path, false, folderPolicy(this.host.projects().configuration(expected.projectId).values));
    const path = join(project.path, expected.path);
    const existing = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (!existing?.isFile() || existing.isSymbolicLink()) throw new MoguriError("artifact_copy_changed", "The exact materialized copy is missing or changed. Stored documents were preserved.", 409);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const metadata = await file.stat({ bigint: true }), owner = process.getuid?.();
      if (!metadata.isFile() || owner === undefined || metadata.uid !== BigInt(owner) || metadata.mode & 0o077n || metadata.size !== BigInt(expected.bytes) || metadata.size > 8n * 1024n * 1024n) throw new MoguriError("artifact_copy_changed", "The materialized copy is not the exact private user-owned file. Stored documents were preserved.", 409);
      const bytes = Buffer.alloc(Number(metadata.size) + 1), { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead > 8 * 1024 * 1024 || createHash("sha256").update(bytes.subarray(0, bytesRead)).digest("hex") !== expected.fileDigest) throw new MoguriError("artifact_copy_changed", "The materialized copy's bytes changed. Stored documents were preserved.", 409);
      await file.sync();
      const current = await lstat(path, { bigint: true });
      if (current.dev !== metadata.dev || current.ino !== metadata.ino || current.size !== metadata.size || current.mtimeNs !== metadata.mtimeNs || current.uid !== metadata.uid || current.mode !== metadata.mode || current.isSymbolicLink()) throw new MoguriError("artifact_copy_changed", "The materialized copy was replaced or changed during verification. Stored documents were preserved.", 409);
    } finally { await file.close(); }
    const directory = await open(join(project.path, "artifacts"), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  }
  private async materializePreview(projectId: string, options: ArtifactMaterializeOptions): Promise<ArtifactMaterializationPreview> {
    const preview = this.preview(projectId);
    if (!preview.artifacts.length) throw new MoguriError("artifact_empty", "This project has no retained artifacts to materialize.");
    const document = this.export(preview.artifacts.map(({ id }) => this.artifact(id)), "moguri-project-artifacts.json"), workspaceId = options.workspaceId ?? null;
    const { project, rootIdentity } = await this.destination(projectId, workspaceId), configuration = this.host.projects().configuration(projectId);
    const path = `artifacts/moguri-${preview.digest}.json`;
    assertFolderName(path, true, folderPolicy(configuration.values));
    const commit = options.commitBranch ? await this.host.projects().artifactCommitPreview(project, options.commitBranch, AbortSignal.timeout(30_000)) : null;
    const value = { projectId, workspaceId, root: project.path, rootIdentity, configurationRevision: configuration.revision, path, setDigest: preview.digest, fileDigest: document.digest,
      count: preview.artifacts.length, bytes: Buffer.byteLength(document.text), commit };
    const result = { ...value, digest: digest(JSON.stringify(value)) };
    const existing = await lstat(join(project.path, path)).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (existing) await this.verifyCopy(result);
    return result;
  }
  private materialization(jobId: string): { job: CapabilityJob; result: ArtifactMaterialization | null } {
    const job = this.host.snapshot().jobs.find((job) => job.id === jobId && job.kind === "project.artifacts.materialize");
    if (!job) throw new MoguriError("artifact_materialization", "Choose a materialization job from this profile.", 404);
    return { job, result: job.status === "completed" && job.resultDigest ? parse(ArtifactMaterializationSchema, JSON.parse(this.store.blob(job.resultDigest))) : null };
  }
  private assertIdle(projectId: string, workspaceId: string | null): void {
    const snapshot = this.host.snapshot();
    if (this.isBusy(projectId, workspaceId) || (workspaceId ? snapshot.blockedWorkspaces.includes(workspaceId) : snapshot.blockedProjects.includes(projectId)) ||
      snapshot.sessions.some((session) => session.projectId === projectId && session.workspaceId === workspaceId && session.turnId) ||
      snapshot.terminals.some((terminal) => terminal.projectId === projectId && terminal.workspaceId === workspaceId && ["running", "stopping", "unconfirmed"].includes(terminal.status)) ||
      snapshot.jobs.some((job) => job.projectId === projectId && (job.workspaceId ?? null) === workspaceId && ["running", "waiting_input"].includes(job.status))) throw new MoguriError("workspace_busy", "Finish owned work in this exact root before materializing artifacts.", 409);
  }
  async query(query: ArtifactQuery): Promise<ArtifactResponse> {
    if (query.type === "project.artifacts.materialize.preview") return { type: query.type, preview: await this.materializePreview(query.projectId, query) };
    if (query.type === "artifact.materialization") return { type: query.type, ...this.materialization(query.jobId) };
    if (query.type === "artifact.source") return { type: query.type, preview: this.source(query.sessionId, query.sourceKind, query.sourceId) };
    if (query.type === "project.artifacts.preview") return { type: query.type, preview: this.preview(query.projectId) };
    if (query.type === "project.artifacts.export") {
      const preview = this.preview(query.projectId);
      return { type: query.type, preview, export: this.export(preview.artifacts.map(({ id }) => this.artifact(id)), "moguri-project-artifacts.json") };
    }
    const artifact = this.artifact(query.artifactId);
    if (query.type === "artifact.export") return { type: query.type, export: this.export([artifact], `moguri-${artifact.kind}-${artifact.id}.json`) };
    if (query.type === "artifact.history") {
      const revisions = this.revisions(artifact.id).slice().reverse(), end = query.offset + query.limit;
      return { type: query.type, revisions: revisions.slice(query.offset, end), nextOffset: end < revisions.length ? end : null };
    }
    const selected = query.revision === undefined ? artifact : this.revisions(artifact.id).find((artifact) => artifact.revision === query.revision);
    if (!selected) throw new MoguriError("artifact_revision", "This content revision is not retained.", 404);
    return { type: query.type, artifact: selected, text: this.store.blob(selected.contentDigest) };
  }
  async execute(command: ArtifactCommand, finish: WorkspaceFinish): Promise<CommandResult> {
    if (command.type === "project.artifacts.materialize") {
      this.writable(command.projectId);
      const preview = await this.materializePreview(command.projectId, command);
      if (preview.digest !== command.expectedDigest) throw new MoguriError("artifact_review_changed", "The source set, root, policy or commit base changed. Review a new materialization; nothing was written.", 409);
      this.assertIdle(preview.projectId, preview.workspaceId);
      const key = `${preview.projectId}:${preview.workspaceId ?? "base"}`; this.busy.add(key);
      let response: CommandResult | undefined;
      try {
        this.host.job(preview.projectId, preview.workspaceId, async (signal, progress, jobId) => {
          let attempted = false;
          try {
            signal.throwIfAborted();
            if ((await this.materializePreview(preview.projectId, command)).digest !== preview.digest) throw new MoguriError("artifact_review_changed", "Materialization review changed before effects; inspect and review again.", 409);
            const document = this.export(this.preview(preview.projectId).artifacts.map(({ id }) => this.artifact(id)), "moguri-project-artifacts.json");
            if (document.digest !== preview.fileDigest) throw new MoguriError("artifact_review_changed", "Artifact source content changed before effects.", 409);
            signal.throwIfAborted(); attempted = true;
            await mkdir(join(preview.root, "artifacts"), { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
            const root = await this.destination(preview.projectId, preview.workspaceId);
            if (root.rootIdentity !== preview.rootIdentity) throw new MoguriError("artifact_root_changed", "Repository root identity changed before publication.", 409);
            const existing = await lstat(join(preview.root, preview.path)).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
            if (!existing) await writeArtifactExport(join(preview.root, preview.path), document, signal);
            await this.verifyCopy(preview);
            progress("Exact artifact history copy persisted and verified.");
            const commit = preview.commit ? await this.host.projects().artifactCommit(root.project, preview.path, document.text, preview.commit, signal) : null;
            await this.verifyCopy(preview);
            if (commit) await this.host.projects().verifyArtifactCommit(root.project, preview.path, commit, signal);
            signal.throwIfAborted();
            return { ...preview, jobId, commit } satisfies ArtifactMaterialization;
          } catch (error) {
            if (!attempted) throw error;
            throw new MoguriError("artifact_materialize_partial", `Artifact materialization is partial. Inspect ${preview.path} and any requested local branch before retrying; stored documents were preserved. ${error instanceof Error ? error.message : "Filesystem/Git outcome unconfirmed."}`, 409);
          }
        }, (job) => { response = finish([{ event_type: "job.started", profile_id: PROFILE_ID, project_id: preview.projectId, payload: { job: { ...job, materialization: preview } } }], { id: job.id }); },
        () => { this.busy.delete(key); this.host.wake(); });
        if (!response) throw new Error("Materialization job intent was not durably acknowledged.");
        return response;
      } catch (error) { this.busy.delete(key); throw error; }
    }
    if (command.type === "artifact.create" || command.type === "artifact.promote") {
      const session = command.sessionId ? this.session(command.sessionId) : { id: null, projectId: command.type === "artifact.create" ? command.projectId ?? null : null, workspaceId: null };
      if (session.projectId && !this.host.snapshot().projects.some((project) => project.id === session.projectId)) throw new MoguriError("project_missing", "Choose an existing artifact project or explicit profile scope.", 404);
      if (command.type === "artifact.create" && command.projectId !== undefined && command.projectId !== session.projectId) throw new MoguriError("artifact_scope", "Source session and requested artifact owner differ. Create explicitly without a session for another scope.", 409);
      const preview = command.type === "artifact.promote" ? this.source(command.sessionId, command.sourceKind, command.sourceId) : null;
      if (command.type === "artifact.promote" && preview?.digest !== command.expectedDigest) throw new MoguriError("artifact_source_changed", "Review the exact canonical source before retaining it.", 409);
      const associations = command.type === "artifact.create" ? this.associations(session.projectId, command) : { folderId: null, workItemId: null };
      const artifact = this.create(session, command.kind, command.name, preview?.text ?? (command.type === "artifact.create" ? command.text : ""),
        command.type === "artifact.promote" ? command.sourceKind : "manual", preview ? [preview.source] : []);
      const associated = { ...artifact, ...associations };
      return finish([this.event(associated)], { id: artifact.id, revision: 0 });
    }
    const artifact = this.artifact(command.artifactId);
    this.writable(artifact.projectId);
    if (artifact.revision !== command.expectedRevision) throw new MoguriError("revision_conflict", "Artifact changed. Reload before editing, archiving or deleting it.", 409);
    if (command.type === "artifact.delete") return finish([{ event_type: "artifact.deleted", profile_id: PROFILE_ID, payload: { artifactId: artifact.id } }], { id: artifact.id }, { artifacts: [artifact.id] });
    if (!Object.keys(command.changes).length) throw new MoguriError("artifact_changes", "Choose an actual title, text or archive change.");
    const updated: RetainedArtifact = { ...artifact, revision: artifact.revision + 1, updatedAt: new Date().toISOString(),
      ...this.associations(artifact.projectId, { folderId: command.changes.folderId === undefined ? artifact.folderId : command.changes.folderId, workItemId: command.changes.workItemId === undefined ? artifact.workItemId : command.changes.workItemId }),
      ...(command.changes.name !== undefined ? { name: this.named(command.changes.name) } : {}),
      ...(command.changes.status ? { status: command.changes.status } : {}),
      ...(command.changes.text !== undefined ? { contentDigest: this.content(command.changes.text), edited: artifact.edited || digest(command.changes.text) !== artifact.contentDigest } : {}) };
    return finish([this.event(updated)], { id: artifact.id, revision: updated.revision });
  }
}
