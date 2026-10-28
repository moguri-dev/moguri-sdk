import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";

const id = Type.String({ minLength: 1, maxLength: 128 });
export const WebScopeSchema = Type.Union([
  Type.Object({ kind: Type.Literal("session"), sessionId: id }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("project"), projectId: id }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("global") }, { additionalProperties: false }),
]);
export type WebScope = Static<typeof WebScopeSchema>;
export const WebAllowanceSchema = Type.Object({
  id, scope: WebScopeSchema, site: Type.String({ minLength: 1, maxLength: 4096 }),
}, { additionalProperties: false });
export type WebAllowance = Static<typeof WebAllowanceSchema>;
export interface WebContext { sessionId: string; projectId: string | null; env: "Local" | "Sandbox" | "Remote" }
export const WebAccessSchema = Type.Object({
  version: Type.Literal(1), unrestricted: Type.Boolean(),
  sites: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 500, uniqueItems: true }),
  origins: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 1, uniqueItems: true }),
}, { additionalProperties: false });
export type WebAccess = Static<typeof WebAccessSchema>;

export function canonicalWebSite(input: string): string {
  const site = input.trim();
  const invalid = () => new MoguriError("web_allowlist_site", "Use an exact DNS hostname for HTTPS, or an exact HTTPS/loopback HTTP origin with its port. No wildcard, credentials, path, query or fragment.");
  if (!site || site.length > 4096 || /[\s\\*@?#%]/.test(site)) throw invalid();
  const origin = site.includes("://");
  if (origin && /\/./.test(site.slice(site.indexOf("://") + 3))) throw invalid();
  let url: URL;
  try { url = new URL(origin ? site : `https://${site}`); } catch { throw invalid(); }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
    url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) ||
    !origin && (url.port || url.hostname !== site.toLowerCase() || site.includes(":") || site.includes("/")) ||
    url.hostname.length > 253 || !url.hostname.startsWith("[") && url.hostname.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw invalid();
  return origin ? url.origin : url.hostname;
}

export function webSiteMatches(site: string, input: string): boolean {
  let url: URL;
  try { url = new URL(input); } catch { return false; }
  if (url.username || url.password) return false;
  return site.includes("://") ? url.origin === site :
    url.protocol === "https:" && !url.port && (url.hostname === site || site.startsWith("*.") && url.hostname.endsWith(site.slice(1)));
}
export function effectiveWebAllowances(entries: readonly WebAllowance[], context: WebContext): WebAllowance[] {
  if (context.env !== "Local") return [];
  return entries.filter(({ scope }) => scope.kind === "global" ||
    scope.kind === "session" && scope.sessionId === context.sessionId ||
    scope.kind === "project" && scope.projectId === context.projectId);
}
export function webAccessAllows(access: WebAccess, input: string): boolean {
  if (!Value.Check(WebAccessSchema, access)) return false;
  let url: URL;
  try { url = new URL(input); } catch { return false; }
  if (url.username || url.password || url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return false;
  return access.unrestricted || access.origins.includes(url.origin) || access.sites.some((site) => webSiteMatches(site, url.href));
}
export function assertWebAccess(access: WebAccess | undefined, input: string): void {
  if (!access || !webAccessAllows(access, input)) {
    let destination = "the requested destination";
    try { destination = new URL(input).origin; } catch { /* The malformed destination is not interpolated into an error. */ }
    throw new MoguriError("web_approval_required", `Website access to ${destination} is outside this exact approved scope. Review the destination or add it to the Local web allowlist. No request or redirect was replayed.`, 403);
  }
}
