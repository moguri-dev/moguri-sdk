import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { realpath } from "node:fs/promises";
import {
  appearanceColors, colorContrast, defaultBoard, defaultProjectConfiguration, MoguriSdk, sessionIndicator, sessionIndicatorColors,
  sessionPrScope, sessionPullRequest, sessionPullRequestUrl, sessionPriority, compareSessionPriority, projectEvents, type EventInput, type PullRequestLink, type Session,
  type SessionPrObservation, type Snapshot, type StoredEvent,
} from "../packages/sdk/src/index.ts";
import { ProjectIntegrations, type IntegrationOptions } from "../apps/service/src/project-integrations.ts";
import { SessionPrObserver } from "../apps/service/src/session-prs.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture, waitFor } from "./fixture.ts";

const url = (number = 7) => `https://github.com/generated/project/pull/${number}`;
const response = (number = 7, draft = false, merged = false) => ({
  number, html_url: url(number), state: merged ? "closed" : "open", draft, merged, merged_at: merged ? "2026-01-01T00:00:00Z" : null,
});
const linked = (number = 7): PullRequestLink => ({ url: url(number), repo: "generated/project", number, state: "unknown", draft: null, checkedAt: null, diagnostic: null });
function observation(session: Session, snapshot: Snapshot, changes: Partial<PullRequestLink> = {}): SessionPrObservation {
  const scope = sessionPrScope(session, snapshot);
  assert.ok(scope);
  return { version: 1, profileId: snapshot.profileId, sessionId: session.id, scope, pullRequest: { ...linked(), checkedAt: new Date().toISOString(), ...changes } };
}
function harness(fixture: Awaited<ReturnType<typeof setupFixture>>, options: IntegrationOptions = {}, interval = 60_000) {
  const snapshot = structuredClone(fixture.service.controller.snapshot()), writes: EventInput[] = [], roots: string[] = [];
  const observer = new SessionPrObserver({
    snapshot: () => snapshot,
    assertRoot: async (session, signal) => {
      signal.throwIfAborted();
      const scope = sessionPrScope(session, snapshot); assert.ok(scope?.root); roots.push(scope.root);
    },
    commit: (events) => {
      writes.push(...events);
      for (const event of events) {
        assert.equal(event.event_type, "session.pr_observed");
        if (event.event_type === "session.pr_observed") snapshot.sessions.find((session) => session.id === event.session_id)!.prObservation = structuredClone(event.payload.observation);
      }
    },
  }, new ProjectIntegrations(fixture.terminalVault, options), interval);
  return { snapshot, writes, roots, observer, session: snapshot.sessions.find((session) => session.id === fixture.sessionId)! };
}

test("session indicators distinguish actual work, questions, approvals, completion and held or unsuccessful turns", async () => {
  const fixture = await setupFixture();
  try {
    const snapshot = structuredClone(fixture.service.controller.snapshot()), session = snapshot.sessions[0]!;
    for (const status of ["idle", "completed", "failed", "partial", "stopped", "archived", "queued"] as const) {
      session.status = status;
      assert.equal(sessionIndicator(session, snapshot).kind, status);
    }
    session.queue = [{ id: "generated-held", text: "Generated held prompt", delivery: "queue", attachments: [], held: true }];
    session.status = "queued";
    assert.match(sessionIndicator(session, snapshot).label, /held; no work running/);
    session.status = "running"; session.turnId = "generated-current-turn";
    assert.equal(sessionIndicator(session, snapshot).kind, "running");
    session.status = "stopping";
    assert.match(sessionIndicator(session, snapshot).label, /Stopping active work/);
    session.status = "waiting_input";
    session.pendingApproval = { id: "generated-approval", stepId: "generated-step", call: { id: "generated-call", name: "write_file", arguments: {} }, policyRevision: 0 };
    assert.equal(sessionIndicator(session, snapshot).kind, "approval");
    session.pendingQuestionId = "generated-question";
    assert.equal(sessionIndicator(session, snapshot).kind, "question");
    snapshot.settings.values.notifications.inApp = false;
    assert.equal(sessionIndicator(session, snapshot).kind, "question", "actual required input is not a notification preference");
    session.pendingQuestionId = null; session.pendingApproval = null; session.status = "running";
    assert.equal(sessionIndicator(session, snapshot).kind, "running", "notification opt-out cannot hide actual work");
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});

test("pins override authoritative question/finished/error/running priority while stored order breaks ties", async () => {
  const f = await setupFixture();
  try {
    const snapshot = structuredClone(f.service.controller.snapshot()), original = snapshot.sessions[0]!;
    const make = (id: string, changes: Partial<Session>): Session => ({ ...original, id, pinned: false, ...changes });
    const pinned = make("generated-pinned", { pinned: true, order: 100 });
    const question = make("generated-actual-question", { pendingQuestionId: "generated-owned-question" });
    const complete = make("generated-complete", { status: "completed" });
    const error = make("generated-error", { status: "failed" });
    const running = make("generated-running", { status: "running", turnId: "generated-running-turn" });
    const first = make("generated-tie-first", { order: 1 });
    const second = make("generated-tie-second", { order: 2 });
    assert.deepEqual([second, running, complete, pinned, error, question, first].sort((a, b) => compareSessionPriority(a, b, snapshot)).map((session) => session.id),
      [pinned.id, question.id, complete.id, error.id, running.id, first.id, second.id]);
    first.prUrl = url();
    first.prObservation = observation(first, snapshot, { state: "open", draft: false, readyToMerge: true, headSha: "a".repeat(40) });
    assert.equal(sessionPriority(first, snapshot), 1);
    first.prObservation.pullRequest.checkedAt = new Date(Date.now() - 121000).toISOString();
    assert.equal(sessionPriority(first, snapshot), 5, "stale readiness does not move an idle session into the ready group");
    snapshot.attention.push({ id: "generated-heuristic", sessionId: first.id, projectId: first.projectId, kind: "question",
      reason: "question", source: "heuristic", messageId: null, acknowledged: false, active: true, createdAt: new Date().toISOString() });
    assert.equal(sessionPriority(first, snapshot), 5, "heuristic text is not an actual unanswered question");
  } finally { await f.close(); }
});

test("active work and real input take precedence over a verified merge; unknown draft and stale scope never imply ready", async () => {
  const fixture = await setupFixture();
  try {
    const snapshot = structuredClone(fixture.service.controller.snapshot()), session = snapshot.sessions[0]!;
    session.prUrl = url(); session.status = "completed";
    session.prObservation = observation(session, snapshot, { state: "merged", draft: false });
    assert.equal(sessionIndicator(session, snapshot).kind, "merged");
    session.status = "running"; session.turnId = "generated-turn";
    assert.equal(sessionIndicator(session, snapshot).kind, "running");
    session.pendingQuestionId = "generated-question";
    assert.equal(sessionIndicator(session, snapshot).kind, "question");
    session.pendingQuestionId = null;
    session.pendingApproval = { id: "generated-approval", stepId: "generated-step", call: { id: "generated-call", name: "run_command", arguments: {} }, policyRevision: 0 };
    assert.equal(sessionIndicator(session, snapshot).kind, "approval");
    session.pendingApproval = null; session.turnId = null; session.status = "completed";
    for (const draft of [true, false, undefined]) {
      session.prObservation = observation(session, snapshot, { state: "open", draft });
      assert.equal(sessionIndicator(session, snapshot).kind, "completed");
      assert.equal(sessionIndicator(session, snapshot).pr?.draft, draft);
      assert.equal(sessionIndicator(session, snapshot).prState, draft === undefined ? "unknown" : draft ? "draft" : "open");
    }
    session.prObservation = observation(session, snapshot, { state: "merged", draft: false });
    snapshot.projects[0]!.path = join(fixture.directory, "generated-other-root");
    assert.equal(sessionPullRequest(session, snapshot), null);
    assert.equal(sessionIndicator(session, snapshot).kind, "completed");
    session.prObservation = observation(session, snapshot, { state: "merged" });
    session.prObservation.profileId = "generated-other-profile";
    assert.equal(sessionPullRequest(session, snapshot), null);
    session.prObservation = observation(session, snapshot, { state: "merged", diagnostic: "Generated unverified result." });
    assert.equal(sessionIndicator(session, snapshot).kind, "completed");
  } finally { await fixture.close(); }
});

test("managed-workspace PR resolution binds its exact change set and never borrows the base checkout", async () => {
  const fixture = await setupFixture();
  try {
    const snapshot = structuredClone(fixture.service.controller.snapshot()), session = snapshot.sessions[0]!, projectId = fixture.session().projectId;
    const path = join(fixture.directory, "generated-managed-root");
    snapshot.managedWorkspaces.push({ id: "generated-workspace", projectId, path, branch: "generated-branch", baseCommit: "a".repeat(40), gitCommonDir: join(fixture.project, ".git"),
      status: "ready", revision: 0, createdAt: new Date().toISOString(), jobId: null, diagnostic: null, identity: { device: "1", inode: "2" }, changeSetId: "generated-change" });
    snapshot.changeSets.push({ id: "generated-change", projectId, workspaceId: "generated-workspace", branch: "generated-branch", baseCommit: "a".repeat(40),
      issueId: null, prUrl: url(), createdAt: new Date().toISOString() });
    session.workspaceId = "generated-workspace";
    assert.equal(sessionPullRequestUrl(session, snapshot), url());
    assert.equal(sessionPrScope(session, snapshot)?.root, path);
    session.prObservation = observation(session, snapshot, { state: "merged" });
    snapshot.managedWorkspaces[0]!.revision++;
    assert.equal(sessionPullRequest(session, snapshot), null, "a new retained root revision cannot adopt an old observation");
    snapshot.changeSets[0]!.id = "generated-unrelated-change";
    assert.equal(sessionPullRequestUrl(session, snapshot), null);
    session.prUrl = url();
    snapshot.managedWorkspaces[0]!.status = "removed";
    assert.equal(sessionPrScope(session, snapshot), null);
    session.projectId = null; session.workspaceId = null;
    assert.deepEqual(sessionPrScope(session, snapshot), { url: url(), projectId: null, workspaceId: null, root: null, workspaceRevision: null, access: "public", configurationRevision: null });
  } finally { await fixture.close(); }
});

test("a matching work item's current PR observation supersedes old session metadata without another read", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const ticket = await sdk.issues.create(fixture.session().projectId, { title: "Generated status ticket", body: "", kind: "misc", phaseId: "backlog", pullRequestUrl: null });
    const snapshot = structuredClone(sdk.getState().snapshot!), session = snapshot.sessions[0]!, issue = snapshot.issues.find((issue) => issue.id === ticket.id)!;
    session.workItemId = issue.id; session.prUrl = url(); session.status = "completed";
    session.prObservation = observation(session, snapshot, { state: "open", draft: false });
    issue.pullRequest = { ...linked(), state: "merged", draft: false, checkedAt: new Date().toISOString() };
    assert.equal(sessionIndicator(session, snapshot).kind, "merged");
    assert.equal(sessionPullRequest(session, snapshot), issue.pullRequest);
    delete issue.pullRequest.draft;
    issue.pullRequest.state = "open";
    assert.equal(sessionIndicator(session, snapshot).prState, "unknown", "legacy open metadata cannot be guessed ready");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("all status hues meet non-text contrast for named, extreme custom and hover/selected backgrounds", () => {
  const backgrounds = new Set<string>();
  for (const palette of ["moguri", "ocean", "orchid", "rose", "terminal", "aubergine", "ember", "monochrome", "vaporwave", "crystal"] as const) for (const theme of ["dark", "light"] as const) {
    const colors = appearanceColors({ theme, palette }, theme);
    for (const background of [colors.sidebar, colors.hover, colors.selected]) backgrounds.add(background);
  }
  for (let index = 0; index < 256; index++) backgrounds.add(`#${index.toString(16).padStart(2, "0").repeat(3)}`);
  for (const background of ["#ffee00", "#00ffff", "#ff00ff", "#35006f", "#08e9a1"]) backgrounds.add(background);
  for (const background of backgrounds) for (const [kind, color] of Object.entries(sessionIndicatorColors(background))) {
    assert.ok(colorContrast(color, background) >= 3, `${kind} on ${background}: ${color}`);
  }
});

test("linking a PR retains verified draft state without changing drafts, ordering revisions or lifecycle, and survives restart", async () => {
  let reads = 0;
  const fetch: typeof globalThis.fetch = async (input, options) => {
    assert.equal(String(input), "https://api.github.com/repos/generated/project/pulls/7");
    assert.equal(new Headers(options?.headers).has("authorization"), false);
    assert.equal(options?.method ?? "GET", "GET"); reads++;
    return Response.json(response(7, true));
  };
  const fixture = await setupFixture({ platform: { integrations: { fetch } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined;
  try {
    const before = structuredClone(fixture.session());
    await sdk.sessions.organize(fixture.sessionId, { prUrl: url() });
    const observed = await waitFor(() => sdk.getState().snapshot?.sessions.find((session) => session.id === fixture.sessionId)?.prObservation);
    const current = fixture.session(), organized = fixture.service.store.events().findLast((event) => event.event_type === "session.organized")!;
    assert.equal(observed.pullRequest.state, "open"); assert.equal(observed.pullRequest.draft, true);
    assert.equal(observed.scope.root, await realpath(fixture.project));
    assert.deepEqual(current.draft, before.draft); assert.equal(current.status, before.status);
    assert.equal(current.revision, before.revision + 1); assert.equal(current.updatedAt, organized.timestamp);
    assert.equal(current.order, before.order); assert.equal(current.unread, before.unread);
    assert.equal(reads, 1); assert.equal(fixture.requests.length, 0);
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey, platform: { integrations: { fetch } } });
    peer = await new MoguriSdk(restarted.connection).ready();
    assert.deepEqual(peer.getState().snapshot!.sessions.find((session) => session.id === fixture.sessionId)?.prObservation, observed);
    assert.equal(reads, 1, "fresh metadata is retained, not automatically replayed on restart");
  } finally { sdk.disconnect(); peer?.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("project-free PR reads stay public and root-null even when authenticated project access is configured", async () => {
  let publicReads = 0, authenticatedReads = 0;
  const fixture = await setupFixture({ platform: { integrations: {
    fetch: async () => { publicReads++; return Response.json(response()); },
    githubCliRead: async () => { authenticatedReads++; throw new Error("A previous project/account must never be borrowed."); },
  } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const { configuration } = await sdk.projects.configuration(fixture.session().projectId);
    await sdk.projects.configure(fixture.session().projectId, { ...configuration.values, repo: { ...configuration.values.repo, githubAccess: "gh-cli" } }, configuration.revision);
    const chat = await sdk.sessions.create(null, "Generated public-only PR chat");
    await sdk.sessions.organize(chat.id!, { prUrl: url() });
    const observed = await waitFor(() => sdk.getState().snapshot?.sessions.find((session) => session.id === chat.id)?.prObservation);
    assert.equal(observed.scope.root, null); assert.equal(observed.scope.projectId, null);
    assert.equal(observed.scope.workspaceId, null); assert.equal(observed.scope.access, "public");
    assert.equal(publicReads, 1); assert.equal(authenticatedReads, 0); assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("direct from-work verification cannot publish a session after its configured PR access changes", async () => {
  const gate = Promise.withResolvers<Response>(); let started = false;
  const fixture = await setupFixture({ platform: { integrations: { fetch: async () => { started = true; return gate.promise; } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const before = sdk.getState().snapshot!.sessions.length, projectId = fixture.session().projectId;
    const pending = sdk.sessions.fromWork(projectId, { prUrl: url() });
    const rejected = assert.rejects(pending, { code: "session_pr_stale" });
    await waitFor(() => started);
    const { configuration } = await sdk.projects.configuration(projectId);
    await sdk.projects.configure(projectId, { ...configuration.values, repo: { ...configuration.values.repo, githubAccess: "gh-cli" } }, configuration.revision);
    gate.resolve(Response.json(response()));
    await rejected;
    assert.equal(sdk.getState().snapshot!.sessions.length, before);
    assert.equal(fixture.service.store.events().filter((event) => event.event_type === "session.pr_observed").length, 0);
    assert.equal(fixture.requests.length, 0);
  } finally { gate.resolve(Response.json(response())); sdk.disconnect(); await fixture.close(); }
});

test("retained PR projection rejects cross-root/profile observations and does not reorder session activity", async () => {
  const fixture = await setupFixture();
  try {
    const history = fixture.service.store.events(), snapshot = fixture.service.controller.snapshot(), session = structuredClone(snapshot.sessions[0]!);
    session.prUrl = url();
    const organized: StoredEvent = { event_type: "session.organized", profile_id: snapshot.profileId, project_id: session.projectId, session_id: session.id,
      payload: { changes: { prUrl: url() } }, schema_version: 1, id: "generated-pr-link", seq: history.length + 1, timestamp: "2026-01-01T00:00:00Z", work_item_id: null, parent_event_id: null };
    const retained = observation(session, snapshot, { state: "merged" });
    const event: StoredEvent = { ...organized, event_type: "session.pr_observed", payload: { observation: retained }, id: "generated-pr-observation",
      seq: history.length + 2, timestamp: "2026-01-02T00:00:00Z" };
    const projected = projectEvents([...history, organized, event], snapshot.profileId).sessions.find((session) => session.id === fixture.sessionId)!;
    assert.equal(projected.updatedAt, organized.timestamp);
    assert.equal(projected.revision, session.revision + 1);
    for (const change of [
      { ...retained, profileId: "generated-foreign-profile" },
      { ...retained, scope: { ...retained.scope, root: join(fixture.directory, "generated-foreign-root") } },
      { ...retained, scope: { ...retained.scope, access: "gh-cli" as const } },
    ]) assert.throws(() => projectEvents([...history, organized, { ...event, payload: { observation: change } }], snapshot.profileId), /exact session\/profile\/root\/access binding/);
  } finally { await fixture.close(); }
});

test("read-only observation refreshes draft, ready and merged states, and stable merged metadata is not polled", async (t) => {
  const fixture = await setupFixture();
  let draft = true, merged = false, reads = 0;
  const value = harness(fixture, { fetch: async () => { reads++; return Response.json(response(7, draft, merged)); } });
  value.session.prUrl = url(); value.observer.start();
  try {
    await waitFor(() => value.writes.length === 1);
    assert.equal(value.session.prObservation?.pullRequest.draft, true);
    const advance = async (milliseconds: number) => {
      const now = Date.now(), mocked = t.mock.method(Date, "now", () => now + milliseconds);
      value.observer.changed(); await Promise.resolve(); mocked.mock.restore();
    };
    await advance(120_001); await waitFor(() => reads === 2); await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(value.writes.length, 1, "an unchanged poll only reschedules and appends no observation");
    draft = false; await advance(240_002);
    await waitFor(() => value.writes.length === 2);
    assert.equal(value.session.prObservation?.pullRequest.state, "open"); assert.equal(value.session.prObservation?.pullRequest.draft, false);
    merged = true; await advance(360_003);
    await waitFor(() => value.writes.length === 3);
    assert.equal(value.session.prObservation?.pullRequest.state, "merged");
    await advance(480_004); await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(reads, 4); assert.equal(fixture.requests.length, 0);
  } finally { value.observer.close(); await fixture.close(); }
});

test("cancellation retains the four actual in-flight slots until even uncooperative reads settle", async () => {
  const fixture = await setupFixture(), gates: { number: number; gate: ReturnType<typeof Promise.withResolvers<Response>> }[] = [];
  let active = 0, maximum = 0;
  const value = harness(fixture, { fetch: async (input) => {
    const number = Number(String(input).split("/").at(-1)), gate = Promise.withResolvers<Response>();
    gates.push({ number, gate }); active++; maximum = Math.max(maximum, active);
    try { return await gate.promise; } finally { active--; }
  } });
  value.snapshot.sessions = Array.from({ length: 8 }, (_, index) => ({ ...structuredClone(value.session), id: `generated-observer-${index}`, prUrl: url(index + 1) }));
  value.observer.start();
  try {
    await waitFor(() => gates.length === 4);
    value.snapshot.projects[0]!.path = join(fixture.directory, "generated-new-bound-root"); value.observer.changed();
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(gates.length, 4, "aborted-but-unsettled requests are still in-flight");
    for (const entry of gates.slice()) entry.gate.resolve(Response.json(response(entry.number)));
    await waitFor(() => gates.length === 8);
    assert.equal(value.writes.length, 0, "old-root results are discarded");
    value.observer.close();
    for (const entry of gates.slice(4)) entry.gate.resolve(Response.json(response(entry.number)));
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(value.writes.length, 0); assert.equal(maximum, 4);
  } finally {
    value.observer.close();
    for (const entry of gates) entry.gate.resolve(Response.json(response(entry.number)));
    await fixture.close();
  }
});

test("revoked auto-refresh, deleted sessions and shutdown discard late PR results without resurrection", async () => {
  const fixture = await setupFixture();
  try {
    for (const action of ["revoke", "delete", "close"] as const) {
      const gate = Promise.withResolvers<Response>(); let started = false;
      const value = harness(fixture, { fetch: async () => { started = true; return gate.promise; } });
      value.session.prUrl = url(); value.observer.start();
      try {
        await waitFor(() => started);
        if (action === "revoke") value.snapshot.boards.push({ ...defaultBoard(fixture.session().projectId), autoRefreshPrs: false });
        if (action === "delete") value.snapshot.sessions = [];
        if (action === "close") value.observer.close();
        value.observer.changed(); gate.resolve(Response.json(response(7, false, true)));
        await new Promise((resolve) => setTimeout(resolve, 25));
        assert.equal(value.writes.length, 0, action);
      } finally { value.observer.close(); gate.resolve(Response.json(response())); }
    }
  } finally { await fixture.close(); }
});

test("authenticated observation uses only the exact managed root and rechecks it after reading", async () => {
  const fixture = await setupFixture(); let root = "", publicReads = 0;
  const value = harness(fixture, {
    fetch: async () => { publicReads++; throw new Error("No public fallback."); },
    githubCliRead: async (endpoint, capturedRoot) => { assert.equal(endpoint, "repos/generated/project/pulls/7"); root = capturedRoot; return response(); },
  });
  try {
    const projectId = fixture.session().projectId, configuration = defaultProjectConfiguration(projectId), path = join(fixture.directory, "generated-exact-managed-root");
    configuration.values.repo.githubAccess = "gh-cli"; value.snapshot.projectConfigurations = [configuration];
    value.snapshot.managedWorkspaces.push({ id: "generated-managed-pr", projectId, path, branch: "generated", baseCommit: "a".repeat(40), gitCommonDir: join(fixture.project, ".git"),
      status: "ready", revision: 0, createdAt: new Date().toISOString(), jobId: null, diagnostic: null, identity: { device: "1", inode: "2" }, changeSetId: "generated-pr-change" });
    value.session.workspaceId = "generated-managed-pr"; value.session.prUrl = url(); value.observer.start();
    await waitFor(() => value.writes.length === 1);
    assert.equal(root, path); assert.deepEqual(value.roots, [path, path]); assert.equal(publicReads, 0);
  } finally { value.observer.close(); await fixture.close(); }
});

test("unverified PR responses retain explicit diagnostics, never guess draft/merge, and failures are backoff-bounded", async (t) => {
  const fixture = await setupFixture(), errors = t.mock.method(console, "error", () => {});
  let reads = 0;
  const value = harness(fixture, { fetch: async () => {
    reads++;
    const { draft: _, ...missingDraft } = response(7, false, true);
    return Response.json(missingDraft);
  } }, 5);
  value.session.prUrl = url(); value.observer.start();
  try {
    await waitFor(() => value.writes.length === 1);
    assert.equal(value.session.prObservation?.pullRequest.state, "unknown");
    assert.equal(value.session.prObservation?.pullRequest.draft, null);
    assert.match(value.session.prObservation!.pullRequest.diagnostic!, /did not verify/);
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(reads, 1); assert.equal(errors.mock.callCount(), 1);
  } finally { value.observer.close(); await fixture.close(); }
});

test("malformed legacy links and failed metadata commits cannot create immediate retry loops", async (t) => {
  const fixture = await setupFixture(), errors = t.mock.method(console, "error", () => {});
  const invalid = harness(fixture, {}, 5);
  invalid.session.prUrl = "generated-invalid-legacy-pr"; invalid.observer.start();
  try {
    await waitFor(() => errors.mock.callCount() === 1);
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(errors.mock.callCount(), 1); assert.equal(invalid.writes.length, 0);
    invalid.observer.close();
    const snapshot = structuredClone(fixture.service.controller.snapshot()); snapshot.sessions[0]!.prUrl = url();
    let reads = 0, commits = 0;
    const failed = new SessionPrObserver({
      snapshot: () => snapshot, assertRoot: async () => {},
      commit: () => { commits++; throw new Error("Generated metadata transaction failure."); },
    }, new ProjectIntegrations(fixture.terminalVault, { fetch: async () => { reads++; return Response.json(response()); } }), 5);
    failed.start();
    try {
      await waitFor(() => commits === 1);
      await new Promise((resolve) => setTimeout(resolve, 35));
      assert.equal(reads, 1); assert.equal(commits, 1); assert.equal(errors.mock.callCount(), 2);
    } finally { failed.close(); }
  } finally { invalid.observer.close(); await fixture.close(); }
});
