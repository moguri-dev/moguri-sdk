import assert from "node:assert/strict";

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

export function assertOperationLatency(operation: string, elapsedMs: number): void {
  const limit = Object.hasOwn(limits, operation) ? limits[operation] : undefined;
  assert.ok(limit !== undefined, `No latency budget is defined for ${operation}.`);
  assert.ok(Number.isFinite(elapsedMs) && elapsedMs >= 0, `${operation} latency must be finite and nonnegative.`);
  assert.ok(elapsedMs <= limit, `${operation} took ${elapsedMs.toFixed(2)} ms; budget is ${limit} ms.`);
}
