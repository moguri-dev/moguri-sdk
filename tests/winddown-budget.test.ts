import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setupFixture } from "./fixture.ts";
import { MoguriSdk, type EventInput } from "../packages/sdk/src/index.ts";

async function fixture() {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready(), control = f.service.controller;
  try {
    await f.configure();
    const checkpoint = { stepId: randomUUID(), turnId: randomUUID(), role: "checkpoint" as const, modelId: f.modelId, apiModelId: f.modelId,
      providerId: "generated-provider", inputEstimate: 10, maxOutputTokens: 20 };
    const append = (events: EventInput[]) => { control.store.commit(events); control.refreshProfile(); };
    return { ...f, sdk, control, budget: control.platform.budgets, checkpoint, append,
      reserve: () => { const value = control.platform.budgets.reserve(f.session(), checkpoint); append([value.event]); return value; },
      close: async () => { sdk.disconnect(); await f.close(); },
    };
  } catch (error) { sdk.disconnect(); await f.close(); throw error; }
}

test("one pre-reserved checkpoint envelope remains available at the exact session/profile/global cap without re-reserving it", async () => {
  const f = await fixture();
  try {
    await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, budget: { kind: "limited", basis: "estimate", tokens: 30 } }, f.session().revision);
    await f.sdk.budgets.policy({ basis: "estimate", tokens: 30 }, 0, true);
    await f.sdk.profiles.globalBudget({ basis: "estimate", tokens: 30 }, (await f.sdk.profiles.list()).catalog.globalBudget.revision, true);
    f.reserve();
    assert.equal(f.budget.status(f.sessionId).remainingTokens, 0);
    assert.throws(() => f.budget.reserve(f.session(), { ...f.checkpoint, stepId: randomUUID(), role: "critic", inputEstimate: 0, maxOutputTokens: 1 }), { code: "budget_exhausted" });
    assert.equal(f.budget.reservedOutput(f.session(), f.checkpoint), 20);
    assert.equal(f.control.snapshot().budgetEntries.length, 1);
    assert.equal(f.budget.status(f.sessionId).totals.heldTokens, 30);
    assert.equal(f.budget.status(f.sessionId).totals.reportedTokens, null);
  } finally { await f.close(); }
});

test("reserved wind-down never overrides a newly stricter cap and preserves the complete hold instead of refunding it", async () => {
  const f = await fixture();
  try {
    f.reserve();
    await f.sdk.budgets.policy({ basis: "estimate", tokens: 29 }, 0, true);
    assert.throws(() => f.budget.reservedOutput(f.session(), f.checkpoint), { code: "budget_exhausted" });
    assert.equal(f.budget.status(f.sessionId).totals.heldTokens, 30);
    assert.equal(f.budget.status(f.sessionId).totals.reportedTokens, null);
  } finally { await f.close(); }
});

test("a caller's old session snapshot cannot bypass the latest session cap when consuming reserved output", async () => {
  const f = await fixture();
  try {
    f.reserve(); const stale = structuredClone(f.session());
    await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, budget: { kind: "limited", basis: "estimate", tokens: 29 } }, f.session().revision);
    assert.throws(() => f.budget.reservedOutput(stale, f.checkpoint), { code: "budget_exhausted" });
    assert.equal(f.budget.status(f.sessionId).totals.heldTokens, 30);
  } finally { await f.close(); }
});

test("reserved USD output fits an exact micro-dollar cap but cannot silently reuse a changed captured price", async () => {
  const f = await fixture();
  try {
    const settings = structuredClone(f.sdk.settings.get()!.values);
    settings.budgets.rates = [{ modelId: f.modelId, inputUsdPerMillion: 1, outputUsdPerMillion: 2, effectiveAt: new Date().toISOString().slice(0, 10), source: "user-estimate" }];
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision);
    await f.sdk.budgets.policy({ basis: "estimate", usd: 0.000050 }, 0, true); f.reserve();
    assert.equal(f.budget.status(f.sessionId).remainingUsd, 0);
    assert.equal(f.budget.reservedOutput(f.session(), f.checkpoint), 20);
    assert.throws(() => f.budget.reserve(f.session(), { ...f.checkpoint, stepId: randomUUID(), role: "critic", inputEstimate: 0, maxOutputTokens: 1 }), { code: "budget_exhausted" });
    settings.budgets.rates[0]!.outputUsdPerMillion = 4;
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision);
    assert.throws(() => f.budget.reservedOutput(f.session(), f.checkpoint), { code: "budget_reservation" });
    assert.equal(f.budget.status(f.sessionId).totals.heldUsd, 0.000050);
    assert.equal(f.budget.status(f.sessionId).totals.providerReportedUsd, null);
  } finally { await f.close(); }
});

test("reserved output binds its original session, actual role, canonical model and complete input/output envelope", async () => {
  const f = await fixture();
  try {
    f.reserve();
    for (const changed of [
      { ...f.checkpoint, role: "critic" as const },
      { ...f.checkpoint, modelId: "generated-different-selected-model" },
      { ...f.checkpoint, apiModelId: "generated-different-canonical-model" },
      { ...f.checkpoint, inputEstimate: 11 },
      { ...f.checkpoint, maxOutputTokens: 19 },
    ]) assert.throws(() => f.budget.reservedOutput(f.session(), changed), { code: "budget_reservation" });
    const other = await f.sdk.sessions.create(null, "Generated foreign wind-down owner");
    assert.throws(() => f.budget.reservedOutput(f.control.snapshot().sessions.find((session) => session.id === other.id)!, f.checkpoint), { code: "budget_reservation" });
    assert.equal(f.budget.reservedOutput(f.session(), { ...f.checkpoint, inputEstimate: 5, maxOutputTokens: 128 }), 20);
  } finally { await f.close(); }
});

test("a recorded checkpoint dispatch cannot reuse its reserved envelope after a lost receipt or controller reload", async () => {
  const f = await fixture();
  try {
    f.reserve();
    f.append([{ event_type: "model.started", profile_id: f.control.profileId, session_id: f.sessionId, turn_id: f.checkpoint.turnId, step_id: f.checkpoint.stepId,
      payload: { modelId: f.modelId, apiModelId: f.modelId, role: "checkpoint", source: "local", contextEstimate: 10 } }]);
    assert.throws(() => f.budget.reservedOutput(f.session(), f.checkpoint), { code: "budget_duplicate" });
    f.control.refreshProfile();
    assert.throws(() => f.budget.reservedOutput(f.session(), f.checkpoint), { code: "budget_duplicate" });
    assert.equal(f.budget.status(f.sessionId).totals.heldTokens, 30);
  } finally { await f.close(); }
});

test("a pending wind-down in one profile cannot be spent by a different profile's model role", async () => {
  const f = await fixture();
  try {
    await f.sdk.profiles.globalBudget({ basis: "estimate", tokens: 30 }, 0, true);
    f.reserve();
    const created = await f.sdk.profiles.create("Generated independent wind-down profile"); await f.sdk.profiles.wait(created.id!);
    const peer = await f.sdk.profiles.open(created.id!);
    try {
      const session = await peer.sessions.create(null, "Generated competing model role"), control = await f.service.profiles.control(peer.profileId);
      const current = control.snapshot().sessions.find((value) => value.id === session.id)!;
      assert.throws(() => control.platform.budgets.reserve(current, { ...f.checkpoint, stepId: randomUUID(), role: "revision", inputEstimate: 0, maxOutputTokens: 1 }), { code: "budget_exhausted" });
      assert.throws(() => control.platform.budgets.reservedOutput(current, f.checkpoint), { code: "budget_reservation" });
      assert.equal(f.budget.reservedOutput(f.session(), f.checkpoint), 20);
      assert.equal(control.snapshot().budgetEntries.length, 0);
    } finally { peer.disconnect(); }
  } finally { await f.close(); }
});
