import assert from "node:assert/strict";
import test from "node:test";
import { assertLatencyBudget, assertOperationLatency, latencyBudgetMode } from "./fixtures/latency-budgets.ts";

test("each routine operation fails above 700 ms rather than passing on an average", () => {
  for (const operation of ["session.create", "draft.save", "message.send", "session.organize", "session.archive"]) {
    assert.doesNotThrow(() => assertOperationLatency(operation, 700, "enforce"));
    assert.throws(() => assertOperationLatency(operation, 700.001, "enforce"), new RegExp(`${operation}.*700`));
  }
});

test("authenticated deletion and cold startup have explicit separate ceilings", () => {
  for (const [operation, limit] of [["session.delete", 1000], ["startup.window", 1500], ["startup.ready", 3000]] as const) {
    assert.doesNotThrow(() => assertOperationLatency(operation, limit, "enforce"));
    assert.throws(() => assertOperationLatency(operation, limit + 0.001, "enforce"), new RegExp(`${operation}.*${limit}`));
  }
});

test("unknown operations and invalid clock observations cannot silently pass", () => {
  for (const operation of ["generated-unconfigured-operation", "__proto__", "toString"]) {
    assert.throws(() => assertOperationLatency(operation, 0, "enforce"), /No latency budget/);
  }
  for (const elapsed of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => assertOperationLatency("draft.save", elapsed, "enforce"), /finite and nonnegative/);
  }
});

test("CI modes skip or report a miss without failing, while invalid observations still fail", () => {
  assert.equal(latencyBudgetMode(""), "enforce"); assert.equal(latencyBudgetMode("enforce"), "enforce"); assert.equal(latencyBudgetMode("report"), "report"); assert.equal(latencyBudgetMode("skip"), "skip");
  assert.throws(() => latencyBudgetMode("relaxed"), /Unknown MOGURI_LATENCY_BUDGETS/);
  const report = process.env.MOGURI_LATENCY_REPORT;
  delete process.env.MOGURI_LATENCY_REPORT;
  try {
    for (const mode of ["report", "skip"] as const) assert.doesNotThrow(() => assertOperationLatency("session.delete", 1000.001, mode));
  } finally { if (report !== undefined) process.env.MOGURI_LATENCY_REPORT = report; }
  for (const mode of ["report", "skip"] as const) {
    assert.throws(() => assertLatencyBudget("generated component", Number.NaN, 50, mode), /finite and nonnegative/);
    assert.throws(() => assertOperationLatency("generated-unconfigured-operation", 0, mode), /No latency budget/);
  }
});
