import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";

/**
 * Protocol 113: pull request automation. Two independent flags, each with a global default (off) and an optional
 * per-repository override. "Fix broken CI" reruns failed GitHub Actions jobs only when fresh provider health and the job's own log
 * point to a transient cause. "Automatic conflict resolution" queues a feature-preserving merge turn when GitHub reports conflicts.
 * Neither flag grants push, merge, rebase or authentication permission.
 */
const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const id = Type.String({ minLength: 1, maxLength: 128 });
const timestamp = Type.String({ format: "date-time" });
const sha = Type.String({ pattern: "^[a-f0-9]{40}$" });
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const positive = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const text = (maxLength: number) => Type.String({ minLength: 1, maxLength });
const repoPath = Type.String({ minLength: 1, maxLength: 1024, pattern: "^[^\\u0000\\r\\n]+$" });

export const PrAutomationSettingsSchema = object({
  /** Rerun failed GitHub Actions jobs whose log and provider status point to a transient cause. */
  ciRetry: Type.Boolean(),
  /** Queue a feature-preserving conflict resolution turn when GitHub reports the PR conflicts with its base. */
  conflictResolution: Type.Boolean(),
});
export type PrAutomationSettings = Static<typeof PrAutomationSettingsSchema>;
/** Both flags start off: saving any other preference never enables new automation. */
export const DEFAULT_PR_AUTOMATION: PrAutomationSettings = { ciRetry: false, conflictResolution: false };
/** A repository override. Absent means the repository inherits the global default. */
export const PrAutomationOverrideSchema = Type.Union([Type.Literal("enabled"), Type.Literal("disabled")]);
export type PrAutomationOverride = Static<typeof PrAutomationOverrideSchema>;
export type PrAutomationFlag = keyof PrAutomationSettings;
export const PR_AUTOMATION_FLAGS: readonly PrAutomationFlag[] = ["ciRetry", "conflictResolution"];
export const PR_AUTOMATION_LABELS: Record<PrAutomationFlag, string> = { ciRetry: "Fix broken CI", conflictResolution: "Automatic conflict resolution" };

interface RepositoryOverrides { repo: { ciRetry?: PrAutomationOverride; conflictResolution?: PrAutomationOverride } }
export const prAutomationDefaults = (settings: { prAutomation?: PrAutomationSettings }): PrAutomationSettings => settings.prAutomation ?? DEFAULT_PR_AUTOMATION;
export interface EffectivePrAutomationFlag {
  flag: PrAutomationFlag; value: boolean; source: "global" | "repository"; override: PrAutomationOverride | null; global: boolean;
}
export type EffectivePrAutomation = Record<PrAutomationFlag, EffectivePrAutomationFlag>;
/** The value each flag takes for one repository, and where it comes from. A repository override always wins. */
export function effectivePrAutomation(settings: { prAutomation?: PrAutomationSettings }, project: RepositoryOverrides | null): EffectivePrAutomation {
  const global = prAutomationDefaults(settings);
  const resolve = (flag: PrAutomationFlag): EffectivePrAutomationFlag => {
    const override = project?.repo[flag] ?? null;
    return { flag, value: override === null ? global[flag] : override === "enabled", source: override === null ? "global" : "repository", override, global: global[flag] };
  };
  return { ciRetry: resolve("ciRetry"), conflictResolution: resolve("conflictResolution") };
}
export interface PrAutomationException { projectId: string; flag: PrAutomationFlag; override: PrAutomationOverride; value: boolean; global: boolean }
/** Every explicit repository override, for the global settings view. Restoring inheritance removes the entry. */
export function prAutomationExceptions(settings: { prAutomation?: PrAutomationSettings },
  configurations: readonly { projectId: string; values: RepositoryOverrides }[], projectIds?: ReadonlySet<string>): PrAutomationException[] {
  const global = prAutomationDefaults(settings);
  return configurations.filter((configuration) => !projectIds || projectIds.has(configuration.projectId)).flatMap((configuration) =>
    PR_AUTOMATION_FLAGS.flatMap((flag) => {
      const override = configuration.values.repo[flag];
      return override ? [{ projectId: configuration.projectId, flag, override, value: override === "enabled", global: global[flag] }] : [];
    }));
}
/** Sets or clears one repository override without touching the other flag or any other repository field. */
export function withPrAutomationOverride<T extends RepositoryOverrides>(settings: T, flag: PrAutomationFlag, choice: "inherit" | PrAutomationOverride): T {
  const repo = { ...settings.repo };
  if (choice === "inherit") delete repo[flag]; else repo[flag] = choice;
  return { ...settings, repo };
}
export const prAutomationSourceLabel = (effective: EffectivePrAutomationFlag): string =>
  `${effective.value ? "On" : "Off"} (${effective.source === "repository" ? "repository override" : "global default"})`;

export const CI_RETRY_LIMITS = {
  /** Automatic reruns per check on one PR head. */
  attempts: 2,
  /** Wait after the failed job finished before each attempt. */
  backoffMs: [60_000, 5 * 60_000] as readonly number[],
  /** GitHub Status data older than this is stale, not healthy. */
  statusMaxAgeMs: 5 * 60_000,
  /** Recent incidents count when they overlap the failed job, with this margin. */
  incidentMarginMs: 5 * 60_000,
  /** Tail of each job log that is classified. */
  logBytes: 512 * 1024,
  /** A requested rerun with no observable new attempt after this long stays unconfirmed. */
  resultWindowMs: 60 * 60_000,
  /** Failing checks considered per poll. */
  checksPerPoll: 10,
} as const;
export const CONFLICT_RESOLUTION_LIMITS = { perRound: 2, paths: 100 } as const;
/** GitHub Status components whose disruption can fail an Actions job or its rerun. */
export const GITHUB_CI_COMPONENTS: readonly string[] = ["Actions", "API Requests", "Git Operations"];
export const GITHUB_STATUS_PAGE = "https://www.githubstatus.com";

export type CiFailureKind = "transient" | "deterministic" | "unclear";
export const CiFailureClassificationSchema = object({
  kind: Type.Union([Type.Literal("transient"), Type.Literal("deterministic"), Type.Literal("unclear")]),
  reason: text(500),
  /** Up to three short matching log lines. Untrusted provider text, shown as evidence only. */
  evidence: Type.Array(text(240), { maxItems: 3 }),
});
export type CiFailureClassification = Static<typeof CiFailureClassificationSchema>;
interface Rule { pattern: RegExp; label: string }
const TRANSIENT: readonly Rule[] = [
  { pattern: /\b50[0234]\s+(?:Internal Server Error|Bad Gateway|Service Unavailable|Gateway Time-?out)\b/i, label: "an external endpoint returned HTTP 5xx" },
  { pattern: /\b(?:HTTP(?:\/\d(?:\.\d)?)?|status(?: code)?|response(?: code)?|returned(?: error)?|received)\s*[:=]?\s*50[0234]\b/i, label: "an external endpoint returned HTTP 5xx" },
  { pattern: /\bcode E50[0234]\b/, label: "the package registry returned HTTP 5xx" },
  { pattern: /\b429 Too Many Requests\b|\bsecondary rate limit\b|\bAPI rate limit exceeded\b/i, label: "an external service rate-limited the job" },
  { pattern: /\b(?:ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|EPIPE|ERR_SOCKET_TIMEOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)\b/, label: "a network connection failed" },
  { pattern: /socket hang up|Connection reset by peer|Could not resolve host|Temporary failure in name resolution|TLS handshake timeout|i\/o timeout|Network is unreachable|Connection timed out/i, label: "a network connection failed" },
  { pattern: /The runner has received a shutdown signal|The hosted runner encountered an error|lost communication with the server|The job was not acquired by Runner/i, label: "the CI runner failed" },
];
const DETERMINISTIC: readonly Rule[] = [
  { pattern: /\bAssertionError\b|\bAssertion failed\b/i, label: "a test assertion failed" },
  { pattern: /\bexpected\b.{0,200}\bto (?:equal|be|deep(?:ly)? equal|strictly equal|match|contain|have)\b/i, label: "a test assertion failed" },
  { pattern: /^\s*(?:Expected|Received)(?: value)?:\s/, label: "a test assertion failed" },
  { pattern: /\berror TS\d{4}:/, label: "type checking failed" },
  { pattern: /\berror\[E\d{4}\]/, label: "compilation failed" },
  { pattern: /\bSyntaxError:|\bcannot find symbol\b|\bundefined reference to\b/, label: "compilation failed" },
  { pattern: /\bModuleNotFoundError\b|\bCannot find module\b|\bModule not found\b/, label: "a module could not be resolved" },
  { pattern: /\b\d+ problems? \(\d+ errors?|✖ \d+ problems?/, label: "lint failed" },
];
const timestampPrefix = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s?/;
const evidenceLine = (line: string) => line.replace(timestampPrefix, "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 240);
/**
 * Classifies a failed job from its own log. Deterministic evidence (assertions, type/compile/lint errors) wins over transient
 * evidence, so a test that failed because of an outage still needs a human. A log with neither is unclear and is never retried.
 */
export function classifyCiFailure(log: string, options: { complete?: boolean; providerIncident?: string | null } = {}): CiFailureClassification {
  const lines = log.split(/\r?\n/).slice(-20_000);
  const found = (rules: readonly Rule[]) => {
    const hits: { label: string; line: string }[] = [];
    for (const raw of lines) {
      if (raw.length > 4096) continue;
      // Actions prefixes every log line with a timestamp; anchored rules must see the line itself.
      const line = raw.replace(timestampPrefix, "");
      const rule = rules.find((value) => value.pattern.test(line));
      const evidence = rule && evidenceLine(line);
      if (rule && evidence) hits.push({ label: rule.label, line: evidence });
    }
    return hits;
  };
  const deterministic = found(DETERMINISTIC);
  if (deterministic.length) return { kind: "deterministic", reason: `The job log shows that ${deterministic[0]!.label}. Moguri doesn't rerun deterministic failures.`, evidence: [...new Set(deterministic.map((hit) => hit.line))].slice(-3) };
  if (options.providerIncident) return { kind: "transient", reason: `A GitHub incident overlapped this job: ${options.providerIncident.slice(0, 300)}.`, evidence: [] };
  const transient = found(TRANSIENT);
  if (transient.length) return { kind: "transient", reason: `The job log shows that ${transient.at(-1)!.label}.`, evidence: [...new Set(transient.map((hit) => hit.line))].slice(-3) };
  return { kind: "unclear", reason: options.complete === false ? "The job log was unavailable or incomplete, so the cause is unclear. Moguri doesn't rerun unclear failures." :
    "The job log shows no recognized transient cause. Moguri doesn't rerun unclear failures.", evidence: [] };
}

export const ProviderIncidentSchema = object({
  id: text(128), name: text(300), url: nullable(text(2048)), impact: text(64), status: text(64),
  startedAt: timestamp, resolvedAt: nullable(timestamp), components: Type.Array(text(200), { maxItems: 20 }),
});
export type ProviderIncident = Static<typeof ProviderIncidentSchema>;
export const ProviderHealthSchema = object({
  provider: Type.Literal("github-actions"),
  /** "unknown" covers unreachable, malformed and stale status data: it pauses retries just like a disruption. */
  state: Type.Union([Type.Literal("operational"), Type.Literal("disrupted"), Type.Literal("unknown")]),
  observedAt: timestamp,
  components: Type.Array(object({ name: text(200), status: text(64) }), { maxItems: 10 }),
  incidents: Type.Array(ProviderIncidentSchema, { maxItems: 5 }),
  diagnostic: nullable(text(500)),
});
export type ProviderHealth = Static<typeof ProviderHealthSchema>;
export interface ProviderStatusObservation { summary: unknown; incidents: unknown; observedAt: string; ageSeconds: number | null; date: string | null }
const record = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const iso = (value: unknown): string | null => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const statusUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" && ["stspg.io", "www.githubstatus.com", "githubstatus.com"].includes(url.host) ? url.href.slice(0, 2048) : null; } catch { return null; }
};
function incident(value: unknown): ProviderIncident | null {
  const item = record(value), components = Array.isArray(item.components) ? item.components.flatMap((component) => {
    const name = record(component).name;
    return typeof name === "string" && name.trim() ? [name.trim().slice(0, 200)] : [];
  }).slice(0, 20) : [];
  const startedAt = iso(item.started_at) ?? iso(item.created_at);
  if (typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name.trim() || !startedAt) return null;
  return { id: item.id.slice(0, 128), name: item.name.trim().slice(0, 300), url: statusUrl(item.shortlink) ?? (/^[a-z0-9]{1,64}$/.test(item.id) ? `${GITHUB_STATUS_PAGE}/incidents/${item.id}` : null),
    impact: typeof item.impact === "string" && item.impact ? item.impact.slice(0, 64) : "unknown", status: typeof item.status === "string" && item.status ? item.status.slice(0, 64) : "unknown",
    startedAt, resolvedAt: iso(item.resolved_at), components };
}
const relevant = (value: ProviderIncident) => value.components.some((name) => GITHUB_CI_COMPONENTS.includes(name)) ||
  !value.components.length && /\b(?:Actions|API Requests|Git Operations)\b/i.test(value.name);
/**
 * Evaluates GitHub Status for CI. Disrupted means a relevant component is not operational or a relevant incident is unresolved.
 * Unreachable, malformed or stale data is unknown, never healthy. Recent resolved incidents that overlapped the failed job are
 * returned separately: they explain a failure without blaming repository code.
 */
export function evaluateGithubStatus(observation: ProviderStatusObservation | { error: string; observedAt: string }, now: number,
  window: { startedAt: string | null; completedAt: string | null } | null = null): { health: ProviderHealth; overlapping: ProviderIncident[] } {
  const base = { provider: "github-actions" as const, observedAt: observation.observedAt, components: [], incidents: [] };
  if ("error" in observation) return { health: { ...base, state: "unknown", diagnostic: observation.error.slice(0, 500) }, overlapping: [] };
  const date = observation.date ? Date.parse(observation.date) : NaN;
  if (observation.ageSeconds !== null && observation.ageSeconds * 1000 > CI_RETRY_LIMITS.statusMaxAgeMs ||
    Number.isFinite(date) && now - date > CI_RETRY_LIMITS.statusMaxAgeMs) {
    return { health: { ...base, state: "unknown", diagnostic: "GitHub Status served stale data, so provider health is unknown. Automatic retries are paused." }, overlapping: [] };
  }
  const summary = record(observation.summary);
  const components = (Array.isArray(summary.components) ? summary.components : []).flatMap((value) => {
    const item = record(value);
    return typeof item.name === "string" && GITHUB_CI_COMPONENTS.includes(item.name) && typeof item.status === "string" ? [{ name: item.name, status: item.status.slice(0, 64) }] : [];
  }).slice(0, 10);
  if (!components.some((component) => component.name === "Actions") || !Array.isArray(summary.incidents)) {
    return { health: { ...base, components, state: "unknown", diagnostic: "GitHub Status didn't report the Actions component, so provider health is unknown. Automatic retries are paused." }, overlapping: [] };
  }
  const active = summary.incidents.map(incident).filter((value): value is ProviderIncident => value !== null && value.resolvedAt === null && relevant(value)).slice(0, 5);
  const disrupted = components.filter((component) => component.status !== "operational");
  const recent = (Array.isArray(record(observation.incidents).incidents) ? record(observation.incidents).incidents as unknown[] : []).map(incident)
    .filter((value): value is ProviderIncident => value !== null && relevant(value));
  const started = window?.startedAt ? Date.parse(window.startedAt) : NaN, completed = window?.completedAt ? Date.parse(window.completedAt) : NaN;
  const overlapping = Number.isFinite(started) || Number.isFinite(completed) ? recent.filter((value) => {
    const from = Date.parse(value.startedAt) - CI_RETRY_LIMITS.incidentMarginMs, to = (value.resolvedAt ? Date.parse(value.resolvedAt) : now) + CI_RETRY_LIMITS.incidentMarginMs;
    return from <= (Number.isFinite(completed) ? completed : started) && to >= (Number.isFinite(started) ? started : completed);
  }).slice(0, 5) : [];
  if (active.length || disrupted.length) {
    const names = disrupted.map((component) => `${component.name} is ${component.status.replaceAll("_", " ")}`);
    return { health: { ...base, components, incidents: active, state: "disrupted",
      diagnostic: `GitHub reports ${[...active.map((value) => `"${value.name}"`), ...names].join("; ").slice(0, 400)}. Automatic retries wait for recovery.` }, overlapping };
  }
  return { health: { ...base, components, state: "operational", diagnostic: null }, overlapping };
}

const RepositorySchema = Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}$" });
const PullUrlSchema = Type.String({ pattern: "^https://github\\.com/[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}/pull/[1-9][0-9]{0,9}$" });
const RefSchema = Type.String({ minLength: 1, maxLength: 255, pattern: "^[^\\u0000-\\u001f\\u007f ~^:?*\\[\\\\]+$" });
export const CiRetryAttemptSchema = object({
  attempt: Type.Integer({ minimum: 1, maximum: CI_RETRY_LIMITS.attempts }),
  /** The failed job this attempt reran. */
  jobId: positive, runId: positive, admittedAt: timestamp,
  /** admitted is retained before the request; unconfirmed means Moguri could not learn whether GitHub accepted it. */
  status: Type.Union([Type.Literal("admitted"), Type.Literal("requested"), Type.Literal("failed"), Type.Literal("unconfirmed")]),
  requestedAt: nullable(timestamp),
  /** The rerun's actual conclusion on GitHub, once observed. */
  result: nullable(text(64)), resultJobId: nullable(positive), resultAt: nullable(timestamp),
  diagnostic: nullable(text(1000)),
});
export type CiRetryAttempt = Static<typeof CiRetryAttemptSchema>;
export const CI_RETRY_STATUSES = ["deferred", "scheduled", "requested", "unconfirmed", "succeeded", "exhausted", "ineligible", "failed", "cancelled", "superseded"] as const;
export type CiRetryStatus = typeof CI_RETRY_STATUSES[number];
export const CI_RETRY_TERMINAL: ReadonlySet<CiRetryStatus> = new Set(["succeeded", "exhausted", "ineligible", "failed", "cancelled", "superseded"]);
const PrBindingSchema = object({ repository: RepositorySchema, number: positive, url: PullUrlSchema, headSha: sha, headRef: RefSchema });
export const CiRetryRecordSchema = object({
  version: Type.Literal(1), kind: Type.Literal("ci-retry"), id, profileId: id, sessionId: id, projectId: id, revision: count, createdAt: timestamp, updatedAt: timestamp,
  binding: object({ ...PrBindingSchema.properties, account: object({ login: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}$" }), id: positive }) }),
  /** The original failed check. Job and run IDs are null for checks that aren't GitHub Actions jobs. */
  check: object({ name: text(255), jobId: nullable(positive), runId: nullable(positive), url: nullable(text(2048)), startedAt: nullable(timestamp), completedAt: nullable(timestamp) }),
  status: Type.Union([Type.Literal("deferred"), Type.Literal("scheduled"), Type.Literal("requested"), Type.Literal("unconfirmed"), Type.Literal("succeeded"),
    Type.Literal("exhausted"), Type.Literal("ineligible"), Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("superseded")]),
  classification: nullable(CiFailureClassificationSchema),
  health: nullable(ProviderHealthSchema),
  notBefore: nullable(timestamp),
  attempts: Type.Array(CiRetryAttemptSchema, { maxItems: CI_RETRY_LIMITS.attempts }),
  cancellation: nullable(object({ actor: Type.Union([Type.Literal("user"), Type.Literal("settings")]), at: timestamp })),
  diagnostic: nullable(text(2000)),
});
export type CiRetryRecord = Static<typeof CiRetryRecordSchema>;
export const CONFLICT_RESOLUTION_STATUSES = ["queued", "merged", "paused", "needs-review", "stopped", "unverified"] as const;
export type ConflictResolutionStatus = typeof CONFLICT_RESOLUTION_STATUSES[number];
const paths = Type.Array(repoPath, { maxItems: CONFLICT_RESOLUTION_LIMITS.paths });
export const ConflictResolutionRecordSchema = object({
  version: Type.Literal(1), kind: Type.Literal("conflict-resolution"), id, profileId: id, sessionId: id, projectId: id, revision: count, createdAt: timestamp, updatedAt: timestamp,
  binding: object({ ...PrBindingSchema.properties, baseRef: RefSchema, baseSha: sha }),
  status: Type.Union([Type.Literal("queued"), Type.Literal("merged"), Type.Literal("paused"), Type.Literal("needs-review"), Type.Literal("stopped"), Type.Literal("unverified")]),
  turnId: nullable(id), turnOutcome: nullable(text(64)),
  verification: nullable(object({
    checkedAt: timestamp, head: nullable(sha), mergeInProgress: Type.Boolean(), containsHead: Type.Boolean(), containsBase: Type.Boolean(),
    conflicted: paths, unmerged: paths, discarded: paths, markers: paths,
  })),
  diagnostic: nullable(text(2000)),
});
export type ConflictResolutionRecord = Static<typeof ConflictResolutionRecordSchema>;
export const PrAutomationRecordSchema = Type.Union([CiRetryRecordSchema, ConflictResolutionRecordSchema]);
export type PrAutomationRecord = CiRetryRecord | ConflictResolutionRecord;
export const prAutomationTerminal = (value: PrAutomationRecord): boolean =>
  value.kind === "ci-retry" ? CI_RETRY_TERMINAL.has(value.status) : value.status !== "queued";

export interface PrAutomationEventPayloads { "pr_automation.recorded": { record: PrAutomationRecord } }
export const prAutomationEventTypes = ["pr_automation.recorded"] as const;
export const PrAutomationCommandSchema = object({ type: Type.Literal("pr_automation.cancel"), recordId: id, expectedRevision: count });
export type PrAutomationCommand = Static<typeof PrAutomationCommandSchema>;
export const isPrAutomationCommand = (value: unknown): value is PrAutomationCommand => Value.Check(PrAutomationCommandSchema, value);

/**
 * Validates one durable revision. Identity and binding never change, revisions are monotonic and terminal outcomes are final.
 * A CI attempt keeps its original job and admission; only its status, result and diagnostic may be settled later.
 */
export function projectPrAutomationRecord(previous: PrAutomationRecord | undefined, value: unknown, event: { profile_id: string; project_id?: string | null; session_id?: string | null }): PrAutomationRecord {
  const corrupt = (): never => { throw new MoguriError("pr_automation_corrupt", "A pull request automation record lost its original session, PR binding or monotonic revision. State was preserved.", 409); };
  if (!Value.Check(PrAutomationRecordSchema, value)) return corrupt();
  const next = value as PrAutomationRecord;
  if (next.profileId !== event.profile_id || next.projectId !== event.project_id || next.sessionId !== event.session_id || next.updatedAt < next.createdAt) return corrupt();
  if (!previous) return next.revision === 0 ? structuredClone(next) : corrupt();
  if (next.kind !== previous.kind || next.revision !== previous.revision + 1 || next.createdAt !== previous.createdAt || next.updatedAt < previous.updatedAt ||
    JSON.stringify(next.binding) !== JSON.stringify(previous.binding) || prAutomationTerminal(previous) && next.status !== previous.status) return corrupt();
  if (next.kind === "ci-retry" && previous.kind === "ci-retry") {
    if (JSON.stringify(next.check) !== JSON.stringify(previous.check) || next.attempts.length < previous.attempts.length) return corrupt();
    for (const [index, attempt] of previous.attempts.entries()) {
      const actual = next.attempts[index]!;
      if (actual.attempt !== attempt.attempt || actual.jobId !== attempt.jobId || actual.runId !== attempt.runId || actual.admittedAt !== attempt.admittedAt) return corrupt();
    }
    if (next.attempts.some((attempt, index) => attempt.attempt !== index + 1)) return corrupt();
  }
  return structuredClone(next);
}
/** True for history that only protocol 113 can write: records, the settings section, repository overrides or conflict turns. */
export function hasPrAutomationHistory(event: { event_type: string; payload: unknown }): boolean {
  const payload = record(event.payload);
  if (event.event_type === "pr_automation.recorded") return true;
  if (event.event_type === "settings.updated") return record(payload.settings).prAutomation !== undefined;
  if (event.event_type === "project.configured") {
    const repo = record(record(record(payload.configuration).values).repo);
    return repo.ciRetry !== undefined || repo.conflictResolution !== undefined;
  }
  if (event.event_type === "queue.enqueued" || event.event_type === "turn.started") {
    const lifecycle = record(record(payload.item).lifecycle);
    return lifecycle.trigger === "conflicts" || lifecycle.automation !== undefined || lifecycle.conflicts !== undefined;
  }
  return false;
}
/** Statuses that keep a failing check in automation's hands, so the model isn't asked to "fix" it meanwhile. */
export const ciRetryOwnsCheck = (value: CiRetryRecord): boolean => ["deferred", "scheduled", "requested", "succeeded"].includes(value.status);
export const CI_RETRY_STATUS_LABELS: Record<CiRetryStatus, string> = {
  deferred: "Paused", scheduled: "Retry scheduled", requested: "Rerun requested", unconfirmed: "Rerun unconfirmed", succeeded: "Passed after rerun",
  exhausted: "Still failing", ineligible: "Not retried", failed: "Rerun failed", cancelled: "Cancelled", superseded: "Superseded",
};
export const CONFLICT_RESOLUTION_STATUS_LABELS: Record<ConflictResolutionStatus, string> = {
  queued: "Resolution queued", merged: "Both sides merged", paused: "Left for your review", "needs-review": "Needs your review", stopped: "Stopped", unverified: "Not verified",
};
