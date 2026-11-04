import assert from "node:assert/strict";
import test from "node:test";
import { MoguriClient } from "../packages/client/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { responseTiming } from "../packages/client/src/request-timing.ts";

test("client transport timings are bounded, payload-free copies rather than server/model authority", async () => {
  const f = await setupFixture(), client = new MoguriClient(f.service.connection);
  try {
    await client.connect(); await waitFor(() => client.getState().status === "connected");
    const text = "Generated private draft content must not enter timing diagnostics.";
    await client.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: 0, text, attachments: [] });
    const timings = client.getRequestTimings(), saved = timings.findLast((entry) => entry.operation === "draft.save");
    assert.ok(saved);
    assert.equal(saved.completed, true); assert.equal(saved.status, 200);
    assert.ok(saved.headersMs !== null && saved.headersMs >= 0);
    assert.ok(saved.bodyMs !== null && saved.bodyMs >= 0);
    assert.ok(saved.totalMs >= saved.headersMs + saved.bodyMs);
    assert.ok(saved.response?.serviceMs !== null && saved.response?.serviceMs !== undefined && saved.response.serviceMs >= 0);
    assert.equal(saved.response.proxyHeadersMs, null);
    const serialized = JSON.stringify(timings);
    for (const secret of [text, f.sessionId, f.service.connection.token, f.service.connection.baseUrl]) assert.equal(serialized.includes(secret), false);
    timings[0]!.operation = "other"; timings.length = 0;
    assert.ok(client.getRequestTimings().length > 0);
    for (let index = 0; index < 55; index++) await client.refresh();
    assert.equal(client.getRequestTimings().length, 50);
    assert.equal(f.requests.length, 0);
  } finally { client.disconnect(); await f.close(); }
});

test("only bounded numeric service/proxy timing fields enter the diagnostic copy", () => {
  assert.deepEqual(responseTiming("moguri-service;dur=12.5, moguri-proxy-body;dur=0.125, moguri-proxy-headers;dur=85, moguri-service-loop;dur=41, moguri-service-window;dur=512"), {
    serviceMs: 12.5, proxyBodyMs: 0.125, proxyHeadersMs: 85, serviceLoopMs: 41, serviceWindowMs: 512, proxyLoopMs: null, proxyWindowMs: null,
  });
  for (const header of [null, "private-source;dur=3;desc=\"Generated private text\"", "moguri-service;dur=Infinity",
    "moguri-service;dur=-1", "moguri-service;dur=999999999", "moguri-service;dur=2;desc=\"Generated private text\"", "x".repeat(2049)]) {
    assert.deepEqual(Object.values(responseTiming(header)), [null, null, null, null, null, null, null]);
  }
});

test("a generated held query has a measured service handling span, not inferred UI or model execution time", async (t) => {
  const f = await setupFixture(), client = new MoguriClient(f.service.connection);
  const query = f.service.controller.platform.query.bind(f.service.controller.platform);
  t.mock.method(f.service.controller.platform, "query", async (...args: Parameters<typeof query>) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    return query(...args);
  });
  try {
    const began = performance.now();
    const response = await fetch(`${f.service.connection.baseUrl}/v1/query`, { method: "POST", headers: {
      Authorization: `Bearer ${f.service.connection.token}`, "Content-Type": "application/json", "X-Moguri-Query-Id": crypto.randomUUID(),
    }, body: JSON.stringify({ type: "browser.state", sessionId: f.sessionId }) });
    const headersMs = performance.now() - began, timing = responseTiming(response.headers.get("Server-Timing"));
    assert.equal(response.status, 200);
    assert.ok(timing.serviceMs !== null && timing.serviceMs >= 110 && timing.serviceMs <= headersMs + 1);
    assert.equal(timing.proxyHeadersMs, null);
    await response.json();
    assert.equal(f.requests.length, 0);
  } finally { client.disconnect(); t.mock.restoreAll(); await f.close(); }
});

test("rejected mutations retain failed transport status without exposing their arguments or becoming successful timings", async () => {
  const f = await setupFixture(), client = new MoguriClient(f.service.connection);
  try {
    await client.connect(); await waitFor(() => client.getState().status === "connected");
    await assert.rejects(() => client.command({ type: "session.create", projectId: "generated-missing-project", title: "Generated private title" }));
    const failed = client.getRequestTimings().findLast((entry) => entry.operation === "session.create");
    assert.ok(failed);
    assert.equal(failed.completed, false);
    assert.equal(failed.status, 409);
    assert.equal(JSON.stringify(client.getRequestTimings()).includes("Generated private title"), false);
    assert.equal(f.requests.length, 0);
  } finally { client.disconnect(); await f.close(); }
});
