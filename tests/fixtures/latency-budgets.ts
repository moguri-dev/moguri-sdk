import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";

export const LATENCY_SAMPLES = 3;
export const OPERATION_LATENCY_MS = {
  "session.create": 700,
  "draft.save": 700,
  "message.send": 700,
  "session.organize": 700,
  "session.archive": 700,
  "session.delete": 1000,
  "startup.window": 1500,
  "startup.ready": 3000,
} as const;
const limits: Readonly<Record<string, number>> = OPERATION_LATENCY_MS;

// Product latency budgets are hard gates locally, including the verify:sdk run before tagging. Shared runners can be several times
// slower than a developer Mac, so CI's main job skips them, while its latency job and the release workflow report every sample
// without failing (#1). A reported miss is a regression to investigate, never a reason to raise a budget.
export type LatencyBudgetMode = "enforce" | "report" | "skip";
export function latencyBudgetMode(value = process.env.MOGURI_LATENCY_BUDGETS): LatencyBudgetMode {
  if (!value || value === "enforce") return "enforce";
  if (value === "report" || value === "skip") return value;
  throw new Error(`Unknown MOGURI_LATENCY_BUDGETS mode "${value}"; use enforce, report or skip.`);
}
export function assertLatencyBudget(name: string, elapsedMs: number, limitMs: number, mode = latencyBudgetMode()): void {
  assert.ok(Number.isFinite(elapsedMs) && elapsedMs >= 0, `${name} latency must be finite and nonnegative.`);
  const within = elapsedMs <= limitMs, message = `${name} took ${elapsedMs.toFixed(2)} ms; budget is ${limitMs} ms.`;
  if (mode === "skip") return;
  if (mode === "report") {
    if (process.env.MOGURI_LATENCY_REPORT) appendFileSync(process.env.MOGURI_LATENCY_REPORT, `${JSON.stringify({ name, elapsedMs, limitMs, within })}\n`);
    if (!within) console.error(`Latency budget miss, reported and not enforced: ${message}`);
    return;
  }
  assert.ok(within, message);
}
export function assertOperationLatency(operation: string, elapsedMs: number, mode = latencyBudgetMode()): void {
  const limit = Object.hasOwn(limits, operation) ? limits[operation] : undefined;
  assert.ok(limit !== undefined, `No latency budget is defined for ${operation}.`);
  assertLatencyBudget(operation, elapsedMs, limit, mode);
}
