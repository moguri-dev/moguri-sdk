import test from "node:test";
import assert from "node:assert/strict";
import { BudgetPlanSchema, projectBudgetPlan, type BudgetPlan } from "../packages/protocol/src/budget-plans.ts";
import { Value } from "typebox/value";

const time = "2026-01-01T00:00:00.000Z";
function held(): BudgetPlan {
  return { version: 1, id: "generated-plan", profileId: "default", sessionId: "generated-session", ownerSessionId: "generated-session", turnId: "generated-turn", ownerTurnId: "generated-turn",
    projectId: "generated-project", folderId: null, env: "Local", purpose: "winddown", role: "checkpoint", modelId: "generated-model",
    providerId: "generated-provider", apiModelId: "generated-canonical", authorityDigest: "a".repeat(64),
    inputBound: 10, outputBound: 20, tokens: 30, usdMicros: null, rate: null, revision: 0, createdAt: time, updatedAt: time, status: "held", consumedStepId: null, release: null };
}
function released(plan = held()): BudgetPlan {
  return { ...plan, revision: plan.revision + 1, updatedAt: "2026-01-01T00:00:01.000Z", status: "released",
    release: { actor: "policy", reason: "owner-turn-finished", sourceEventId: "generated-owner-finished" } };
}

test("planned wind-down capacity is distinct from reported model telemetry and starts only as an exact undispatched hold", () => {
  const plan = held();
  assert.deepEqual(projectBudgetPlan(undefined, plan), plan);
  assert.equal(Value.Check(BudgetPlanSchema, { ...plan, reportedTokens: 0 }), false);
  assert.throws(() => projectBudgetPlan(undefined, released()), { code: "budget_plan_corrupt" });
  assert.throws(() => projectBudgetPlan(undefined, { ...plan, role: "unknown" }), { code: "budget_plan_corrupt" });
});

test("planned tokens and captured micro-dollar estimates must cover the complete original role bounds without invented zero prices", () => {
  const plan = held(), rate = { modelId: plan.modelId, inputUsdPerMillion: 1, outputUsdPerMillion: 2, effectiveAt: "2026-01-01", source: "user-estimate" as const };
  assert.equal(projectBudgetPlan(undefined, { ...plan, rate, usdMicros: 50 }).usdMicros, 50);
  for (const changed of [
    { ...plan, tokens: 29 }, { ...plan, usdMicros: 0 }, { ...plan, rate, usdMicros: 49 },
    { ...plan, rate: { ...rate, modelId: "generated-different-model" }, usdMicros: 50 },
    { ...plan, rate: { ...rate, effectiveAt: "2026-02-30" }, usdMicros: 50 },
    { ...plan, rate: { ...rate, effectiveAt: "2026-01-02" }, usdMicros: 50 },
    { ...plan, inputBound: Number.MAX_SAFE_INTEGER, outputBound: 1, tokens: Number.MAX_SAFE_INTEGER },
    { ...plan, createdAt: "2026-02-30T00:00:00.000Z" },
  ]) assert.throws(() => projectBudgetPlan(undefined, changed), { code: "budget_plan_corrupt" });
});

test("planned holds preserve exact owner, provider, model, role, scope and bounds through a single terminal transition", () => {
  const plan = held(), terminal = released(plan);
  assert.deepEqual(projectBudgetPlan(plan, terminal), terminal);
  for (const changed of [
    { ...terminal, profileId: "generated-other-profile" }, { ...terminal, sessionId: "generated-other-session" },
    { ...terminal, ownerSessionId: "generated-other-owner" }, { ...terminal, turnId: "generated-other-turn" },
    { ...terminal, modelId: "generated-other-model" }, { ...terminal, providerId: "generated-other-provider" },
    { ...terminal, apiModelId: "generated-other-canonical" }, { ...terminal, role: "critic" },
    { ...terminal, authorityDigest: "b".repeat(64) }, { ...terminal, inputBound: 9, tokens: 29 },
    { ...terminal, outputBound: 19, tokens: 29 }, { ...terminal, revision: 2 },
  ]) assert.throws(() => projectBudgetPlan(plan, changed), { code: "budget_plan_corrupt" });
});

test("released/consumed plans cannot regain capacity, change terminal evidence or fabricate simultaneous refund and dispatch", () => {
  const plan = held(), release = projectBudgetPlan(plan, released(plan));
  const consumed = projectBudgetPlan(plan, { ...plan, revision: 1, status: "consumed", consumedStepId: "generated-actual-step" });
  assert.throws(() => projectBudgetPlan(plan, { ...released(plan), consumedStepId: "generated-actual-step" }), { code: "budget_plan_corrupt" });
  assert.throws(() => projectBudgetPlan(plan, { ...plan, revision: 1 }), { code: "budget_plan_corrupt" });
  for (const previous of [release, consumed]) {
    assert.throws(() => projectBudgetPlan(previous, { ...previous, revision: 2, status: "held", consumedStepId: null, release: null }), { code: "budget_plan_corrupt" });
    assert.throws(() => projectBudgetPlan(previous, { ...previous, revision: 2 }), { code: "budget_plan_corrupt" });
  }
});

test("replayed plan validation rejects mutated shapes and preserves fresh ownership checks and independent results", () => {
  const plan = held();
  plan.scopePath = [plan.sessionId];
  plan.rate = { modelId: plan.modelId, inputUsdPerMillion: 1, outputUsdPerMillion: 2, effectiveAt: "2026-01-01", source: "user-estimate" };
  plan.usdMicros = 50;
  const first = projectBudgetPlan(undefined, plan);
  first.scopePath!.push("generated-foreign-owner"); first.rate!.inputUsdPerMillion = 999;
  assert.deepEqual(projectBudgetPlan(undefined, plan), plan);
  Object.assign(plan, { reportedTokens: 0 });
  assert.throws(() => projectBudgetPlan(undefined, plan), { code: "budget_plan_corrupt" });
  Reflect.deleteProperty(plan, "reportedTokens");
  assert.deepEqual(projectBudgetPlan(undefined, plan), plan);
  const terminal = released(plan);
  assert.deepEqual(projectBudgetPlan(plan, terminal), terminal);
  const foreign = { ...plan, ownerSessionId: "generated-foreign-owner" };
  assert.throws(() => projectBudgetPlan(foreign, terminal), { code: "budget_plan_corrupt" });
  assert.throws(() => projectBudgetPlan(terminal, terminal), { code: "budget_plan_corrupt" });
  assert.deepEqual(projectBudgetPlan(plan, terminal), terminal);
});
