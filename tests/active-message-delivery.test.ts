import assert from "node:assert/strict";
import test from "node:test";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

async function input(sdk: MoguriSdk, id: string, text: string, delivery: "auto" | "queue" | "steer", held = false) {
  const draft = sdk.sessions.get(id)!.draft;
  const saved = await sdk.command({ type: "draft.save", sessionId: id, expectedRevision: draft.revision, text, attachments: [] });
  return sdk.command({ type: "message.send", sessionId: id, expectedRevision: saved.revision!, delivery, held });
}

test("automatic active-turn input targets its current solver instead of cancelling it or entering the future-turn queue", async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); await f.send("generated slow existing owner"); await waitFor(() => f.requests.length === 1);
    const turn = f.session().turnId;
    const live = await input(sdk, f.sessionId, "Generated actual user interjection.", "auto");
    const item = f.session().queue.find((item) => item.id === live.id)!;
    assert.equal(item.delivery, "steer"); assert.equal(item.targetTurnId, turn); assert.equal(item.liveDelivery, true);
    assert.equal(f.session().turnId, turn);
    assert.notEqual(f.session().status, "stopping");
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "turn.stop_requested"), false);
    const queued = await input(sdk, f.sessionId, "Generated explicitly queued later work.", "queue");
    assert.equal(f.session().queue.find((item) => item.id === queued.id)?.delivery, "queue");
    assert.equal(f.requests.length, 1);
  } finally { sdk.disconnect(); await f.close(); }
});

test("late automatic live input becomes the next original turn after successful completion, but an explicit steer keeps its target", async () => {
  const f = await setupFixture({ stream: { chunks: ["Generated finite response."], delayMs: 600 } }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); await f.send("Generated original finite request."); await waitFor(() => f.requests.length === 1);
    const turn = f.session().turnId;
    const late = await input(sdk, f.sessionId, "Generated late automatic interjection.", "auto");
    const explicit = await input(sdk, f.sessionId, "Generated explicit original-target steer.", "steer");
    await waitFor(() => f.requests.length === 2);
    const done = await f.terminal();
    const message = done.messages.find((message) => message.id === late.id)!;
    assert.equal(message.role, "user"); assert.notEqual(message.turnId, turn);
    assert.equal(done.queue.find((item) => item.id === explicit.id)?.targetTurnId, turn);
    assert.equal(done.queue.find((item) => item.id === explicit.id)?.delivery, "steer");
    assert.equal(f.service.controller.events(0).filter((event) => event.event_type === "queue.delivery_changed" && event.payload.messageId === late.id).length, 1);
    assert.equal(f.requests.length, 2);
  } finally { sdk.disconnect(); await f.close(); }
});

test("stop holds automatic live input without creating another model call or converting it into an answer", async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); await f.send("generated slow cancellation owner"); await waitFor(() => f.requests.length === 1);
    const late = await input(sdk, f.sessionId, "Generated unconsumed live input.", "auto");
    await sdk.command({ type: "session.stop", sessionId: f.sessionId }); await f.terminal();
    const item = f.session().queue.find((item) => item.id === late.id)!;
    assert.equal(item.delivery, "steer"); assert.equal(item.held, true);
    assert.equal(f.requests.length, 1);
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "question.answered"), false);
  } finally { sdk.disconnect(); await f.close(); }
});

test("automatic held delivery always remains an undispatched queue item while an explicit invalid held steer is refused", async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); await f.send("generated slow held-delivery owner"); await waitFor(() => f.requests.length === 1);
    const held = await input(sdk, f.sessionId, "Generated held input.", "auto", true);
    const item = f.session().queue.find((item) => item.id === held.id)!;
    assert.equal(item.delivery, "queue"); assert.equal(item.held, true);
    await assert.rejects(() => input(sdk, f.sessionId, "Generated invalid held steer.", "steer", true), { code: "queue_delivery" });
    assert.equal(f.requests.length, 1);
  } finally { sdk.disconnect(); await f.close(); }
});

test("automatic input in an idle session starts the ordinary original turn without a stale active-turn target", async () => {
  const f = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure();
    const sent = await input(sdk, f.sessionId, "Generated idle automatic input.", "auto");
    const completed = await f.terminal();
    assert.equal(completed.messages.find((message) => message.id === sent.id)?.role, "user");
    const event = f.service.controller.events(0).find((event) => event.event_type === "queue.enqueued" && event.payload.item.id === sent.id);
    assert.equal(event?.event_type === "queue.enqueued" ? event.payload.item.delivery : undefined, "queue");
    assert.equal(f.requests.length, 1);
  } finally { sdk.disconnect(); await f.close(); }
});
