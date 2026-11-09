import { createHmac, randomBytes } from "node:crypto";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { canonicalOtlpInput, isRecord, MoguriError, OTLP_LIMITS, type OtlpConfiguration, type OtlpExportStatus,
  type OtlpInput, type OtlpQuery, type OtlpResponse, type OtlpReview, type CommandResult, type StoredEvent, type BudgetEntry, type OperationEntry } from "../../../packages/protocol/src/index.ts";
import { digest } from "./store.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import type { ExportRecords, TraceObservation } from "./telemetry-export-wire.ts";

type Failure = NonNullable<OtlpExportStatus["lastFailure"]>;
class ExportFailure extends Error {
  constructor(readonly code: Failure["code"], readonly httpStatus: number | null = null) { super(code); }
}
const outcomes = new Set(["completed", "failed", "stopped", "partial", "unconfirmed", "unknown", "denied"]);
const publicTools = new Set(["read_file", "write_file", "apply_patch", "run_command", "fetch_page", "ask_user", "task_progress", "clock", "discover_tools", "read_tool_result"]);
let publicModels: Set<string> | undefined;
export class TelemetryExport {
  private started = false;
  private closing = false;
  private current?: OtlpConfiguration;
  private epoch = 0;
  private key = randomBytes(32);
  private queue: TraceObservation[] = [];
  private source?: ExportRecords;
  private metricsDirty = false;
  private readonly turns = new Map<string, { startedAt: number; env: string }>();
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private request?: AbortController;
  private acceptedSpans = 0;
  private droppedSpans = 0;
  private sampledOut = 0;
  private failedRequests = 0;
  private lastFailure: Failure | null = null;
  constructor(private readonly profileId: string, private readonly configuration: () => OtlpConfiguration) {}

  start(configuration: OtlpConfiguration): void { this.started = true; this.synchronize(configuration); }
  private synchronize(configuration: OtlpConfiguration): void {
    if (this.current?.revision === configuration.revision) return;
    this.epoch++;
    this.request?.abort();
    clearTimeout(this.timer); this.timer = undefined;
    this.droppedSpans += this.queue.length; this.queue = [];
    this.metricsDirty = false; this.source = undefined; this.turns.clear(); this.key = randomBytes(32);
    this.current = structuredClone(configuration);
  }
  private alias(kind: string, id: string, bytes = 8): string {
    return createHmac("sha256", this.key).update(JSON.stringify([kind, id])).digest("hex").slice(0, bytes * 2);
  }
  private identity(turnId: string, family: TraceObservation["family"], id: string, parent?: string) {
    return { traceId: this.alias("trace", turnId, 16), spanId: this.alias(family, id),
      ...(parent ? { parentSpanId: this.alias(family === "turn" ? "turn" : parent.startsWith("model:") ? "model" : "turn",
        parent.startsWith("model:") ? parent.slice(6) : parent) } : {}) };
  }
  private enqueue(value: TraceObservation): void {
    const ratio = Number.parseInt(value.traceId.slice(0, 13), 16) / 0x10000000000000;
    if (ratio >= this.current!.samplingRatio) { this.sampledOut++; return; }
    if (!Number.isFinite(value.startMs) || !Number.isFinite(value.endMs) || value.endMs < value.startMs) {
      this.droppedSpans++; this.lastFailure = { code: "encoding", httpStatus: null }; return;
    }
    if (this.queue.length >= OTLP_LIMITS.queuedSpans) {
      this.droppedSpans++; this.lastFailure = { code: "capacity", httpStatus: null }; return;
    }
    this.queue.push(value);
  }
  private model(entry: BudgetEntry, at: number): void {
    const turnId = entry.ownerTurnId ?? entry.turnId ?? entry.id, outcome = outcomes.has(entry.outcome) ? entry.outcome : "unknown";
    const attributes: TraceObservation["attributes"] = { "moguri.role": entry.role, "moguri.env": entry.env,
      "moguri.accounting.status": entry.status, "moguri.outcome": outcome, "moguri.timing.known": entry.requestMs > 0 };
    for (const [field, name] of [["inputTokens", "gen_ai.usage.input_tokens"], ["outputTokens", "gen_ai.usage.output_tokens"],
      ["reportedTokens", "moguri.usage.reported_tokens"], ["cacheReadTokens", "moguri.usage.cache_read_tokens"],
      ["cacheWriteTokens", "moguri.usage.cache_write_tokens"]] as const) {
      const value = entry[field]; if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) attributes[name] = value;
    }
    if (entry.estimatedUsdMicros !== null) attributes["moguri.cost.estimated_usd"] = entry.estimatedUsdMicros / 1_000_000;
    if (entry.stream?.firstOutputMs !== null && entry.stream?.firstOutputMs !== undefined) attributes["moguri.stream.first_output_ms"] = entry.stream.firstOutputMs;
    if (entry.providerId === "github-copilot") {
      attributes["gen_ai.provider.name"] = "github-copilot";
      publicModels ??= new Set(githubCopilotProvider().getModels().map((model) => model.id));
      if (entry.apiModelId && publicModels.has(entry.apiModelId)) attributes["gen_ai.request.model"] = entry.apiModelId;
    }
    const start = entry.requestMs > 0 ? Date.parse(entry.createdAt) : at;
    this.enqueue({ family: "model", ...this.identity(turnId, "model", entry.id, turnId), outcome, attributes,
      startMs: start, endMs: entry.requestMs > 0 ? start + entry.requestMs : at });
  }
  private operation(entry: OperationEntry, at: number): void {
    const turnId = entry.ownerTurnId ?? entry.turnId ?? entry.id;
    const attributes: TraceObservation["attributes"] = { "moguri.env": entry.env, "moguri.outcome": entry.outcome,
      "moguri.operation.actor": entry.actor, "moguri.operation.family": entry.family, "moguri.timing.known": entry.elapsedMs !== null };
    if (entry.role) attributes["moguri.role"] = entry.role;
    if (entry.family === "tool" && entry.name && publicTools.has(entry.name)) attributes["moguri.tool.name"] = entry.name;
    const known = entry.elapsedMs !== null && entry.startedAt !== null && entry.finishedAt !== null;
    this.enqueue({ family: entry.family, ...this.identity(turnId, entry.family, entry.id, entry.actor === "model" && entry.stepId ? `model:${entry.stepId}` : turnId),
      startMs: known ? Date.parse(entry.startedAt!) : at, endMs: known ? Date.parse(entry.finishedAt!) : at, outcome: entry.outcome, attributes });
  }
  observe(events: StoredEvent[], configuration: OtlpConfiguration, source: ExportRecords): void {
    if (!this.started || this.closing) return;
    this.synchronize(configuration);
    if (!configuration.enabled) return;
    this.source = { budgetEntries: source.budgetEntries, budgetPlans: source.budgetPlans, operationEntries: source.operationEntries };
    for (const event of events) {
      if (event.profile_id !== this.profileId) continue;
      const at = Date.parse(event.timestamp);
      if ((event.event_type === "turn.started" || event.event_type === "turn.control_started") && event.turn_id) {
        if (this.turns.size >= OTLP_LIMITS.queuedSpans) this.turns.delete(this.turns.keys().next().value!);
        this.turns.set(event.turn_id, { startedAt: at, env: event.payload.controls.env });
      } else if (event.event_type === "budget.recorded" && event.payload.entry.status !== "reserved" && !event.payload.entry.imported) {
        this.model(event.payload.entry, at); this.metricsDirty = true;
      } else if (event.event_type === "operation.recorded" && !["pending", "running"].includes(event.payload.entry.outcome) && !event.payload.entry.imported) {
        this.operation(event.payload.entry, at); this.metricsDirty = true;
      } else if (event.event_type === "turn.finished" && event.turn_id) {
        const start = this.turns.get(event.turn_id);
        const known = start !== undefined && at >= start.startedAt;
        this.enqueue({ family: "turn", ...this.identity(event.turn_id, "turn", event.turn_id), startMs: known ? start.startedAt : at,
          endMs: at, outcome: event.payload.outcome, attributes: { "moguri.env": start?.env ?? "unknown",
            "moguri.outcome": event.payload.outcome, "moguri.timing.known": known } });
        this.turns.delete(event.turn_id); this.metricsDirty = true;
      }
    }
    this.schedule();
  }
  private schedule(): void {
    if (this.timer || this.pending || !this.current?.enabled || this.closing || !this.queue.length && !this.metricsDirty) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, OTLP_LIMITS.batchMs); this.timer.unref();
  }
  private async send(endpoint: string, signal: "traces" | "metrics", bytes: Uint8Array, epoch: number): Promise<void> {
    if (bytes.byteLength > OTLP_LIMITS.requestBytes) throw new ExportFailure("capacity");
    if (epoch !== this.epoch || !this.current?.enabled) throw new ExportFailure("cancelled");
    const abort = new AbortController(); this.request = abort;
    const timer = setTimeout(() => abort.abort(new ExportFailure("timeout")), OTLP_LIMITS.requestMs); timer.unref();
    try {
      const response = await fetch(`${endpoint}/v1/${signal}`, { method: "POST", redirect: "error", credentials: "omit",
        headers: { "content-type": "application/json" }, body: new Uint8Array(bytes), signal: abort.signal });
      if (response.status !== 200) { await response.body?.cancel(); throw new ExportFailure("http", response.status); }
      if (response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
        await response.body?.cancel(); throw new ExportFailure("response", 200);
      }
      const chunks: Uint8Array[] = []; let size = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const result = await reader.read(); if (result.done) break;
            size += result.value.byteLength;
            if (size > OTLP_LIMITS.responseBytes) { await reader.cancel(); throw new ExportFailure("response", 200); }
            chunks.push(result.value);
          }
        } finally { reader.releaseLock(); }
      }
      let value: unknown;
      try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ExportFailure("response", 200); }
      if (!isRecord(value) || Object.keys(value).some((key) => key !== "partialSuccess")) throw new ExportFailure("response", 200);
      if (value.partialSuccess !== undefined) {
        if (!isRecord(value.partialSuccess)) throw new ExportFailure("response", 200);
        const partial = value.partialSuccess, field = signal === "traces" ? "rejectedSpans" : "rejectedDataPoints", rejected = partial[field];
        if (Object.keys(partial).some((key) => key !== field && key !== "errorMessage") ||
          partial.errorMessage !== undefined && typeof partial.errorMessage !== "string" ||
          rejected !== undefined && !(typeof rejected === "number" && Number.isSafeInteger(rejected) && rejected >= 0 ||
            typeof rejected === "string" && /^(0|[1-9]\d{0,15})$/.test(rejected) && Number.isSafeInteger(Number(rejected)))) throw new ExportFailure("response", 200);
        if (rejected !== undefined && Number(rejected) > 0 || partial.errorMessage) throw new ExportFailure("partial", 200);
      }
    } catch (error) {
      if (error instanceof ExportFailure) throw error;
      if (abort.signal.aborted) throw abort.signal.reason instanceof ExportFailure ? abort.signal.reason : new ExportFailure("cancelled");
      throw new ExportFailure("network");
    } finally { clearTimeout(timer); if (this.request === abort) this.request = undefined; }
  }
  private flush(): Promise<void> {
    if (this.pending) return this.pending;
    const epoch = this.epoch, endpoint = this.current?.endpoint;
    if (!this.current?.enabled || !endpoint || !this.source) return Promise.resolve();
    const task = (async () => {
      while (epoch === this.epoch && this.current?.enabled && (this.queue.length || this.metricsDirty)) {
        const batch = this.queue.splice(0, OTLP_LIMITS.batchSpans), metrics = this.metricsDirty; this.metricsDirty = false;
        const instance = this.alias("instance", "resource", 16);
        let accepted = false;
        try {
          const wire = await import("./telemetry-export-wire.ts");
          if (batch.length) { await this.send(endpoint, "traces", wire.tracePayload(batch, instance), epoch); this.acceptedSpans += batch.length; accepted = true; }
          if (metrics && this.source) await this.send(endpoint, "metrics", wire.metricPayload(this.source, instance), epoch);
          if (epoch === this.epoch) this.lastFailure = null;
        } catch (error) {
          if (!accepted) this.droppedSpans += batch.length;
          this.failedRequests++;
          const failure = error instanceof ExportFailure ? error : new ExportFailure("encoding");
          if (epoch === this.epoch) this.lastFailure = { code: failure.code, httpStatus: failure.httpStatus };
          console.error("OTLP metadata export was not fully acknowledged:", failure.code, failure.httpStatus ?? "");
        }
      }
    })();
    this.pending = task.finally(() => { this.pending = undefined; this.schedule(); });
    return this.pending;
  }
  async close(): Promise<void> {
    this.closing = true; clearTimeout(this.timer); this.timer = undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const completed = await Promise.race([this.flush().then(() => true), new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), OTLP_LIMITS.shutdownMs); timer.unref();
    })]);
    clearTimeout(timer);
    if (!completed) {
      this.epoch++; this.request?.abort(); this.droppedSpans += this.queue.length; this.queue = []; this.metricsDirty = false;
      this.lastFailure = { code: "shutdown", httpStatus: null };
      console.error("OTLP shutdown drain reached its bound; unconfirmed metadata was not replayed.");
    }
    this.turns.clear(); this.source = undefined;
  }
  review(input: OtlpInput): OtlpReview {
    const fields: Omit<OtlpReview, "digest"> = { ...canonicalOtlpInput(input), profileId: this.profileId, revision: this.configuration().revision,
      transport: "otlp-http-json", signals: ["traces", "metrics"], disclosureVersion: 1 };
    return { ...fields, digest: digest(JSON.stringify(fields)) };
  }
  query(query: OtlpQuery): OtlpResponse {
    if (query.type === "telemetry.export.review") return { type: query.type, review: this.review(query.input) };
    const configuration = structuredClone(this.configuration());
    return { type: query.type, configuration, phase: !configuration.enabled ? "disabled" : this.closing ? "closing" : this.pending ? "exporting" : this.lastFailure ? "degraded" : "idle",
      queuedSpans: this.queue.length, acceptedSpans: this.acceptedSpans, droppedSpans: this.droppedSpans, sampledOut: this.sampledOut,
      failedRequests: this.failedRequests, lastFailure: this.lastFailure ? { ...this.lastFailure } : null, limits: OTLP_LIMITS };
  }
  apply(review: OtlpReview, finish: WorkspaceFinish): CommandResult {
    const input = { enabled: review.enabled, endpoint: review.endpoint, samplingRatio: review.samplingRatio };
    const current = this.review(input);
    if (review.profileId !== this.profileId || review.revision !== current.revision || review.digest !== current.digest ||
      review.endpoint !== current.endpoint) throw new MoguriError("otlp_review", "The exact profile, revision or destination review changed. Review again; no exporter was enabled.", 409);
    const configuration: OtlpConfiguration = { ...canonicalOtlpInput(input), revision: current.revision + 1, disclosureVersion: 1 };
    return finish([{ event_type: "telemetry.export_configured", profile_id: this.profileId,
      payload: { configuration, actor: "user", reviewDigest: current.digest } }], { revision: configuration.revision });
  }
}
