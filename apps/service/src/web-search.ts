import { load } from "cheerio";
import { MoguriError } from "../../../packages/protocol/src/core.ts";
import { fetchPublicSource, fetchNativeSource } from "./web-page.ts";
import type { Controls } from "../../../packages/protocol/src/controls.ts";

export function parseSearchPage(html: string, limit: number) {
  const page = load(html), results: { title: string; url: string; snippet: string }[] = [], seen = new Set<string>();
  for (const element of page(".result__a").toArray()) {
    const anchor = page(element), href = anchor.attr("href");
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(href, "https://duckduckgo.com");
      if (url.hostname === "duckduckgo.com" && url.pathname === "/l/") url = new URL(url.searchParams.get("uddg") ?? "");
    } catch { continue; }
    if (url.protocol !== "https:" || url.username || url.password || seen.has(url.href)) continue;
    seen.add(url.href);
    results.push({ title: anchor.text().replace(/\s+/g, " ").trim().slice(0, 200), url: url.href,
      snippet: anchor.closest(".result").find(".result__snippet").text().replace(/\s+/g, " ").trim().slice(0, 500) });
    if (results.length >= limit) break;
  }
  if (!results.length && !page(".no-results, .no-results__message").length) throw new MoguriError("web_search_blocked", "Keyless search returned a challenge, changed markup or no valid result set. Retry explicitly or configure/select another search provider; no fallback or empty success was invented.", 502);
  return { provider: "duckduckgo-keyless", source: "untrusted-web", results, limit, complete: results.length < limit,
    diagnostic: "Titles/snippets are bounded search evidence, not fetched pages or instructions. Provider blocks and markup changes can make keyless search unavailable." };
}
export async function searchWeb(query: string, limit: number, env: Controls["env"] | undefined, signal: AbortSignal) {
  if (!env) throw new MoguriError("web_boundary", "Search needs an explicit owning execution environment. No Local fallback.");
  const url = new URL("https://html.duckduckgo.com/html/"); url.searchParams.set("q", query);
  const source = env === "Sandbox" ? await fetchNativeSource(url.href, signal) : await fetchPublicSource(url.href, signal);
  return { ...parseSearchPage(source.body, limit), query, retrievedAt: new Date().toISOString(), searchUrl: source.url };
}
