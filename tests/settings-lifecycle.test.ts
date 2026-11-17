import assert from "node:assert/strict";
import test from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { projectEvents, factoryControls, PROTOCOL_VERSION, type Snapshot, type Session } from "../packages/protocol/src/index.ts";
import { canAutoArchive, sessionMergedAt } from "../apps/service/src/session-lifecycle.ts";

const day = 86_400_000, finished = Date.parse("2026-01-01T00:00:00.000Z");
function fixture(): { store: EventStore; snapshot: Snapshot; session: Session } {
  const store = new EventStore(":memory:");
  store.commit([
    { profile_id: "default", session_id: "generated-session", event_type: "session.created", payload: { title: "Generated completed session", controls: factoryControls() } },
    { profile_id: "default", session_id: "generated-session", turn_id: "generated-turn", event_type: "turn.finished", payload: { outcome: "completed", diagnostic: null } },
  ]);
  const snapshot: Snapshot = {
    ...projectEvents(store.events().map((event) => ({ ...event, timestamp: new Date(finished - (event.event_type === "session.created" ? 60_000 : 0)).toISOString() }))),
    protocolVersion: PROTOCOL_VERSION, seq: store.events().at(-1)!.seq, profileId: "default", sessionTelemetry: {},
    provider: { status: "disconnected", models: [], login: null, diagnostic: null }, capabilities: [],
  };
  snapshot.settings.values.retention.archiveCompleted = true;
  return { store, snapshot, session: snapshot.sessions[0]! };
}

test("automatic archive uses exact actual completion age, not an incidental later update", () => {
  const { store, snapshot, session } = fixture();
  try {
    assert.equal(session.completedAt, new Date(finished).toISOString());
    assert.equal(canAutoArchive(snapshot, session, finished + 7 * day - 1), false);
    session.updatedAt = new Date(finished + 6 * day).toISOString();
    assert.equal(canAutoArchive(snapshot, session, finished + 7 * day), true);
    snapshot.settings.values.retention.archiveCompleted = false;
    assert.equal(canAutoArchive(snapshot, session, finished + 20 * day), false);
  } finally { store.close(); }
});

test("drafts, attachments, held queues, unanswered input, live effects and source quarantine block automatic archival", () => {
  for (const block of [
    (_snapshot: Snapshot, session: Session) => { session.draft.text = "Generated unsent draft"; },
    (_snapshot: Snapshot, session: Session) => { session.turnId = "generated-live-turn"; },
    (_snapshot: Snapshot, session: Session) => { session.pendingQuestionId = "generated-open-question"; },
    (_snapshot: Snapshot, session: Session) => { session.queue.push({ id: "generated-queue", text: "Generated held prompt", attachments: [], delivery: "queue", held: true }); },
    (_snapshot: Snapshot, session: Session) => { session.processes.push({ callId: "generated-process", pid: 2147000000, processGroup: 2147000000, turnId: "generated-turn", outcome: "unconfirmed" }); },
    (snapshot: Snapshot, session: Session) => { snapshot.blockedSessions.push(session.id); },
    (snapshot: Snapshot, session: Session) => { snapshot.jobs.push({ id: "generated-job", kind: "voice.capture", sessionId: session.id, projectId: null, parentTurnId: null, status: "running", progress: "", error: null, resultDigest: null }); },
    (snapshot: Snapshot, session: Session) => { snapshot.sessions.push({ ...structuredClone(session), id: "generated-child", parentSessionId: session.id, turnId: "generated-child-turn", status: "running" }); },
    (_snapshot: Snapshot, session: Session) => { session.status = "partial"; },
    (_snapshot: Snapshot, session: Session) => { session.status = "stopped"; },
    (_snapshot: Snapshot, session: Session) => { session.status = "failed"; },
  ]) {
    const { store, snapshot, session } = fixture();
    try { block(snapshot, session); assert.equal(canAutoArchive(snapshot, session, finished + 20 * day), false); }
    finally { store.close(); }
  }
});

test("merged sessions archive after the configured age from when Moguri saw the merge", () => {
  const { store, snapshot, session } = fixture();
  try {
    snapshot.settings.values.retention.archiveCompleted = false;
    session.status = "stopped";
    const merged = finished + 2 * day, pullRequest = { url: "https://github.com/generated-owner/generated-repository/pull/7", repo: "generated-owner/generated-repository",
      number: 7, state: "merged" as const, checkedAt: new Date(merged).toISOString(), diagnostic: null };
    session.prObservation = { version: 1, profileId: "default", sessionId: session.id, pullRequest,
      scope: { url: pullRequest.url, projectId: null, workspaceId: null, root: null, workspaceRevision: null, access: "public", configurationRevision: null } };
    assert.equal(sessionMergedAt(session), merged);
    assert.equal(canAutoArchive(snapshot, session, merged + 30 * day), false, "off by default");
    snapshot.settings.values.retention.archiveMerged = true;
    assert.equal(canAutoArchive(snapshot, session, merged + 7 * day - 1), false);
    assert.equal(canAutoArchive(snapshot, session, merged + 7 * day), true);
    snapshot.settings.values.retention.archiveMergedAfterDays = 30;
    assert.equal(canAutoArchive(snapshot, session, merged + 29 * day), false);
    assert.equal(canAutoArchive(snapshot, session, merged + 30 * day), true);
    session.draft.text = "Generated unsent draft";
    assert.equal(canAutoArchive(snapshot, session, merged + 90 * day), false);
    session.draft.text = ""; session.prObservation.pullRequest = { ...pullRequest, state: "open" };
    assert.equal(canAutoArchive(snapshot, session, merged + 90 * day), false);
  } finally { store.close(); }
});
