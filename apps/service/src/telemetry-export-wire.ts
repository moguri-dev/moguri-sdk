import { readFileSync } from "node:fs";
import { SpanKind, SpanStatusCode, TraceFlags, ValueType, type HrTime } from "@opentelemetry/api";
import { JsonMetricsSerializer, JsonTraceSerializer } from "@opentelemetry/otlp-transformer";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_SERVICE_INSTANCE_ID } from "@opentelemetry/semantic-conventions";
import { AggregationTemporality, DataPointType, type GaugeMetricData, type ResourceMetrics } from "@opentelemetry/sdk-metrics";
import type { ReadableSpan } from "@opentelemetry/sdk-trace";
import type { Snapshot } from "../../../packages/protocol/src/index.ts";
import { budgetTotals } from "./budgets.ts";
import { operationTotals } from "./operation-telemetry.ts";

declare const __MOGURI_BUILD_VERSION__: string;
export interface TraceObservation {
  family: "turn" | "model" | "tool" | "mcp";
  traceId: string; spanId: string; parentSpanId?: string;
  startMs: number; endMs: number;
  attributes: Record<string, string | number | boolean>;
  outcome: string;
}
export type ExportRecords = Pick<Snapshot, "budgetEntries" | "budgetPlans" | "operationEntries">;
const time = (ms: number): HrTime => {
  const seconds = Math.floor(ms / 1000), nanos = Math.floor((ms - seconds * 1000) * 1_000_000);
  return [seconds, nanos];
};
const version = typeof __MOGURI_BUILD_VERSION__ === "string" ? __MOGURI_BUILD_VERSION__ :
  JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).version;
if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/.test(version)) throw new Error("OTLP resource version is unavailable; no environment or host identity was substituted.");
const resourceFor = (instance: string) => resourceFromAttributes({ [ATTR_SERVICE_NAME]: "moguri", [ATTR_SERVICE_VERSION]: version,
  [ATTR_SERVICE_INSTANCE_ID]: instance, "moguri.observation.boundary": "control-plane-records" });
const scope = { name: "moguri.records", version, schemaUrl: "https://opentelemetry.io/schemas/1.45.0" };

export function tracePayload(observations: TraceObservation[], instance: string): Uint8Array {
  const resource = resourceFor(instance);
  const spans: ReadableSpan[] = observations.map((value) => {
    const context = { traceId: value.traceId, spanId: value.spanId, traceFlags: TraceFlags.SAMPLED };
    return {
      name: `moguri.${value.family}`, kind: value.family === "turn" ? SpanKind.INTERNAL : SpanKind.CLIENT,
      spanContext: () => context,
      ...(value.parentSpanId ? { parentSpanContext: { ...context, spanId: value.parentSpanId } } : {}),
      startTime: time(value.startMs), endTime: time(value.endMs), duration: time(value.endMs - value.startMs),
      status: { code: value.outcome === "failed" ? SpanStatusCode.ERROR : value.outcome === "completed" ? SpanStatusCode.OK : SpanStatusCode.UNSET },
      attributes: value.attributes, links: [], events: [], ended: true, resource, instrumentationScope: scope,
      droppedAttributesCount: 0, droppedEventsCount: 0, droppedLinksCount: 0,
    };
  });
  const encoded = JsonTraceSerializer.serializeRequest(spans);
  if (!encoded) throw new Error("The official OTLP trace serializer did not produce a request.");
  return encoded;
}

export function metricPayload(source: ExportRecords, instance: string): Uint8Array {
  const resource = resourceFor(instance);
  const budgets = budgetTotals(source.budgetEntries, source.budgetPlans.filter((plan) => plan.status === "held"));
  const metrics: GaugeMetricData[] = [], at = time(Date.now());
  const gauge = (name: string, value: number | null, unit: string, attributes: Record<string, string> = {}) => {
    if (value === null) return;
    if (!Number.isFinite(value) || value < 0) throw new Error("Canonical OTLP gauge input is invalid; no zero or rounded accounting value was substituted.");
    metrics.push({ descriptor: { name, description: "Current canonical Moguri records; not exporter-accumulated accounting", unit, valueType: ValueType.DOUBLE },
      aggregationTemporality: AggregationTemporality.CUMULATIVE, dataPointType: DataPointType.GAUGE,
      dataPoints: [{ attributes, startTime: at, endTime: at, value }] });
  };
  for (const [field, name, unit] of [
    ["calls", "calls", "{call}"], ["knownReportedTokens", "reported_tokens_known", "{token}"],
    ["reportedTokens", "reported_tokens_complete", "{token}"], ["unknownTokenCalls", "unknown_token_calls", "{call}"],
    ["knownInputTokens", "input_tokens_known", "{token}"], ["knownOutputTokens", "output_tokens_known", "{token}"],
    ["knownCacheReadTokens", "cache_read_tokens_known", "{token}"], ["knownCacheWriteTokens", "cache_write_tokens_known", "{token}"],
    ["unknownCacheReadCalls", "unknown_cache_read_calls", "{call}"], ["unknownCacheWriteCalls", "unknown_cache_write_calls", "{call}"],
    ["heldTokens", "held_tokens", "{token}"], ["plannedHolds", "planned_holds", "{hold}"],
    ["knownEstimatedUsd", "estimated_usd_known", "USD"], ["estimatedUsd", "estimated_usd_complete", "USD"],
    ["providerReportedUsd", "provider_reported_usd", "USD"], ["billedUsd", "billed_usd", "USD"],
    ["unpricedCalls", "unpriced_calls", "{call}"], ["meanFirstOutputMs", "mean_first_output_ms", "ms"],
    ["firstOutputSamples", "first_output_samples", "{call}"], ["unmeasuredStreamCalls", "unmeasured_stream_calls", "{call}"],
  ] as const) gauge(`moguri.accounting.${name}`, budgets[field], unit);
  for (const family of ["tool", "mcp"] as const) {
    const totals = operationTotals(source.operationEntries.filter((entry) => entry.family === family));
    for (const field of ["attempts", "running", "completed", "failed", "denied", "stopped", "partial", "unconfirmed", "unknown", "unmeasuredAttempts"] as const) {
      gauge(`moguri.operations.${field}`, totals[field], "{operation}", { family });
    }
    gauge("moguri.operations.observed_wall_ms", totals.observedWallMs, "ms", { family });
  }
  const payload: ResourceMetrics = { resource, scopeMetrics: [{ scope, metrics }] };
  const encoded = JsonMetricsSerializer.serializeRequest(payload);
  if (!encoded) throw new Error("The official OTLP metric serializer did not produce a request.");
  return encoded;
}
