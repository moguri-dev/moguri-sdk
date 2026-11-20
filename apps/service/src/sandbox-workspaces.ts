import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { Type, type Static } from "typebox";
import {
  CheckpointCaptureSchema, RewindRecordSchema, MoguriError, NativeStageBindingSchema, parse, SessionRepositorySchema, sandboxRepositories,
  type CheckpointBoundary, type CheckpointCapture, type CheckpointRestoreResult, type CheckpointWorkspace, type RewindFileDecision, type RewindRecord, type TurnCheckpoint,
  type EventInput, type Project, type ProjectSettings, type SandboxCommand, type SandboxWorkspace,
  type ModelFailure, type SandboxExecution, type SandboxRepository, type SandboxWorkspacePreview, type Session, type Snapshot,
} from "../../../packages/protocol/src/index.ts";
import { captureNativeSource, captureNativeTree, materializeNativeStage, inspectNativeStage, assertNativeWorkspaceIdentity,
  NATIVE_TREE_MAX_FILES, NATIVE_TREE_MAX_BYTES, NATIVE_TREE_FILE_BYTES, type NativeSource } from "./native-staging.ts";
import { materializeNativeGroup, nativeCompositeDigest, nativeRepositoryDirectory } from "./native-staging.ts";
import { captureNativePrivateTree, materializeNativePrivateStage, inspectNativeStageContainer, nativePrivateVersion,
  type NativePrivateSource, type NativeStage } from "./native-staging.ts";
import { optionalGitBinding } from "./project-git.ts";
import { folderPolicy, matchesFolder, type FolderPolicy } from "./project-policy.ts";
import { digest, type EventStore } from "./store.ts";
import { frameDigest } from "./worker-wire.ts";
import type { SandboxRuntime } from "./sandbox-runtime.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import { readNativeCompletion } from "./native-evidence.ts";
import { isProtectedProjectPath, scopedPath } from "./files.ts";
import { ignoredPath } from "./ignore-rules.ts";
import { repositoryIgnored } from "./repository-source.ts";
import { sandboxResult } from "./sandbox-results.ts";
import { assertSandboxNetwork } from "./sandbox-network.ts";
import { checkpointReviewDigest } from "./checkpoint-files.ts";
import { retainedModelRequest, type RetainedModelRequest } from "./model-recovery.ts";
import { durableIdentity, sameDurableIdentity, sameDurableRoot, sourceRootSync } from "./repository-source.ts";
import {
  assertNativeCheckpoint, mergeNativeRollback, nativeCheckpointOverlay, nativeCheckpointTreeDigest,
  nativeCheckpointRetrySource, nativeCheckpointWorkspace, nativeSignedPrivateSource, type NativeCheckpointRoot,
} from "./sandbox-checkpoints.ts";

const hash = Type.String({ pattern: "^[a-f0-9]{64}$" }), path = Type.String({ minLength: 1, maxLength: 4096 });
const identity = Type.Object({ device: Type.String(), inode: Type.String() }, { additionalProperties: false });
const SourceSchema = Type.Object({
  root: path, identity, files: Type.Array(Type.Object({
    path, text: Type.String({ maxLength: 128 * 1024 }), digest: hash, bytes: Type.Integer({ minimum: 0, maximum: 128 * 1024 }),
    mode: Type.Integer({ minimum: 0, maximum: 0o777 }),
  }, { additionalProperties: false }), { maxItems: 200 }), digest: hash,
  policy: Type.Object({ denied: Type.Array(path), readOnly: Type.Array(path) }, { additionalProperties: false }),
}, { additionalProperties: false });
const ReviewedInputSchema = Type.Object({
  format: Type.Literal("moguri-native-workspace"), version: Type.Literal(1), sessionId: Type.String(),
  source: Type.Union([SourceSchema, Type.Null()]), authorityDigest: hash, sourceHead: Type.Union([Type.String(), Type.Null()]),
}, { additionalProperties: false });
const TreeSourceSchema = Type.Object({
  root: path, identity, capture: Type.Literal("tree-v1"),
  files: Type.Array(Type.Object({ path, text: Type.Null(), digest: hash,
    bytes: Type.Integer({ minimum: 0, maximum: NATIVE_TREE_FILE_BYTES }), mode: Type.Integer({ minimum: 0, maximum: 0o777 }),
  }, { additionalProperties: false }), { maxItems: NATIVE_TREE_MAX_FILES }),
  digest: hash, policy: SourceSchema.properties.policy,
}, { additionalProperties: false });
const AutomaticInputSchema = Type.Object({
  format: Type.Literal("moguri-native-workspace"), version: Type.Literal(2), sessionId: Type.String(),
  source: Type.Union([SourceSchema, TreeSourceSchema, Type.Null()]), workingSource: TreeSourceSchema,
  authorityDigest: hash, sourceHead: Type.Union([Type.String(), Type.Null()]),
  previousExecutionId: Type.Union([Type.String(), Type.Null()]),
  stageBinding: Type.Optional(NativeStageBindingSchema),
}, { additionalProperties: false });
const GroupInputSchema = Type.Object({
  format: Type.Literal("moguri-native-workspace"), version: Type.Literal(3), sessionId: Type.String(),
  source: Type.Null(), sourceHead: Type.Null(), authorityDigest: hash, previousExecutionId: Type.Union([Type.String(), Type.Null()]),
  stageBinding: Type.Optional(NativeStageBindingSchema),
  repositories: Type.Array(Type.Object({ binding: SessionRepositorySchema, directory: path, source: TreeSourceSchema,
    workingSource: TreeSourceSchema, sourceHead: Type.Union([Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }), Type.Null()]) },
  { additionalProperties: false }), { minItems: 1, maxItems: 1000 }),
}, { additionalProperties: false });
const InputSchema = Type.Union([ReviewedInputSchema, AutomaticInputSchema, GroupInputSchema]);
type StaticGroupRepository = Static<typeof GroupInputSchema>["repositories"][number];
type PreparationOwner = Extract<NonNullable<SandboxWorkspace["preparation"]>, { version: 1 | 2 | 4 }>;
interface Host {
  snapshot(): Pick<Snapshot, "profileId" | "sessions" | "settings" | "policy" | "sandboxWorkspaces" | "sandboxExecutions"> &
    Partial<Pick<Snapshot, "checkpoints" | "modelFailures">>; project(session: Session, repository?: string): Project;
  settings(projectId: string | null): { revision: number; values: ProjectSettings };
  commit(events: EventInput[]): void; closing(session: Session): boolean;
  capture?(id: string): CheckpointCapture | undefined; rewind?(id: string): RewindRecord | undefined;
  checkpoint?(id: string): TurnCheckpoint | undefined;
  nativeStateRoot?: string;
}
export function nativeWorkspaceDocument(text: string) {
  const document = parse(InputSchema, JSON.parse(text));
  if (document.version === 3) {
    for (const repository of document.repositories) if (repository.source.root !== repository.binding.root.root ||
      repository.source.identity.device !== repository.binding.root.device || repository.source.identity.inode !== repository.binding.root.inode) {
      throw new MoguriError("sandbox_repository_history", "Composite input lost an original captured source identity. No member was substituted.", 409);
    }
    nativeCompositeDigest(document.repositories.map((repository) => ({ projectId: repository.binding.projectId, directory: repository.directory, source: repository.source })));
    nativeCompositeDigest(document.repositories.map((repository) => ({ projectId: repository.binding.projectId, directory: repository.directory, source: repository.workingSource })));
  }
  return document;
}
export function nativeWorkspaceRepositories(input: ReturnType<typeof nativeWorkspaceDocument>): SandboxRepository[] | undefined {
  return input.version === 3 ? input.repositories.map((repository) => ({ ...repository.binding, directory: repository.directory,
    guestRoot: `/workspace/${repository.directory}`, sourceHead: repository.sourceHead })) : undefined;
}
export function assertNativeGroupRestorePaths(repositories: readonly SandboxRepository[], paths: readonly string[]): void {
  if (paths.some((path) => !isProtectedProjectPath(path) && !repositories.some((repository) => path.startsWith(`${repository.directory}/`)))) {
    throw new MoguriError("sandbox_repository_history", "Original native work has files outside its captured repository directories. Inspect the retained signed snapshot before explicitly starting a new session; no replacement guest or partial restoration was admitted.", 409);
  }
}
export class SandboxWorkspaces {
  private active = new Map<string, { abort: AbortController; task: Promise<unknown>; rewindId?: string }>();
  constructor(private readonly store: EventStore, private readonly stateDir: string, private readonly native: Pick<SandboxRuntime, "assertReady">, private readonly host: Host) {}
  get busy(): boolean { return this.active.size > 0; }
  owns(sessionId: string): boolean { return this.active.has(sessionId); }
  ownsRewind(sessionId: string, operationId: string): boolean { return this.active.get(sessionId)?.rewindId === operationId; }
  automatic(): boolean {
    const management = this.host.snapshot().settings.values.sandboxManagement;
    return Boolean(management?.enabled && management.automaticWorkspaces);
  }
  private session(id: string): Session {
    const session = this.host.snapshot().sessions.find((value) => value.id === id);
    if (!session || session.status === "archived") throw new MoguriError("sandbox_session", "Select an existing unarchived session in this exact profile.", 409);
    return session;
  }
  private authority(session: Session): string {
    const snapshot = this.host.snapshot(), settings = this.host.settings(session.projectId);
    if (session.controls.env !== "Sandbox" || !snapshot.policy.allowedEnvs.includes("Sandbox") || this.host.closing(session)) throw new MoguriError("sandbox_scope", "Explicitly select an allowed Sandbox environment and an existing owned source scope. No Local or previous-root fallback.", 409);
    if (session.repositories) {
      const repositories = session.repositories.map((binding) => ({ binding, root: this.host.project(session, binding.projectId).path,
        settings: this.host.settings(binding.projectId).values }));
      return frameDigest({ profileId: snapshot.profileId, sessionId: session.id, repositories, policyRevision: snapshot.policy.revision,
        permissionRevision: snapshot.settings.permissionRevision, native: this.native.assertReady() });
    }
    const project = session.projectId ? this.host.project(session) : null;
    return frameDigest({ profileId: snapshot.profileId, sessionId: session.id, projectId: session.projectId, workspaceId: session.workspaceId,
      root: project?.path ?? null, policyRevision: snapshot.policy.revision,
      permissionRevision: snapshot.settings.permissionRevision, projectRevision: settings.revision, folders: folderPolicy(settings.values),
      native: this.native.assertReady() });
  }
  checkpointIdentity(session: Session, legacy = false): unknown {
    if (session.controls.env !== "Sandbox") throw new MoguriError("sandbox_checkpoint_scope", "A private checkpoint cannot adopt another Env or the controller checkout.", 409);
    const roots = session.repositories ? session.repositories.map((binding) => {
      const actual = sourceRootSync(this.host.project(session, binding.projectId).path);
      if (!sameDurableRoot(binding.root, actual)) throw new MoguriError("sandbox_checkpoint_source", "An original group source root was replaced. No alternate root was adopted.", 409);
      return { projectId: binding.projectId, root: legacy ? actual : durableIdentity(actual) };
    }) : session.projectId ? [{ projectId: session.projectId, root: legacy ? sourceRootSync(this.host.project(session).path) : durableIdentity(sourceRootSync(this.host.project(session).path)) }] : [];
    return { format: "moguri-native-checkpoint-identity", version: 1, profileId: this.host.snapshot().profileId,
      sessionId: session.id, env: "Sandbox", projectId: session.projectId, sourceWorkspaceId: session.workspaceId,
      roots, privateScope: session.projectId || session.repositories ? "captured-source-roots" : "project-free-private",
      native: this.native.assertReady() };
  }
  private checkpointCapture(capture: CheckpointCapture, signal: AbortSignal, check: () => void, status: "capturing" | "captured" = "capturing"): Session {
    check(); signal.throwIfAborted(); parse(CheckpointCaptureSchema, capture);
    const canonical = this.host.capture?.(capture.id), session = this.session(capture.sessionId);
    if (!canonical || JSON.stringify(canonical) !== JSON.stringify(capture) || capture.status !== status ||
      capture.profileId !== this.host.snapshot().profileId || session.controls.env !== "Sandbox" || this.host.closing(session) ||
      capture.phase === "before" && (!capture.turnId || session.turnId !== null || !["queue", "control", "retry"].includes(capture.source.kind)) ||
      capture.phase === "after" && (!capture.turnId || session.turnId !== null && session.turnId !== capture.turnId || capture.source.kind !== "terminal") ||
      capture.phase === "current" && (session.turnId !== null || capture.source.kind !== "review")) {
      throw new MoguriError("sandbox_checkpoint_owner", "The exact retained capture, phase, profile/session or original turn owner changed. No source was reconstructed or relabelled.", 409);
    }
    if (capture.phase === "before" && capture.source.kind === "queue") {
      const item = session.queue.find((item) => item.id === capture.source.id);
      if (!item || item.held || frameDigest(item) !== capture.source.digest) {
        throw new MoguriError("sandbox_checkpoint_queue", "The complete original unheld queue item changed. No held/replacement prompt was admitted.", 409);
      }
    }
    return session;
  }
  private checkpointSource(input: ReturnType<typeof nativeWorkspaceDocument>): string {
    return frameDigest(input.version === 3 ? { sessionId: input.sessionId,
      repositories: input.repositories.map(({ binding, directory, source, sourceHead }) => ({ binding, directory, source, sourceHead })) } :
      { sessionId: input.sessionId, source: input.source, sourceHead: input.sourceHead });
  }
  private checkpointRoots(session: Session, input?: ReturnType<typeof nativeWorkspaceDocument>): NativeCheckpointRoot[] {
    if (input?.version === 3 || session.repositories) {
      const members = input?.version === 3 ? input.repositories.map((repository) => ({
        projectId: repository.binding.projectId, directory: repository.directory, policy: repository.workingSource.policy,
      })) : session.repositories!.map((binding) => ({ projectId: binding.projectId, directory: nativeRepositoryDirectory(binding.projectId),
        policy: folderPolicy(this.host.settings(binding.projectId).values) }));
      return members.map((member) => ({ key: member.projectId, repositoryId: member.projectId, directory: member.directory, policy: member.policy }));
    }
    return [{ key: session.projectId ?? "sandbox-private", repositoryId: session.projectId, directory: "",
      policy: input ? input.version === 2 ? input.workingSource.policy : input.source?.policy ?? { denied: [], readOnly: [] } :
        folderPolicy(this.host.settings(session.projectId).values) }];
  }
  private checkpointRecord(session: Session): SandboxWorkspace & { stage: NativeStage } {
    const workspace = this.host.snapshot().sandboxWorkspaces?.find((workspace) => workspace.id === session.sandboxWorkspaceId);
    if (!workspace?.stage || workspace.sessionId !== session.id || workspace.projectId !== session.projectId ||
      workspace.stage.profileId !== this.host.snapshot().profileId || workspace.stage.sessionId !== session.id ||
      workspace.sourceWorkspaceId !== session.workspaceId || !["ready", "partial"].includes(workspace.status) ||
      (session.repositories ? !this.sameGroup(session, workspace.repositories) : workspace.repositories !== undefined)) {
      throw new MoguriError("sandbox_checkpoint_workspace", "The original private stage/input/root set is unavailable. No Local source or empty replacement was selected.", 409);
    }
    return { ...workspace, stage: workspace.stage };
  }
  private assertCheckpointSource(session: Session, workspace: SandboxWorkspace): void {
    const input = this.document(workspace);
    if (input.sessionId !== session.id || workspace.configDigest !== frameDigest(this.native.assertReady()) ||
      workspace.authorityDigest !== this.authority(session)) {
      throw new MoguriError("sandbox_checkpoint_stale", "The original private source, current policy or exact native build changed. No stale stage was rebound.", 409);
    }
    this.checkpointIdentity(session);
    if (input.version === 3) {
      if (!this.sameGroup(session, nativeWorkspaceRepositories(input))) throw new MoguriError("sandbox_checkpoint_source", "The original private group input changed.", 409);
    } else {
      const root = session.projectId ? sourceRootSync(this.host.project(session).path) : null;
      if (input.source ? !root || input.source.root !== root.root || !sameDurableIdentity(input.source.identity, root) : root !== null) {
        throw new MoguriError("sandbox_checkpoint_source", "The private input lost its original canonical source directory. No checkout was substituted.", 409);
      }
    }
  }
  private assertCheckpointSettled(session: Session): void {
    if (this.host.snapshot().sandboxExecutions?.some((execution) => execution.sessionId === session.id && execution.cleanup !== "owned-guest-stopped")) {
      throw new MoguriError("sandbox_checkpoint_cleanup", "An actual original guest still has live/unconfirmed cleanup. An acknowledgement cannot authorize capture, replacement or restore.", 409);
    }
  }
  private async checkpointCompletion(execution: SandboxExecution, sessionId: string, signal: AbortSignal, check: () => void) {
    const retained = this.host.snapshot().sandboxExecutions?.find((entry) => entry.id === execution.id);
    const workspace = this.host.snapshot().sandboxWorkspaces?.find((entry) => entry.id === execution.workspaceId);
    if (!retained || JSON.stringify(retained) !== JSON.stringify(execution) || execution.profileId !== this.host.snapshot().profileId ||
      execution.sessionId !== sessionId || !workspace?.stage || workspace.sessionId !== sessionId ||
      execution.stage.profileId !== execution.profileId || execution.stage.sessionId !== sessionId ||
      workspace.projectId !== execution.projectId || workspace.sourceWorkspaceId !== execution.sourceWorkspaceId ||
      workspace.sourceRoot !== execution.sourceRoot || workspace.configDigest !== (execution.networkScope?.reviewedConfigDigest ?? execution.configDigest) || execution.image !== execution.config.image ||
      JSON.stringify(workspace.repositories) !== JSON.stringify(execution.repositories) ||
      workspace.inputDigest !== execution.inputDigest || JSON.stringify(workspace.stage) !== JSON.stringify(execution.stage) ||
      execution.configDigest !== frameDigest(execution.config) || execution.workerDigest !== execution.config.qualification?.workerDigest ||
      execution.cleanup !== "owned-guest-stopped" || !["completed", "stopped", "failed", "partial"].includes(execution.status) ||
      !execution.resultDigest || !execution.nativeSessionId || !execution.planDigest || !execution.signerFingerprint) {
      throw new MoguriError("sandbox_checkpoint_result", "The actual original native owner/build/input/result or verified guest absence is incomplete. No terminal snapshot was inferred.", 409);
    }
    assertSandboxNetwork(execution, this.native.assertReady());
    if (execution.stage.parent !== await realpath(join(this.stateDir, "native-stage-root"))) {
      throw new MoguriError("sandbox_checkpoint_result", "The original native result belongs to a different actual private staging parent. No source checkout was adopted.", 409);
    }
    const result = sandboxResult(this.store.blob(execution.resultDigest));
    if (result.executionId !== execution.id || result.workspaceId !== execution.workspaceId || result.inputDigest !== execution.inputDigest ||
      result.nativeSessionId !== execution.nativeSessionId || result.planDigest !== execution.planDigest ||
      result.signerFingerprint !== execution.signerFingerprint || result.journal.status !== "verified" ||
      JSON.stringify(result.version === 2 ? result.repositories : undefined) !== JSON.stringify(execution.repositories)) {
      throw new MoguriError("sandbox_checkpoint_result", "The retained native result lost its exact verified journal or signed ownership. No historical state was fabricated.", 409);
    }
    const request = { stateRoot: this.host.nativeStateRoot ?? join(homedir(), ".sendbox", "run"), sessionId: execution.nativeSessionId,
      workspace: execution.stage.workspace, image: execution.image, command: { program: execution.command[0]!, arguments: execution.command.slice(1) },
      createdAfter: execution.createdAfter, createdBefore: execution.createdBefore, planDigest: execution.planDigest, signerFingerprint: execution.signerFingerprint };
    const verify = async () => {
      check(); signal.throwIfAborted();
      const current = this.host.snapshot().sandboxExecutions?.find((entry) => entry.id === execution.id);
      if (JSON.stringify(current) !== JSON.stringify(execution)) throw new MoguriError("sandbox_checkpoint_result", "Original native result ownership changed during capture.", 409);
      const evidence = await readNativeCompletion(request);
      if (evidence.beforeId !== result.beforeId || evidence.afterId !== result.afterId || evidence.auditDigest !== result.auditDigest ||
        evidence.rollback !== result.rollback || evidence.exitCode !== result.exitCode || evidence.afterBinding !== result.afterBinding) {
        throw new MoguriError("sandbox_checkpoint_result", "Exact signed native after-state differs from its retained result. No host rollback tree or newer source was substituted.", 409);
      }
      check(); signal.throwIfAborted(); return evidence;
    };
    return { evidence: await verify(), result, verify: async () => { await verify(); } };
  }
  private async checkpointView(session: Session, signal: AbortSignal, check: () => void) {
    this.assertCheckpointSettled(session);
    const workspace = this.checkpointRecord(session); this.assertCheckpointSource(session, workspace);
    if (workspace.stage.parent !== await realpath(join(this.stateDir, "native-stage-root"))) {
      throw new MoguriError("sandbox_checkpoint_workspace", "The selected root is not this original owned private staging parent. No Local checkout was labelled as Sandbox.", 409);
    }
    const input = this.document(workspace), execution = this.host.snapshot().sandboxExecutions?.filter((entry) => entry.workspaceId === workspace.id).at(-1);
    const identity = frameDigest(this.checkpointIdentity(session));
    const current = () => {
      check(); signal.throwIfAborted();
      const actual = this.session(session.id), bound = this.checkpointRecord(actual);
      if (bound.id !== workspace.id || bound.revision !== workspace.revision || bound.inputDigest !== workspace.inputDigest ||
        bound.authorityDigest !== this.authority(actual) || frameDigest(this.checkpointIdentity(actual)) !== identity) {
        throw new MoguriError("sandbox_checkpoint_stale", "The actual current private binding, source/build or policy changed.", 409);
      }
      this.assertCheckpointSettled(actual);
    };
    current();
    if (!execution) {
      if (workspace.status !== "ready") throw new MoguriError("sandbox_checkpoint_workspace", "A partial stage without its exact signed result is not current workspace state.", 409);
      return { workspace, input, view: await captureNativePrivateTree(workspace.stage, signal, current), execution: null,
        completion: null, current };
    }
    const completion = await this.checkpointCompletion(execution, session.id, signal, current);
    const live = await captureNativePrivateTree(workspace.stage, signal, current, completion.evidence.rollback === "confirmed");
    let view = live;
    if (completion.evidence.rollback === "confirmed") {
      const after = await nativeSignedPrivateSource(workspace.stage, completion.evidence, false, completion.verify, signal, current);
      const before = await nativeSignedPrivateSource(workspace.stage, completion.evidence, true, completion.verify, signal, current);
      view = mergeNativeRollback(after, before, live);
    }
    current(); return { workspace, input, view, execution, completion, current };
  }
  private checkpointBoundary(capture: Pick<CheckpointCapture, "identityDigest">, workspace: SandboxWorkspace, input: ReturnType<typeof nativeWorkspaceDocument>,
    execution: SandboxExecution | null, afterId?: string, view?: NativePrivateSource): CheckpointBoundary {
    if (!execution && workspace.preparation?.version === 4 && workspace.preparation.retryOrigin) {
      const origin = workspace.preparation.retryOrigin, source = this.host.snapshot().sandboxExecutions?.find((entry) => entry.id === origin.executionId);
      if (!source || source.resultDigest !== origin.resultDigest) throw new MoguriError("sandbox_checkpoint_retry", "Prepared retry lost its exact original signed execution/result.", 409);
      execution = source; afterId = origin.afterId;
    }
    return { version: 1, env: "Sandbox", profileId: this.host.snapshot().profileId, sessionId: workspace.sessionId,
      identityDigest: capture.identityDigest, transportDigest: workspace.configDigest, sourceDigest: this.checkpointSource(input),
      workspaceId: workspace.id, inputDigest: workspace.inputDigest,
      ...(execution ? { executionId: execution.id, workerDigest: execution.workerDigest, resultDigest: execution.resultDigest!,
        nativeSessionId: execution.nativeSessionId!, planDigest: execution.planDigest!, signerFingerprint: execution.signerFingerprint!, afterId: afterId! } : {}),
      ...(view ? { liveStageDigest: nativeCheckpointTreeDigest(view) } : {}) };
  }
  async captureCheckpoint(sessionId: string, capture: CheckpointCapture, requested: AbortSignal, check: () => void): Promise<CheckpointWorkspace> {
    if (capture.sessionId !== sessionId || this.active.has(sessionId)) throw new MoguriError("sandbox_checkpoint_busy", "This exact capture/session already owns private work or has a different owner.", 409);
    const abort = new AbortController(), signal = AbortSignal.any([requested, abort.signal]);
    const task = Promise.resolve().then(async () => {
      let session = this.checkpointCapture(capture, signal, check);
      const current = () => { session = this.checkpointCapture(capture, signal, check); };
      if (capture.phase === "after") {
        const execution = this.host.snapshot().sandboxExecutions?.filter((entry) => entry.sessionId === sessionId && entry.turnId === capture.turnId).at(-1);
        if (!execution || execution.workspaceId !== session.sandboxWorkspaceId) throw new MoguriError("sandbox_checkpoint_result", "The actual terminal owner has no execution in its selected private workspace. A previous retry/turn or today's files are not its result.", 409);
        const completed = await this.checkpointCompletion(execution, sessionId, signal, current);
        const workspace = this.host.snapshot().sandboxWorkspaces!.find((workspace) => workspace.id === execution.workspaceId)!;
        const input = this.document(execution), view = await nativeSignedPrivateSource(execution.stage, completed.evidence, false, completed.verify, signal, current);
        return nativeCheckpointWorkspace(view, this.checkpointRoots(session, input),
          this.checkpointBoundary(capture, workspace, input, execution, completed.evidence.afterId), signal, current);
      }
      this.authority(session); this.assertCheckpointSettled(session);
      if (capture.phase === "before" && (capture.source.kind !== "control" || !session.sandboxWorkspaceId)) {
        await this.prepareCheckpointAdmission(session, capture, signal, current);
      }
      current();
      const owned = await this.checkpointView(session, signal, current);
      return nativeCheckpointWorkspace(owned.view, this.checkpointRoots(session),
        this.checkpointBoundary(capture, owned.workspace, owned.input, owned.execution, owned.completion?.evidence.afterId, owned.view), signal, current);
    }).finally(() => this.active.delete(sessionId));
    this.active.set(sessionId, { abort, task }); return task;
  }
  async validateCheckpointCapture(sessionId: string, capture: CheckpointCapture, workspace: CheckpointWorkspace,
    signal: AbortSignal, check: () => void): Promise<void> {
    if (capture.sessionId !== sessionId || capture.phase !== "before" || this.active.has(sessionId)) {
      throw new MoguriError("sandbox_checkpoint_admission", "The exact idle before-turn capture/stage is not available for admission validation.", 409);
    }
    const current = () => { this.checkpointCapture(capture, signal, check, "captured"); };
    current(); assertNativeCheckpoint(workspace);
    if (!capture.workspaceDigest || JSON.stringify(JSON.parse(this.store.blob(capture.workspaceDigest))) !== JSON.stringify(workspace)) {
      throw new MoguriError("sandbox_checkpoint_admission", "The selected original capture bytes changed. No recapture or transfer of acceptance was performed.", 409);
    }
    const session = this.session(sessionId), owned = await this.checkpointView(session, signal, current);
    const actual = await nativeCheckpointWorkspace(owned.view, this.checkpointRoots(session),
      this.checkpointBoundary(capture, owned.workspace, owned.input, owned.execution, owned.completion?.evidence.afterId, owned.view), signal, current);
    if (JSON.stringify(actual) !== JSON.stringify(workspace)) {
      throw new MoguriError("sandbox_checkpoint_admission", "The selected private stage/current file set, exact bytes/modes/Git or signed provenance changed while admission waited. No replacement source was accepted.", 409);
    }
    current();
  }
  private async checkpointDocument(workspace: SandboxWorkspace, stage: NativeStage, previousExecutionId: string | null, signal: AbortSignal) {
    const original = this.document(workspace), authorityDigest = workspace.authorityDigest;
    const stageBinding = { version: 1 as const, sourceDigest: stage.sourceDigest };
    if (original.version === 3) return parse(GroupInputSchema, { ...original, authorityDigest, previousExecutionId, stageBinding,
      repositories: await Promise.all(original.repositories.map(async (repository) => ({
        ...repository, workingSource: await captureNativeTree(join(stage.workspace, repository.directory), repository.workingSource.policy, signal),
      }))) });
    const policy = original.version === 2 ? original.workingSource.policy : original.source?.policy ?? { denied: [], readOnly: [] };
    return parse(AutomaticInputSchema, { format: "moguri-native-workspace", version: 2, sessionId: workspace.sessionId,
      source: original.source, sourceHead: original.sourceHead, authorityDigest, previousExecutionId, stageBinding,
      workingSource: await captureNativeTree(stage.workspace, policy, signal) });
  }
  private async prepareCheckpointAdmission(session: Session, capture: CheckpointCapture, signal: AbortSignal, check: () => void) {
    let owner: Extract<PreparationOwner, { version: 4 }> = { version: 4, kind: "turn-admission", captureId: capture.id,
      checkpointId: capture.checkpointId, turnId: capture.turnId!, source: structuredClone(capture.source),
      identityDigest: capture.identityDigest, policyDigest: capture.policyDigest, contextDigest: capture.contextDigest };
    if (this.host.snapshot().sandboxWorkspaces?.some((workspace) => workspace.commandId === capture.id)) {
      throw new MoguriError("sandbox_checkpoint_replay", "This original capture already retained preparation intent. Inspect its actual stage; no copy or admission was replayed.", 409);
    }
    if (!session.sandboxWorkspaceId) {
      if (capture.source.kind === "retry") throw new MoguriError("sandbox_checkpoint_retry", "An original retry needs its retained private request/execution, not a first/empty source copy.", 409);
      if (!this.automatic()) throw new MoguriError("sandbox_checkpoint_policy", "Prepare the exact reviewed native workspace or enable managed private preparation first. A capture cannot grant that policy.", 409);
      return session.repositories ? this.prepareGroupOnce(session, owner, signal) : this.prepareAutomaticOnce(session, owner, signal);
    }
    const authorityDigest = this.authority(session), owned = await this.checkpointView(session, signal, check);
    let source = owned.view;
    if (capture.source.kind === "retry") {
      const failures = this.host.snapshot().modelFailures?.filter((failure) => failure.profileId === capture.profileId &&
        failure.sessionId === session.id && failure.turnId === capture.turnId && failure.requestDigest === capture.source.digest);
      const failure = failures?.length === 1 ? failures[0] : undefined;
      if (!failure || failure.sessionId !== session.id || failure.turnId !== capture.turnId || !failure.requestDigest ||
        capture.source.id === failure.id || capture.source.id === failure.attemptId ||
        !owned.execution || !owned.completion) throw new MoguriError("sandbox_checkpoint_retry", "The actual original retry request/failure/turn owner is missing.", 409);
      const input = retainedModelRequest(JSON.parse(this.store.blob(failure.requestDigest))), original = this.retrySource(session, failure, input);
      if (original.id !== owned.execution.id) throw new MoguriError("sandbox_checkpoint_retry", "A different retained snapshot cannot prepare this original retry.", 409);
      source = await nativeCheckpointRetrySource(await nativeSignedPrivateSource(owned.workspace.stage, owned.completion.evidence, false,
        owned.completion.verify, signal, check), this.checkpointRoots(session, owned.input));
      owner = { ...owner, retryOrigin: { failureId: failure.id, requestDigest: failure.requestDigest, originExecutionId: input.nativeOrigin!.executionId,
        attemptCount: failure.attemptCount + 1, executionId: original.id, resultDigest: original.resultDigest!, afterId: owned.completion.evidence.afterId } };
    }
    const current = () => {
      check(); signal.throwIfAborted(); const actual = this.session(session.id);
      this.preparationCurrent(session.id, owner, authorityDigest, signal, false);
      if (actual.sandboxWorkspaceId !== owned.workspace.id) throw new MoguriError("sandbox_checkpoint_stale", "The original pre-admission private stage changed before publication.", 409);
      owned.current();
    };
    const id = randomUUID(), workspace: SandboxWorkspace = { ...owned.workspace, id, revision: 0, stage: null, stageBinding: undefined,
      commandId: capture.id, commandDigest: frameDigest(owner), preparation: owner, status: "preparing", diagnostic: null,
      createdAt: new Date().toISOString(), inputDigest: this.store.putBlob(JSON.stringify({
        format: "moguri-native-preparation-intent", version: 4, owner, priorWorkspaceId: owned.workspace.id,
        previousExecutionId: owned.execution?.id ?? null, authorityDigest, privateTreeDigest: nativeCheckpointTreeDigest(source),
      })) };
    current(); this.host.commit([this.event(workspace)]);
    let stage: NativeStage | null = null;
    try {
      current();
      if (owned.workspace.status === "ready" && owned.completion?.evidence.rollback !== "confirmed") {
        await owned.view.verify(); stage = owned.workspace.stage;
      } else {
        const parent = join(this.stateDir, "native-stage-root"); await mkdir(parent, { recursive: true, mode: 0o700 });
        stage = await materializeNativePrivateStage(await realpath(parent), { profileId: this.host.snapshot().profileId,
          sessionId: session.id, turnId: id }, source, signal, current);
      }
      current();
      const input = await this.checkpointDocument({ ...workspace, inputDigest: owned.workspace.inputDigest }, stage, owned.execution?.id ?? null, signal);
      await owned.view.verify(); current(); await inspectNativeStage(stage); current();
      const ready: SandboxWorkspace = { ...workspace, stage, stageBinding: input.stageBinding, revision: 1, status: "ready", inputDigest: this.store.putBlob(JSON.stringify(input)) };
      this.host.commit([this.event(ready), { event_type: "session.sandbox_bound", profile_id: this.host.snapshot().profileId,
        project_id: session.projectId, session_id: session.id, payload: { workspaceId: ready.id } }]);
      return ready;
    } catch (error) {
      this.host.commit([this.event({ ...workspace, stage, revision: 1, status: "partial",
        diagnostic: error instanceof Error ? error.message : "The original pre-admission copy is partial. All private files remain retained; no turn was admitted or replayed." })]);
      throw error;
    }
  }
  private checkpointRewindOwner(sessionId: string, operationId: string, checkpointId: string, current: CheckpointWorkspace,
    target: CheckpointWorkspace, decisions: RewindFileDecision[]) {
    const raw = this.host.rewind?.(operationId);
    if (!raw) throw new MoguriError("sandbox_rewind_owner", "The canonical retained actual-user rewind is missing. A caller object is not source acceptance or restore authority.", 409);
    const record = parse(RewindRecordSchema, raw), session = this.session(sessionId);
    assertNativeCheckpoint(current); assertNativeCheckpoint(target);
    const checkpoint = this.host.checkpoint?.(checkpointId) ?? this.host.snapshot().checkpoints?.find((checkpoint) => checkpoint.id === checkpointId);
    const input = JSON.parse(this.store.blob(record.inputDigest)) as {
      version?: number; current?: CheckpointWorkspace; targetDigest?: string; decisions?: RewindFileDecision[];
      preview?: { digest: string; sessionId: string; checkpointId: string; identityDigest: string; policyDigest: string;
        currentWorkspaceDigest: string | null; files: Array<{ root: string; path: string; currentDigest: string | null; targetDigest: string | null;
          currentMode: number | null; targetMode: number | null; conflict: string | null }> };
    };
    if (record.actor !== "user" || record.status !== "running" || record.mode !== "workspace" || record.profileId !== this.host.snapshot().profileId ||
      record.sessionId !== sessionId || record.checkpointId !== checkpointId || record.identityDigest !== current.boundary!.identityDigest ||
      target.boundary!.identityDigest !== record.identityDigest || input.version !== 1 || input.preview?.digest !== record.previewDigest ||
      input.preview.sessionId !== sessionId || input.preview.checkpointId !== checkpointId ||
      input.preview.identityDigest !== record.identityDigest || input.preview.currentWorkspaceDigest !== checkpointReviewDigest(current) ||
      record.currentSnapshotDigest !== current.digest || record.targetSnapshotDigest !== target.digest ||
      JSON.stringify(input.current) !== JSON.stringify({ ...current, roots: current.roots.map((root) => ({
        ...root, files: root.files.map(({ content: _, ...file }) => file),
      })) }) || JSON.stringify(input.decisions) !== JSON.stringify(decisions) ||
      !checkpoint || checkpoint.sessionId !== sessionId || checkpoint.profileId !== record.profileId || checkpoint.identityDigest !== record.identityDigest ||
      checkpoint.forgotten || !checkpoint.beforeDigest || JSON.stringify(JSON.parse(this.store.blob(checkpoint.beforeDigest))) !== JSON.stringify(target) ||
      current.boundary!.profileId !== record.profileId || current.boundary!.sessionId !== sessionId ||
      target.boundary!.profileId !== record.profileId || target.boundary!.sessionId !== sessionId ||
      current.boundary!.sourceDigest !== target.boundary!.sourceDigest || current.boundary!.transportDigest !== target.boundary!.transportDigest ||
      current.roots.some((root) => !record.roots.includes(root.binding.root)) ||
      record.files.length !== input.preview.files.length || record.files.some((file, index) =>
        file.root !== input.preview!.files[index]!.root || file.path !== input.preview!.files[index]!.path)) {
      throw new MoguriError("sandbox_rewind_review", "The original reviewed operation/current tree/target, source/build or actual-user owner changed. No private stage or source files were published.", 409);
    }
    if (session.turnId !== null || session.mode !== "agent" || session.pendingMode === "read-only" || session.kind === "side") {
      throw new MoguriError("sandbox_rewind_busy", "Only the settled exact writable owner can restore private workspace state. Read-only and side modes remain enforced.", 409);
    }
    const keys = new Map(current.roots.map((root) => [root.key!, root]));
    if (current.roots.length !== target.roots.length || target.roots.some((root) => !keys.has(root.key!))) throw new MoguriError("sandbox_rewind_roots", "The complete original logical root set changed.", 409);
    const chosen = new Map(decisions.map((decision) => [JSON.stringify([decision.root, decision.path]), decision.choice]));
    if (chosen.size !== decisions.length || decisions.some((decision) => !record.files.some((file) => file.root === decision.root && file.path === decision.path)) ||
      input.preview.files.some((file) => file.conflict && !chosen.has(JSON.stringify([file.root, file.path])))) {
      throw new MoguriError("sandbox_rewind_conflict", "Every original external conflict needs its exact canonical keep-current or restore-checkpoint decision.", 409);
    }
    const files = input.preview.files.map((file) => {
      const targetRoot = target.roots.find((root) => {
        const actual = current.roots.find((entry) => entry.key === root.key);
        return (root.binding.root === file.root || root.key === file.root || actual?.binding.root === file.root) &&
          (root.files.some((entry) => entry.path === file.path) || actual?.files.some((entry) => entry.path === file.path));
      });
      const currentRoot = current.roots.find((root) => root.key === targetRoot?.key);
      if (!currentRoot || !targetRoot) throw new MoguriError("sandbox_rewind_roots", "A reviewed restore file is outside its original complete logical root.", 409);
      const live = currentRoot.files.find((entry) => entry.path === file.path), wanted = targetRoot.files.find((entry) => entry.path === file.path);
      const choice = chosen.get(JSON.stringify([file.root, file.path])) ?? "restore-checkpoint";
      if ((live?.digest ?? null) !== file.currentDigest || (live?.mode ?? null) !== file.currentMode ||
        (wanted?.digest ?? null) !== file.targetDigest || (wanted?.mode ?? null) !== file.targetMode ||
        [...currentRoot.excluded, ...targetRoot.excluded].some((path) => path === "." || path === file.path || file.path.startsWith(`${path}/`))) {
        throw new MoguriError("sandbox_rewind_files", "Reviewed bytes/modes or an explicitly excluded dependency/control path changed. An excluded file is not absent content.", 409);
      }
      if (choice !== "keep-current") {
        const member = session.repositories?.find((binding) => file.path.startsWith(`${nativeRepositoryDirectory(binding.projectId)}/`));
        if (session.repositories && !member) throw new MoguriError("sandbox_rewind_roots", "A restored path is outside the actual captured repository set.", 409);
        const relative = member ? file.path.slice(nativeRepositoryDirectory(member.projectId).length + 1) : file.path;
        const policy = folderPolicy(this.host.settings(member?.projectId ?? session.projectId).values);
        if (isProtectedProjectPath(file.path) || matchesFolder(relative, policy.denied) || matchesFolder(relative, policy.readOnly)) {
          throw new MoguriError("sandbox_rewind_policy", "Current hard folder policy forbids this exact restored path. A past checkpoint cannot approve it.", 403);
        }
      }
      return { root: currentRoot, path: file.path, choice, live, wanted };
    });
    return { record, session, input, files };
  }
  async prepareCheckpointRewind(sessionId: string, operationId: string, checkpointId: string, current: CheckpointWorkspace,
    target: CheckpointWorkspace, decisions: RewindFileDecision[], requested: AbortSignal, check: () => void):
    Promise<{ events: EventInput[]; workspaceId: string; results: CheckpointRestoreResult[]; leaseRoots: string[] }> {
    if (this.active.has(sessionId)) throw new MoguriError("sandbox_rewind_busy", "This exact session already owns private staging work.", 409);
    current = structuredClone(current); target = structuredClone(target); decisions = structuredClone(decisions);
    const abort = new AbortController(), signal = AbortSignal.any([requested, abort.signal]);
    const task = Promise.resolve().then(async () => {
      check(); signal.throwIfAborted();
      const reviewed = this.checkpointRewindOwner(sessionId, operationId, checkpointId, current, target, decisions);
      if (this.host.snapshot().sandboxWorkspaces?.some((workspace) => workspace.commandId === operationId)) throw new MoguriError("sandbox_rewind_replay", "This original rewind already retained private preparation. Inspect its actual data; no copy or bind was replayed.", 409);
      const originalAuthority = this.authority(reviewed.session), originalIdentity = frameDigest(this.checkpointIdentity(reviewed.session));
      const ownerFields = (record: RewindRecord) => JSON.stringify([record.id, record.revision, record.profileId, record.sessionId, record.checkpointId,
        record.commandId, record.mode, record.identityDigest, record.previewDigest, record.inputDigest, record.contextDigest, record.status, record.actor]);
      const originalOwner = ownerFields(reviewed.record);
      const guard = () => {
        check(); signal.throwIfAborted();
        const actual = this.host.rewind?.(operationId), session = this.session(sessionId);
        if (!actual || ownerFields(actual) !== originalOwner || session.turnId !== null || session.mode !== "agent" ||
          session.pendingMode === "read-only" || session.kind === "side") throw new MoguriError("sandbox_rewind_owner", "The canonical original running user owner changed during private copying.", 409);
        this.assertCheckpointSettled(session);
        if (this.authority(session) !== originalAuthority || frameDigest(this.checkpointIdentity(session)) !== originalIdentity) {
          throw new MoguriError("sandbox_rewind_stale", "The actual current root, hard policy or native build changed during private cloning.", 409);
        }
      };
      guard(); const owned = await this.checkpointView(reviewed.session, signal, guard);
      const actual = await nativeCheckpointWorkspace(owned.view, this.checkpointRoots(reviewed.session),
        this.checkpointBoundary({ identityDigest: current.boundary!.identityDigest }, owned.workspace, owned.input, owned.execution, owned.completion?.evidence.afterId, owned.view), signal, guard);
      if (JSON.stringify(actual) !== JSON.stringify(current)) throw new MoguriError("sandbox_rewind_stale", "Current private bytes, file set, Git intent or signed/live provenance changed after review.", 409);
      const restored = nativeCheckpointOverlay(owned.view, reviewed.files.filter((file) => file.choice === "restore-checkpoint")
        .map((file) => ({ path: file.path, file: file.wanted ?? null })));
      const id = randomUUID(), backupStageId = randomUUID();
      const owner: Extract<NonNullable<SandboxWorkspace["preparation"]>, { version: 5 }> = { version: 5, kind: "checkpoint-rewind",
        operationId, checkpointId, priorWorkspaceId: owned.workspace.id, currentDigest: current.digest, targetDigest: target.digest,
        backupStageId, backupSourceDigest: owned.view.digest, restoreSourceDigest: restored.digest, identityDigest: reviewed.record.identityDigest,
        sourceDigest: current.boundary!.sourceDigest, policyDigest: reviewed.input.preview!.policyDigest };
      const workspace: SandboxWorkspace = { ...owned.workspace, id, revision: 0, stage: null, stageBinding: undefined, preparation: owner,
        commandId: operationId, commandDigest: frameDigest(owner), status: "preparing", diagnostic: null, createdAt: new Date().toISOString(),
        inputDigest: this.store.putBlob(JSON.stringify({ format: "moguri-native-checkpoint-rewind-intent", version: 1, owner,
          authorityDigest: originalAuthority, inputDigest: owned.workspace.inputDigest, operationInputDigest: reviewed.record.inputDigest })) };
      guard(); this.host.commit([this.event(workspace)]);
      let stage: NativeStage | null = null;
      try {
        guard();
        const parent = join(this.stateDir, "native-stage-root"); await mkdir(parent, { recursive: true, mode: 0o700 });
        const canonical = await realpath(parent), stageOwner = { profileId: this.host.snapshot().profileId, sessionId };
        const backup = await materializeNativePrivateStage(canonical, { ...stageOwner, turnId: backupStageId }, owned.view, signal, guard);
        guard();
        stage = await materializeNativePrivateStage(canonical, { ...stageOwner, turnId: id }, restored, signal, guard);
        guard(); const input = await this.checkpointDocument({ ...workspace, inputDigest: owned.workspace.inputDigest }, stage, owned.execution?.id ?? null, signal);
        const copied = await captureNativePrivateTree(stage, signal, guard);
        const originals = new Map(owned.view.entries.map((entry) => [entry.path, nativePrivateVersion(entry)]));
        const planned = new Map(restored.entries.map((entry) => [entry.path, nativePrivateVersion(entry)]));
        if (copied.entries.length !== restored.entries.length || copied.entries.some((entry) => nativePrivateVersion(entry) !== planned.get(entry.path)) ||
          owned.view.entries.some((entry) => isProtectedProjectPath(entry.path) && planned.get(entry.path) !== originals.get(entry.path))) {
          throw new MoguriError("sandbox_rewind_copy", "The complete fresh private bytes/modes or current protected Git/dependency intent differ from the reviewed clone.", 409);
        }
        await owned.view.verify(); guard();
        const ready: SandboxWorkspace = { ...workspace, stage, stageBinding: input.stageBinding, revision: 1, status: "ready", inputDigest: this.store.putBlob(JSON.stringify(input)) };
        const results: CheckpointRestoreResult[] = current.roots.map((root) => ({ version: 1, operationId, root: root.binding,
          sourceDigest: current.digest, verified: true, git: root.git, files: reviewed.files.filter((file) => file.root.key === root.key).map((file) => ({
            path: file.path, choice: file.choice, outcome: file.choice === "keep-current" ? "kept" : file.wanted ? "written" : "removed",
            digest: (file.choice === "keep-current" ? file.live : file.wanted)?.digest ?? null,
            backup: file.live ? join(backup.workspace, file.path) : null, backupDigest: file.live?.digest ?? null,
          })) }));
        return { events: [this.event(ready), { event_type: "session.sandbox_bound" as const, profile_id: this.host.snapshot().profileId,
          project_id: reviewed.session.projectId, session_id: sessionId, payload: { workspaceId: ready.id } }], workspaceId: id, results,
          leaseRoots: [...new Set([owned.view.root, backup.workspace, stage.workspace])] };
      } catch (error) {
        this.host.commit([this.event({ ...workspace, stage, revision: 1, status: "partial",
          diagnostic: error instanceof Error ? error.message : "The original reviewed private restore is partial. Old stages and every new private path remain retained; nothing was bound or replayed." })]);
        throw error;
      }
    }).finally(() => this.active.delete(sessionId));
    this.active.set(sessionId, { abort, task, rewindId: operationId }); return task;
  }
  async inspectCheckpointRewind(sessionId: string, operationId: string, signal: AbortSignal = AbortSignal.timeout(30_000), check: () => void = () => {}) {
    check(); signal.throwIfAborted();
    if (this.active.has(sessionId)) throw new MoguriError("sandbox_rewind_busy", "Wait for the actual original private copy to settle before inspecting its effects.", 409);
    const record = this.host.rewind?.(operationId), session = this.session(sessionId);
    const preparations = this.host.snapshot().sandboxWorkspaces?.filter((workspace) =>
      workspace.preparation?.version === 5 && workspace.preparation.operationId === operationId) ?? [];
    const workspace = preparations[0];
    if (!record || record.profileId !== this.host.snapshot().profileId || record.sessionId !== sessionId || record.actor !== "user" ||
      record.mode !== "workspace" || record.env !== undefined && record.env !== "Sandbox" || preparations.length > 1 ||
      workspace && (workspace.sessionId !== sessionId || workspace.stage && workspace.stage.profileId !== record.profileId)) {
      throw new MoguriError("sandbox_rewind_inspection", "The exact retained user operation/private-stage intent is missing or has conflicting ownership. No replacement was scanned or replayed.", 409);
    }
    if (!workspace) {
      if (record.env !== "Sandbox") throw new MoguriError("sandbox_rewind_inspection", "The original operation has no provable native preparation boundary. No effects or cleanup were inferred.", 409);
      const value = { operationId, operationRevision: record.revision, workspaceId: null, status: "not-prepared" as const,
        stageBound: false, sourceLiveDigest: null, sourceDigest: null, backupDigest: null, stageDigest: null,
        effects: [], leaseRoots: [] };
      return { ...value, digest: frameDigest(value) };
    }
    if (workspace.preparation?.version !== 5) throw new MoguriError("sandbox_rewind_inspection", "The original private-stage intent changed. No replacement was scanned or replayed.", 409);
    const owner = workspace.preparation, parent = await realpath(join(this.stateDir, "native-stage-root"));
    const read = async (id: string, sourceDigest: string) => {
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id) || !/^[a-f0-9]{64}$/.test(sourceDigest)) {
        throw new MoguriError("sandbox_rewind_inspection", "The original private intent has an invalid stage ID/source digest. No path was inferred.", 409);
      }
      const directory = join(parent, "native-stages", record.profileId, id), root = join(directory, "workspace");
      const container = await lstat(directory, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null; throw error;
      });
      if (!container) return null;
      try {
        const metadata = await lstat(root, { bigint: true });
        const stage: NativeStage = { parent, directory, workspace: root, profileId: record.profileId, sessionId, turnId: id, sourceDigest,
          identity: { device: String(container.dev), inode: String(container.ino) }, workspaceIdentity: { device: String(metadata.dev), inode: String(metadata.ino) } };
        await inspectNativeStageContainer(stage);
        const tree = await captureNativePrivateTree(stage, signal, check);
        return { stage, tree };
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new MoguriError("sandbox_rewind_inspection", "An original retained partial directory has incomplete ownership/workspace metadata. It is not absent or safe to replay; inspect its exact retained path.", 409);
        throw error;
      }
    };
    const backup = await read(owner.backupStageId, owner.backupSourceDigest), restored = await read(workspace.id, owner.restoreSourceDigest);
    const prior = this.host.snapshot().sandboxWorkspaces?.find((workspace) => workspace.id === owner.priorWorkspaceId);
    const original = prior?.stage ? await read(prior.stage.turnId, prior.stage.sourceDigest) : null;
    let source = original?.tree;
    const execution = this.host.snapshot().sandboxExecutions?.filter((execution) => execution.workspaceId === prior?.id).at(-1);
    if (source && execution) {
      const completed = await this.checkpointCompletion(execution, sessionId, signal, check);
      if (completed.evidence.rollback === "confirmed") source = mergeNativeRollback(
        await nativeSignedPrivateSource(execution.stage, completed.evidence, false, completed.verify, signal, check),
        await nativeSignedPrivateSource(execution.stage, completed.evidence, true, completed.verify, signal, check), source);
    }
    check(); signal.throwIfAborted();
    const current = session.sandboxWorkspaceId === workspace.id ? restored?.tree : session.sandboxWorkspaceId === prior?.id ? source : undefined;
    const effects = record.files.map((file) => ({ root: file.root, path: file.path,
      currentDigest: current?.entries.find((entry) => entry.path === file.path)?.digest ?? null,
      backupDigest: backup?.tree.entries.find((entry) => entry.path === file.path)?.digest ?? null }));
    const value = { operationId, operationRevision: record.revision, workspaceId: workspace.id, status: workspace.status,
      stageBound: session.sandboxWorkspaceId === workspace.id, sourceLiveDigest: original ? nativeCheckpointTreeDigest(original.tree) : null,
      sourceDigest: source ? nativeCheckpointTreeDigest(source) : null,
      backupDigest: backup ? nativeCheckpointTreeDigest(backup.tree) : null, stageDigest: restored ? nativeCheckpointTreeDigest(restored.tree) : null,
      effects, leaseRoots: [original?.stage.workspace, backup?.stage.workspace, restored?.stage.workspace].filter((path): path is string => Boolean(path)) };
    return { ...value, digest: frameDigest(value) };
  }
  async preview(sessionId: string, paths: string[], signal: AbortSignal = AbortSignal.timeout(15_000)) {
    const session = this.session(sessionId), authorityDigest = this.authority(session), config = this.native.assertReady();
    if (session.repositories) throw new MoguriError("sandbox_group_setup", "Captured groups require reviewed managed automatic workspaces for their complete root set. A single-project text review cannot stand in for the group.", 409);
    if (session.turnId || this.active.has(session.id)) throw new MoguriError("sandbox_busy", "Stop/wait for the current owned turn or staging preparation before reviewing a new root.", 409);
    if (!session.projectId && paths.length) throw new MoguriError("project_required", "Project-free Sandbox chats have an empty private workspace. No host root was inferred.", 409);
    const selected = [...paths].sort(), project = session.projectId ? this.host.project(session) : null, policy = folderPolicy(this.host.settings(session.projectId).values);
    const source = project ? await captureNativeSource(project.path, selected, policy, signal) : null;
    const sourceHead = project ? (await optionalGitBinding(project.path, signal))?.head ?? null : null;
    if (this.authority(this.session(sessionId)) !== authorityDigest || this.session(sessionId).sandboxWorkspaceId !== session.sandboxWorkspaceId) throw new MoguriError("sandbox_stale", "Source/policy/binding changed during native source review. No staged root or model call was created.", 409);
    const input = { format: "moguri-native-workspace" as const, version: 1 as const, sessionId, source, authorityDigest, sourceHead };
    parse(InputSchema, input);
    const text = JSON.stringify(input), before = (this.host.snapshot().sandboxWorkspaces ?? []).filter((value) => value.sessionId === sessionId).map(({ id, revision, status }) => ({ id, revision, status }));
    const preview: SandboxWorkspacePreview = { digest: digest(`moguri-native-workspace-v1\0${text}\0${JSON.stringify(before)}`), sessionId, sourceRoot: project?.path ?? null,
      paths: selected, bytes: source?.files.reduce((total, file) => total + file.bytes, 0) ?? 0, sourceHead, configDigest: frameDigest(config),
      files: source?.files.map(({ path, text, digest, bytes }) => ({ path, text, digest, bytes })) ?? [],
      diagnostic: "Only these exact text snapshots enter a private native staging root. Agent writes never modify the source checkout; later publication needs separate byte/base/policy review." };
    return { preview, input, text, session };
  }
  prepare(command: Extract<SandboxCommand, { type: "sandbox.prepare" }>, finish: WorkspaceFinish) {
    if (this.active.has(command.sessionId)) return Promise.reject(new MoguriError("sandbox_busy", "This session already owns native staging preparation.", 409));
    const abort = new AbortController(), task = this.prepareOnce(command, finish, abort.signal).finally(() => this.active.delete(command.sessionId));
    this.active.set(command.sessionId, { abort, task }); return task;
  }
  private async prepareOnce(command: Extract<SandboxCommand, { type: "sandbox.prepare" }>, finish: WorkspaceFinish, signal: AbortSignal) {
    if (!finish.intent) throw new MoguriError("sandbox_intent", "Native preparation requires original durable command identity before filesystem effects.", 409);
    const prior = (this.host.snapshot().sandboxWorkspaces ?? []).find((value) => value.commandId === finish.intent!.id);
    if (prior) {
      if (prior.commandDigest !== finish.intent.digest) throw new MoguriError("idempotency_conflict", "The original native preparation command changed.", 409);
      if (prior.status !== "ready") throw new MoguriError("sandbox_preparation_partial", prior.diagnostic ?? "Original native staging is partial. Inspect it; no filesystem work was replayed.", 409);
      return finish([], { id: prior.id });
    }
    const session = this.session(command.sessionId);
    if (session.revision !== command.expectedRevision) throw new MoguriError("revision_conflict", "The source session changed. Review its exact current staging scope.", 409);
    const prepared = await this.preview(session.id, command.paths, signal);
    if (prepared.preview.digest !== command.expectedDigest || this.session(session.id).revision !== command.expectedRevision) throw new MoguriError("sandbox_stale", "The reviewed exact source set, policy or native binding changed. No filesystem effects were started.", 409);
    const id = randomUUID();
    const workspace: SandboxWorkspace = { id, sessionId: session.id, projectId: session.projectId, sourceWorkspaceId: session.workspaceId,
      sourceRoot: prepared.preview.sourceRoot, sourceHead: prepared.input.sourceHead, inputDigest: this.store.putBlob(prepared.text),
      stage: null, authorityDigest: prepared.input.authorityDigest, configDigest: prepared.preview.configDigest, revision: 0, createdAt: new Date().toISOString(),
      commandId: finish.intent.id, commandDigest: finish.intent.digest, status: "preparing", diagnostic: null };
    this.host.commit([this.event(workspace)]);
    try {
      signal.throwIfAborted();
      const parent = join(this.stateDir, "native-stage-root"); await mkdir(parent, { recursive: true, mode: 0o700 });
      let source = prepared.input.source;
      if (!source) {
        const empty = join(this.stateDir, "native-inputs", id); await mkdir(empty, { recursive: true, mode: 0o700 });
        source = await captureNativeSource(await realpath(empty), [], { denied: [], readOnly: [] }, signal);
      }
      const stage = await materializeNativeStage(await realpath(parent), { profileId: this.host.snapshot().profileId, sessionId: session.id, turnId: id }, source, signal);
      signal.throwIfAborted();
      if (this.authority(this.session(session.id)) !== workspace.authorityDigest || this.session(session.id).revision !== command.expectedRevision) throw new MoguriError("sandbox_stale", "Source/session authority changed while files were copied. The private stage is retained; no binding or model was admitted.", 409);
      return finish([this.event({ ...workspace, stage, revision: 1, status: "ready" }),
        { event_type: "session.sandbox_bound", profile_id: this.host.snapshot().profileId, project_id: session.projectId, session_id: session.id, payload: { workspaceId: workspace.id } }],
      { id: workspace.id, revision: command.expectedRevision + 1 });
    } catch (error) {
      this.host.commit([this.event({ ...workspace, revision: 1, status: "partial", diagnostic: signal.aborted ? "Native source preparation stopped. Partial owned files remain retained; no automatic retry." :
        error instanceof MoguriError ? error.message : "Native staging failed. Inspect its original owned directory; source was not modified and no retry is assumed." })]);
      throw error;
    }
  }
  private event(workspace: SandboxWorkspace): EventInput {
    return { event_type: "sandbox.workspace_recorded", profile_id: this.host.snapshot().profileId, project_id: workspace.projectId, session_id: workspace.sessionId, payload: { workspace } };
  }
  async prepareAutomatic(sessionId: string, turnId: string, requested: AbortSignal) {
    const session = this.session(sessionId);
    const prepared = this.host.snapshot().sandboxWorkspaces?.find((workspace) => workspace.id === session.sandboxWorkspaceId);
    if (prepared?.preparation?.version === 4 && prepared.preparation.turnId === turnId) {
      requested.throwIfAborted();
      const owner = prepared.preparation, capture = this.host.capture?.(owner.captureId);
      if (this.active.has(sessionId) || session.turnId !== turnId || !capture || capture.status !== "consumed" || capture.phase !== "before" ||
        capture.sessionId !== sessionId || capture.profileId !== this.host.snapshot().profileId || capture.turnId !== turnId ||
        !capture.consumedByEventId || !capture.workspaceDigest || JSON.stringify(capture.source) !== JSON.stringify(owner.source)) {
        throw new MoguriError("sandbox_checkpoint_admission", "The exact prepared stage has not been consumed by its actual admitted turn. No copy, guest or model was replayed.", 409);
      }
      const before = JSON.parse(this.store.blob(capture.workspaceDigest)) as CheckpointWorkspace;
      if (before.boundary?.workspaceId !== prepared.id || before.boundary.inputDigest !== prepared.inputDigest) {
        throw new MoguriError("sandbox_checkpoint_admission", "The admitted capture no longer names this exact prepared stage/input.", 409);
      }
      return this.assert(session);
    }
    if (!this.automatic()) {
      if (session.repositories) throw new MoguriError("sandbox_group_setup", "Enable reviewed managed automatic workspaces for this captured group. No first-root or empty stage was used.", 409);
      return this.assert(session);
    }
    if (this.active.has(sessionId)) throw new MoguriError("sandbox_busy", "This session already owns native workspace preparation.", 409);
    const abort = new AbortController(), signal = AbortSignal.any([requested, abort.signal]);
    const owner: PreparationOwner = { version: 1, kind: "automatic", turnId };
    const task = Promise.resolve().then(() => session.repositories ? this.prepareGroupOnce(session, owner, signal) :
      this.prepareAutomaticOnce(session, owner, signal)).finally(() => this.active.delete(sessionId));
    this.active.set(sessionId, { abort, task });
    return task;
  }
  async prepareScheduled(sessionId: string, commandId: string, commandDigest: string, draft: Session["draft"], requested: AbortSignal) {
    const session = this.session(sessionId);
    if (session.turnId || this.active.has(sessionId)) throw new MoguriError("sandbox_busy", "The original idle session already owns execution or private preparation. Its draft was preserved.", 409);
    const owner: PreparationOwner = { version: 2, kind: "scheduled", commandId, commandDigest,
      draftRevision: draft.revision, draftDigest: digest(JSON.stringify(draft)) };
    const previous = (this.host.snapshot().sandboxWorkspaces ?? []).find((workspace) => workspace.commandId === commandId &&
      workspace.sessionId === sessionId && workspace.preparation?.version === 2);
    if (previous && (JSON.stringify(previous.preparation) !== JSON.stringify(owner) || previous.status !== "ready" ||
      session.sandboxWorkspaceId !== previous.id)) {
      throw new MoguriError("sandbox_preparation_partial", "This original scheduled preparation is changed, partial or unbound. Inspect its retained intent; no copy, model or scheduled prompt was replayed.", 409);
    }
    const abort = new AbortController(), signal = AbortSignal.any([requested, abort.signal]);
    const task = Promise.resolve().then(async () => {
      signal.throwIfAborted();
      if (session.sandboxWorkspaceId) {
        const workspace = await this.assert(session); signal.throwIfAborted(); return workspace;
      }
      if (!this.automatic()) throw new MoguriError("sandbox_workspace", "Review and prepare the exact native source first, or explicitly enable managed private preparation. Scheduling cannot grant that policy.", 409);
      return session.repositories ? this.prepareGroupOnce(session, owner, signal, draft) : this.prepareAutomaticOnce(session, owner, signal, draft);
    }).finally(() => this.active.delete(sessionId));
    this.active.set(sessionId, { abort, task }); return task;
  }
  retrySource(session: Session, failure: ModelFailure, input: RetainedModelRequest): SandboxExecution {
    const snapshot = this.host.snapshot(), origin = input.nativeOrigin;
    if (input.version !== 2 || !origin || input.profileId !== snapshot.profileId || failure.profileId !== snapshot.profileId ||
      input.sessionId !== session.id || failure.sessionId !== session.id || input.turnId !== failure.turnId ||
      input.sourceStepId !== failure.sourceStepId || snapshot.settings.values.interactions.nativeRetryRestaging !== true ||
      session.controls.env !== "Sandbox" || !snapshot.policy.allowedEnvs.includes("Sandbox") || this.host.closing(session)) {
      throw new MoguriError("native_retry_policy", "Explicitly enable exact private-snapshot retry restaging for new qualified requests. No legacy request, live checkout or different Env was adopted.", 409);
    }
    const executions = (snapshot.sandboxExecutions ?? []).filter((entry) => entry.sessionId === session.id && entry.turnId === failure.turnId);
    const original = executions.find((entry) => entry.id === origin.executionId), last = executions.at(-1);
    const prepared = this.preparedCheckpointRetry(session, failure, input, true);
    if (!original || original.profileId !== snapshot.profileId || original.workspaceId !== origin.workspaceId ||
      original.inputDigest !== origin.inputDigest || original.stage.workspace !== origin.root || !last || last.profileId !== snapshot.profileId ||
      last.cleanup !== "owned-guest-stopped" || !last.resultDigest || !last.nativeSessionId || !last.planDigest || !last.signerFingerprint ||
      session.sandboxWorkspaceId !== last.workspaceId && prepared?.preparation.retryOrigin?.executionId !== last.id || last.workerDigest !== original.workerDigest ||
      last.configDigest !== original.configDigest || last.sourceWorkspaceId !== session.workspaceId) {
      throw new MoguriError("native_retry_snapshot", "The exact original request/guest/source or verified cleanup changed. Acknowledged inspection cannot replace VM-absence or snapshot proof.", 409);
    }
    const workspace = snapshot.sandboxWorkspaces?.find((entry) => entry.id === last.workspaceId);
    if (!workspace || workspace.authorityDigest !== this.authority(session) ||
      last.id !== original.id && !(prepared?.id === workspace.id) && (workspace.preparation?.version !== 3 || workspace.preparation.failureId !== failure.id ||
        workspace.preparation.originExecutionId !== original.id || workspace.preparation.requestDigest !== failure.requestDigest)) {
      throw new MoguriError("native_retry_owner", "The retained private snapshot is not this original failure's exact source lineage. No new root or owner was substituted.", 409);
    }
    const result = sandboxResult(this.store.blob(last.resultDigest));
    if (result.executionId !== last.id || result.inputDigest !== last.inputDigest || result.workspaceId !== last.workspaceId ||
      result.planDigest !== last.planDigest || result.signerFingerprint !== last.signerFingerprint ||
      result.nativeSessionId !== last.nativeSessionId || result.rollback !== "confirmed" || result.journal.status !== "verified") {
      throw new MoguriError("native_retry_snapshot", "The original rolled-back private snapshot/journal is incomplete or unverified. No live-source reconstruction or paid retry was admitted.", 409);
    }
    return last;
  }
  private preparedCheckpointRetry(session: Session, failure: ModelFailure, input: RetainedModelRequest, allowPending = false) {
    const workspace = this.host.snapshot().sandboxWorkspaces?.find((workspace) => workspace.id === session.sandboxWorkspaceId);
    const owner = workspace?.preparation;
    if (!workspace || owner?.version !== 4 || !owner.retryOrigin) return undefined;
    const capture = this.host.capture?.(owner.captureId), origin = owner.retryOrigin;
    // Admission may recheck its source before serialization; execution callers cannot use this phase.
    const capturing = allowPending && capture?.status === "capturing" && session.turnId === null &&
      origin.attemptCount === failure.attemptCount + 1 && capture.workspaceDigest === null && capture.consumedByEventId === null &&
      capture.source.id !== failure.attemptId;
    const pending = allowPending && capture?.status === "captured" && session.turnId === null &&
      origin.attemptCount === failure.attemptCount + 1 && capture.consumedByEventId === null && capture.source.id !== failure.attemptId;
    const admitted = capture?.status === "consumed" && origin.attemptCount === failure.attemptCount &&
      capture.source.id === failure.attemptId && Boolean(capture.consumedByEventId);
    if (!capture || !capturing && !pending && !admitted || capture.phase !== "before" || capture.sessionId !== session.id ||
      capture.profileId !== this.host.snapshot().profileId || capture.turnId !== failure.turnId || owner.turnId !== failure.turnId ||
      capture.checkpointId !== owner.checkpointId || capture.identityDigest !== owner.identityDigest ||
      capture.policyDigest !== owner.policyDigest || capture.contextDigest !== owner.contextDigest ||
      capture.source.kind !== "retry" || capture.source.id === failure.id || capture.source.digest !== failure.requestDigest ||
      JSON.stringify(capture.source) !== JSON.stringify(owner.source) ||
      origin.failureId !== failure.id || origin.requestDigest !== failure.requestDigest ||
      origin.originExecutionId !== input.nativeOrigin?.executionId || workspace.status !== "ready") {
      throw new MoguriError("native_retry_owner", "The actual pre-admission retry capture was not consumed by its exact original failure/turn. No changed attempt or source was adopted.", 409);
    }
    const document = this.document(workspace);
    if (document.version === 1 || document.previousExecutionId !== origin.executionId) {
      throw new MoguriError("native_retry_owner", "Original prepared retry lost its exact before-turn stage/input/signed result boundary.", 409);
    }
    if (!capturing) {
      if (!capture.workspaceDigest) throw new MoguriError("native_retry_owner", "Original captured retry lost its exact retained workspace bytes.", 409);
      const before = JSON.parse(this.store.blob(capture.workspaceDigest)) as CheckpointWorkspace;
      if (before.boundary?.workspaceId !== workspace.id || before.boundary.inputDigest !== workspace.inputDigest ||
        before.boundary.executionId !== origin.executionId || before.boundary.resultDigest !== origin.resultDigest ||
        before.boundary.afterId !== origin.afterId) {
        throw new MoguriError("native_retry_owner", "Original prepared retry lost its exact before-turn stage/input/signed result boundary.", 409);
      }
    }
    return { ...workspace, preparation: owner };
  }
  async prepareRetry(sessionId: string, failure: ModelFailure, input: RetainedModelRequest, requested: AbortSignal) {
    if (this.active.has(sessionId)) throw new MoguriError("sandbox_busy", "This exact session already owns private staging work.", 409);
    const session = this.session(sessionId), source = this.retrySource(session, failure, input), result = sandboxResult(this.store.blob(source.resultDigest!));
    if (!failure.attemptId || !failure.requestDigest || session.turnId !== failure.turnId) throw new MoguriError("native_retry_owner", "No actual retained retry attempt owns this preparation.", 409);
    const checkpointPrepared = this.preparedCheckpointRetry(session, failure, input);
    if (checkpointPrepared) {
      requested.throwIfAborted(); this.retryCurrent(session, failure, input);
      const exact = await this.assert(session); requested.throwIfAborted();
      this.retryCurrent(this.session(sessionId), failure, input);
      if (exact.id !== checkpointPrepared.id || exact.inputDigest !== checkpointPrepared.inputDigest) {
        throw new MoguriError("native_retry_stale", "The exact pre-admission private retry stage/input changed. No second copy or inference was admitted.", 409);
      }
      return exact;
    }
    const abort = new AbortController(), signal = AbortSignal.any([requested, abort.signal]), authorityDigest = this.authority(session);
    const owner: Extract<NonNullable<SandboxWorkspace["preparation"]>, { version: 3 }> = { version: 3, kind: "retry", turnId: failure.turnId, failureId: failure.id, attemptId: failure.attemptId,
      requestDigest: failure.requestDigest, executionId: source.id, originExecutionId: input.nativeOrigin!.executionId,
      resultDigest: source.resultDigest!, afterId: result.afterId };
    const current = () => {
      signal.throwIfAborted(); const actual = this.session(sessionId);
      if (actual.turnId !== failure.turnId || this.authority(actual) !== authorityDigest ||
        this.host.snapshot().settings.values.interactions.nativeRetryRestaging !== true || actual.sandboxWorkspaceId !== source.workspaceId) {
        throw new MoguriError("native_retry_stale", "The actual retry owner, current permissions or snapshot binding changed during copy. No new stage or inference was admitted.", 409);
      }
      return actual;
    };
    const task = Promise.resolve().then(async () => {
      current();
      const prior = this.host.snapshot().sandboxWorkspaces?.find((entry) => entry.commandId === failure.attemptId);
      if (prior) throw new MoguriError("native_retry_replay", "This exact retry already retained preparation intent. Inspect its partial result; no copy or call was replayed.", 409);
      const id = randomUUID(), original = this.document(source), workspace: SandboxWorkspace = {
        id, sessionId, projectId: session.projectId, sourceWorkspaceId: session.workspaceId, sourceRoot: source.sourceRoot,
        sourceHead: original.sourceHead, inputDigest: this.store.putBlob(JSON.stringify({ format: "moguri-native-retry-intent", version: 1, owner, authorityDigest })),
        stage: null, authorityDigest, configDigest: frameDigest(this.native.assertReady()), revision: 0, createdAt: new Date().toISOString(),
        commandId: failure.attemptId!, commandDigest: frameDigest(owner), preparation: owner, ...(source.repositories ? { repositories: source.repositories } : {}),
        status: "preparing", diagnostic: null,
      };
      this.host.commit([this.event(workspace)]);
      try {
        const policies = session.repositories?.map((binding) => ({ binding, policy: folderPolicy(this.host.settings(binding.projectId).values) }));
        const policy: FolderPolicy = policies ? { denied: policies.flatMap(({ binding, policy }) => policy.denied.map((path) => `${nativeRepositoryDirectory(binding.projectId)}/${path}`)),
          readOnly: policies.flatMap(({ binding, policy }) => policy.readOnly.map((path) => `${nativeRepositoryDirectory(binding.projectId)}/${path}`)) } :
          folderPolicy(this.host.settings(session.projectId).values);
        const retained = await this.restoreAfter(source, id, policy, signal, true);
        current();
        const document = original.version === 3 ? parse(GroupInputSchema, { ...original, authorityDigest, previousExecutionId: source.id,
          repositories: await Promise.all(original.repositories.map(async (repository) => {
            const root = join(retained.root, repository.directory); await mkdir(root, { recursive: true, mode: 0o700 });
            return { ...repository, workingSource: await captureNativeTree(await realpath(root), repository.workingSource.policy, signal) };
          })) }) : parse(AutomaticInputSchema, { format: "moguri-native-workspace", version: 2, sessionId,
            source: original.source, sourceHead: original.sourceHead, workingSource: retained, authorityDigest, previousExecutionId: source.id });
        const parent = join(this.stateDir, "native-stage-root"); await mkdir(parent, { recursive: true, mode: 0o700 });
        const stageOwner = { profileId: this.host.snapshot().profileId, sessionId, turnId: id };
        const stage = document.version === 3 ? await materializeNativeGroup(await realpath(parent), stageOwner,
          document.repositories.map((repository) => ({ projectId: repository.binding.projectId, directory: repository.directory, source: repository.workingSource })), signal) :
          await materializeNativeStage(await realpath(parent), stageOwner, retained, signal);
        current(); await inspectNativeStage(stage); current();
        const ready = { ...workspace, inputDigest: this.store.putBlob(JSON.stringify(document)), stage, revision: 1, status: "ready" as const };
        this.host.commit([this.event(ready), { event_type: "session.sandbox_bound", profile_id: this.host.snapshot().profileId,
          project_id: session.projectId, session_id: sessionId, payload: { workspaceId: ready.id } }]);
        return ready;
      } catch (error) {
        this.host.commit([this.event({ ...workspace, revision: 1, status: "partial", diagnostic: error instanceof MoguriError ? error.message :
          "Exact native retry snapshot copy was interrupted. Original input, unknown charges and partial owned files remain; no replay." })]);
        throw error;
      }
    }).finally(() => this.active.delete(sessionId));
    this.active.set(sessionId, { abort, task }); return task;
  }
  retryCurrent(session: Session, failure: ModelFailure, input: RetainedModelRequest): void {
    const workspace = this.current(session), owner = workspace.preparation;
    if (owner?.version === 4 && owner.retryOrigin && this.preparedCheckpointRetry(session, failure, input) &&
      this.host.snapshot().settings.values.interactions.nativeRetryRestaging === true && failure.attemptId &&
      input.version === 2 && session.turnId === failure.turnId) return;
    if (this.host.snapshot().settings.values.interactions.nativeRetryRestaging !== true || input.version !== 2 ||
      owner?.version !== 3 || owner.failureId !== failure.id || owner.attemptId !== failure.attemptId ||
      owner.requestDigest !== failure.requestDigest || owner.originExecutionId !== input.nativeOrigin?.executionId ||
      owner.turnId !== failure.turnId || session.turnId !== failure.turnId) {
      throw new MoguriError("native_retry_owner", "The active private stage lost its exact original request/attempt/snapshot policy. No transferred root or new model call was authorized.", 409);
    }
  }
  private preparationCurrent(sessionId: string, owner: PreparationOwner, authorityDigest: string, signal: AbortSignal, requireAutomatic = true): Session {
    signal.throwIfAborted();
    const actual = this.session(sessionId);
    const capture = owner.version === 4 ? this.host.capture?.(owner.captureId) : undefined;
    const owning = owner.version === 1 ? actual.turnId === owner.turnId : owner.version === 2 ?
      actual.turnId === null && actual.draft.revision === owner.draftRevision && digest(JSON.stringify(actual.draft)) === owner.draftDigest :
      actual.turnId === null && capture?.status === "capturing" && capture.phase === "before" && capture.sessionId === sessionId &&
      capture.profileId === this.host.snapshot().profileId && capture.turnId === owner.turnId && capture.checkpointId === owner.checkpointId &&
      capture.identityDigest === owner.identityDigest && capture.policyDigest === owner.policyDigest && capture.contextDigest === owner.contextDigest &&
      JSON.stringify(capture.source) === JSON.stringify(owner.source) &&
      (!owner.retryOrigin || this.host.snapshot().settings.values.interactions.nativeRetryRestaging === true &&
        this.host.snapshot().modelFailures?.some((failure) => failure.id === owner.retryOrigin!.failureId && failure.sessionId === sessionId &&
          failure.turnId === owner.turnId && failure.requestDigest === owner.retryOrigin!.requestDigest)) &&
      (owner.source.kind !== "queue" || actual.queue.some((item) => item.id === owner.source.id && !item.held && frameDigest(item) === owner.source.digest));
    if (!owning || requireAutomatic && !this.automatic() || this.authority(actual) !== authorityDigest) {
      throw new MoguriError("sandbox_stale", "The exact preparation owner, saved draft, source or policy changed. No model or scheduled prompt was admitted.", 409);
    }
    return actual;
  }
  private groupBindings(session: Session, heads: ReadonlyMap<string, string | null> = new Map()): SandboxRepository[] {
    if (!session.repositories) throw new MoguriError("sandbox_repository_scope", "This native group has no original captured repository set.", 409);
    return sandboxRepositories(session.repositories.map((binding) => {
      this.host.project(session, binding.projectId);
      const directory = nativeRepositoryDirectory(binding.projectId);
      return { ...binding, directory, guestRoot: `/workspace/${directory}`, sourceHead: heads.get(binding.projectId) ?? null };
    }));
  }
  private sameGroup(session: Session, repositories: SandboxRepository[] | undefined): boolean {
    return Boolean(session.repositories && repositories && JSON.stringify(session.repositories) === JSON.stringify(
      sandboxRepositories(repositories).map(({ projectId, name, root }) => ({ projectId, name, root }))));
  }
  private async prepareGroupOnce(session: Session, owner: PreparationOwner, signal: AbortSignal, draft?: Session["draft"]) {
    const authorityDigest = this.authority(session), config = this.native.assertReady(), bindings = this.groupBindings(session);
    const current = () => {
      const actual = this.preparationCurrent(session.id, owner, authorityDigest, signal);
      if (!this.sameGroup(actual, bindings)) {
        throw new MoguriError("sandbox_stale", "The captured group, actual source/policy or owned turn changed before native admission. No first-root or Local fallback.", 409);
      }
      return actual;
    };
    current();
    const previous = (this.host.snapshot().sandboxWorkspaces ?? []).find((workspace) => workspace.id === session.sandboxWorkspaceId);
    if (owner.version === 2 && previous) throw new MoguriError("sandbox_workspace", "Scheduling cannot replace or restore an existing native group stage. Review its exact retained state first.", 409);
    if (previous && !this.sameGroup(session, previous.repositories)) throw new MoguriError("sandbox_repository_scope", "The retained private stage belongs to another original root set. No legacy or empty workspace was relabelled.", 409);
    if (previous?.stage && previous.status === "ready" && previous.authorityDigest === authorityDigest) {
      try { await inspectNativeStage(previous.stage); current(); return { ...previous, stage: previous.stage }; }
      catch (error) { if (!(error instanceof MoguriError && error.code === "native_stage")) throw error; }
    }
    const last = (this.host.snapshot().sandboxExecutions ?? []).filter((execution) => execution.workspaceId === previous?.id).at(-1);
    if (last && (last.cleanup !== "owned-guest-stopped" || !last.resultDigest || !last.nativeSessionId || !last.planDigest || !last.signerFingerprint ||
      !this.sameGroup(session, last.repositories))) throw new MoguriError("sandbox_workspace", "Original group work or exact VM cleanup is unconfirmed. Its retained files/holds cannot authorize a replacement copy or guest.", 409);
    const original = last ? this.document(last) : null;
    if (original && (original.version !== 3 || JSON.stringify(original.repositories.map(({ binding }) => binding)) !== JSON.stringify(session.repositories))) {
      throw new MoguriError("sandbox_repository_history", "Retained group input has no exact version-3 source lineage. No v1/v2 receipt was reinterpreted.", 409);
    }
    const workId = owner.version === 1 ? owner.turnId : owner.version === 2 ? owner.commandId : owner.captureId;
    const id = randomUUID(), workspace: SandboxWorkspace = { id, sessionId: session.id, projectId: null, sourceWorkspaceId: null,
      sourceRoot: null, sourceHead: null, repositories: bindings, stage: null, authorityDigest, configDigest: frameDigest(config),
      revision: 0, createdAt: new Date().toISOString(), commandId: workId,
      commandDigest: owner.version === 2 ? owner.commandDigest : owner.version === 4 ? frameDigest(owner) :
        frameDigest(["moguri-native-group-automatic-v1", this.host.snapshot().profileId, session.id, workId, authorityDigest]),
      preparation: owner, status: "preparing", diagnostic: null,
      inputDigest: this.store.putBlob(JSON.stringify({ format: "moguri-native-preparation-intent", version: owner.version === 1 ? 2 : owner.version === 4 ? 4 : 3,
        sessionId: session.id, ...(owner.version === 1 ? { turnId: owner.turnId } : { owner, draft }),
        repositories: bindings, previousExecutionId: last?.id ?? null, authorityDigest })) };
    this.host.commit([this.event(workspace)]);
    try {
      const policies = new Map(bindings.map((binding) => [binding.projectId, folderPolicy(this.host.settings(binding.projectId).values)]));
      const policyFor = (id: string) => {
        const policy = policies.get(id);
        if (!policy) throw new MoguriError("sandbox_repository_scope", "An original group member lost its captured folder policy.", 409);
        return policy;
      };
      const aggregatePolicy: FolderPolicy = {
        denied: bindings.flatMap((binding) => policyFor(binding.projectId).denied.map((path) => `${binding.directory}/${path}`)),
        readOnly: bindings.flatMap((binding) => policyFor(binding.projectId).readOnly.map((path) => `${binding.directory}/${path}`)),
      };
      const retained = last ? await this.restoreAfter(last, id, aggregatePolicy, signal) : null;
      const repositories: StaticGroupRepository[] = [];
      for (const binding of bindings) {
        current();
        const policy = policyFor(binding.projectId);
        const before = original?.version === 3 ? original.repositories.find((entry) => entry.binding.projectId === binding.projectId) : undefined;
        if (original && !before) throw new MoguriError("sandbox_repository_history", "Retained group work omitted an original member. No subset was restored.", 409);
        const source = before?.source ?? parse(TreeSourceSchema, await captureNativeTree(binding.root.root, policy, signal));
        const sourceHead = before ? before.sourceHead : (await optionalGitBinding(binding.root.root, signal))?.head ?? null;
        let workingSource = source;
        if (retained) {
          const root = join(retained.root, binding.directory);
          await mkdir(root, { recursive: true, mode: 0o700 });
          workingSource = parse(TreeSourceSchema, await captureNativeTree(await realpath(root), policy, signal));
        }
        repositories.push({ binding: { projectId: binding.projectId, name: binding.name, root: binding.root }, directory: binding.directory, source, workingSource, sourceHead });
      }
      const input = parse(GroupInputSchema, { format: "moguri-native-workspace", version: 3, sessionId: session.id, source: null, sourceHead: null,
        repositories, authorityDigest, previousExecutionId: last?.id ?? null });
      const parent = join(this.stateDir, "native-stage-root"); await mkdir(parent, { recursive: true, mode: 0o700 });
      const stage = await materializeNativeGroup(await realpath(parent), { profileId: this.host.snapshot().profileId, sessionId: session.id, turnId: id },
        repositories.map((entry) => ({ projectId: entry.binding.projectId, directory: entry.directory, source: entry.workingSource })), signal);
      current();
      if (!last) for (const repository of repositories) if (((await optionalGitBinding(repository.source.root, signal))?.head ?? null) !== repository.sourceHead) {
        throw new MoguriError("sandbox_stale", "A captured source HEAD changed during complete group copying. The private stage remains partial, not a mixed base.", 409);
      }
      current();
      const ready: SandboxWorkspace = { ...workspace, stage, repositories: this.groupBindings(session, new Map(repositories.map((entry) => [entry.binding.projectId, entry.sourceHead]))),
        inputDigest: this.store.putBlob(JSON.stringify(input)), status: "ready", revision: 1 };
      this.host.commit([this.event(ready), { event_type: "session.sandbox_bound", profile_id: this.host.snapshot().profileId, session_id: session.id, payload: { workspaceId: ready.id } }]);
      return { ...ready, stage };
    } catch (error) {
      this.host.commit([this.event({ ...workspace, status: "partial", revision: 1, diagnostic: signal.aborted ?
        "Original group copying stopped before worker/model admission. Every source and the partial owned stage were preserved." :
        error instanceof MoguriError ? error.message : "Complete captured-group staging failed. No source was written, member omitted or preparation replayed." })]);
      throw error;
    }
  }
  private async prepareAutomaticOnce(session: Session, owner: PreparationOwner, signal: AbortSignal, draft?: Session["draft"]) {
    const authorityDigest = this.authority(session), config = this.native.assertReady();
    const current = () => {
      return this.preparationCurrent(session.id, owner, authorityDigest, signal);
    };
    current();
    const previous = (this.host.snapshot().sandboxWorkspaces ?? []).find((value) => value.id === session.sandboxWorkspaceId);
    if (owner.version === 2 && previous) throw new MoguriError("sandbox_workspace", "Scheduling cannot replace or restore an existing native stage. Review its exact retained state first.", 409);
    if (previous?.stage && previous.status === "ready" && previous.authorityDigest === authorityDigest) {
      try { await inspectNativeStage(previous.stage); current(); return { ...previous, stage: previous.stage }; }
      catch (error) { if (!(error instanceof MoguriError && error.code === "native_stage")) throw error; }
    }
    const executions = (this.host.snapshot().sandboxExecutions ?? []).filter((value) => value.workspaceId === previous?.id);
    const last = executions.at(-1);
    if (last && (last.cleanup !== "owned-guest-stopped" || !last.resultDigest || !last.nativeSessionId || !last.planDigest || !last.signerFingerprint)) {
      throw new MoguriError("sandbox_workspace", "The original native workspace has unconfirmed retained work or cleanup. Inspect that original result; automatic preparation cannot discard or replay it.", 409);
    }
    if (previous && (previous.projectId !== session.projectId || previous.sourceWorkspaceId !== session.workspaceId)) {
      throw new MoguriError("sandbox_workspace", "The original private workspace belongs to another actual source binding. Retained work was not discarded or moved.", 409);
    }
    const project = session.projectId ? this.host.project(session) : null;
    const id = randomUUID(), workId = owner.version === 1 ? owner.turnId : owner.version === 2 ? owner.commandId : owner.captureId;
    const workspace: SandboxWorkspace = { id, sessionId: session.id, projectId: session.projectId, sourceWorkspaceId: session.workspaceId,
      sourceRoot: project?.path ?? null, sourceHead: null, stage: null, authorityDigest, configDigest: frameDigest(config),
      revision: 0, createdAt: new Date().toISOString(), commandId: workId,
      commandDigest: owner.version === 2 ? owner.commandDigest : owner.version === 4 ? frameDigest(owner) :
        frameDigest(["moguri-native-automatic-v1", this.host.snapshot().profileId, session.id, workId, authorityDigest]),
      preparation: owner, status: "preparing", diagnostic: null,
      inputDigest: this.store.putBlob(JSON.stringify({ format: "moguri-native-preparation-intent", version: owner.version === 1 ? 1 : owner.version === 4 ? 4 : 3,
        sessionId: session.id, ...(owner.version === 1 ? { turnId: owner.turnId } : { owner, draft }),
        previousExecutionId: last?.id ?? null, authorityDigest })) };
    this.host.commit([this.event(workspace)]);
    try {
      const policy = folderPolicy(this.host.settings(session.projectId).values);
      let source: ReturnType<typeof nativeWorkspaceDocument>["source"], sourceHead: string | null, workingSource: NativeSource;
      if (last) {
        const original = this.document(last);
        if (original.source?.root !== (project?.path ?? undefined) && !(original.source === null && project === null)) {
          throw new MoguriError("sandbox_workspace", "Retained native data has a different actual source root. No checkout or previous-root substitution.", 409);
        }
        source = original.source; sourceHead = original.sourceHead;
        workingSource = await this.restoreAfter(last, id, policy, signal);
      } else if (project) {
        source = parse(TreeSourceSchema, await captureNativeTree(project.path, policy, signal)); workingSource = source;
        sourceHead = (await optionalGitBinding(project.path, signal))?.head ?? null;
      } else {
        source = null; sourceHead = null;
        const empty = join(this.stateDir, "native-inputs", id); await mkdir(empty, { recursive: true, mode: 0o700 });
        workingSource = await captureNativeTree(await realpath(empty), { denied: [], readOnly: [] }, signal);
      }
      current();
      const input = parse(AutomaticInputSchema, { format: "moguri-native-workspace", version: 2, sessionId: session.id,
        source, workingSource, authorityDigest, sourceHead, previousExecutionId: last?.id ?? null });
      const parent = join(this.stateDir, "native-stage-root"); await mkdir(parent, { recursive: true, mode: 0o700 });
      const stage = await materializeNativeStage(await realpath(parent), { profileId: this.host.snapshot().profileId, sessionId: session.id, turnId: id }, workingSource, signal);
      current();
      const ready: SandboxWorkspace = { ...workspace, sourceHead, inputDigest: this.store.putBlob(JSON.stringify(input)), stage,
        status: "ready", revision: 1 };
      this.host.commit([this.event(ready), { event_type: "session.sandbox_bound", profile_id: this.host.snapshot().profileId,
        project_id: session.projectId, session_id: session.id, payload: { workspaceId: ready.id } }]);
      return { ...ready, stage };
    } catch (error) {
      this.host.commit([this.event({ ...workspace, status: "partial", revision: 1, diagnostic: signal.aborted ?
        "Automatic private preparation stopped before worker admission. Original source and retained private intent were preserved." :
        error instanceof MoguriError ? error.message : "Automatic private preparation failed. Source and partial owned files were retained; nothing was replayed." })]);
      throw error;
    }
  }
  private async restoreAfter(execution: import("../../../packages/protocol/src/index.ts").SandboxExecution, id: string, policy: FolderPolicy, signal: AbortSignal, exact = false) {
    const evidence = await readNativeCompletion({ stateRoot: join(homedir(), ".sendbox", "run"), sessionId: execution.nativeSessionId!,
      workspace: execution.stage.workspace, image: execution.image, command: { program: execution.command[0]!, arguments: execution.command.slice(1) },
      createdAfter: execution.createdAfter, createdBefore: execution.createdBefore, planDigest: execution.planDigest!, signerFingerprint: execution.signerFingerprint! });
    signal.throwIfAborted();
    if (execution.repositories) assertNativeGroupRestorePaths(execution.repositories,
      evidence.entries.filter((entry) => entry.kind.type !== "directory").map((entry) => entry.path));
    const root = join(this.stateDir, "native-inputs", id); await mkdir(root, { recursive: true, mode: 0o700 });
    const entries = evidence.entries.filter((entry) => entry.kind.type !== "directory" && !isProtectedProjectPath(entry.path) &&
      !matchesFolder(entry.path, policy.denied) && !ignoredPath(root, join(root, entry.path), false, []))
      .sort((a, b) => Number(b.path.endsWith(".gitignore")) - Number(a.path.endsWith(".gitignore")) || a.path.localeCompare(b.path));
    const ignores = new Map<string, import("./ignore-rules.ts").IgnoreScope>();
    let bytes = 0, files = 0;
    for (const entry of entries) {
      signal.throwIfAborted();
      if (await repositoryIgnored(root, entry.path, ignores)) {
        if (exact) throw new MoguriError("native_retry_snapshot", "The original private snapshot contains newly ignored work. No subset was silently discarded.", 409);
        continue;
      }
      if (!["regular", "hardlink"].includes(String(entry.kind.type))) throw new MoguriError("sandbox_workspace", "Retained native work contains an unsupported non-regular path. Inspect the original result; no data was silently discarded.", 409);
      const file = await evidence.read(entry.path, NATIVE_TREE_FILE_BYTES);
      if (++files > NATIVE_TREE_MAX_FILES || (bytes += file.content.length) > NATIVE_TREE_MAX_BYTES) throw new MoguriError("sandbox_workspace", "Complete retained native work exceeds the automatic snapshot boundary. No subset or fresh checkout was substituted.", 409);
      const target = join(root, entry.path); await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await scopedPath(root, entry.path, true); await writeFile(target, file.content, { flag: "wx", mode: 0o600 | (entry.mode & 0o100) });
      if (entry.path.endsWith(".gitignore")) ignores.clear();
    }
    const captured = await captureNativeTree(await realpath(root), policy, signal);
    if (exact && (captured.files.length !== entries.length || captured.files.some((file) => !entries.some((entry) => entry.path === file.path &&
      entry.kind.type === "regular" && entry.kind.content_hash === file.digest && entry.kind.size === file.bytes && (entry.mode & 0o100) === (file.mode & 0o100))))) {
      throw new MoguriError("native_retry_snapshot", "The complete original private snapshot bytes/modes changed during restaging. No root was bound or model was started.", 409);
    }
    return captured;
  }
  current(session: Session): SandboxWorkspace & { stage: NonNullable<SandboxWorkspace["stage"]> } {
    const workspace = (this.host.snapshot().sandboxWorkspaces ?? []).find((value) => value.id === session.sandboxWorkspaceId);
    if (!workspace?.stage || workspace.sessionId !== session.id || workspace.projectId !== session.projectId || workspace.sourceWorkspaceId !== session.workspaceId ||
      workspace.status !== "ready" || workspace.authorityDigest !== this.authority(session)) throw new MoguriError("sandbox_workspace", "Review and prepare this session's exact native workspace first. No source checkout or previous stage was substituted.", 409);
    if (session.repositories ? !this.sameGroup(session, workspace.repositories) : workspace.repositories !== undefined) {
      throw new MoguriError("sandbox_repository_scope", "The private workspace lost its exact original single/group scope. No root mapping was relabelled.", 409);
    }
    assertNativeWorkspaceIdentity(workspace.stage);
    return { ...workspace, stage: workspace.stage };
  }
  async assert(session: Session) {
    const workspace = this.current(session);
    await inspectNativeStage(workspace.stage);
    const current = this.current(this.session(session.id));
    if (current.id !== workspace.id || current.revision !== workspace.revision) throw new MoguriError("sandbox_workspace", "Native workspace changed during identity verification. No root fallback.", 409);
    if (JSON.stringify(nativeWorkspaceRepositories(this.document(current))) !== JSON.stringify(current.repositories)) {
      throw new MoguriError("sandbox_repository_history", "The private workspace map no longer matches its complete original input. No alternate guest directory or source was selected.", 409);
    }
    return current;
  }
  document(workspace: Pick<SandboxWorkspace, "inputDigest" | "stageBinding">) {
    const input = nativeWorkspaceDocument(this.store.blob(workspace.inputDigest));
    if (workspace.stageBinding && (input.version === 1 || JSON.stringify(input.stageBinding) !== JSON.stringify(workspace.stageBinding))) {
      throw new MoguriError("sandbox_stage_binding", "The exact retained checkpoint input changed its original stage binding. No request or source was replayed.", 409);
    }
    return input;
  }
  invalidate(id: string, diagnostic: string): EventInput[] {
    const workspace = (this.host.snapshot().sandboxWorkspaces ?? []).find((value) => value.id === id);
    return workspace?.status === "ready" ? [this.event({ ...workspace, status: "partial", revision: workspace.revision + 1, diagnostic })] : [];
  }
  recover(): EventInput[] {
    return (this.host.snapshot().sandboxWorkspaces ?? []).filter((value) => value.status === "preparing").map((value) =>
      this.event({ ...value, revision: value.revision + 1, status: "partial", diagnostic: "Controller restarted during native preparation. Original intent/private files are retained; no copy or model call was replayed." }));
  }
  cancel(sessionId: string): void { this.active.get(sessionId)?.abort.abort(); }
  async close(): Promise<void> {
    const active = [...this.active.values()]; for (const value of active) value.abort.abort();
    await Promise.allSettled(active.map((value) => value.task));
  }
}
