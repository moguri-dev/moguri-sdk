import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createModels } from "@earendil-works/pi-ai";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { normalizeStreamObservation, streamMetrics } from "../apps/service/src/stream-metrics.ts";
import { fixtureProvider } from "./fixture.ts";

test("stream observations distinguish absent, single-event and measured output without inventing GPU throughput", () => {
  let time = 100;
  const metrics = streamMetrics(time, () => time);
  assert.deepEqual(metrics.snapshot(), { firstOutputMs: null, streamMs: null, outputEvents: 0, cacheReadReported: false, cacheWriteReported: false });
  time = 110; metrics.output({ type: "start" }); metrics.output({ type: "text_delta", delta: "" });
  metrics.output({ type: "text_delta", delta: "Generated" });
  assert.equal(metrics.snapshot().firstOutputMs, 10); assert.equal(metrics.snapshot().streamMs, null);
  time = 130; metrics.output({ type: "thinking_delta", delta: "Generated exposed fixture reasoning" });
  time = 150; metrics.output({ type: "toolcall_delta", delta: "{}" });
  assert.equal(metrics.snapshot().streamMs, 40); assert.equal(metrics.snapshot().outputEvents, 3);
  time = 140;
  assert.throws(() => metrics.output({ type: "text_delta", delta: "Generated regressed clock." }), /regressed/);
});

test("cache category presence remains separate from missing details and accepts explicit reported zero", () => {
  const absent = streamMetrics();
  absent.provider({ usage: { prompt_tokens: 30, completion_tokens: 12 } });
  absent.provider({ usage: { prompt_tokens_details: { cached_tokens: -1 }, cache_creation_input_tokens: null } });
  assert.equal(absent.snapshot().cacheReadReported, false); assert.equal(absent.snapshot().cacheWriteReported, false);
  absent.provider({ usage: { prompt_tokens_details: { cached_tokens: 0 } } });
  assert.equal(absent.snapshot().cacheReadReported, true);
  const anthropic = streamMetrics();
  anthropic.provider({ type: "message_start", message: { usage: { cache_read_input_tokens: 10, cache_creation_input_tokens: 0 } } });
  assert.equal(anthropic.snapshot().cacheReadReported, true); assert.equal(anthropic.snapshot().cacheWriteReported, true);
  const responses = streamMetrics();
  responses.provider({ response: { usage: { input_tokens_details: { cached_tokens: 10 } } } });
  assert.equal(responses.snapshot().cacheReadReported, true);
});

test("inconsistent stream intervals become explicit unknown timing without invalidating independently reported usage", () => {
  const measured = { firstOutputMs: 10, streamMs: 50, outputEvents: 3, cacheReadReported: true, cacheWriteReported: false };
  assert.deepEqual(normalizeStreamObservation(measured, 100), { stream: measured, telemetryDiagnostic: null });
  for (const stream of [{ ...measured, firstOutputMs: 200 }, { ...measured, firstOutputMs: -1 }, { ...measured, outputEvents: 0 }, { ...measured, outputEvents: 1 }, { ...measured, streamMs: Number.NaN }]) {
    const result = normalizeStreamObservation(stream, 100);
    assert.equal(result.stream, null); assert.match(result.telemetryDiagnostic!, /Token charges remain retained/);
  }
  assert.deepEqual(normalizeStreamObservation(undefined, 100), { stream: null, telemetryDiagnostic: null });
});

test("the maintained streaming adapter exposes timed normalized chunks and actual cached-input report presence", { timeout: 10_000 }, async () => {
  const fixture = await fixtureProvider({ stream: { chunks: ["Generated ", "observed ", "stream."], delayMs: 25 },
    usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42, prompt_tokens_details: { cached_tokens: 10 } } });
  try {
    const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
    models.setProvider(githubCopilotProvider());
    const prepared = await fixture.provider.prepare(fixture.modelId, AbortSignal.timeout(5000));
    const started = performance.now(), metrics = streamMetrics(started);
    const stream = models.streamSimple(prepared.model, { messages: [{ role: "user", content: [{ type: "text", text: "Generated stream observation only." }], timestamp: Date.now() }], tools: [] }, {
      ...prepared.auth, signal: AbortSignal.timeout(5000), maxTokens: 128, maxRetries: 0,
      onProviderStreamEvent: (event) => metrics.provider(event),
    });
    for await (const event of stream) metrics.output(event);
    const message = await stream.result(), measured = metrics.snapshot();
    assert.equal(message.stopReason, "stop"); assert.equal(message.usage.totalTokens, 42);
    assert.equal(message.usage.input, 20); assert.equal(message.usage.cacheRead, 10); assert.equal(message.usage.output, 12);
    assert.equal(measured.outputEvents, 3); assert.ok(measured.firstOutputMs !== null && measured.firstOutputMs >= 0);
    assert.ok(measured.streamMs !== null && measured.streamMs >= 40);
    assert.ok(measured.firstOutputMs + measured.streamMs <= performance.now() - started);
    assert.equal(measured.cacheReadReported, true); assert.equal(measured.cacheWriteReported, false);
    assert.equal(fixture.requests.length, 1);
  } finally { await fixture.close(); }
});
