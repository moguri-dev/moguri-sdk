import assert from "node:assert/strict";
import { test } from "node:test";
import { ControlPlane, envelope } from "../apps/service/src/controller.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { join } from "node:path";
import { fixtureProvider, setupFixture } from "./fixture.ts";

test("restart preserves drafts and queued messages, marks interrupted work partial, and never replays effects", async () => {
  const fixture = await setupFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await fixture.service.controller.dispatch(envelope({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "generated surviving draft", attachments: [] }));
    const stateDir = join(fixture.directory, "state");
    await fixture.service.close();
    const store = new EventStore(join(stateDir, "state.sqlite"));
    const scope = { profile_id: "default", project_id: fixture.session().projectId, session_id: fixture.sessionId };
    store.commit([
      { ...scope, event_type: "queue.enqueued", payload: { item: { id: "generated-claimed", text: "generated interrupted operation", attachments: [], delivery: "queue" } } },
      { ...scope, turn_id: "generated-turn", event_type: "turn.started", payload: { item: { id: "generated-claimed", text: "generated interrupted operation", attachments: [], delivery: "queue" }, controls: fixture.session().controls, policyRevision: 0 } },
      { ...scope, turn_id: "generated-turn", step_id: "generated-step", event_type: "model.started", payload: { modelId: fixture.modelId } },
      { ...scope, event_type: "queue.enqueued", payload: { item: { id: "generated-queued", text: "generated preserved queue", attachments: [], delivery: "queue" } } },
    ]);
    store.close();
    restarted = await startService({ stateDir, provider: fixture.provider });
    const session = restarted.controller.snapshot().sessions.find((session) => session.id === fixture.sessionId)!;
    assert.equal(session.turnId, null);
    assert.equal(session.draft.text, "generated surviving draft");
    assert.equal(session.queue[0]?.id, "generated-queued");
    assert.equal(session.status, "waiting_input");
    assert.match(session.lastError!, /Resume/);
    assert.equal(session.usage[0]?.quality, "unknown");
    assert.equal(session.usage[0]?.outcome, "unconfirmed");
    assert.ok(restarted.controller.events(0).some((event) => event.event_type === "turn.finished" && event.payload.outcome === "partial"));
    assert.equal(fixture.requests.length, 0);
  } finally { await restarted?.close(); await fixture.close(); }
});

test("event replay projections do not mutate the immutable enqueue event", async () => {
  const fixture = await fixtureProvider();
  const store = new EventStore(":memory:");
  const controller = new ControlPlane(store, fixture.provider);
  try {
    store.commit([
      { event_type: "project.added", profile_id: "default", project_id: "p", payload: { project: { id: "p", name: "generated", path: "/generated" } } },
      { event_type: "session.created", profile_id: "default", project_id: "p", session_id: "s", payload: { title: "generated", controls: { env: "Local", modelId: null, autonomy: "Manual", budget: { kind: "unlimited" } } } },
      { event_type: "queue.enqueued", profile_id: "default", project_id: "p", session_id: "s", payload: { item: { id: "q", text: "generated original", attachments: [], delivery: "queue" } } },
      { event_type: "queue.edited", profile_id: "default", project_id: "p", session_id: "s", payload: { messageId: "q", text: "generated edited" } },
    ]);
    const { projectEvents } = await import("../packages/protocol/src/index.ts");
    const events = store.events();
    assert.equal(projectEvents(events).sessions[0]?.queue[0]?.text, "generated edited");
    const enqueued = events.find((event) => event.event_type === "queue.enqueued");
    if (enqueued?.event_type === "queue.enqueued") assert.equal(enqueued.payload.item.text, "generated original");
    assert.equal(projectEvents(events).sessions[0]?.queue[0]?.text, "generated edited");
  } finally { await controller.close(); store.close(); await fixture.close(); }
});
