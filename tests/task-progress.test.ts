import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EventStore, digest } from "../apps/service/src/store.ts";
import { TaskProgressRuntime } from "../apps/service/src/task-progress.ts";
import { MoguriSdk, planChecklist, progressBar, type ModelAdviceSource } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";

test("plan progress counts generated nested Markdown checkboxes, not code or ordinary prose", () => {
  assert.deepEqual(planChecklist("- [x] Generated first\n  - [ ] Generated second\n1. [X] Third\r\n````md\n- [x] Not work\n```\n- [x] Still code\n````\n~~~\n- [ ] Also code\n~~~\n[x] Prose\n"), { completed: 2, total: 3, percent: 67 });
  assert.deepEqual(planChecklist("Generated plan without a checklist."), { completed: 0, total: 0, percent: null });
  assert.equal(progressBar(null, 4), "[????] unknown");
  assert.equal(progressBar(50, 4), "[##--] 50%");
});

test("SDK progress reads the actual plan, rechecks changed bytes and keeps project-free scope empty", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await mkdir(join(fixture.project, "docs"));
    const path = join(fixture.project, "docs", "plan.md");
    await writeFile(path, "- [x] Generated first\n- [ ] Generated second\n");
    const first = (await sdk.sessions.progress(fixture.sessionId)).progress;
    assert.equal(first.checklist.percent, 50);
    await writeFile(path, "- [x] Generated first\n- [x] Generated second\n");
    const second = (await sdk.sessions.progress(fixture.sessionId)).progress;
    assert.equal(second.checklist.percent, 100);
    assert.notEqual(second.checklist.digest, first.checklist.digest);
    const free = await sdk.sessions.create(null);
    const empty = (await sdk.sessions.progress(free.id!)).progress;
    assert.equal(empty.checklist.path, null); assert.equal(empty.checklist.percent, null);
    assert.equal(fixture.requests.length, 0);
    await assert.rejects(() => sdk.sessions.progress("generated-other-session"), /session|profile/i);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("model progress binds the exact current plan and owning turn, stays advice, and cannot survive cancellation or a new task", async () => {
  const fixture = await setupFixture(), store = new EventStore(":memory:");
  let session = { ...fixture.session(), turnId: "generated-turn", status: "running" as const };
  let text = "- [x] Generated first\n- [ ] Generated remaining\n", now = Date.now();
  const source: ModelAdviceSource = { actor: "model", modelId: "generated-model", providerId: "generated-provider", stepId: "generated-step", callId: "generated-call" };
  const runtime = new TaskProgressRuntime({
    profileId: "default", session: () => session, events: () => store.events(), binding: (value) => `${value.turnId}:${value.controls.env}`,
    plan: async () => ({ path: "docs/plan.md", text, digest: digest(text), exists: true }),
    commit: (events) => { store.commit(events); },
  }, () => now);
  try {
    store.commit([{ event_type: "turn.started", profile_id: "default", session_id: session.id, project_id: session.projectId, turn_id: session.turnId,
      payload: { item: { id: "generated-item", text: "Generated task", attachments: [], delivery: "queue" }, controls: session.controls, policyRevision: 0 } }]);
    await assert.rejects(() => runtime.tool(session.id, session.turnId, source, { action: "report", percent: 90, summary: "Generated bounded advice.", planDigest: digest(text) }, new AbortController().signal), /one minute/);
    now += 61_000;
    const reported = await runtime.tool(session.id, session.turnId, source, { action: "report", percent: 90, summary: "Generated bounded advice.", planDigest: digest(text) }, new AbortController().signal);
    assert.equal(reported.checklist.percent, 50); assert.equal(reported.model?.percent, 90);
    assert.equal(reported.disagreement, true); assert.equal(reported.model?.source.actor, "model");
    assert.equal(session.status, "running");
    text += "- [ ] Generated new work\n";
    assert.equal((await runtime.read(session.id)).model?.stale, true);
    await assert.rejects(() => runtime.tool(session.id, session.turnId, source, { action: "report", percent: 100, summary: "Generated stale advice.", planDigest: "a".repeat(64) }, new AbortController().signal), /plan changed/i);
    const abort = new AbortController(); abort.abort();
    await assert.rejects(() => runtime.tool(session.id, session.turnId, source, { action: "read" }, abort.signal), /abort/i);
    session = { ...session, turnId: "generated-next-turn" };
    assert.equal((await runtime.read(session.id)).model, null);
    await assert.rejects(() => runtime.tool(session.id, "generated-turn", source, { action: "read" }, new AbortController().signal), /no longer owns/i);
    assert.equal(store.events().filter((event) => event.event_type === "task.progress_reported").length, 1);
  } finally { store.close(); await fixture.close(); }
});

test("a changed task binding invalidates an in-flight progress read instead of showing old completion", async () => {
  const fixture = await setupFixture();
  let session = fixture.session(), release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const runtime = new TaskProgressRuntime({
    profileId: "default", session: () => session, events: () => [], binding: (value) => value.controls.env,
    plan: async () => { await gate; return { path: "docs/plan.md", text: "- [x] Generated old work", digest: "a".repeat(64), exists: true }; }, commit: () => assert.fail("A read cannot persist a report."),
  });
  try {
    const read = runtime.read(session.id);
    session = { ...session, controls: { ...session.controls, env: "Remote" } }; release();
    await assert.rejects(() => read, /binding changed/i);
  } finally { release(); await fixture.close(); }
});
