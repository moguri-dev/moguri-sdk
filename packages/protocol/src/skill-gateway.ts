import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const source = { id: Type.String({ pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" }), name: Type.String({ minLength: 1, maxLength: 80 }), enabled: Type.Boolean() };
export const SkillSourceSchema = Type.Union([
  object({ ...source, kind: Type.Literal("local"), path: Type.String({ minLength: 1, maxLength: 4096 }) }),
  object({ ...source, kind: Type.Literal("remote"), url: Type.String({ minLength: 1, maxLength: 2048 }) }),
]);
export type SkillSource = Static<typeof SkillSourceSchema>;
export interface GatewaySkill {
  id: string; name: string; description: string; digest: string; bytes: number;
  sourceId: string | null; sourceName: string; path: string | null;
}
export const SkillGatewayQuerySchema = Type.Union([
  object({ type: Type.Literal("skills.find"), sessionId: Type.Optional(id), sourceId: Type.Optional(id),
    query: Type.String({ maxLength: 200 }), offset: Type.Integer({ minimum: 0, maximum: 10000 }), expectedCatalogDigest: Type.Optional(hash) }),
  object({ type: Type.Literal("skills.read"), sessionId: Type.Optional(id), skillId: id, expectedDigest: hash }),
]);
export type SkillGatewayQuery = Static<typeof SkillGatewayQuerySchema>;
export const isSkillGatewayQuery = (value: unknown): value is SkillGatewayQuery => Value.Check(SkillGatewayQuerySchema, value);
export type SkillGatewayResponse =
  /** `restarted` means the continuation's catalog snapshot was gone or different: results start again at offset 0 of `catalogDigest`. */
  | { type: "skills.find"; skills: GatewaySkill[]; total: number; nextOffset: number | null; catalogDigest: string; restarted?: true }
  | { type: "skills.read"; skill: GatewaySkill; body: string; authority: string; catalogDigest: string };

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
