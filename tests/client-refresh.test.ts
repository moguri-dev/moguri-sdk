import assert from "node:assert/strict";
import test from "node:test";
import { MoguriClient } from "../packages/client/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

// Holds the reply to one snapshot request that was already read, like a slow transport delivering an older refresh late.
class HeldSnapshotClient extends MoguriClient {
  hold?: PromiseWithResolvers<void>;
  held = false;
  protected override async request(path: string, body?: unknown, signal?: AbortSignal, connection = this.connection): Promise<unknown> {
    const response = await super.request(path, body, signal, connection);
    if (path === "/v1/snapshot" && this.hold && !this.held) { this.held = true; await this.hold.promise; }
    return response;
  }
}

test("refresh() reflects changes committed before the call even while an older refresh is still in flight", async () => {
  const f = await setupFixture(), client = new HeldSnapshotClient(f.service.connection), writer = new MoguriClient(f.service.connection);
  try {
    await client.connect(); await writer.connect();
    await waitFor(() => client.getState().status === "connected" && writer.getState().status === "connected");
    client.hold = Promise.withResolvers<void>();
    const older = client.refresh();
    await waitFor(() => client.held);
    const text = "Generated draft committed while an older refresh was in flight.";
    await writer.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: 0, text, attachments: [] });
    const current = client.refresh(), other = client.refresh();
    client.hold.resolve();
    await Promise.all([older, current, other]);
    assert.equal(client.getState().snapshot?.sessions.find((session) => session.id === f.sessionId)?.draft.text, text);
    assert.equal(f.requests.length, 0);
  } finally { client.disconnect(); writer.disconnect(); await f.close(); }
});
