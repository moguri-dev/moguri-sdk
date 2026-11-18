import { createHash, createHmac, randomBytes } from "node:crypto";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { canonicalOtlpHeaders, canonicalOtlpInput, isRecord, MoguriError, OTLP_LIMITS, otlpCredentialEndpoint, otlpDisclosure, type OtlpConfiguration,
  type OtlpExportStatus, type OtlpFailureCode, type OtlpInput, type OtlpQuery, type OtlpResponse, type OtlpReview, type CommandResult, type StoredEvent,
  type BudgetEntry, type OperationEntry } from "../../../packages/protocol/src/index.ts";
import type { OtlpCommand } from "../../../packages/protocol/src/telemetry-export.ts";
import { digest } from "./store.ts";
import type { SecretVault } from "./gateway.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import type { ExportRecords, LogObservation, TraceObservation } from "./telemetry-export-wire.ts";

type Failure = NonNullable<OtlpExportStatus["lastFailure"]>;
class ExportFailure extends Error {
  constructor(readonly code: OtlpFailureCode, readonly httpStatus: number | null = null) { super(code); }
}
const outcomes = new Set(["completed", "failed", "stopped", "partial", "unconfirmed", "unknown", "denied"]);
/** Provider finish reasons recorded as a model call's outcome, mapped to the shared outcome vocabulary. */
const finishReasons: Record<string, string> = { stop: "completed", toolUse: "completed", length: "completed", error: "failed", aborted: "stopped" };
/** Outcomes that are failures of the operation itself. Stops, denials and unknown results are not errors (OpenTelemetry status UNSET). */
const errorOutcomes = new Set(["failed", "partial", "unconfirmed"]);
const publicTools = new Set(["read_file", "write_file", "apply_patch", "run_command", "fetch_page", "ask_user", "task_progress", "clock", "discover_tools", "read_tool_result"]);
let publicModels: Set<string> | undefined;
/** Secret-backend slot for one credential header, bound to the exact collector origin and lowercase header name. */
export const otlpCredentialSlot = (endpoint: string, name: string) => `otlp-${createHash("sha256").update(`${endpoint}\0${name.toLowerCase()}`).digest("hex")}`;
const severity = (outcome: string): LogObservation["severity"] => errorOutcomes.has(outcome) ? outcome === "failed" ? "ERROR" : "WARN" : outcome === "denied" ? "WARN" : "INFO";

export class TelemetryExport {
  private started = false;
  private closing = false;
  private current?: OtlpConfiguration;
  private epoch = 0;
  private key = randomBytes(32);
  private queue: TraceObservation[] = [];
  private logs: LogObservation[] = [];
  private source?: ExportRecords;
  private metricsDirty = false;
  private readonly turns = new Map<string, { startedAt: number; env: string }>();
  /** Span keys already observed this epoch, so late canonical corrections become a log record instead of a duplicate span. */
  private readonly exported = new Map<string, string>();
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private request?: AbortController;
  private acceptedSpans = 0;
  private droppedSpans = 0;
  private sampledOut = 0;
  private acceptedLogs = 0;
  private droppedLogs = 0;
  private failedRequests = 0;
  private lastFailure: Failure | null = null;
  private credentialGeneration = 0;
  private credentials?: { generation: number; epoch: number; values: Record<string, string> };
  private readonly stored = new Map<string, boolean | null>();
  constructor(private readonly profileId: string, private readonly configuration: () => OtlpConfiguration, private readonly vault: SecretVault) {}

  start(configuration: OtlpConfiguration): void { this.started = true; this.synchronize(configuration); }
  private synchronize(configuration: OtlpConfiguration): void {
    if (this.current?.revision === configuration.revision) return;
    this.epoch++;
    this.request?.abort();
    clearTimeout(this.timer); this.timer = undefined;
    this.droppedSpans += this.queue.length; this.queue = [];
    this.droppedLogs += this.logs.length; this.logs = [];
    this.metricsDirty = false; this.source = undefined; this.turns.clear(); this.exported.clear(); this.key = randomBytes(32);
    this.credentials = undefined;
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
  private sampled(traceId: string): boolean {
    return Number.parseInt(traceId.slice(0, 13), 16) / 0x10000000000000 < this.current!.samplingRatio;
  }
  /** First observation of a span key returns true; a later record of the same key is a correction and returns false. */
  private first(key: string, state: string): boolean | "unchanged" {
    const previous = this.exported.get(key);
    if (previous === state) return "unchanged";
    if (this.exported.size >= OTLP_LIMITS.exportedSpanKeys && previous === undefined) this.exported.delete(this.exported.keys().next().value!);
    this.exported.set(key, state);
    return previous === undefined;
  }
  private enqueue(value: TraceObservation): void {
    if (!this.sampled(value.traceId)) { this.sampledOut++; this.log(value, false); return; }
    if (!Number.isFinite(value.startMs) || !Number.isFinite(value.endMs) || value.endMs < value.startMs) {
      this.droppedSpans++; this.lastFailure = { code: "encoding", httpStatus: null }; return;
    }
    if (this.queue.length >= OTLP_LIMITS.queuedSpans) {
      this.droppedSpans++; this.lastFailure = { code: "capacity", httpStatus: null }; this.log(value, true); return;
    }
    this.queue.push(value);
    this.log(value, true);
  }
  /** Non-success outcomes become one allowlisted diagnostic log record correlated with the span; bodies are fixed templates only. */
  private log(span: TraceObservation, sampled: boolean, event: "outcome" | "corrected" = "outcome"): void {
    if (!this.current?.logs || event === "outcome" && span.outcome === "completed") return;
    const attributes: LogObservation["attributes"] = {};
    for (const name of ["moguri.env", "moguri.role", "moguri.outcome", "moguri.operation.family", "moguri.operation.actor", "moguri.operation.diagnostic",
      "moguri.accounting.status", "error.type"] as const) if (span.attributes[name] !== undefined) attributes[name] = span.attributes[name]!;
    const record: LogObservation = { traceId: span.traceId, spanId: span.spanId, sampled, timeMs: span.endMs,
      severity: event === "corrected" ? "INFO" : severity(span.outcome), eventName: `moguri.${span.family}.${event}`,
      body: event === "corrected" ? `Canonical ${span.family} record was corrected after export; no additional call was made.` : `${span.family === "mcp" ? "MCP" : span.family[0]!.toUpperCase() + span.family.slice(1)} ${span.family === "turn" ? "ended" : "call ended"} with outcome ${span.outcome}.`,
      attributes };
    if (this.logs.length >= OTLP_LIMITS.queuedLogs) { this.droppedLogs++; this.lastFailure = { code: "capacity", httpStatus: null }; return; }
    this.logs.push(record);
  }
  private outcomeAttributes(attributes: TraceObservation["attributes"], outcome: string): void {
    if (errorOutcomes.has(outcome)) attributes["error.type"] = outcome;
  }
  private model(entry: BudgetEntry, at: number): void {
    const turnId = entry.ownerTurnId ?? entry.turnId ?? entry.id;
    const outcome = finishReasons[entry.outcome] ?? (outcomes.has(entry.outcome) ? entry.outcome : "unknown");
    const attributes: TraceObservation["attributes"] = { "moguri.role": entry.role, "moguri.env": entry.env,
      "moguri.accounting.status": entry.status, "moguri.outcome": outcome, "moguri.timing.known": entry.requestMs > 0 };
    if (finishReasons[entry.outcome]) attributes["gen_ai.response.finish_reasons"] = [entry.outcome];
    this.outcomeAttributes(attributes, outcome);
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
    const span: TraceObservation = { family: "model", ...this.identity(turnId, "model", entry.id, turnId), outcome, attributes,
      startMs: start, endMs: entry.requestMs > 0 ? start + entry.requestMs : at };
    const first = this.first(`model:${entry.id}`, JSON.stringify([entry.status, outcome, entry.reportedTokens, entry.inputTokens, entry.outputTokens, entry.cacheReadTokens, entry.cacheWriteTokens, entry.estimatedUsdMicros]));
    if (first === true) this.enqueue(span);
    else if (first === false) this.log({ ...span, endMs: at }, this.sampled(span.traceId), "corrected");
  }
  private operation(entry: OperationEntry, at: number): void {
    const turnId = entry.ownerTurnId ?? entry.turnId ?? entry.id;
    const attributes: TraceObservation["attributes"] = { "moguri.env": entry.env, "moguri.outcome": entry.outcome,
      "moguri.operation.actor": entry.actor, "moguri.operation.family": entry.family, "moguri.timing.known": entry.elapsedMs !== null };
    this.outcomeAttributes(attributes, entry.outcome);
    if (entry.diagnostic) attributes["moguri.operation.diagnostic"] = entry.diagnostic;
    if (entry.role) attributes["moguri.role"] = entry.role;
    if (entry.family === "tool" && entry.name && publicTools.has(entry.name)) attributes["moguri.tool.name"] = entry.name;
    const known = entry.elapsedMs !== null && entry.startedAt !== null && entry.finishedAt !== null;
    const span: TraceObservation = { family: entry.family, ...this.identity(turnId, entry.family, entry.id, entry.actor === "model" && entry.stepId ? `model:${entry.stepId}` : turnId),
      startMs: known ? Date.parse(entry.startedAt!) : at, endMs: known ? Date.parse(entry.finishedAt!) : at, outcome: entry.outcome, attributes };
    const first = this.first(`${entry.family}:${entry.id}`, JSON.stringify([entry.outcome, entry.diagnostic, entry.elapsedMs]));
    if (first === true) this.enqueue(span);
    else if (first === false) this.log({ ...span, endMs: at }, this.sampled(span.traceId), "corrected");
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
        const attributes: TraceObservation["attributes"] = { "moguri.env": start?.env ?? "unknown", "moguri.outcome": event.payload.outcome, "moguri.timing.known": known };
        this.outcomeAttributes(attributes, event.payload.outcome);
        this.enqueue({ family: "turn", ...this.identity(event.turn_id, "turn", event.turn_id), startMs: known ? start.startedAt : at,
          endMs: at, outcome: event.payload.outcome, attributes });
        this.turns.delete(event.turn_id); this.metricsDirty = true;
      }
    }
    this.schedule();
  }
  private schedule(): void {
    if (this.timer || this.pending || !this.current?.enabled || this.closing || !this.queue.length && !this.logs.length && !this.metricsDirty) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, OTLP_LIMITS.batchMs); this.timer.unref();
  }
  /** Reads every configured credential header for the current origin once per epoch/change. A missing value blocks the request. */
  private async headers(epoch: number): Promise<Record<string, string>> {
    const configuration = this.current!, names = configuration.headers ?? [];
    if (!names.length || !configuration.endpoint) return {};
    if (this.credentials?.epoch === epoch && this.credentials.generation === this.credentialGeneration) return this.credentials.values;
    const generation = this.credentialGeneration, values: Record<string, string> = {};
    for (const name of names) {
      const slot = otlpCredentialSlot(configuration.endpoint, name);
      let value: string | null;
      try { value = await this.vault.read(slot, AbortSignal.timeout(OTLP_LIMITS.requestMs)); }
      catch { this.stored.set(slot, null); throw new ExportFailure("credential"); }
      this.stored.set(slot, value !== null);
      if (value === null) throw new ExportFailure("credential");
      values[name] = value;
    }
    if (epoch === this.epoch && generation === this.credentialGeneration) this.credentials = { generation, epoch, values };
    return values;
  }
  private async send(endpoint: string, signal: "traces" | "metrics" | "logs", bytes: Uint8Array, epoch: number, headers: Record<string, string>): Promise<void> {
    if (bytes.byteLength > OTLP_LIMITS.requestBytes) throw new ExportFailure("capacity");
    if (epoch !== this.epoch || !this.current?.enabled) throw new ExportFailure("cancelled");
    const abort = new AbortController(); this.request = abort;
    const timer = setTimeout(() => abort.abort(new ExportFailure("timeout")), OTLP_LIMITS.requestMs); timer.unref();
    try {
      const response = await fetch(`${endpoint}/v1/${signal}`, { method: "POST", redirect: "error", credentials: "omit",
        headers: { ...headers, "content-type": "application/json" }, body: new Uint8Array(bytes), signal: abort.signal });
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
        const partial = value.partialSuccess, field = signal === "traces" ? "rejectedSpans" : signal === "logs" ? "rejectedLogRecords" : "rejectedDataPoints", rejected = partial[field];
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
      while (epoch === this.epoch && this.current?.enabled && (this.queue.length || this.logs.length || this.metricsDirty)) {
        const batch = this.queue.splice(0, OTLP_LIMITS.batchSpans), records = this.logs.splice(0, OTLP_LIMITS.batchLogs), metrics = this.metricsDirty;
        this.metricsDirty = false;
        const instance = this.alias("instance", "resource", 16);
        let spansAccepted = false, logsAccepted = false;
        try {
          const headers = await this.headers(epoch);
          const wire = await import("./telemetry-export-wire.ts");
          if (batch.length) { await this.send(endpoint, "traces", wire.tracePayload(batch, instance), epoch, headers); this.acceptedSpans += batch.length; spansAccepted = true; }
          if (records.length) { await this.send(endpoint, "logs", wire.logPayload(records, instance), epoch, headers); this.acceptedLogs += records.length; logsAccepted = true; }
          if (metrics && this.source) await this.send(endpoint, "metrics", wire.metricPayload(this.source, instance), epoch, headers);
          if (epoch === this.epoch) this.lastFailure = null;
        } catch (error) {
          if (!spansAccepted) this.droppedSpans += batch.length;
          if (!logsAccepted) this.droppedLogs += records.length;
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
      this.epoch++; this.request?.abort(); this.droppedSpans += this.queue.length; this.queue = []; this.droppedLogs += this.logs.length; this.logs = []; this.metricsDirty = false;
      this.lastFailure = { code: "shutdown", httpStatus: null };
      console.error("OTLP shutdown drain reached its bound; unconfirmed metadata was not replayed.");
    }
    this.turns.clear(); this.exported.clear(); this.source = undefined; this.credentials = undefined;
  }
  review(input: OtlpInput): OtlpReview {
    const canonical = canonicalOtlpInput(input);
    const fields: Omit<OtlpReview, "digest"> = { ...canonical, profileId: this.profileId, revision: this.configuration().revision,
      transport: "otlp-http-json", signals: canonical.logs ? ["traces", "metrics", "logs"] : ["traces", "metrics"], disclosureVersion: otlpDisclosure(canonical) };
    return { ...fields, digest: digest(JSON.stringify(fields)) };
  }
  private async headerStatus(configuration: OtlpConfiguration): Promise<OtlpExportStatus["headers"]> {
    const names = configuration.headers ?? [], endpoint = configuration.endpoint;
    if (!endpoint) return names.map((name) => ({ name, stored: false }));
    return Promise.all(names.map(async (name) => {
      const slot = otlpCredentialSlot(endpoint, name);
      if (!this.stored.has(slot)) {
        try { this.stored.set(slot, await this.vault.read(slot, AbortSignal.timeout(5000)) !== null); }
        catch { return { name, stored: null }; }
      }
      return { name, stored: this.stored.get(slot)! };
    }));
  }
  /** Current counters without touching the secret backend; header state comes from the last known read. */
  status(): OtlpExportStatus {
    const configuration = structuredClone(this.configuration()), endpoint = configuration.endpoint;
    return { configuration, phase: !configuration.enabled ? "disabled" : this.closing ? "closing" : this.pending ? "exporting" : this.lastFailure ? "degraded" : "idle",
      queuedSpans: this.queue.length, acceptedSpans: this.acceptedSpans, droppedSpans: this.droppedSpans, sampledOut: this.sampledOut,
      queuedLogs: this.logs.length, acceptedLogs: this.acceptedLogs, droppedLogs: this.droppedLogs,
      headers: (configuration.headers ?? []).map((name) => ({ name, stored: endpoint ? this.stored.get(otlpCredentialSlot(endpoint, name)) ?? null : false })),
      failedRequests: this.failedRequests, lastFailure: this.lastFailure ? { ...this.lastFailure } : null, limits: OTLP_LIMITS };
  }
  async query(query: OtlpQuery): Promise<OtlpResponse> {
    if (query.type === "telemetry.export.review") return { type: query.type, review: this.review(query.input) };
    const headers = await this.headerStatus(this.configuration());
    return { type: query.type, ...this.status(), headers };
  }
  apply(review: OtlpReview, finish: WorkspaceFinish): CommandResult {
    const input = { enabled: review.enabled, endpoint: review.endpoint, samplingRatio: review.samplingRatio, logs: review.logs, headers: review.headers };
    const current = this.review(input);
    if (review.profileId !== this.profileId || review.revision !== current.revision || review.digest !== current.digest ||
      review.endpoint !== current.endpoint) throw new MoguriError("otlp_review", "The exact profile, revision or destination review changed. Review again; no exporter was enabled.", 409);
    const { logs, headers, ...signals } = canonicalOtlpInput(input), disclosureVersion = otlpDisclosure({ logs, headers });
    const configuration: OtlpConfiguration = disclosureVersion === 1 ? { ...signals, revision: current.revision + 1, disclosureVersion } :
      { ...signals, logs, headers, revision: current.revision + 1, disclosureVersion };
    return finish([{ event_type: "telemetry.export_configured", profile_id: this.profileId,
      payload: { configuration, actor: "user", reviewDigest: current.digest } }], { revision: configuration.revision });
  }
  /** Stores or removes one credential header value in this profile's secret backend. The value never enters events, status or logs. */
  async credential(command: Exclude<OtlpCommand, { type: "telemetry.export.configure" }>, finish: WorkspaceFinish): Promise<CommandResult> {
    const endpoint = otlpCredentialEndpoint(command.endpoint), [name] = canonicalOtlpHeaders([command.name]), slot = otlpCredentialSlot(endpoint, name!);
    try {
      if (command.type === "telemetry.export.credential.set") await this.vault.write(slot, command.value, AbortSignal.timeout(15_000));
      else if (await this.vault.read(slot, AbortSignal.timeout(15_000)) !== null) await this.vault.remove(slot, AbortSignal.timeout(15_000));
    } catch {
      this.stored.delete(slot);
      throw new MoguriError("otlp_secret", "The exporter credential could not be changed in the secret backend. Unlock it and retry; no plaintext fallback was used.", 503);
    }
    this.stored.set(slot, command.type === "telemetry.export.credential.set");
    this.credentialGeneration++; this.credentials = undefined;
    return finish([], {});
  }
}
