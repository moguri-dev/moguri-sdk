import assert from "node:assert/strict";
import { test } from "node:test";
import { projectCompoundWorkflow } from "../packages/protocol/src/compound.ts";
import { compoundRecord, classifiedCompound } from "./fixtures/compound-state.ts";

test("public compound intent keeps immutable ownership and cannot invent a classifier result, source acceptance or terminal replay", () => {
  const initial = compoundRecord(), record = projectCompoundWorkflow(undefined, initial);
  assert.deepEqual(record, initial);
  assert.throws(() => projectCompoundWorkflow(record, { ...record, revision: 1, sessionId: "generated-different-owner" }), { code: "compound_corrupt" });
  const route = { routeId: "generated-route", pattern: "cascade", draftId: "generated-draft", escalationId: "generated-escalation", confidence: 1, reason: "Generated untrusted router advice." };
  assert.throws(() => projectCompoundWorkflow(record, { ...record, revision: 1, route, phase: "draft" }), { code: "compound_corrupt" });
  assert.throws(() => projectCompoundWorkflow(record, { ...record, revision: 1, status: "proposed", phase: "settled", selectedCandidateId: "generated-unvalidated-candidate" }), { code: "compound_corrupt" });
  const partial = projectCompoundWorkflow(record, { ...record, revision: 1, status: "partial", phase: "settled", diagnostic: "Generated controller loss. Nothing replayed." });
  assert.throws(() => projectCompoundWorkflow(partial, { ...partial, revision: 2, status: "running", phase: "router", diagnostic: null }), { code: "compound_corrupt" });
});

test("the classifier result can append only its exact selected concrete route roles, not another eligible pool model", () => {
  const { observed, value } = classifiedCompound();
  assert.equal(projectCompoundWorkflow(observed, value).steps[1]?.modelId, "generated-draft");
  const wrong = structuredClone(value); wrong.steps[1]!.modelId = "generated-different-eligible-model";
  assert.throws(() => projectCompoundWorkflow(observed, wrong), { code: "compound_corrupt" });
});
