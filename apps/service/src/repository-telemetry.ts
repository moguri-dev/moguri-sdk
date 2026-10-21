import { randomUUID } from "node:crypto";
import {
  MoguriError, type Snapshot, type Session, type EventInput, type CommandResult, type RepositoryScope, type RepositoryPreview,
  type RepositoryObservation, type RepositoryCapture, type RepositoryCommand, type RepositoryQuery, type RepositoryResponse,
  type RepositoryAttribution, type RepositoryFilters, type RepositoryCoverage,
} from "../../../packages/protocol/src/index.ts";
import { frameDigest } from "./worker-wire.ts";
import type { ProjectIntegrations } from "./project-integrations.ts";
import { loadRepository, repositoryIdentity, type RepositoryApiMetadata } from "./repository-metadata.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";

interface Host {
  snapshot(): Snapshot;
  scope(session: Session): RepositoryScope;
  git(session: Session, signal: AbortSignal): Promise<string | null>;
  remoteRead(session: Session, repository: string, signal: AbortSignal): Promise<RepositoryApiMetadata>;
  lookupRoot(session: Session): string;
  commit(events: EventInput[]): void;
  job(session: Session, execute: (signal: AbortSignal, jobId: string) => Promise<unknown>, settled: () => void): string;
}
export interface CapturedRepository extends RepositoryCapture { proof: { scopeKey: string; scopeDigest: string; observationId: string | null } | null }
export const matchesRepository = (repository: RepositoryAttribution | null | undefined, filters: RepositoryFilters): boolean =>
  (filters.repositoryId === undefined || repository?.id === filters.repositoryId) &&
  (filters.organization === undefined || repository?.ownerKind === "organization" && repository.owner.toLowerCase() === filters.organization.toLowerCase()) &&
  (filters.visibility === undefined || (filters.visibility === "open-source" ? repository?.publicOsiLicensed === true : repository?.visibility === filters.visibility));
export const repositoryCoverage = (entries: Array<{ repository?: RepositoryAttribution | null }>): RepositoryCoverage => ({
  attributedCalls: entries.filter((entry) => entry.repository !== null && entry.repository !== undefined).length,
  unattributedCalls: entries.filter((entry) => entry.repository === null || entry.repository === undefined).length,
  unverifiedLicenseCalls: entries.filter((entry) => entry.repository?.visibility === "public" && entry.repository.publicOsiLicensed === null).length,
});
export class RepositoryTelemetry {
  private readonly active = new Map<string, string>();
  constructor(private readonly host: Host, private readonly integrations: ProjectIntegrations) {}
  private session(id: string): Session {
    const session = this.host.snapshot().sessions.find((session) => session.id === id);
    if (!session) throw new MoguriError("repository_session", "Choose an existing session in this profile for repository metadata.", 404);
    return session;
  }
  private observation(scopeKey: string): RepositoryObservation | undefined {
    return this.host.snapshot().repositoryObservations.find((observation) => observation.scopeKey === scopeKey);
  }
  private async context(sessionId: string, signal: AbortSignal): Promise<RepositoryPreview> {
    signal.throwIfAborted();
    const session = this.session(sessionId), scope = this.host.scope(session);
    const repository = await this.host.git(session, signal);
    signal.throwIfAborted();
    if (this.host.scope(this.session(sessionId)).scopeDigest !== scope.scopeDigest) throw new MoguriError("repository_scope_changed", "Repository root/policy scope changed during inspection. Reload before continuing.", 409);
    if (!repository) throw new MoguriError("repository_unsupported", "No exact credential-free GitHub upstream was observed in this bound root. No repository was guessed.", 409);
    repositoryIdentity(repository);
    return { ...scope, repository, bindingDigest: frameDigest([scope.scopeDigest, repository]), revision: this.observation(scope.scopeKey)?.revision ?? 0,
      lookupBoundary: scope.access === "public" ? "control-plane-public" : scope.env === "Remote" ? "remote-gh-cli" : "control-plane-gh-cli" };
  }
  async query(query: RepositoryQuery): Promise<RepositoryResponse> {
    if (query.type === "repository.preview") return { type: query.type, preview: await this.context(query.sessionId, AbortSignal.timeout(8000)) };
    const scope = this.host.scope(this.session(query.sessionId)), observation = this.observation(scope.scopeKey);
    return { type: query.type, observation: observation?.scopeDigest === scope.scopeDigest && observation.status === "active" ? structuredClone(observation) : null };
  }
  async execute(command: RepositoryCommand, finish: WorkspaceFinish): Promise<CommandResult> {
    const session = this.session(command.sessionId), scope = this.host.scope(session), previous = this.observation(scope.scopeKey);
    if ((previous?.revision ?? 0) !== command.expectedRevision) throw new MoguriError("repository_revision", "Repository observation changed. Reload before editing.", 409);
    if (this.active.has(scope.scopeKey)) throw new MoguriError("repository_pending", "An exact metadata refresh already owns this scope. Stop/wait for it before refreshing or clearing.", 409);
    if (command.type === "repository.clear") {
      if (!previous) throw new MoguriError("repository_missing", "This scope has no observation to clear.", 409);
      const observation: RepositoryObservation = { ...previous, revision: previous.revision + 1, repository: null, status: "cleared", jobId: null, updatedAt: new Date().toISOString() };
      return finish([this.event(observation)], { id: observation.id, revision: observation.revision });
    }
    const preview = await this.context(session.id, AbortSignal.timeout(8000));
    if (preview.bindingDigest !== command.expectedBinding || preview.revision !== command.expectedRevision) throw new MoguriError("repository_binding", "The reviewed repository binding or revision changed. No lookup was started.", 409);
    if (this.active.has(preview.scopeKey)) throw new MoguriError("repository_pending", "Another metadata refresh already owns this scope.", 409);
    const id = this.host.job(this.session(session.id), async (signal, jobId) => {
      const readBinding = async () => {
        const current = await this.context(session.id, signal);
        if (current.bindingDigest !== preview.bindingDigest || current.revision !== command.expectedRevision) throw new MoguriError("repository_scope_changed", "Repository root/policy scope or observation changed during lookup. No result was retained.", 409);
        return { digest: current.bindingDigest, repository: current.repository };
      };
      const result = preview.lookupBoundary === "remote-gh-cli" ?
        await loadRepository(readBinding, (fullName) => this.host.remoteRead(this.session(session.id), `https://github.com/${fullName}`, signal), signal) :
        await this.integrations.repositoryMetadata(readBinding, preview.access, this.host.lookupRoot(this.session(session.id)), signal);
      signal.throwIfAborted();
      const current = await this.context(session.id, signal);
      if (result.bindingDigest !== current.bindingDigest || current.revision !== command.expectedRevision) throw new MoguriError("repository_scope_changed", "Repository binding changed before retention. No observation was applied.", 409);
      const timestamp = new Date().toISOString();
      const observation: RepositoryObservation = {
        id: randomUUID(), revision: command.expectedRevision + 1, scopeKey: current.scopeKey, scopeDigest: current.scopeDigest,
        profileId: current.profileId, projectId: current.projectId, workspaceId: current.workspaceId, env: current.env,
        actor: "user", status: "active", access: current.access, lookupBoundary: current.lookupBoundary, jobId,
        ...(current.remote ? { remote: current.remote } : {}),
        repository: result.repository, createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp,
      };
      signal.throwIfAborted(); this.host.commit([this.event(observation)]);
      if (signal.aborted) throw new MoguriError("repository_partial", "Metadata was retained before stop was observed. The refresh is partial, not rolled back; inspect or explicitly clear future attribution.", 409);
      return { observationId: observation.id, revision: observation.revision };
    }, () => this.active.delete(preview.scopeKey));
    this.active.set(preview.scopeKey, id);
    return finish([], { id });
  }
  private event(observation: RepositoryObservation): EventInput {
    return { event_type: "repository.recorded", profile_id: observation.profileId, payload: { observation } };
  }
  async capture(session: Session, signal: AbortSignal): Promise<CapturedRepository> {
    signal.throwIfAborted();
    if (!session.projectId || session.controls.env === "Sandbox") return { repository: null, repositoryDiagnostic: "not-configured", proof: null };
    const observations = this.host.snapshot().repositoryObservations;
    if (!observations.some((entry) => entry.projectId === session.projectId && entry.workspaceId === session.workspaceId && entry.env === session.controls.env && entry.status === "active")) {
      return { repository: null, repositoryDiagnostic: "not-configured", proof: null };
    }
    const scope = this.host.scope(session), observation = this.observation(scope.scopeKey);
    const proof = { scopeKey: scope.scopeKey, scopeDigest: scope.scopeDigest, observationId: observation?.id ?? null };
    if (!observation?.repository || observation.status !== "active" || observation.scopeDigest !== scope.scopeDigest) return { repository: null, repositoryDiagnostic: "scope-changed", proof };
    let repository: string | null;
    try { repository = await this.host.git(session, signal); }
    catch (error) {
      signal.throwIfAborted();
      if (this.host.scope(this.session(session.id)).scopeDigest !== scope.scopeDigest) throw new MoguriError("repository_scope_changed", "The active repository/root changed during attribution. No stale model dispatch was admitted.", 409);
      console.error("Moguri repository attribution unavailable:", error instanceof MoguriError ? error.code : "repository_read");
      return { repository: null, repositoryDiagnostic: "read-unavailable", proof };
    }
    signal.throwIfAborted();
    if (this.host.scope(this.session(session.id)).scopeDigest !== scope.scopeDigest) throw new MoguriError("repository_scope_changed", "The active repository/root changed during attribution. No stale dispatch was admitted.", 409);
    if (repository !== observation.repository.url) return { repository: null, repositoryDiagnostic: "repository-changed", proof };
    return { repository: { ...structuredClone(observation.repository), observationId: observation.id, scopeDigest: scope.scopeDigest }, repositoryDiagnostic: null, proof };
  }
  finalize(session: Session, captured: CapturedRepository): RepositoryCapture {
    if (captured.proof) {
      const scope = this.host.scope(session);
      if (scope.scopeDigest !== captured.proof.scopeDigest || scope.scopeKey !== captured.proof.scopeKey) throw new MoguriError("repository_scope_changed", "Repository/root authority changed before dispatch. No stale request was admitted.", 409);
      const current = this.observation(scope.scopeKey);
      if (current?.id !== captured.proof.observationId || current?.status !== "active") return { repository: null, repositoryDiagnostic: "scope-changed" };
    }
    return { repository: captured.repository, repositoryDiagnostic: captured.repositoryDiagnostic };
  }
}
