import test from "node:test";
import assert from "node:assert/strict";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";
import { waitFor } from "./fixture.ts";

test("the same compaction API executes its actual bounded model call through the pinned SSH worker", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const f = await remoteFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.probe(); await f.select();
    for (let turn = 0; turn < 3; turn++) {
      await f.send(`Generated remote compaction turn ${turn}. ` + "Generated retained remote detail. ".repeat(160));
      assert.equal((await f.terminal()).status, "completed");
      await waitFor(() => f.controller.snapshot().executions.every((execution) => execution.cleanup === "owned-worker-stopped"));
    }
    const preview = (await sdk.compactions.preview(f.sessionId, { keepRecentTurns: 1 })).preview;
    const request = await sdk.compactions.generate(f.sessionId, preview, true); await f.terminal();
    const row = (await sdk.compactions.state(f.sessionId)).compactions.find((entry) => entry.id === request.id)!;
    assert.equal(row.status, "proposed"); assert.equal(row.env, "Remote");
    const execution = await waitFor(() => f.controller.snapshot().executions.find((execution) => execution.turnId === row.turnId && execution.cleanup === "owned-worker-stopped"));
    assert.equal(execution.workspace, f.workspace); assert.equal(execution.target.hostKey, f.ssh.target.hostKey);
    assert.ok(execution.workerPid);
    const call = (await sdk.budgets.calls({ role: "compaction" })).calls[0]!;
    assert.equal(call.env, "Remote"); assert.equal(call.reportedTokens, 42);
    assert.equal(f.requests.length, 4); assert.equal(f.requests[3]?.tools, undefined);
    await sdk.compactions.apply(f.sessionId, row.id, row.revision);
    assert.equal((await sdk.compactions.state(f.sessionId)).activeId, row.id);
    assert.equal(f.controller.snapshot().sessions[0]?.controls.env, "Remote");
  } finally { sdk.disconnect(); await f.close(); }
});
