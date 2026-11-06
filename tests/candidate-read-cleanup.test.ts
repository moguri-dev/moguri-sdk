import test from "node:test";
import assert from "node:assert/strict";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";
import { holdRemoteFrame } from "./fixtures/remote-frame-gate.ts";
import { isRecord } from "../packages/protocol/src/index.ts";
import { waitFor } from "./fixture.ts";

test("non-Git SSH eligibility observes the actual failed worker terminal and closes without an unconfirmed read owner", { timeout: 20000 }, async () => {
  const f = await remoteFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.probe(); await f.select(); await sdk.refresh();
    const result = await sdk.candidates.eligibility(f.sessionId);
    assert.equal(result.eligible, false); assert.match(result.diagnostic!, /git|repository/i);
    const records = f.service.controller.platform.candidateEnvs.transports.records();
    assert.equal(records.length, 1); assert.equal(records[0]!.ownerKind, "read");
    assert.equal(records[0]!.cleanupConfirmed, true); assert.equal(records[0]!.terminalAcknowledged, true);
    assert.equal(records[0]!.status, "partial");
    assert.equal(f.requests.length, 0); assert.equal(f.service.controller.snapshot().budgetEntries.length, 0);
    await f.service.close();
  } finally { sdk.disconnect(); await f.close(); }
});

for (const closing of [false, true]) test(`SSH eligibility scope refusal drains exact terminal receipts ${closing ? "during context close" : "before context close"} without a Local Git fallback`, { timeout: 25000 }, async (t) => {
  const f = await remoteFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  let gate: ReturnType<typeof holdRemoteFrame> | undefined, close: Promise<void> | undefined;
  try {
    await f.probe(); await f.select(); await sdk.refresh();
    gate = holdRemoteFrame(t, f.service.controller.remote, "candidate.boundary", (request) => isRecord(request) && request.phase === "operation");
    const pending = sdk.candidates.eligibility(f.sessionId).then((value) => ({ value }), (error: unknown) => ({ error }));
    await waitFor(() => gate!.held, 10000);
    await sdk.sessions.configure(f.sessionId, { ...f.session().controls, env: "Local", modelId: f.modelId });
    const local = t.mock.method(f.service.controller.platform.managed, "project", () => { throw new Error("Old SSH eligibility must not resolve the new Local root."); });
    if (closing) { close = f.service.close(); void close.catch(() => {}); }
    gate.release();
    const result = await pending;
    if (!closing) { assert.ok("value" in result); assert.equal(result.value.eligible, false); }
    if (close) await close;
    const records = f.service.controller.platform.candidateEnvs.transports.records();
    assert.equal(records.length, 1);
    assert.equal(records[0]!.cleanupConfirmed, true, JSON.stringify(records[0]));
    assert.equal(records[0]!.terminalAcknowledged, true);
    assert.equal(records[0]!.status, "partial");
    assert.equal(records[0]!.resultDigest, null);
    assert.ok(records[0]!.sequence > 0);
    assert.match(records[0]!.diagnostic!, /original Env|original candidate authority/i);
    assert.equal(local.mock.callCount(), 0); local.mock.restore();
    assert.equal(f.requests.length, 0);
    if (!close) await f.service.close();
  } finally {
    gate?.release(); gate?.restore(); t.mock.restoreAll(); sdk.disconnect();
    await close?.catch(() => {});
    try { await f.close(); }
    catch (error) {
      await f.service.controller.remote.close();
      await f.service.close().catch(() => {});
      await f.ssh.close();
      await f.close().catch(() => {});
      throw error;
    }
  }
});
