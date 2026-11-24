import { ciTime } from "./fixtures/time-scale.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { envelope } from "../apps/service/src/controller.ts";
import { reviewNativeTools, setupFixture, waitFor } from "./fixture.ts";

const mac = { skip: process.platform !== "darwin", timeout: ciTime(20_000) };
test("a steer is applied only at the next boundary of its owning turn", mac, async () => {
  const fixture = await setupFixture();
  try {
    await reviewNativeTools(fixture, ["read_file"]);
    await fixture.configure();
    await fixture.send("generated tool task");
    await waitFor(() => fixture.session().pendingApproval);
    const originalTurn = fixture.session().turnId;
    await fixture.send("generated steering instruction", "steer");
    assert.equal(fixture.session().queue[0]?.targetTurnId, originalTurn);
    await fixture.approve();
    await fixture.terminal();
    const applied = fixture.service.controller.events(0).find((event) => event.event_type === "steer.applied");
    assert.equal(applied?.turn_id, originalTurn);
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "turn.started").length, 1);
    assert.equal(fixture.session().queue.length, 0);
  } finally { await fixture.close(); }
});
test("a steer that misses its boundary stays unapplied until explicitly converted to a new turn", mac, async () => {
  const fixture = await setupFixture();
  try {
    await fixture.configure();
    await fixture.send("generated delayed task");
    await waitFor(() => fixture.requests.length === 1);
    await fixture.send("generated unapplied steer", "steer");
    await fixture.terminal();
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.session().queue.length, 1);
    const item = fixture.session().queue[0]!;
    await assert.rejects(() => fixture.service.controller.dispatch(envelope({ type: "session.resume", sessionId: fixture.sessionId })), /unapplied steer/i);
    await fixture.service.controller.dispatch(envelope({ type: "queue.make-turn", sessionId: fixture.sessionId, messageId: item.id, expectedRevision: fixture.session().queueRevision }));
    await waitFor(() => fixture.requests.length === 2 && fixture.session().status === "completed");
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "steer.applied").length, 0);
    assert.equal(fixture.session().queue.length, 0);
  } finally { await fixture.close(); }
});
test("Interrupt admits its message after acknowledged cancellation, ahead of ordinary queued work", mac, async () => {
  const fixture = await setupFixture();
  try {
    await fixture.configure();
    await fixture.send("generated slow task");
    await waitFor(() => fixture.requests.length === 1);
    await fixture.send("generated older queued task");
    await fixture.send("generated urgent interrupt", "interrupt");
    await waitFor(() => fixture.session().status === "completed" && fixture.session().queue.length === 0);
    const starts = fixture.service.controller.events(0).filter((event) => event.event_type === "turn.started");
    assert.deepEqual(starts.map((event) => event.event_type === "turn.started" ? event.payload.item.text : ""), [
      "generated slow task", "generated urgent interrupt", "generated older queued task",
    ]);
    const ack = fixture.service.controller.events(0).find((event) => event.event_type === "turn.stop_acknowledged")!;
    assert.ok(ack.seq < starts[1]!.seq);
  } finally { await fixture.close(); }
});
test("unconfirmed worker failure pauses the workspace and does not consume or automatically retry queued work", mac, async () => {
  const fixture = await setupFixture({ workerPath: resolve(".moguri/generated-missing-worker.mjs") });
  try {
    await fixture.configure();
    await fixture.send("generated interrupted task");
    await fixture.send("generated preserved queued task");
    await waitFor(() => fixture.session().status === "partial");
    assert.equal(fixture.session().queue.length, 1);
    assert.equal(fixture.requests.length, 0);
    assert.ok(fixture.service.controller.snapshot().blockedProjects.includes(fixture.session().projectId));
    await assert.rejects(() => fixture.send("generated must not start"), /Inspect the workspace/);
    assert.equal(fixture.session().draft.text, "generated must not start");
    const item = fixture.session().queue[0]!;
    await fixture.service.controller.dispatch(envelope({ type: "queue.remove", sessionId: fixture.sessionId, messageId: item.id, expectedRevision: fixture.session().queueRevision }));
    await fixture.service.controller.dispatch(envelope({ type: "session.resume", sessionId: fixture.sessionId }));
    assert.equal(fixture.session().status, "idle");
    assert.equal(fixture.service.controller.snapshot().blockedProjects.length, 0);
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});
