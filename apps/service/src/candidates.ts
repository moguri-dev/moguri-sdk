import {
  CandidateDocumentSchema, CandidateOperationResultSchema, MoguriError, parse, sameCandidateRoot, sameCandidatePatch,
  type CandidateApplyPreview, type CandidateCommand, type CandidateDocument, type CandidateOperationResult, type CandidatePatch,
  type CandidateQuery, type CandidateRecord, type CandidateResponse, type CandidateRoot, type CandidateStagePreview,
  type ArtifactSource, type CapabilityJob, type CommandResult, type EventInput, type RetainedArtifact, type Session, type Snapshot, type CandidateRoleProposalRead,
} from "../../../packages/protocol/src/index.ts";
import { candidateBases, candidateBytes, candidateDigest, candidateDocument, candidateFileBase, candidatePatch } from "./candidate-files.ts";
import { digest, EventStore } from "./store.ts";
import { sourceRoot, sourceRootSync } from "./repository-source.ts";
import { readGitBinding } from "./project-git.ts";
import { assertFolderAccess, folderPolicy } from "./project-policy.ts";
import { readProjectFile, writeProjectFile } from "./files.ts";
import type { CandidateGenerationInput } from "../../../packages/protocol/src/candidate-generations.ts";
import type { ManagedWorkspaces } from "./managed-workspaces.ts";
import type { ProjectService } from "./project-service.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";

export interface CandidateJobLifecycle {
  completed(result: unknown, digest: string): EventInput[];
  failed(error: unknown, cancelled: boolean): { events: EventInput[]; status: "partial" | "failed" | "cancelled"; error: string };
}
interface Host {
  snapshot(): Snapshot;
  managed: ManagedWorkspaces;
  projects(): ProjectService;
  commit(events: EventInput[]): void;
  artifact(session: Session, text: string, summary: string, patch: CandidatePatch, sources?: ArtifactSource[]): RetainedArtifact;
  localRootBusy(root: string, exceptJobId?: string): boolean;
  closingProject(id: string): boolean;
  roleProposal(id: string): CandidateRoleProposalRead;
  wake(): void;
  job(kind: string, projectId: string, sessionId: string, workspaceId: string | null,
    execute: (signal: AbortSignal, progress: (text: string) => void, jobId: string) => Promise<CandidateOperationResult>,
    start: (job: CapabilityJob) => void, settled: () => void, lifecycle: CandidateJobLifecycle): string;
}
export interface CandidateContext {
  session: Session; source: CandidateRoot; stage: CandidateRoot; authorityDigest: string;
  current(): void; assert(): Promise<void>;
}
export class CandidateRuntime {
  private readonly observed = new Map<string, { paths: string[]; current(): void }>();
  constructor(private readonly store: EventStore, private readonly host: Host) {}
  private record(id: string): CandidateRecord {
    const record = this.host.snapshot().candidates.find((candidate) => candidate.id === id);
    const artifact = this.host.snapshot().artifacts.find((artifact) => artifact.id === id);
    if (!record || !artifact || artifact.contentDigest !== record.documentDigest) throw new MoguriError("candidate_missing", "Candidate is deleted, changed or outside this profile.", 404);
    return record;
  }
  private document(record: CandidateRecord): CandidateDocument { return candidateDocument(this.store.blob(record.documentDigest), record); }
  private event(candidate: CandidateRecord): EventInput { return { event_type: "candidate.saved", profile_id: candidate.profileId, project_id: candidate.projectId, payload: { candidate } }; }
  private update(id: string, changes: Partial<CandidateRecord>): void {
    const record = this.record(id);
    this.host.commit([this.event({ ...record, ...changes, revision: record.revision + 1, updatedAt: new Date().toISOString() })]);
  }
  isBusy(projectId: string, workspaceId: string | null): boolean {
    return this.host.snapshot().jobs.some((job) => job.candidate && ["running", "waiting_input"].includes(job.status) && (() => {
      const candidate = this.host.snapshot().candidates.find((candidate) => candidate.id === job.candidate?.candidateId);
      return candidate?.projectId === projectId && (candidate.source.workspaceId === workspaceId || candidate.stage.workspaceId === workspaceId);
    })());
  }
  stopEvents(id: string, jobId: string): EventInput[] {
    const candidate = this.record(id);
    const owner = candidate.status === "staging" ? candidate.stageIntent : candidate.status === "applying" ? candidate.applyIntent : null;
    if (!owner || owner.jobId !== jobId || candidate.stopRequested) return [];
    return [this.event({ ...candidate, revision: candidate.revision + 1, updatedAt: new Date().toISOString(), stopRequested: true })];
  }
  private session(id: string): Session {
    const snapshot = this.host.snapshot(), session = snapshot.sessions.find((session) => session.id === id);
    if (!session?.projectId || session.controls.env !== "Local") throw new MoguriError("candidate_env", "Choose an explicitly Local project session. No Remote/Sandbox or previous-root fallback.", 409);
    if (!snapshot.policy.allowedEnvs.includes("Local") || this.host.closingProject(session.projectId)) throw new MoguriError("candidate_env", "Current global/project policy excludes new Local candidate work. No root was read.", 403);
    if (session.kind !== "agent" || session.mode !== "agent" || session.pendingMode === "read-only" || session.status === "archived") throw new MoguriError("read_only", "This session cannot stage or apply repository candidates.", 403);
    return session;
  }
  private async context(sessionId: string, stageWorkspaceId: string, paths: string[], signal: AbortSignal, clean: boolean, exceptJobId?: string): Promise<CandidateContext> {
    const session = this.session(sessionId), snapshot = this.host.snapshot(), projectId = session.projectId!;
    const sourceProject = this.host.managed.project(session), stageProject = this.host.managed.project({ projectId, workspaceId: stageWorkspaceId });
    if (session.workspaceId === stageWorkspaceId || sourceProject.path === stageProject.path) throw new MoguriError("candidate_root", "Select a separate owned candidate worktree, never the source checkout.", 409);
    const configuration = this.host.projects().configuration(projectId), permissionRevision = snapshot.settings.permissionRevision, policyRevision = snapshot.policy.revision;
    const [sourceIdentity, stageIdentity, sourceGit, stageGit] = await Promise.all([
      sourceRoot(sourceProject.path), sourceRoot(stageProject.path), readGitBinding(sourceProject.path, signal), readGitBinding(stageProject.path, signal),
    ]);
    const source: CandidateRoot = { env: "Local", projectId, workspaceId: session.workspaceId, ...sourceIdentity, ...sourceGit };
    const stage: CandidateRoot = { env: "Local", projectId, workspaceId: stageWorkspaceId, ...stageIdentity, ...stageGit };
    if (source.gitCommonDir !== stage.gitCommonDir || source.head !== stage.head || source.device === stage.device && source.inode === stage.inode) throw new MoguriError("candidate_base", "The clean owned candidate worktree must share the exact source repository and HEAD. Create/select it explicitly from this base.", 409);
    const authorityDigest = digest(JSON.stringify({ profileId: snapshot.profileId, sessionId, projectId, workspaceId: session.workspaceId, mode: session.mode,
      policyRevision, permissionRevision, configurationRevision: configuration.revision, source, stage }));
    const current = () => {
      signal.throwIfAborted();
      const state = this.host.snapshot(), actual = this.session(sessionId);
      if (this.host.closingProject(projectId) || !state.policy.allowedEnvs.includes("Local") || state.policy.revision !== policyRevision ||
        state.settings.permissionRevision !== permissionRevision || this.host.projects().configuration(projectId).revision !== configuration.revision ||
        actual.projectId !== projectId || actual.workspaceId !== source.workspaceId ||
        this.host.managed.project(actual).path !== source.root || this.host.managed.project({ projectId, workspaceId: stageWorkspaceId }).path !== stage.root) throw new MoguriError("candidate_stale", "Candidate root, mode or policy changed. Review again; no stale permission was used.", 409);
      for (const root of [source, stage]) {
        const actual = sourceRootSync(root.root);
        if (actual.device !== root.device || actual.inode !== root.inode) throw new MoguriError("candidate_root", "The recorded source/staging directory was replaced. No fallback root.", 409);
        if (this.host.localRootBusy(root.root, exceptJobId) || (root.workspaceId ? state.blockedWorkspaces.includes(root.workspaceId) : state.blockedProjects.includes(projectId)) ||
          state.terminals.some((terminal) => terminal.env === "Local" && (terminal.binding?.root === root.root || terminal.projectId === projectId && terminal.workspaceId === root.workspaceId) && !["closed", "failed", "acknowledged"].includes(terminal.status))) throw new MoguriError("workspace_busy", "An owned writer, console or unconfirmed operation holds this exact candidate/source root.", 409);
      }
    };
    const assert = async () => {
      current();
      await this.host.managed.assert({ projectId, workspaceId: source.workspaceId }, signal);
      await this.host.managed.assert({ projectId, workspaceId: stage.workspaceId }, signal);
      const [actualSource, actualStage] = await Promise.all([readGitBinding(source.root, signal), readGitBinding(stage.root, signal)]);
      if (!sameCandidateRoot(source, { ...source, ...actualSource }) || !sameCandidateRoot(stage, { ...stage, ...actualStage })) throw new MoguriError("candidate_base", "Candidate Git branch/base changed. Nothing was reset, checked out or merged.", 409);
      for (const path of paths) {
        await assertFolderAccess(source.root, path, true, folderPolicy(configuration.values));
        await assertFolderAccess(stage.root, path, true, folderPolicy(configuration.values));
      }
      current();
    };
    await assert();
    if (clean && (await this.host.managed.inspect(stageWorkspaceId, signal)).status) throw new MoguriError("candidate_stage_busy", "The candidate checkout has existing changes. Preserve it and explicitly select another clean owned worktree.", 409);
    current();
    return { session, source, stage, authorityDigest, current, assert };
  }
  private async preview(sessionId: string, stageWorkspaceId: string, value: CandidatePatch, signal: AbortSignal, roleSequenceId?: string): Promise<{ preview: CandidateStagePreview; context: CandidateContext; roleProposal?: CandidateRoleProposalRead }> {
    const roleProposal = roleSequenceId ? this.host.roleProposal(roleSequenceId) : undefined, patch = candidatePatch(value);
    if (roleProposal && !sameCandidatePatch(roleProposal.document.patch, patch)) throw new MoguriError("role_proposal_source", "The summary or ordered patch changed from the exact final role. Use an explicitly unverified import; no model attribution was adopted.", 409);
    const context = await this.context(sessionId, stageWorkspaceId, patch.edits.map(({ path }) => path), signal, true);
    if (roleProposal && (!sameCandidateRoot(roleProposal.document.source, context.source) || !sameCandidateRoot(roleProposal.document.stage, context.stage))) throw new MoguriError("role_proposal_source", "This final role belongs to different original source/staging roots. No compatible root was invented.", 409);
    await candidateBases(context.source.root, patch);
    for (const edit of patch.edits) await candidateFileBase(context.stage.root, edit.path);
    await context.assert();
    const document: CandidateDocument = { format: "moguri-candidate", version: 1, source: context.source, stage: context.stage, authorityDigest: context.authorityDigest, patch,
      ...(roleProposal ? { roleOrigin: roleProposal.document.roleOrigin } : {}) };
    const text = JSON.stringify(document);
    if (Buffer.byteLength(text) > 64 * 1024) throw new MoguriError("candidate_limit", "The exact versioned candidate document exceeds 64 KiB. No content was truncated.", 409);
    return { context, preview: { document, documentDigest: digest(text), digest: candidateDigest(text),
      ...(roleProposal ? { warning: "Staging retains a separate copy of this role's origin, original input and raw result. Deleting the source role report will not erase this candidate copy. Provenance is not quality or acceptance; source application needs its own fresh review." } : {}) },
      ...(roleProposal ? { roleProposal } : {}) };
  }
  async generationSource(sessionId: string, stageWorkspaceId: string, input: CandidateGenerationInput, signal: AbortSignal): Promise<CandidateContext & { files: Array<{ path: string; baseDigest: string; text: string | null }> }> {
    input = structuredClone(input);
    const selection = candidatePatch({ kind: "patch", summary: "Reviewed generation source", edits: input.files.map((file) => ({ ...file, text: "" })) });
    const context = await this.context(sessionId, stageWorkspaceId, selection.edits.map((file) => file.path), signal, true);
    const files: Array<{ path: string; baseDigest: string; text: string | null }> = [];
    for (const file of input.files) {
      if (await candidateFileBase(context.source.root, file.path) !== file.baseDigest) throw new MoguriError("candidate_generation_base", `Source ${file.path} changed before generation review. Reload its exact base; no model was called.`, 409);
      const source = file.baseDigest === "absent" ? null : await readProjectFile(context.source.root, file.path);
      if (source && source.digest !== file.baseDigest) throw new MoguriError("candidate_generation_base", `Source ${file.path} changed during capture. No new content was substituted.`, 409);
      files.push({ ...file, text: source?.text ?? null });
    }
    if (Buffer.byteLength(JSON.stringify(files)) > 64 * 1024) throw new MoguriError("candidate_generation_limit", "Selected generation source exceeds 64 KiB. Select fewer/smaller files; nothing was truncated.");
    for (const file of files) if (await candidateFileBase(context.source.root, file.path) !== file.baseDigest) throw new MoguriError("candidate_generation_base", `Source ${file.path} changed during review. No model was called.`, 409);
    await context.assert(); return { ...context, files };
  }
  private async applyPreview(id: string, sessionId: string, signal: AbortSignal, exceptJobId?: string): Promise<{ preview: CandidateApplyPreview; context: CandidateContext; document: CandidateDocument }> {
    const record = this.record(id), document = this.document(record);
    if (record.status !== "staged" && !(exceptJobId && record.status === "applying" && record.applyIntent?.jobId === exceptJobId)) throw new MoguriError("candidate_state", "Only an exact completely staged candidate can be reviewed for application. Partial/terminal work is never retried.", 409);
    const context = await this.context(sessionId, record.stage.workspaceId!, record.paths, signal, false, exceptJobId);
    if (!sameCandidateRoot(context.source, record.source) || !sameCandidateRoot(context.stage, record.stage)) throw new MoguriError("candidate_root", "This explicit Local session does not own the candidate's recorded source/base.", 409);
    await candidateBases(record.source.root, document.patch); await candidateBytes(record.stage.root, document.patch); await context.assert();
    const body = { candidateId: id, sessionId, revision: record.revision, source: record.source, stage: record.stage,
      documentDigest: record.documentDigest, proposalDigest: record.proposalDigest, authorityDigest: context.authorityDigest };
    return { preview: { ...body, digest: digest(JSON.stringify(body)) }, context, document };
  }
  async query(query: CandidateQuery): Promise<CandidateResponse> {
    if (query.type === "candidate.role.proposal") return this.host.roleProposal(query.sequenceId);
    if (query.type === "candidate.preview") return { type: query.type, preview: (await this.preview(query.sessionId, query.stageWorkspaceId, query.patch, AbortSignal.timeout(15_000), query.roleSequenceId)).preview };
    if (query.type === "candidate.apply.preview") return { type: query.type, preview: (await this.applyPreview(query.candidateId, query.sessionId, AbortSignal.timeout(15_000))).preview };
    const candidate = this.record(query.candidateId), jobs = this.host.snapshot().jobs;
    return { type: "candidate.read", candidate, document: this.document(candidate), stageJob: jobs.find((job) => job.id === candidate.stageIntent.jobId) ?? null,
      applyJob: candidate.applyIntent ? jobs.find((job) => job.id === candidate.applyIntent?.jobId) ?? null : null };
  }
  private lifecycle(id: string, phase: "stage" | "apply"): CandidateJobLifecycle {
    return {
      completed: (value, resultDigest) => {
        const result = parse(CandidateOperationResultSchema, value), candidate = this.record(id);
        const observed = this.observed.get(id), document = this.document(candidate);
        if (!observed) throw new MoguriError("candidate_partial", "Final candidate file ownership was not observed. Inspect the original intent; no completion was inferred.", 409);
        observed.current();
        if (candidate.stopRequested || result.candidateId !== id || result.phase !== phase || !sameCandidateRoot(result.source, candidate.source) || !sameCandidateRoot(result.stage, candidate.stage) ||
          JSON.stringify(result.files.map(({ path }) => path)) !== JSON.stringify(candidate.paths) || result.files.some((file, index) => {
            const edit = document.patch.edits[index];
            return !edit || file.digest !== digest(edit.text) || file.bytes !== Buffer.byteLength(edit.text);
          })) throw new MoguriError("candidate_partial", "Final candidate ownership/bytes were not acknowledged. Inspect retained effects.", 409);
        return [this.event({ ...candidate, revision: candidate.revision + 1, updatedAt: new Date().toISOString(), status: phase === "stage" ? "staged" : "applied",
          ...(phase === "stage" ? { stageResultDigest: resultDigest } : { applyResultDigest: resultDigest }) })];
      },
      failed: (error, cancelled) => {
        const candidate = this.record(id), confirmed = this.observed.get(id)?.paths ?? [];
        const appliedPaths = phase === "apply" ? [...candidate.appliedPaths] : candidate.appliedPaths, stagedPaths = phase === "stage" ? [...candidate.stagedPaths] : candidate.stagedPaths;
        for (const path of confirmed) if (!(phase === "stage" ? stagedPaths : appliedPaths).includes(path)) (phase === "stage" ? stagedPaths : appliedPaths).push(path);
        const possible = (phase === "stage" ? candidate.stageAttemptedPaths?.length ?? stagedPaths.length : candidate.attemptedPaths.length) > 0;
        const uncertain = possible || error instanceof MoguriError && ["program_partial", "workspace_partial", "candidate_partial"].includes(error.code);
        const diagnostic = (error instanceof MoguriError ? error.message : cancelled ? "Owned candidate work was stopped." : "Candidate filesystem/Git work failed; inspect the retained roots before retrying.").slice(0, 3900);
        if (!(error instanceof MoguriError) && !cancelled) console.error("Candidate operation failed:", error instanceof Error && "code" in error ? String(error.code) : "candidate_work");
        const status = uncertain ? "partial" : cancelled ? "cancelled" : error instanceof MoguriError && error.code === "candidate_conflict" ? "conflict" : "failed";
        return { events: [this.event({ ...candidate, revision: candidate.revision + 1, updatedAt: new Date().toISOString(), status, stagedPaths, appliedPaths, diagnostic })],
          status: uncertain ? "partial" : cancelled ? "cancelled" : "failed", error: diagnostic };
      },
    };
  }
  private async files(id: string, phase: "stage" | "apply", sessionId: string, signal: AbortSignal, progress: (text: string) => void, jobId: string): Promise<CandidateOperationResult> {
    signal = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
    const record = this.record(id), document = this.document(record);
    const context = await this.context(sessionId, record.stage.workspaceId!, record.paths, signal, phase === "stage", jobId);
    if (!sameCandidateRoot(context.source, record.source) || !sameCandidateRoot(context.stage, record.stage) ||
      context.authorityDigest !== (phase === "stage" ? document.authorityDigest : record.acceptance?.authorityDigest)) throw new MoguriError("candidate_stale", "The exact reviewed candidate authority changed before effects.", 409);
    await candidateBases(record.source.root, document.patch);
    if (phase === "apply") await candidateBytes(record.stage.root, document.patch);
    const root = phase === "stage" ? record.stage.root : record.source.root, bases: string[] = [];
    for (const edit of document.patch.edits) bases.push(phase === "stage" ? await candidateFileBase(root, edit.path) : edit.baseDigest);
    const confirmed: string[] = []; this.observed.set(id, { paths: confirmed, current: context.current });
    for (let index = 0; index < document.patch.edits.length; index++) {
      const edit = document.patch.edits[index]!;
      await context.assert();
      if (phase === "apply" && await candidateFileBase(record.stage.root, edit.path) !== digest(edit.text)) throw new MoguriError("candidate_changed", "The staged proposal changed after review. Existing source changes were preserved.", 409);
      const actual = this.record(id);
      this.update(id, phase === "stage" ? { stageAttemptedPaths: [...(actual.stageAttemptedPaths ?? []), edit.path] } : { attemptedPaths: [...actual.attemptedPaths, edit.path] });
      await writeProjectFile(root, edit.path, edit.text, bases[index]!, { signal, beforeCommit: context.current, committed: () => { confirmed.push(edit.path); } });
      const current = this.record(id);
      this.update(id, phase === "stage" ? { stagedPaths: [...current.stagedPaths, edit.path] } : { appliedPaths: [...current.appliedPaths, edit.path] });
      progress(`${phase === "stage" ? "Staged" : "Applied"} ${index + 1}/${record.paths.length} exact files.`);
    }
    await context.assert();
    const files = await candidateBytes(root, document.patch); context.current();
    return { version: 1, candidateId: id, phase, source: record.source, stage: record.stage, readback: true, files };
  }
  async execute(command: CandidateCommand, finish: WorkspaceFinish): Promise<CommandResult> {
    const intent = finish.intent;
    if (!intent) throw new MoguriError("candidate_intent", "A canonical user command identity is required before candidate work.", 409);
    const previous = this.host.snapshot().candidates.find((candidate) => [candidate.stageIntent, candidate.applyIntent].some((owned) => owned?.commandId === intent.id));
    if (previous) {
      const owned = previous.applyIntent?.commandId === intent.id ? previous.applyIntent : previous.stageIntent;
      if (owned.commandDigest !== intent.digest) throw new MoguriError("idempotency_conflict", "Original candidate command arguments changed. No replay.", 409);
      return finish([], { id: previous.id });
    }
    if (command.type === "candidate.reject") {
      const candidate = this.record(command.candidateId);
      if (candidate.revision !== command.expectedRevision || candidate.status !== "staged") throw new MoguriError("candidate_state", "Reload the exact staged candidate before rejecting it.", 409);
      return finish([this.event({ ...candidate, status: "rejected", revision: candidate.revision + 1, updatedAt: new Date().toISOString(), diagnostic: "The actual user rejected this proposal; no source file was applied." })], { id: candidate.id, revision: candidate.revision + 1 });
    }
    let result: CommandResult | undefined;
    if (command.type === "candidate.stage") {
      const generationId = "generationId" in command ? command.generationId : undefined, roleSequenceId = "roleSequenceId" in command ? command.roleSequenceId : undefined;
      const { preview, context, roleProposal } = await this.preview(command.sessionId, command.stageWorkspaceId, command.patch, AbortSignal.timeout(15_000), roleSequenceId);
      if (preview.digest !== command.expectedDigest) throw new MoguriError("candidate_review", "Candidate preview changed. Review exact roots, bases and proposed bytes again.", 409);
      let sources: ArtifactSource[] | undefined;
      if (generationId) {
        const generation = this.host.snapshot().candidateGenerations.find((generation) => generation.id === generationId);
        const origin = this.host.snapshot().artifacts.find((artifact) => artifact.id === generationId);
        if (!generation || generation.status !== "proposed" || !generation.proposalDocumentDigest || !origin || origin.contentDigest !== generation.proposalDocumentDigest ||
          !sameCandidateRoot(generation.source, preview.document.source) || !sameCandidateRoot(generation.stage, preview.document.stage)) throw new MoguriError("candidate_generation_source", "Choose the retained proposed generation for these exact captured roots. No model provenance was invented.", 409);
        const generated = parse(CandidateDocumentSchema, JSON.parse(this.store.blob(generation.proposalDocumentDigest)));
        if (!sameCandidatePatch(generated.patch, preview.document.patch) ||
          !origin.sources.some((source) => source.actor === "model" && source.modelId === generation.modelId && source.messageId === generation.stepId)) throw new MoguriError("candidate_generation_source", "The patch changed from its canonical model result. Stage it as an explicitly unverified import, not another model's output.", 409);
        sources = origin.sources;
      }
      if (roleProposal) sources = [roleProposal.modelSource];
      const text = JSON.stringify(preview.document), artifact = this.host.artifact(context.session, text, preview.document.patch.summary, preview.document.patch, sources), id = artifact.id;
      const now = new Date().toISOString(); context.current();
      this.host.job("candidate.stage", artifact.projectId!, command.sessionId, command.stageWorkspaceId,
        (signal, progress, jobId) => this.files(id, "stage", command.sessionId, signal, progress, jobId),
        (job) => {
          const candidate: CandidateRecord = { version: 1, id, profileId: this.host.snapshot().profileId, projectId: artifact.projectId!, originSessionId: command.sessionId,
            ...(generationId ? { generationId } : {}), ...(preview.document.roleOrigin ? { roleOrigin: preview.document.roleOrigin } : {}),
            source: preview.document.source, stage: preview.document.stage, documentDigest: artifact.contentDigest, proposalDigest: preview.digest, paths: preview.document.patch.edits.map(({ path }) => path),
            revision: 0, status: "staging", createdAt: now, updatedAt: now, stageIntent: { commandId: intent.id, commandDigest: intent.digest, jobId: job.id, sessionId: command.sessionId },
            applyIntent: null, acceptance: null, stagedPaths: [], stageAttemptedPaths: [], attemptedPaths: [], appliedPaths: [], stopRequested: false, stageResultDigest: null, applyResultDigest: null, diagnostic: null };
          result = finish([{ event_type: "artifact.revised", profile_id: candidate.profileId, project_id: candidate.projectId, payload: { artifact } }, this.event(candidate),
            { event_type: "job.started", profile_id: candidate.profileId, project_id: candidate.projectId, session_id: command.sessionId, payload: { job: { ...job, candidate: { candidateId: id, phase: "stage", commandId: intent.id, commandDigest: intent.digest } } } }], { id });
        }, () => { this.observed.delete(id); this.host.wake(); }, this.lifecycle(id, "stage"));
    } else {
      const { preview, context } = await this.applyPreview(command.candidateId, command.sessionId, AbortSignal.timeout(15_000));
      if (preview.revision !== command.expectedRevision || preview.digest !== command.expectedDigest) throw new MoguriError("candidate_review", "The exact candidate apply review changed. No source publication was admitted.", 409);
      const candidate = this.record(command.candidateId), id = candidate.id; context.current();
      this.host.job("candidate.apply", candidate.projectId, command.sessionId, candidate.source.workspaceId,
        (signal, progress, jobId) => this.files(id, "apply", command.sessionId, signal, progress, jobId),
        (job) => {
          const now = new Date().toISOString(), applyIntent = { commandId: intent.id, commandDigest: intent.digest, jobId: job.id, sessionId: command.sessionId };
          result = finish([this.event({ ...candidate, revision: candidate.revision + 1, status: "applying", updatedAt: now, applyIntent,
            acceptance: { actor: "user", commandId: intent.id, commandDigest: intent.digest, proposalDigest: candidate.proposalDigest, reviewDigest: preview.digest, authorityDigest: preview.authorityDigest, at: now } }),
          { event_type: "job.started", profile_id: candidate.profileId, project_id: candidate.projectId, session_id: command.sessionId, payload: { job: { ...job, candidate: { candidateId: id, phase: "apply", commandId: intent.id, commandDigest: intent.digest } } } }], { id });
        }, () => { this.observed.delete(id); this.host.wake(); }, this.lifecycle(id, "apply"));
    }
    if (!result) throw new MoguriError("candidate_intent", "Candidate intent was not atomically acknowledged; no successful job was returned.", 409);
    return result;
  }
}
