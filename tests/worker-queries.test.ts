import assert from "node:assert/strict";
import { test } from "node:test";
import { MoguriError } from "../packages/protocol/src/index.ts";
import { workerCatalog } from "../apps/service/src/worker-queries.ts";

test("provider proxy refusal identifies the failed network gate without exposing raw credentials or diagnostics", async (context) => {
  const proxy = new Error("Generated private proxy details; Proxy response (403) !== 200");
  const failure = new TypeError("Generated private fetch details", { cause: new Error("Generated intermediary", { cause: proxy }) });
  context.mock.method(globalThis, "fetch", async () => { throw failure; });
  await assert.rejects(() => workerCatalog({ url: "https://api.githubcopilot.com", key: "generated-private-key" }, new AbortController().signal),
    (error: unknown) => error instanceof MoguriError && error.code === "worker_catalog_network" &&
      error.message.includes("api.githubcopilot.com") && error.message.includes("proxy CONNECT returned HTTP 403") &&
      error.message.includes("DNS aliases") && !error.message.includes("Generated") && !error.message.includes("generated-private-key"));
});

test("provider HTTP refusal remains an actual catalogue response, not an enforced-proxy failure", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("Generated unauthenticated provider response.", { status: 403 }));
  const result = await workerCatalog({ url: "https://api.githubcopilot.com", key: null }, new AbortController().signal);
  assert.equal(result.status, 403);
  assert.equal(Buffer.from(result.body, "base64").toString(), "Generated unauthenticated provider response.");
});

test("owned cancellation keeps its original reason instead of becoming a provider-network failure", async (context) => {
  const abort = new AbortController(), reason = new Error("Generated owned cancellation.");
  context.mock.method(globalThis, "fetch", async () => { abort.abort(reason); throw new TypeError("Generated cancelled fetch."); });
  await assert.rejects(() => workerCatalog({ url: "https://api.githubcopilot.com", key: null }, abort.signal), (error: unknown) => error === reason);
});

test("unexpected catalogue failures are not hidden as a network diagnostic", async (context) => {
  const failure = new RangeError("Generated unexpected failure.");
  context.mock.method(globalThis, "fetch", async () => { throw failure; });
  await assert.rejects(() => workerCatalog({ url: "https://api.githubcopilot.com", key: null }, new AbortController().signal), (error: unknown) => error === failure);
});

test("catalogue timeout diagnostics are bounded and never include raw exception text", async (context) => {
  context.mock.method(globalThis, "fetch", async () => { throw new DOMException("Generated private timeout details.", "TimeoutError"); });
  await assert.rejects(() => workerCatalog({ url: "https://api.githubcopilot.com", key: null }, new AbortController().signal),
    (error: unknown) => error instanceof MoguriError && error.code === "worker_catalog_network" && !error.message.includes("Generated"));
});

test("a cyclic fetch cause cannot loop or disclose raw provider diagnostics", async (context) => {
  const failure = new TypeError("Generated private cyclic cause.");
  failure.cause = failure;
  context.mock.method(globalThis, "fetch", async () => { throw failure; });
  await assert.rejects(() => workerCatalog({ url: "https://api.githubcopilot.com", key: null }, new AbortController().signal),
    (error: unknown) => error instanceof MoguriError && error.code === "worker_catalog_network" && !error.message.includes("Generated"));
});
