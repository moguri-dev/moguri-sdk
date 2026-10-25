import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { setupFixture } from "./fixture.ts";
import { writeLegacyState, assertCurrentSchema } from "./fixtures/legacy-state.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { startService } from "../apps/service/src/server.ts";

test("schema 56 upgrades without changing controls, drafts, receipts or existing event identities", async () => {
  const f = await setupFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await f.service.controller.dispatch({ ...envelope({ type: "draft.save", sessionId: f.sessionId, expectedRevision: 0, text: "Generated preserved schema-56 draft.", attachments: [] }), id: "generated-schema-56-command" });
    const events = f.service.controller.events(0).map((event) => event.id), controls = structuredClone(f.session().controls);
    await writeLegacyState(f.service, 56);
    restarted = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    assertCurrentSchema(restarted.store);
    assert.deepEqual(restarted.controller.events(0).slice(0, events.length).map((event) => event.id), events);
    const session = restarted.controller.snapshot().sessions.find((session) => session.id === f.sessionId)!;
    assert.equal(session.draft.text, "Generated preserved schema-56 draft."); assert.deepEqual(session.controls, controls);
    assert.ok(restarted.store.db.prepare("SELECT id FROM receipts WHERE id=?").get("generated-schema-56-command"));
    assert.equal(f.requests.length, 0);
  } finally { await restarted?.close(); await f.close(); }
});

test("original tool sources and independently granted child snapshots survive restart without model or effect replay", async () => {
  const f = await setupFixture({ toolCall: { name: "read_file", args: { path: "fixture.txt" } } });
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await f.configure(); await f.send("Generated retained original file."); await f.approve(); await f.terminal();
    const event = f.service.controller.events(0).find((event) => event.event_type === "tool.completed" && event.payload.call.name === "read_file");
    if (event?.event_type !== "tool.completed") assert.fail("Missing original retained source.");
    const child = await f.service.controller.dispatch(envelope({ type: "session.spawn", sessionId: f.sessionId, kind: "side" }));
    const count = f.requests.length;
    await f.service.close();
    restarted = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    const source = await restarted.controller.platform.query({ type: "tooling.result", sessionId: f.sessionId, input: { stepId: event.step_id!, callId: event.payload.call.id } });
    if (source.type !== "tooling.result") assert.fail("Missing original source response.");
    assert.equal(source.text, "generated original\n"); assert.equal(source.rawComplete, true);
    const snapshot = await restarted.controller.platform.query({ type: "coordination.read", sessionId: child.id!, input: { action: "snapshot" } });
    if (snapshot.type !== "coordination.read" || snapshot.data.action !== "snapshot") assert.fail("Missing original parent snapshot.");
    assert.match(snapshot.data.text, /Generated retained original file/);
    assert.equal(f.requests.length, count);
    assert.ok(restarted.store.db.prepare("SELECT value FROM retention_metadata WHERE id='lean_tooling_schema'").get());
  } finally { await restarted?.close(); await f.close(); }
});
