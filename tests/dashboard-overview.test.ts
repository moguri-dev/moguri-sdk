import assert from "node:assert/strict";
import test from "node:test";
import { BudgetRuntime } from "../apps/service/src/budgets.ts";
import { dashboardOverview } from "../apps/service/src/dashboard.ts";
import { MoguriSdk, type BudgetEntry, type Snapshot, type StoredEvent } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";

test("dashboard projects and models retain all-role known/unknown accounting while velocity excludes control and interrupted turns", async () => {
  const fixture = await setupFixture();
  try {
    await fixture.configure();
    const snapshot: Snapshot = structuredClone(fixture.service.controller.snapshot()), session = snapshot.sessions[0]!;
    const runtime = new BudgetRuntime({ snapshot: () => snapshot, events: () => [] });
    const reserved = runtime.reserve(session, { stepId: "generated-dashboard-step", turnId: "generated-dashboard-turn", role: "solver", providerId: "generated", apiModelId: fixture.modelId, inputEstimate: 30, maxOutputTokens: 128 });
    assert.equal(reserved.event.event_type, "budget.recorded");
    if (reserved.event.event_type !== "budget.recorded") throw new Error("Generated budget template was not retained.");
    const today = new Date().toISOString().slice(0, 10), start = Date.parse(`${today}T00:00:00.000Z`);
    const time = (offset: number) => new Date(start + offset).toISOString(), base = reserved.event.payload.entry;
    const entries: BudgetEntry[] = [
      { ...base, id: "generated-known", createdAt: time(1000), status: "settled", reportedTokens: 42, inputTokens: 30, outputTokens: 12, estimatedUsdMicros: 54, role: "critic" },
      { ...base, id: "generated-unknown", createdAt: time(2000), status: "unknown", projectId: null, modelId: "generated-other-model", reportedTokens: null, estimatedUsdMicros: null, role: "decision" },
    ];
    snapshot.budgetEntries = entries;
    snapshot.sessions = [{ ...session, status: "completed", updatedAt: time(9000) },
      { ...session, id: "generated-active-chat", projectId: null, status: "running", turnId: "generated-active-turn" },
      { ...session, id: "generated-private-helper", kind: "subagent", status: "completed", updatedAt: time(15000) }];
    const prototype = fixture.service.controller.events(0)[0]!, events: StoredEvent[] = [];
    const turn = (id: string, offset: number, outcome: "completed" | "failed" | "partial" | "stopped", sessionId = session.id) => {
      events.push({ ...prototype, event_type: "turn.started", id: `${id}-start`, turn_id: id, session_id: sessionId, project_id: session.projectId,
        timestamp: time(offset), payload: { item: { id: `${id}-prompt`, text: "Generated dashboard fixture.", attachments: [], delivery: "queue" }, controls: session.controls, policyRevision: 0 } });
      events.push({ ...prototype, event_type: "turn.finished", id: `${id}-finish`, turn_id: id, session_id: sessionId, project_id: session.projectId,
        timestamp: time(offset + 2000), payload: { outcome, diagnostic: null } });
    };
    turn("generated-previous", -8 * 86_400_000, "completed");
    turn("generated-complete", 1000, "completed"); turn("generated-failed", 4000, "failed");
    turn("generated-partial", 7000, "partial"); turn("generated-stopped", 10000, "stopped");
    turn("generated-private", 13000, "completed", "generated-private-helper");
    events.push({ ...prototype, event_type: "tool.decided", turn_id: "generated-complete", project_id: session.projectId, timestamp: time(2500), payload: { approvalId: "generated-approval", allow: true, actor: "user" } });
    events.push({ ...prototype, event_type: "tool.decided", turn_id: "generated-complete", project_id: session.projectId, timestamp: time(2500), payload: { approvalId: "generated-policy-approval", allow: true, actor: "policy" } });
    events.push({ ...prototype, event_type: "turn.control_started", turn_id: "generated-control", project_id: session.projectId, timestamp: time(1000),
      payload: { purpose: "compaction", compactionId: "generated-compaction", controls: session.controls, policyRevision: 0, promptDigest: "0".repeat(64) } });
    events.push({ ...prototype, event_type: "turn.finished", turn_id: "generated-control", project_id: session.projectId, timestamp: time(9000), payload: { outcome: "completed", diagnostic: null } });
    const result = dashboardOverview(snapshot, events, runtime, { type: "dashboard.overview" }).dashboard;
    assert.equal(result.days.length, 7); assert.equal(result.work.inProgress, 1); assert.equal(result.work.completed, 1);
    assert.equal(result.totals.calls, 2); assert.equal(result.totals.reportedTokens, null); assert.equal(result.totals.knownReportedTokens, 42); assert.equal(result.totals.unknownTokenCalls, 1);
    assert.equal(result.totals.estimatedUsd, null); assert.equal(result.totals.knownEstimatedUsd, 0.000054); assert.equal(result.totals.unpricedCalls, 1);
    assert.equal(result.models.length, 2); assert.equal(result.projects.find((value) => value.projectId === null)?.totals.unknownTokenCalls, 1);
    assert.equal(result.velocity.completedTurns, 1); assert.equal(result.velocity.failedTurns, 1); assert.equal(result.velocity.interruptedTurns, 2);
    assert.equal(result.velocity.previousCompletedTurns, 1); assert.equal(result.velocity.completionChangePercent, 0);
    assert.equal(result.velocity.medianCompletionMs, 2000); assert.equal(result.velocity.interventions, 1); assert.equal(result.velocity.productivityIncrease, null);
    assert.equal(result.days.at(-1)!.totals.reportedTokens, null);
    const filtered = dashboardOverview(snapshot, events, runtime, { type: "dashboard.overview", projectId: session.projectId! }).dashboard;
    assert.equal(filtered.totals.calls, 1); assert.equal(filtered.work.total, 1);
    assert.equal(filtered.models.length, 1); assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});

test("a completed standalone MCP control job is not a completed agent task or an agent intervention", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const tool = (await sdk.mcp.tools("builtin", "grep", 0, fixture.sessionId)).tools[0]!;
    const admitted = await sdk.mcp.call(fixture.sessionId, "builtin", tool.name, { path: "fixture.txt", query: "original" }, tool.digest);
    assert.equal((await sdk.jobs.wait(admitted.id!)).status, "completed");
    const { dashboard } = await sdk.dashboard.overview();
    assert.equal(dashboard.velocity.completedTurns, 0); assert.equal(dashboard.velocity.interventions, 0);
    assert.equal(dashboard.totals.calls, 0); assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("dashboard date windows are exact and reject all-time or reversed ranges rather than silently changing them", async () => {
  const fixture = await setupFixture();
  try {
    const snapshot = fixture.service.controller.snapshot(), runtime = new BudgetRuntime({ snapshot: () => snapshot, events: () => [] });
    for (const days of [7, 30, 60, 90, 365] as const) assert.equal(dashboardOverview(snapshot, [], runtime, { type: "dashboard.overview", range: { kind: "days", days } }).dashboard.days.length, days);
    assert.equal(dashboardOverview(snapshot, [], runtime, { type: "dashboard.overview", range: { kind: "custom", from: "2024-02-28", to: "2024-03-01" } }).dashboard.days.length, 3);
    assert.throws(() => dashboardOverview(snapshot, [], runtime, { type: "dashboard.overview", range: { kind: "all" } }), /dated dashboard range/);
    assert.throws(() => dashboardOverview(snapshot, [], runtime, { type: "dashboard.overview", range: { kind: "custom", from: "2024-03-02", to: "2024-03-01" } }), /range|date/);
  } finally { await fixture.close(); }
});
