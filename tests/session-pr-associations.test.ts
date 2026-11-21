import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import {
  MoguriSdk, projectEvents, sessionPrScope, type EventInput, type PullRequestLink, type Session, type SessionPrAssociation, type Snapshot, type StoredEvent,
} from "../packages/sdk/src/index.ts";
import { ProjectIntegrations, type IntegrationOptions } from "../apps/service/src/project-integrations.ts";
import { SessionPrObserver } from "../apps/service/src/session-prs.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture, waitFor } from "./fixture.ts";

const url = (number: number) => `https://github.com/generated/project/pull/${number}`;
const response = (number: number, draft = false, merged = false) => ({
  number, html_url: url(number), state: merged ? "closed" : "open", draft, merged, merged_at: merged ? "2026-01-01T00:00:00Z" : null,
});
const link = (number: number, changes: Partial<PullRequestLink> = {}): PullRequestLink => ({
  url: url(number), repo: "generated/project", number, state: "unknown", draft: null, checkedAt: null, diagnostic: null, ...changes,
});
function association(session: Session, snapshot: Pick<Snapshot, "profileId" | "issues" | "managedWorkspaces" | "changeSets" | "projects" | "projectConfigurations">,
  number: number, changes: Partial<PullRequestLink> = {}): SessionPrAssociation {
  const scope = sessionPrScope({ ...session, prUrl: url(number) }, snapshot);
  assert.ok(scope?.root && scope.projectId);
  return { version: 1, profileId: snapshot.profileId, sessionId: session.id, scope, pullRequest: link(number, changes),
    source: { version: 1, source: { kind: "pull", repository: "generated/project", account: "generated", number }, accountId: "generated:42",
      binding: { env: "Local", profileId: snapshot.profileId, projectId: scope.projectId, workspaceId: session.workspaceId,
        root: { root: scope.root, device: "1", inode: "2" }, configurationRevision: scope.configurationRevision ?? 0, policyRevision: 0, permissionRevision: 0 },
      digest: "a".repeat(64) } };
}
const associated = (value: SessionPrAssociation): EventInput => ({ event_type: "session.pr_associated", profile_id: value.profileId,
  project_id: value.scope.projectId, session_id: value.sessionId, payload: { association: value, actor: "user" } });

function harness(fixture: Awaited<ReturnType<typeof setupFixture>>, options: IntegrationOptions) {
  const snapshot = structuredClone(fixture.service.controller.snapshot()), writes: EventInput[] = [];
  const session = snapshot.sessions.find((session) => session.id === fixture.sessionId)!;
  const observer = new SessionPrObserver({
    snapshot: () => snapshot, assertRoot: async (_session, signal) => { signal.throwIfAborted(); },
    commit: (events) => {
      writes.push(...events);
      for (const event of events) {
        if (event.event_type !== "session.pr_observed") throw new Error(`Unexpected generated event ${event.event_type}.`);
        const observation = structuredClone(event.payload.observation);
        if (sessionPrScope(session, snapshot)?.url === observation.scope.url) session.prObservation = observation;
        session.prAssociations = session.prAssociations?.map((value) => value.scope.url === observation.scope.url ?
          { ...value, scope: observation.scope, pullRequest: observation.pullRequest } : value);
      }
    },
  }, new ProjectIntegrations(fixture.terminalVault, options));
  return { snapshot, writes, observer, session };
}
const observed = (writes: EventInput[]) => writes.flatMap((event) => event.event_type === "session.pr_observed" ? [event.payload.observation.pullRequest] : []);

test("every associated PR is observed in its own scope, unchanged polls append nothing and verified merges stop polling", async (t) => {
  const fixture = await setupFixture(), states = new Map([[7, { draft: false, merged: false }], [8, { draft: true, merged: false }], [9, { draft: false, merged: false }]]);
  const reads: number[] = [];
  const value = harness(fixture, { fetch: async (input) => {
    const number = Number(String(input).split("/").at(-1)), state = states.get(number)!; reads.push(number);
    return Response.json(response(number, state.draft, state.merged));
  } });
  value.session.prUrl = url(7);
  value.session.prAssociations = [association(value.session, value.snapshot, 8), association(value.session, value.snapshot, 9)];
  value.observer.start();
  const advance = async (milliseconds: number) => {
    const now = Date.now(), mocked = t.mock.method(Date, "now", () => now + milliseconds);
    value.observer.changed(); await Promise.resolve(); mocked.mock.restore();
  };
  try {
    await waitFor(() => value.writes.length === 3);
    assert.deepEqual(reads.toSorted(), [7, 8, 9]);
    assert.deepEqual(observed(value.writes).map((pr) => [pr.number, pr.state, pr.draft]).toSorted(), [[7, "open", false], [8, "open", true], [9, "open", false]]);
    assert.equal(value.session.prObservation?.pullRequest.number, 7);
    assert.deepEqual(value.session.prAssociations.map((entry) => [entry.pullRequest.state, entry.pullRequest.draft, entry.source?.source.number]), [["open", true, 8], ["open", false, 9]]);

    await advance(120_001); await waitFor(() => reads.length === 6); await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(value.writes.length, 3, "each URL dedupes against its own previous observation");
    states.set(9, { draft: false, merged: true });
    await advance(240_002); await waitFor(() => value.writes.length === 4);
    assert.deepEqual(observed(value.writes.slice(3)).map((pr) => [pr.number, pr.state]), [[9, "merged"]]);
    assert.equal(value.session.prAssociations[1]?.pullRequest.state, "merged");
    assert.equal(value.session.prObservation?.pullRequest.number, 7, "an associated PR never replaces the primary observation");
    await advance(360_003); await waitFor(() => reads.length === 11); await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(reads.slice(9).toSorted(), [7, 8], "a verified merged association is not polled again");
    assert.equal(fixture.requests.length, 0);
  } finally { value.observer.close(); await fixture.close(); }
});

test("a merged associated PR projects onto its association and survives restart; foreign URLs stay rejected", async () => {
  const states = new Map([[7, false], [8, false], [9, false]]);
  let reads = 0;
  const fetch: typeof globalThis.fetch = async (input) => {
    const number = Number(String(input).split("/").at(-1)); reads++;
    return Response.json(response(number, false, states.get(number)));
  };
  const fixture = await setupFixture({ platform: { integrations: { fetch } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, peer: MoguriSdk | undefined;
  try {
    await sdk.sessions.organize(fixture.sessionId, { prUrl: url(7) });
    await waitFor(() => fixture.session().prObservation);
    const snapshot = fixture.service.controller.snapshot();
    states.set(9, true);
    fixture.service.store.commit([associated(association(fixture.session(), snapshot, 8)), associated(association(fixture.session(), snapshot, 9))]);
    fixture.service.controller.refreshProfile(); await sdk.refresh();
    await sdk.sessions.organize(fixture.sessionId, { title: "Generated multi-PR session" });
    const session = await waitFor(() => {
      const value = sdk.getState().snapshot?.sessions.find((entry) => entry.id === fixture.sessionId);
      return value?.prAssociations?.every((entry) => entry.pullRequest.checkedAt && entry.pullRequest.state !== "unknown" &&
        (entry.pullRequest.number !== 9 || entry.pullRequest.state === "merged")) ? value : undefined;
    });
    assert.deepEqual(session.prAssociations!.map((entry) => [entry.pullRequest.number, entry.pullRequest.state, entry.source?.source.number]), [[8, "open", 8], [9, "merged", 9]]);
    assert.equal(session.prObservation?.pullRequest.number, 7); assert.equal(session.prUrl, url(7));
    const observations = fixture.service.store.events().filter((event) => event.event_type === "session.pr_observed");
    assert.equal(observations.length, 3);

    const history = fixture.service.store.events(), base = observations.at(-1)!;
    const foreign = { ...base, id: "generated-foreign-observation", seq: history.length + 1, payload: { observation: { ...structuredClone(base.payload.observation),
      scope: { ...base.payload.observation.scope, url: url(10) }, pullRequest: { ...base.payload.observation.pullRequest, url: url(10), number: 10 } } } } as StoredEvent;
    assert.throws(() => projectEvents([...history, foreign], snapshot.profileId), /exact session\/profile\/root\/access binding/);
    const shifted = { ...base, id: "generated-shifted-observation", seq: history.length + 1, payload: { observation: { ...structuredClone(base.payload.observation),
      scope: { ...base.payload.observation.scope, root: join(fixture.directory, "generated-foreign-root") } } } } as StoredEvent;
    assert.throws(() => projectEvents([...history, shifted], snapshot.profileId), /exact session\/profile\/root\/access binding/);

    sdk.disconnect(); await fixture.service.close();
    const before = reads;
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey, platform: { integrations: { fetch } } });
    peer = await new MoguriSdk(restarted.connection).ready();
    const replayed = peer.getState().snapshot!.sessions.find((entry) => entry.id === fixture.sessionId)!;
    assert.deepEqual(replayed.prAssociations, session.prAssociations);
    assert.deepEqual(replayed.prObservation, session.prObservation);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(reads, before, "fresh and merged observations are not replayed after restart");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); peer?.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("once a session has an associated PR its link can't be replaced or cleared, while plain links stay editable", async () => {
  const fixture = await setupFixture({ platform: { integrations: { fetch: async (input) => Response.json(response(Number(String(input).split("/").at(-1)))) } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.organize(fixture.sessionId, { prUrl: url(6) });
    await sdk.sessions.organize(fixture.sessionId, { prUrl: url(7) });
    assert.equal(fixture.session().prUrl, url(7));
    fixture.service.store.commit([associated(association(fixture.session(), fixture.service.controller.snapshot(), 8))]);
    fixture.service.controller.refreshProfile(); await sdk.refresh();
    const before = fixture.session();
    for (const prUrl of [url(9), url(8), null]) {
      await assert.rejects(() => sdk.sessions.organize(fixture.sessionId, { prUrl }), (error: Error & { code?: string }) =>
        error.code === "session_pr_locked" && /Nothing was changed/.test(error.message));
    }
    assert.equal(fixture.session().revision, before.revision); assert.equal(fixture.session().prUrl, url(7));
    await sdk.sessions.organize(fixture.sessionId, { prUrl: url(7), title: "Generated locked link" });
    assert.equal(fixture.session().title, "Generated locked link"); assert.equal(fixture.session().prUrl, url(7));
    assert.deepEqual(fixture.session().prAssociations?.map((entry) => entry.scope.url), [url(8)]);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a public-access read that GitHub answers 404 explains how to grant GitHub CLI access instead of a bare HTTP error", async () => {
  const integrations = new ProjectIntegrations({ read: async () => null, write: async () => {}, remove: async () => {} },
    { fetch: async () => new Response("{\"message\":\"Not Found\"}", { status: 404 }) });
  await assert.rejects(() => integrations.pullRequest({ url: "https://github.com/generated-owner/generated-private/pull/7", repo: "generated-owner/generated-private", number: 7,
    state: "unknown", draft: null, checkedAt: null, diagnostic: null }, { githubAccess: "public" }, null, AbortSignal.timeout(5_000)),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "github_public_access" && /GitHub CLI account/.test(error.message));
});
