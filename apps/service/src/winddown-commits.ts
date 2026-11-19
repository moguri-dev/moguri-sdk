import {
  MoguriError, parse, projectWinddown, sameCandidateRoot, isLocalCandidateRecord, WinddownCommitDocumentSchema, WinddownCommitResultSchema,
  type CapabilityJob, type CommandResult, type EventInput, type Project, type Session, type Snapshot, type WinddownCommitDocument,
  type WinddownCommitResult, type WinddownDocument, type WinddownRecord, type WinddownQuery, type WinddownCommand,
  SandboxPublicationSchema, SandboxPublicationDocumentSchema, SandboxPublicationResultSchema,
  RemoteCheckpointSourceSchema, PROTOCOL_VERSION, type RemoteCheckpointSource,
  WinddownCommitInspectionSchema, type WinddownCommitInspection,
} from "../../../packages/protocol/src/index.ts";
import { candidateDocument, candidatePatch } from "./candidate-files.ts";
import { candidateGitState, readGitBinding } from "./project-git.ts";
import { captureNativeSource, assertNativeSource } from "./native-staging.ts";
import { assertFolderName, folderPolicy } from "./project-policy.ts";
import { authorizeTool } from "./permissions.ts";
import { sameDurableIdentity, sameDurableRoot, sourceRootSync } from "./repository-source.ts";
import type { ProjectService } from "./project-service.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import type { CandidateJobLifecycle } from "./candidates.ts";
import { digest, type EventStore } from "./store.ts";
import { remoteFingerprint, remoteRootLease, type RemoteRuntime } from "./remote.ts";
import { frameDigest } from "./worker-wire.ts";

export interface WinddownCommitHost {
  snapshot(): Snapshot; record(id: string): WinddownRecord; input(record: WinddownRecord): WinddownDocument;
  event(record: WinddownRecord): EventInput; commit(events: EventInput[]): void;
  root(session: Session, repository?: string): Project | null; assertRoot(session: Session, signal: AbortSignal): Promise<void>; rootBusy(root: string, exceptJobId?: string): boolean;
  projects(): ProjectService;
  settleReaders?(sessionId: string): Promise<void>;
  remote: RemoteRuntime;
  job(projectId: string, sessionId: string, workspaceId: string | null,
    execute: (signal: AbortSignal, progress: (text: string) => void, jobId: string) => Promise<WinddownCommitResult>,
    start: (job: CapabilityJob) => void, lifecycle: CandidateJobLifecycle): string;
}
type Input = Omit<Extract<WinddownQuery, { type: "winddown.commit.preview" }>, "type">;
export class WinddownCommits {
  constructor(private readonly store: EventStore, private readonly host: WinddownCommitHost) {}
  private remoteContext(record: WinddownRecord, exceptJobId?: string, readQuarantined = false) {
    const state = this.host.snapshot(), session = state.sessions.find((entry) => entry.id === record.sessionId);
    if (record.version !== 3 || record.env !== "Remote" || record.transport?.env !== "Remote" || !record.projectId || !session ||
      session.turnId || session.controls.env !== "Remote" || session.projectId !== record.projectId || session.workspaceId || session.repositories ||
      session.kind !== "agent" || session.mode !== "agent" || session.pendingMode === "read-only" || session.status === "archived" ||
      !state.policy.allowedEnvs.includes("Remote")) throw new MoguriError("winddown_remote_scope", "Use the exact original idle writable SSH session and retained finishing report. No Local checkout, project-free root or different owner was adopted.", 409);
    const execution = state.executions.find((entry) => entry.id === record.transport!.executionId), target = this.host.remote.assertReady();
    const transport = record.transport;
    const configuration = this.host.projects().configuration(record.projectId);
    if (!execution || execution.sessionId !== session.id || execution.turnId !== record.turnId || execution.workspace !== record.transport.root ||
      execution.workspace !== configuration.values.remotePath || execution.workerDigest !== record.transport.workerDigest ||
      execution.workerDigest !== this.host.remote.readiness.workerDigest || remoteFingerprint(execution.target) !== record.transport.peerFingerprint ||
      execution.target.hostKey !== record.transport.hostKey || frameDigest(target) !== execution.configDigest || execution.cleanup !== "owned-worker-stopped") {
      throw new MoguriError("winddown_remote_scope", "Original SSH cleanup, pinned peer/root/build or current configuration changed. No target alias, acknowledged-only cleanup or Local Git fallback.", 409);
    }
    const key = remoteRootLease(execution.target, execution.workspace)!;
    const policy = () => {
      const fresh = this.host.snapshot(), actual = fresh.sessions.find((entry) => entry.id === session.id);
      return JSON.stringify({ profileId: fresh.profileId, sessionId: session.id, controls: actual?.controls, mode: actual?.mode, pendingMode: actual?.pendingMode,
        projectId: actual?.projectId, workspaceId: actual?.workspaceId, kind: actual?.kind, status: actual?.status === "archived",
        active: Boolean(actual?.turnId), policy: fresh.policy, permissions: fresh.settings.values.permissions,
        permissionRevision: fresh.settings.permissionRevision, remote: fresh.settings.values.remote, configuration: this.host.projects().configuration(record.projectId!) });
    };
    const policyDigest = digest(policy());
    const current = () => {
      const fresh = this.host.snapshot();
      if (digest(policy()) !== policyDigest || this.host.remote.readiness.workerDigest !== execution.workerDigest ||
        this.host.remote.readiness.hostFingerprint !== transport.peerFingerprint || this.host.rootBusy(key, exceptJobId) ||
        !readQuarantined && (fresh.blockedSessions.includes(session.id) || fresh.blockedProjects.includes(record.projectId!)) ||
        fresh.terminals.some((terminal) => terminal.env === "Remote" && terminal.projectId === record.projectId &&
          !["closed", "failed", "acknowledged"].includes(terminal.status))) {
        throw new MoguriError("winddown_remote_stale", "The original SSH source, current policy, writer or console changed, or source inspection is still required. Inspect and explicitly Resume quarantined work; no source or peer was substituted.", 409);
      }
    };
    current(); return { session, execution, configuration, policyDigest, current };
  }
  private async remoteSource(record: WinddownRecord, paths: string[], branch?: string, exceptJobId?: string, signal = AbortSignal.timeout(15000), readQuarantined = false) {
    await this.host.settleReaders?.(record.sessionId);
    const context = this.remoteContext(record, exceptJobId, readQuarantined), settings = context.configuration.values;
    if (branch && branch === settings.repo.mainBranch) throw new MoguriError("protected_branch", "Choose a new non-protected peer branch.");
    const result = await this.host.remote.query(context.execution.target, { action: "workspace", protocol: PROTOCOL_VERSION,
      stateDir: context.execution.target.stateDir, workerDigest: context.execution.workerDigest, root: context.execution.workspace,
      workspace: { query: { type: "checkpoint.source", paths: [...paths].sort(), ...(branch ? { branch } : {}) },
        policy: { deniedFolders: settings.deniedFolders, planPath: settings.planPath } } }, signal);
    context.current();
    if (result.kind !== "workspace" || result.result.type !== "checkpoint.source" || result.info.root !== context.execution.workspace ||
      result.info.workerDigest !== context.execution.workerDigest || record.version === 1) throw new MoguriError("winddown_remote_source", "Actual peer source read changed its exact root/build. No controller source or incomplete prefix was used.", 409);
    const document: RemoteCheckpointSource = { format: "moguri-remote-checkpoint-source", version: 1, winddownId: record.id, sessionId: record.sessionId,
      transport: record.transport!, source: { env: "Remote", projectId: record.projectId!, workspaceId: null, ...result.result.source },
      policyDigest: context.policyDigest, sourceStateDigest: result.result.sourceStateDigest, files: result.result.files };
    parse(RemoteCheckpointSourceSchema, document);
    if (Buffer.byteLength(JSON.stringify(document)) > 128 * 1024) throw new MoguriError("winddown_remote_limit", "Complete peer acceptance exceeds 128 KiB. Select fewer exact files; no prefix was selected.", 409);
    return { document, digest: digest(`moguri-remote-checkpoint-source-v1\0${JSON.stringify(document)}`), revision: record.revision,
      warning: "Separate actual-user source acceptance at the pinned SSH root. No model quality, Git permission, checkout or Local publication." };
  }
  async sourcePreview(id: string, paths: string[]) {
    const record = this.host.record(id);
    if (record.status !== "ready") throw new MoguriError("winddown_remote_state", "Only the original complete known finishing report can review accepted peer source.", 409);
    return this.remoteSource(record, paths, undefined, undefined, AbortSignal.timeout(15000), true);
  }
  async acceptSource(command: Extract<WinddownCommand, { type: "winddown.source.accept" }>, finish: WorkspaceFinish) {
    const record = this.host.record(command.winddownId), intent = finish.intent;
    if (!intent || record.version !== 3 || record.env !== "Remote") throw new MoguriError("winddown_remote_acceptance", "Actual source acceptance needs the exact original user command and Remote report.", 409);
    if (record.remoteAcceptance) {
      if (record.remoteAcceptance.commandId !== intent.id || record.remoteAcceptance.commandDigest !== intent.digest) throw new MoguriError("winddown_remote_acceptance", "This original source acceptance is immutable. No second accepted source replaced it.", 409);
      return finish([], { id: record.id, revision: record.revision });
    }
    const preview = await this.sourcePreview(record.id, command.paths), fresh = this.host.record(record.id);
    if (preview.revision !== command.expectedRevision || preview.digest !== command.expectedDigest || fresh.revision !== record.revision ||
      fresh.status !== "ready") throw new MoguriError("winddown_remote_stale", "Exact source bytes, peer/base or user acceptance changed during review.", 409);
    const next = projectWinddown(fresh, { ...fresh, revision: fresh.revision + 1, updatedAt: new Date().toISOString(),
      remoteAcceptance: { actor: "user", commandId: intent.id, commandDigest: intent.digest, reviewDigest: preview.digest,
        inputDigest: this.store.putBlob(JSON.stringify(preview.document)), at: new Date().toISOString() } });
    return finish([this.host.event(next)], { id: next.id, revision: next.revision });
  }
  private async remotePreview(record: WinddownRecord, input: Input) {
    if (record.version !== 3 || !record.remoteAcceptance || input.remoteAccepted !== true || input.candidateIds.length || input.nativePublicationIds ||
      input.sessionId !== record.sessionId || record.status !== "ready" || record.commit) throw new MoguriError("winddown_remote_acceptance", "Separately accept the exact peer bytes, then request their explicit new-branch Git review. Metadata or Local candidates cannot supply acceptance.", 409);
    const accepted = parse(RemoteCheckpointSourceSchema, JSON.parse(this.store.blob(record.remoteAcceptance.inputDigest)));
    const fresh = await this.remoteSource(record, accepted.files.map((file) => file.path), input.branch);
    if (JSON.stringify(fresh.document) !== JSON.stringify(accepted) || fresh.digest !== record.remoteAcceptance.reviewDigest) {
      throw new MoguriError("winddown_remote_stale", "The separately accepted original peer source/base/policy changed. No stale or different bytes entered Git.", 409);
    }
    const document: WinddownCommitDocument = { format: "moguri-budget-checkpoint-commit", version: 3, modelEnv: "Remote", publicationEnv: "Remote",
      winddownId: record.id, sessionId: record.sessionId, source: accepted.source, transport: accepted.transport, policyDigest: accepted.policyDigest,
      sourceStateDigest: accepted.sourceStateDigest, branch: input.branch, base: accepted.source.head, message: input.message, candidates: [],
      files: accepted.files, sourceAcceptance: record.remoteAcceptance, acceptedSource: accepted };
    const configuration = this.host.projects().configuration(record.projectId!);
    for (const file of document.files) {
      assertFolderName(file.path, true, folderPolicy(configuration.values));
      for (const call of [{ id: record.id, name: "write_file", arguments: { path: file.path } }, { id: record.id, name: "git_checkpoint", arguments: { path: file.path } },
      { id: record.id, name: "run_command", arguments: { command: "git checkpoint " + document.branch } }]) {
        if (authorizeTool(this.host.snapshot().settings.values, call, document.source.root).decision === "deny") throw new MoguriError("tool_denied", "Current hard policy denies this exact peer Git checkpoint.", 403);
      }
    }
    parse(WinddownCommitDocumentSchema, document);
    const text = JSON.stringify(document);
    if (Buffer.byteLength(text) > 128 * 1024) throw new MoguriError("winddown_commit_limit", "The complete accepted-source/Git review exceeds lossless 128 KiB. No operation was admitted.", 409);
    return { document, text, revision: record.revision, digest: digest(`moguri-budget-checkpoint-commit-v3\0${text}`),
      warning: "Git executes on the original pinned SSH peer/root, not the controller. Separate actual-user acceptance and this new-branch review only. Preserve HEAD/index; no checkout, push, merge or replay." };
  }
  private context(record: WinddownRecord, sessionId: string, exceptJobId?: string, nativeSource?: NonNullable<WinddownDocument["source"]>, readQuarantined = false) {
    const state = this.host.snapshot(), session = state.sessions.find((session) => session.id === sessionId), original = nativeSource ?? this.host.input(record).source;
    const native = record.version === 3 && record.env === "Sandbox" && Boolean(nativeSource);
    if (!original || !session || session.id !== record.sessionId || session.workspaceId !== original.workspaceId ||
      (session.repositories ? !session.repositories.some((entry) => entry.projectId === original.projectId) : session.projectId !== original.projectId) ||
      session.controls.env !== (native ? "Sandbox" : "Local") || session.mode !== "agent" || session.pendingMode === "read-only" || session.kind !== "agent" || session.status === "archived" ||
      session.turnId || !state.policy.allowedEnvs.includes("Local") || native && !state.policy.allowedEnvs.includes("Sandbox")) throw new MoguriError("winddown_commit_scope", "Select the exact original restored source after work ends. Native checkpoints also need separately accepted source and current Local Git policy; no checkout or Env fallback.", 409);
    const project = this.host.root(session, original.projectId);
    if (!project || project.path !== original.root || !sameDurableRoot(original, sourceRootSync(project.path))) throw new MoguriError("winddown_commit_root", "The originally captured source root/identity changed. No base-checkout or alias fallback.", 409);
    const configuration = this.host.projects().configuration(original.projectId);
    const policyDigest = digest(JSON.stringify({ profileId: state.profileId, sessionId, projectId: record.projectId, workspaceId: session.workspaceId, root: original,
      policy: state.policy, permissionRevision: state.settings.permissionRevision, permissions: state.settings.values.permissions, configuration,
      env: session.controls.env, repositories: session.repositories, mode: session.mode, pendingMode: session.pendingMode, kind: session.kind }));
    const current = () => {
      const fresh = this.host.snapshot(), actual = fresh.sessions.find((value) => value.id === sessionId);
      if (!actual || actual.turnId || actual.projectId !== session.projectId || actual.workspaceId !== original.workspaceId || actual.controls.env !== session.controls.env ||
        actual.mode !== "agent" || actual.pendingMode === "read-only" || actual.status === "archived" || !fresh.policy.allowedEnvs.includes("Local") ||
        digest(JSON.stringify({ profileId: fresh.profileId, sessionId, projectId: record.projectId, workspaceId: actual.workspaceId, root: original,
          policy: fresh.policy, permissionRevision: fresh.settings.permissionRevision, permissions: fresh.settings.values.permissions,
          configuration: this.host.projects().configuration(original.projectId), env: actual.controls.env, repositories: actual.repositories,
          mode: actual.mode, pendingMode: actual.pendingMode, kind: actual.kind })) !== policyDigest ||
        this.host.root(actual, original.projectId)?.path !== original.root || !sameDurableRoot(original, sourceRootSync(original.root))) throw new MoguriError("winddown_commit_stale", "Current source identity, mode or actual caller policy changed. No stale Git grant or root substitution.", 409);
      if (this.host.rootBusy(original.root, exceptJobId) || !readQuarantined && (original.workspaceId ? fresh.blockedWorkspaces.includes(original.workspaceId) : fresh.blockedProjects.includes(original.projectId)) ||
        fresh.terminals.some((terminal) => terminal.env === "Local" && (terminal.binding?.root === original.root || terminal.projectId === record.projectId && terminal.workspaceId === record.workspaceId) &&
          !["closed", "failed", "acknowledged"].includes(terminal.status))) throw new MoguriError("workspace_busy", "An actual writer, console or unconfirmed operation holds this exact checkpoint source. Inspect/settle it; no checkout fallback.", 409);
    };
    current(); return { session, project, configuration, policyDigest, current };
  }
  private nativeAcceptance(record: WinddownRecord, ids: string[]) {
    if (record.version !== 3 || record.env !== "Sandbox" || record.transport?.env !== "Sandbox" || !ids.length) {
      throw new MoguriError("winddown_native_acceptance", "Choose exact completed actual-user native publications from this finishing execution. Metadata, staged proposals and older v2 reports cannot grant source acceptance.", 409);
    }
    const accepted = ids.map((id) => {
      const publication = this.host.snapshot().sandboxPublications?.find((entry) => entry.id === id);
      if (!publication || publication.status !== "completed" || publication.acceptance.actor !== "user" ||
        publication.sourceSessionId !== record.sessionId || publication.executionId !== record.transport!.executionId || !publication.operationDigest) {
        throw new MoguriError("winddown_native_acceptance", "Every native source needs its exact completed separate actual-user publication at this original execution. No cross-root, model or missing acceptance was adopted.", 409);
      }
      const document = parse(SandboxPublicationDocumentSchema, JSON.parse(this.store.blob(publication.documentDigest)));
      const result = parse(SandboxPublicationResultSchema, JSON.parse(this.store.blob(publication.operationDigest)));
      if (document.executionId !== publication.executionId || document.root !== publication.root ||
        document.projectId !== publication.projectId || document.workspaceId !== publication.workspaceId || result.publicationId !== publication.id ||
        result.root !== publication.root || JSON.stringify(result.files.map(({ path, digest }) => ({ path, digest }))) !==
          JSON.stringify(document.patch.edits.map((edit) => ({ path: edit.path, digest: digest(edit.text) })))) {
        throw new MoguriError("winddown_native_acceptance", "The actual accepted/copy receipts and exact native source bytes disagree. No acceptance or Git success was inferred.", 409);
      }
      return { publication: parse(SandboxPublicationSchema, publication), document };
    });
    const first = accepted[0]!.document;
    if (accepted.some(({ document }) => document.projectId !== first.projectId || document.workspaceId !== first.workspaceId ||
      document.root !== first.root || document.device !== first.device || document.inode !== first.inode)) {
      throw new MoguriError("winddown_native_root", "One checkpoint requires one exact separately accepted repository. A group cannot adopt its first member or combine unrelated Git roots.", 409);
    }
    const source = { projectId: first.projectId, workspaceId: first.workspaceId, root: first.root, device: first.device, inode: first.inode };
    return { accepted, source, edits: accepted.flatMap(({ document }) => document.patch.edits) };
  }
  private source(document: WinddownCommitDocument): NonNullable<WinddownDocument["source"]> | undefined {
    if (document.version !== 2) return;
    const { projectId, workspaceId, root, device, inode } = document.source;
    return { projectId, workspaceId, root, device, inode };
  }
  writeRoot(id: string): string {
    const document = this.currentDocument(this.host.record(id));
    if (document.version === 3 && document.transport.env === "Remote") return remoteRootLease(document.transport, document.source.root)!;
    return document.source.root;
  }
  async preview(value: Input, signal = AbortSignal.timeout(15000)) {
    const input = structuredClone(value), record = this.host.record(input.winddownId);
    await this.host.settleReaders?.(record.sessionId);
    if (input.remoteAccepted && record.env !== "Remote" || input.nativePublicationIds && record.env !== "Sandbox") {
      throw new MoguriError("winddown_commit_env", "Accepted-source flags must match the report's actual original boundary. No Remote/native/Local source or Git fallback was selected.", 409);
    }
    if (record.env === "Remote" && input.remoteAccepted) return this.remotePreview(record, input);
    if (record.env !== "Local" && !(record.version === 3 && record.env === "Sandbox" && input.nativePublicationIds?.length)) throw new MoguriError("winddown_commit_env", "This report needs its exact selected-transport accepted-work review. Local accepted-work/Git cannot adopt Remote/native metadata or a controller mapping.", 409);
    if (record.status !== "ready" || record.commit !== null) throw new MoguriError("winddown_commit_state", "Only one exact complete known finishing report may request a fresh actual-user accepted-work review. Terminal/partial work cannot replay.", 409);
    const native = input.nativePublicationIds ? this.nativeAcceptance(record, input.nativePublicationIds) : undefined;
    if (native ? input.candidateIds.length : !input.candidateIds.length) throw new MoguriError("winddown_acceptance", "Choose only exact independently accepted source records for this original boundary.", 409);
    const context = this.context(record, input.sessionId, undefined, native?.source);
    await this.host.assertRoot(context.session, signal);
    const git = await readGitBinding(context.project.path, signal), source = { env: "Local" as const, projectId: context.project.id, workspaceId: context.session.workspaceId, ...sourceRootSync(context.project.path), ...git };
    const candidates = input.candidateIds.map((id) => {
      const candidate = this.host.snapshot().candidates.find((candidate) => candidate.id === id);
      if (!candidate || !isLocalCandidateRecord(candidate) || candidate.status !== "applied" || candidate.acceptance?.actor !== "user" || candidate.source.projectId !== source.projectId ||
        candidate.source.workspaceId !== source.workspaceId || candidate.source.root !== source.root || !sameDurableIdentity(candidate.source, source) ||
        candidate.source.gitCommonDir !== source.gitCommonDir) throw new MoguriError("winddown_acceptance", "Every selected candidate needs retained actual-user source acceptance at this exact Local root/repository. Staging, tests and model/critic advice cannot supply it.", 409);
      return structuredClone(candidate);
    });
    const edits = native?.edits ?? candidates.flatMap((candidate) => candidateDocument(this.store.blob(candidate.documentDigest), candidate).patch.edits);
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
    const origin = native && record.version === 3 ? { version: 2 as const, modelEnv: "Sandbox" as const, publicationEnv: "Local" as const,
      transport: record.transport!, nativePublications: native.accepted } : { version: 1 as const };
    const document: WinddownCommitDocument = { format: "moguri-budget-checkpoint-commit", ...origin, winddownId: record.id, sessionId: input.sessionId,
      source, policyDigest: context.policyDigest, sourceStateDigest: digest(await candidateGitState(source.root, signal)), branch: target.branch, base: target.base, message: input.message, candidates,
      files: captured.files.map((file) => ({ path: file.path, text: file.text, digest: file.digest, mode: file.mode & 0o111 ? "100755" : "100644" })) };
    parse(WinddownCommitDocumentSchema, document);
    const text = JSON.stringify(document);
    if (!text.isWellFormed() || Buffer.byteLength(text) > 128 * 1024) throw new MoguriError("winddown_commit_limit", "The complete accepted-work/Git review exceeds lossless 128 KiB. Select fewer exact candidates; nothing was truncated.", 409);
    await assertNativeSource(captured, signal); context.current();
    if (this.host.record(record.id).revision !== record.revision) throw new MoguriError("winddown_commit_stale", "The original independent finishing report changed during review.", 409);
    return { document, text, digest: digest(`moguri-budget-checkpoint-commit-v${document.version}\0${text}`), revision: record.revision,
      warning: `${native ? "Explicit boundary: native-model work, separately accepted native source, then Local Git on its original repository. " : ""}Actual-user accepted bytes and separate Git permission only. No new project tests or model quality. A new local branch preserves source index/HEAD; no checkout, push, merge or deletion.` };
  }
  private currentDocument(record: WinddownRecord): WinddownCommitDocument {
    if (!record.commitDocumentDigest || !record.commit) throw new MoguriError("winddown_commit_intent", "No exact independent actual-user Git intent exists.", 409);
    const document = parse(WinddownCommitDocumentSchema, JSON.parse(this.store.blob(record.commitDocumentDigest)));
    if (document.winddownId !== record.id || document.sessionId !== record.sessionId || document.branch !== record.commit.branch || document.base !== record.commit.base ||
      digest(`moguri-budget-checkpoint-commit-v${document.version}\0${JSON.stringify(document)}`) !== record.commit.reviewDigest) throw new MoguriError("winddown_commit_corrupt", "Original accepted-work/Git review document no longer matches its exact user intent.", 409);
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
        const context = document.version === 3 ? this.remoteContext(record, commit.jobId) : this.context(record, record.sessionId, commit.jobId, this.source(document));
        context.current();
        const sameSource = document.version === 3 && result.version === 3 ? JSON.stringify(document.source) === JSON.stringify(result.source) &&
          JSON.stringify(document.transport) === JSON.stringify(result.transport) : document.version !== 3 && result.version !== 3 &&
          sameCandidateRoot(result.source, document.source);
        if (record.status !== "committing" || commit.cancelRequested || commit.publishedCommit !== result.commit || result.winddownId !== id ||
          result.branch !== document.branch || result.base !== document.base || result.version !== document.version || !sameSource ||
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
    if (document.version === 3) {
      const context = this.remoteContext(record, jobId);
      const source = await this.remoteSource(record, document.files.map((file) => file.path), document.branch, jobId, signal);
      if (JSON.stringify(source.document) !== JSON.stringify(document.acceptedSource) || record.version !== 3 ||
        JSON.stringify(record.remoteAcceptance) !== JSON.stringify(document.sourceAcceptance)) throw new MoguriError("winddown_remote_stale", "The separately accepted peer source or current Git policy changed before publication. No replay or different bytes.", 409);
      context.current(); signal.throwIfAborted();
      progress("Preparing only the original peer checkpoint key; no Git request has been sent.");
      const result = await this.host.remote.checkpoint(context.execution, jobId, document, context.configuration.values, signal, () => {
        signal.throwIfAborted(); context.current(); this.update(id, { publicationAttempted: true });
        progress("Publishing only separately accepted bytes on the original SSH peer with its temporary Git index.");
      });
      signal.throwIfAborted(); context.current();
      if (JSON.stringify(result.source) !== JSON.stringify(document.source) || result.branch !== document.branch || result.base !== document.base ||
        result.sourceStateDigest !== document.sourceStateDigest || result.winddownId !== id || JSON.stringify(result.files) !== JSON.stringify(document.files.map(({ path, digest }) => ({ path, digest })))) {
        throw new MoguriError("winddown_remote_result", "Actual peer ref/blob readback changed original reviewed source or base. No successful branch was inferred.", 409);
      }
      this.update(id, { preparedCommit: result.commit, publishedCommit: result.commit });
      const after = await this.remoteSource(record, document.files.map((file) => file.path), undefined, jobId, signal);
      if (JSON.stringify(after.document) !== JSON.stringify(document.acceptedSource)) throw new MoguriError("winddown_remote_partial", "Original peer source or HEAD/index changed after publication. Actual ref may exist; no rollback or success was inferred.", 409);
      return result;
    }
    const context = this.context(record, record.sessionId, jobId, this.source(document)), policy = folderPolicy(context.configuration.values);
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
      if (document.version === 2 && JSON.stringify(this.nativeAcceptance(record, document.nativePublications.map((entry) => entry.publication.id)).accepted) !== JSON.stringify(document.nativePublications)) {
        throw new MoguriError("winddown_acceptance_changed", "Original native-source acceptance or actual copied-byte receipt changed. No missing grant or model output was substituted.", 409);
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
    return { ...(document.version === 2 ? { version: 2 as const, modelEnv: document.modelEnv, publicationEnv: document.publicationEnv, transport: document.transport } : { version: 1 as const }),
      winddownId: id, source: document.source, branch: result.branch, base: result.base, commit: result.commit, verified: true,
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
    this.host.job(preview.document.source.projectId, record.sessionId, preview.document.source.workspaceId, (signal, progress, jobId) => this.publish(record.id, signal, progress, jobId),
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
  async inspect(id: string) {
    const record = this.host.record(id), document = this.currentDocument(record), commit = record.commit;
    await this.host.settleReaders?.(record.sessionId);
    if (record.version !== 3 || document.version === 1 || !commit?.publicationAttempted ||
      record.status === "committing" || this.host.snapshot().jobs.some((job) => job.id === commit.jobId && ["running", "waiting_input"].includes(job.status))) {
      throw new MoguriError("winddown_inspection", "Wait for the exact original transport Git job to settle before inspecting its retained effects. Legacy metadata cannot gain checkpoint authority.", 409);
    }
    const signal = AbortSignal.timeout(15000);
    let prepared = commit.preparedCommit, published = commit.publishedCommit, result: WinddownCommitResult | null = null;
    let receipt: string | null = null, actualCommit: string | null, status: string = record.status, diagnostic = record.diagnostic;
    if (document.version === 3) {
      const context = this.remoteContext(record, commit.jobId, true);
      const inspected = await this.host.remote.inspectCheckpoint(context.execution, commit.jobId, document, context.configuration.values, signal);
      context.current();
      const phases = inspected.frames.map((frame) => frame.request).filter((request) => request.kind === "checkpoint.phase");
      prepared = phases.find((request) => request.phase === "prepared")?.commit ?? null;
      published = phases.find((request) => request.phase === "published")?.commit ?? null;
      result = phases.find((request) => request.phase === "result")?.result ?? null;
      if (commit.preparedCommit && commit.preparedCommit !== prepared || commit.publishedCommit && commit.publishedCommit !== published) {
        throw new MoguriError("winddown_inspection", "Peer receipts disagree with the original retained host observations. No publication or cleanup was adopted.", 409);
      }
      receipt = JSON.stringify(inspected); actualCommit = inspected.actualCommit; status = inspected.status.status; diagnostic = inspected.status.diagnostic;
    } else {
      const context = this.context(record, record.sessionId, commit.jobId, this.source(document), true);
      const captured = await captureNativeSource(document.source.root, document.files.map((file) => file.path), folderPolicy(context.configuration.values), signal);
      const check = async () => {
        context.current(); await this.host.assertRoot(context.session, signal); await assertNativeSource(captured, signal);
        if (!sameDurableRoot(document.source, sourceRootSync(document.source.root)) ||
          JSON.stringify({ ...document.source, ...await readGitBinding(document.source.root, signal) }) !== JSON.stringify(document.source) ||
          digest(await candidateGitState(document.source.root, signal)) !== document.sourceStateDigest ||
          JSON.stringify(captured.files.map((file) => ({ path: file.path, text: file.text, digest: file.digest, mode: file.mode & 0o111 ? "100755" : "100644" }))) !== JSON.stringify(document.files)) {
          throw new MoguriError("winddown_inspection_stale", "Exact original Local source, root, HEAD/index or modes changed. No historical receipt became current cleanup or success.", 409);
        }
      };
      await check();
      actualCommit = await this.host.projects().inspectReviewedCommit(context.project, document.files, { branch: document.branch, base: document.base, commit: prepared }, signal);
      if (published && actualCommit !== published) throw new MoguriError("winddown_inspection_stale", "The original native/Local checkpoint ref changed. No result or cleanup was adopted.", 409);
      if (commit.resultDigest) result = parse(WinddownCommitResultSchema, JSON.parse(this.store.blob(commit.resultDigest)));
      await check();
    }
    const inspection: WinddownCommitInspection = { format: "moguri-checkpoint-inspection", version: 1, winddownId: id, jobId: commit.jobId,
      commitDocumentDigest: record.commitDocumentDigest!, reviewDigest: commit.reviewDigest, publicationEnv: document.publicationEnv,
      root: document.source.root, sourceStateDigest: document.sourceStateDigest, operationSettled: true,
      preparedCommit: prepared, publishedCommit: published, actualCommit, result, receipt };
    parse(WinddownCommitInspectionSchema, inspection);
    const text = JSON.stringify(inspection);
    if (Buffer.byteLength(text) > 512 * 1024) throw new MoguriError("winddown_inspection_limit", "Complete original checkpoint inspection exceeds 512 KiB. No receipt prefix or cleanup was acknowledged.", 409);
    return { status, diagnostic, preparedCommit: prepared, publishedCommit: published, result, review: { document: inspection,
      revision: record.revision, digest: digest(`moguri-checkpoint-inspection-v1\0${text}`),
      warning: "Read-only original effect/ref/source inspection. Separate actual-user confirmation can settle only this writer quarantine. Original partial job, cancellation, model charges and task outcome remain unchanged; no Git/model replay or PID cleanup claim." } };
  }
  async reconcile(command: Extract<WinddownCommand, { type: "winddown.commit.reconcile" }>, finish: WorkspaceFinish) {
    const record = this.host.record(command.winddownId), intent = finish.intent;
    if (!intent || record.version !== 3 || record.status !== "partial" || !record.commit?.publicationAttempted) throw new MoguriError("winddown_inspection", "Only the actual user may settle the exact original partial transport checkpoint after fresh source/ref inspection.", 409);
    if (record.commit.inspection) {
      if (record.commit.inspection.commandId !== intent.id || record.commit.inspection.commandDigest !== intent.digest) throw new MoguriError("winddown_inspection", "Original actual-user inspection is immutable. No second acknowledgement or effect was adopted.", 409);
      return finish([], { id: record.id, revision: record.revision });
    }
    const inspected = await this.inspect(record.id), fresh = this.host.record(record.id);
    if (inspected.review.revision !== command.expectedRevision || inspected.review.digest !== command.expectedDigest || fresh.revision !== record.revision) {
      throw new MoguriError("winddown_inspection_stale", "Original effect receipts, source/ref, policy or user review changed. The writer remains quarantined; no partial job became successful.", 409);
    }
    const next = projectWinddown(fresh, { ...fresh, revision: fresh.revision + 1, updatedAt: new Date().toISOString(),
      commit: { ...fresh.commit!, inspection: { actor: "user", commandId: intent.id, commandDigest: intent.digest, reviewDigest: inspected.review.digest,
        inputDigest: this.store.putBlob(JSON.stringify(inspected.review.document)), at: new Date().toISOString() } } });
    return finish([this.host.event(next)], { id: next.id, revision: next.revision });
  }
}
