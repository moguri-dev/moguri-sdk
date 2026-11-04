import assert from "node:assert/strict";
import test from "node:test";
import { assertOperationLatency } from "./fixtures/latency-budgets.ts";

test("each routine operation fails above 700 ms rather than passing on an average", () => {
  for (const operation of ["session.create", "draft.save", "message.send", "session.organize", "session.archive"]) {
    assert.doesNotThrow(() => assertOperationLatency(operation, 700));
    assert.throws(() => assertOperationLatency(operation, 700.001), new RegExp(`${operation}.*700`));
  }
});

test("authenticated deletion and cold startup have explicit separate ceilings", () => {
  for (const [operation, limit] of [["session.delete", 1000], ["startup.window", 1500], ["startup.ready", 3000]] as const) {
    assert.doesNotThrow(() => assertOperationLatency(operation, limit));
    assert.throws(() => assertOperationLatency(operation, limit + 0.001), new RegExp(`${operation}.*${limit}`));
  }
});

test("unknown operations and invalid clock observations cannot silently pass", () => {
  for (const operation of ["generated-unconfigured-operation", "__proto__", "toString"]) {
    assert.throws(() => assertOperationLatency(operation, 0), /No latency budget/);
  }
  for (const elapsed of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => assertOperationLatency("draft.save", elapsed), /finite and nonnegative/);
  }
});
