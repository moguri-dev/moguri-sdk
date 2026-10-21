import test from "node:test";
import assert from "node:assert/strict";
import { projectRoleSequence, validateRoleSequenceLedger, type RoleSequenceRecord } from "../packages/protocol/src/role-sequences.ts";
import type { BudgetPlan } from "../packages/protocol/src/budget-plans.ts";
import type { BudgetEntry } from "../packages/protocol/src/budgets.ts";

function fixture() {
  const time = "2026-01-01T00:00:00.000Z";
  const record: RoleSequenceRecord = { version: 1, id: "generated-sequence", profileId: "default", sessionId: "generated-session", ownerSessionId: "generated-session",
    ownerTurnId: "generated-sequence", projectId: "generated-project", workspaceId: null, folderId: null, env: "Local", commandId: "generated-command", commandDigest: "a".repeat(64),
    inputDigest: "b".repeat(64), authorityDigest: "c".repeat(64), policyDigest: "d".repeat(64), revision: 0, createdAt: time, updatedAt: time,
    stopRequested: false, status: "running", diagnostic: null, steps: (["draft", "critic"] as const).map((role) => ({
      planId: `generated-plan-${role}`, role, modelId: `generated-${role}`, providerId: "generated-provider", apiModelId: `generated-canonical-${role}`,
      inputBound: 10, outputBound: 20, state: "pending", stepId: null, inputDigest: null, resultDigest: null, outcome: null, diagnostic: null,
    })) };
  const plans: BudgetPlan[] = record.steps.map((step) => ({ version: 1, id: step.planId, profileId: record.profileId, sessionId: record.sessionId, ownerSessionId: record.ownerSessionId,
    turnId: record.id, ownerTurnId: record.ownerTurnId, projectId: record.projectId, folderId: null, env: record.env, purpose: "winddown",
    role: step.role, modelId: step.modelId, providerId: step.providerId, apiModelId: step.apiModelId, authorityDigest: record.authorityDigest,
    inputBound: step.inputBound, outputBound: step.outputBound, tokens: 30, usdMicros: null, rate: null, revision: 0, createdAt: time, updatedAt: time,
    status: "held", consumedStepId: null, release: null }));
  return { record, plans };
}
const next = (record: RoleSequenceRecord, changes: Partial<RoleSequenceRecord> = {}): RoleSequenceRecord => ({ ...structuredClone(record), revision: record.revision + 1, ...changes });
function start(record: RoleSequenceRecord, index: number) {
  const result = next(record); result.steps[index] = { ...result.steps[index]!, state: "started", stepId: `generated-step-${index}`, inputDigest: String(index + 1).repeat(64) };
  return projectRoleSequence(record, result);
}
function result(record: RoleSequenceRecord, index: number) {
  const value = next(record); value.steps[index] = { ...value.steps[index]!, state: "recorded", resultDigest: String(index + 3).repeat(64), outcome: "stop" };
  return projectRoleSequence(record, value);
}
function admitted(plan: BudgetPlan, stepId: string, settled = true): { plan: BudgetPlan; entry: BudgetEntry } {
  return { plan: { ...plan, revision: 1, status: "consumed", consumedStepId: stepId }, entry: {
    id: stepId, planId: plan.id, sessionId: plan.sessionId, ownerSessionId: plan.ownerSessionId, turnId: plan.turnId, ownerTurnId: plan.ownerTurnId,
    projectId: plan.projectId, folderId: plan.folderId, modelId: plan.modelId, providerId: plan.providerId, apiModelId: plan.apiModelId, role: plan.role,
    env: plan.env, createdAt: plan.createdAt, imported: false, status: settled ? "settled" : "unknown", inputEstimate: plan.inputBound, outputLimit: plan.outputBound,
    reservedTokens: plan.tokens, reportedTokens: settled ? 42 : null, reservedUsdMicros: null, estimatedUsdMicros: null, rate: null,
    requestMs: 1, outcome: settled ? "stop" : "unconfirmed", diagnostic: null, inputTokens: settled ? 30 : null, outputTokens: settled ? 12 : null,
  } };
}

test("retained role sequence begins only with exact undispatched same-owner policy/input/model plans", () => {
  const f = fixture(), initial = projectRoleSequence(undefined, f.record);
  validateRoleSequenceLedger([initial], f.plans, []);
  for (const changed of [{ ...f.record, version: 2 }, { ...f.record, ownerTurnId: null }, { ...f.record, createdAt: "2026-02-30T00:00:00.000Z" },
    { ...f.record, status: "completed" }, { ...f.record, steps: [f.record.steps[0], f.record.steps[0]] }]) assert.throws(() => projectRoleSequence(undefined, changed), { code: "role_sequence_corrupt" });
  assert.throws(() => validateRoleSequenceLedger([initial], [], []), { code: "role_sequence_corrupt" });
});

test("each actual role is serial and needs its original atomic consumed-plan/entry before any later role", () => {
  const f = fixture(), initial = projectRoleSequence(undefined, f.record);
  assert.throws(() => start(initial, 1), { code: "role_sequence_corrupt" });
  const first = start(initial, 0), entry = admitted(f.plans[0]!, first.steps[0]!.stepId!);
  assert.throws(() => validateRoleSequenceLedger([first], f.plans, []), { code: "role_sequence_corrupt" });
  validateRoleSequenceLedger([first], [entry.plan, f.plans[1]!], [entry.entry]);
  assert.throws(() => start(first, 1), { code: "role_sequence_corrupt" });
  const recorded = result(first, 0), second = start(recorded, 1), other = admitted(f.plans[1]!, second.steps[1]!.stepId!);
  validateRoleSequenceLedger([second], [entry.plan, other.plan], [entry.entry, other.entry]);
  const last = result(second, 1), completed = projectRoleSequence(last, next(last, { status: "completed" }));
  validateRoleSequenceLedger([completed], [entry.plan, other.plan], [entry.entry, other.entry]);
  assert.equal(completed.status, "completed"); assert.equal("acceptance" in completed, false);
});

test("unknown, missing output telemetry or an actual output-limit violation cannot authorize a next role", () => {
  const f = fixture(), first = start(projectRoleSequence(undefined, f.record), 0), recorded = result(first, 0), second = start(recorded, 1);
  const one = admitted(f.plans[0]!, first.steps[0]!.stepId!), two = admitted(f.plans[1]!, second.steps[1]!.stepId!);
  for (const changed of [{ ...one.entry, status: "unknown" as const, reportedTokens: null }, { ...one.entry, outputTokens: null }, { ...one.entry, outputLimitViolation: true }]) {
    assert.throws(() => validateRoleSequenceLedger([second], [one.plan, two.plan], [changed, two.entry]), { code: "role_sequence_corrupt" });
  }
});

test("retaining a raw role result before derived settlement cannot itself authorize another role or sequence success", () => {
  const f = fixture(), recorded = result(start(projectRoleSequence(undefined, f.record), 0), 0);
  const one = admitted(f.plans[0]!, recorded.steps[0]!.stepId!);
  const pending: BudgetEntry = { ...one.entry, status: "reserved", reportedTokens: null, outputTokens: null, inputTokens: null, outcome: "running" };
  validateRoleSequenceLedger([recorded], [one.plan, f.plans[1]!], [pending]);
  const second = start(recorded, 1), two = admitted(f.plans[1]!, second.steps[1]!.stepId!);
  assert.throws(() => validateRoleSequenceLedger([second], [one.plan, two.plan], [pending, two.entry]), { code: "role_sequence_corrupt" });
});

test("a requested stop cannot start another role, invent a completed sequence or replace its original root/policy/model", () => {
  const f = fixture(), initial = projectRoleSequence(undefined, f.record), stoppedIntent = projectRoleSequence(initial, next(initial, { stopRequested: true }));
  assert.throws(() => start(stoppedIntent, 0), { code: "role_sequence_corrupt" });
  for (const changed of [
    next(initial, { inputDigest: "e".repeat(64) }), next(initial, { authorityDigest: "e".repeat(64) }), next(initial, { policyDigest: "e".repeat(64) }),
    next(initial, { projectId: "generated-other" }), next(initial, { commandId: "generated-other" }),
    { ...next(initial), steps: [{ ...initial.steps[0]!, modelId: "generated-other" }, initial.steps[1]!] },
  ]) assert.throws(() => projectRoleSequence(initial, changed), { code: "role_sequence_corrupt" });
});

test("terminal partial state can append a late result only for its exact already-observed step, never resume or replay", () => {
  const f = fixture(), started = start(projectRoleSequence(undefined, f.record), 0), interrupted = next(started, { status: "partial", diagnostic: "Generated lost acknowledgement." });
  interrupted.steps[0] = { ...interrupted.steps[0]!, state: "unconfirmed", diagnostic: "Generated original result unconfirmed." };
  const partial = projectRoleSequence(started, interrupted), late = result(partial, 0);
  assert.equal(late.status, "partial"); assert.equal(late.diagnostic, partial.diagnostic);
  assert.throws(() => start(late, 1), { code: "role_sequence_corrupt" });
  assert.throws(() => projectRoleSequence(late, next(late)), { code: "role_sequence_corrupt" });
  assert.throws(() => projectRoleSequence(late, next(late, { status: "completed", diagnostic: null })), { code: "role_sequence_corrupt" });
});

test("recorded inputs/results and complete original budget bindings cannot be replaced by another actor, plan or model", () => {
  const f = fixture(), initial = projectRoleSequence(undefined, f.record), recorded = result(start(initial, 0), 0), one = admitted(f.plans[0]!, recorded.steps[0]!.stepId!);
  for (const changed of [
    { ...f.plans[1]!, profileId: "generated-other" }, { ...f.plans[1]!, turnId: "generated-other" }, { ...f.plans[1]!, authorityDigest: "f".repeat(64) },
    { ...f.plans[1]!, apiModelId: "generated-other" }, { ...f.plans[1]!, inputBound: 11, tokens: 31 },
  ]) assert.throws(() => validateRoleSequenceLedger([recorded], [one.plan, changed], [one.entry]), { code: "role_sequence_corrupt" });
  const replaced = next(recorded); replaced.steps[0]!.resultDigest = "f".repeat(64);
  assert.throws(() => projectRoleSequence(recorded, replaced), { code: "role_sequence_corrupt" });
});
