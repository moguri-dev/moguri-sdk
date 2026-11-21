import type { CapabilityEntry } from "./platform.ts";
import { skillRepositoryName, skillSourceTrustedByDefault, skillSwitchFor, sourceSkillState, type GatewaySkill, type SkillSource, type SkillSourceFailure,
  type SkillSwitch, type SourceSkillState } from "./skill-gateway.ts";
import { builtinSlashClash } from "./slash-commands.ts";

/** D57. Where a group of skills came from. Repositories and marketplaces are remote skill sources; folders are local ones. */
export type SkillGroupKind = "repository" | "marketplace" | "folder" | "plugin" | "project";
export interface SkillListItem {
  /** Stable key: `registry:ID` or `source:SOURCE_ID:PATH`. */
  key: string;
  name: string; description: string; digest: string;
  /** The built-in slash command that takes precedence over this skill's name. */
  shadowedBy?: string;
  /** Registry skills are only `on` or `off`. Source skills follow `sourceSkillState`. */
  state: SourceSkillState;
  /** An installed, imported, approved or bundled copy with its own switch (`capability.toggle`). */
  registry?: { capabilityId: string; revision: number; projectId: string | null; scope: string; ownerPluginId?: string; retired: boolean; pluginOff: boolean };
  /** A skill read live from a configured source: switched with `skill.source.toggle`, trusted with `skill.trust`. */
  source?: { sourceId: string; path: string; skillId: string; packageDigest?: string; trustedAt?: string };
}
export interface SkillListGroup {
  id: string; kind: SkillGroupKind; label: string;
  /** The folder path or URL of a source group, or the scope of a plugin bundle. */
  detail: string | null;
  /** For configured sources: on by default, or off until trusted. Null for groups of installed copies only. */
  defaults: "on" | "trust" | null;
  sourceId: string | null;
  /** False while this source's skills haven't been read or failed to read; installed copies are always listed. */
  loaded: boolean;
  error: string | null;
  skills: SkillListItem[];
}
export interface SkillListInput {
  registry: readonly CapabilityEntry[];
  projects: readonly { id: string; name: string }[];
  sources: readonly SkillSource[];
  switches?: readonly SkillSwitch[];
  /** Skills from `skills.list`, or null when the sources haven't been read yet. */
  sourceSkills: readonly GatewaySkill[] | null;
  failures?: readonly SkillSourceFailure[];
}

export const skillSourceGroupKind = (source: SkillSource): SkillGroupKind => source.kind === "local" ? "folder" : source.personal ? "repository" : "marketplace";
/** "Personal - {repo name}" for the user's own repository; otherwise the source's own name (the marketplace provider or folder). */
export const skillSourceGroupLabel = (source: SkillSource): string =>
  source.kind === "remote" && source.personal ? `Personal - ${skillRepositoryName(source.url) ?? source.name}` : source.name;
const order: SkillGroupKind[] = ["repository", "marketplace", "folder", "plugin", "project"];

/**
 * D57. Every skill the profile knows, grouped by where it came from: each enabled skill source (personal repository, marketplace provider
 * or folder) with any copies installed from it, plugin bundles, then skills imported for every project and for each project.
 */
export function skillListGroups(input: SkillListInput): SkillListGroup[] {
  const groups = new Map<string, SkillListGroup>();
  const scope = (projectId: string | null) => projectId === null ? "All projects" : input.projects.find((project) => project.id === projectId)?.name ?? "Removed project";
  const group = (id: string, make: () => Omit<SkillListGroup, "id" | "skills">) => {
    let found = groups.get(id);
    if (!found) groups.set(id, found = { id, ...make(), skills: [] });
    return found;
  };
  for (const source of input.sources) {
    if (!source.enabled) continue;
    const failure = input.failures?.find((value) => value.sourceId === source.id);
    group(`source:${source.id}`, () => ({ kind: skillSourceGroupKind(source), label: skillSourceGroupLabel(source), detail: source.kind === "local" ? source.path : source.url,
      defaults: skillSourceTrustedByDefault(source) ? "on" : "trust", sourceId: source.id, loaded: input.sourceSkills !== null && !failure, error: failure?.error ?? null }));
  }
  for (const skill of input.sourceSkills ?? []) {
    const source = input.sources.find((value) => value.id === skill.sourceId && value.enabled), target = source && groups.get(`source:${source.id}`);
    if (!source || !target || skill.path === null) continue;
    const trust = skillSwitchFor(input.switches, source.id, skill.path)?.trust;
    target.skills.push({ key: `source:${source.id}:${skill.path}`, name: skill.name, description: skill.description, digest: skill.digest,
      ...(skill.shadowedBy ? { shadowedBy: skill.shadowedBy } : {}),
      state: sourceSkillState(source, input.switches, { path: skill.path, digest: skill.digest, ...(skill.packageDigest ? { packageDigest: skill.packageDigest } : {}) }),
      source: { sourceId: source.id, path: skill.path, skillId: skill.id, ...(skill.packageDigest ? { packageDigest: skill.packageDigest } : {}), ...(trust ? { trustedAt: trust.at } : {}) } });
  }
  for (const entry of input.registry) {
    if (entry.kind !== "skill") continue;
    const plugin = entry.ownerPluginId ? input.registry.find((value) => value.id === entry.ownerPluginId) : undefined, from = entry.installedFrom;
    const target = entry.ownerPluginId ? group(`plugin:${entry.ownerPluginId}`, () => ({ kind: "plugin", label: `Plugin - ${plugin?.name ?? "removed bundle"}`,
      detail: scope(entry.projectId), defaults: null, sourceId: null, loaded: true, error: null })) :
      from ? group(`source:${from.sourceId}`, () => ({ kind: from.kind, label: from.kind === "repository" ? `Personal - ${from.sourceName}` : from.sourceName,
        detail: null, defaults: null, sourceId: null, loaded: true, error: null })) :
      group(entry.projectId === null ? "project:all" : `project:${entry.projectId}`, () => ({ kind: "project", label: entry.projectId === null ? "All projects" : `Project - ${scope(entry.projectId)}`,
        detail: null, defaults: null, sourceId: null, loaded: true, error: null }));
    const shadowedBy = builtinSlashClash(entry.name);
    target.skills.push({ key: `registry:${entry.id}`, name: entry.name, description: entry.description, digest: entry.contentDigest, ...(shadowedBy ? { shadowedBy } : {}),
      state: entry.enabled ? "on" : "off", registry: { capabilityId: entry.id, revision: entry.revision, projectId: entry.projectId, scope: scope(entry.projectId),
        ...(entry.ownerPluginId ? { ownerPluginId: entry.ownerPluginId } : {}), retired: entry.retired === true,
        pluginOff: Boolean(entry.ownerPluginId && !(plugin?.enabled && !plugin.retired)) } });
  }
  const rank = (value: SkillListGroup) => order.indexOf(value.kind) * 2 + (value.id === "project:all" ? 0 : 1);
  return [...groups.values()].map((value) => ({ ...value, skills: value.skills.sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key)) }))
    .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
