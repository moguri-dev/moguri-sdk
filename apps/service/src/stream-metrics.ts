import { performance } from "node:perf_hooks";
import { isRecord, type ModelStreamObservation } from "../../../packages/protocol/src/index.ts";

const tokens = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function streamMetrics(started = performance.now(), now: () => number = () => performance.now()) {
  let first: number | null = null, last: number | null = null, outputEvents = 0, cacheReadReported = false, cacheWriteReported = false;
  return {
    output(event: unknown) {
      if (!isRecord(event) || !["text_delta", "thinking_delta", "toolcall_delta"].includes(String(event.type)) || typeof event.delta !== "string" || !event.delta.length) return;
      const elapsed = now() - started;
      if (!Number.isFinite(elapsed) || elapsed < 0 || last !== null && elapsed < last) throw new Error("The execution host's monotonic stream clock regressed. Timing is unavailable.");
      first ??= elapsed; last = elapsed; outputEvents++;
    },
    provider(event: unknown) {
      if (!isRecord(event)) return;
      const usage = isRecord(event.response) ? event.response.usage : isRecord(event.message) ? event.message.usage : event.usage;
      if (isRecord(usage)) {
        cacheReadReported ||= tokens(usage.cache_read_input_tokens) ||
          isRecord(usage.prompt_tokens_details) && tokens(usage.prompt_tokens_details.cached_tokens) ||
          isRecord(usage.input_tokens_details) && tokens(usage.input_tokens_details.cached_tokens);
        cacheWriteReported ||= tokens(usage.cache_creation_input_tokens) ||
          isRecord(usage.prompt_tokens_details) && tokens(usage.prompt_tokens_details.cache_write_tokens);
      }
      if (isRecord(event.usageMetadata)) cacheReadReported ||= tokens(event.usageMetadata.cachedContentTokenCount);
    },
    snapshot() {
      return { firstOutputMs: first, streamMs: outputEvents > 1 && first !== null && last !== null && last > first ? last - first : null,
        outputEvents, cacheReadReported, cacheWriteReported };
    },
  };
}

export function normalizeStreamObservation(stream: ModelStreamObservation | undefined, requestMs: number): { stream: ModelStreamObservation | null; telemetryDiagnostic: string | null } {
  const valid = stream !== undefined && Number.isFinite(requestMs) && requestMs >= 0 && Number.isSafeInteger(stream.outputEvents) && stream.outputEvents >= 0 &&
    (stream.outputEvents === 0 ? stream.firstOutputMs === null && stream.streamMs === null :
      stream.firstOutputMs !== null && Number.isFinite(stream.firstOutputMs) && stream.firstOutputMs >= 0 && stream.firstOutputMs <= requestMs &&
      (stream.streamMs === null || stream.outputEvents > 1 && Number.isFinite(stream.streamMs) && stream.streamMs > 0 && stream.firstOutputMs + stream.streamMs <= requestMs));
  return { stream: valid ? stream : null, telemetryDiagnostic: stream && !valid ? "Observed stream timing was inconsistent with its owning request. Token charges remain retained; no timing or velocity was inferred." : null };
}
