import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { fetchPublicSource } from "../apps/service/src/web-page.ts";
import { isRecord, type WebAccess } from "../packages/sdk/src/index.ts";

test("the actual public-page redirect path checks every destination before DNS or dispatch", async (t) => {
  const requests: { path: string; host: string; authorization: string | undefined }[] = [], lookups: string[] = [];
  const server = http.createServer((request, response) => {
    requests.push({ path: request.url ?? "", host: request.headers.host ?? "", authorization: request.headers.authorization });
    if (request.url === "/first") response.writeHead(302, { Location: "https://outside.example.invalid/final" }).end();
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
    return http.request({ hostname: "127.0.0.1", port: address.port, path: options.path, method: "GET",
      signal: options.signal instanceof AbortSignal ? options.signal : undefined, headers: { Host: String(options.headers.Host) } }, (response) => callback(response));
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
