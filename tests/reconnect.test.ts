import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { startService } from "../apps/service/src/server.ts";
import { ClientError, MoguriClient } from "../packages/client/src/index.ts";
import { readConnection } from "../packages/client/src/node.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { envelope } from "../apps/service/src/controller.ts";

test("a client reconnects through a rotated private connection file without resending mutations", async () => {
  const fixture = await setupFixture();
  const stateDir = join(fixture.directory, "state");
  const client = new MoguriClient(fixture.service.connection, () => readConnection(stateDir));
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await client.connect();
    await waitFor(() => client.getState().status === "connected");
    await client.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "generated reconnect draft", attachments: [] });
    const oldToken = client.connection.token;
    await fixture.service.close();
    restarted = await startService({ stateDir, provider: fixture.provider, retentionKey: fixture.retentionKey });
    await waitFor(() => client.getState().status === "connected" && client.connection.token !== oldToken);
    assert.equal(client.getState().snapshot?.sessions.find((session) => session.id === fixture.sessionId)?.draft.text, "generated reconnect draft");
    assert.equal(restarted.controller.events(0).filter((event) => event.event_type === "draft.saved").length, 1);
    assert.equal(fixture.requests.length, 0);
  } finally { client.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("one failed snapshot cannot poison an authenticated event connection after a successful refresh", async (t) => {
  const fixture = await setupFixture(), client = new MoguriClient(fixture.service.connection);
  const original = globalThis.fetch;
  try {
    await client.connect(); await waitFor(() => client.getState().status === "connected");
    let fail = true;
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/v1/snapshot") && fail) { fail = false; throw new TypeError("Generated transient snapshot disconnect."); }
      return original(input, init);
    });
    await client.refresh();
    assert.match(client.getState().error ?? "", /Generated transient/);
    await client.refresh();
    assert.equal(client.getState().status, "connected");
    await client.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated recovered edit.", attachments: [] });
    assert.equal(fixture.session().draft.text, "Generated recovered edit.");
  } finally { t.mock.restoreAll(); client.disconnect(); await fixture.close(); }
});

test("streaming refresh requests do not indefinitely extend the snapshot a command is waiting for", async (t) => {
  const fixture = await setupFixture(), client = new MoguriClient(fixture.service.connection);
  const original = globalThis.fetch;
  try {
    await client.connect(); await waitFor(() => client.getState().status === "connected");
    let reads = 0;
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const response = await original(input, init);
      if (String(input).endsWith("/v1/snapshot") && ++reads < 5) void client.refresh();
      return response;
    });
    await client.refresh();
    assert.equal(reads, 1, "one caller waits for one snapshot, not an unbounded stream of invalidations");
  } finally { t.mock.restoreAll(); client.disconnect(); await fixture.close(); }
});

test("a lost mutation response reconciles only its committed original receipt without resending the effect", async (t) => {
  const fixture = await setupFixture(), client = new MoguriClient(fixture.service.connection);
  const original = globalThis.fetch;
  try {
    await client.connect(); await waitFor(() => client.getState().status === "connected");
    let writes = 0;
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const response = await original(input, init);
      if (String(input).endsWith("/v1/commands")) {
        writes++; await response.json();
        throw new DOMException("Signal timed out", "TimeoutError");
      }
      return response;
    });
    const result = await client.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated committed original.", attachments: [] }, "generated-original-receipt");
    assert.equal(result.revision, 1); assert.equal(writes, 1);
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "draft.saved").length, 1);
    assert.equal(client.getState().snapshot?.sessions.find((session) => session.id === fixture.sessionId)?.draft.text, "Generated committed original.");
  } finally { t.mock.restoreAll(); client.disconnect(); await fixture.close(); }
});

test("an unobserved mutation remains explicitly unknown with its exact identity and no automatic write retry", async (t) => {
  const fixture = await setupFixture(), client = new MoguriClient(fixture.service.connection);
  const original = globalThis.fetch;
  try {
    await client.connect(); await waitFor(() => client.getState().status === "connected");
    let writes = 0;
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/v1/commands")) { writes++; throw new DOMException("Signal timed out", "TimeoutError"); }
      return original(input, init);
    });
    await assert.rejects(() => client.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated unknown edit.", attachments: [] }, "generated-unknown-receipt"),
      (error: unknown) => error instanceof ClientError && error.code === "command_outcome_unknown" && error.message.includes("generated-unknown-receipt"));
    assert.equal(writes, 1); assert.equal(fixture.session().draft.revision, 0);
  } finally { t.mock.restoreAll(); client.disconnect(); await fixture.close(); }
});

test("a late original snapshot cannot overwrite the restarted connection's newer saved state", async (t) => {
  const f = await setupFixture(), stateDir = join(f.directory, "state"), client = new MoguriClient(f.service.connection, () => readConnection(stateDir));
  const original = globalThis.fetch, entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, pending: Promise<void> | undefined, hold = true;
  try {
    await client.connect(); await waitFor(() => client.getState().status === "connected");
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const response = await original(input, init);
      if (String(input).endsWith("/v1/snapshot") && hold) {
        hold = false; const snapshot: unknown = await response.json(); entered.resolve(); await release.promise; return Response.json(snapshot);
      }
      return response;
    });
    pending = client.refresh(); await entered.promise;
    await f.service.close();
    restarted = await startService({ stateDir, provider: f.provider, retentionKey: f.retentionKey });
    await restarted.controller.dispatch(envelope({ type: "draft.save", sessionId: f.sessionId, expectedRevision: 0, text: "Generated newer restarted draft.", attachments: [] }));
    await waitFor(() => client.getState().status === "connected" && client.connection.token === restarted!.connection.token);
    release.resolve(); await pending;
    assert.equal(client.getState().snapshot?.sessions.find((session) => session.id === f.sessionId)?.draft.text, "Generated newer restarted draft.");
    assert.equal(restarted.controller.events(0).filter((event) => event.event_type === "draft.saved").length, 1); assert.equal(f.requests.length, 0);
  } finally { release.resolve(); await pending; t.mock.restoreAll(); client.disconnect(); await restarted?.close(); await f.close(); }
});

test("an internal response failure after commit returns only the verified original receipt, not a second mutation", async (t) => {
  const f = await setupFixture(), client = new MoguriClient(f.service.connection), dispatch = f.service.controller.dispatch.bind(f.service.controller);
  try {
    await client.connect(); await waitFor(() => client.getState().status === "connected");
    let writes = 0;
    t.mock.method(f.service.controller, "dispatch", async (...args: Parameters<typeof dispatch>) => {
      writes++; await dispatch(...args); throw new Error("Generated failure after retaining the exact original acknowledgement.");
    });
    const result = await client.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: 0, text: "Generated canonical committed edit.", attachments: [] }, "generated-internal-acknowledgement");
    assert.equal(result.revision, 1); assert.equal(writes, 1);
    assert.equal(f.session().draft.text, "Generated canonical committed edit.");
  } finally { t.mock.restoreAll(); client.disconnect(); await f.close(); }
});

test("a transient initial snapshot failure can authenticate the same profile without replaying commands", async (t) => {
  const f = await setupFixture(), client = new MoguriClient(f.service.connection), original = globalThis.fetch;
  try {
    let failed = false;
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      if (!failed && String(input).endsWith("/v1/snapshot")) {
        failed = true; return Response.json({ error: { code: "generated_snapshot_busy", message: "Generated temporary snapshot unavailability." } }, { status: 503 });
      }
      return original(input, init);
    });
    await client.connect(); await waitFor(() => client.getState().status === "connected");
    assert.equal(failed, true); assert.equal(client.getState().snapshot?.sessions[0]?.id, f.sessionId);
    assert.equal(client.getState().error, null); assert.equal(f.requests.length, 0);
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "draft.saved"), false);
  } finally { t.mock.restoreAll(); client.disconnect(); await f.close(); }
});

test("a missing profile is not a transient startup read or permission to fall back to Default", async () => {
  const f = await setupFixture(), client = new MoguriClient(f.service.connection, undefined, "generated-missing-profile");
  try {
    await assert.rejects(() => client.connect(), (error: unknown) => error instanceof ClientError && error.status === 404);
    assert.equal(client.profileId, "generated-missing-profile"); assert.equal(client.getState().snapshot, null);
    assert.equal(f.requests.length, 0);
  } finally { client.disconnect(); await f.close(); }
});
