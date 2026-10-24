import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { load } from "cheerio";
import { MoguriError } from "../../../packages/protocol/src/index.ts";
import { publicAddress } from "./public-network.ts";
import { boundedBody } from "./network.ts";

function pageText(url: URL, body: string, type: string): { source: "untrusted-web"; url: string; title: string; text: string } {
  if (!/text\/(?:html|plain)/i.test(type)) throw new MoguriError("web_format", "The page is not HTML or plain text; no conversion service was used.");
  if (type.includes("text/plain")) return { source: "untrusted-web", url: url.toString(), title: url.hostname, text: body.slice(0, 50_000) };
  const document = load(body);
  document("script,style,noscript,iframe,form").remove();
  return { source: "untrusted-web", url: url.toString(), title: document("title").text().trim(),
    text: (document("main").text() || document("article").text() || document("body").text()).replace(/\s+/g, " ").trim().slice(0, 50_000) };
}
export async function fetchNativePage(input: string, signal: AbortSignal, redirects = 0): Promise<ReturnType<typeof pageText>> {
  if (process.platform !== "linux" || process.env.NODE_USE_ENV_PROXY !== "1" || !process.env.HTTPS_PROXY || !process.env.ALL_PROXY) {
    throw new MoguriError("native_web_boundary", "Native public-page reads require the actual verified guest's enforced proxy. No controller or Local fetch was attempted.", 409);
  }
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.port || redirects > 3) throw new MoguriError("web_destination", "Use a public HTTPS page without credentials and at most three approved redirects.");
  const records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some((record) => !publicAddress(record.address))) throw new MoguriError("web_destination", "Private, loopback, metadata and reserved destinations are denied.");
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    headers: { "User-Agent": "Moguri native public-page tool", Accept: "text/html,text/plain" } });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("Location"); await response.body?.cancel();
    if (!location) throw new MoguriError("web_destination", "The approved native page redirect has no exact destination.");
    return fetchNativePage(new URL(location, url).href, signal, redirects + 1);
  }
  if (!response.ok) { await response.body?.cancel(); throw new MoguriError("web_failed", `Native page returned HTTP ${response.status}. The configured guest network policy was not broadened.`, 502); }
  const content = await boundedBody(response, 1024 * 1024, signal);
  return pageText(url, content.toString("utf8"), response.headers.get("Content-Type") ?? "");
}
export async function fetchPage(input: string, signal: AbortSignal, redirects = 0): Promise<{ source: "untrusted-web"; url: string; title: string; text: string }> {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || redirects > 3) throw new MoguriError("web_destination", "Only public HTTPS pages with at most three safe redirects are supported.");
  const records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some((record) => !publicAddress(record.address))) throw new MoguriError("web_destination", "Private, loopback, link-local and reserved destinations are denied.");
  const address = records[0]!;
  const response = await new Promise<{ status: number; location?: string; body: string; type: string }>((resolve, reject) => {
    const req = request({
      hostname: address.address, servername: url.hostname, port: url.port || 443,
      path: url.pathname + url.search, method: "GET", signal,
      headers: { Host: url.host, "User-Agent": "Moguri/0.2 local-tool", Accept: "text/html,text/plain" },
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (data: Buffer) => {
        bytes += data.length;
        if (bytes > 1024 * 1024) { req.destroy(new MoguriError("web_limit", "Page exceeded the 1 MiB fetch limit.")); return; }
        chunks.push(data);
      });
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode ?? 0, location: response.headers.location, body: Buffer.concat(chunks).toString("utf8"), type: response.headers["content-type"] ?? "" }));
    });
    req.on("error", reject);
    req.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.status) && response.location) return fetchPage(new URL(response.location, url).toString(), signal, redirects + 1);
  if (response.status < 200 || response.status >= 300) throw new MoguriError("web_failed", `Page returned HTTP ${response.status}.`);
  return pageText(url, response.body, response.type);
}
