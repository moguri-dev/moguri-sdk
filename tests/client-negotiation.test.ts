import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { envelope } from "../apps/service/src/controller.ts";
import { startService } from "../apps/service/src/server.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { generatedNegotiationHistory } from "./fixtures/negotiation-history.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("cold negotiation starts after the authenticated snapshot rather than replaying retained history through the socket", { timeout: ciTime(20_000) }, async (t) => {
  const fixture = await setupFixture(), stateDir = join(fixture.directory, "state");
  let runtime: Awaited<ReturnType<typeof startService>> | undefined, client: MoguriSdk | undefined;
  const originalSend = WebSocket.prototype.send, cursors: number[] = [];
  t.mock.method(WebSocket.prototype, "send", function (this: WebSocket, data: Parameters<WebSocket["send"]>[0]) {
    if (typeof data === "string") {
      const frame: unknown = JSON.parse(data);
      if (frame && typeof frame === "object" && "type" in frame && frame.type === "authenticate" && "after" in frame && typeof frame.after === "number") cursors.push(frame.after);
    }
    return originalSend.call(this, data);
  });
  try {
    const projectId = fixture.session().projectId;
    await fixture.service.close();
    const events = generatedNegotiationHistory(fixture.sessionId, projectId, "Generated final retained handshake draft.");
    assert.ok(Buffer.byteLength(JSON.stringify(events)) > 50 * 1024 * 1024);
    const store = new EventStore(join(stateDir, "state.sqlite"), fixture.retentionKey);
    try { store.commit(events); } finally { store.close(); }
    runtime = await startService({ stateDir, provider: fixture.provider, retentionKey: fixture.retentionKey });
    const sequence = runtime.controller.snapshot().seq, before = runtime.store.db.prepare("SELECT COUNT(*) AS count FROM events").get()?.count;
    client = new MoguriSdk(runtime.connection);
    const opening = performance.now();
    await client.ready();
    t.diagnostic(JSON.stringify({ retainedEvents: events.length, historyBytes: Buffer.byteLength(JSON.stringify(events)), negotiationMs: performance.now() - opening, cursors }));
    assert.deepEqual(cursors, [sequence]);
    assert.equal(client.getState().events.length, 0);
    assert.equal(client.sessions.get(fixture.sessionId)?.draft.text, "Generated final retained handshake draft.");
    assert.equal(runtime.store.db.prepare("SELECT COUNT(*) AS count FROM events").get()?.count, before);
    assert.equal(fixture.requests.length, 0);
  } finally { t.mock.restoreAll(); client?.disconnect(); await runtime?.close(); await fixture.close(); }
});

test("an event committed between snapshot delivery and event authentication is received without replaying older history", async (t) => {
  const fixture = await setupFixture(), client = new MoguriSdk(fixture.service.connection), fetch = globalThis.fetch;
  let previousSequence = 0, committedSequence = 0, injected = false;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const response = await fetch(input, init);
    if (!injected && String(input).endsWith("/v1/snapshot")) {
      injected = true;
      const snapshot: unknown = await response.json();
      assert.ok(snapshot && typeof snapshot === "object" && "seq" in snapshot && typeof snapshot.seq === "number");
      previousSequence = snapshot.seq;
      await fixture.service.controller.dispatch(envelope({
        type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0,
        text: "Generated event between snapshot and socket.", attachments: [],
      }));
      committedSequence = fixture.service.controller.snapshot().seq;
      return Response.json(snapshot);
    }
    return response;
  });
  try {
    await client.ready();
    await waitFor(() => client.getState().events.some((event) => event.seq === committedSequence));
    assert.ok(committedSequence > previousSequence);
    assert.ok(client.getState().events.every((event) => event.seq > previousSequence));
    assert.equal(client.sessions.get(fixture.sessionId)?.draft.text, "Generated event between snapshot and socket.");
    assert.equal(fixture.requests.length, 0);
  } finally { t.mock.restoreAll(); client.disconnect(); await fixture.close(); }
});

test("a late ready frame cannot roll back a newer authenticated HTTP snapshot or its resume cursor", async (t) => {
  const fixture = await setupFixture(), client = new MoguriSdk(fixture.service.connection);
  const snapshot = fixture.service.profiles.snapshot.bind(fixture.service.profiles), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const originalSend = WebSocket.prototype.send, cursors: number[] = [];
  let channel: WebSocket | undefined;
  let reads = 0;
  t.mock.method(WebSocket.prototype, "send", function (this: WebSocket, data: Parameters<WebSocket["send"]>[0]) {
    if (typeof data === "string") {
      const frame: unknown = JSON.parse(data);
      if (frame && typeof frame === "object" && "type" in frame && frame.type === "authenticate" && "after" in frame && typeof frame.after === "number") {
        channel = this; cursors.push(frame.after);
      }
    }
    return originalSend.call(this, data);
  });
  t.mock.method(fixture.service.profiles, "snapshot", async (...args: Parameters<typeof snapshot>) => {
    const value = await snapshot(...args);
    if (++reads === 2) { entered.resolve(); await release.promise; }
    return value;
  });
  try {
    await client.connect(); await entered.promise;
    await fixture.service.controller.dispatch(envelope({
      type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0,
      text: "Generated newer authenticated snapshot.", attachments: [],
    }));
    await client.refresh();
    const sequence = client.getState().snapshot!.seq;
    release.resolve(); await waitFor(() => client.getState().status === "connected");
    assert.equal(client.getState().snapshot?.seq, sequence);
    assert.equal(client.sessions.get(fixture.sessionId)?.draft.text, "Generated newer authenticated snapshot.");
    assert.ok(channel);
    channel.close(4000, "Generated reconnect cursor inspection.");
    await waitFor(() => cursors.length === 2 && client.getState().status === "connected");
    assert.equal(cursors[1], sequence);
    assert.equal(client.getState().snapshot?.seq, sequence);
    assert.equal(fixture.requests.length, 0);
  } finally { release.resolve(); t.mock.restoreAll(); client.disconnect(); await fixture.close(); }
});

test("failed event negotiation retains its authentication close diagnostic instead of reporting only a timeout", async (t) => {
  const fixture = await setupFixture(), client = new MoguriSdk(fixture.service.connection);
  const snapshot = fixture.service.profiles.snapshot.bind(fixture.service.profiles);
  let reads = 0;
  t.mock.method(fixture.service.profiles, "snapshot", async (...args: Parameters<typeof snapshot>) => {
    if (++reads > 1) throw new Error("Generated rejected event snapshot.");
    return snapshot(...args);
  });
  try {
    await assert.rejects(() => client.ready(200), (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "connection_timeout" &&
      error.message.includes("close 1008") && error.message.includes("selected profile") && !error.message.includes("Generated rejected event snapshot"));
    assert.equal(fixture.requests.length, 0);
    assert.equal(client.getState().status, "disconnected");
  } finally { t.mock.restoreAll(); client.disconnect(); await fixture.close(); }
});
