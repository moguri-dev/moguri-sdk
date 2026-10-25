import test from "node:test";
import assert from "node:assert/strict";
import { setupFixture, waitFor } from "./fixture.ts";
import { tools } from "../apps/service/src/tools.ts";

test("SQL todo/memory writes use canonical domain events and actual model provenance", { timeout: 15000 }, async () => {
  assert.ok(tools.some((tool) => tool.name === "mutate_state"), "The domain-backed SQL capability is missing.");
  const f = await setupFixture({ stateSql: true });
  try {
    await f.configure(); await f.send("generated state sql");
    await waitFor(() => f.session().pendingApproval?.call.name === "query_state"); await f.approve();
    await waitFor(() => f.session().pendingApproval?.call.name === "mutate_state"); await f.approve();
    await f.terminal();
    assert.equal(f.session().taskPlan?.title, "Generated SQL task plan");
    assert.equal(f.session().taskPlan?.steps.length, 2);
    const note = f.service.controller.snapshot().knowledge.find((note) => note.id === "generated-note");
    assert.ok(note);
    assert.equal(note.tier, "Sky"); assert.equal(note.sessionId, f.sessionId);
    assert.equal(note.modelSource?.actor, "model");
    assert.equal(f.service.controller.snapshot().settings.values.memory.useTieredContext, false);
    assert.deepEqual(f.service.store.db.prepare("SELECT name FROM sqlite_schema WHERE name IN ('todos','memories')").all(), []);
    assert.equal(f.requests.length, 3);
  } finally { await f.close(); }
});
