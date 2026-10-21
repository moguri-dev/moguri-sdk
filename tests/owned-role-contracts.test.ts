import test from "node:test";
import assert from "node:assert/strict";
import { validateRoleAdvice, validateRoleDefinitions } from "../apps/service/src/role-contracts.ts";
import { roleContractFixture, contractedRouterReason } from "./fixtures/role-contract-api.ts";
import { ownedSequenceFixture } from "./fixtures/owned-sequence-api.ts";
import { isRecord } from "../packages/sdk/src/index.ts";
import { ownedRoleContext } from "../apps/service/src/owned-roles.ts";
import { estimateModelContext } from "../apps/service/src/model-controls.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("a bound router contract accepts only its exact configured pattern/models and confidence, never extra grants", () => {
  const contract = { kind: "router" as const, pattern: "critique" as const, draftId: "generated-draft", criticId: "generated-critic", minimumConfidence: 0.9 };
  const plan = { pattern: "critique", draftId: "generated-draft", criticId: "generated-critic", confidence: 0.95, reason: "Generated advice, not authority." };
  assert.deepEqual(validateRoleAdvice(contract, JSON.stringify(plan)), { status: "valid", value: plan, diagnostic: null });
  for (const changed of [
    { ...plan, criticId: "generated-foreign-model" }, { ...plan, draftId: "generated-alias" },
    { ...plan, confidence: 0.89 }, { ...plan, grant: "all" }, { ...plan, reason: "\ud800" },
  ]) assert.throws(() => validateRoleAdvice(contract, JSON.stringify(changed)));
});

test("critic contract validity preserves untrusted pass/revise/reject data without turning any verdict into approval", () => {
  const contract = { kind: "critic" as const, candidateIndex: 1 };
  for (const verdict of ["pass", "revise", "reject"] as const) {
    const value = { verdict, reason: "Generated bounded opinion, not code quality or human consent.", issues: verdict === "revise" ? ["Generated issue."] : [] };
    const result = validateRoleAdvice(contract, JSON.stringify(value));
    assert.equal(result.status, verdict === "reject" ? "rejected" : "valid"); assert.deepEqual(result.value, value);
    assert.equal("approval" in result, false);
  }
  for (const value of [
    { verdict: "pass", reason: "Generated", issues: [], userAnswer: "yes" },
    { verdict: "pass", reason: "\ud800", issues: [] },
    { verdict: "revise", reason: "Generated", issues: Array.from({ length: 9 }, () => "Generated") },
  ]) assert.throws(() => validateRoleAdvice(contract, JSON.stringify(value)));
  assert.throws(() => validateRoleAdvice(contract, "```json\n{}\n```"));
});

test("versioned context contracts reject missing, duplicate, forward and router-result references instead of repairing them", async () => {
  const f = await roleContractFixture();
  try {
    assert.doesNotThrow(() => validateRoleDefinitions(f.input.roles, 2));
    assert.throws(() => validateRoleDefinitions(f.input.roles, 1), { code: "role_contract_version" });
    for (const indices of [undefined, [0], [1, 1], [3], [2, 1]]) {
      const roles = structuredClone(f.input.roles); roles[2]!.contextRoleIndices = indices;
      assert.throws(() => validateRoleDefinitions(roles, 2));
    }
    const wrongCandidate = structuredClone(f.input.roles); wrongCandidate[2]!.contract = { kind: "critic", candidateIndex: 0 };
    assert.throws(() => validateRoleDefinitions(wrongCandidate, 2), { code: "role_contract_binding" });
    const wrongPlan = structuredClone(f.input.roles); wrongPlan[0]!.contract = { kind: "router", pattern: "critique", draftId: f.modelId, criticId: "generated-foreign-model", minimumConfidence: 0.9 };
    assert.throws(() => validateRoleDefinitions(wrongPlan, 2), { code: "role_contract_binding" });
    assert.equal(f.preparations(), 0); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("the actual owned worker enforces exact role contracts and keeps router explanations out of every later selected context", { skip: process.platform !== "darwin" }, async () => {
  const f = await roleContractFixture();
  try {
    const created = await f.run(), record = await f.settled(created.id);
    assert.equal(record.status, "completed"); assert.equal(record.inputVersion, 2);
    assert.equal(created.prepared.document.version, 2); assert.equal(f.preparations(), 4); assert.equal(f.requests.length, 4);
    for (const [index, request] of f.requests.entries()) {
      const user = Array.isArray(request.messages) ? request.messages.filter(isRecord).findLast((message) => message.role === "user") : undefined;
      assert.ok(typeof user?.content === "string");
      const data: unknown = JSON.parse(user.content); assert.ok(isRecord(data) && Array.isArray(data.untrustedPriorResults));
      assert.deepEqual(data.untrustedPriorResults.map((value) => isRecord(value) ? value.roleIndex : null), [[], [], [1], [1, 2]][index]);
      if (index) assert.equal(JSON.stringify(request).includes(contractedRouterReason), false);
      const read = await f.sdk.roleSequences.contract(record.id, index);
      assert.equal(read.inputVersion, 2); assert.equal(read.result.status, "valid"); assert.match(read.warning, /not.*quality/);
    }
    assert.equal((await f.sdk.budgets.calls()).calls.reduce((sum, call) => sum + (call.reportedTokens ?? NaN), 0), 168);
    assert.equal(f.control.snapshot().candidates.length, 0); assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    const calls = f.requests.length;
    await f.sdk.sessions.delete(f.sessionId, true, f.session().revision);
    assert.equal((await f.sdk.roleSequences.contract(record.id, 2)).result.status, "valid"); assert.equal(f.requests.length, calls);
  } finally { await f.close(); }
});

test("a malformed router, foreign patch or explicit critic rejection is retained and charged before halting the real worker", { skip: process.platform !== "darwin" }, async () => {
  for (const failure of ["router", "patch", "critic"] as const) {
    const f = await roleContractFixture();
    try {
      if (failure === "router") f.replies[0] = JSON.stringify({ ...f.plan, grant: "all" });
      if (failure === "patch") f.replies[1] = JSON.stringify({ ...f.patch, edits: [{ path: "generated-foreign.txt", baseDigest: "absent", text: "Generated unreviewed file." }] });
      if (failure === "critic") f.replies[2] = JSON.stringify({ ...f.critique, verdict: "reject" });
      const created = await f.run(), record = await f.settled(created.id), expected = failure === "router" ? 1 : failure === "patch" ? 2 : 3;
      assert.ok(["failed", "partial"].includes(record.status)); assert.equal(f.preparations(), expected); assert.equal(f.requests.length, expected);
      const read = await f.sdk.roleSequences.contract(record.id, expected - 1);
      assert.equal(read.result.status, failure === "critic" ? "rejected" : "invalid"); assert.ok(read.result.resultDigest);
      assert.equal((await f.sdk.budgets.calls()).calls.reduce((sum, call) => sum + (call.reportedTokens ?? NaN), 0), expected * 42);
      assert.equal(f.control.snapshot().budgetPlans.filter((plan) => plan.status === "released").length, 4 - expected);
      assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    } finally { await f.close(); }
  }
});

test("selected future context reserves the exact complete escaping of permitted results, not router data or an empty context", async () => {
  const f = await roleContractFixture();
  try {
    const { document } = await f.execution.preview(f.input), role = document.roles[3]!, maximum = "\0".repeat(document.maxResultBytes);
    const context = ownedRoleContext(document, 3, ["Generated discarded router result.", maximum, maximum]);
    assert.equal(estimateModelContext({ systemPrompt: role.systemPrompt, messages: context, tools: [] }), role.inputBound);
    assert.equal(JSON.stringify(context).includes("Generated discarded router result."), false);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("original version-1 owned roles remain uncontracted and keep their exact original retained input semantics", { skip: process.platform !== "darwin" }, async () => {
  const f = await ownedSequenceFixture();
  try {
    const created = await f.start(), record = await f.settled(created.id), read = await f.sdk.roleSequences.contract(record.id, 1);
    assert.equal(created.prepared.document.version, 1); assert.equal(record.inputVersion, undefined);
    assert.equal(read.inputVersion, 1); assert.equal(read.result.status, "uncontracted"); assert.equal(read.contract, null);
    assert.deepEqual(read.contextRoleIndices, [0]); assert.equal(f.requests.length, 3);
  } finally { await f.close(); }
});

test("a failed atomic contracted-result journal retains unknown paid ownership and cannot prepare a later role", { skip: process.platform !== "darwin" }, async () => {
  const f = await roleContractFixture();
  try {
    let observations = 0;
    f.service.store.db.function("generated_contract_observation", () => {
      if (++observations === 3) throw new Error("Generated contracted result journal failure.");
      return 0;
    });
    f.service.store.db.exec(`CREATE TRIGGER generated_contract_result BEFORE INSERT ON events
      WHEN json_extract(NEW.data,'$.event_type')='role.sequence_recorded'
      BEGIN SELECT generated_contract_observation(); END;`);
    const created = await f.run(), record = await f.settled(created.id);
    assert.ok(observations >= 3);
    assert.ok(["partial", "failed"].includes(record.status)); assert.equal(f.preparations(), 1); assert.equal(f.requests.length, 1);
    const call = (await f.sdk.budgets.calls()).calls[0]!;
    assert.equal(call.status, "unknown"); assert.equal(call.reportedTokens, null); assert.ok(call.reservedTokens! > 0);
    assert.equal(record.steps[0]?.state, "unconfirmed");
    assert.equal((await f.sdk.roleSequences.contract(record.id, 0)).result.status, "invalid");
    assert.equal(f.control.snapshot().budgetPlans.filter((plan) => plan.status === "released").length, 3);
  } finally { await f.close(); }
});
