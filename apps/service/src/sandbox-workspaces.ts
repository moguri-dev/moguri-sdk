import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import {
  MoguriError, parse, type EventInput, type Project, type ProjectSettings, type SandboxCommand, type SandboxWorkspace,
  type SandboxWorkspacePreview, type Session, type Snapshot,
} from "../../../packages/protocol/src/index.ts";
import { captureNativeSource, materializeNativeStage, inspectNativeStage, assertNativeWorkspaceIdentity, type NativeSource } from "./native-staging.ts";
import { optionalGitBinding } from "./project-git.ts";
import { folderPolicy } from "./project-policy.ts";
import { digest, type EventStore } from "./store.ts";
import { frameDigest } from "./worker-wire.ts";
import type { SandboxRuntime } from "./sandbox-runtime.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";

const hash = Type.String({ pattern: "^[a-f0-9]{64}$" }), path = Type.String({ minLength: 1, maxLength: 4096 });
const identity = Type.Object({ device: Type.String(), inode: Type.String() }, { additionalProperties: false });
const SourceSchema = Type.Object({
  root: path, identity, files: Type.Array(Type.Object({
    path, text: Type.String({ maxLength: 128 * 1024 }), digest: hash, bytes: Type.Integer({ minimum: 0, maximum: 128 * 1024 }),
    mode: Type.Integer({ minimum: 0, maximum: 0o777 }),
  }, { additionalProperties: false }), { maxItems: 200 }), digest: hash,
  policy: Type.Object({ denied: Type.Array(path), readOnly: Type.Array(path) }, { additionalProperties: false }),
}, { additionalProperties: false });
const InputSchema = Type.Object({
  format: Type.Literal("moguri-native-workspace"), version: Type.Literal(1), sessionId: Type.String(),
  source: Type.Union([SourceSchema, Type.Null()]), authorityDigest: hash, sourceHead: Type.Union([Type.String(), Type.Null()]),
}, { additionalProperties: false });
interface Host {
  snapshot(): Snapshot; project(session: Session): Project;
  settings(projectId: string | null): { revision: number; values: ProjectSettings };
  commit(events: EventInput[]): void; closing(session: Session): boolean;
}
export function nativeWorkspaceDocument(text: string) { return parse(InputSchema, JSON.parse(text)); }
export class SandboxWorkspaces {
  private active = new Map<string, { abort: AbortController; task: Promise<unknown> }>();
  constructor(private readonly store: EventStore, private readonly stateDir: string, private readonly native: SandboxRuntime, private readonly host: Host) {}
  private session(id: string): Session {
    const session = this.host.snapshot().sessions.find((value) => value.id === id);
    if (!session || session.status === "archived") throw new MoguriError("sandbox_session", "Select an existing unarchived session in this exact profile.", 409);
    return session;
  }
  private authority(session: Session): string {
    const snapshot = this.host.snapshot(), settings = this.host.settings(session.projectId);
    if (session.controls.env !== "Sandbox" || !snapshot.policy.allowedEnvs.includes("Sandbox") || this.host.closing(session)) throw new MoguriError("sandbox_scope", "Explicitly select an allowed Sandbox environment and an existing owned source scope. No Local or previous-root fallback.", 409);
    const project = session.projectId ? this.host.project(session) : null;
    return frameDigest({ profileId: snapshot.profileId, sessionId: session.id, projectId: session.projectId, workspaceId: session.workspaceId,
      root: project?.path ?? null, policyRevision: snapshot.policy.revision,
      permissionRevision: snapshot.settings.permissionRevision, projectRevision: settings.revision, folders: folderPolicy(settings.values),
      native: this.native.assertReady() });
  }
  async preview(sessionId: string, paths: string[], signal: AbortSignal = AbortSignal.timeout(15_000)) {
    const session = this.session(sessionId), authorityDigest = this.authority(session), config = this.native.assertReady();
    if (session.turnId || this.active.has(session.id)) throw new MoguriError("sandbox_busy", "Stop/wait for the current owned turn or staging preparation before reviewing a new root.", 409);
    if (!session.projectId && paths.length) throw new MoguriError("project_required", "Project-free Sandbox chats have an empty private workspace. No host root was inferred.", 409);
    const selected = [...paths].sort(), project = session.projectId ? this.host.project(session) : null, policy = folderPolicy(this.host.settings(session.projectId).values);
    const source: NativeSource | null = project ? await captureNativeSource(project.path, selected, policy, signal) : null;
    const sourceHead = project ? (await optionalGitBinding(project.path, signal))?.head ?? null : null;
    if (this.authority(this.session(sessionId)) !== authorityDigest || this.session(sessionId).sandboxWorkspaceId !== session.sandboxWorkspaceId) throw new MoguriError("sandbox_stale", "Source/policy/binding changed during native source review. No staged root or model call was created.", 409);
    const input = { format: "moguri-native-workspace" as const, version: 1 as const, sessionId, source, authorityDigest, sourceHead };
    parse(InputSchema, input);
    const text = JSON.stringify(input), before = (this.host.snapshot().sandboxWorkspaces ?? []).filter((value) => value.sessionId === sessionId).map(({ id, revision, status }) => ({ id, revision, status }));
    const preview: SandboxWorkspacePreview = { digest: digest(`moguri-native-workspace-v1\0${text}\0${JSON.stringify(before)}`), sessionId, sourceRoot: project?.path ?? null,
      paths: selected, bytes: source?.files.reduce((total, file) => total + file.bytes, 0) ?? 0, sourceHead, configDigest: frameDigest(config),
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
  current(session: Session): SandboxWorkspace & { stage: NonNullable<SandboxWorkspace["stage"]> } {
    const workspace = (this.host.snapshot().sandboxWorkspaces ?? []).find((value) => value.id === session.sandboxWorkspaceId);
    if (!workspace?.stage || workspace.sessionId !== session.id || workspace.projectId !== session.projectId || workspace.sourceWorkspaceId !== session.workspaceId ||
      workspace.status !== "ready" || workspace.authorityDigest !== this.authority(session)) throw new MoguriError("sandbox_workspace", "Review and prepare this session's exact native workspace first. No source checkout or previous stage was substituted.", 409);
    assertNativeWorkspaceIdentity(workspace.stage);
    return { ...workspace, stage: workspace.stage };
  }
  async assert(session: Session) {
    const workspace = this.current(session);
    await inspectNativeStage(workspace.stage);
    const current = this.current(this.session(session.id));
    if (current.id !== workspace.id || current.revision !== workspace.revision) throw new MoguriError("sandbox_workspace", "Native workspace changed during identity verification. No root fallback.", 409);
    return current;
  }
  document(workspace: Pick<SandboxWorkspace, "inputDigest">) {
    return nativeWorkspaceDocument(this.store.blob(workspace.inputDigest));
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
