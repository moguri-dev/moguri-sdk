import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { startService } from "../apps/service/src/server.ts";
import { MoguriClient } from "../packages/client/src/index.ts";
import { readConnection } from "../packages/client/src/node.ts";
import { setupFixture, waitFor } from "./fixture.ts";

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
    restarted = await startService({ stateDir, provider: fixture.provider });
    await waitFor(() => client.getState().status === "connected" && client.connection.token !== oldToken);
    assert.equal(client.getState().snapshot?.sessions.find((session) => session.id === fixture.sessionId)?.draft.text, "generated reconnect draft");
    assert.equal(restarted.controller.events(0).filter((event) => event.event_type === "draft.saved").length, 1);
    assert.equal(fixture.requests.length, 0);
  } finally { client.disconnect(); await restarted?.close(); await fixture.close(); }
});
