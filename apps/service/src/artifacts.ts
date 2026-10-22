import { createHash, randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import {
  activeCompound, activeDecision, decisionEvidence, legacyArtifact, normalizeArtifact, parse, ArtifactMaterializationSchema, MoguriError, type ArtifactCommand, type ArtifactExport, type ArtifactKind, type ArtifactQuery,
  type ArtifactResponse, type ArtifactSource, type ArtifactSourcePreview, type CommandResult, type EventInput, type ProjectArtifactChoice,
  type ProjectArtifactPreview, type RetainedArtifact, type Session, type Snapshot, type StoredEvent, type ArtifactMaterializationPreview, type ArtifactMaterialization,
  type ArtifactMaterializeOptions, type CapabilityJob, type Project, type CandidatePatch, type SandboxPublication,
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
  foreignRootBusy(root: string): boolean;
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
  capture(session: Session, path: string, text: string, source?: ArtifactSource): RetainedArtifact {
    return this.create(session, "plan", basename(path), text, "file", [source ?? { eventId: null, sessionId: session.id, messageId: null, actor: "unknown", modelId: null, outcome: null, contentDigest: digest(text) }], path);
  }
  candidate(session: Session, text: string, summary: string, patch: CandidatePatch, sources?: ArtifactSource[]): RetainedArtifact {
    return this.create(session, "report", `Candidate: ${summary.replace(/\s+/g, " ").slice(0, 140)}`, text, sources ? "message" : "manual", sources ? structuredClone(sources) : [
      { eventId: null, sessionId: session.id, messageId: null, actor: "unknown", modelId: null, outcome: "user-imported-proposal", contentDigest: digest(JSON.stringify(patch)) },
    ]);
  }
  generation(session: Session, text: string, task: string, purpose: "generation" | "roles" | "compound" | "winddown" = "generation"): RetainedArtifact {
    return this.create(session, "report", `${purpose === "winddown" ? "Wind-down" : purpose === "compound" ? "Compound" : purpose === "roles" ? "Roles" : "Generation"}: ${task.replace(/\s+/g, " ").slice(0, 140)}`, text, "manual", [
      { eventId: null, sessionId: session.id, messageId: null, actor: "user", modelId: null, outcome: purpose === "winddown" ? "reserved-winddown-policy" : purpose === "compound" ? "reviewed-compound-request" : purpose === "roles" ? "owned-role-request" : "generation-request", contentDigest: digest(task) },
      { eventId: null, sessionId: session.id, messageId: null, actor: "unknown", modelId: null, outcome: "reviewed-source-snapshot", contentDigest: digest(text) },
    ]);
  }
  decision(session: Session, text: string): RetainedArtifact {
    return this.create(session, "report", "Decision-provider review", text, "message", [
      { eventId: null, sessionId: session.id, messageId: null, actor: "unknown", modelId: null, outcome: "original-owned-decision-input-not-user-answer", contentDigest: digest(text) },
    ]);
  }
  nativeExecution(session: Session, id: string, inputDigest: string): RetainedArtifact {
    const text = JSON.stringify({ format: "moguri-native-execution-report", version: 1, executionId: id, inputDigest,
      notice: "Original source/result grants are independently retained. Execution, approval, code quality and actual-user publication remain separate." });
    return { ...this.create(session, "report", "Sandbox execution", text, "manual", [
      { eventId: null, sessionId: session.id, messageId: null, actor: "user", modelId: null, outcome: "reviewed-native-execution", contentDigest: inputDigest },
    ]), id };
  }
  nativePublication(publication: SandboxPublication): RetainedArtifact {
    const text = JSON.stringify({ format: "moguri-native-publication-report", version: 1, publicationId: publication.id,
      executionId: publication.executionId, documentDigest: publication.documentDigest,
      notice: "Actual user accepted this exact byte/base/policy review. Source copying, model quality and Git commits remain separate. Inspect original attempts and verified paths before retrying." });
    return { ...this.create({ id: null, projectId: publication.projectId, workspaceId: publication.workspaceId }, "report", "Sandbox source publication", text, "manual", [
      { eventId: null, sessionId: publication.sourceSessionId, messageId: null, actor: "user", modelId: null,
        outcome: "reviewed-native-source-publication", contentDigest: publication.documentDigest },
    ]), id: publication.id };
  }
  generationEvents(snapshot: Snapshot, events: StoredEvent[]): EventInput[] {
    return events.flatMap((event) => {
      if (event.event_type !== "model.completed" || event.payload.usage.role !== "draft") return [];
      const generation = snapshot.candidateGenerations.find((generation) => generation.stepId === event.step_id && generation.proposalDocumentDigest !== null);
      const proposed = generation?.proposalDocumentDigest;
      if (!generation || !proposed) return [];
      const artifact = snapshot.artifacts.find((artifact) => artifact.id === generation.id);
      if (!artifact || generation.resultDigest !== event.payload.contextDigest || generation.modelId !== event.payload.usage.modelId) throw new MoguriError("candidate_generation_corrupt", "A model proposal lost its exact independent source artifact or owning model result.", 409);
      return [this.event({ ...artifact, revision: artifact.revision + 1, updatedAt: event.timestamp, contentDigest: proposed,
        origin: "message", sources: [...artifact.sources, { eventId: event.id, sessionId: generation.sessionId, messageId: event.step_id ?? null,
          actor: "model", modelId: generation.modelId, outcome: "unaccepted-proposal", contentDigest: generation.resultDigest }] })];
    });
  }
  answerEvents(snapshot: Snapshot, events: StoredEvent[]): EventInput[] {
    if (!snapshot.settings.values.artifacts.retainAnswers) return [];
    return events.flatMap((event) => {
      if (event.event_type !== "question.answered") return [];
      const question = snapshot.questions.find((question) => question.id === event.payload.questionId);
      if (!question) throw new MoguriError("question_missing", "The exact answered question is not retained; no artifact was invented.", 409);
      const recommendation = question.recommendation;
      const guidance = recommendation ? `\n\n# Model recommendation (not a user answer)\n\n${recommendation.choice}\n\n${recommendation.reason}\n\nModel: ${recommendation.modelId}\nStep: ${recommendation.stepId}\n` : "";
      const modelText = `${question.question}${guidance}`, answer = event.payload.answer, text = `# Question\n\n${modelText}\n\n# Answer\n\n${answer.text}\n`;
      const decision = answer.actor === "decision-provider" ? snapshot.decisions.find((record) => record.id === answer.decisionId) : undefined;
      if (answer.actor === "decision-provider" && (!decision || decision.status !== "applied" || decision.source.kind !== "question" ||
        decision.source.questionId !== question.id || decision.stepId !== answer.sourceCallId || !decision.stepId || !decision.actualInputDigest || !decision.resultDigest ||
        !decision.adviceDigest || decision.modelId !== answer.modelId)) throw new MoguriError("decision_corrupt", "An automated retained answer lost its exact original decision/model/choice evidence. No fake human or unproved source was copied.", 409);
      const evidence = decision ? decisionEvidence(decision) : undefined;
      const artifact = this.create({ id: question.sessionId, projectId: question.projectId, workspaceId: question.workspaceId }, "answer", `Answer: ${question.question.replace(/\s+/g, " ").slice(0, 140)}`, text, "question", [
        { eventId: question.sourceEventId, sessionId: question.sessionId, messageId: question.callId, actor: "model", modelId: question.modelId, outcome: null, contentDigest: digest(modelText) },
        { eventId: event.id, sessionId: question.sessionId, messageId: evidence?.stepId ?? null, actor: answer.actor, modelId: answer.modelId, outcome: null, contentDigest: digest(answer.text),
          ...(evidence ? { decisionOrigin: evidence } : {}) },
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
  private event(artifact: RetainedArtifact): EventInput { return { event_type: "artifact.revised", profile_id: this.host.snapshot().profileId, project_id: artifact.projectId, payload: { artifact } }; }
  private revisions(id: string): RetainedArtifact[] {
    this.artifact(id);
    return this.host.events().flatMap((event) => event.event_type === "artifact.saved" && event.payload.artifact.id === id ? [legacyArtifact(event.payload.artifact, event.id)] :
      event.event_type === "artifact.revised" && event.payload.artifact.id === id ? [normalizeArtifact(event.payload.artifact)] : []);
  }
  private candidateEvents(id: string): StoredEvent[] {
    if (!this.host.snapshot().candidates.some((candidate) => candidate.id === id)) return [];
    return this.host.events().filter((event) => event.artifact_id === id &&
      (event.event_type === "candidate.saved" || event.event_type === "job.started" || event.event_type === "job.progress" || event.event_type === "job.finished"));
  }
  private generationHistory(id: string): StoredEvent[] {
    return this.host.events().filter((event) => event.artifact_id === id && event.event_type === "candidate.generation_recorded");
  }
  private roleHistory(id: string): StoredEvent[] {
    return this.host.events().filter((event) => event.artifact_id === id && event.event_type === "role.sequence_recorded");
  }
  private compoundHistory(id: string): StoredEvent[] {
    return this.host.events().filter((event) => event.artifact_id === id && (event.event_type === "compound.recorded" ||
      event.event_type === "job.started" && event.payload.job.compoundWorkflowId === id ||
      (event.event_type === "job.progress" || event.event_type === "job.finished") && event.payload.compoundWorkflowId === id));
  }
  private winddownHistory(id: string): StoredEvent[] {
    return this.host.events().filter((event) => event.artifact_id === id && (event.event_type === "winddown.recorded" ||
      event.event_type === "job.started" && event.payload.job.winddownId === id ||
      (event.event_type === "job.progress" || event.event_type === "job.finished") && event.payload.winddownId === id));
  }
  private decisionHistory(id: string): StoredEvent[] {
    return this.host.events().filter((event) => event.artifact_id === id && event.event_type === "decision.recorded");
  }
  private nativeHistory(id: string): StoredEvent[] {
    return this.host.events().filter((event) => event.artifact_id === id && (event.event_type === "sandbox.execution_recorded" ||
      event.event_type === "sandbox.frame_recorded" || event.event_type === "sandbox.publication_recorded" ||
      (event.event_type === "job.started" || event.event_type === "job.progress" || event.event_type === "job.finished") &&
        (event.event_type === "job.started" ? event.payload.job.sandboxPublicationId === id : event.payload.sandboxPublicationId === id)));
  }
  private deleted(id: string): EventInput {
    const generation = this.host.snapshot().candidateGenerations.find((generation) => generation.id === id);
    const sequence = this.host.snapshot().roleSequences.find((sequence) => sequence.id === id);
    const compound = this.host.snapshot().compoundWorkflows.find((workflow) => workflow.id === id);
    const decision = this.host.snapshot().decisions.find((record) => record.id === id);
    return { event_type: "artifact.deleted", profile_id: this.host.snapshot().profileId, payload: { artifactId: id,
      ...(generation ? { generationIntent: { commandId: generation.commandId, commandDigest: generation.commandDigest } } : {}),
      ...(sequence ? { roleSequenceIntent: { commandId: sequence.commandId, commandDigest: sequence.commandDigest } } : {}),
      ...(compound ? { compoundIntent: { commandId: compound.commandId, commandDigest: compound.commandDigest } } : {}),
      ...(decision ? { decisionIntent: { sessionId: decision.sessionId, turnId: decision.turnId, sourceDigest: decision.sourceDigest } } : {}) } };
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
    else if (event.event_type === "model.completed") { text = event.payload.message.text; actor = ["decision", "steering"].includes(event.payload.usage.role) ? "decision-provider" : "model"; modelId = event.payload.usage.modelId; outcome = event.payload.usage.outcome; }
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
    return { projectId, artifacts: records, digest: digest(JSON.stringify({ projectId, artifacts: artifacts.map((artifact) => {
      const candidateEvents = this.candidateEvents(artifact.id);
      const generationEvents = this.generationHistory(artifact.id);
      const roleEvents = this.roleHistory(artifact.id);
      const compoundEvents = this.compoundHistory(artifact.id);
      const winddownEvents = this.winddownHistory(artifact.id);
      const decisionEvents = this.decisionHistory(artifact.id);
      return { ...artifact, revisions: this.revisions(artifact.id).map(({ revision, contentDigest }) => ({ revision, contentDigest })),
        ...(candidateEvents.length ? { candidateEvents } : {}), ...(generationEvents.length ? { generationEvents } : {}), ...(roleEvents.length ? { roleEvents } : {}),
        ...(compoundEvents.length ? { compoundEvents } : {}), ...(winddownEvents.length ? { winddownEvents } : {}), ...(decisionEvents.length ? { decisionEvents,
          decisionAccounting: this.host.snapshot().budgetEntries.filter((entry) => decisionEvents.some((event) => event.event_type === "decision.recorded" && event.payload.decision.stepId === entry.id)) } : {}) };
    }) })) };
  }
  private export(artifacts: RetainedArtifact[], filename: string): ArtifactExport {
    let bytes = 0;
    const account = (text: string) => {
      bytes += Buffer.byteLength(text);
      if (bytes > 8 * 1024 * 1024) throw new MoguriError("artifact_export_limit", "The exact export exceeds 8 MiB. Export documents individually or retain them; nothing was truncated.");
    };
    const documents = artifacts.map((artifact) => {
      const revisions = this.revisions(artifact.id).map((revision) => {
        const text = this.store.blob(revision.contentDigest); account(text); account(JSON.stringify(revision));
        return { artifact: revision, text };
      });
      const events = this.candidateEvents(artifact.id), hashes = new Set<string>();
      for (const event of events) {
        if (event.event_type === "candidate.saved") {
          if (event.payload.candidate.stageResultDigest) hashes.add(event.payload.candidate.stageResultDigest);
          if (event.payload.candidate.applyResultDigest) hashes.add(event.payload.candidate.applyResultDigest);
          const origin = event.payload.candidate.roleOrigin;
          if (origin) { hashes.add(origin.sequenceInputDigest); hashes.add(origin.roleInputDigest); hashes.add(origin.resultDigest); }
          const compound = event.payload.candidate.compoundOrigin;
          if (compound) { hashes.add(compound.workflowInputDigest); hashes.add(compound.roleInputDigest); hashes.add(compound.resultDigest); }
        }
        if (event.event_type === "job.finished" && event.payload.resultDigest) hashes.add(event.payload.resultDigest);
      }
      const results = [...hashes].map((digest) => { const text = this.store.blob(digest); account(text); return { digest, text }; });
      if (events.length) account(JSON.stringify(events));
      const generationEvents = this.generationHistory(artifact.id), generationHashes = new Set<string>();
      for (const event of generationEvents) if (event.event_type === "candidate.generation_recorded") {
        generationHashes.add(event.payload.generation.inputDigest);
        if (event.payload.generation.resultDigest) generationHashes.add(event.payload.generation.resultDigest);
        if (event.payload.generation.proposalDocumentDigest) generationHashes.add(event.payload.generation.proposalDocumentDigest);
      }
      const generationResults = [...generationHashes].map((digest) => { const text = this.store.blob(digest); account(text); return { digest, text }; });
      if (generationEvents.length) account(JSON.stringify(generationEvents));
      const roleEvents = this.roleHistory(artifact.id), roleHashes = new Set<string>();
      for (const event of roleEvents) if (event.event_type === "role.sequence_recorded") {
        roleHashes.add(event.payload.sequence.inputDigest);
        for (const step of event.payload.sequence.steps) {
          if (step.inputDigest) roleHashes.add(step.inputDigest);
          if (step.resultDigest) roleHashes.add(step.resultDigest);
        }
      }
      const roleResults = [...roleHashes].map((digest) => { const text = this.store.blob(digest); account(text); return { digest, text }; });
      if (roleEvents.length) account(JSON.stringify(roleEvents));
      const compoundEvents = this.compoundHistory(artifact.id), compoundHashes = new Set<string>();
      for (const event of compoundEvents) {
        if (event.event_type === "compound.recorded") {
          compoundHashes.add(event.payload.workflow.inputDigest);
          for (const step of event.payload.workflow.steps) for (const hash of [step.inputDigest, step.resultDigest]) if (hash) compoundHashes.add(hash);
          for (const validation of event.payload.workflow.validations) for (const hash of [validation.documentDigest, validation.resultDigest]) if (hash) compoundHashes.add(hash);
        }
        if (event.event_type === "job.finished" && event.payload.resultDigest) compoundHashes.add(event.payload.resultDigest);
      }
      const compoundResults = [...compoundHashes].map((digest) => { const text = this.store.blob(digest); account(text); return { digest, text }; });
      if (compoundEvents.length) account(JSON.stringify(compoundEvents));
      const winddownEvents = this.winddownHistory(artifact.id), winddownHashes = new Set<string>();
      for (const event of winddownEvents) {
        if (event.event_type === "winddown.recorded") for (const hash of [event.payload.winddown.inputDigest, event.payload.winddown.step.inputDigest,
          event.payload.winddown.step.resultDigest, event.payload.winddown.commitDocumentDigest, event.payload.winddown.commit?.resultDigest]) if (hash) winddownHashes.add(hash);
        if (event.event_type === "job.finished" && event.payload.resultDigest) winddownHashes.add(event.payload.resultDigest);
      }
      const winddownResults = [...winddownHashes].map((digest) => { const text = this.store.blob(digest); account(text); return { digest, text }; });
      if (winddownEvents.length) account(JSON.stringify(winddownEvents));
      const decisionEvents = this.decisionHistory(artifact.id), decisionHashes = new Set<string>();
      for (const event of decisionEvents) if (event.event_type === "decision.recorded") for (const hash of [event.payload.decision.inputDigest,
        event.payload.decision.actualInputDigest, event.payload.decision.resultDigest, event.payload.decision.adviceDigest]) if (hash) decisionHashes.add(hash);
      const decisionResults = [...decisionHashes].map((digest) => { const text = this.store.blob(digest); account(text); return { digest, text }; });
      const decisionAccounting = this.host.snapshot().budgetEntries.filter((entry) => decisionEvents.some((event) => event.event_type === "decision.recorded" && event.payload.decision.stepId === entry.id));
      if (decisionEvents.length) { account(JSON.stringify(decisionEvents)); account(JSON.stringify(decisionAccounting)); }
      const decisionEvidence = revisions.flatMap((revision) => revision.artifact.sources.flatMap((source) => source.decisionOrigin ? [source.decisionOrigin] : []))
        .filter((origin, index, all) => all.findIndex((other) => other.decisionId === origin.decisionId && other.stepId === origin.stepId) === index)
        .map((origin) => {
          const results = [...new Set([origin.inputDigest, origin.modelInputDigest, origin.resultDigest, origin.adviceDigest])].map((digest) => {
            const text = this.store.blob(digest); account(text); return { digest, text };
          });
          const accounting = this.host.snapshot().budgetEntries.filter((entry) => entry.id === origin.stepId); account(JSON.stringify(accounting));
          return { origin, results, accounting };
        });
      const nativeEvents = this.nativeHistory(artifact.id), nativeHashes = new Set<string>();
      for (const event of nativeEvents) if (event.event_type === "sandbox.execution_recorded") {
        nativeHashes.add(event.payload.execution.inputDigest);
        if (event.payload.execution.resultDigest) nativeHashes.add(event.payload.execution.resultDigest);
      }
      for (const event of nativeEvents) if (event.event_type === "sandbox.publication_recorded") {
        const publication = event.payload.publication;
        for (const hash of [publication.inputDigest, publication.resultDigest, publication.documentDigest, publication.operationDigest]) if (hash) nativeHashes.add(hash);
      }
      const nativeResults = [...nativeHashes].map((digest) => { const text = this.store.blob(digest); account(text); return { digest, text }; });
      if (nativeEvents.length) account(JSON.stringify(nativeEvents));
      return { artifact, revisions, ...(events.length ? { candidate: { events, results } } : {}),
        ...(generationEvents.length ? { generation: { events: generationEvents, results: generationResults } } : {}),
        ...(roleEvents.length ? { roles: { events: roleEvents, results: roleResults } } : {}),
        ...(compoundEvents.length ? { compound: { events: compoundEvents, results: compoundResults } } : {}),
        ...(winddownEvents.length ? { winddown: { events: winddownEvents, results: winddownResults } } : {}),
        ...(decisionEvents.length ? { decision: { events: decisionEvents, results: decisionResults, accounting: decisionAccounting } } : {}),
        ...(decisionEvidence.length ? { decisionEvidence } : {}),
        ...(nativeEvents.length ? { native: { events: nativeEvents, results: nativeResults } } : {}) };
    });
    const roleLinked = documents.some((document) => document.candidate?.events.some((event) => event.event_type === "candidate.saved" && event.payload.candidate.roleOrigin));
    const compoundLinked = documents.some((document) => document.candidate?.events.some((event) => event.event_type === "candidate.saved" && event.payload.candidate.compoundOrigin));
    const text = JSON.stringify({ format: "moguri-artifacts", schemaVersion: documents.some((document) => document.decision || document.decisionEvidence) ? 9 : documents.some((document) => document.winddown) ? 8 : compoundLinked || documents.some((document) => document.compound) ? 7 : documents.some((document) => document.native) ? 6 : roleLinked ? 5 : documents.some((document) => document.roles) ? 4 : documents.some((document) => document.generation) ? 3 : documents.some((document) => document.candidate) ? 2 : 1, documents }, null, 2);
    if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new MoguriError("artifact_export_limit", "The exact export exceeds 8 MiB. Export documents individually or retain them; nothing was truncated.");
    return { filename, mediaType: "application/json", text, digest: digest(text) };
  }
  async removal(projectId: string, choice?: ProjectArtifactChoice): Promise<{ events: EventInput[]; forget: string[] }> {
    if (this.host.snapshot().decisions.some((record) => record.projectId === projectId && activeDecision(record))) throw new MoguriError("decision_busy", "Stop and settle the exact decision owner before reviewing independent project retention/removal. No pending advice or held charge was erased.", 409);
    if (this.host.snapshot().winddowns.some((record) => record.projectId === projectId && ["held", "running", "committing"].includes(record.status))) throw new MoguriError("winddown_busy", "Settle the actual reserved role/Git owner before reviewing project retention/removal. No capacity, ref or report was erased.", 409);
    if (this.host.snapshot().compoundWorkflows.some((workflow) => workflow.projectId === projectId && activeCompound(workflow))) throw new MoguriError("compound_busy", "Stop and settle the actual public workflow before reviewing independent project retention/removal.", 409);
    if ((this.host.snapshot().sandboxPublications ?? []).some((publication) => publication.projectId === projectId && publication.status === "publishing")) throw new MoguriError("sandbox_publication_busy", "Stop and settle original native source publication before reviewing its independent retention or project removal.", 409);
    if ((this.host.snapshot().sandboxExecutions ?? []).some((execution) => execution.projectId === projectId &&
      (!["owned-guest-stopped", "acknowledged"].includes(execution.cleanup) || execution.inspectionIntent?.status === "running"))) throw new MoguriError("sandbox_busy", "Stop/reconcile original native guests and settle their inspection before reviewing project removal or independent report deletion.", 409);
    if (this.host.snapshot().roleSequences.some((sequence) => sequence.projectId === projectId && sequence.status === "running")) throw new MoguriError("role_sequence_busy", "Stop and settle the exact owning role sequence before reviewing its independent retention.", 409);
    if (this.host.snapshot().candidateGenerations.some((generation) => generation.projectId === projectId && generation.status === "running")) throw new MoguriError("candidate_generation_busy", "Stop active generation before reviewing its independent report retention.", 409);
    if (this.host.snapshot().jobs.some((job) => job.projectId === projectId && job.candidate && ["running", "waiting_input"].includes(job.status))) throw new MoguriError("candidate_busy", "Stop the project's active candidate work before reviewing retention or removal. Its independent grants were preserved.", 409);
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
    return { events: preview.artifacts.map(({ id }) => this.deleted(id)), forget: preview.artifacts.map(({ id }) => id) };
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
    if (this.isBusy(projectId, workspaceId) || this.host.foreignRootBusy(this.host.root(projectId, workspaceId).path) || (workspaceId ? snapshot.blockedWorkspaces.includes(workspaceId) : snapshot.blockedProjects.includes(projectId)) ||
      snapshot.sessions.some((session) => session.projectId === projectId && session.workspaceId === workspaceId && session.turnId) ||
      snapshot.terminals.some((terminal) => terminal.projectId === projectId && terminal.workspaceId === workspaceId && !["closed", "failed", "acknowledged"].includes(terminal.status)) ||
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
        }, (job) => { response = finish([{ event_type: "job.started", profile_id: this.host.snapshot().profileId, project_id: preview.projectId, payload: { job: { ...job, materialization: preview } } }], { id: job.id }); },
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
    const candidate = this.host.snapshot().candidates.find((candidate) => candidate.id === artifact.id);
    const generation = this.host.snapshot().candidateGenerations.find((generation) => generation.id === artifact.id);
    const sequence = this.host.snapshot().roleSequences.find((sequence) => sequence.id === artifact.id);
    const compound = this.host.snapshot().compoundWorkflows.find((workflow) => workflow.id === artifact.id);
    const winddown = this.host.snapshot().winddowns.find((record) => record.id === artifact.id), winddownBusy = winddown && ["held", "running", "committing"].includes(winddown.status);
    const decision = this.host.snapshot().decisions.find((record) => record.id === artifact.id);
    const native = (this.host.snapshot().sandboxExecutions ?? []).find((execution) => execution.id === artifact.id);
    const nativeBusy = native && (!["owned-guest-stopped", "acknowledged"].includes(native.cleanup) || native.inspectionIntent?.status === "running");
    const publication = (this.host.snapshot().sandboxPublications ?? []).find((value) => value.id === artifact.id);
    const activeCandidate = candidate && (["staging", "applying"].includes(candidate.status) ||
      this.host.snapshot().jobs.some((job) => job.candidate?.candidateId === candidate.id && ["running", "waiting_input"].includes(job.status)));
    if (command.type === "artifact.delete") {
      if (decision && activeDecision(decision)) throw new MoguriError("decision_busy", "Stop and settle this original one-shot owner before deleting its independent request, metering and result report.", 409);
      if (winddownBusy) throw new MoguriError("winddown_busy", "Stop and settle the actual held/finishing/Git owner before deleting its independent checkpoint report.", 409);
      if (compound && activeCompound(compound)) throw new MoguriError("compound_busy", "Stop and settle this public workflow before deleting its independently retained input, roles and actual tests.", 409);
      if (publication?.status === "publishing") throw new MoguriError("sandbox_publication_busy", "Stop and settle this original source writer before deleting its independently retained review and effects.", 409);
      if (nativeBusy) throw new MoguriError("sandbox_busy", "Stop/reconcile the original native guest before deleting its independent input/result/owner record.", 409);
      if (sequence?.status === "running") throw new MoguriError("role_sequence_busy", "Stop and settle this role sequence before deleting its independent input/result history.", 409);
      if (generation?.status === "running") throw new MoguriError("candidate_generation_busy", "Stop generation before deleting its independently retained input/result report.", 409);
      if (activeCandidate) throw new MoguriError("candidate_busy", "Stop the candidate's active owned job before deleting its independent document/history.", 409);
      return finish([this.deleted(artifact.id)], { id: artifact.id }, { artifacts: [artifact.id] });
    }
    if (candidate && command.changes.text !== undefined) throw new MoguriError("candidate_document", "A candidate's exact proposal document is immutable. Export it or create a separately reviewed new proposal; renaming/organizing does not change its bytes.", 409);
    if (decision && command.changes.text !== undefined) throw new MoguriError("decision_document", "Original decision request, actual model result, actor and applied/rejected observations are immutable. Metadata edits cannot rewrite advice or authority.", 409);
    if (decision && activeDecision(decision) && command.changes.status === "archived") throw new MoguriError("decision_busy", "Settle this exact decision owner before archiving its independently retained request/result.", 409);
    if (winddown && command.changes.text !== undefined) throw new MoguriError("winddown_document", "Original wind-down input, actual role result, user Git review and publication observations are immutable. Export or retain another document.", 409);
    if (winddownBusy && command.changes.status === "archived") throw new MoguriError("winddown_busy", "Settle the actual original reserved role/Git owner before archiving its independent report.", 409);
    if (compound && command.changes.text !== undefined) throw new MoguriError("compound_document", "Public workflow input, actual role results and test reviews are immutable. Export them or create a separate document; metadata cannot change provenance.", 409);
    if (compound && activeCompound(compound) && command.changes.status === "archived") throw new MoguriError("compound_busy", "Settle this exact public workflow before archiving its independently retained report.", 409);
    if (publication && command.changes.text !== undefined) throw new MoguriError("sandbox_document", "Native publication input, actual acceptance and filesystem attempts are immutable. Create a separate document instead.", 409);
    if (publication?.status === "publishing" && command.changes.status === "archived") throw new MoguriError("sandbox_publication_busy", "Settle this exact source writer before archiving its independent report.", 409);
    if (native && command.changes.text !== undefined) throw new MoguriError("sandbox_document", "Native input, actual boundary and retained after-state are immutable. Export them or create a separate document; metadata edits cannot change source provenance.", 409);
    if (nativeBusy && command.changes.status === "archived") throw new MoguriError("sandbox_busy", "Settle the original native owner before archiving its independent report.", 409);
    if (sequence && command.changes.text !== undefined) throw new MoguriError("role_sequence_document", "Role input and actual per-role results are immutable. Export them or retain a separate document; metadata editing does not change provenance.", 409);
    if (sequence?.status === "running" && command.changes.status === "archived") throw new MoguriError("role_sequence_busy", "Settle the exact owning role sequence before archiving its independent report.", 409);
    if (generation && command.changes.text !== undefined) throw new MoguriError("candidate_generation_document", "Generation input/result documents are immutable. Export them or generate a separately reviewed proposal; metadata changes do not rewrite model provenance.", 409);
    if (generation?.status === "running" && command.changes.status === "archived") throw new MoguriError("candidate_generation_busy", "Stop generation before archiving its independent report.", 409);
    if (activeCandidate && command.changes.status === "archived") throw new MoguriError("candidate_busy", "Stop the candidate's active owned job before archiving its document.", 409);
    if (!Object.keys(command.changes).length) throw new MoguriError("artifact_changes", "Choose an actual title, text or archive change.");
    const updated: RetainedArtifact = { ...artifact, revision: artifact.revision + 1, updatedAt: new Date().toISOString(),
      ...this.associations(artifact.projectId, { folderId: command.changes.folderId === undefined ? artifact.folderId : command.changes.folderId, workItemId: command.changes.workItemId === undefined ? artifact.workItemId : command.changes.workItemId }),
      ...(command.changes.name !== undefined ? { name: this.named(command.changes.name) } : {}),
      ...(command.changes.status ? { status: command.changes.status } : {}),
      ...(command.changes.text !== undefined ? { contentDigest: this.content(command.changes.text), edited: artifact.edited || digest(command.changes.text) !== artifact.contentDigest } : {}) };
    return finish([this.event(updated)], { id: artifact.id, revision: updated.revision });
  }
}
