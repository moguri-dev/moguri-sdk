import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { normalizeContext } from "@earendil-works/pi-ai";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { modelRequest } from "../apps/service/src/model-controls.ts";
import { budgetPlanFixture } from "./fixtures/budget-plan-api.ts";
import { routingTransport } from "./fixtures/routing-prototype.ts";
import { waitFor } from "./fixture.ts";

test("a held plan consumes real session/profile/global capacity without inventing a model call, price report or bill", async () => {
  const f = await budgetPlanFixture();
  try {
    await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, budget: { kind: "limited", basis: "estimate", tokens: 30 } }, f.session().revision);
    await f.sdk.budgets.policy({ basis: "estimate", tokens: 30 }, 0, true);
    const plan = f.create(), status = f.budget.status(f.sessionId);
    assert.equal(status.remainingTokens, 0); assert.equal(status.totals.calls, 0); assert.equal(status.totals.reportedTokens, 0);
    assert.equal(status.totals.plannedHolds, 1); assert.equal(status.totals.plannedHeldTokens, 30); assert.equal(status.totals.heldTokens, 30);
    assert.equal(status.totals.plannedHeldUsd, null); assert.equal(status.totals.billedUsd, null);
    assert.throws(() => f.budget.reserve(f.session(), { ...f.request, stepId: randomUUID(), inputEstimate: 0, maxOutputTokens: 1 }), { code: "budget_exhausted" });
    const calls = f.budget.query({ type: "budget.calls" }), plans = f.budget.query({ type: "budget.plans" }), dashboard = f.budget.query({ type: "budget.dashboard", bucket: "day" });
    assert.ok(calls.type === "budget.calls"); assert.equal(calls.calls.length, 0);
    assert.ok(plans.type === "budget.plans"); assert.equal(plans.plans[0]?.id, plan.id);
    assert.ok(dashboard.type === "budget.dashboard"); assert.equal(dashboard.totals.calls, 0);
    assert.equal(dashboard.groups[0]?.totals.plannedHolds, 1); assert.equal(dashboard.periods[0]?.totals.heldTokens, 30);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("a real bounded checkpoint consumes planned capacity at the exact cap and settles one genuine provider report without double charging", async () => {
  const f = await budgetPlanFixture();
  try {
    const systemPrompt = "Generated planned checkpoint transport evidence. No tools or permission advice.", text = "Generated bounded role.";
    const context = normalizeContext({ systemPrompt, messages: [{ role: "user", content: text, timestamp: 0 }] });
    const spec = modelRequest(f.prepared.model, undefined, context), bounds = { inputEstimate: spec.estimatedTokens, maxOutputTokens: 64 };
    const plan = f.create(bounds); await f.sdk.budgets.policy({ basis: "estimate", tokens: plan.tokens }, 0, true);
    assert.equal(f.budget.status(f.sessionId).totals.calls, 0);
    assert.throws(() => f.budget.reserve(f.session(), { ...f.request, stepId: randomUUID(), inputEstimate: 0, maxOutputTokens: 1 }), { code: "budget_exhausted" });
    const admission = f.consume(plan.id, bounds);
    const result = await routingTransport()({ role: "checkpoint", modelId: f.modelId, prepared: f.prepared, output: admission.maxTokens,
      systemPrompt, text, signal: AbortSignal.timeout(5000), record: async () => {} });
    assert.equal(result.call.reportedTokens, 42); assert.equal(result.call.reportedOutputTokens, 12); assert.ok(typeof result.call.requestMs === "number");
    f.append([{ event_type: "model.completed", profile_id: f.control.profileId, session_id: f.sessionId, turn_id: f.request.turnId, step_id: admission.stepId,
      payload: { contextDigest: f.service.store.putBlob(JSON.stringify(context)),
        message: { id: admission.stepId, turnId: f.request.turnId, role: "assistant", text: result.text, timestamp: new Date().toISOString() },
        usage: { stepId: admission.stepId, modelId: f.modelId, apiModelId: f.prepared.model.id, providerId: f.prepared.model.provider, source: "local", role: "checkpoint",
          inputTokens: 30, outputTokens: result.call.reportedOutputTokens, totalTokens: result.call.reportedTokens, cacheReadTokens: null,
          quality: "provider-reported", requestMs: result.call.requestMs, outcome: "stop", estimatedUsd: null, providerReportedUsd: null, billedUsd: null } } }]);
    const status = f.budget.status(f.sessionId);
    assert.equal(status.totals.calls, 1); assert.equal(status.totals.reportedTokens, 42); assert.equal(status.totals.plannedHolds, 0);
    assert.equal(status.totals.heldTokens, 0); assert.equal(status.totals.billedUsd, null); assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0]?.max_tokens ?? f.requests[0]?.max_completion_tokens, 64); assert.equal(f.requests[0]?.tools, undefined);
  } finally { await f.close(); }
});

test("an exact-cap plan transfers only once into an atomically started actual-call reservation without spending both holds", async () => {
  const f = await budgetPlanFixture();
  try {
    await f.sdk.budgets.policy({ basis: "estimate", tokens: 30 }, 0, true);
    const plan = f.create(), consumed = f.consume(plan.id, { inputEstimate: 5 });
    const status = f.budget.status(f.sessionId), current = f.control.snapshot().budgetPlans[0]!;
    assert.equal(current.status, "consumed"); assert.equal(current.consumedStepId, consumed.stepId);
    assert.equal(status.totals.calls, 1); assert.equal(status.totals.plannedHolds, 0);
    assert.equal(status.totals.heldTokens, 25); assert.equal(status.remainingTokens, 5); assert.equal(status.totals.reportedTokens, null);
    assert.throws(() => f.consume(plan.id), { code: "budget_plan_changed" });
    assert.equal(f.control.snapshot().budgetEntries.length, 1);
  } finally { await f.close(); }
});

test("failed or incomplete transfer acknowledgement leaves the complete plan held and admits no started call", async () => {
  const f = await budgetPlanFixture();
  try {
    const plan = f.create(), transfer = f.budget.consumePlan(f.session(), plan.id, { ...f.request, stepId: randomUUID() });
    assert.throws(() => f.append(transfer.events), { code: "budget_plan_dispatch" });
    assert.equal(f.control.snapshot().budgetPlans[0]?.status, "held"); assert.equal(f.control.snapshot().budgetEntries.length, 0);
    f.service.store.db.exec(`CREATE TRIGGER generated_planned_start BEFORE INSERT ON events
      WHEN json_extract(NEW.data,'$.event_type')='model.started' BEGIN SELECT RAISE(ABORT,'Generated planned-start failure'); END;`);
    assert.throws(() => f.consume(plan.id), /planned-start failure/);
    assert.equal(f.control.snapshot().budgetPlans[0]?.status, "held"); assert.equal(f.control.snapshot().budgetEntries.length, 0);
    assert.equal(f.budget.status(f.sessionId).totals.heldTokens, 30);
  } finally { await f.close(); }
});

test("a held plan refuses changed scope, canonical provider/model, context, authority or newly too-small complete output", async () => {
  const f = await budgetPlanFixture();
  try {
    const plan = f.create();
    for (const changes of [
      { turnId: "generated-different-owner-turn" }, { authorityDigest: "b".repeat(64) },
      { providerId: "generated-different-provider" }, { apiModelId: "generated-different-model" }, { inputEstimate: 11 }, { maxOutputTokens: 19 },
    ]) assert.throws(() => f.budget.consumePlan(f.session(), plan.id, { ...f.request, ...changes, stepId: randomUUID() }), { code: "budget_plan_changed" });
    await f.sdk.budgets.policy({ basis: "estimate", tokens: 20 }, 0, true);
    assert.throws(() => f.consume(plan.id), { code: "budget_exhausted" });
    assert.deepEqual(f.control.snapshot().budgetPlans[0], plan);
    assert.equal(f.control.snapshot().budgetEntries.length, 0);
    assert.equal(f.budget.status(f.sessionId).totals.heldTokens, 30);
    assert.equal(f.budget.status(f.sessionId).remainingTokens, 0);
  } finally { await f.close(); }
});

test("transferred USD uses the exact captured bound and cannot be replaced by an invented zero-valued reservation", async () => {
  const f = await budgetPlanFixture();
  try {
    const settings = structuredClone(f.control.snapshot().settings.values);
    settings.budgets.rates = [{ modelId: f.modelId, inputUsdPerMillion: 1, outputUsdPerMillion: 2, effectiveAt: new Date().toISOString().slice(0, 10), source: "user-estimate" }];
    await f.sdk.settings.update(settings, f.control.snapshot().settings.revision);
    const plan = f.create(); assert.equal(plan.usdMicros, 50);
    const consumed = f.consume(plan.id, { inputEstimate: 5 }), entry = f.control.snapshot().budgetEntries.find((entry) => entry.id === consumed.stepId)!;
    assert.equal(entry.reservedUsdMicros, 45);
    assert.throws(() => f.append([{ event_type: "budget.recorded", profile_id: f.control.profileId, payload: { entry: { ...entry, reservedUsdMicros: 0 } } }]), { code: "budget_plan_corrupt" });
    assert.equal(f.control.snapshot().budgetEntries.find((entry) => entry.id === consumed.stepId)?.reservedUsdMicros, 45);
  } finally { await f.close(); }
});

test("canonical owner completion releases only undispatched planned capacity while unknown started model usage stays held", async () => {
  const f = await budgetPlanFixture();
  try {
    const plan = f.create(), normal = f.budget.reserve(f.session(), { ...f.request, stepId: randomUUID(), role: "solver", inputEstimate: 5, maxOutputTokens: 10 });
    f.append([normal.event]);
    f.append([{ event_type: "turn.finished", profile_id: f.control.profileId, project_id: f.session().projectId, session_id: f.sessionId, turn_id: f.request.turnId,
      payload: { outcome: "stopped", diagnostic: "Generated owner termination with unconfirmed normal usage." } }]);
    const snapshot = f.control.snapshot(), status = f.budget.status(f.sessionId);
    assert.equal(snapshot.budgetPlans.find((value) => value.id === plan.id)?.status, "released");
    assert.equal(snapshot.budgetPlans[0]?.release?.actor, "policy"); assert.equal(snapshot.budgetEntries[0]?.status, "unknown");
    assert.equal(status.totals.heldTokens, 15); assert.equal(status.totals.reportedTokens, null); assert.equal(status.totals.plannedHolds, 0);
    assert.throws(() => f.consume(plan.id), { code: "budget_plan_changed" });
  } finally { await f.close(); }
});

test("stopping a genuine owned worker releases its unused plan but retains the real interrupted model reservation", { skip: process.platform !== "darwin" }, async () => {
  const f = await budgetPlanFixture();
  try {
    await f.send("generated slow owned turn with unused wind-down capacity"); await waitFor(() => f.requests.length === 1);
    const turnId = f.session().turnId!, normal = f.control.snapshot().budgetEntries.find((entry) => entry.turnId === turnId)!;
    const plan = f.create({ turnId });
    assert.equal(f.budget.status(f.sessionId).totals.heldTokens, normal.reservedTokens! + plan.tokens);
    await f.sdk.command({ type: "session.stop", sessionId: f.sessionId }); await f.terminal();
    assert.equal(f.control.snapshot().budgetPlans.find((value) => value.id === plan.id)?.status, "released");
    assert.equal(f.control.snapshot().budgetEntries.find((entry) => entry.id === normal.id)?.status, "unknown");
    assert.equal(f.budget.status(f.sessionId).totals.heldTokens, normal.reservedTokens);
    assert.equal(f.budget.status(f.sessionId).totals.reportedTokens, null); assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});

test("source deletion and a real reopen preserve independent plan outcomes and the consumed model hold without replay", async () => {
  const f = await budgetPlanFixture(); let reopened: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const used = f.create(), unused = f.create(); f.consume(used.id);
    await f.sdk.sessions.delete(f.sessionId, true, f.session().revision);
    assert.equal(f.control.snapshot().budgetPlans.find((plan) => plan.id === used.id)?.status, "consumed");
    assert.equal(f.control.snapshot().budgetPlans.find((plan) => plan.id === unused.id)?.status, "released");
    await f.service.close();
    reopened = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    const peer = await new MoguriSdk(reopened.connection).ready();
    try {
      const state = peer.getState().snapshot!;
      assert.equal(state.sessions.some((session) => session.id === f.sessionId), false); assert.equal(state.budgetPlans.length, 2);
      assert.equal(state.budgetEntries.length, 1); assert.equal(state.budgetEntries[0]?.reservedTokens, 30);
      assert.equal(state.budgetEntries[0]?.reportedTokens, null); assert.equal(f.requests.length, 0);
      const page = await peer.query({ type: "budget.plans", sessionId: f.sessionId }); assert.ok(page.type === "budget.plans");
      assert.equal(page.plans.length, 2);
    } finally { peer.disconnect(); }
  } finally { await reopened?.close(); await f.close(); }
});

test("a held plan blocks a different profile through the real root policy without exposing that profile's planned records", async () => {
  const f = await budgetPlanFixture();
  try {
    await f.sdk.profiles.globalBudget({ basis: "estimate", tokens: 30 }, (await f.sdk.profiles.list()).catalog.globalBudget.revision, true); f.create();
    const created = await f.sdk.profiles.create("Generated isolated planned budget"); await f.sdk.profiles.wait(created.id!);
    const peer = await f.sdk.profiles.open(created.id!);
    try {
      const session = await peer.sessions.create(null, "Generated independent model owner"), control = await f.service.profiles.control(peer.profileId);
      assert.throws(() => control.platform.budgets.reserve(control.snapshot().sessions.find((value) => value.id === session.id)!, { ...f.request, stepId: randomUUID(), inputEstimate: 0, maxOutputTokens: 1 }), { code: "budget_exhausted" });
      const plans = await peer.query({ type: "budget.plans" }); assert.ok(plans.type === "budget.plans"); assert.equal(plans.plans.length, 0);
    } finally { peer.disconnect(); }
  } finally { await f.close(); }
});
