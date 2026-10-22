import assert from "node:assert/strict";
import { test } from "node:test";
import { winddownApiFixture } from "./fixtures/winddown-api.ts";

test("a new hard cap one token below total actual/held capacity cannot dispatch the held finishing model or refund the ordinary call", { skip: process.platform !== "darwin", timeout: 15000 }, async () => {
  const f = await winddownApiFixture({ capDelta: -1 });
  try {
    const value = await f.run();
    assert.equal(value.winddown.status, "unavailable");
    assert.equal(f.requests.length, 1); assert.equal(f.solver.requests.length, 0); assert.equal(f.checkpoint.requests.length, 0);
    assert.equal(f.service.controller.snapshot().budgetEntries.length, 1);
    assert.equal(f.service.controller.snapshot().budgetEntries[0]?.reportedTokens, 42);
    assert.equal(f.service.controller.snapshot().budgetPlans.find((plan) => plan.role === "checkpoint")?.status, "released");
    assert.equal(value.winddown.commit, null);
  } finally { await f.close(); }
});

test("unreported finishing usage remains partial and held, never a ready checkpoint or permission for a Git call", { skip: process.platform !== "darwin", timeout: 15000 }, async () => {
  const f = await winddownApiFixture();
  try {
    Object.assign(f.checkpointOptions, { omitUsage: true });
    const value = await f.run(), status = (await f.sdk.budgets.status(f.sessionId)).status;
    assert.equal(value.winddown.status, "partial"); assert.equal(value.winddown.commit, null);
    assert.equal(f.requests.length, 1); assert.equal(f.checkpoint.requests.length, 1);
    assert.equal(status.totals.reportedTokens, null); assert.equal(status.totals.knownReportedTokens, 42); assert.ok(status.totals.heldTokens! > 0);
    await assert.rejects(() => f.sdk.winddown.commitPreview({ winddownId: value.winddown.id, sessionId: f.sessionId, candidateIds: ["generated-unaccepted"],
      branch: "moguri/generated-no-free-checkpoint", message: "Generated unknown result is not authority" }), /complete|ready|partial|known/i);
  } finally { await f.close(); }
});
