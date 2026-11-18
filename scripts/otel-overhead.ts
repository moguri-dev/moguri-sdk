import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "../tests/fixture.ts";
import { logPayload, metricPayload, tracePayload, type LogObservation, type TraceObservation } from "../apps/service/src/telemetry-export-wire.ts";

/**
 * Measures the per-turn cost of OTLP export on generated loopback turns: wall time with export off and on (traces, metrics and logs),
 * the synchronous observe() time on the commit path, request bytes per turn and official-codec serialization per full batch.
 */
const turns = Number(process.env.MOGURI_OTEL_TURNS ?? 40), started = performance.now();
let bytes = 0, requests = 0;
const receiver = createServer((request, response) => {
  void (async () => {
    for await (const part of request) bytes += Buffer.byteLength(part as Buffer);
    requests++; response.writeHead(200, { "content-type": "application/json" }).end("{}");
  })().catch((error: unknown) => { console.error("Generated OTLP receiver failed:", error); response.destroy(); });
});
receiver.listen(0, "127.0.0.1"); await once(receiver, "listening");
const address = receiver.address(); assert.ok(address && typeof address === "object");
const endpoint = `http://127.0.0.1:${address.port}`;
const percentile = (values: number[], p: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!; };
/** Least-squares fit of ms = a + b*turnIndex + c*exportOn; c is the drift-adjusted export offset, since every turn grows the profile slightly. */
function exportOffset(samples: Array<[number, number]>): number {
  const rows = samples.map(([on, ms], index) => [1, index, on, ms] as const), m = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (const row of rows) for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) m[i]![j]! += row[i]! * row[j]!; m[i]![3]! += row[i]! * row[3]; }
  for (let i = 0; i < 3; i++) for (let k = i + 1; k < 3; k++) { const f = m[k]![i]! / m[i]![i]!; for (let j = i; j < 4; j++) m[k]![j]! -= f * m[i]![j]!; }
  const solution = [0, 0, 0];
  for (let i = 2; i >= 0; i--) solution[i] = (m[i]![3]! - [0, 1, 2].filter((j) => j > i).reduce((sum, j) => sum + m[i]![j]! * solution[j]!, 0)) / m[i]![i]!;
  return solution[2]!;
}
const summary = (values: number[]) => ({ p50: percentile(values, 0.5), p95: percentile(values, 0.95), mean: values.reduce((sum, value) => sum + value, 0) / values.length });

const fixture = await setupFixture({ responseMode: "text", replyText: "GENERATED_PRIVATE_OVERHEAD_REPLY" });
const sdk = await new MoguriSdk(fixture.service.connection).ready();
try {
  await fixture.configure();
  const exporter = fixture.service.controller.platform.telemetryExport, observe = exporter.observe.bind(exporter);
  let observeMs = 0;
  exporter.observe = (...args) => { const begin = performance.now(); try { observe(...args); } finally { observeMs += performance.now() - begin; } };
  const modelId = fixture.session().controls.modelId!;
  // A fresh project-free chat per turn keeps context size constant, so both modes measure the same work.
  const turn = async (index: number) => {
    const created = await sdk.sessions.create(null, `Generated overhead chat ${index}`, { modelId }); await sdk.refresh();
    const draft = sdk.getState().snapshot!.sessions.find((session) => session.id === created.id)!.draft;
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: draft.revision, text: `Generated overhead turn ${index}.`, attachments: [] });
    const begin = performance.now();
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: draft.revision + 1, delivery: "queue" });
    await waitFor(() => { const session = fixture.service.controller.snapshot().sessions.find((value) => value.id === created.id); return session && !session.turnId && session.status === "completed"; }, 30_000);
    return performance.now() - begin;
  };
  for (let index = 0; index < 3; index++) await turn(-index - 1);
  const off: number[] = [], on: number[] = [], observeOff: number[] = [], observeOn: number[] = [], ordered: Array<[number, number]> = [];
  const configure = async (enabled: boolean) => sdk.telemetry.export.apply((await sdk.telemetry.export.review({ enabled, endpoint, samplingRatio: 1, logs: true })).review);
  // Alternating blocks (off, on, off, on) cancel drift; each enabled block drains its one-second batches before the revision changes.
  for (const enabled of [false, true, false, true]) {
    await configure(enabled);
    for (let round = 0; round < turns / 2; round++) {
      observeMs = 0;
      const elapsed = await turn(round);
      (enabled ? on : off).push(elapsed); (enabled ? observeOn : observeOff).push(observeMs); ordered.push([enabled ? 1 : 0, elapsed]);
    }
    if (enabled) await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  const status = exporter.status();
  const spans: TraceObservation[] = Array.from({ length: 32 }, (_, index) => ({ family: "model", traceId: "1".repeat(32), spanId: index.toString(16).padStart(16, "0"),
    parentSpanId: "f".repeat(16), startMs: Date.now() - 50, endMs: Date.now(), outcome: "completed",
    attributes: { "moguri.role": "solver", "moguri.env": "Local", "moguri.outcome": "completed", "gen_ai.usage.input_tokens": 30, "gen_ai.usage.output_tokens": 12 } }));
  const logs: LogObservation[] = spans.map((span) => ({ traceId: span.traceId, spanId: span.spanId, sampled: true, timeMs: span.endMs, severity: "WARN",
    eventName: "moguri.model.outcome", body: "Model call ended with outcome partial.", attributes: { "moguri.outcome": "partial", "error.type": "partial" } }));
  const source = fixture.service.controller.snapshot(), instance = "0".repeat(32), encodeStart = performance.now();
  for (let index = 0; index < 1000; index++) { tracePayload(spans, instance); logPayload(logs, instance); metricPayload(source, instance); }
  const batchEncodeMs = (performance.now() - encodeStart) / 1000;
  assert.ok(status.acceptedSpans > 0); assert.equal(status.droppedSpans, 0); assert.equal(status.failedRequests, 0);
  console.log(JSON.stringify({ status: "PASS", node: process.version, turnsPerMode: turns, platform: `${process.platform}-${process.arch}`,
    turnWallMs: { exportOff: summary(off), exportOn: summary(on), driftAdjustedExportOffset: exportOffset(ordered) }, observeMsPerTurn: { exportOff: summary(observeOff), exportOn: summary(observeOn) },
    exportedPerTurn: { requests: requests / turns, bytes: Math.round(bytes / turns) }, spansAccepted: status.acceptedSpans, logsAccepted: status.acceptedLogs,
    fullBatchEncodeMs: batchEncodeMs, modelCalls: fixture.requests.length, ...(process.env.MOGURI_OTEL_RAW ? { raw: { off: off.map(Math.round), on: on.map(Math.round) } } : {}),
    scope: "Generated loopback turns on one machine; diagnostic, not a release budget. Export never blocks the commit path; network time is background.",
    ms: performance.now() - started }));
} finally {
  sdk.disconnect(); await fixture.close();
  receiver.closeAllConnections(); await new Promise<void>((resolve, reject) => receiver.close((error) => error ? reject(error) : resolve()));
}
