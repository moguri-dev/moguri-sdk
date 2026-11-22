import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";
import { AutomationScheduleSchema } from "./automations.ts";
import type { GithubCiState, GithubItem } from "./github-workflows.ts";
import type { MyWorkFreshness } from "./my-work.ts";

/** Protocol 119 store marker for dependency update roundups (#8, D66). */
export const DEPENDENCY_ROUNDUPS_SCHEMA = "dependency_roundups_schema";
/** The singleton roundup configuration of a profile. */
export const ROUNDUP_SETTINGS_ID = "dependency-roundup";
export const ROUNDUP_DEFAULT_BOTS = ["dependabot[bot]", "renovate[bot]"] as const;
/** Recent runs exposed in the snapshot; every run stays in the durable history. */
export const ROUNDUP_SNAPSHOT_RUNS = 50;
export const ROUNDUP_MAX_BOTS = 50;
export const ROUNDUP_MAX_PACKAGES = 100;

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 256 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const revision = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const timestamp = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
const diagnostic = Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()]);
/** A GitHub login, including App bot logins such as `dependabot[bot]`. */
export const RoundupBotSchema = Type.String({ pattern: "^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\\[bot\\])?$" });
const bots = Type.Array(RoundupBotSchema, { minItems: 1, maxItems: ROUNDUP_MAX_BOTS, uniqueItems: true });
const sourceIds = Type.Array(hash, { minItems: 1, maxItems: 100, uniqueItems: true });

export const RoundupSettingsSchema = object({
  version: Type.Literal(1), id: Type.Literal(ROUNDUP_SETTINGS_ID), revision, profileId: id,
  /** Authors whose open PRs are dependency updates, compared case-insensitively. */
  bots,
  /** Explicitly selected My Work sources (configured repository/account bindings). Nothing else is read. */
  sourceIds,
  /** Optional recurring roundup (#6 schedule types). Null keeps roundups manual. */
  schedule: Type.Union([AutomationScheduleSchema, Type.Null()]),
  status: Type.Union([Type.Literal("active"), Type.Literal("paused")]),
  anchorAt: Type.Union([timestamp, Type.Null()]), nextAt: Type.Union([timestamp, Type.Null()]),
  /** The actual-user command behind this revision; timers only advance `nextAt`. */
  commandId: id, commandDigest: hash,
  createdAt: timestamp, updatedAt: timestamp,
});
export type RoundupSettings = Static<typeof RoundupSettingsSchema>;
export const RoundupSummarySchema = object({
  updates: Type.Integer({ minimum: 0 }), groups: Type.Integer({ minimum: 0 }), security: Type.Integer({ minimum: 0 }),
  likelyBreaking: Type.Integer({ minimum: 0 }), failingChecks: Type.Integer({ minimum: 0 }), closed: Type.Integer({ minimum: 0 }),
});
export type RoundupSummary = Static<typeof RoundupSummarySchema>;
export const RoundupRunStatusSchema = Type.Union([
  Type.Literal("starting"), Type.Literal("running"), Type.Literal("completed"), Type.Literal("partial"), Type.Literal("failed"),
  Type.Literal("cancelled"), Type.Literal("skipped"), Type.Literal("blocked"),
]);
export type RoundupRunStatus = Static<typeof RoundupRunStatusSchema>;
export const RoundupRunSchema = object({
  version: Type.Literal(1), id, revision, profileId: id, settingsRevision: revision,
  trigger: Type.Union([Type.Literal("manual"), Type.Literal("schedule")]),
  /** The scheduled occurrence this run covers; null for a manual run. */
  occurrenceAt: Type.Union([timestamp, Type.Null()]),
  missed: Type.Integer({ minimum: 0, maximum: 1000 }),
  sourceIds,
  /** The My Work refresh this run owns. Null until it was admitted. */
  refreshId: Type.Union([id, Type.Null()]),
  status: RoundupRunStatusSchema,
  summary: Type.Union([RoundupSummarySchema, Type.Null()]),
  /** Manual runs: the actual-user command. Scheduled runs: the activation command of the settings revision. */
  commandId: id,
  createdAt: timestamp, updatedAt: timestamp, diagnostic,
});
export type RoundupRun = Static<typeof RoundupRunSchema>;
export interface RoundupEventPayloads {
  "dependency_roundup.recorded": { settings: RoundupSettings };
  "dependency_roundup.run_recorded": { run: RoundupRun };
}
export const roundupEventTypes = ["dependency_roundup.recorded", "dependency_roundup.run_recorded"] as const;

export const RoundupCommandSchema = Type.Union([
  object({ type: Type.Literal("dependency_roundup.configure"), bots, sourceIds,
    schedule: Type.Union([AutomationScheduleSchema, Type.Null()]), scheduleEnabled: Type.Boolean(),
    expectedRevision: Type.Union([revision, Type.Null()]) }),
  object({ type: Type.Literal("dependency_roundup.schedule"), enabled: Type.Boolean(), expectedRevision: revision }),
  object({ type: Type.Literal("dependency_roundup.refresh"), timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 300_000 })) }),
  object({ type: Type.Literal("dependency_roundup.cancel"), runId: id }),
]);
export type RoundupCommand = Static<typeof RoundupCommandSchema>;
export const isRoundupCommand = (value: unknown): value is RoundupCommand => Value.Check(RoundupCommandSchema, value);
export const RoundupFiltersSchema = object({
  state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("merged"), Type.Literal("all")])),
  security: Type.Optional(Type.Boolean()), breaking: Type.Optional(Type.Boolean()),
  ecosystem: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  repository: Type.Optional(Type.String({ minLength: 3, maxLength: 140 })),
  text: Type.Optional(Type.String({ maxLength: 500 })),
});
export type RoundupFilters = Static<typeof RoundupFiltersSchema>;
export const RoundupQuerySchema = object({ type: Type.Literal("dependency_roundup.query"), filters: RoundupFiltersSchema });
export type RoundupQuery = Static<typeof RoundupQuerySchema>;
export const isRoundupQuery = (value: unknown): value is RoundupQuery => Value.Check(RoundupQuerySchema, value);

export type RoundupBot = "dependabot" | "renovate" | "other";
export type RoundupUpdateType = "major" | "minor" | "patch" | "other" | "unknown";
export interface RoundupPackage { name: string; ecosystem: string | null; from: string | null; to: string | null; updateType: RoundupUpdateType }
/** Security context reported by the PR itself (labels, title, advisory IDs in its body). Null means none was reported, never "secure". */
export interface RoundupSecurity { signals: string[]; advisories: { id: string; url: string | null }[] }
/** A deterministic Moguri heuristic from version numbers, labels and PR text, not a provider statement or model judgement. */
export interface RoundupBreaking { likely: boolean; signals: string[] }
export interface ParsedDependencyUpdate { bot: RoundupBot; group: string | null; packages: RoundupPackage[]; security: RoundupSecurity | null; breaking: RoundupBreaking }
/** Structured source state; the retained provider diagnostic is shown verbatim, never reclassified from its text. */
export type RoundupProblem = "failed" | "partial" | "stale" | "unobserved" | "disabled" | "missing";
export interface RoundupSourceState {
  sourceId: string; repository: string | null; account: string | null; accountId: string | null; enabled: boolean;
  freshness: MyWorkFreshness | "missing"; complete: boolean; observedAt: string | null; refreshId: string | null;
  problem: RoundupProblem | null;
  /** The retained My Work diagnostic, verbatim (for example an HTTP status, rate limit or account mismatch). */
  diagnostic: string | null;
}
export interface RoundupUpdate extends ParsedDependencyUpdate {
  itemId: string; repository: string; number: number; url: string; title: string; author: string;
  state: string; draft: boolean; headSha: string | null; observedAt: string; freshness: MyWorkFreshness; conflicting: boolean;
  ci: GithubCiState | null; reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  unresolvedThreads: number | null;
  /** Every configured source/account that observed this PR, with the exact retained observation. */
  sources: { sourceId: string; accountId: string; refreshId: string | null; observationDigest: string | null }[];
}
export interface RoundupGroup {
  key: string; name: string; ecosystems: string[]; itemIds: string[]; repositories: string[]; versions: string[];
  security: boolean; likelyBreaking: boolean; failingChecks: number;
}
export interface RoundupResponse {
  type: "dependency_roundup.query"; settings: RoundupSettings | null; latestRun: RoundupRun | null;
  updates: RoundupUpdate[]; groups: RoundupGroup[]; sources: RoundupSourceState[];
  /** True only when every selected source has a fresh complete observation. */
  complete: boolean; observedAt: string; boundary: "controller-gh-account-not-ssh";
  /** Roundups never call a model. Security fields are provider-reported PR metadata; breaking is a labelled heuristic. */
  interpretation: "none";
}

const corrupt = (): never => { throw new MoguriError("roundup_corrupt", "A dependency roundup lost its exact owner, revision or lifecycle. State was preserved; no read was replayed.", 409); };
const validTime = (at: string) => Number.isFinite(Date.parse(at)) && new Date(at).toISOString() === at;
export function projectRoundupSettings(previous: RoundupSettings | undefined, value: unknown): RoundupSettings {
  if (!Value.Check(RoundupSettingsSchema, value)) return corrupt();
  const next = value;
  if (next.revision !== (previous?.revision ?? -1) + 1 || !validTime(next.createdAt) || !validTime(next.updatedAt) ||
    [next.anchorAt, next.nextAt].some((at) => at !== null && !validTime(at)) ||
    (next.status !== "active" || !next.schedule) && next.nextAt !== null ||
    previous && (previous.profileId !== next.profileId || previous.createdAt !== next.createdAt || next.updatedAt < previous.updatedAt)) return corrupt();
  return structuredClone(next);
}
const runTransitions: Record<RoundupRunStatus, RoundupRunStatus[]> = {
  starting: ["running", "blocked"], running: ["completed", "partial", "failed", "cancelled"],
  completed: [], partial: [], failed: [], cancelled: [], skipped: [], blocked: [],
};
const immutableRun = ["id", "profileId", "settingsRevision", "trigger", "occurrenceAt", "missed", "sourceIds", "commandId", "createdAt"] as const;
export const activeRoundupRun = (run: Pick<RoundupRun, "status">) => run.status === "starting" || run.status === "running";
export function projectRoundupRun(previous: RoundupRun | undefined, value: unknown): RoundupRun {
  if (!Value.Check(RoundupRunSchema, value)) return corrupt();
  const next = value;
  if (next.revision !== (previous?.revision ?? -1) + 1 || !validTime(next.createdAt) || !validTime(next.updatedAt) ||
    next.occurrenceAt !== null && !validTime(next.occurrenceAt) || (next.trigger === "manual") !== (next.occurrenceAt === null) ||
    next.status === "running" && !next.refreshId || next.status === "starting" && next.refreshId !== null ||
    ["skipped", "blocked"].includes(next.status) && next.refreshId !== null ||
    !activeRoundupRun(next) && !next.diagnostic && next.status !== "completed" || next.status === "completed" && (!next.summary || next.diagnostic !== null) ||
    (!previous ? !(next.trigger === "manual" ? ["running"] : ["starting", "skipped", "blocked"]).includes(next.status) :
      !runTransitions[previous.status].includes(next.status) || immutableRun.some((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key])) ||
      previous.refreshId !== null && previous.refreshId !== next.refreshId || next.updatedAt < previous.updatedAt)) return corrupt();
  return structuredClone(next);
}
/** The latest runs for the snapshot, always including every active run. */
export function recentRoundupRuns(runs: RoundupRun[]): RoundupRun[] {
  return [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .filter((run, index) => index < ROUNDUP_SNAPSHOT_RUNS || activeRoundupRun(run));
}

/** Validates a configuration before it is recorded. */
export function validateRoundupBots(values: readonly string[]): string[] {
  const normalized = values.map((value) => value.trim());
  if (!normalized.length || normalized.length > ROUNDUP_MAX_BOTS || normalized.some((value) => !Value.Check(RoundupBotSchema, value)) ||
    new Set(normalized.map((value) => value.toLowerCase())).size !== normalized.length) {
    throw new MoguriError("roundup_bots", `List 1 to ${ROUNDUP_MAX_BOTS} distinct GitHub logins of update bots, for example dependabot[bot].`);
  }
  return normalized;
}
export const isRoundupAuthor = (author: string | null, bots: readonly string[]): boolean =>
  Boolean(author) && bots.some((bot) => bot.toLowerCase() === author!.toLowerCase() ||
    // GraphQL reports App authors without the [bot] suffix; REST includes it.
    bot.toLowerCase() === `${author!.toLowerCase()}[bot]`);

const dependabotEcosystems: Record<string, string> = {
  npm_and_yarn: "npm", github_actions: "github-actions", go_modules: "go", pip: "pip", bundler: "rubygems", cargo: "cargo",
  composer: "composer", maven: "maven", gradle: "gradle", nuget: "nuget", docker: "docker", terraform: "terraform", hex: "hex",
  pub: "pub", elm: "elm", gitsubmodule: "git-submodule", swift: "swift", devcontainers: "devcontainers", uv: "pip", bun: "npm",
};
const renovateDatasources: Record<string, string> = {
  npm: "npm", pypi: "pip", "github-tags": "github-actions", "github-actions": "github-actions", "github-releases": "github-releases",
  go: "go", rubygems: "rubygems", crate: "cargo", packagist: "composer", maven: "maven", nuget: "nuget", docker: "docker",
  "terraform-provider": "terraform", "terraform-module": "terraform", hex: "hex", dart: "pub",
};
const clean = (value: string) => value.replace(/^[`'"]+|[`'".,;:]+$/g, "").trim();
const versionText = (value: string | undefined) => {
  const text = value === undefined ? "" : clean(value);
  return text && text.length <= 128 ? text : null;
};
const packageName = (value: string) => {
  const text = clean(value.replace(/^\[([^\]]+)\]\([^)]*\).*$/, "$1"));
  return text && text.length <= 214 && !/\s/.test(text) ? text : null;
};
const numbers = (value: string | null) => {
  const match = value?.replace(/^[\^~<>=v\s]+/i, "").match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return match ? [Number(match[1]), match[2] === undefined ? null : Number(match[2]), match[3] === undefined ? null : Number(match[3])] as const : null;
};
/** Compares two version strings by their leading numeric components; anything else is "unknown". */
export function roundupUpdateType(from: string | null, to: string | null): RoundupUpdateType {
  const a = numbers(from), b = numbers(to);
  if (!a || !b) return "unknown";
  if (b[0] !== a[0]) return b[0] > a[0] ? "major" : "other";
  if (a[1] === null || b[1] === null) return "other";
  if (b[1] !== a[1]) return b[1] > a[1] ? "minor" : "other";
  if (a[2] === null || b[2] === null) return "other";
  return b[2] > a[2] ? "patch" : "other";
}
const add = (packages: RoundupPackage[], name: string | null, from: string | null, to: string | null, ecosystem: string | null) => {
  if (!name || packages.length >= ROUNDUP_MAX_PACKAGES) return;
  const existing = packages.find((entry) => roundupPackageKey(entry.name, entry.ecosystem ?? ecosystem) === roundupPackageKey(name, ecosystem ?? entry.ecosystem));
  if (existing) {
    existing.from ??= from; existing.to ??= to; existing.ecosystem ??= ecosystem;
    existing.updateType = roundupUpdateType(existing.from, existing.to);
    return;
  }
  packages.push({ name, ecosystem, from, to, updateType: roundupUpdateType(from, to) });
};
const advisoryPattern = /\b(GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}|CVE-\d{4}-\d{4,7})\b/gi;
function security(item: Pick<GithubItem, "title" | "body" | "labels">): RoundupSecurity | null {
  const signals: string[] = [];
  for (const label of item.labels ?? []) if (/secur|vulnerab/i.test(label.name)) signals.push(`label:${label.name}`);
  if (/\[security\]/i.test(item.title)) signals.push("title:[SECURITY]");
  const advisories = new Map<string, string | null>();
  for (const match of item.body.matchAll(advisoryPattern)) {
    const raw = match[1]!, advisory = /^ghsa/i.test(raw) ? `GHSA${raw.slice(4).toLowerCase()}` : raw.toUpperCase();
    if (advisories.has(advisory) || advisories.size >= 50) continue;
    const linked = new RegExp(`\\[[^\\]]*${raw.replace(/[-]/g, "\\-")}[^\\]]*\\]\\((https://[^)\\s]+)\\)`, "i").exec(item.body)?.[1] ?? null;
    advisories.set(advisory, linked ?? (advisory.startsWith("GHSA-") ? `https://github.com/advisories/${advisory}` : null));
  }
  if (advisories.size) signals.push("body:advisory-ids");
  return signals.length ? { signals, advisories: [...advisories].map(([id, url]) => ({ id, url })) } : null;
}
function breaking(item: Pick<GithubItem, "body" | "labels">, packages: RoundupPackage[]): RoundupBreaking {
  const signals: string[] = [];
  for (const entry of packages) {
    if (entry.updateType === "major") signals.push(`major:${entry.name}`);
    else if (entry.updateType === "minor" && numbers(entry.from)?.[0] === 0) signals.push(`zero-major-minor:${entry.name}`);
  }
  for (const label of item.labels ?? []) if (/^(?:major|breaking(?:[- ]change)?s?|semver[-:]major)$/i.test(label.name)) signals.push(`label:${label.name}`);
  if (/\bBREAKING[ -]CHANGES?\b/i.test(item.body)) signals.push("body:breaking-changes");
  return { likely: signals.length > 0, signals };
}
/**
 * Reads package/version changes from the update PR's own title, branch and body, for Dependabot (single and group
 * updates), Renovate (single updates and its change tables) and other bots using the same "bump/update" phrasing.
 * Deterministic text parsing only: nothing is fetched or guessed by a model.
 */
export function parseDependencyUpdate(item: Pick<GithubItem, "title" | "body" | "author" | "labels" | "head">): ParsedDependencyUpdate {
  const author = (item.author ?? "").toLowerCase(), title = item.title.replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/i, "").trim();
  const bot: RoundupBot = author.startsWith("dependabot") ? "dependabot" : author.startsWith("renovate") ? "renovate" : "other";
  const branch = item.head ?? "";
  let ecosystem: string | null = null;
  const dependabotBranch = /^dependabot\/([a-z_]+)\//.exec(branch);
  if (dependabotBranch) ecosystem = dependabotEcosystems[dependabotBranch[1]!] ?? dependabotBranch[1]!.replace(/_/g, "-");
  const packages: RoundupPackage[] = [];
  let group: string | null = null;
  const groupTitle = /^bump the (\S+) group\b/i.exec(title);
  if (groupTitle) group = groupTitle[1]!;
  for (const line of item.body.split(/\r?\n/)) {
    const updates = /^\s*Updates? (?:the requirements on )?`([^`]+)` (?:from `?([^\s`]+)`? )?to `?([^\s`]+?)`?\.?\s*$/i.exec(line);
    if (updates) { add(packages, packageName(updates[1]!), versionText(updates[2]), versionText(updates[3]), ecosystem); continue; }
    const row = /^\|\s*(.+?)\s*\|(.*)\|\s*$/.exec(line);
    if (!row || /^\s*:?-{3,}/.test(row[1]!) || /^package$/i.test(row[1]!.trim())) continue;
    const cells = row[2]!.split("|").map((cell) => cell.trim());
    const change = cells.map((cell) => /`([^`]+)`\s*(?:->|→|➔|=>)\s*`([^`]+)`/.exec(cell)).find(Boolean);
    if (!change) continue;
    const datasource = /renovatebot\.com\/diffs\/([a-z-]+)\//.exec(row[2]!)?.[1];
    const typed = cells.some((cell) => /^action$/i.test(cell)) ? "github-actions" : null;
    add(packages, packageName(row[1]!), versionText(change[1]), versionText(change[2]), (datasource ? renovateDatasources[datasource] ?? datasource : null) ?? typed ?? ecosystem);
  }
  const bump = /^(?:bump|update) (\S+?)(?: requirement)? from (\S+) to (\S+?)(?: in (\S+))?$/i.exec(title);
  if (bump && !groupTitle) add(packages, packageName(bump[1]!), versionText(bump[2]), versionText(bump[3]), ecosystem);
  const renovate = /^update (?:(dependency|module|docker image|helm release|terraform|plugin) )?(\S+?)(?: (monorepo|action|digest))? to (\S+?)(?: \[security\])?$/i.exec(title);
  if (renovate && !bump) {
    const kind = (renovate[1] ?? renovate[3] ?? "").toLowerCase();
    add(packages, packageName(renovate[2]!), null, versionText(renovate[4]), kind === "module" ? "go" : kind === "docker image" ? "docker" : kind === "action" ? "github-actions" :
      kind === "helm release" ? "helm" : kind === "terraform" ? "terraform" : null);
  }
  const bodyFrom = /^Bumps \[([^\]]+)\]\([^)]*\) from (\S+) to (\S+?)\.?$/im.exec(item.body);
  if (bodyFrom) add(packages, packageName(bodyFrom[1]!), versionText(bodyFrom[2]), versionText(bodyFrom[3]), ecosystem);
  return { bot, group, packages, security: security({ title: item.title, body: item.body, labels: item.labels }), breaking: breaking(item, packages) };
}
const caseInsensitive = new Set(["npm", "pip", "github-actions", "nuget", "composer", "rubygems", "cargo", "pub", "hex"]);
/** A package identity for grouping: case and separators fold only where the ecosystem itself treats names that way (Go and Maven stay exact). */
export function roundupPackageKey(name: string, ecosystem: string | null): string {
  if (ecosystem === "pip") return name.toLowerCase().replace(/[-_.]+/g, "-");
  return ecosystem && caseInsensitive.has(ecosystem) ? name.toLowerCase() : name;
}
/** Groups updates by package (and ecosystem when known) while keeping every PR identity in each group it touches. */
export function roundupGroups(updates: readonly RoundupUpdate[]): RoundupGroup[] {
  const groups = new Map<string, RoundupGroup>();
  const known = new Map<string, Set<string>>();
  for (const update of updates) for (const entry of update.packages) if (entry.ecosystem) {
    const key = roundupPackageKey(entry.name, entry.ecosystem);
    known.set(key, new Set([...known.get(key) ?? [], entry.ecosystem]));
  }
  const insert = (key: string, name: string, ecosystem: string | null, update: RoundupUpdate, version: string | null) => {
    const group = groups.get(key) ?? { key, name, ecosystems: [], itemIds: [], repositories: [], versions: [], security: false, likelyBreaking: false, failingChecks: 0 };
    if (ecosystem && !group.ecosystems.includes(ecosystem)) group.ecosystems.push(ecosystem);
    if (!group.itemIds.includes(update.itemId)) {
      group.itemIds.push(update.itemId);
      if (update.ci && ["failure", "cancelled", "timed-out"].includes(update.ci)) group.failingChecks++;
    }
    if (!group.repositories.includes(update.repository)) group.repositories.push(update.repository);
    if (version && !group.versions.includes(version)) group.versions.push(version);
    group.security ||= Boolean(update.security);
    group.likelyBreaking ||= update.breaking.likely;
    groups.set(key, group);
  };
  for (const update of updates) {
    if (!update.packages.length) {
      insert(`pr:${update.itemId}`, update.group ? `${update.group} group` : update.title, null, update, null);
      continue;
    }
    for (const entry of update.packages) {
      const ecosystems = entry.ecosystem ? null : known.get(entry.name) ?? known.get(entry.name.toLowerCase());
      const ecosystem = entry.ecosystem ?? (ecosystems?.size === 1 ? [...ecosystems][0]! : null);
      insert(`${ecosystem ?? "?"}:${roundupPackageKey(entry.name, ecosystem)}`, entry.name, ecosystem, update, entry.to);
    }
  }
  return [...groups.values()].sort((a, b) => Number(b.security) - Number(a.security) || Number(b.likelyBreaking) - Number(a.likelyBreaking) ||
    b.failingChecks - a.failingChecks || b.itemIds.length - a.itemIds.length || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}
/** The structured problem of one selected source, from its retained My Work state only. */
export function roundupProblem(state: { enabled: boolean; freshness: MyWorkFreshness | "missing"; complete: boolean; failed: boolean }): RoundupProblem | null {
  if (state.freshness === "missing") return "missing";
  if (!state.enabled) return "disabled";
  if (state.failed) return "failed";
  if (state.freshness === "unobserved") return "unobserved";
  if (state.freshness === "partial" || !state.complete && state.freshness !== "stale") return "partial";
  return state.freshness === "stale" ? "stale" : null;
}
