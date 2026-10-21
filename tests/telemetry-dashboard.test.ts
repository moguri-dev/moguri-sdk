import test from "node:test";
import assert from "node:assert/strict";
import { BudgetRuntime, budgetWindow } from "../apps/service/src/budgets.ts";
import type { BudgetEntry, BudgetRate, Snapshot } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";

async function telemetryFixture() {
  const fixture = await setupFixture(); await fixture.configure();
  const current = fixture.session();
  let snapshot: Snapshot = { ...structuredClone(fixture.service.controller.snapshot()), budgetEntries: [], budgetPolicy: { revision: 1, limit: { basis: "estimate", tokens: 1000 } } };
  const runtime = new BudgetRuntime({ snapshot: () => snapshot, events: () => [] });
  const reserved = runtime.reserve(current, { stepId: "generated-template", turnId: "generated-turn", role: "solver", providerId: "generated", apiModelId: fixture.modelId, inputEstimate: 30, maxOutputTokens: 128 });
  if (reserved.event.event_type !== "budget.recorded") throw new Error("Generated telemetry reservation was not recorded.");
  const template = reserved.event.payload.entry;
  const rate: BudgetRate = { modelId: fixture.modelId, inputUsdPerMillion: 1, outputUsdPerMillion: 2, effectiveAt: "2024-01-01", source: "user-estimate" };
  const entry = (id: string, createdAt: string, changes: Partial<BudgetEntry> = {}): BudgetEntry => ({
    ...template, id, createdAt, status: "settled", reportedTokens: 42, estimatedUsdMicros: 54, rate,
    inputTokens: 30, outputTokens: 12, cacheReadTokens: 10, cacheWriteTokens: null,
    stream: { firstOutputMs: 10, streamMs: 50, outputEvents: 3, cacheReadReported: true, cacheWriteReported: false },
    requestMs: 100, outcome: "stop", ...changes,
  });
  return { ...fixture, runtime, current, entry, rate, set: (entries: BudgetEntry[]) => { snapshot = { ...snapshot, budgetEntries: entries }; } };
}

test("UTC presets cover exact calendar days and leap years, including inclusive custom endpoints", () => {
  const now = Date.parse("2024-03-01T23:59:59.999Z"), day = 86_400_000;
  for (const days of [7, 30, 60, 90, 365] as const) {
    const window = budgetWindow({ kind: "days", days }, now);
    assert.equal(window.to, Date.parse("2024-03-02T00:00:00.000Z")); assert.equal(window.to! - window.from!, days * day);
  }
  const leap = budgetWindow({ kind: "year", year: 2024 }, now); assert.equal(leap.to! - leap.from!, 366 * day);
  const custom = budgetWindow({ kind: "custom", from: "2024-02-29", to: "2024-02-29" }, now); assert.equal(custom.to! - custom.from!, day);
});

test("UTC calendar windows and day/week/month buckets preserve unknown dates and do not alter cumulative admission", async () => {
  const fixture = await telemetryFixture();
  try {
    const { entry, rate } = fixture;
    fixture.set([
      entry("generated-january", "2024-01-01T00:00:00.000Z"),
      entry("generated-february", "2024-02-28T23:59:59.999Z"),
      entry("generated-leap-day", "2024-02-29T12:00:00.000Z", { rate: { ...rate, inputUsdPerMillion: 2, outputUsdPerMillion: 4 }, estimatedUsdMicros: 108 }),
      entry("generated-unknown-report", "2024-03-01T00:00:00.000Z", { status: "unknown", reportedTokens: null, estimatedUsdMicros: null, inputTokens: null, outputTokens: null, cacheReadTokens: null, stream: null }),
      entry("generated-imported-time", "2024-02-29T12:00:00.000Z", { imported: true }),
    ]);
    const before = fixture.runtime.status(fixture.current.id);
    const result = fixture.runtime.query({ type: "budget.dashboard", range: { kind: "custom", from: "2024-02-28", to: "2024-02-29" }, bucket: "day" });
    assert.equal(result.type, "budget.dashboard"); if (result.type !== "budget.dashboard") return;
    assert.equal(result.totals.calls, 2); assert.equal(result.totals.reportedTokens, 84); assert.equal(result.totals.estimatedUsd, 0.000162);
    assert.equal(result.window.excludedUncertainTimeCalls, 1);
    assert.deepEqual(result.periods.map((period) => [period.from, period.totals.calls]), [["2024-02-28", 1], ["2024-02-29", 1]]);
    const weekly = fixture.runtime.query({ type: "budget.dashboard", range: { kind: "custom", from: "2024-02-28", to: "2024-02-29" }, bucket: "week" });
    assert.equal(weekly.type, "budget.dashboard"); if (weekly.type === "budget.dashboard") assert.deepEqual(weekly.periods.map((period) => [period.from, period.totals.calls]), [["2024-02-26", 2]]);
    const year = fixture.runtime.query({ type: "budget.dashboard", range: { kind: "year", year: 2024 }, bucket: "month" });
    assert.equal(year.type, "budget.dashboard"); if (year.type === "budget.dashboard") {
      assert.equal(year.totals.calls, 4); assert.equal(year.totals.reportedTokens, null);
      assert.deepEqual(year.periods.map((period) => period.from), ["2024-01-01", "2024-02-01", "2024-03-01"]);
    }
    const all = fixture.runtime.query({ type: "budget.dashboard", bucket: "month" });
    assert.equal(all.type, "budget.dashboard"); if (all.type === "budget.dashboard") {
      assert.equal(all.totals.calls, 5); assert.equal(all.window.uncertainTimeCalls, 1);
      assert.equal(all.periods.at(-1)?.from, null);
    }
    assert.deepEqual(fixture.runtime.status(fixture.current.id), before);
  } finally { await fixture.close(); }
});

test("dashboard pricing keeps captured dated estimates, explicit zero and unpriced calls distinct from bills", async () => {
  const fixture = await telemetryFixture();
  try {
    fixture.set([
      fixture.entry("generated-free-estimate", "2024-02-29T12:00:00.000Z", { rate: { ...fixture.rate, inputUsdPerMillion: 0, outputUsdPerMillion: 0 }, estimatedUsdMicros: 0 }),
      fixture.entry("generated-unpriced", "2024-02-29T13:00:00.000Z", { rate: null, estimatedUsdMicros: null }),
    ]);
    const result = fixture.runtime.query({ type: "budget.dashboard" });
    assert.equal(result.type, "budget.dashboard"); if (result.type !== "budget.dashboard") return;
    assert.equal(result.totals.estimatedUsd, null); assert.equal(result.totals.knownEstimatedUsd, 0); assert.equal(result.totals.unpricedCalls, 1);
    assert.equal(result.pricing.length, 1); assert.equal(result.pricing[0]?.rate.source, "user-estimate");
    assert.equal(result.pricing[0]?.rate.inputUsdPerMillion, 0); assert.equal(result.pricing[0]?.calls, 1);
    assert.equal(result.totals.providerReportedUsd, null); assert.equal(result.totals.billedUsd, null);
  } finally { await fixture.close(); }
});

test("retained per-call telemetry orders pages deterministically and exposes rates only for actually timed generative reports", async () => {
  const fixture = await telemetryFixture();
  try {
    fixture.set([
      fixture.entry("generated-a", "2024-02-29T12:00:00.000Z"),
      fixture.entry("generated-b", "2024-02-29T13:00:00.000Z", { stream: null }),
      fixture.entry("generated-c", "2024-02-29T14:00:00.000Z", { role: "decision" }),
    ]);
    const result = fixture.runtime.query({ type: "budget.dashboard" });
    assert.equal(result.type, "budget.dashboard"); if (result.type !== "budget.dashboard") return;
    assert.equal(result.totals.observedOutputTokensPerSecond, 240);
    assert.equal(result.totals.measuredStreamCalls, 1); assert.equal(result.totals.unmeasuredStreamCalls, 2);
    assert.equal(result.totals.outputTokens, 36); assert.equal(result.totals.inputTokens, 90);
    assert.equal(result.totals.cacheReadTokens, 30); assert.equal(result.totals.reportedTokens, 126);
    const page = fixture.runtime.query({ type: "budget.calls", offset: 0, limit: 1 });
    assert.equal(page.type, "budget.calls"); if (page.type !== "budget.calls") return;
    assert.equal(page.calls[0]?.id, "generated-c"); assert.equal(page.nextOffset, 1);
    const last = fixture.runtime.query({ type: "budget.calls", offset: 2, limit: 1 });
    assert.equal(last.type, "budget.calls"); if (last.type === "budget.calls") { assert.equal(last.calls[0]?.id, "generated-a"); assert.equal(last.nextOffset, null); }
  } finally { await fixture.close(); }
});

test("owning-turn filters include a model-created child's real turn without relabeling its execution identity", async () => {
  const fixture = await telemetryFixture();
  try {
    fixture.set([
      fixture.entry("generated-owner", "2024-02-29T12:00:00.000Z", { turnId: "generated-parent-turn", ownerTurnId: "generated-parent-turn" }),
      fixture.entry("generated-child", "2024-02-29T13:00:00.000Z", { sessionId: "generated-child-session", turnId: "generated-child-turn", ownerTurnId: "generated-parent-turn", role: "subagent" }),
    ]);
    const result = fixture.runtime.query({ type: "budget.dashboard", turnId: "generated-parent-turn" });
    assert.equal(result.type, "budget.dashboard"); if (result.type === "budget.dashboard") assert.equal(result.totals.reportedTokens, 84);
    const child = fixture.runtime.query({ type: "budget.calls", turnId: "generated-child-turn" });
    assert.equal(child.type, "budget.calls"); if (child.type === "budget.calls") {
      assert.equal(child.calls.length, 1); assert.equal(child.calls[0]?.turnId, "generated-child-turn"); assert.equal(child.calls[0]?.ownerTurnId, "generated-parent-turn");
    }
  } finally { await fixture.close(); }
});

test("invalid, reversed or unbounded daily date projections fail explicitly instead of silently changing the query", async () => {
  const fixture = await telemetryFixture();
  try {
    for (const range of [{ kind: "custom" as const, from: "2023-02-29", to: "2023-03-01" }, { kind: "custom" as const, from: "2024-03-02", to: "2024-03-01" }]) {
      assert.throws(() => fixture.runtime.query({ type: "budget.dashboard", range }), /date|range|UTC/i);
    }
    assert.throws(() => fixture.runtime.query({ type: "budget.dashboard", range: { kind: "custom", from: "2000-01-01", to: "2025-12-31" }, bucket: "day" }), /period|bucket|range/i);
    const start = Date.parse("2010-01-01T00:00:00.000Z"), date = (days: number) => new Date(start + days * 86_400_000).toISOString().slice(0, 10);
    assert.doesNotThrow(() => fixture.runtime.query({ type: "budget.dashboard", range: { kind: "custom", from: date(0), to: date(3659) }, bucket: "day" }));
    assert.throws(() => fixture.runtime.query({ type: "budget.dashboard", range: { kind: "custom", from: date(0), to: date(3660) }, bucket: "day" }), /3,660/);
  } finally { await fixture.close(); }
});
