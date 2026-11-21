import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";
import { GithubCiObservationSchema, GithubInspectionSchema, GithubItemSchema, GithubScopeSchema, GithubSourceBindingSchema, githubItemIdentity,
  type GithubCiObservation, type GithubScope, type GithubWorkSource } from "./github-workflows.ts";
import type { StoredEvent } from "./index.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 256 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const revision = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const nullableHash = Type.Union([hash, Type.Null()]);
const timestamp = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
const diagnostic = Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()]);
const repository = Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}/(?!\\.{1,2}$)[A-Za-z0-9_.-]{1,100}$" });
const account = Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}$" });
const remote = object({ name: Type.String({ minLength: 1, maxLength: 100 }), fetchUrl: Type.String({ minLength: 1, maxLength: 4096 }),
  pushUrls: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { minItems: 1, maxItems: 100 }) });
export const MyWorkSourceSchema = object({
  version: Type.Literal(1), id: hash, profileId: id, revision, enabled: Type.Boolean(), actor: Type.Literal("user"),
  repository, account, accountId: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,38}:[1-9][0-9]*$" }),
  binding: GithubSourceBindingSchema, remote, createdAt: timestamp, updatedAt: timestamp,
});
export type MyWorkSource = Static<typeof MyWorkSourceSchema>;
export interface MyWorkSourcePreview {
  source: Omit<MyWorkSource, "revision" | "enabled" | "createdAt" | "updatedAt">;
  digest: string; expectedRevision: number | null; boundary: "controller-gh-account-not-ssh"; warning: string;
}
export const MyWorkRequestSchema = object({
  kind: Type.Union([Type.Literal("user"), Type.Literal("team"), Type.Literal("bot"), Type.Literal("mannequin"), Type.Literal("enterprise-team")]),
  login: Type.String({ minLength: 1, maxLength: 256 }),
  url: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]), nodeId: Type.Optional(id),
});
export const MyWorkThreadSchema = object({
  id, commentId: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  resolved: Type.Boolean(), outdated: Type.Boolean(), body: Type.String({ maxLength: 512 * 1024 }),
  path: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
  line: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]), url: Type.String({ minLength: 1, maxLength: 4096 }),
});
export const MyWorkPullSchema = object({
  item: GithubItemSchema, observedAt: timestamp, complete: Type.Boolean(), diagnostic,
  reviewDecision: Type.Union([Type.Literal("APPROVED"), Type.Literal("CHANGES_REQUESTED"), Type.Literal("REVIEW_REQUIRED"), Type.Null()]),
  requests: Type.Union([Type.Array(MyWorkRequestSchema, { maxItems: 1000 }), Type.Null()]),
  threads: Type.Union([Type.Array(MyWorkThreadSchema, { maxItems: 1000 }), Type.Null()]),
  ci: Type.Union([GithubCiObservationSchema, Type.Null()]),
  ciWatchId: Type.Optional(id),
});
export type MyWorkPull = Static<typeof MyWorkPullSchema>;
export const MyWorkObservationSchema = object({
  version: Type.Literal(1), source: MyWorkSourceSchema, at: timestamp, complete: Type.Boolean(), diagnostic,
  pulls: Type.Array(MyWorkPullSchema, { maxItems: 1000 }),
});
export type MyWorkObservation = Static<typeof MyWorkObservationSchema>;
export const MyWorkCategorySchema = Type.Union([
  Type.Literal("open-pr"), Type.Literal("pending-review"), Type.Literal("failed-ci"), Type.Literal("unresolved-thread"),
]);
export type MyWorkCategory = Static<typeof MyWorkCategorySchema>;
export const MyWorkAttentionSchema = object({
  itemId: id, sourceIds: Type.Array(hash, { minItems: 1, maxItems: 100, uniqueItems: true }), fingerprint: hash,
  repository, number: Type.Integer({ minimum: 1 }), headSha: Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }),
  categories: Type.Array(MyWorkCategorySchema, { minItems: 1, maxItems: 4, uniqueItems: true }),
});
export type MyWorkAttention = Static<typeof MyWorkAttentionSchema>;
/**
 * Protocol 119 (D66): the refresh a scheduled dependency roundup run started. The timer is the actual actor; the
 * user's activation command of that roundup settings revision is the authorization, recorded separately.
 */
export const MyWorkRefreshTriggerSchema = object({
  kind: Type.Literal("dependency-roundup-schedule"), runId: id, settingsRevision: revision, activationCommandId: id, activationCommandDigest: hash,
});
export type MyWorkRefreshTrigger = Static<typeof MyWorkRefreshTriggerSchema>;
export const MyWorkRefreshSchema = object({
  version: Type.Literal(1), id, kind: Type.Literal("my_work.refresh"), profileId: id, actor: Type.Union([Type.Literal("user"), Type.Literal("schedule")]),
  trigger: Type.Optional(MyWorkRefreshTriggerSchema),
  projectId: Type.Null(), workspaceId: Type.Null(), sessionId: Type.Null(),
  commandId: id, commandDigest: hash, inputDigest: hash, resultDigest: nullableHash, jobId: id, revision,
  status: Type.Union([Type.Literal("running"), Type.Literal("completed"), Type.Literal("partial"), Type.Literal("failed"), Type.Literal("cancelled")]),
  dispatched: Type.Boolean(), cancelRequested: Type.Boolean(), cleanupUnconfirmed: Type.Boolean(),
  inspection: Type.Optional(GithubInspectionSchema),
  sources: Type.Array(object({
    source: MyWorkSourceSchema, observationDigest: nullableHash,
    status: Type.Union([Type.Literal("queued"), Type.Literal("reading"), Type.Literal("complete"), Type.Literal("partial"), Type.Literal("failed")]),
    diagnostic,
  }), { minItems: 1, maxItems: 100 }),
  attention: Type.Array(MyWorkAttentionSchema, { maxItems: 10000 }),
  createdAt: timestamp, updatedAt: timestamp, diagnostic,
});
export type MyWorkRefresh = Static<typeof MyWorkRefreshSchema>;
export interface MyWorkSnapshot { myWorkSources: MyWorkSource[]; myWorkRefreshes: MyWorkRefresh[] }
export interface MyWorkEventPayloads {
  "my_work.source_recorded": { source: MyWorkSource };
  "my_work.refresh_recorded": { refresh: MyWorkRefresh };
}
const sourceIds = Type.Array(hash, { minItems: 1, maxItems: 100, uniqueItems: true });
export const MyWorkCommandSchema = Type.Union([
  object({ type: Type.Literal("my_work.configure"), scope: GithubScopeSchema, expectedDigest: hash,
    expectedRevision: Type.Union([revision, Type.Null()]), confirm: Type.Literal(true) }),
  object({ type: Type.Literal("my_work.source.toggle"), sourceId: hash, expectedRevision: revision, enabled: Type.Boolean() }),
  object({ type: Type.Literal("my_work.refresh"), sourceIds: Type.Optional(sourceIds),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 300_000 })) }),
  object({ type: Type.Literal("my_work.start"), itemId: id, sourceId: hash, expectedDigest: hash, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("my_work.inspect"), refreshId: id, expectedRevision: revision, expectedInputDigest: hash, confirm: Type.Literal(true) }),
]);
export type MyWorkCommand = Static<typeof MyWorkCommandSchema>;
export const MyWorkFiltersSchema = object({
  itemId: Type.Optional(id),
  category: Type.Optional(MyWorkCategorySchema), repository: Type.Optional(repository), accountId: Type.Optional(id),
  projectId: Type.Optional(id), sourceId: Type.Optional(hash), text: Type.Optional(Type.String({ maxLength: 500 })),
  state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("merged"), Type.Literal("all")])),
  freshness: Type.Optional(Type.Union([Type.Literal("fresh"), Type.Literal("stale"), Type.Literal("partial"), Type.Literal("unobserved")])),
});
export type MyWorkFilters = Static<typeof MyWorkFiltersSchema>;
export const MyWorkQuerySchema = Type.Union([
  object({ type: Type.Literal("my_work.source.preview"), scope: GithubScopeSchema }),
  object({ type: Type.Literal("my_work.query"), filters: MyWorkFiltersSchema,
    offset: Type.Integer({ minimum: 0 }), limit: Type.Integer({ minimum: 1, maximum: 100 }) }),
  object({ type: Type.Literal("my_work.read"), refreshId: id, sourceId: Type.Optional(hash), metadataOnly: Type.Optional(Type.Boolean()) }),
  object({ type: Type.Literal("my_work.status") }),
  object({ type: Type.Literal("my_work.navigate"), itemId: id, sourceId: hash }),
  object({ type: Type.Literal("my_work.followup"), itemId: id, sourceId: hash }),
]);
export type MyWorkQuery = Static<typeof MyWorkQuerySchema>;
export const isMyWorkCommand = (value: unknown): value is MyWorkCommand => Value.Check(MyWorkCommandSchema, value);
export const isMyWorkQuery = (value: unknown): value is MyWorkQuery => Value.Check(MyWorkQuerySchema, value);
export type MyWorkFreshness = "fresh" | "stale" | "partial" | "unobserved";
export interface MyWorkSourceState {
  source: MyWorkSource; refreshId: string | null; observationDigest: string | null; observedAt: string | null;
  freshness: MyWorkFreshness; diagnostic: string | null; complete: boolean;
}
export interface MyWorkAssociation extends MyWorkSourceState {
  pull: MyWorkPull; sessionIds: string[];
  previous?: { refreshId: string; observationDigest: string; pull: MyWorkPull };
  watch: { operationId: string; status: string; currentHead: boolean; cleanupUnconfirmed: boolean; observation: GithubCiObservation | null } | null;
}
export interface MyWorkEntry {
  id: string; repository: string; number: number; url: string; pull: MyWorkPull;
  categories: MyWorkCategory[]; freshness: MyWorkFreshness; conflicting: boolean; associations: MyWorkAssociation[];
}
export interface MyWorkNavigation { itemId: string; scope: GithubScope; source: GithubWorkSource; sessionIds: string[] }
export type MyWorkResponse =
  | { type: "my_work.source.preview"; preview: MyWorkSourcePreview }
  | { type: "my_work.query"; entries: MyWorkEntry[]; total: number; sources: MyWorkSourceState[]; refreshing: MyWorkRefresh | null;
      counts: Record<MyWorkCategory, number>; observedAt: string; boundary: "controller-gh-account-not-ssh" }
  | { type: "my_work.status"; sources: MyWorkSource[]; refreshes: MyWorkRefresh[]; active: MyWorkRefresh | null }
  | { type: "my_work.read"; refresh: MyWorkRefresh; observations: MyWorkObservation[]; observationsIncluded: boolean }
  | { type: "my_work.navigate"; navigation: MyWorkNavigation }
  | { type: "my_work.followup"; navigation: MyWorkNavigation; digest: string; item: MyWorkPull["item"]; warning: string };

export function myWorkItemId(repository: string, number: number): string {
  if (!Number.isSafeInteger(number) || number < 1) throw new MoguriError("my_work_item", "Use one canonical repository and a positive PR number.");
  const canonical = githubItemIdentity(`https://github.com/${repository}/pull/${number}`);
  return `github.com/${canonical.repository.toLowerCase()}/pull/${canonical.number}`;
}
export function myWorkCategories(pull: MyWorkPull): MyWorkCategory[] {
  if (pull.item.state !== "open") return [];
  const values: MyWorkCategory[] = ["open-pr"];
  if (pull.requests?.length) values.push("pending-review");
  if (pull.ci && ["failure", "cancelled", "timed-out"].includes(pull.ci.state)) values.push("failed-ci");
  if (pull.threads?.some((thread) => !thread.resolved)) values.push("unresolved-thread");
  return values;
}
const corrupt = (): never => { throw new MoguriError("my_work_corrupt", "My Work lost its exact ownership, provenance or lifecycle. Original state was preserved; no refresh was replayed.", 409); };
const validTime = (at: string) => Number.isFinite(Date.parse(at)) && new Date(at).toISOString() === at;
export function projectMyWorkSource(previous: MyWorkSource | undefined, value: unknown): MyWorkSource {
  if (!Value.Check(MyWorkSourceSchema, value)) return corrupt();
  const next = value;
  if (next.profileId !== next.binding.profileId || next.account.toLowerCase() !== next.accountId.split(":")[0] ||
    !next.binding.root.root.startsWith("/") || next.binding.root.root.includes("\0") ||
    !validTime(next.createdAt) || !validTime(next.updatedAt)) return corrupt();
  if (!previous) {
    if (next.revision !== 0 || !next.enabled || next.createdAt !== next.updatedAt) return corrupt();
  } else if (next.revision !== previous.revision + 1 ||
    Object.entries(previous).some(([key, entry]) => !["revision", "enabled", "updatedAt"].includes(key) &&
      JSON.stringify(entry) !== JSON.stringify(next[key as keyof MyWorkSource])) || next.updatedAt < previous.updatedAt) return corrupt();
  return structuredClone(next);
}
export function projectMyWorkRefresh(previous: MyWorkRefresh | undefined, value: unknown): MyWorkRefresh {
  if (!Value.Check(MyWorkRefreshSchema, value)) return corrupt();
  const next = value;
  if (!validTime(next.createdAt) || !validTime(next.updatedAt) || new Set(next.sources.map((value) => value.source.id)).size !== next.sources.length ||
    (next.actor === "schedule") !== (next.trigger !== undefined) ||
    next.sources.some((value) => value.source.profileId !== next.profileId || !value.source.enabled) ||
    next.status === "completed" && (!next.dispatched || next.cancelRequested || next.cleanupUnconfirmed || !next.resultDigest ||
      next.diagnostic !== null || next.sources.some((source) => source.status !== "complete" || !source.observationDigest)) ||
    next.status === "running" && next.diagnostic !== null || next.status !== "running" && next.status !== "completed" && !next.diagnostic ||
    next.status === "partial" && !next.dispatched || !next.dispatched && next.sources.some((source) => source.observationDigest !== null) ||
    next.attention.some((attention) => attention.sourceIds.some((id) => !next.sources.some((source) => source.source.id === id && source.observationDigest))) ||
    next.inspection && (next.status !== "partial" || !next.cleanupUnconfirmed || next.inspection.operationId !== next.id ||
      next.inspection.inputDigest !== next.inputDigest || next.inspection.commandId === next.commandId ||
      !validTime(next.inspection.at))) return corrupt();
  if (previous?.status !== undefined && previous.status !== "running") {
    const allowed = ["revision", "updatedAt", "inspection"];
    if (previous.status !== "partial" || !previous.cleanupUnconfirmed || previous.inspection || !next.inspection ||
      next.revision !== previous.revision + 1 || next.updatedAt < previous.updatedAt || next.inspection.observedRevision !== previous.revision ||
      next.inspection.at !== next.updatedAt || Object.entries(previous).some(([key, entry]) =>
        !allowed.includes(key) && JSON.stringify(entry) !== JSON.stringify(next[key as keyof MyWorkRefresh]))) return corrupt();
    return structuredClone(next);
  }
  if (!previous) {
    if (next.revision !== 0 || next.status !== "running" || next.dispatched || next.cancelRequested || next.cleanupUnconfirmed ||
      next.resultDigest || next.inspection || next.attention.length || next.createdAt !== next.updatedAt || next.sources.some((source) =>
        source.status !== "queued" || source.observationDigest !== null || source.diagnostic !== null)) return corrupt();
  } else if (next.inspection || next.revision !== previous.revision + 1 || next.updatedAt < previous.updatedAt ||
    previous.dispatched && !next.dispatched || previous.cancelRequested && !next.cancelRequested ||
    previous.cleanupUnconfirmed && !next.cleanupUnconfirmed ||
    Object.entries(previous).some(([key, entry]) => !["revision", "status", "dispatched", "cancelRequested", "cleanupUnconfirmed",
      "sources", "attention", "resultDigest", "updatedAt", "diagnostic"].includes(key) && JSON.stringify(entry) !== JSON.stringify(next[key as keyof MyWorkRefresh])) ||
    JSON.stringify(previous.sources.map((value) => value.source)) !== JSON.stringify(next.sources.map((value) => value.source)) ||
    previous.sources.some((source, index) => source.observationDigest && !next.sources[index]?.observationDigest)) return corrupt();
  return structuredClone(next);
}
export function hasMyWorkHistory(events: readonly StoredEvent[]): boolean {
  return events.some((event) => event.event_type === "my_work.source_recorded" || event.event_type === "my_work.refresh_recorded" ||
    event.event_type === "attention.raised" && event.payload.attention.reason === "my-work" ||
    event.event_type === "slash.command_recorded" && event.payload.execution.name === "my-work");
}
