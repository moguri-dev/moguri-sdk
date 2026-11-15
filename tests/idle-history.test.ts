import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { startService, startupHealth } from "../apps/service/src/server.ts";
import { MoguriSdk, type EventInput, type LocalIssue } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { githubBoardFixture } from "./fixtures/github-board.ts";
import { generatedIssueRevisions } from "./fixtures/responsive-history.ts";

// Retained history is replayed on every start, so background loops must never append unchanged state.
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

test("an idle service with every GitHub poller due appends no history across many poll cycles", async (t) => {
  const reads: string[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    const number = Number(String(input).split("/").pop()); reads.push(String(input));
    return Response.json({ number, html_url: `https://github.com/generated/project/pull/${number}`, state: "open", draft: true, merged: false, merged_at: null });
  };
  const fixture = await setupFixture({ platform: { integrations: { fetch, prRefreshMs: 20 } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const projectId = fixture.session().projectId!;
    await sdk.issues.create(projectId, { title: "Generated idle card", body: "", kind: "feature", phaseId: "backlog", pullRequestUrl: "https://github.com/generated/project/pull/7" });
    await sdk.sessions.organize(fixture.sessionId, { prUrl: "https://github.com/generated/project/pull/8" });
    await waitFor(() => fixture.session().prObservation && fixture.service.controller.snapshot().issues[0]?.pullRequest?.checkedAt);
    await settle();
    let offset = 0;
    const now = Date.now.bind(Date);
    t.mock.method(Date, "now", () => now() + offset);
    const before = fixture.service.store.events().length;
    for (let cycle = 0; cycle < 10; cycle++) {
      const count = reads.length; offset += 125_000;
      await waitFor(() => reads.length >= count + 2); await settle();
    }
    assert.ok(reads.some((read) => read.endsWith("/7")) && reads.some((read) => read.endsWith("/8")));
    assert.equal(fixture.service.store.events().length, before, "unchanged polls only reschedule; they must not grow retained history");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("background GitHub polls record only a changed outcome and a requested refresh replaces an in-flight poll", async (t) => {
  const fixture = await githubBoardFixture({ refreshMs: 20 });
  try {
    await fixture.configure(true);
    assert.equal((await fixture.refresh()).status, "completed");
    const jobs = () => fixture.service.controller.snapshot().jobs.filter((job) => job.kind === "issues.refresh");
    const events = () => fixture.service.store.events().length;
    let offset = 0;
    const now = Date.now.bind(Date);
    t.mock.method(Date, "now", () => now() + offset);
    const poll = async () => { const count = fixture.reads.length; offset += 301_000; await waitFor(() => fixture.reads.length > count); await settle(); };
    const before = events(), recorded = jobs().length;
    await poll(); await poll();
    assert.equal(events(), before);
    fixture.state.beforeRead = async () => { throw new Error("Generated GitHub outage."); };
    await poll();
    await waitFor(() => jobs().length === recorded + 1);
    assert.equal(jobs().at(-1)!.status, "failed");
    const failed = events();
    await poll(); await poll();
    assert.equal(events(), failed, "a repeated identical failure is not new history");
    fixture.state.beforeRead = undefined;
    await poll();
    await waitFor(() => jobs().at(-1)?.status === "completed");
    assert.equal(jobs().length, recorded + 2);
    const gate = Promise.withResolvers<void>();
    let held = false;
    fixture.state.beforeRead = async (_query, signal) => {
      held = true;
      await new Promise<void>((resolve, reject) => { void gate.promise.then(resolve); signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
    };
    offset += 301_000; await waitFor(() => held);
    fixture.state.beforeRead = undefined;
    assert.equal((await fixture.refresh()).status, "completed", "a requested refresh gets its own waitable job instead of the poll's");
    gate.resolve(); await settle();
    assert.equal(jobs().at(-1)?.status, "completed");
  } finally { await fixture.close(); }
});

test("startup compaction drops polling-only card revisions and repeated refresh outcomes once, keeping every change", async () => {
  const fixture = await setupFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const projectId = fixture.session().projectId!, store = fixture.service.store;
    const issueOf = (event: EventInput): LocalIssue => { if (event.event_type !== "issue.saved") throw new Error("Generated card revision expected."); return event.payload.issue; };
    const history = generatedIssueRevisions(projectId, 1_000, 1).map((event, index) => {
      const issue = issueOf(event);
      issue.title = index < 600 ? "Generated first title" : "Generated edited title"; issue.body = "Generated stable body.";
      issue.github = { ...issue.github!, updatedAt: "2026-01-01T00:00:00.000Z", sourceDigest: "a".repeat(64), titleDigest: "b".repeat(64), bodyDigest: "c".repeat(64) };
      return event;
    });
    const unique = store.putBlob(JSON.stringify({ generated: "unique refresh result" })), shared = store.putBlob(JSON.stringify({ generated: "shared refresh result" }));
    const outcomes = [["completed", null, unique], ["completed", null, shared], ["completed", null, shared], ["failed", "Generated outage.", null], ["completed", null, shared]] as const;
    for (const [index, [status, error, resultDigest]] of outcomes.entries()) {
      const id = `generated-refresh-${index}`;
      history.push({ event_type: "job.started", profile_id: "default", project_id: projectId, payload: { job: {
        id, kind: "issues.refresh", projectId, sessionId: null, workspaceId: null, parentTurnId: null, status: "running", progress: "Generated poll", resultDigest: null, error: null } } },
      { event_type: "job.finished", profile_id: "default", project_id: projectId, payload: { jobId: id, status, resultDigest, error } });
    }
    store.commit(history);
    await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const kept = restarted.store.events().filter((event) => event.event_type === "issue.saved").map(issueOf);
    assert.deepEqual(kept.map((issue) => [issue.revision, issue.title]), [[599, "Generated first title"], [999, "Generated edited title"]]);
    assert.deepEqual(restarted.controller.snapshot().issues.find((issue) => issue.id === kept[1]!.id), kept[1]);
    const refreshes = restarted.controller.snapshot().jobs.filter((job) => job.kind === "issues.refresh");
    assert.deepEqual(refreshes.map((job) => [job.id, job.status]), [["generated-refresh-2", "completed"], ["generated-refresh-3", "failed"], ["generated-refresh-4", "completed"]]);
    const grants = (digest: string) => Number(restarted!.store.db.prepare("SELECT count(*) AS count FROM blob_payloads WHERE digest=?").get(digest)?.count);
    assert.equal(grants(unique), 0); assert.ok(grants(shared) > 0);
    assert.equal(restarted.store.blob(shared), JSON.stringify({ generated: "shared refresh result" }));
    assert.throws(() => restarted!.store.db.exec("DELETE FROM events WHERE seq=1"), /append-only/);
    const retained = restarted.store.events();
    await restarted.close(); restarted = undefined;
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const ids = new Set(restarted.store.events().map((event) => event.id));
    assert.ok(retained.every((event) => ids.has(event.id)), "an ordinary later start removes nothing");
  } finally { await restarted?.close(); await fixture.close(); }
});

test("startup health names a dominant background event type before history becomes slow", () => {
  const healthy = startupHealth({ events: 24_000, bytes: 40 * 1024 ** 2, types: [{ type: "tool.completed", count: 9_000 }] }, 800);
  assert.equal(healthy.warning, null);
  assert.match(healthy.info, /ready in 800 ms with 24000 retained events \(40 MiB\)/);
  const churn = startupHealth({ events: 145_434, bytes: 3 * 1024 ** 3, types: [{ type: "issue.saved", count: 120_711 }, { type: "job.started", count: 6_554 }] }, 20_000);
  assert.match(churn.warning ?? "", /issue\.saved holds 120711 of 145434.*state\.sqlite is 3072 MiB.*startup took 20000 ms.*issue\.saved=120711, job\.started=6554/);
});
