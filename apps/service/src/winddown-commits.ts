import {
  MoguriError, parse, projectWinddown, sameCandidateRoot, WinddownCommitDocumentSchema, WinddownCommitResultSchema,
  type CapabilityJob, type CommandResult, type EventInput, type Project, type Session, type Snapshot, type WinddownCommitDocument,
  type WinddownCommitResult, type WinddownDocument, type WinddownRecord, type WinddownQuery, type WinddownCommand,
} from "../../../packages/protocol/src/index.ts";
import { candidateDocument, candidatePatch } from "./candidate-files.ts";
import { candidateGitState, readGitBinding } from "./project-git.ts";
import { captureNativeSource, assertNativeSource } from "./native-staging.ts";
import { assertFolderName, folderPolicy } from "./project-policy.ts";
import { authorizeTool } from "./permissions.ts";
import { sourceRootSync } from "./repository-source.ts";
import type { ProjectService } from "./project-service.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import type { CandidateJobLifecycle } from "./candidates.ts";
import { digest, type EventStore } from "./store.ts";

export interface WinddownCommitHost {
  snapshot(): Snapshot; record(id: string): WinddownRecord; input(record: WinddownRecord): WinddownDocument;
  event(record: WinddownRecord): EventInput; commit(events: EventInput[]): void;
  root(session: Session): Project | null; assertRoot(session: Session, signal: AbortSignal): Promise<void>; rootBusy(root: string, exceptJobId?: string): boolean;
  projects(): ProjectService;
  job(projectId: string, sessionId: string, workspaceId: string | null,
    execute: (signal: AbortSignal, progress: (text: string) => void, jobId: string) => Promise<WinddownCommitResult>,
    start: (job: CapabilityJob) => void, lifecycle: CandidateJobLifecycle): string;
}
type Input = Omit<Extract<WinddownQuery, { type: "winddown.commit.preview" }>, "type">;
export class WinddownCommits {
  constructor(private readonly store: EventStore, private readonly host: WinddownCommitHost) {}
  private context(record: WinddownRecord, sessionId: string, exceptJobId?: string) {
    const state = this.host.snapshot(), session = state.sessions.find((session) => session.id === sessionId), original = this.host.input(record).source;
    if (!original || !record.projectId || !session || session.id !== record.sessionId || session.projectId !== record.projectId || session.workspaceId !== record.workspaceId ||
      session.controls.env !== "Local" || session.mode !== "agent" || session.pendingMode === "read-only" || session.kind !== "agent" || session.status === "archived" ||
      session.turnId || !state.policy.allowedEnvs.includes("Local")) throw new MoguriError("winddown_commit_scope", "Select the exact original restored Local writable source session after owned work ends. Project-free/deleted/moved sources never inherit a checkout.", 409);
    const project = this.host.root(session);
    if (!project || project.path !== original.root || JSON.stringify({ projectId: session.projectId, workspaceId: session.workspaceId, ...sourceRootSync(project.path) }) !== JSON.stringify(original)) throw new MoguriError("winddown_commit_root", "The originally captured source root/identity changed. No base-checkout or alias fallback.", 409);
    const configuration = this.host.projects().configuration(record.projectId);
    const policyDigest = digest(JSON.stringify({ profileId: state.profileId, sessionId, projectId: record.projectId, workspaceId: session.workspaceId, root: original,
      policy: state.policy, permissionRevision: state.settings.permissionRevision, permissions: state.settings.values.permissions, configuration,
      mode: session.mode, pendingMode: session.pendingMode, kind: session.kind }));
    const current = () => {
      const fresh = this.host.snapshot(), actual = fresh.sessions.find((value) => value.id === sessionId);
      if (!actual || actual.turnId || actual.projectId !== record.projectId || actual.workspaceId !== record.workspaceId || actual.controls.env !== "Local" ||
        actual.mode !== "agent" || actual.pendingMode === "read-only" || actual.status === "archived" || !fresh.policy.allowedEnvs.includes("Local") ||
        digest(JSON.stringify({ profileId: fresh.profileId, sessionId, projectId: record.projectId, workspaceId: actual.workspaceId, root: original,
          policy: fresh.policy, permissionRevision: fresh.settings.permissionRevision, permissions: fresh.settings.values.permissions,
          configuration: this.host.projects().configuration(record.projectId!), mode: actual.mode, pendingMode: actual.pendingMode, kind: actual.kind })) !== policyDigest ||
        this.host.root(actual)?.path !== original.root || JSON.stringify({ projectId: actual.projectId, workspaceId: actual.workspaceId, ...sourceRootSync(original.root) }) !== JSON.stringify(original)) throw new MoguriError("winddown_commit_stale", "Current source identity, mode or actual caller policy changed. No stale Git grant or root substitution.", 409);
      if (this.host.rootBusy(original.root, exceptJobId) || (record.workspaceId ? fresh.blockedWorkspaces.includes(record.workspaceId) : fresh.blockedProjects.includes(record.projectId!)) ||
        fresh.terminals.some((terminal) => terminal.env === "Local" && (terminal.binding?.root === original.root || terminal.projectId === record.projectId && terminal.workspaceId === record.workspaceId) &&
          !["closed", "failed", "acknowledged"].includes(terminal.status))) throw new MoguriError("workspace_busy", "An actual writer, console or unconfirmed operation holds this exact checkpoint source. Inspect/settle it; no checkout fallback.", 409);
    };
    current(); return { session, project, configuration, policyDigest, current };
  }
  async preview(value: Input, signal = AbortSignal.timeout(15000)) {
    const input = structuredClone(value), record = this.host.record(input.winddownId);
    if (record.status !== "ready" || record.commit !== null) throw new MoguriError("winddown_commit_state", "Only one exact complete known finishing report may request a fresh actual-user accepted-work review. Terminal/partial work cannot replay.", 409);
    const context = this.context(record, input.sessionId);
    await this.host.assertRoot(context.session, signal);
    const git = await readGitBinding(context.project.path, signal), source = { env: "Local" as const, projectId: record.projectId!, workspaceId: record.workspaceId, ...sourceRootSync(context.project.path), ...git };
    const candidates = input.candidateIds.map((id) => {
      const candidate = this.host.snapshot().candidates.find((candidate) => candidate.id === id);
      if (!candidate || candidate.status !== "applied" || candidate.acceptance?.actor !== "user" || candidate.source.projectId !== source.projectId ||
        candidate.source.workspaceId !== source.workspaceId || candidate.source.root !== source.root || candidate.source.device !== source.device || candidate.source.inode !== source.inode ||
        candidate.source.gitCommonDir !== source.gitCommonDir) throw new MoguriError("winddown_acceptance", "Every selected candidate needs retained actual-user source acceptance at this exact Local root/repository. Staging, tests and model/critic advice cannot supply it.", 409);
      return structuredClone(candidate);
    });
    const edits = candidates.flatMap((candidate) => candidateDocument(this.store.blob(candidate.documentDigest), candidate).patch.edits);
    candidatePatch({ kind: "patch", summary: "Exact actual-user accepted checkpoint source", edits });
    const policy = folderPolicy(context.configuration.values), settings = this.host.snapshot().settings.values;
    for (const edit of edits) {
      assertFolderName(edit.path, true, policy);
      for (const call of [{ id: record.id, name: "write_file", arguments: { path: edit.path } },
        { id: record.id, name: "git_checkpoint", arguments: { path: edit.path } },
        { id: record.id, name: "run_command", arguments: { command: "git checkpoint " + input.branch } }]) {
        const authorization = authorizeTool(settings, call, source.root);
        if (authorization.decision === "deny") throw new MoguriError("tool_denied", authorization.reason, 403);
      }
    }
    const captured = await captureNativeSource(source.root, edits.map((edit) => edit.path), policy, signal);
    if (edits.some((edit) => !captured.files.some((file) => file.path === edit.path && file.text === edit.text && file.digest === digest(edit.text)))) throw new MoguriError("winddown_accepted_changed", "Actual source bytes changed after user acceptance. No old model result or accepted file was substituted.", 409);
    const target = await this.host.projects().artifactCommitPreview(context.project, input.branch, signal);
    if (target.base !== source.head) throw new MoguriError("winddown_commit_base", "Actual source HEAD changed during review. No branch or reset.", 409);
    const document: WinddownCommitDocument = { format: "moguri-budget-checkpoint-commit", version: 1, winddownId: record.id, sessionId: input.sessionId,
      source, policyDigest: context.policyDigest, sourceStateDigest: digest(await candidateGitState(source.root, signal)), branch: target.branch, base: target.base, message: input.message, candidates,
      files: captured.files.map((file) => ({ path: file.path, text: file.text, digest: file.digest, mode: file.mode & 0o111 ? "100755" : "100644" })) };
    parse(WinddownCommitDocumentSchema, document);
    const text = JSON.stringify(document);
    if (!text.isWellFormed() || Buffer.byteLength(text) > 128 * 1024) throw new MoguriError("winddown_commit_limit", "The complete accepted-work/Git review exceeds lossless 128 KiB. Select fewer exact candidates; nothing was truncated.", 409);
    await assertNativeSource(captured, signal); context.current();
    if (this.host.record(record.id).revision !== record.revision) throw new MoguriError("winddown_commit_stale", "The original independent finishing report changed during review.", 409);
    return { document, text, digest: digest(`moguri-budget-checkpoint-commit-v1\0${text}`), revision: record.revision,
      warning: "Actual-user accepted bytes and separate Git permission only. No new project tests or model quality are implied. A new local branch preserves the source index/HEAD; no checkout, push, merge or branch deletion." };
  }
  private currentDocument(record: WinddownRecord): WinddownCommitDocument {
    if (!record.commitDocumentDigest || !record.commit) throw new MoguriError("winddown_commit_intent", "No exact independent actual-user Git intent exists.", 409);
    const document = parse(WinddownCommitDocumentSchema, JSON.parse(this.store.blob(record.commitDocumentDigest)));
    if (document.winddownId !== record.id || document.sessionId !== record.sessionId || document.branch !== record.commit.branch || document.base !== record.commit.base ||
      digest(`moguri-budget-checkpoint-commit-v1\0${JSON.stringify(document)}`) !== record.commit.reviewDigest) throw new MoguriError("winddown_commit_corrupt", "Original accepted-work/Git review document no longer matches its exact user intent.", 409);
    return document;
  }
  private update(id: string, changes: Partial<NonNullable<WinddownRecord["commit"]>>) {
    const record = this.host.record(id);
    if (!record.commit) throw new MoguriError("winddown_commit_intent", "The original user Git intent disappeared. No replay.", 409);
    this.host.commit([this.host.event(projectWinddown(record, { ...record, revision: record.revision + 1, updatedAt: new Date().toISOString(), commit: { ...record.commit, ...changes } }))]);
  }
  private lifecycle(id: string): CandidateJobLifecycle {
    return {
      completed: (value, resultDigest) => {
        const result = parse(WinddownCommitResultSchema, value), record = this.host.record(id), document = this.currentDocument(record), commit = record.commit;
        if (!commit) throw new MoguriError("winddown_commit_intent", "Original actual-user commit ownership disappeared. No successful job was inferred.", 409);
        const context = this.context(record, record.sessionId, commit.jobId);
        context.current();
        if (record.status !== "committing" || commit.cancelRequested || commit.publishedCommit !== result.commit || result.winddownId !== id ||
          result.branch !== document.branch || result.base !== document.base || !sameCandidateRoot(result.source, document.source) ||
          result.sourceStateDigest !== document.sourceStateDigest || JSON.stringify(result.files) !== JSON.stringify(document.files.map(({ path, digest }) => ({ path, digest })))) throw new MoguriError("winddown_commit_partial", "Actual ref/source/readback did not match its exact retained publication. No successful checkpoint was inferred.", 409);
        return [this.host.event(projectWinddown(record, { ...record, revision: record.revision + 1, updatedAt: new Date().toISOString(), status: "completed", diagnostic: null,
          commit: { ...commit, resultDigest } }))];
      },
      failed: (error, cancelled) => {
        const record = this.host.record(id), possible = record.commit?.publicationAttempted === true;
        const status = possible ? "partial" : "failed", diagnostic = error instanceof MoguriError ? error.message :
          cancelled ? "Actual accepted-work checkpoint was stopped. Prepared objects may remain; no branch rollback or successful commit was invented." : "Actual Git checkpoint failed. Prepared objects/ref intent were retained; no source/index/HEAD reset or replay.";
        if (!(error instanceof MoguriError) && !cancelled) console.error("Accepted-work checkpoint failed:", error instanceof Error && "code" in error ? String(error.code) : "winddown_git");
        return { events: [this.host.event(projectWinddown(record, { ...record, revision: record.revision + 1, updatedAt: new Date().toISOString(), status, diagnostic }))],
          status, error: diagnostic };
      },
    };
  }
  private async publish(id: string, signal: AbortSignal, progress: (text: string) => void, jobId: string): Promise<WinddownCommitResult> {
    const record = this.host.record(id), document = this.currentDocument(record);
    if (record.status !== "committing" || record.commit?.jobId !== jobId || record.commit.publicationAttempted) throw new MoguriError("winddown_commit_replay", "This exact original Git intent already attempted publication or ended. No branch replay.", 409);
    const context = this.context(record, record.sessionId, jobId), policy = folderPolicy(context.configuration.values);
    await this.host.assertRoot(context.session, signal);
    const captured = await captureNativeSource(document.source.root, document.files.map((file) => file.path), policy, signal);
    const check = async () => {
      signal.throwIfAborted(); context.current(); await this.host.assertRoot(context.session, signal); await assertNativeSource(captured, signal);
      if (captured.files.some((file) => !document.files.some((expected) => expected.path === file.path && expected.digest === file.digest && expected.text === file.text &&
        expected.mode === (file.mode & 0o111 ? "100755" : "100644"))) ||
        !sameCandidateRoot(document.source, { ...document.source, ...sourceRootSync(document.source.root), ...await readGitBinding(document.source.root, signal) }) ||
        digest(await candidateGitState(document.source.root, signal)) !== document.sourceStateDigest) throw new MoguriError("winddown_commit_stale", "Actual source files, Git base/index state or root changed after user review. Preserve all inputs; no reset or substitution.", 409);
      for (const original of document.candidates) {
        const candidate = this.host.snapshot().candidates.find((candidate) => candidate.id === original.id);
        if (!candidate || candidate.revision !== original.revision || JSON.stringify(candidate) !== JSON.stringify(original) || candidate.acceptance?.actor !== "user") throw new MoguriError("winddown_acceptance_changed", "An original actual-user accepted source record changed or was deleted. No model result or missing review was substituted.", 409);
      }
      signal.throwIfAborted(); context.current();
    };
    await check(); progress("Preparing only exact actual-user accepted bytes with a temporary Git index.");
    const result = await this.host.projects().reviewedCommit(context.project, document.files, { branch: document.branch, base: document.base }, document.message, signal, {
      beforeCommit: context.current,
      publishIntent: async (prepared) => { await check(); this.update(id, { preparedCommit: prepared.commit, publicationAttempted: true }); },
      committed: (published) => this.update(id, { publishedCommit: published.commit }),
    });
    await check();
    for (const file of document.files) await this.host.projects().verifyArtifactCommit(context.project, file.path, result, signal);
    await check(); progress("Verified the actual new local ref and accepted blobs. Original source index/HEAD were not replaced.");
    return { version: 1, winddownId: id, source: document.source, branch: result.branch, base: result.base, commit: result.commit, verified: true,
      sourceStateDigest: document.sourceStateDigest, files: document.files.map(({ path, digest }) => ({ path, digest })) };
  }
  async execute(command: Extract<WinddownCommand, { type: "winddown.commit" }>, finish: WorkspaceFinish): Promise<CommandResult> {
    const record = this.host.record(command.winddownId), intent = finish.intent;
    if (!intent) throw new MoguriError("winddown_commit_intent", "Accepted-work Git publication requires the exact original actual-user command identity.", 409);
    if (record.commit?.commandId === intent.id) {
      if (record.commit.commandDigest !== intent.digest) throw new MoguriError("command_reused", "Original user checkpoint command already owns different immutable input.", 409);
      return finish([], { id: record.id, revision: record.revision });
    }
    const preview = await this.preview(command);
    if (preview.revision !== command.expectedRevision || preview.digest !== command.expectedDigest) throw new MoguriError("winddown_commit_review", "Exact accepted bytes, root, policy, new branch or base changed. No Git intent was admitted.", 409);
    const fresh = this.host.record(record.id);
    if (fresh.status !== "ready" || fresh.revision !== preview.revision) throw new MoguriError("winddown_commit_stale", "Another client already decided this exact checkpoint. No second job.", 409);
    let response: CommandResult | undefined;
    this.host.job(record.projectId!, record.sessionId, record.workspaceId, (signal, progress, jobId) => this.publish(record.id, signal, progress, jobId),
      (job) => {
        const now = new Date().toISOString(), next = projectWinddown(fresh, { ...fresh, revision: fresh.revision + 1, updatedAt: now, status: "committing",
          commitDocumentDigest: this.store.putBlob(preview.text), commit: { actor: "user", commandId: intent.id, commandDigest: intent.digest, reviewDigest: preview.digest, at: now,
            jobId: job.id, branch: preview.document.branch, base: preview.document.base, preparedCommit: null, publicationAttempted: false, publishedCommit: null, resultDigest: null, cancelRequested: false } });
        response = finish([this.host.event(next), { event_type: "job.started", profile_id: record.profileId, project_id: record.projectId, session_id: record.sessionId,
          payload: { job: { ...job, winddownId: record.id } } }], { id: record.id, revision: next.revision });
      }, this.lifecycle(record.id));
    if (!response) throw new MoguriError("winddown_commit_intent", "The exact Git intent/job/receipt was not atomically acknowledged. No successful branch was inferred.", 409);
    return response;
  }
}
