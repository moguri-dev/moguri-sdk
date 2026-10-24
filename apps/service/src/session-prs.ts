import {
  defaultBoard, MoguriError, sameSessionPrScope, sessionPrScope, type EventInput, type Session,
  type SessionPrObservation, type SessionPrScope, type Snapshot, type StoredEvent,
} from "../../../packages/protocol/src/index.ts";
import { ProjectIntegrations, pullRequestLink } from "./project-integrations.ts";

interface Host {
  snapshot(): Snapshot;
  commit(events: EventInput[]): void;
  assertRoot(session: Session, signal: AbortSignal): Promise<void>;
}
const relevant = new Set(["session.created", "session.organized", "session.workspace_bound", "session.deleted", "session.archived",
  "session.restored", "workspace.saved", "change_set.saved", "project.configured", "project.relocated", "project.removed", "board.saved", "issue.saved"]);
export class SessionPrObserver {
  private readonly active = new Map<string, { scope: SessionPrScope; abort: AbortController }>();
  private readonly attempted = new Map<string, { scope: SessionPrScope; at: number }>();
  private timer?: ReturnType<typeof setInterval>;
  private queued = false;
  private closed = false;
  private started = false;
  constructor(private readonly host: Host, private readonly integrations: ProjectIntegrations, private readonly interval = 60_000) {}
  start(): void {
    if (this.started || this.closed) return;
    this.started = true;
    this.timer = setInterval(() => this.changed(), this.interval); this.timer.unref();
    this.changed();
  }
  close(): void {
    this.closed = true; clearInterval(this.timer);
    for (const value of this.active.values()) value.abort.abort();
    this.active.clear();
  }
  changed(events?: StoredEvent[]): void {
    if (this.closed || !this.started || events && !events.some((event) => relevant.has(event.event_type))) return;
    const snapshot = this.host.snapshot();
    for (const [id, attempt] of this.attempted) {
      const session = snapshot.sessions.find((session) => session.id === id), scope = session && sessionPrScope(session, snapshot);
      if (!scope || !sameSessionPrScope(scope, attempt.scope)) this.attempted.delete(id);
    }
    for (const [id, value] of this.active) {
      const session = snapshot.sessions.find((session) => session.id === id), scope = session && sessionPrScope(session, snapshot);
      if (!session || session.status === "archived" || !scope || !sameSessionPrScope(value.scope, scope) || !this.enabled(scope, snapshot)) {
        value.abort.abort();
      }
    }
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; if (!this.closed) this.scan(); });
  }
  private scan(): void {
    const snapshot = this.host.snapshot();
    for (const session of snapshot.sessions) {
      if (this.active.size >= 4) break;
      if (this.active.has(session.id) || session.status === "archived") continue;
      const scope = sessionPrScope(session, snapshot);
      if (!scope) continue;
      const attempted = this.attempted.get(session.id);
      if (attempted && sameSessionPrScope(attempted.scope, scope) && Date.now() - attempted.at < 120_000) continue;
      if (!this.enabled(scope, snapshot)) continue;
      if (snapshot.issues.some((issue) => issue.id === session.workItemId && issue.projectId === session.projectId && issue.pullRequest?.url === scope.url)) continue;
      const observed = session.prObservation;
      if (observed && sameSessionPrScope(observed.scope, scope) && (observed.pullRequest.state === "merged" && !observed.pullRequest.diagnostic ||
        observed.pullRequest.checkedAt && Date.now() - Date.parse(observed.pullRequest.checkedAt) < 120_000)) continue;
      const abort = new AbortController(), owned = { scope, abort };
      this.active.set(session.id, owned);
      this.attempted.set(session.id, { scope, at: Date.now() });
      void this.read(session, scope, abort.signal).catch((error: unknown) => {
        if (!abort.signal.aborted && !this.closed) console.error("Session PR observation failed:", error instanceof MoguriError ? error.code : "session_pr_observation");
      }).finally(() => {
        if (this.active.get(session.id) === owned) this.active.delete(session.id);
        if (!this.closed) this.changed();
      });
    }
  }
  private current(sessionId: string, scope: SessionPrScope): boolean {
    const snapshot = this.host.snapshot(), session = snapshot.sessions.find((session) => session.id === sessionId);
    const actual = session && sessionPrScope(session, snapshot);
    return !this.closed && !!session && session.status !== "archived" && !!actual && sameSessionPrScope(scope, actual) && this.enabled(scope, snapshot);
  }
  private enabled(scope: SessionPrScope, snapshot: Snapshot): boolean {
    return scope.projectId === null || (snapshot.boards.find((board) => board.projectId === scope.projectId) ?? defaultBoard(scope.projectId)).autoRefreshPrs;
  }
  private async read(session: Session, scope: SessionPrScope, cancelled: AbortSignal): Promise<void> {
    const signal = AbortSignal.any([cancelled, AbortSignal.timeout(20_000)]);
    let link = pullRequestLink(scope.url);
    try {
      if (scope.access === "gh-cli") await this.host.assertRoot(session, signal);
      signal.throwIfAborted();
      if (!this.current(session.id, scope)) return;
      link = await this.integrations.pullRequest(link, { githubAccess: scope.access }, scope.root, signal);
      if (scope.access === "gh-cli") await this.host.assertRoot(session, signal);
    } catch (error) {
      if (cancelled.aborted || !this.current(session.id, scope)) return;
      const diagnostic = error instanceof MoguriError ? error.message : "The exact linked PR could not be verified. No alternate root or GitHub account was used.";
      console.error("Session PR observation unavailable:", error instanceof MoguriError ? error.code : "session_pr_read");
      link = { ...link, checkedAt: new Date().toISOString(), diagnostic };
    }
    if (cancelled.aborted || !this.current(session.id, scope)) return;
    const observation: SessionPrObservation = { version: 1, profileId: this.host.snapshot().profileId, sessionId: session.id, scope, pullRequest: link };
    this.host.commit([{ event_type: "session.pr_observed", profile_id: observation.profileId, project_id: scope.projectId,
      session_id: session.id, payload: { observation } }]);
  }
}
