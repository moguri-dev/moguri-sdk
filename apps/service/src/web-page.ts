import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { load } from "cheerio";
import { isUtf8 } from "node:buffer";
import { MoguriError } from "../../../packages/protocol/src/index.ts";
import { publicAddress } from "./public-network.ts";
import { boundedBody } from "./network.ts";
import { assertWebAccess, type WebAccess } from "../../../packages/protocol/src/web-policy.ts";

const isGithubApi = (url: URL) => url.hostname === "api.github.com";
function publicPageFailure(url: URL, status: number): string {
  return isGithubApi(url) && [401, 403, 404, 422].includes(status) ?
    `Anonymous GitHub request returned HTTP ${status}. Private repositories, missing access or invalid search terms may cause this; it is not a Copilot login result. This public-page tool forwards no credentials. Use github_read or /github search on the explicitly allowed Local project/account; Remote/Sandbox cannot borrow controller credentials.` :
    `Page returned HTTP ${status}.`;
}
const pageHeaders = (url: URL, userAgent: string): Record<string, string> => isGithubApi(url) ?
  { "User-Agent": userAgent, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } :
  { "User-Agent": userAgent, Accept: "text/html,text/plain" };
/** Readable text of one fetched page, before any view bound is applied. */
export interface PageContent { source: "untrusted-web"; url: string; title: string; text: string; fetchedAt: string; cached: boolean }
function pageContent(url: URL, body: string, type: string): PageContent {
  const githubJson = isGithubApi(url) && /application\/(?:vnd\.github\+json|json)/i.test(type);
  if (!/text\/(?:html|plain)/i.test(type) && !githubJson) throw new MoguriError("web_format", "The page is not HTML or plain text; only public GitHub REST API JSON is also supported.");
  const fetchedAt = new Date().toISOString();
  if (type.includes("text/plain") || githubJson) return { source: "untrusted-web", url: url.toString(), title: url.hostname, text: body, fetchedAt, cached: false };
  const document = load(body);
  document("script,style,noscript,iframe,form").remove();
  const text = (document("main").text() || document("article").text() || document("body").text()).replace(/\s+/g, " ").trim();
  return { source: "untrusted-web", url: url.toString(), title: document("title").text().trim(), text, fetchedAt, cached: false };
}
const PAGE_VIEW = 50_000;
export interface PageView { find?: string; offset?: number; context?: number; maxMatches?: number }
/**
 * A bounded view of a page: the text from `offset` (50,000 characters at most), or with `find` only the literal,
 * case-insensitive matches with surrounding context (also 50,000 characters in total). Searching is much cheaper than
 * reading a long page in pages.
 */
export function pageView(page: PageContent, view: PageView = {}) {
  return view.find === undefined ? pageSlice(page, view.offset) : pageFind(page, view.find, view.context, view.maxMatches);
}
export function pageSlice(page: PageContent, from = 0) {
  const { text, ...meta } = page;
  const offset = Math.min(from, text.length), slice = text.slice(offset, offset + PAGE_VIEW), end = offset + slice.length;
  return { ...meta, offset, text: slice, characters: text.length, complete: offset === 0 && end === text.length,
    omittedCharacters: text.length - slice.length, nextOffset: end < text.length ? end : null };
}
export function pageFind(page: PageContent, find: string, context = 200, maximum = 20) {
  const { text, ...meta } = page;
  const found = [...text.matchAll(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"))].map((match) => ({ index: match.index, length: match[0].length }));
  const matches: { offset: number; text: string }[] = [];
  let shown = 0, size = 0;
  for (const { index, length } of found.slice(0, maximum)) {
    const start = Math.max(0, index - context), end = Math.min(text.length, index + length + context), last = matches.at(-1);
    const merged = Boolean(last && start <= last.offset + last.text.length), added = merged ? Math.max(0, end - last!.offset - last!.text.length) : end - start;
    if (shown && size + added > PAGE_VIEW) break;
    if (merged) last!.text = text.slice(last!.offset, Math.max(end, last!.offset + last!.text.length));
    else matches.push({ offset: start, text: text.slice(start, Math.min(end, start + PAGE_VIEW)) });
    shown += 1; size += added;
  }
  return { ...meta, find, characters: text.length, totalMatches: found.length, shownMatches: shown, complete: shown === found.length, matches };
}
function pageText(url: URL, body: string, type: string) {
  const githubJson = isGithubApi(url) && /application\/(?:vnd\.github\+json|json)/i.test(type);
  if (!/text\/(?:html|plain)/i.test(type) && !githubJson) throw new MoguriError("web_format", "The page is not HTML or plain text; only public GitHub REST API JSON is also supported.");
  if (type.includes("text/plain") || githubJson) return { source: "untrusted-web" as const, url: url.toString(), title: url.hostname, text: body.slice(0, 50_000), complete: body.length <= 50000, omittedCharacters: Math.max(0, body.length - 50000) };
  const document = load(body);
  document("script,style,noscript,iframe,form").remove();
  const text = (document("main").text() || document("article").text() || document("body").text()).replace(/\s+/g, " ").trim();
  return { source: "untrusted-web" as const, url: url.toString(), title: document("title").text().trim(),
    text: text.slice(0, 50_000), complete: text.length <= 50000, omittedCharacters: Math.max(0, text.length - 50000) };
}
export async function fetchNativeSource(input: string, signal: AbortSignal, redirects = 0, access?: WebAccess, maximum = 1024 * 1024): Promise<{ url: string; body: string; type: string }> {
  if (process.platform !== "linux" || process.env.NODE_USE_ENV_PROXY !== "1" || !process.env.HTTPS_PROXY || !process.env.ALL_PROXY) {
    throw new MoguriError("native_web_boundary", "Native public-page reads require the actual verified guest's enforced proxy. No controller or Local fetch was attempted.", 409);
  }
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.port || redirects > 3) throw new MoguriError("web_destination", "Use a public HTTPS page without credentials and at most three approved redirects.");
  assertWebAccess(access, url.href);
  const records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some((record) => !publicAddress(record.address))) throw new MoguriError("web_destination", "Private, loopback, metadata and reserved destinations are denied.");
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    headers: pageHeaders(url, "Moguri native public-page tool") });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("Location"); await response.body?.cancel();
    if (!location) throw new MoguriError("web_destination", "The approved native page redirect has no exact destination.");
    return fetchNativeSource(new URL(location, url).href, signal, redirects + 1, access, maximum);
  }
  if (!response.ok) { await response.body?.cancel(); throw new MoguriError("web_failed", `${publicPageFailure(url, response.status)} The configured guest network policy was not broadened.`, 502); }
  const content = await boundedBody(response, maximum, signal);
  if (!isUtf8(content)) throw new MoguriError("web_encoding", "The complete native source is not valid UTF-8. No replacement characters or text conversion were accepted.");
  return { url: url.href, body: content.toString("utf8"), type: response.headers.get("Content-Type") ?? "" };
}
export async function fetchNativePage(input: string, signal: AbortSignal, access?: WebAccess): Promise<ReturnType<typeof pageText>> {
  const source = await fetchNativeSource(input, signal, 0, access);
  return pageText(new URL(source.url), source.body, source.type);
}
export async function fetchPublicSource(input: string, signal: AbortSignal, redirects = 0, access?: WebAccess, maximum = 1024 * 1024): Promise<{ url: string; body: string; type: string }> {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || redirects > 3) throw new MoguriError("web_destination", "Only public HTTPS pages with at most three safe redirects are supported.");
  assertWebAccess(access, url.href);
  const records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some((record) => !publicAddress(record.address))) throw new MoguriError("web_destination", "Private, loopback, link-local and reserved destinations are denied.");
  const address = records[0]!;
  const response = await new Promise<{ status: number; location?: string; body: string; type: string }>((resolve, reject) => {
    const req = request({
      hostname: address.address, servername: url.hostname, port: url.port || 443,
      path: url.pathname + url.search, method: "GET", signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      headers: { Host: url.host, ...pageHeaders(url, "Moguri/0.2 local-tool") },
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (data: Buffer) => {
        bytes += data.length;
        if (bytes > maximum) { req.destroy(new MoguriError("web_limit", `Source exceeded its ${maximum}-byte fetch limit. Nothing was truncated.`)); return; }
        chunks.push(data);
      });
      response.on("error", reject);
      response.on("end", () => {
        const bytes = Buffer.concat(chunks);
        if (!isUtf8(bytes)) { reject(new MoguriError("web_encoding", "The complete source is not valid UTF-8. No replacement characters or text conversion were accepted.")); return; }
        resolve({ status: response.statusCode ?? 0, location: response.headers.location, body: bytes.toString("utf8"), type: response.headers["content-type"] ?? "" });
      });
    });
    req.on("error", reject);
    req.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.status) && response.location) return fetchPublicSource(new URL(response.location, url).toString(), signal, redirects + 1, access, maximum);
  if (response.status < 200 || response.status >= 300) throw new MoguriError("web_failed", publicPageFailure(url, response.status));
  return { url: url.href, body: response.body, type: response.type };
}
export async function fetchPage(input: string, signal: AbortSignal, access?: WebAccess): Promise<ReturnType<typeof pageText>> {
  const source = await fetchPublicSource(input, signal, 0, access);
  return pageText(new URL(source.url), source.body, source.type);
}
const pages = new Map<string, { at: number; page: PageContent }>();
const PAGE_CACHE_MS = 10 * 60_000, PAGE_CACHE_ENTRIES = 32;
/**
 * Fetches a page's readable text, reusing a copy fetched in the last 10 minutes so searching or paging the same page
 * doesn't download it again. Web access policy is checked for the requested and final URL on every call, cached or not.
 */
export async function fetchPageContent(input: string, signal: AbortSignal, access?: WebAccess, native = false, now = Date.now()): Promise<PageContent> {
  const key = `${native ? "native" : "local"}\0${input}`, cached = pages.get(key);
  if (cached && now - cached.at < PAGE_CACHE_MS) {
    assertWebAccess(access, input); assertWebAccess(access, cached.page.url);
    return { ...cached.page, cached: true };
  }
  const source = await (native ? fetchNativeSource(input, signal, 0, access) : fetchPublicSource(input, signal, 0, access));
  const page = pageContent(new URL(source.url), source.body, source.type);
  pages.delete(key); pages.set(key, { at: now, page });
  while (pages.size > PAGE_CACHE_ENTRIES) pages.delete(pages.keys().next().value!);
  return page;
}
