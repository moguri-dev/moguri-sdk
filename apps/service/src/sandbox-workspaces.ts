import { randomUUID } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { Type, type Static } from "typebox";
import {
  MoguriError, parse, SessionRepositorySchema, sandboxRepositories, type EventInput, type Project, type ProjectSettings, type SandboxCommand, type SandboxWorkspace,
  type SandboxRepository, type SandboxWorkspacePreview, type Session, type Snapshot,
} from "../../../packages/protocol/src/index.ts";
import { captureNativeSource, captureNativeTree, materializeNativeStage, inspectNativeStage, assertNativeWorkspaceIdentity,
  NATIVE_TREE_MAX_FILES, NATIVE_TREE_MAX_BYTES, NATIVE_TREE_FILE_BYTES, type NativeSource } from "./native-staging.ts";
import { materializeNativeGroup, nativeCompositeDigest, nativeRepositoryDirectory } from "./native-staging.ts";
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
}, { additionalProperties: false });
const GroupInputSchema = Type.Object({
  format: Type.Literal("moguri-native-workspace"), version: Type.Literal(3), sessionId: Type.String(),
  source: Type.Null(), sourceHead: Type.Null(), authorityDigest: hash, previousExecutionId: Type.Union([Type.String(), Type.Null()]),
  repositories: Type.Array(Type.Object({ binding: SessionRepositorySchema, directory: path, source: TreeSourceSchema,
    workingSource: TreeSourceSchema, sourceHead: Type.Union([Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }), Type.Null()]) },
  { additionalProperties: false }), { minItems: 1, maxItems: 1000 }),
}, { additionalProperties: false });
const InputSchema = Type.Union([ReviewedInputSchema, AutomaticInputSchema, GroupInputSchema]);
type StaticGroupRepository = Static<typeof GroupInputSchema>["repositories"][number];
interface Host {
  snapshot(): Pick<Snapshot, "profileId" | "sessions" | "settings" | "policy" | "sandboxWorkspaces" | "sandboxExecutions">; project(session: Session, repository?: string): Project;
  settings(projectId: string | null): { revision: number; values: ProjectSettings };
  commit(events: EventInput[]): void; closing(session: Session): boolean;
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
  private active = new Map<string, { abort: AbortController; task: Promise<unknown> }>();
  constructor(private readonly store: EventStore, private readonly stateDir: string, private readonly native: Pick<SandboxRuntime, "assertReady">, private readonly host: Host) {}
  get busy(): boolean { return this.active.size > 0; }
  owns(sessionId: string): boolean { return this.active.has(sessionId); }
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
    if (!this.automatic()) {
      if (session.repositories) throw new MoguriError("sandbox_group_setup", "Enable reviewed managed automatic workspaces for this captured group. No first-root or empty stage was used.", 409);
      return this.assert(session);
    }
    if (this.active.has(sessionId)) throw new MoguriError("sandbox_busy", "This session already owns native workspace preparation.", 409);
    const abort = new AbortController(), signal = AbortSignal.any([requested, abort.signal]);
    const task = (session.repositories ? this.prepareGroupOnce(session, turnId, signal) : this.prepareAutomaticOnce(session, turnId, signal)).finally(() => this.active.delete(sessionId));
    this.active.set(sessionId, { abort, task });
    return task;
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
  private async prepareGroupOnce(session: Session, turnId: string, signal: AbortSignal) {
    const authorityDigest = this.authority(session), config = this.native.assertReady(), bindings = this.groupBindings(session);
    const current = () => {
      signal.throwIfAborted();
      const actual = this.session(session.id);
      if (actual.turnId !== turnId || !this.automatic() || this.authority(actual) !== authorityDigest || !this.sameGroup(actual, bindings)) {
        throw new MoguriError("sandbox_stale", "The captured group, actual source/policy or owned turn changed before native admission. No first-root or Local fallback.", 409);
      }
      return actual;
    };
    current();
    const previous = (this.host.snapshot().sandboxWorkspaces ?? []).find((workspace) => workspace.id === session.sandboxWorkspaceId);
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
    const id = randomUUID(), workspace: SandboxWorkspace = { id, sessionId: session.id, projectId: null, sourceWorkspaceId: null,
      sourceRoot: null, sourceHead: null, repositories: bindings, stage: null, authorityDigest, configDigest: frameDigest(config),
      revision: 0, createdAt: new Date().toISOString(), commandId: turnId,
      commandDigest: frameDigest(["moguri-native-group-automatic-v1", this.host.snapshot().profileId, session.id, turnId, authorityDigest]),
      preparation: { version: 1, kind: "automatic", turnId }, status: "preparing", diagnostic: null,
      inputDigest: this.store.putBlob(JSON.stringify({ format: "moguri-native-preparation-intent", version: 2, sessionId: session.id, turnId,
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
  private async prepareAutomaticOnce(session: Session, turnId: string, signal: AbortSignal) {
    const authorityDigest = this.authority(session), config = this.native.assertReady();
    const current = () => {
      signal.throwIfAborted();
      const actual = this.session(session.id);
      if (actual.turnId !== turnId || !this.automatic() || this.authority(actual) !== authorityDigest) {
        throw new MoguriError("sandbox_stale", "Owning turn, workspace or policy changed during automatic preparation. No worker or model was admitted.", 409);
      }
      return actual;
    };
    current();
    const previous = (this.host.snapshot().sandboxWorkspaces ?? []).find((value) => value.id === session.sandboxWorkspaceId);
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
    const id = randomUUID(), preparation = { version: 1 as const, kind: "automatic" as const, turnId };
    const workspace: SandboxWorkspace = { id, sessionId: session.id, projectId: session.projectId, sourceWorkspaceId: session.workspaceId,
      sourceRoot: project?.path ?? null, sourceHead: null, stage: null, authorityDigest, configDigest: frameDigest(config),
      revision: 0, createdAt: new Date().toISOString(), commandId: turnId,
      commandDigest: frameDigest(["moguri-native-automatic-v1", this.host.snapshot().profileId, session.id, turnId, authorityDigest]),
      preparation, status: "preparing", diagnostic: null,
      inputDigest: this.store.putBlob(JSON.stringify({ format: "moguri-native-preparation-intent", version: 1, sessionId: session.id, turnId,
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
  private async restoreAfter(execution: import("../../../packages/protocol/src/index.ts").SandboxExecution, id: string, policy: FolderPolicy, signal: AbortSignal) {
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
      if (await repositoryIgnored(root, entry.path, ignores)) continue;
      if (!["regular", "hardlink"].includes(String(entry.kind.type))) throw new MoguriError("sandbox_workspace", "Retained native work contains an unsupported non-regular path. Inspect the original result; no data was silently discarded.", 409);
      const file = await evidence.read(entry.path, NATIVE_TREE_FILE_BYTES);
      if (++files > NATIVE_TREE_MAX_FILES || (bytes += file.content.length) > NATIVE_TREE_MAX_BYTES) throw new MoguriError("sandbox_workspace", "Complete retained native work exceeds the automatic snapshot boundary. No subset or fresh checkout was substituted.", 409);
      const target = join(root, entry.path); await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await scopedPath(root, entry.path, true); await writeFile(target, file.content, { flag: "wx", mode: 0o600 | (entry.mode & 0o100) });
      if (entry.path.endsWith(".gitignore")) ignores.clear();
    }
    return captureNativeTree(await realpath(root), policy, signal);
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
  document(workspace: Pick<SandboxWorkspace, "inputDigest">) {
    return nativeWorkspaceDocument(this.store.blob(workspace.inputDigest));
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
