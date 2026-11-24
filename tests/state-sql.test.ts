import test from "node:test";
import assert from "node:assert/strict";
import { reviewNativeTools, setupFixture, waitFor } from "./fixture.ts";
import { tools } from "../apps/service/src/tools.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("a rejected memory promotion cannot partially publish a prepared todo plan", { timeout: ciTime(15000) }, async () => {
  const f = await setupFixture({ stateSql: true, stateSqlStatements: [
    { sql: "INSERT INTO todos(id,text,status) VALUES(1,'Generated first','pending'),(2,'Generated second','pending')" },
    { sql: "INSERT INTO memories(id,title,text,tier) VALUES('generated-forbidden','Generated','Never promote automatically','Terra')" },
  ] });
  try {
    await f.configure(); await f.send("generated state sql"); await f.terminal();
    assert.equal(f.session().pendingApproval, null);
    assert.equal(f.session().taskPlan, undefined);
    assert.equal(f.service.controller.snapshot().knowledge.length, 0);
    assert.ok(f.service.controller.events(0).some((event) => event.event_type === "tool.completed" && event.payload.call.name === "mutate_state" && event.payload.isError && /promotion|Sky/.test(event.payload.text)));
  } finally { await f.close(); }
});

test("a concurrent actual-user note edit invalidates the entire source-bound SQL mutation", { timeout: ciTime(15000) }, async () => {
  const f = await setupFixture({ stateSql: true }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await reviewNativeTools(f, ["mutate_state"]);
    await f.configure(); await f.send("generated state sql");
    await waitFor(() => f.session().pendingApproval?.call.name === "mutate_state");
    await sdk.knowledge.save({ tier: "Sky", sessionId: f.sessionId, lifetime: "session", title: "Generated user note", text: "Actual generated user source edit." });
    await f.approve(); await f.terminal();
    assert.equal(f.session().taskPlan, undefined);
    assert.equal(f.service.controller.snapshot().knowledge.length, 1);
    assert.ok(f.service.controller.events(0).some((event) => event.event_type === "tool.completed" && event.payload.call.name === "mutate_state" && event.payload.isError && /source changed/.test(event.payload.text)));
    assert.equal(f.service.controller.snapshot().settings.values.memory.useTieredContext, false);
  } finally { sdk.disconnect(); await f.close(); }
});

test("SQL todo/memory writes use canonical domain events and actual model provenance", { timeout: ciTime(15000) }, async () => {
  assert.ok(tools.some((tool) => tool.name === "mutate_state"), "The domain-backed SQL capability is missing.");
  const f = await setupFixture({ stateSql: true });
  try {
    await f.configure(); await f.send("generated state sql");
    await f.terminal();
    assert.equal(f.session().pendingApproval, null);
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
