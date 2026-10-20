import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import {
  legacyArtifact, MoguriError, PROFILE_ID, type ArtifactCommand, type ArtifactExport, type ArtifactKind, type ArtifactQuery,
  type ArtifactResponse, type ArtifactSource, type ArtifactSourcePreview, type CommandResult, type EventInput, type ProjectArtifactChoice,
  type ProjectArtifactPreview, type RetainedArtifact, type Session, type Snapshot, type StoredEvent,
} from "../../../packages/protocol/src/index.ts";
import { digest, EventStore } from "./store.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";

interface Host { snapshot(): Snapshot; events(): StoredEvent[]; closingProject(id: string): boolean }
export class ArtifactRuntime {
  constructor(private readonly store: EventStore, private readonly host: Host) {}
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
      path, contentDigest: this.content(text), revision: 0, status: "active", createdAt: now, updatedAt: now, origin, edited: false, sources };
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
  private event(artifact: RetainedArtifact): EventInput { return { event_type: "artifact.revised", profile_id: PROFILE_ID, project_id: artifact.projectId, payload: { artifact } }; }
  private revisions(id: string): RetainedArtifact[] {
    this.artifact(id);
    return this.host.events().flatMap((event) => event.event_type === "artifact.saved" && event.payload.artifact.id === id ? [legacyArtifact(event.payload.artifact, event.id)] :
      event.event_type === "artifact.revised" && event.payload.artifact.id === id ? [event.payload.artifact] : []);
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
  removal(projectId: string, choice?: ProjectArtifactChoice): { events: EventInput[]; forget: string[] } {
    const preview = this.preview(projectId);
    if (!choice && preview.artifacts.length) throw new MoguriError("artifact_choice", "Preview this project's artifacts and explicitly choose retain, export then delete, or delete before removal.", 409);
    if (choice && choice.expectedDigest !== preview.digest) throw new MoguriError("artifact_conflict", "The artifact set changed. Review a fresh removal preview; nothing was deleted.", 409);
    if (choice?.action === "export") {
      const exported = this.export(preview.artifacts.map(({ id }) => this.artifact(id)), "moguri-project-artifacts.json");
      if (choice.exportedDigest !== exported.digest) throw new MoguriError("artifact_export", "Retrieve and save the exact export before explicitly confirming its digest for deletion.", 409);
    }
    if (choice?.action === "retain") return { events: preview.artifacts.map(({ id }) => { const artifact = this.artifact(id); return this.event({ ...artifact, projectId: null, revision: artifact.revision + 1, updatedAt: new Date().toISOString() }); }), forget: [] };
    return { events: preview.artifacts.map(({ id }): EventInput => ({ event_type: "artifact.deleted", profile_id: PROFILE_ID, payload: { artifactId: id } })), forget: preview.artifacts.map(({ id }) => id) };
  }
  query(query: ArtifactQuery): ArtifactResponse {
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
  execute(command: ArtifactCommand, finish: WorkspaceFinish): CommandResult {
    if (command.type === "artifact.create" || command.type === "artifact.promote") {
      const session = command.sessionId ? this.session(command.sessionId) : { id: null, projectId: command.type === "artifact.create" ? command.projectId ?? null : null, workspaceId: null };
      if (session.projectId && !this.host.snapshot().projects.some((project) => project.id === session.projectId)) throw new MoguriError("project_missing", "Choose an existing artifact project or explicit profile scope.", 404);
      if (command.type === "artifact.create" && command.projectId !== undefined && command.projectId !== session.projectId) throw new MoguriError("artifact_scope", "Source session and requested artifact owner differ. Create explicitly without a session for another scope.", 409);
      const preview = command.type === "artifact.promote" ? this.source(command.sessionId, command.sourceKind, command.sourceId) : null;
      if (command.type === "artifact.promote" && preview?.digest !== command.expectedDigest) throw new MoguriError("artifact_source_changed", "Review the exact canonical source before retaining it.", 409);
      const artifact = this.create(session, command.kind, command.name, preview?.text ?? (command.type === "artifact.create" ? command.text : ""),
        command.type === "artifact.promote" ? command.sourceKind : "manual", preview ? [preview.source] : []);
      return finish([this.event(artifact)], { id: artifact.id, revision: 0 });
    }
    const artifact = this.artifact(command.artifactId);
    this.writable(artifact.projectId);
    if (artifact.revision !== command.expectedRevision) throw new MoguriError("revision_conflict", "Artifact changed. Reload before editing, archiving or deleting it.", 409);
    if (command.type === "artifact.delete") return finish([{ event_type: "artifact.deleted", profile_id: PROFILE_ID, payload: { artifactId: artifact.id } }], { id: artifact.id }, { artifacts: [artifact.id] });
    if (!Object.keys(command.changes).length) throw new MoguriError("artifact_changes", "Choose an actual title, text or archive change.");
    const updated: RetainedArtifact = { ...artifact, revision: artifact.revision + 1, updatedAt: new Date().toISOString(),
      ...(command.changes.name !== undefined ? { name: this.named(command.changes.name) } : {}),
      ...(command.changes.status ? { status: command.changes.status } : {}),
      ...(command.changes.text !== undefined ? { contentDigest: this.content(command.changes.text), edited: artifact.edited || digest(command.changes.text) !== artifact.contentDigest } : {}) };
    return finish([this.event(updated)], { id: artifact.id, revision: updated.revision });
  }
}
