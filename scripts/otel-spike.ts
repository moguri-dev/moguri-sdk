import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { SpanKind, SpanStatusCode, TraceFlags, ValueType, type HrTime } from "@opentelemetry/api";
import { JsonMetricsSerializer, JsonTraceSerializer } from "@opentelemetry/otlp-transformer";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { AggregationTemporality, DataPointType, type ResourceMetrics } from "@opentelemetry/sdk-metrics";
import type { ReadableSpan } from "@opentelemetry/sdk-trace";
import { setupFixture, waitFor } from "../tests/fixture.ts";

const started = performance.now(), received: Array<{ path: string; contentType: string | undefined; text: string }> = [];
const receiver = createServer((request, response) => {
  if (request.url === "/stall") return;
  if (request.url === "/redirect") { response.writeHead(307, { location: "/must-not-follow" }).end(); return; }
  void (async () => {
    const parts: Buffer[] = [];
    for await (const part of request) parts.push(Buffer.from(part));
    received.push({ path: request.url!, contentType: request.headers["content-type"], text: Buffer.concat(parts).toString("utf8") });
    response.writeHead(200, { "content-type": "application/json" }).end("{}");
  })().catch((error: unknown) => { console.error("Generated OTLP receiver failed:", error); response.destroy(); });
});
receiver.listen(0, "127.0.0.1"); await once(receiver, "listening");
const address = receiver.address(); assert.ok(address && typeof address === "object");
const endpoint = `http://127.0.0.1:${address.port}`;
const fixture = await setupFixture({ responseMode: "text", replyText: "GENERATED_PRIVATE_RESPONSE_OTLP_SPIKE" });
try {
  await fixture.configure(); await fixture.send("GENERATED_PRIVATE_PROMPT_OTLP_SPIKE"); await fixture.terminal();
  await waitFor(() => fixture.service.controller.snapshot().budgetEntries.every((entry) => entry.status !== "reserved"));
  const before = JSON.stringify(fixture.service.controller.snapshot().budgetEntries), calls = fixture.requests.length;
  const entry = fixture.service.controller.snapshot().budgetEntries.find((entry) => entry.role === "solver");
  assert.ok(entry && entry.reportedTokens !== null);
  const time = (ms: number): HrTime => [Math.floor(ms / 1000), Math.round(ms % 1000 * 1_000_000)];
  const epoch = Date.parse(entry.createdAt), context = { traceId: randomBytes(16).toString("hex"), spanId: randomBytes(8).toString("hex"), traceFlags: TraceFlags.SAMPLED };
  const resource = resourceFromAttributes({ "service.name": "moguri", "service.version": "0.31.0-alpha.1" });
  const span: ReadableSpan = {
    name: "moguri.model", kind: SpanKind.CLIENT, spanContext: () => context,
    startTime: time(epoch), endTime: time(epoch + entry.requestMs), duration: time(entry.requestMs),
    status: { code: SpanStatusCode.UNSET }, attributes: { "moguri.role": entry.role, "moguri.env": entry.env,
      "moguri.accounting.status": entry.status, "moguri.usage.reported_tokens": entry.reportedTokens },
    links: [], events: [], ended: true, resource, instrumentationScope: { name: "moguri.records" },
    droppedAttributesCount: 0, droppedEventsCount: 0, droppedLinksCount: 0,
  };
  const totals = (await fixture.service.controller.platform.budgets.query({ type: "budget.dashboard" }));
  assert.equal(totals.type, "budget.dashboard");
  const metrics: ResourceMetrics = { resource, scopeMetrics: [{ scope: { name: "moguri.records" }, metrics: [{
    descriptor: { name: "moguri.accounting.reported_tokens_known", description: "Existing canonical known reported tokens", unit: "{token}", valueType: ValueType.DOUBLE },
    aggregationTemporality: AggregationTemporality.CUMULATIVE, dataPointType: DataPointType.GAUGE,
    dataPoints: [{ attributes: {}, startTime: time(Date.now()), endTime: time(Date.now()), value: totals.totals.knownReportedTokens }],
  }] }] };
  const encode = performance.now();
  for (let index = 0; index < 1000; index++) { JsonTraceSerializer.serializeRequest([span]); JsonMetricsSerializer.serializeRequest(metrics); }
  const encodingMs = performance.now() - encode;
  for (const [path, bytes] of [["traces", JsonTraceSerializer.serializeRequest([span])], ["metrics", JsonMetricsSerializer.serializeRequest(metrics)]] as const) {
    assert.ok(bytes);
    const response = await fetch(`${endpoint}/v1/${path}`, { method: "POST", redirect: "error", credentials: "omit",
      headers: { "content-type": "application/json" }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(1500) });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), {});
  }
  assert.equal(received.length, 2);
  const traces: unknown = JSON.parse(received[0]!.text);
  assert.ok(typeof traces === "object" && traces !== null && "resourceSpans" in traces);
  for (const value of received) {
    assert.equal(value.contentType, "application/json");
    for (const forbidden of ["GENERATED_PRIVATE_PROMPT_OTLP_SPIKE", "GENERATED_PRIVATE_RESPONSE_OTLP_SPIKE", fixture.project, fixture.directory, fixture.home, entry.id, entry.modelId, "generated-test-only"]) {
      assert.equal(value.text.includes(forbidden), false, "Private source content or identity entered the primitive export.");
    }
  }
  const timeout = performance.now();
  await assert.rejects(fetch(`${endpoint}/stall`, { signal: AbortSignal.timeout(50) }), { name: "TimeoutError" });
  const timeoutMs = performance.now() - timeout; assert.ok(timeoutMs < 500);
  await assert.rejects(fetch(`${endpoint}/redirect`, { redirect: "error", signal: AbortSignal.timeout(500) }));
  assert.equal(received.length, 2);
  assert.equal(JSON.stringify(fixture.service.controller.snapshot().budgetEntries), before);
  assert.equal(fixture.requests.length, calls);
  console.log(JSON.stringify({ status: "PASS", primitive: "Node26/pi-ai canonical accounting to official OTLP/HTTP JSON codecs",
    node: process.version, modelCalls: calls, reportedTokens: entry.reportedTokens, requests: received.map(({ path, text }) => ({ path, bytes: Buffer.byteLength(text) })),
    encoding1000PairsMs: encodingMs, stalledRequestCancelledMs: timeoutMs, redirectsFollowed: 0, sourceAccountingUnchanged: true,
    privateMarkersExported: false, globalInstrumentationRegistered: false, reusedLicenses: "Apache-2.0; existing Node/pi-ai helpers retain MIT",
    scope: "Primitive only: final per-profile review, queue/sampling/loss/flush/restart and client integration require separate tests.", ms: performance.now() - started }));
} finally {
  await fixture.close();
  receiver.closeAllConnections(); await new Promise<void>((resolve, reject) => receiver.close((error) => error ? reject(error) : resolve()));
}
