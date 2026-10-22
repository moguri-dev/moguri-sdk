import assert from "node:assert/strict";
import { test } from "node:test";
import { decisionAdvice } from "../apps/service/src/decision-contracts.ts";

test("compatible bounded System One advice binds exact named choices, keeps probability separate from confidence and never supplies permission", () => {
  const questions = { action: { type: "choice" as const, instructions: "Generated review of an already delegated action.", criteria: { allow: "Allow only inside exact user policy.", deny: "Decline this action." } } };
  const value = { answers: { action: { type: "choice", choice: "allow", confidence: 0.96, probabilities: { allow: 0.98, deny: 0.02 } } } };
  const result = decisionAdvice(JSON.stringify(value), questions, 0.9, 0.95);
  assert.equal(result.answers.action?.type, "choice");
  assert.equal(result.eligible, true);
  assert.throws(() => decisionAdvice(JSON.stringify({ ...value, approval: true }), questions, 0.9, 0.95), /schema|contract|fields/);
  assert.throws(() => decisionAdvice(JSON.stringify({ answers: { action: { ...value.answers.action, choice: "foreign" } } }), questions, 0.9, 0.95), /choice|alternatives|distribution/);
  assert.equal(decisionAdvice(JSON.stringify({ answers: { action: { ...value.answers.action, confidence: 0.5 } } }), questions, 0.9, 0.95).eligible, false);
});
