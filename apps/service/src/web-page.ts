import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { load } from "cheerio";
import { MoguriError } from "../../../packages/protocol/src/index.ts";

function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    return parts[0] !== 0 && parts[0] !== 10 && parts[0] !== 127 && parts[0]! < 224 &&
      !(parts[0] === 169 && parts[1] === 254) && !(parts[0] === 192 && parts[1] === 168) &&
      !(parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) &&
      !(parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127);
  }
  const lower = address.toLowerCase();
  return isIP(address) === 6 && !["::", "::1"].includes(lower) && !lower.startsWith("fc") && !lower.startsWith("fd") && !lower.startsWith("fe80:") && !lower.includes("::ffff:");
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
  if (!/text\/(?:html|plain)/i.test(response.type)) throw new MoguriError("web_format", "The page is not HTML or plain text; no conversion service was used.");
  if (response.type.includes("text/plain")) return { source: "untrusted-web", url: url.toString(), title: url.hostname, text: response.body.slice(0, 50_000) };
  const document = load(response.body);
  document("script,style,noscript,iframe,form").remove();
  return { source: "untrusted-web", url: url.toString(), title: document("title").text().trim(), text: (document("main").text() || document("article").text() || document("body").text()).replace(/\s+/g, " ").trim().slice(0, 50_000) };
}
