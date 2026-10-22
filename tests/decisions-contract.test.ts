import assert from "node:assert/strict";
import { test } from "node:test";
import { decisionAdvice, decisionState } from "../apps/service/src/decision-contracts.ts";

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

test("original decision state must remain lossless before JSON escaping can hide malformed source strings or keys", () => {
  const value = { text: "Generated exact state \u{1f34a}\r\n" };
  assert.equal(decisionState(value), JSON.stringify(value));
  assert.throws(() => decisionState({ text: "Generated invalid \ud800" }), { code: "decision_input" });
  assert.throws(() => decisionState({ ["Generated invalid \ud800"]: true }), { code: "decision_input" });
  assert.throws(() => decisionState({ text: "G".repeat(65537) }), { code: "decision_input" });
});

test("Noul and zero-based weighted Score bind their exact original type/legend but cannot become automatic choices or calibrated permission", () => {
  const questions = { possible: { type: "noul" as const, instructions: "Generated mechanical predicate." },
    quality: { type: "score" as const, instructions: "Generated synthetic rubric, not verified code quality.", criteria: ["Generated low", "Generated high"] } };
  const value = { answers: { possible: { type: "noul", noul: 0.98 },
    quality: { type: "score", score: 0.75, confidence: 0.99, legend: { "0": "Generated low", "1": "Generated high" }, probabilities: { "0": 0.25, "1": 0.75 } } } };
  assert.equal(decisionAdvice(JSON.stringify(value), questions, 0.9, 0.9).eligible, false);
  assert.throws(() => decisionAdvice(JSON.stringify({ answers: { ...value.answers, quality: { ...value.answers.quality, score: 0.99 } } }), questions, 0.9, 0.9), /weighted|rubric|score/);
  assert.throws(() => decisionAdvice(JSON.stringify({ answers: { ...value.answers, quality: { ...value.answers.quality, legend: { "0": "Generated changed", "1": "Generated high" } } } }), questions, 0.9, 0.9), /legend|rubric|score/);
  assert.throws(() => decisionAdvice(JSON.stringify({ answers: { ...value.answers, possible: { type: "choice", choice: "allow", confidence: 1, probabilities: { allow: 1 } } } }), questions, 0.9, 0.9), /type/);
});
