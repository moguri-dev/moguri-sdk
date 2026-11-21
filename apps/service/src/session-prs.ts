import {
  defaultBoard, MoguriError, sameSessionPrScope, sessionPrScope, type EventInput, type PullRequestLink, type Session,
  type SessionPrObservation, type SessionPrScope, type Snapshot, type StoredEvent,
} from "../../../packages/protocol/src/index.ts";
import { samePullRequestContent } from "./observation-content.ts";
import { ProjectIntegrations, pullRequestLink } from "./project-integrations.ts";

interface Host {
  snapshot(): Snapshot;
  commit(events: EventInput[]): void;
  assertRoot(session: Session, signal: AbortSignal): Promise<void>;
}
const relevant = new Set(["session.created", "session.organized", "session.pr_associated", "session.workspace_bound", "session.deleted", "session.archived",
  "session.restored", "workspace.saved", "change_set.saved", "project.configured", "project.relocated", "project.removed", "board.saved", "issue.saved"]);
interface Target { scope: SessionPrScope; primary: boolean; previous?: { scope: SessionPrScope; pullRequest: PullRequestLink } }
/** The primary PR and, since protocol 118 (D65), every associated PR, each bound to its own current scope. */
function targets(session: Session, snapshot: Snapshot): Target[] {
  const primary = sessionPrScope(session, snapshot), observed = session.prObservation;
  const values: Target[] = primary ? [{ scope: primary, primary: true, ...(observed ? { previous: observed } : {}) }] : [];
  for (const association of session.prAssociations ?? []) {
    if (association.profileId !== snapshot.profileId || association.sessionId !== session.id || values.some((value) => value.scope.url === association.scope.url)) continue;
    const scope = sessionPrScope({ ...session, prUrl: association.scope.url }, snapshot);
    if (scope) values.push({ scope, primary: false, previous: association });
  }
  return values;
}
const key = (sessionId: string, url: string) => `${sessionId}\n${url}`;
export class SessionPrObserver {
  private readonly active = new Map<string, { sessionId: string; scope: SessionPrScope; abort: AbortController }>();
  private readonly attempted = new Map<string, { sessionId: string; scope: SessionPrScope; at: number }>();
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
      if (!this.target(snapshot, attempt.sessionId, attempt.scope)) this.attempted.delete(id);
    }
    for (const value of this.active.values()) {
      const target = this.target(snapshot, value.sessionId, value.scope);
      if (!target || target.session.status === "archived" || !this.enabled(value.scope, snapshot)) value.abort.abort();
    }
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; if (!this.closed) this.scan(); });
  }
  private scan(): void {
    const snapshot = this.host.snapshot();
    for (const session of snapshot.sessions) {
      if (session.status === "archived") continue;
      for (const { scope, primary, previous } of targets(session, snapshot)) {
        if (this.active.size >= 4) return;
        const id = key(session.id, scope.url);
        if (this.active.has(id)) continue;
        const attempted = this.attempted.get(id);
        if (attempted && sameSessionPrScope(attempted.scope, scope) && Date.now() - attempted.at < 120_000) continue;
        if (!this.enabled(scope, snapshot)) continue;
        if (primary && snapshot.issues.some((issue) => issue.id === session.workItemId && issue.projectId === session.projectId && issue.pullRequest?.url === scope.url)) continue;
        if (previous && sameSessionPrScope(previous.scope, scope) && (previous.pullRequest.state === "merged" && !previous.pullRequest.diagnostic ||
          previous.pullRequest.checkedAt && Date.now() - Date.parse(previous.pullRequest.checkedAt) < 120_000)) continue;
        const abort = new AbortController(), owned = { sessionId: session.id, scope, abort };
        this.active.set(id, owned);
        this.attempted.set(id, { sessionId: session.id, scope, at: Date.now() });
        void this.read(session, scope, abort.signal).catch((error: unknown) => {
          if (!abort.signal.aborted && !this.closed) console.error("Session PR observation failed:", error instanceof MoguriError ? error.code : "session_pr_observation");
        }).finally(() => {
          if (this.active.get(id) === owned) this.active.delete(id);
          if (!this.closed) this.changed();
        });
      }
    }
  }
  /** The session and its PR target, only while that target still has exactly this scope. */
  private target(snapshot: Snapshot, sessionId: string, scope: SessionPrScope): { session: Session; target: Target } | null {
    const session = snapshot.sessions.find((session) => session.id === sessionId);
    const target = session && targets(session, snapshot).find((value) => sameSessionPrScope(value.scope, scope));
    return session && target ? { session, target } : null;
  }
  private current(sessionId: string, scope: SessionPrScope): Target | null {
    const snapshot = this.host.snapshot(), found = this.target(snapshot, sessionId, scope);
    return !this.closed && found && found.session.status !== "archived" && this.enabled(scope, snapshot) ? found.target : null;
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
    const target = cancelled.aborted ? null : this.current(session.id, scope);
    if (!target) return;
    const previous = target.previous;
    // Polling cadence lives in `attempted`; only changed or ready-to-merge evidence becomes durable history.
    if (previous && sameSessionPrScope(previous.scope, scope) && link.readyToMerge !== true && samePullRequestContent(previous.pullRequest, link)) return;
    const observation: SessionPrObservation = { version: 1, profileId: this.host.snapshot().profileId, sessionId: session.id, scope, pullRequest: link };
    this.host.commit([{ event_type: "session.pr_observed", profile_id: observation.profileId, project_id: scope.projectId,
      session_id: session.id, payload: { observation } }]);
  }
}
