import {
  candidateDeletionPending, CandidateDocumentSchema, CandidateOperationResultSchema, MoguriError, parse, sameCandidateRoot, sameCandidatePatch,
  type CandidateApplyPreview, type CandidateCommand, type CandidateDocument, type CandidateOperationResult, type CandidatePatch,
  type CandidateQuery, type CandidateRecord, type CandidateResponse, type CandidateRoot, type CandidateStagePreview,
  type ArtifactSource, type CapabilityJob, type CommandResult, type EventInput, type RetainedArtifact, type Session, type Snapshot, type CandidateRoleProposalRead,
  type CompoundCandidateProposal,
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
import type { CandidateEnvs, CandidateEnvContext } from "./candidate-envs.ts";
import { randomUUID } from "node:crypto";
import type { CandidateWorkspaceResponse } from "../../../packages/protocol/src/candidate-workspaces.ts";

export interface CandidateJobLifecycle {
  completed(result: unknown, digest: string): EventInput[];
  failed(error: unknown, cancelled: boolean): { events: EventInput[]; status: "partial" | "failed" | "cancelled"; error: string };
}
interface Host {
  envs: CandidateEnvs;
  snapshot(): Snapshot;
  events(): import("../../../packages/protocol/src/index.ts").StoredEvent[];
  managed: ManagedWorkspaces;
  projects(): ProjectService;
  commit(events: EventInput[]): void;
  artifact(session: Session, text: string, summary: string, patch: CandidatePatch, sources?: ArtifactSource[]): RetainedArtifact;
  localRootBusy(root: string, exceptJobId?: string): boolean;
  closingProject(id: string): boolean;
  closingSession(id: string): boolean;
  roleProposal(id: string): CandidateRoleProposalRead;
  compoundProposal(workflowId: string, stepId: string): CompoundCandidateProposal;
  wake(): void;
  job(kind: string, projectId: string, sessionId: string, workspaceId: string | null,
    execute: (signal: AbortSignal, progress: (text: string) => void, jobId: string) => Promise<CandidateOperationResult>,
    start: (job: CapabilityJob) => void, settled: () => void, lifecycle: CandidateJobLifecycle): string;
}
export interface CandidateContext {
  session: Session; source: CandidateRoot; stage: CandidateRoot; authorityDigest: string;
  env?: Pick<CandidateEnvContext, "binding" | "files" | "stageFiles">;
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
    if (!session?.projectId) throw new MoguriError("candidate_env", "Choose an explicit project session source in its actual Env. No previous-root fallback.", 409);
    if (!snapshot.projects.some((project) => project.id === session.projectId)) throw new MoguriError("candidate_repository_required", "Candidates require the session's explicit Git-backed project. No previous repository was inherited.", 409);
    if (this.host.closingSession(id)) throw new MoguriError("candidate_cleanup_pending", "This source session is being permanently deleted. No candidate/model work was admitted.", 409);
    if (!snapshot.policy.allowedEnvs.includes(session.controls.env) || this.host.closingProject(session.projectId)) throw new MoguriError("candidate_env", "Current global/project policy excludes this actual Env. No root was read.", 403);
    if (session.kind !== "agent" || session.mode !== "agent" || session.pendingMode === "read-only" || session.status === "archived") throw new MoguriError("read_only", "This session cannot stage or apply repository candidates.", 403);
    return session;
  }
  assertSession(id: string): Session { return this.session(id); }
  async readSource(sessionId: string, paths: string[]): Promise<Extract<CandidateWorkspaceResponse, { type: "candidate.source" }>> {
    const session = this.session(sessionId), signal = AbortSignal.timeout(90_000);
    if (session.controls.env !== "Local") {
      const { source, files } = await this.host.envs.source(session.id, paths, signal);
      return { type: "candidate.source", source, files };
    }
    const { project, git } = await this.repository(session, signal), identity = await sourceRoot(project.path);
    const source: CandidateRoot = { env: "Local", projectId: session.projectId!, workspaceId: session.workspaceId, ...identity, ...git };
    const policy = folderPolicy(this.host.projects().configuration(session.projectId!).values), files = [];
    for (const path of paths) {
      candidatePatch({ kind: "patch", summary: "Reviewed source", edits: [{ path, baseDigest: "absent", text: "" }] });
      await assertFolderAccess(project.path, path, false, policy);
      const baseDigest = await candidateFileBase(project.path, path), file = baseDigest === "absent" ? null : await readProjectFile(project.path, path);
      if (file && file.digest !== baseDigest) throw new MoguriError("candidate_conflict", "Source changed during exact read. No content was substituted.", 409);
      files.push({ path, baseDigest, text: file?.text ?? null });
    }
    this.session(sessionId);
    if (!sameCandidateRoot(source, { ...source, ...await sourceRoot(project.path), ...await readGitBinding(project.path, signal) })) throw new MoguriError("candidate_root", "Original source directory/base changed during its selected read.", 409);
    return { type: "candidate.source", source, files };
  }
  async stageFileBase(context: CandidateContext, path: string): Promise<string> {
    if (!context.env) return candidateFileBase(context.stage.root, path);
    const file = context.env.stageFiles.find((file) => file.path === path);
    if (!file) throw new MoguriError("candidate_source", "The original selected staging file is missing from its exact captured response.", 409);
    return file.baseDigest;
  }
  async validationState(sessionId: string, source: CandidateRoot, stage: CandidateRoot, patch: CandidatePatch, signal: AbortSignal) {
    if (source.env === "Local") return null;
    const context = await this.context(sessionId, stage.workspaceId!, patch.edits.map((edit) => edit.path), signal, false);
    if (!context.env || !sameCandidateRoot(context.source, source) || !sameCandidateRoot(context.stage, stage)) throw new MoguriError("candidate_root", "Validation lost its original exact Env/source/stage.", 409);
    const result = await this.host.envs.transports.execute(context.env.binding, { kind: "read", id: randomUUID(), authorityDigest: context.authorityDigest },
      { action: "state", source, stage, patch }, signal);
    if (result.type !== "state") throw new MoguriError("candidate_receipt", "Validation state returned a different actual operation type.", 409);
    context.current(); return { stateDigest: result.digest, scope: context.env.binding.scope, source };
  }
  private available(id: string): void {
    if (candidateDeletionPending(this.host.snapshot().candidateCleanups, id)) throw new MoguriError("candidate_cleanup_pending", "This exact proposal is pending permanent cleanup. No new application or file effect was admitted.", 409);
  }
  private async repository(session: Session, signal: AbortSignal) {
    const project = this.host.managed.project(session);
    try { return { project, git: await readGitBinding(project.path, signal) }; }
    catch (error) {
      if (error instanceof MoguriError && (error.code === "workspace_git_root" || error.code === "program_failed" && /not a git repository|not a work tree/i.test(error.message))) {
        throw new MoguriError("candidate_repository_required", "Candidates require an explicit project backed by this exact Git working tree. Plain folders and project-free chats cannot create proposals; no previous repository was reused.", 409);
      }
      throw error;
    }
  }
  private async context(sessionId: string, stageWorkspaceId: string, paths: string[], signal: AbortSignal, clean: boolean, exceptJobId?: string): Promise<CandidateContext> {
    const session = this.session(sessionId), snapshot = this.host.snapshot(), projectId = session.projectId!;
    if (session.controls.env !== "Local") return this.host.envs.context(session, stageWorkspaceId, paths, signal, clean, exceptJobId);
    const repository = await this.repository(session, signal), sourceProject = repository.project;
    this.session(sessionId);
    const stageProject = this.host.managed.project({ projectId, workspaceId: stageWorkspaceId });
    if (session.workspaceId === stageWorkspaceId || sourceProject.path === stageProject.path) throw new MoguriError("candidate_root", "Select a separate owned candidate worktree, never the source checkout.", 409);
    const configuration = this.host.projects().configuration(projectId), permissionRevision = snapshot.settings.permissionRevision, policyRevision = snapshot.policy.revision;
    const [sourceIdentity, stageIdentity, stageGit] = await Promise.all([
      sourceRoot(sourceProject.path), sourceRoot(stageProject.path), readGitBinding(stageProject.path, signal),
    ]);
    const source: CandidateRoot = { env: "Local", projectId, workspaceId: session.workspaceId, ...sourceIdentity, ...repository.git };
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
  private async bases(context: CandidateContext, patch: CandidatePatch, staged = false): Promise<void> {
    if (!context.env) { if (staged) await candidateBytes(context.stage.root, patch); else await candidateBases(context.source.root, patch); return; }
    const files = staged ? context.env.stageFiles : context.env.files;
    for (const edit of patch.edits) {
      const file = files.find((file) => file.path === edit.path);
      if (!file || file.baseDigest !== (staged ? digest(edit.text) : edit.baseDigest) || staged && file.text !== edit.text) {
        throw new MoguriError(staged ? "candidate_changed" : "candidate_conflict", `The exact ${staged ? "staged proposal" : "source base"} changed at ${edit.path}. No Local file or replacement content was adopted.`, 409);
      }
    }
  }
  private async preview(sessionId: string, stageWorkspaceId: string, value: CandidatePatch, signal: AbortSignal, roleSequenceId?: string, compound?: { workflowId: string; stepId: string }): Promise<{ preview: CandidateStagePreview; context: CandidateContext; roleProposal?: CandidateRoleProposalRead; compoundProposal?: CompoundCandidateProposal }> {
    this.session(sessionId);
    if (roleSequenceId && compound) throw new MoguriError("candidate_origin", "One exact actual model origin may own a candidate review.", 409);
    const roleProposal = roleSequenceId ? this.host.roleProposal(roleSequenceId) : undefined,
      compoundProposal = compound ? this.host.compoundProposal(compound.workflowId, compound.stepId) : undefined, patch = candidatePatch(value);
    const modelProposal = roleProposal ?? compoundProposal;
    if (modelProposal && !sameCandidatePatch(modelProposal.document.patch, patch)) throw new MoguriError("role_proposal_source", "The summary or ordered patch changed from the exact actual role. Use an explicitly unverified import; no model attribution was adopted.", 409);
    const context = await this.context(sessionId, stageWorkspaceId, patch.edits.map(({ path }) => path), signal, true);
    if (modelProposal && (!sameCandidateRoot(modelProposal.document.source, context.source) || !sameCandidateRoot(modelProposal.document.stage, context.stage))) throw new MoguriError("role_proposal_source", "This actual role belongs to different original source/staging roots. No compatible root was invented.", 409);
    await this.bases(context, patch);
    if (!context.env) for (const edit of patch.edits) await candidateFileBase(context.stage.root, edit.path);
    await context.assert();
    const document: CandidateDocument = { format: "moguri-candidate", version: context.source.env === "Local" ? 1 : 2, source: context.source, stage: context.stage, authorityDigest: context.authorityDigest, patch,
      ...(roleProposal ? { roleOrigin: roleProposal.document.roleOrigin } : {}) };
    if (compoundProposal) document.compoundOrigin = compoundProposal.document.compoundOrigin;
    const text = JSON.stringify(document);
    if (Buffer.byteLength(text) > 64 * 1024) throw new MoguriError("candidate_limit", "The exact versioned candidate document exceeds 64 KiB. No content was truncated.", 409);
    return { context, preview: { document, documentDigest: digest(text), digest: candidateDigest(text),
      ...(roleProposal ? { warning: "Staging retains a separate copy of this role's origin, original input and raw result. Deleting the source role report will not erase this candidate copy. Provenance is not quality or acceptance; source application needs its own fresh review." } : {}) },
      ...(roleProposal ? { roleProposal } : {}), ...(compoundProposal ? { compoundProposal } : {}) };
  }
  async generationSource(sessionId: string, stageWorkspaceId: string, input: CandidateGenerationInput, signal: AbortSignal, clean = true): Promise<CandidateContext & { files: Array<{ path: string; baseDigest: string; text: string | null }> }> {
    input = structuredClone(input);
    const selection = candidatePatch({ kind: "patch", summary: "Reviewed generation source", edits: input.files.map((file) => ({ ...file, text: "" })) });
    const context = await this.context(sessionId, stageWorkspaceId, selection.edits.map((file) => file.path), signal, clean);
    const files: Array<{ path: string; baseDigest: string; text: string | null }> = [];
    for (const file of input.files) {
      if (context.env) {
        const source = context.env.files.find((value) => value.path === file.path);
        if (!source || source.baseDigest !== file.baseDigest) throw new MoguriError("candidate_generation_base", `Original selected Env source changed at ${file.path}. No model was called.`, 409);
        files.push(source); continue;
      }
      if (await candidateFileBase(context.source.root, file.path) !== file.baseDigest) throw new MoguriError("candidate_generation_base", `Source ${file.path} changed before generation review. Reload its exact base; no model was called.`, 409);
      const source = file.baseDigest === "absent" ? null : await readProjectFile(context.source.root, file.path);
      if (source && source.digest !== file.baseDigest) throw new MoguriError("candidate_generation_base", `Source ${file.path} changed during capture. No new content was substituted.`, 409);
      files.push({ ...file, text: source?.text ?? null });
    }
    if (Buffer.byteLength(JSON.stringify(files)) > 64 * 1024) throw new MoguriError("candidate_generation_limit", "Selected generation source exceeds 64 KiB. Select fewer/smaller files; nothing was truncated.");
    if (!context.env) for (const file of files) if (await candidateFileBase(context.source.root, file.path) !== file.baseDigest) throw new MoguriError("candidate_generation_base", `Source ${file.path} changed during review. No model was called.`, 409);
    await context.assert(); return { ...context, files };
  }
  private async applyPreview(id: string, sessionId: string, signal: AbortSignal, exceptJobId?: string): Promise<{ preview: CandidateApplyPreview; context: CandidateContext; document: CandidateDocument }> {
    this.available(id);
    const record = this.record(id), document = this.document(record);
    if (record.status !== "staged" && !(exceptJobId && record.status === "applying" && record.applyIntent?.jobId === exceptJobId)) throw new MoguriError("candidate_state", "Only an exact completely staged candidate can be reviewed for application. Partial/terminal work is never retried.", 409);
    const context = await this.context(sessionId, record.stage.workspaceId!, record.paths, signal, false, exceptJobId);
    if (!sameCandidateRoot(context.source, record.source) || !sameCandidateRoot(context.stage, record.stage)) throw new MoguriError("candidate_root", "This explicit session does not own the candidate's recorded Env/source/base.", 409);
    await this.bases(context, document.patch); await this.bases(context, document.patch, true); await context.assert();
    const body = { candidateId: id, sessionId, revision: record.revision, source: record.source, stage: record.stage,
      documentDigest: record.documentDigest, proposalDigest: record.proposalDigest, authorityDigest: context.authorityDigest };
    return { preview: { ...body, digest: digest(JSON.stringify(body)) }, context, document };
  }
  async query(query: CandidateQuery): Promise<CandidateResponse> {
    if (query.type === "candidate.eligibility") {
      try {
        const session = this.session(query.sessionId);
        if (session.controls.env === "Local") await this.repository(session, AbortSignal.timeout(15_000));
        else await this.host.envs.source(session.id, [], AbortSignal.timeout(90_000));
        this.session(query.sessionId);
        return { type: query.type, eligible: true, diagnostic: null };
      } catch (error) {
        if (!(error instanceof MoguriError)) throw error;
        return { type: query.type, eligible: false, diagnostic: error.message };
      }
    }
    if (query.type === "candidate.role.proposal") return this.host.roleProposal(query.sequenceId);
    if (query.type === "candidate.preview") {
      if (Boolean(query.compoundWorkflowId) !== Boolean(query.compoundStepId)) throw new MoguriError("candidate_origin", "Compound provenance requires both its original workflow and actual model step.", 409);
      return { type: query.type, preview: (await this.preview(query.sessionId, query.stageWorkspaceId, query.patch, AbortSignal.timeout(15_000), query.roleSequenceId,
        query.compoundWorkflowId && query.compoundStepId ? { workflowId: query.compoundWorkflowId, stepId: query.compoundStepId } : undefined)).preview };
    }
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
        const uncertain = possible || error instanceof MoguriError && ["program_partial", "workspace_partial", "candidate_partial",
          "candidate_transport_partial", "candidate_stop_unconfirmed", "candidate_frame", "candidate_transport_timeout", "candidate_receipt"].includes(error.code);
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
    this.available(id);
    const context = await this.context(sessionId, record.stage.workspaceId!, record.paths, signal, phase === "stage", jobId);
    const current = () => { context.current(); this.available(id); };
    if (!sameCandidateRoot(context.source, record.source) || !sameCandidateRoot(context.stage, record.stage) ||
      context.authorityDigest !== (phase === "stage" ? document.authorityDigest : record.acceptance?.authorityDigest)) throw new MoguriError("candidate_stale", "The exact reviewed candidate authority changed before effects.", 409);
    if (context.env) {
      const confirmed: string[] = []; this.observed.set(id, { paths: confirmed, current });
      const result = await this.host.envs.transports.execute(context.env.binding,
        { kind: "candidate", id, authorityDigest: context.authorityDigest, operationId: jobId },
        { action: "write", candidateId: id, phase, source: record.source, stage: record.stage, patch: document.patch }, signal,
        async (event, path) => {
          if (!path) throw new MoguriError("candidate_frame", "An exact candidate file receipt omitted its reviewed path.", 409);
          const actual = this.record(id);
          const attempted = phase === "stage" ? actual.stageAttemptedPaths ?? [] : actual.attemptedPaths;
          if (event === "attempt") {
            current();
            if (record.paths[attempted.length] !== path) throw new MoguriError("candidate_frame", "Candidate file attempt changed its exact ordered path or was replayed.", 409);
            this.update(id, phase === "stage" ? { stageAttemptedPaths: [...attempted, path] } : { attemptedPaths: [...attempted, path] });
          } else {
            if (attempted[confirmed.length] !== path || confirmed.includes(path)) throw new MoguriError("candidate_frame", "Observed bytes have no original retained ordered attempt.", 409);
            confirmed.push(path);
            this.update(id, phase === "stage" ? { stagedPaths: [...confirmed] } : { appliedPaths: [...confirmed] });
            progress(`${phase === "stage" ? "Staged" : "Applied"} ${confirmed.length}/${record.paths.length} exact ${record.source.env} files.`);
          }
        });
      current();
      if (result.type !== "written") throw new MoguriError("candidate_receipt", "Original selected Env worker returned a different operation result.", 409);
      return result.result;
    }
    await candidateBases(record.source.root, document.patch);
    if (phase === "apply") await candidateBytes(record.stage.root, document.patch);
    const root = phase === "stage" ? record.stage.root : record.source.root, bases: string[] = [];
    for (const edit of document.patch.edits) bases.push(phase === "stage" ? await candidateFileBase(root, edit.path) : edit.baseDigest);
    const confirmed: string[] = []; this.observed.set(id, { paths: confirmed, current });
    for (let index = 0; index < document.patch.edits.length; index++) {
      const edit = document.patch.edits[index]!;
      await context.assert(); current();
      if (phase === "apply" && await candidateFileBase(record.stage.root, edit.path) !== digest(edit.text)) throw new MoguriError("candidate_changed", "The staged proposal changed after review. Existing source changes were preserved.", 409);
      const actual = this.record(id);
      this.update(id, phase === "stage" ? { stageAttemptedPaths: [...(actual.stageAttemptedPaths ?? []), edit.path] } : { attemptedPaths: [...actual.attemptedPaths, edit.path] });
      await writeProjectFile(root, edit.path, edit.text, bases[index]!, { signal, beforeCommit: current, committed: () => { confirmed.push(edit.path); } });
      const latest = this.record(id);
      this.update(id, phase === "stage" ? { stagedPaths: [...latest.stagedPaths, edit.path] } : { appliedPaths: [...latest.appliedPaths, edit.path] });
      progress(`${phase === "stage" ? "Staged" : "Applied"} ${index + 1}/${record.paths.length} exact files.`);
    }
    await context.assert();
    const files = await candidateBytes(root, document.patch); current();
    return { version: 1, candidateId: id, phase, source: record.source, stage: record.stage, readback: true, files };
  }
  async execute(command: CandidateCommand, finish: WorkspaceFinish): Promise<CommandResult> {
    const intent = finish.intent;
    if (!intent) throw new MoguriError("candidate_intent", "A canonical user command identity is required before candidate work.", 409);
    if (this.host.events().some((event) => event.event_type === "artifact.deleted" && event.payload.candidateIntents?.some((owned) => owned.commandId === intent.id))) {
      throw new MoguriError("candidate_deleted", "This original candidate command was permanently deleted. Its proposal and file effects cannot be recreated or replayed.", 410);
    }
    const previous = this.host.snapshot().candidates.find((candidate) => [candidate.stageIntent, candidate.applyIntent].some((owned) => owned?.commandId === intent.id));
    if (previous) {
      const owned = previous.applyIntent?.commandId === intent.id ? previous.applyIntent : previous.stageIntent;
      if (owned.commandDigest !== intent.digest) throw new MoguriError("idempotency_conflict", "Original candidate command arguments changed. No replay.", 409);
      return finish([], { id: previous.id });
    }
    if (command.type === "candidate.reject") {
      this.available(command.candidateId);
      const candidate = this.record(command.candidateId);
      if (candidate.revision !== command.expectedRevision || candidate.status !== "staged") throw new MoguriError("candidate_state", "Reload the exact staged candidate before rejecting it.", 409);
      return finish([this.event({ ...candidate, status: "rejected", revision: candidate.revision + 1, updatedAt: new Date().toISOString(), diagnostic: "The actual user rejected this proposal; no source file was applied." })], { id: candidate.id, revision: candidate.revision + 1 });
    }
    let result: CommandResult | undefined;
    if (command.type === "candidate.stage") {
      const generationId = "generationId" in command ? command.generationId : undefined, roleSequenceId = "roleSequenceId" in command ? command.roleSequenceId : undefined;
      const { preview, context, roleProposal, compoundProposal } = await this.preview(command.sessionId, command.stageWorkspaceId, command.patch, AbortSignal.timeout(15_000), roleSequenceId,
        "compoundWorkflowId" in command ? { workflowId: command.compoundWorkflowId, stepId: command.compoundStepId } : undefined);
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
      if (compoundProposal) sources = [compoundProposal.modelSource];
      context.current();
      const text = JSON.stringify(preview.document), artifact = this.host.artifact(context.session, text, preview.document.patch.summary, preview.document.patch, sources), id = artifact.id;
      const now = new Date().toISOString(); context.current();
      this.host.job("candidate.stage", artifact.projectId!, command.sessionId, command.stageWorkspaceId,
        (signal, progress, jobId) => this.files(id, "stage", command.sessionId, signal, progress, jobId),
        (job) => {
          const candidate: CandidateRecord = { version: preview.document.version, id, profileId: this.host.snapshot().profileId, projectId: artifact.projectId!, originSessionId: command.sessionId,
            ...(generationId ? { generationId } : {}), ...(preview.document.roleOrigin ? { roleOrigin: preview.document.roleOrigin } : {}),
            ...(preview.document.compoundOrigin ? { compoundOrigin: preview.document.compoundOrigin } : {}),
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
