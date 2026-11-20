import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { fetchPage, fetchPageContent, fetchPublicSource, pageFind, pageSlice } from "../apps/service/src/web-page.ts";
import { isRecord, type WebAccess } from "../packages/sdk/src/index.ts";

test("the actual public-page redirect path checks every destination before DNS or dispatch", async (t) => {
  const requests: { path: string; host: string; authorization: string | undefined; accept: string | undefined; apiVersion: string | undefined }[] = [], lookups: string[] = [];
  const server = http.createServer((request, response) => {
    const apiVersion = request.headers["x-github-api-version"];
    requests.push({ path: request.url ?? "", host: request.headers.host ?? "", authorization: request.headers.authorization,
      accept: request.headers.accept, apiVersion: Array.isArray(apiVersion) ? apiVersion[0] : apiVersion });
    if (request.url === "/first") response.writeHead(302, { Location: "https://outside.example.invalid/final" }).end();
    else if (request.url?.startsWith("/search/issues?")) response.writeHead(422, { "Content-Type": "application/json" })
      .end(JSON.stringify({ message: "Generated private repository is not searchable anonymously." }));
    else if (request.url === "/repos/octocat/Hello-World") {
      if (request.headers.accept !== "application/vnd.github+json" || request.headers["x-github-api-version"] !== "2022-11-28") response.writeHead(415).end();
      else response.writeHead(200, { "Content-Type": "application/vnd.github+json; charset=utf-8" })
        .end(JSON.stringify({ name: "Hello-World", description: "Generated public repository." }));
    }
    else response.writeHead(200, { "Content-Type": "text/plain" }).end("Generated permitted destination.");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The generated page server did not bind.");
  t.mock.method(dns, "lookup", async (hostname: string) => {
    lookups.push(hostname);
    return [{ address: hostname === "127.0.0.1" ? hostname : "93.184.216.34", family: 4 }];
  });
  t.mock.method(https, "request", (options: unknown, callback: unknown) => {
    if (!isRecord(options) || typeof options.path !== "string" || !isRecord(options.headers) || typeof callback !== "function") throw new Error("Generated HTTPS interception received another request shape.");
    const headers: Record<string, string> = { Host: String(options.headers.Host) };
    for (const name of ["Accept", "User-Agent", "X-GitHub-Api-Version"]) {
      const value = options.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    return http.request({ hostname: "127.0.0.1", port: address.port, path: options.path, method: "GET",
      signal: options.signal instanceof AbortSignal ? options.signal : undefined, headers }, (response) => callback(response));
  });
  syncBuiltinESMExports();
  const access: WebAccess = { version: 1, unrestricted: false, sites: [], origins: ["https://first.example.invalid"] };
  try {
    await assert.rejects(() => fetchPublicSource("https://first.example.invalid/first", new AbortController().signal, 0, access), { code: "web_approval_required" });
    assert.deepEqual(lookups, ["first.example.invalid"]);
    assert.deepEqual(requests.map((request) => request.host), ["first.example.invalid"]);
    const permitted = await fetchPublicSource("https://first.example.invalid/first", new AbortController().signal, 0,
      { ...access, sites: ["outside.example.invalid"] });
    assert.equal(permitted.url, "https://outside.example.invalid/final");
    assert.equal(permitted.body, "Generated permitted destination.");
    assert.ok(requests.every((request) => request.authorization === undefined));
    const automatic = await fetchPublicSource("https://first.example.invalid/first", new AbortController().signal, 0,
      { ...access, unrestricted: true });
    assert.equal(automatic.url, permitted.url);
    const github = await fetchPage("https://api.github.com/repos/octocat/Hello-World", new AbortController().signal,
      { version: 1, unrestricted: false, sites: [], origins: ["https://api.github.com"] });
    assert.equal(github.source, "untrusted-web");
    assert.equal(github.text, JSON.stringify({ name: "Hello-World", description: "Generated public repository." }));
    const githubRequest = requests.find((request) => request.host === "api.github.com");
    assert.equal(githubRequest?.accept, "application/vnd.github+json");
    assert.equal(githubRequest?.apiVersion, "2022-11-28");
    assert.equal(githubRequest?.authorization, undefined);
    await assert.rejects(() => fetchPage("https://api.github.com/search/issues?q=repo%3Agenerated%2Fprivate+is%3Aissue", new AbortController().signal,
      { version: 1, unrestricted: false, sites: [], origins: ["https://api.github.com"] }), /Anonymous GitHub request returned HTTP 422.*not a Copilot login result.*github_read/);
    assert.equal(requests.filter((request) => request.path.startsWith("/search/issues?")).length, 1);
    assert.ok(requests.every((request) => request.authorization === undefined));
    const dispatched = requests.length;
    await assert.rejects(() => fetchPublicSource("https://127.0.0.1/private", new AbortController().signal, 0,
      { ...access, unrestricted: true }), { code: "web_destination" });
    assert.equal(requests.length, dispatched);
    const beforeMissingAuthority = lookups.length;
    await assert.rejects(() => fetchPublicSource("https://first.example.invalid/first", new AbortController().signal), { code: "web_approval_required" });
    assert.equal(lookups.length, beforeMissingAuthority);
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports(); server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("web_fetch finds literal matches, pages by offset and reuses a recent copy only within current web access", async (t) => {
  let served = 0;
  const words = Array.from({ length: 8_000 }, (_, index) => index === 3_000 || index === 6_000 ? "GeneratedNeedle" : `word${index}`).join(" ");
  const server = http.createServer((_request, response) => { served += 1; response.writeHead(200, { "Content-Type": "text/plain" }).end(words); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The generated page server did not bind.");
  t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  t.mock.method(https, "request", (options: unknown, callback: unknown) => {
    if (!isRecord(options) || typeof options.path !== "string" || typeof callback !== "function") throw new Error("Generated HTTPS interception received another request shape.");
    return http.request({ hostname: "127.0.0.1", port: address.port, path: options.path, method: "GET" }, (response) => callback(response));
  });
  syncBuiltinESMExports();
  const url = "https://pages.example.invalid/generated-long", access: WebAccess = { version: 1, unrestricted: false, sites: ["pages.example.invalid"], origins: [] };
  try {
    const first = await fetchPageContent(url, new AbortController().signal, access, false, 1_000);
    assert.equal(first.cached, false); assert.equal(served, 1);
    const page = pageSlice(first);
    assert.equal(page.text.length, 50_000); assert.equal(page.complete, false); assert.equal(page.nextOffset, 50_000);
    const rest = pageSlice(first, page.nextOffset!);
    assert.equal(rest.offset, 50_000); assert.equal(rest.nextOffset, null); assert.equal(rest.text, words.slice(50_000));
    const found = pageFind(await fetchPageContent(url, new AbortController().signal, access, false, 2_000), "generatedneedle", 10);
    assert.equal(served, 1); assert.equal(found.cached, true); assert.equal(found.totalMatches, 2); assert.equal(found.complete, true);
    assert.deepEqual(found.matches.map((match) => match.text.includes("GeneratedNeedle")), [true, true]);
    assert.ok(found.matches.every((match) => match.text.length <= "GeneratedNeedle".length + 20));
    assert.equal(pageFind(first, "word1", 200, 3).complete, false);
    const bounded = pageFind({ ...first, text: Array.from({ length: 200 }, (_, index) => `GeneratedNeedle ${"x".repeat(4_000)} ${index}`).join(" ") }, "generatedneedle", 2_000, 100);
    assert.ok(bounded.matches.reduce((total, match) => total + match.text.length, 0) <= 50_000);
    assert.equal(bounded.totalMatches, 200); assert.ok(bounded.shownMatches > 0 && bounded.shownMatches < 100); assert.equal(bounded.complete, false);
    await assert.rejects(() => fetchPageContent(url, new AbortController().signal, { ...access, sites: [] }, false, 3_000), { code: "web_approval_required" });
    await fetchPageContent(url, new AbortController().signal, access, false, 1_000 + 10 * 60_000);
    assert.equal(served, 2);
  } finally { server.close(); }
});
