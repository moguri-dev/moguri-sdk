import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import {
  isRecord, MoguriError, sameCandidateRoot, type CandidateRoot, type EventInput, type Session, type Snapshot, type StoredEvent,
} from "../../../packages/protocol/src/index.ts";
import {
  projectCandidateWorkspace, type CandidateWorkspace, type CandidateWorkspaceCommand, type CandidateWorkspacePreview,
  type CandidateWorkspaceQuery, type CandidateWorkspaceResponse,
} from "../../../packages/protocol/src/candidate-workspaces.ts";
import { candidateTransportHistory, CandidateTransports, type CandidateBinding, type CandidateTransportHost } from "./candidate-transports.ts";
import type { CandidateTransportRecord } from "../../../packages/protocol/src/candidate-workspaces.ts";
import { digest, type EventStore } from "./store.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import { remoteRootLease } from "./remote.ts";
import { frameDigest } from "./worker-wire.ts";
import type { CandidateContext } from "./candidates.ts";

type Files = Array<{ path: string; baseDigest: string; text: string | null }>;
interface Host extends CandidateTransportHost {
  snapshot(): Snapshot;
  configuration(projectId: string): { revision: number };
  session(id: string): Session;
  rootBusy(root: string, exceptJobId?: string, ownerSessionId?: string): boolean;
}
export interface CandidateEnvContext extends CandidateContext { binding: CandidateBinding; files: Files; stageFiles: Files }
export function candidateWorkspaceHistory(events: StoredEvent[]): CandidateWorkspace[] {
  const records = new Map<string, CandidateWorkspace>();
  for (const event of events) projectWorkspaceEvent(records, event);
  return [...records.values()];
}
function projectWorkspaceEvent(records: Map<string, CandidateWorkspace>, event: StoredEvent): void {
  if (event.event_type === "candidate.workspace_recorded") {
    const workspace = event.payload.workspace;
    if (workspace.profileId !== event.profile_id || workspace.projectId !== event.project_id || event.session_id != null || event.artifact_id != null) {
      throw new MoguriError("candidate_workspace_corrupt", "Independent workspace history changed its exact profile/project or acquired session/artifact retention.", 409);
    }
    records.set(workspace.id, projectCandidateWorkspace(records.get(workspace.id), workspace));
  }
}
export function candidateEnvPathLease(boundary: CandidateBinding["scope"]["boundary"], root: string, transports: CandidateTransportRecord[]): string {
  const invalid = (): never => { throw new MoguriError("candidate_ownership", "The original retained peer/private launch boundary is unavailable or changed. No writer root or Local mapping was guessed.", 409); };
  const transport = transports.find((record) => JSON.stringify(record.boundary) === JSON.stringify(boundary));
  if (!transport || !isAbsolute(root) || root.includes("\0")) return invalid();
  let launch: unknown;
  try { launch = JSON.parse(transport.launchJson); } catch { return invalid(); }
  if (!isRecord(launch) || !isRecord(launch.execution)) return invalid();
  const execution = launch.execution;
  if (execution.workerDigest !== boundary.workerDigest || execution.projectId !== transport.projectId || execution.sessionId !== transport.sessionId) return invalid();
  if (boundary.env === "Remote") {
    if (!isRecord(execution.target) || typeof execution.target.hostKey !== "string" ||
      frameDigest({ hostKey: execution.target.hostKey }) !== boundary.peerDigest || execution.workspace !== boundary.sourceRoot ||
      execution.configDigest !== boundary.configurationDigest) return invalid();
    return remoteRootLease({ hostKey: execution.target.hostKey }, root)!;
  }
  if (!isRecord(execution.stage) || typeof execution.stage.workspace !== "string" || !isAbsolute(execution.stage.workspace) ||
    execution.stage.profileId !== transport.profileId || execution.workspaceId !== boundary.workspaceId || execution.inputDigest !== boundary.inputDigest ||
    execution.root !== boundary.sourceRoot || root !== "/workspace" && !root.startsWith("/workspace/") ||
    root.split("/").some((part) => part === "." || part === "..")) return invalid();
  return root === "/workspace" ? execution.stage.workspace : join(execution.stage.workspace, root.slice("/workspace/".length));
}
export function candidateEnvWriteRoots(events: StoredEvent[], state: Pick<Snapshot, "candidates" | "jobs" | "blockedProjects" | "blockedWorkspaces">, exceptJobId?: string,
  projected?: { workspaces: CandidateWorkspace[]; transports: CandidateTransportRecord[] }): string[] {
  const workspaces = projected?.workspaces ?? candidateWorkspaceHistory(events), transports = projected?.transports ?? candidateTransportHistory(events), roots: string[] = [];
  const lease = (root: CandidateRoot) => root.env === "Local" ? root.root : candidateEnvPathLease(root.boundary, root.root, transports);
  const blocked = (projectId: string, workspaceId: string | null) => workspaceId ? state.blockedWorkspaces.includes(workspaceId) : state.blockedProjects.includes(projectId);
  for (const workspace of workspaces) {
    const unsettled = workspace.status === "creating" || workspace.status === "partial" && !transports.find((record) => record.id === workspace.operationId)?.cleanupConfirmed;
    if (unsettled || blocked(workspace.projectId, workspace.source.workspaceId)) roots.push(lease(workspace.source));
    if (unsettled || state.blockedWorkspaces.includes(workspace.id)) roots.push(candidateEnvPathLease(workspace.boundary, workspace.plannedRoot, transports));
  }
  for (const candidate of state.candidates) if (candidate.source.env !== "Local") {
    const active = state.jobs.some((job) => job.id !== exceptJobId && job.candidate?.candidateId === candidate.id && ["running", "waiting_input"].includes(job.status));
    if (active || blocked(candidate.projectId, candidate.source.workspaceId)) roots.push(lease(candidate.source));
    if (active || blocked(candidate.projectId, candidate.stage.workspaceId)) roots.push(lease(candidate.stage));
  }
  for (const record of transports) if (record.ownerKind === "candidate" && !record.cleanupConfirmed && record.id !== exceptJobId) {
    const candidate = state.candidates.find((candidate) => candidate.id === record.ownerId);
    if (!candidate) throw new MoguriError("candidate_ownership", "An unsettled original candidate lost its retained roots. No root release or alternate mapping was inferred.", 409);
    roots.push(lease(candidate.source), lease(candidate.stage));
  }
  return roots;
}
export function candidateTransportUnsettled(events: StoredEvent[], candidateIds: readonly string[]): boolean {
  return candidateTransportHistory(events).some((record) => record.ownerKind === "candidate" && candidateIds.includes(record.ownerId) && !record.cleanupConfirmed);
}
export class CandidateEnvs {
  readonly transports: CandidateTransports;
  private readonly creating = new Map<string, { abort: AbortController; done: Promise<unknown> }>();
  private history: StoredEvent[] = [];
  private readonly projected = new Map<string, CandidateWorkspace>();
  constructor(store: EventStore, private readonly host: Host) { this.transports = new CandidateTransports(store, host); }
  workspaces(): CandidateWorkspace[] {
    const events = this.host.events(), length = this.history.length;
    const appended = length <= events.length && (!length || events[length - 1]?.id === this.history[length - 1]?.id && events[0]?.id === this.history[0]?.id);
    if (!appended) this.projected.clear();
    for (const event of events.slice(appended ? length : 0)) projectWorkspaceEvent(this.projected, event);
    this.history = events.slice(); return [...this.projected.values()];
  }
  private event(workspace: CandidateWorkspace): EventInput {
    return { event_type: "candidate.workspace_recorded", profile_id: workspace.profileId, project_id: workspace.projectId, payload: { workspace } };
  }
  private authority(session: Session, binding: CandidateBinding): string {
    const snapshot = this.host.snapshot();
    return digest(JSON.stringify({ profileId: snapshot.profileId, sessionId: session.id, projectId: session.projectId, workspaceId: session.workspaceId,
      env: session.controls.env, mode: session.mode, pendingMode: session.pendingMode ?? null, boundary: binding.scope.boundary,
      folders: binding.scope.folders, policyRevision: snapshot.policy.revision, permissionRevision: snapshot.settings.permissionRevision,
      configurationRevision: this.host.configuration(session.projectId!).revision }));
  }
  private current(sessionId: string, binding: CandidateBinding, authorityDigest: string) {
    binding.current();
    if (this.authority(this.host.session(sessionId), binding) !== authorityDigest) throw new MoguriError("candidate_stale", "The original session, mode, Env, permission or source configuration changed. Review again; no fallback.", 409);
  }
  async source(sessionId: string, paths: string[], signal: AbortSignal) {
    const session = this.host.session(sessionId), binding = await this.transports.binding(session), authorityDigest = this.authority(session, binding);
    this.current(sessionId, binding, authorityDigest);
    const result = await this.transports.execute(binding, { kind: "read", id: randomUUID(), authorityDigest }, { action: "source", paths }, signal);
    this.current(sessionId, binding, authorityDigest);
    if (result.type !== "source" || result.source.env === "Local" || result.source.env !== binding.scope.env ||
      result.source.root !== binding.scope.boundary.sourceRoot || result.source.projectId !== binding.scope.projectId ||
      result.source.workspaceId !== binding.scope.sourceWorkspaceId || JSON.stringify(result.source.boundary) !== JSON.stringify(binding.scope.boundary)) {
      throw new MoguriError("candidate_transport", "Source read returned a different actual Env, original source, peer/build or operation type.", 409);
    }
    return { source: result.source, files: result.files, binding, authorityDigest };
  }
  async preview(sessionId: string, name: string, signal = AbortSignal.timeout(90_000)): Promise<CandidateWorkspacePreview> {
    const captured = await this.source(sessionId, [], signal), session = this.host.session(sessionId);
    const body = { source: captured.source, name, stageParent: join(captured.binding.scope.stateRoot, "candidate-workspaces", captured.binding.scope.profileId), authorityDigest: captured.authorityDigest };
    const root = this.rootLease(captured.source);
    if (this.host.rootBusy(root, undefined, sessionId)) throw new MoguriError("workspace_busy", "An original writer or unconfirmed operation owns this exact peer/private source. No candidate workspace was created.", 409);
    return { ...body, digest: digest(`moguri-candidate-workspace-v1\0${JSON.stringify(body)}`),
      diagnostic: session.controls.env === "Remote" ? "Creates one private detached Git worktree only under Moguri-owned state on this exact pinned SSH peer. No branch, reset, commit, push or source acceptance." :
        "Copies the complete bounded approved private native snapshot inside the actual guest. This is not a Git checkout or the live Local repository. Source application and native-to-Local publication remain separate reviews." };
  }
  async query(query: CandidateWorkspaceQuery): Promise<CandidateWorkspaceResponse> {
    if (query.type === "candidate.transports") {
      const transports = this.transports.records().filter((record) => (!query.sessionId || record.sessionId === query.sessionId) && (!query.ownerId || record.ownerId === query.ownerId)).reverse();
      return { type: query.type, transports: transports.slice(0, 100), total: transports.length };
    }
    if (query.type === "candidate.transport.read") return { type: query.type, transport: this.transports.record(query.transportId) };
    if (query.type === "candidate.workspace.read") {
      const workspace = this.workspaces().find((workspace) => workspace.id === query.workspaceId);
      if (!workspace) throw new MoguriError("candidate_workspace_missing", "The exact retained independent workspace is unavailable in this profile.", 404);
      return { type: query.type, workspace };
    }
    if (query.type === "candidate.source") {
      const { source, files } = await this.source(query.sessionId, query.paths, AbortSignal.timeout(90_000));
      return { type: query.type, source, files };
    }
    if (query.type === "candidate.workspace.preview") return { type: query.type, preview: await this.preview(query.sessionId, query.name) };
    const session = this.host.session(query.sessionId), binding = await this.transports.binding(session);
    return { type: query.type, workspaces: this.workspaces().filter((workspace) => workspace.projectId === session.projectId &&
      workspace.profileId === this.host.snapshot().profileId && JSON.stringify(workspace.boundary) === JSON.stringify(binding.scope.boundary)) };
  }
  async execute(command: CandidateWorkspaceCommand, finish: WorkspaceFinish) {
    if (command.type === "candidate.transport.reconcile") return this.transports.reconcile(command.transportId, command.expectedRevision, finish);
    if (command.type === "candidate.workspace.stop") {
      const workspace = this.workspaces().find((workspace) => workspace.id === command.workspaceId);
      if (!workspace) throw new MoguriError("candidate_workspace_missing", "Original workspace is unavailable in this profile.", 404);
      try {
        return finish(workspace.status !== "creating" || workspace.stopRequested ? [] :
          [this.event({ ...workspace, stopRequested: true, revision: workspace.revision + 1, updatedAt: new Date().toISOString() })], { id: workspace.id });
      } finally { this.creating.get(workspace.id)?.abort.abort(); this.transports.stopOwner(workspace.id); }
    }
    const intent = finish.intent;
    if (!intent) throw new MoguriError("candidate_intent", "Explicit workspace creation requires canonical actual-user command identity before effects.", 409);
    const previous = this.workspaces().find((workspace) => workspace.commandId === intent.id);
    if (previous) {
      if (previous.commandDigest !== intent.digest) throw new MoguriError("idempotency_conflict", "This original workspace command changed. No resource was recreated.", 409);
      return finish([], { id: previous.id });
    }
    const preview = await this.preview(command.sessionId, command.name);
    if (preview.digest !== command.expectedDigest) throw new MoguriError("candidate_workspace_review", "The exact reviewed source/base/peer/build or policy changed. No workspace was created.", 409);
    const session = this.host.session(command.sessionId), binding = await this.transports.binding(session), now = new Date().toISOString(), id = randomUUID();
    this.current(session.id, binding, preview.authorityDigest);
    if (this.host.rootBusy(this.rootLease(preview.source), undefined, session.id)) throw new MoguriError("workspace_busy", "Another caller acquired the exact original peer/private source after review. No second workspace creation was admitted.", 409);
    const workspace: CandidateWorkspace = { version: 1, id, profileId: this.host.snapshot().profileId, projectId: session.projectId!,
      originSessionId: session.id, name: preview.name, boundary: binding.scope.boundary, source: preview.source, stage: null,
      plannedRoot: join(preview.stageParent, id, "workspace"),
      commandId: intent.id, commandDigest: intent.digest, operationId: randomUUID(), authorityDigest: preview.authorityDigest,
      revision: 0, createdAt: now, updatedAt: now, status: "creating", stopRequested: false, diagnostic: null };
    const result = finish([this.event(projectCandidateWorkspace(undefined, workspace))], { id });
    const abort = new AbortController();
    const done = Promise.resolve().then(async () => {
      const value = await this.transports.execute(binding, { kind: "workspace", id, authorityDigest: preview.authorityDigest, operationId: workspace.operationId },
        { action: "create", workspaceId: id, source: preview.source }, abort.signal,
        async () => { this.current(session.id, binding, preview.authorityDigest); abort.signal.throwIfAborted(); });
      this.current(session.id, binding, preview.authorityDigest); abort.signal.throwIfAborted();
      if (value.type !== "created" || !sameCandidateRoot(value.source, preview.source) || value.stage.workspaceId !== id ||
        value.stage.root !== join(binding.scope.stateRoot, "candidate-workspaces", binding.scope.profileId, id, "workspace")) {
        throw new MoguriError("candidate_workspace_receipt", "Original peer/private workspace receipt changed source, stage or identity. No arbitrary path was adopted.", 409);
      }
      const actual = this.workspaces().find((value) => value.id === id)!;
      this.host.commit([this.event(projectCandidateWorkspace(actual, { ...actual, revision: actual.revision + 1, updatedAt: new Date().toISOString(), stage: value.stage, status: "ready" }))]);
    }).catch((error: unknown) => {
      const actual = this.workspaces().find((value) => value.id === id)!;
      this.host.commit([this.event(projectCandidateWorkspace(actual, { ...actual, revision: actual.revision + 1, updatedAt: new Date().toISOString(),
        status: "partial", diagnostic: error instanceof MoguriError ? error.message : "Original owned workspace creation is unconfirmed. Preserve it; no resource, branch or source was replayed/deleted." }))]);
    }).finally(() => this.creating.delete(id));
    this.creating.set(id, { abort, done }); return result;
  }
  async context(session: Session, workspaceId: string, paths: string[], signal: AbortSignal, clean: boolean, exceptJobId?: string): Promise<CandidateEnvContext> {
    const workspace = this.workspaces().find((workspace) => workspace.id === workspaceId && workspace.profileId === this.host.snapshot().profileId);
    if (!workspace?.stage || workspace.status !== "ready" || workspace.projectId !== session.projectId) throw new MoguriError("candidate_workspace_required", "Explicitly create/review a ready owned staging resource on this actual Env. A Local worktree or guessed peer path cannot substitute.", 409);
    const source = workspace.source, stage = workspace.stage;
    const binding = await this.transports.binding(session), authority = this.authority(session, binding);
    if (JSON.stringify(binding.scope.boundary) !== JSON.stringify(workspace.boundary) || workspace.source.workspaceId !== session.workspaceId) throw new MoguriError("candidate_root", "Original source/peer/build or private snapshot binding changed. No root transfer or compatible alias was inferred.", 409);
    const authorityDigest = digest(JSON.stringify({ authority, source, stage }));
    let captured: { files: Files; stageFiles: Files } | undefined;
    const current = () => {
      signal.throwIfAborted(); this.current(session.id, binding, authority);
      const state = this.host.snapshot();
      if ([source, stage].some((root) => root.workspaceId ? state.blockedWorkspaces.includes(root.workspaceId) : state.blockedProjects.includes(root.projectId))) {
        throw new MoguriError("workspace_busy", "The exact original source/stage is quarantined after partial work. Inspect and explicitly resume its existing scope; no new candidate or replay.", 409);
      }
      for (const root of [source, stage]) if (this.host.rootBusy(this.rootLease(root), exceptJobId, session.id)) throw new MoguriError("workspace_busy", "Both exact candidate/source roots must be free of other writers, consoles and unconfirmed operations.", 409);
    };
    const inspect = async () => {
      current();
      const value = await this.transports.execute(binding, { kind: "read", id: randomUUID(), authorityDigest },
        { action: "inspect", source, stage, paths, clean }, signal);
      current();
      if (value.type !== "inspected" || !sameCandidateRoot(value.source, source) || !sameCandidateRoot(value.stage, stage)) throw new MoguriError("candidate_root", "Exact source/stage inspection returned different ownership. No fallback.", 409);
      if (captured && (JSON.stringify(value.files) !== JSON.stringify(captured.files) || JSON.stringify(value.stageFiles) !== JSON.stringify(captured.stageFiles))) {
        throw new MoguriError("candidate_conflict", "Original source/staging snapshots changed during the complete review. No mixed file set or stale bytes were substituted.", 409);
      }
      return value;
    };
    const value = await inspect();
    captured = value;
    return { session, binding, source, stage, authorityDigest, files: value.files, stageFiles: value.stageFiles,
      env: { binding, files: value.files, stageFiles: value.stageFiles },
      current, assert: async () => { await inspect(); } };
  }
  rootLease(root: CandidateRoot): string {
    if (root.env === "Local") return root.root;
    return this.pathLease(root.boundary, root.root);
  }
  private pathLease(boundary: CandidateBinding["scope"]["boundary"], root: string): string {
    return candidateEnvPathLease(boundary, root, this.transports.records());
  }
  writeRoots(exceptJobId?: string): string[] {
    return candidateEnvWriteRoots(this.host.events(), this.host.snapshot(), exceptJobId, { workspaces: this.workspaces(), transports: this.transports.records() });
  }
  stopSession(id: string): void {
    const owned = this.workspaces().filter((workspace) => workspace.originSessionId === id && workspace.status === "creating");
    try {
      const events = owned.filter((workspace) => !workspace.stopRequested).map((workspace) => this.event(projectCandidateWorkspace(workspace,
        { ...workspace, stopRequested: true, revision: workspace.revision + 1, updatedAt: new Date().toISOString() })));
      if (events.length) this.host.commit(events);
    } catch { console.error("Workspace stop intent retention failed; original workers are still cancelled without claiming a durable stop acknowledgement."); }
    finally {
      for (const workspace of owned) this.creating.get(workspace.id)?.abort.abort();
      this.transports.stopSession(id);
    }
  }
  async settleSession(id: string): Promise<void> {
    this.stopSession(id);
    const owned = this.workspaces().filter((workspace) => workspace.originSessionId === id && workspace.status === "creating");
    await Promise.all(owned.map((workspace) => this.creating.get(workspace.id)?.done));
    await this.transports.settleSession(id);
  }
  async close(): Promise<void> {
    const sessions = new Set([...this.workspaces().filter((workspace) => workspace.status === "creating").map((workspace) => workspace.originSessionId),
      ...this.transports.records().filter((record) => record.status === "running").map((record) => record.sessionId),
      ...this.transports.activeSessionIds()]);
    await Promise.all([...sessions].map((id) => this.settleSession(id)));
  }
  recover(): EventInput[] {
    return [...this.transports.recover(), ...this.workspaces().filter((workspace) => workspace.status === "creating").map((workspace) =>
      this.event(projectCandidateWorkspace(workspace, { ...workspace, revision: workspace.revision + 1, updatedAt: new Date().toISOString(), status: "partial",
        diagnostic: "Service restarted during explicit owned workspace creation. Original private/Git resource is retained independently; no effects were replayed or resources deleted." })))];
  }
}
