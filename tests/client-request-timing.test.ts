import assert from "node:assert/strict";
import test from "node:test";
import { MoguriClient } from "../packages/client/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

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
    const serialized = JSON.stringify(timings);
    for (const secret of [text, f.sessionId, f.service.connection.token, f.service.connection.baseUrl]) assert.equal(serialized.includes(secret), false);
    timings[0]!.operation = "other"; timings.length = 0;
    assert.ok(client.getRequestTimings().length > 0);
    for (let index = 0; index < 55; index++) await client.refresh();
    assert.equal(client.getRequestTimings().length, 50);
    assert.equal(f.requests.length, 0);
  } finally { client.disconnect(); await f.close(); }
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
