import { randomUUID } from "node:crypto";
import {
  candidateDeletionPending, defaultBoard, defaultProjectConfiguration, sameCandidatePr, sameCandidateRoot, sameSessionPrScope, MoguriError,
  type CandidateCleanup, type CandidateOwner, type CandidateRoot, type EventInput, type SessionPrScope, type Snapshot, type StoredEvent,
} from "../../../packages/protocol/src/index.ts";
import type { ForgetRequest } from "./store.ts";
import type { ArtifactRuntime } from "./artifacts.ts";
import type { ManagedWorkspaces } from "./managed-workspaces.ts";
import { ProjectIntegrations, pullRequestLink } from "./project-integrations.ts";
import { sourceRoot } from "./repository-source.ts";
import { readGitBinding } from "./project-git.ts";

interface Host {
  snapshot(): Snapshot;
  events(): StoredEvent[];
  commit(events: EventInput[], forget?: ForgetRequest): void;
  artifacts: ArtifactRuntime;
  managed: ManagedWorkspaces;
  integrations: ProjectIntegrations;
  sessionBusy(id: string): boolean;
  settle(ids: string[]): Promise<void>;
  deleteSession(id: string): Promise<void>;
}
export async function settleCandidateCleanup(work: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new MoguriError("candidate_cleanup_pending", "Exact owned work has not settled. Candidate records and grants remain pending cleanup.", 409)), 6500);
    })]);
  } finally { clearTimeout(timer); }
}
export class CandidateCleanupRuntime {
  private timer?: ReturnType<typeof setInterval>;
  private readonly abort = new AbortController();
  private readonly attempted = new Map<string, number>();
  private refreshing?: Promise<void>;
  private queued = false;
  private queuedForce = false;
  private refreshAgain = false;
  private started = false;
  constructor(private readonly host: Host, private readonly interval = 60_000) {}
  start(): void {
    if (this.started || this.abort.signal.aborted) return;
    this.started = true;
    this.timer = setInterval(() => this.changed(), this.interval); this.timer.unref();
    this.changed();
  }
  changed(events?: StoredEvent[]): void {
    if (!this.started || this.abort.signal.aborted) return;
    const fresh = (at: string | null | undefined) => {
      const age = at ? Date.now() - Date.parse(at) : NaN;
      return Number.isFinite(age) && age >= 0 && age <= 20_000;
    };
    const merged = events?.some((event) => event.event_type === "session.pr_observed" ?
      event.payload.observation.pullRequest.state === "merged" && !event.payload.observation.pullRequest.diagnostic && fresh(event.payload.observation.pullRequest.checkedAt) :
      event.event_type === "issue.saved" ? event.payload.issue.pullRequest?.state === "merged" && !event.payload.issue.pullRequest.diagnostic && fresh(event.payload.issue.pullRequest.checkedAt) :
      event.event_type === "github.operation_recorded" && event.payload.operation.kind === "github.pr.merge" &&
        event.payload.operation.status === "completed" && fresh(event.payload.operation.updatedAt));
    if (events && !merged && !events.some((event) => ["candidate.owner_bound", "project.configured", "project.relocated", "board.saved"].includes(event.event_type))) return;
    this.queuedForce ||= Boolean(merged);
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      const force = this.queuedForce; this.queuedForce = false;
      if (!this.abort.signal.aborted) void this.refresh(force).catch((error: unknown) => {
        console.error("Candidate cleanup refresh failed:", error instanceof MoguriError ? error.code : "candidate_cleanup_refresh");
      });
    });
  }
  async close(): Promise<void> {
    clearInterval(this.timer); this.abort.abort(); await this.refreshing;
  }
  private event(cleanup: CandidateCleanup): EventInput {
    return { event_type: "candidate.cleanup_recorded", profile_id: cleanup.profileId, payload: { cleanup } };
  }
  private ownerEvent(owner: CandidateOwner, snapshot = this.host.snapshot()): EventInput {
    const candidate = owner.kind === "candidate" ? snapshot.candidates.find((candidate) => candidate.id === owner.id) : undefined;
    const generation = candidate?.generationId ? snapshot.candidateGenerations.find((generation) => generation.id === candidate.generationId) : undefined;
    const artifact = snapshot.artifacts.find((artifact) => artifact.id === owner.id);
    if (!owner.generationEvidence && candidate && generation?.status === "proposed" && generation.resultDigest && generation.proposalDocumentDigest &&
      sameCandidateRoot(candidate.source, generation.source) && sameCandidateRoot(candidate.stage, generation.stage) &&
      artifact?.sources.some((source) => source.actor === "model" && source.sessionId === generation.sessionId && source.messageId === generation.stepId &&
        source.modelId === generation.modelId && source.contentDigest === generation.resultDigest)) {
      owner = { ...owner, generationEvidence: { generationId: generation.id, inputDigest: generation.inputDigest,
        resultDigest: generation.resultDigest, proposalDocumentDigest: generation.proposalDocumentDigest } };
    }
    return { event_type: "candidate.owner_bound", profile_id: owner.profileId, payload: { owner } };
  }
  derived(previous: Snapshot, next: Snapshot): EventInput[] {
    return next.candidateOwners.filter((owner) => JSON.stringify(previous.candidateOwners.find((value) => value.id === owner.id)) !== JSON.stringify(owner))
      .map((owner) => this.ownerEvent(owner, next));
  }
  migrate(): void {
    const recorded = new Set(this.host.events().flatMap((event) => event.event_type === "candidate.owner_bound" ? [event.payload.owner.id] : []));
    const events = this.host.snapshot().candidateOwners.filter((owner) => !recorded.has(owner.id)).map((owner) => this.ownerEvent(owner));
    if (events.length) this.host.commit(events);
  }
  sessionDeleting(id: string): boolean {
    return this.host.snapshot().candidateCleanups.some((cleanup) => cleanup.status !== "completed" && cleanup.reason.kind === "session-delete" && cleanup.reason.sessionId === id);
  }
  sessionDeleted(id: string): boolean {
    return this.host.snapshot().candidateCleanups.some((cleanup) => cleanup.status === "completed" && cleanup.reason.kind === "session-delete" && cleanup.reason.sessionId === id);
  }
  private pending(reason: CandidateCleanup["reason"], targets: string[]): CandidateCleanup {
    const now = new Date().toISOString();
    const cleanup: CandidateCleanup = { version: 1, id: randomUUID(), profileId: this.host.snapshot().profileId, revision: 0,
      reason, targets, status: "pending", createdAt: now, updatedAt: now, diagnostic: null, quarantinedRoots: [] };
    return this.savePending(cleanup);
  }
  private savePending(cleanup: CandidateCleanup): CandidateCleanup {
    this.validate(cleanup);
    try { this.host.commit([this.event(cleanup)]); }
    catch (error) {
      console.error("Candidate cleanup intent could not be saved:", error instanceof MoguriError ? error.code : error instanceof Error && "code" in error ? error.code : "cleanup_journal");
      throw new MoguriError("candidate_cleanup_intent", "Candidate cleanup intent could not be saved. Nothing was deleted and owned work was not claimed stopped. Check storage/service diagnostics and retry deletion.", 503);
    }
    return cleanup;
  }
  private validate(cleanup: CandidateCleanup): void {
    const snapshot = this.host.snapshot(), reason = cleanup.reason;
    if (cleanup.profileId !== snapshot.profileId) throw new MoguriError("candidate_cleanup_scope", "Cleanup cannot leave its exact owning profile.", 409);
    for (const id of cleanup.targets) {
      const owner = snapshot.candidateOwners.find((owner) => owner.id === id);
      if (!owner && !snapshot.artifacts.some((artifact) => artifact.id === id)) continue;
      if (!owner || reason.kind === "session-delete" && owner.originSessionId !== reason.sessionId ||
        reason.kind === "pr-merged" && (!owner.pullRequest || !sameCandidatePr(reason.pullRequest, owner.pullRequest))) {
        throw new MoguriError("candidate_cleanup_scope", "Cleanup targets no longer match their canonical originating session or exact recorded repository/PR. Nothing unrelated was cancelled or deleted.", 409);
      }
    }
  }
  beginSession(id: string): CandidateCleanup | null {
    const previous = this.host.snapshot().candidateCleanups.find((cleanup) => cleanup.reason.kind === "session-delete" && cleanup.reason.sessionId === id && cleanup.status !== "completed");
    if (previous) {
      this.validate(previous);
      if (previous.status === "pending") return previous;
      const pending: CandidateCleanup = { ...previous, revision: previous.revision + 1, status: "pending", diagnostic: null, updatedAt: new Date().toISOString() };
      return this.savePending(pending);
    }
    const targets = this.host.snapshot().candidateOwners.filter((owner) => owner.originSessionId === id).map((owner) => owner.id);
    return targets.length ? this.pending({ kind: "session-delete", sessionId: id }, targets) : null;
  }
  complete(id: string): { events: EventInput[]; forget: ForgetRequest } {
    const snapshot = this.host.snapshot(), cleanup = snapshot.candidateCleanups.find((cleanup) => cleanup.id === id);
    if (!cleanup || cleanup.status === "completed") throw new MoguriError("candidate_cleanup_state", "This cleanup is missing or already completed. No deletion was replayed.", 409);
    this.validate(cleanup);
    const quarantinedRoots: CandidateCleanup["quarantinedRoots"] = [];
    for (const candidate of snapshot.candidates.filter((candidate) => cleanup.targets.includes(candidate.id) && candidate.status === "partial")) {
      const root = candidate.applyIntent ? candidate.source : candidate.stage;
      if (root.workspaceId ? snapshot.blockedWorkspaces.includes(root.workspaceId) : snapshot.blockedProjects.includes(root.projectId)) {
        if (!quarantinedRoots.some((entry) => entry.projectId === root.projectId && entry.workspaceId === root.workspaceId)) quarantinedRoots.push({ projectId: root.projectId, workspaceId: root.workspaceId });
      }
    }
    return { events: [...this.host.artifacts.deleteCandidates(cleanup.targets), this.event({ ...cleanup, revision: cleanup.revision + 1,
      status: "completed", diagnostic: null, updatedAt: new Date().toISOString(), quarantinedRoots })], forget: { artifacts: cleanup.targets } };
  }
  failed(id: string, error: unknown): MoguriError {
    const cleanup = this.host.snapshot().candidateCleanups.find((cleanup) => cleanup.id === id);
    const diagnostic = error instanceof MoguriError ? error.message : "Candidate cleanup could not be durably completed. Check local storage permissions and service diagnostics.";
    console.error("Candidate cleanup incomplete:", id, error instanceof MoguriError ? error.code : error instanceof Error && "code" in error ? error.code : "candidate_cleanup");
    if (cleanup && cleanup.status !== "completed") {
      try { this.host.commit([this.event({ ...cleanup, revision: cleanup.revision + 1, status: "failed", updatedAt: new Date().toISOString(), diagnostic: diagnostic.slice(0, 4000) })]); }
      catch (failure) { console.error("Candidate cleanup failure could not be journaled; original pending intent remains:", failure instanceof MoguriError ? failure.code : "cleanup_journal"); }
    }
    return new MoguriError(error instanceof MoguriError ? error.code : "candidate_cleanup_pending",
      `Deletion is incomplete. ${diagnostic} Candidate cleanup remains pending; no success was recorded.`, 409);
  }
  async recover(): Promise<void> {
    const deleted = new Set(this.host.events().flatMap((event) => event.event_type === "session.deleted" ? [event.payload.deletedSessionId] : []));
    const projects = new Set(this.host.events().flatMap((event) => event.event_type === "project.removed" ? [event.payload.deletedProjectId] : []));
    for (const owner of this.host.snapshot().candidateOwners) if (owner.originSessionId &&
      (deleted.has(owner.originSessionId) || projects.has(owner.projectId) && !this.host.snapshot().sessions.some((session) => session.id === owner.originSessionId)) &&
      !this.sessionDeleting(owner.originSessionId)) this.beginSession(owner.originSessionId);
    for (const cleanup of this.host.snapshot().candidateCleanups.filter((cleanup) => cleanup.status !== "completed")) {
      try {
        const reason = cleanup.reason;
        this.validate(cleanup);
        if (reason.kind === "session-delete" && this.host.snapshot().sessions.some((session) => session.id === reason.sessionId)) {
          if (this.host.sessionBusy(reason.sessionId)) continue;
          await this.host.deleteSession(reason.sessionId);
        } else {
          await this.host.settle(cleanup.targets);
          const completed = this.complete(cleanup.id); this.host.commit(completed.events, completed.forget);
        }
      } catch (error) {
        if (this.host.snapshot().candidateCleanups.find((value) => value.id === cleanup.id)?.status !== "failed") this.failed(cleanup.id, error);
      }
    }
  }
  private source(owner: CandidateOwner): CandidateRoot | undefined {
    const snapshot = this.host.snapshot();
    return owner.kind === "candidate" ? snapshot.candidates.find((record) => record.id === owner.id)?.source :
      snapshot.candidateGenerations.find((record) => record.id === owner.id)?.source;
  }
  private scope(owner: CandidateOwner): SessionPrScope | null {
    const snapshot = this.host.snapshot(), source = this.source(owner);
    if (!owner.pullRequest || !source || candidateDeletionPending(snapshot.candidateCleanups, owner.id)) return null;
    const project = snapshot.projects.find((project) => project.id === owner.projectId);
    if (!project || !(snapshot.boards.find((board) => board.projectId === project.id) ?? defaultBoard(project.id)).autoRefreshPrs) return null;
    const configuration = snapshot.projectConfigurations.find((configuration) => configuration.projectId === project.id) ?? defaultProjectConfiguration(project.id);
    if (source.env !== "Local" && configuration.values.repo.githubAccess === "gh-cli") return null;
    const workspace = source.workspaceId === null ? null : snapshot.managedWorkspaces.find((workspace) =>
      workspace.id === source.workspaceId && workspace.projectId === owner.projectId && workspace.status === "ready");
    if (configuration.values.repo.githubAccess === "gh-cli" && (source.workspaceId !== null && !workspace || (workspace?.path ?? project.path) !== source.root)) return null;
    return { url: owner.pullRequest.url, projectId: owner.projectId, workspaceId: source.workspaceId, root: configuration.values.repo.githubAccess === "gh-cli" ? source.root : null,
      workspaceRevision: workspace?.revision ?? null, access: configuration.values.repo.githubAccess, configurationRevision: configuration.revision };
  }
  private async assertRoot(owner: CandidateOwner, signal: AbortSignal): Promise<void> {
    const source = this.source(owner);
    if (!source) throw new MoguriError("candidate_cleanup_scope", "The captured candidate source no longer exists. No other root/account was used.", 409);
    if (source.env !== "Local") throw new MoguriError("candidate_cleanup_scope", "This Local metadata verifier cannot adopt a peer/private root or controller account. No PR cleanup was authorized.", 409);
    const project = this.host.managed.project({ projectId: source.projectId, workspaceId: source.workspaceId });
    if (project.path !== source.root) throw new MoguriError("candidate_cleanup_scope", "The exact candidate source moved. No authenticated metadata fallback was used.", 409);
    await this.host.managed.assert({ projectId: source.projectId, workspaceId: source.workspaceId }, signal);
    const [identity, git] = await Promise.all([sourceRoot(source.root), readGitBinding(source.root, signal)]);
    signal.throwIfAborted();
    if (identity.device !== source.device || identity.inode !== source.inode || git.gitCommonDir !== source.gitCommonDir) throw new MoguriError("candidate_cleanup_scope", "The candidate's recorded repository identity changed. No other account or repository was inspected.", 409);
  }
  refresh(force = true): Promise<void> {
    if (this.abort.signal.aborted) return Promise.resolve();
    if (this.refreshing) { this.refreshAgain ||= force; return this.refreshing; }
    const pending = (async () => {
      let currentForce = force;
      do {
        this.refreshAgain = false;
        await this.scan(currentForce);
        currentForce = true;
      } while (this.refreshAgain && !this.abort.signal.aborted);
    })().finally(() => { if (this.refreshing === pending) this.refreshing = undefined; });
    this.refreshing = pending; return pending;
  }
  private async scan(force: boolean): Promise<void> {
    await this.recover();
    const groups = new Map<string, { scope: SessionPrScope; owners: CandidateOwner[] }>();
    for (const owner of this.host.snapshot().candidateOwners) {
      const scope = this.scope(owner);
      if (!scope) continue;
      const key = JSON.stringify(scope), group = groups.get(key);
      if (group) group.owners.push(owner); else groups.set(key, { scope, owners: [owner] });
    }
    const currentKeys = new Set<string>();
    for (const { scope, owners } of groups.values()) {
      const key = JSON.stringify([scope, owners.map((owner) => owner.id).sort()]); currentKeys.add(key);
      if (!force && Date.now() - (this.attempted.get(key) ?? 0) < this.interval) continue;
      this.attempted.set(key, Date.now());
      const current = () => !this.abort.signal.aborted && owners.every((owner) => {
        const actual = this.host.snapshot().candidateOwners.find((value) => value.id === owner.id), actualScope = actual && this.scope(actual);
        return actual?.pullRequest && owner.pullRequest && sameCandidatePr(actual.pullRequest, owner.pullRequest) &&
          actualScope && sameSessionPrScope(scope, actualScope);
      });
      try {
        const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(20_000)]);
        if (scope.access === "gh-cli") await this.assertRoot(owners[0]!, signal);
        if (!current()) continue;
        const link = await this.host.integrations.pullRequest(pullRequestLink(scope.url), { githubAccess: scope.access }, scope.root, signal);
        if (scope.access === "gh-cli") await this.assertRoot(owners[0]!, signal);
        signal.throwIfAborted();
        if (!current() || link.state !== "merged" || link.diagnostic || !link.checkedAt) continue;
        const cleanup = this.pending({ kind: "pr-merged", pullRequest: { url: link.url, repo: link.repo, number: link.number }, checkedAt: link.checkedAt }, owners.map((owner) => owner.id));
        try {
          await this.host.settle(cleanup.targets);
          const completed = this.complete(cleanup.id); this.host.commit(completed.events, completed.forget);
        } catch (error) { this.failed(cleanup.id, error); }
      } catch (error) {
        if (!this.abort.signal.aborted) console.error("Candidate PR merge could not be verified; nothing was deleted:", error instanceof MoguriError ? error.code : "candidate_pr_unavailable");
      }
    }
    for (const key of this.attempted.keys()) if (!currentKeys.has(key)) this.attempted.delete(key);
  }
}
