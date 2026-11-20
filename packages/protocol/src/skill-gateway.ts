import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const sourceId = Type.String({ pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" });
const source = { id: sourceId, name: Type.String({ minLength: 1, maxLength: 80 }), enabled: Type.Boolean() };
export const SkillSourceSchema = Type.Union([
  object({ ...source, kind: Type.Literal("local"), path: Type.String({ minLength: 1, maxLength: 4096 }) }),
  object({ ...source, kind: Type.Literal("remote"), url: Type.String({ minLength: 1, maxLength: 2048 }),
    /**
     * Protocol 117 (D57). True marks the user's own repository: its skills are listed as "Personal - {repo name}" and are on by default.
     * Absent or false is a marketplace: its skills stay off until the actual user trusts each exact skill.
     */
    personal: Type.Optional(Type.Boolean()) }),
]);
export type SkillSource = Static<typeof SkillSourceSchema>;
const skillPath = Type.String({ minLength: 1, maxLength: 4096 });
/**
 * Protocol 117 (D57). One skill read from a skill source, by source ID and its path in that source. A missing entry means the source
 * default: on for local folders and personal repositories, untrusted (off) for marketplaces.
 */
export const SkillSwitchSchema = object({
  sourceId, path: skillPath, enabled: Type.Boolean(),
  /** Marketplace skills only. Written only by `skill.trust`, never by a generic settings write; it binds the exact SKILL.md and package. */
  trust: Type.Optional(object({ digest: hash, packageDigest: hash, actor: Type.Literal("user"), commandId: id, at: Type.String({ minLength: 1, maxLength: 64 }) })),
});
export type SkillSwitch = Static<typeof SkillSwitchSchema>;
export interface GatewaySkill {
  id: string; name: string; description: string; digest: string; bytes: number;
  sourceId: string | null; sourceName: string; path: string | null;
  /** Set when the name collides with this built-in slash command. Built-ins win, so the skill needs a new name to be used with `/`. */
  shadowedBy?: string;
  /** Archive (remote) skills only: SHA-256 of every file in the skill's folder, the complete package that Trust binds (D57). */
  packageDigest?: string;
}
export const SkillGatewayQuerySchema = Type.Union([
  object({ type: Type.Literal("skills.find"), sessionId: Type.Optional(id), sourceId: Type.Optional(id),
    query: Type.String({ maxLength: 200 }), offset: Type.Integer({ minimum: 0, maximum: 10000 }), expectedCatalogDigest: Type.Optional(hash) }),
  object({ type: Type.Literal("skills.read"), sessionId: Type.Optional(id), skillId: id, expectedDigest: hash }),
  /** Protocol 117 (D57). Every skill in the enabled sources, with each source's read failure, for the user's skill list. Never session-scoped. */
  object({ type: Type.Literal("skills.list") }),
]);
export type SkillGatewayQuery = Static<typeof SkillGatewayQuerySchema>;
export const isSkillGatewayQuery = (value: unknown): value is SkillGatewayQuery => Value.Check(SkillGatewayQuerySchema, value);
export interface SkillSourceFailure { sourceId: string; name: string; error: string }
export type SkillGatewayResponse =
  /** `restarted` means the continuation's catalog snapshot was gone or different: results start again at offset 0 of `catalogDigest`. */
  | { type: "skills.find"; skills: GatewaySkill[]; total: number; nextOffset: number | null; catalogDigest: string; restarted?: true }
  | { type: "skills.read"; skill: GatewaySkill; body: string; authority: string; catalogDigest: string }
  | { type: "skills.list"; skills: GatewaySkill[]; failures: SkillSourceFailure[] };
/** Protocol 117 (D57). Per-skill switches and marketplace trust. Both save immediately and emit `settings.updated`; neither grants tools. */
export const SkillSwitchCommandSchema = Type.Union([
  /** Sets one absolute value on the current settings, so it needs no settings revision and never undoes another skill's change. */
  object({ type: Type.Literal("skill.source.toggle"), sourceId, path: skillPath, enabled: Type.Boolean() }),
  /** Binds the exact bytes instead of a settings revision: the service re-reads the source and refuses any other version. */
  object({ type: Type.Literal("skill.trust"), sourceId, path: skillPath, expectedDigest: hash, expectedPackageDigest: hash, confirm: Type.Literal(true) }),
]);
export type SkillSwitchCommand = Static<typeof SkillSwitchCommandSchema>;
export const isSkillSwitchCommand = (value: unknown): value is SkillSwitchCommand => Value.Check(SkillSwitchCommandSchema, value);

/** Local folders and the user's own repositories are on by default; marketplace skills need the actual user's trust first. */
export const skillSourceTrustedByDefault = (source: SkillSource): boolean => source.kind === "local" || source.personal === true;
export type SourceSkillState = "on" | "off" | "untrusted" | "changed";
export const skillSwitchFor = (switches: readonly SkillSwitch[] | undefined, sourceId: string, path: string): SkillSwitch | undefined =>
  switches?.find((entry) => entry.sourceId === sourceId && entry.path === path);
/**
 * The one rule clients and the service share. A marketplace skill is `untrusted` until trusted, and `changed` when its SKILL.md or
 * package no longer matches what was trusted; only `on` skills are offered to models, slash menus and loads.
 */
export function sourceSkillState(source: SkillSource, switches: readonly SkillSwitch[] | undefined, skill: { path: string; digest: string; packageDigest?: string }): SourceSkillState {
  const entry = skillSwitchFor(switches, source.id, skill.path);
  if (!skillSourceTrustedByDefault(source)) {
    if (!entry?.trust) return "untrusted";
    if (entry.trust.digest !== skill.digest || skill.packageDigest !== undefined && entry.trust.packageDigest !== skill.packageDigest) return "changed";
  }
  return entry?.enabled === false ? "off" : "on";
}
/** "skills" for https://github.com/owner/skills or .../skills.zip; null when the URL names no repository or archive. */
export function skillRepositoryName(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const last = parsed.pathname.split("/").filter(Boolean).at(-1)?.replace(/\.(git|zip)$/i, "");
  return last || null;
}

export function skillArchiveUrl(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new MoguriError("skill_source_url", "Use a GitHub repository URL or a direct HTTPS ZIP URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new MoguriError("skill_source_url", "Skill sources require HTTPS without credentials, query or fragment. Authentication and redirects are not implicit.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.hostname === "github.com" && !url.port && parts.length === 2 && parts.every((part) => /^[a-zA-Z0-9_.-]+$/.test(part))) {
    return `https://codeload.github.com/${parts[0]}/${parts[1]!.replace(/\.git$/, "")}/zip/HEAD`;
  }
  if (!url.pathname.endsWith(".zip")) throw new MoguriError("skill_source_url", "Use a GitHub repository root or a direct HTTPS .zip archive. Repository tree pages and other transports are not supported.");
  return url.href;
}
