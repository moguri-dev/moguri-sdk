import test from "node:test";
import assert from "node:assert/strict";
import { setupFixture, waitFor, type GeneratedProviderOptions } from "./fixture.ts";
import { envelope } from "../apps/service/src/controller.ts";

test("birth grants support bidirectional messages without inference or navigation-based authority", async () => {
  const f = await setupFixture();
  try {
    const created = await f.service.controller.dispatch(envelope({ type: "session.spawn", sessionId: f.sessionId, kind: "side" }));
    const childId = created.id!;
    const read = () => f.service.controller.platform.query({ type: "coordination.read", sessionId: f.sessionId, input: { action: "inspect", targetSessionId: childId } });
    assert.equal((await read()).type, "coordination.read");
    const message = await f.service.controller.dispatch(envelope({ type: "coordination.message", sessionId: childId, input: { targetSessionId: f.sessionId, text: "Generated child observation." } }));
    assert.ok(message.id);
    assert.equal(f.requests.length, 0);
    assert.ok(f.session().messages.some((item) => item.role === "notice" && item.text.includes("Generated child observation.")));
    const child = f.service.controller.snapshot().sessions.find((session) => session.id === childId)!;
    await f.service.controller.dispatch(envelope({ type: "session.organize", sessionId: childId, expectedRevision: child.revision, changes: { parentSessionId: null } }));
    assert.equal((await read()).type, "coordination.read");
    const stranger = await f.service.controller.dispatch(envelope({ type: "session.create", projectId: f.session().projectId }));
    await assert.rejects(() => f.service.controller.platform.query({ type: "coordination.read", sessionId: stranger.id!, input: { action: "transcript", targetSessionId: childId } }), { code: "coordination_denied" });
    await assert.rejects(() => f.service.controller.dispatch(envelope({ type: "coordination.control", sessionId: childId, input: { action: "dispatch", targetSessionId: f.sessionId, text: "Forbidden escalation" } })), { code: "coordination_denied" });
    const preview = await f.service.controller.platform.query({ type: "coordination.preview", sessionId: f.sessionId, childId });
    if (preview.type !== "coordination.preview") assert.fail("Missing exact grant preview.");
    await f.service.controller.dispatch(envelope({ type: "coordination.grant", sessionId: f.sessionId, childId, expectedDigest: preview.digest, enabled: false, confirm: true }));
    await assert.rejects(read, { code: "coordination_changed" });
  } finally { await f.close(); }
});

test("coordinated agent tasks retain origin and charge the owning task once", { timeout: 10000 }, async () => {
  const f = await setupFixture({ responseMode: "text" });
  try {
    await f.configure();
    const created = await f.service.controller.dispatch(envelope({ type: "session.spawn", sessionId: f.sessionId, kind: "agent" }));
    const childId = created.id!;
    await f.service.controller.dispatch(envelope({ type: "coordination.control", sessionId: f.sessionId,
      input: { action: "dispatch", targetSessionId: childId, text: "Generated bounded child task." } }));
    const child = await waitFor(() => {
      const child = f.service.controller.snapshot().sessions.find((item) => item.id === childId);
      return child && !child.turnId && child.status === "completed" ? child : false;
    });

    assert.ok(child.messages.some((message) => message.role === "notice" && message.text.includes("Generated bounded child task.")));
    assert.equal(f.service.controller.platform.budgets.status(childId).ownerSessionId, f.sessionId);
    assert.equal(f.service.controller.platform.budgets.status(f.sessionId).totals.reportedTokens, 42);
    assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});

test("a coordinated child cannot bypass its own stricter session cap", { timeout: 10000 }, async () => {
  const f = await setupFixture({ responseMode: "text" });
  try {
    await f.configure();
    const created = await f.service.controller.dispatch(envelope({ type: "session.spawn", sessionId: f.sessionId, kind: "agent" }));
    const child = f.service.controller.snapshot().sessions.find((session) => session.id === created.id)!;
    await f.service.controller.dispatch(envelope({ type: "session.configure", sessionId: child.id, expectedRevision: child.revision,
      controls: { ...child.controls, budget: { kind: "limited", tokens: 1, basis: "estimate" } } }));
    await f.service.controller.dispatch(envelope({ type: "coordination.control", sessionId: f.sessionId, input: { action: "dispatch", targetSessionId: child.id, text: "Generated capped task." } }));
    await waitFor(() => {
      const current = f.service.controller.snapshot().sessions.find((session) => session.id === child.id)!;
      return !current.turnId && ["completed", "failed", "partial"].includes(current.status);
    });

    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("an actual model coordinator yields its writer, observes the child and resumes without duplicate charges", { timeout: 15000 }, async () => {
  const options: GeneratedProviderOptions = {}, f = await setupFixture(options);
  try {
    await f.configure();
    const child = await f.service.controller.dispatch(envelope({ type: "session.spawn", sessionId: f.sessionId, kind: "agent" }));
    options.coordinationChildId = child.id!;
    await f.send("generated coordinate parent");
    await f.approve(); await f.approve();
    const parent = await f.terminal(), state = f.service.controller.snapshot();
    assert.equal(parent.status, "completed");
    assert.equal(state.sessions.find((session) => session.id === child.id)?.status, "completed");
    assert.equal(f.requests.length, 4);
    assert.equal(f.service.controller.platform.budgets.status(parent.id).totals.reportedTokens, 4 * 42);
    assert.ok(state.coordinationMessages.some((message) => message.kind === "task" && message.origin.actor === "model" && message.deliveredTo));
    assert.ok(state.coordinationMessages.some((message) => message.kind === "result" && message.origin.actor === "service" && message.deliveredTo));
  } finally { await f.close(); }
});
