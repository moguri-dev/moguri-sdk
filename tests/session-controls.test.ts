import assert from "node:assert/strict";
import test from "node:test";
import { setupFixture, waitFor } from "./fixture.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { previewSessionBulk } from "../apps/service/src/session-bulk.ts";
import { MoguriSdk, retryFailure } from "../packages/sdk/src/index.ts";
import { GeneratedIntakeClock } from "./fixtures/intake-clock.ts";

test("exact peer review permits messages without granting ancestry, execution or an automatic paid reply", async () => {
  const f = await setupFixture();
  try {
    const created = await f.service.controller.dispatch(envelope({ type: "session.create", projectId: f.session().projectId, title: "Generated peer" }));
    const target = created.id!;
    await assert.rejects(() => f.service.controller.dispatch(envelope({ type: "coordination.message", sessionId: f.sessionId, input: { targetSessionId: target, text: "Generated advisory" } })), { code: "coordination_denied" });
    const review = await f.service.controller.platform.query({ type: "coordination.preview", sessionId: f.sessionId, childId: target });
    assert.equal(review.type, "coordination.preview");
    if (review.type !== "coordination.preview") assert.fail();
    assert.equal(review.kind, "peer");
    await f.service.controller.dispatch(envelope({ type: "coordination.grant", sessionId: f.sessionId, childId: target, expectedDigest: review.digest, enabled: true, confirm: true }));
    await f.service.controller.dispatch(envelope({ type: "coordination.message", sessionId: target, input: { targetSessionId: f.sessionId, text: "Generated original peer advisory" } }));
    assert.equal(f.requests.length, 0);
    assert.equal(f.service.controller.snapshot().coordinationMessages[0]?.origin.actor, "user");
    await assert.rejects(() => f.service.controller.dispatch(envelope({ type: "coordination.control", sessionId: f.sessionId, input: { action: "dispatch", targetSessionId: target, text: "Forbidden execution" } })), { code: "coordination_denied" });
    const reverse = await f.service.controller.platform.query({ type: "coordination.preview", sessionId: target, childId: f.sessionId });
    if (reverse.type !== "coordination.preview") assert.fail();
    await f.service.controller.dispatch(envelope({ type: "coordination.grant", sessionId: target, childId: f.sessionId, expectedDigest: reverse.digest, enabled: false, confirm: true }));
    await assert.rejects(() => f.service.controller.dispatch(envelope({ type: "coordination.message", sessionId: target, input: { targetSessionId: f.sessionId, text: "Revoked advisory" } })), { code: "coordination_changed" });
  } finally { await f.close(); }
});

test("wait captures one exact held prerequisite, refuses cycles and releases only after actual success", async () => {
  const f = await setupFixture({ responseMode: "text" });
  try {
    await f.configure();
    const target = (await f.service.controller.dispatch(envelope({ type: "session.create", projectId: f.session().projectId, title: "Generated prerequisite", overrides: { ...f.session().controls } }))).id!;
    const draft = async (id: string, text: string, held = true) => {
      const current = f.service.controller.snapshot().sessions.find((session) => session.id === id)!;
      await f.service.controller.dispatch(envelope({ type: "draft.save", sessionId: id, expectedRevision: current.draft.revision, text, attachments: [] }));
      const saved = f.service.controller.snapshot().sessions.find((session) => session.id === id)!;
      await f.service.controller.dispatch(envelope({ type: "message.send", sessionId: id, expectedRevision: saved.draft.revision, delivery: "queue", held }));
    };
    await draft(target, "Generated exact held prerequisite");
    const review = await f.service.controller.platform.query({ type: "session.wait.preview", sessionId: f.sessionId, targetSessionId: target });
    if (review.type !== "session.wait.preview") assert.fail();
    assert.equal(review.preview.task.kind, "queue");
    await f.service.controller.dispatch(envelope({ type: "session.wait", sessionId: f.sessionId, targetSessionId: target, expectedDigest: review.preview.digest, confirm: true }));
    await draft(f.sessionId, "Generated dependent task", false);
    await assert.rejects(() => f.service.controller.platform.query({ type: "session.wait.preview", sessionId: target, targetSessionId: f.sessionId }), { code: "session_wait_cycle" });
    assert.equal(f.requests.length, 0);
    const queued = f.service.controller.snapshot().sessions.find((session) => session.id === target)!;
    await f.service.controller.dispatch(envelope({ type: "queue.release", sessionId: target, messageId: queued.queue[0]!.id, expectedRevision: queued.queueRevision }));
    await waitFor(() => f.session().wait?.status === "released");
    await f.terminal();
    assert.equal(f.requests.length, 2);
    assert.equal(f.session().status, "completed");
  } finally { await f.close(); }
});

test("removed prerequisite and stale reviews never substitute another task or release dependent prompts", async () => {
  const f = await setupFixture();
  try {
    const target = (await f.service.controller.dispatch(envelope({ type: "session.create", projectId: f.session().projectId }))).id!;
    const current = () => f.service.controller.snapshot().sessions.find((session) => session.id === target)!;
    await f.service.controller.dispatch(envelope({ type: "draft.save", sessionId: target, expectedRevision: 0, text: "Generated held prerequisite", attachments: [] }));
    await f.service.controller.dispatch(envelope({ type: "message.send", sessionId: target, expectedRevision: current().draft.revision, delivery: "queue", held: true }));
    const read = () => f.service.controller.platform.query({ type: "session.wait.preview", sessionId: f.sessionId, targetSessionId: target });
    const review = await read(); if (review.type !== "session.wait.preview") assert.fail();
    await f.service.controller.dispatch(envelope({ type: "session.organize", sessionId: target, expectedRevision: current().revision, changes: { title: "Generated changed target" } }));
    await assert.rejects(() => f.service.controller.dispatch(envelope({ type: "session.wait", sessionId: f.sessionId, targetSessionId: target, expectedDigest: review.preview.digest, confirm: true })), { code: "session_wait_stale" });
    const fresh = await read(); if (fresh.type !== "session.wait.preview") assert.fail();
    await f.service.controller.dispatch(envelope({ type: "session.wait", sessionId: f.sessionId, targetSessionId: target, expectedDigest: fresh.preview.digest, confirm: true }));
    await f.service.controller.dispatch(envelope({ type: "queue.remove", sessionId: target, messageId: current().queue[0]!.id, expectedRevision: current().queueRevision }));
    f.service.controller.wake();
    await waitFor(() => f.session().wait?.status === "blocked");
    assert.match(f.session().wait!.diagnostic!, /removed/);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("bulk attach/detach is homogeneous and rejects the whole changed selection before any hierarchy event", async () => {
  const f = await setupFixture();
  try {
    const a = (await f.service.controller.dispatch(envelope({ type: "session.create", projectId: f.session().projectId }))).id!;
    const b = (await f.service.controller.dispatch(envelope({ type: "session.create", projectId: f.session().projectId }))).id!;
    const input = { action: "attach" as const, sessionIds: [a, b], targetSessionId: f.sessionId };
    const review = previewSessionBulk(f.service.controller.snapshot(), input);
    const changed = f.service.controller.snapshot().sessions.find((session) => session.id === b)!;
    await f.service.controller.dispatch(envelope({ type: "session.organize", sessionId: b, expectedRevision: changed.revision, changes: { title: "Generated later change" } }));
    await assert.rejects(() => f.service.controller.dispatch(envelope({ type: "sessions.bulk", input, expectedDigest: review.digest, confirm: true })), { code: "session_bulk_stale" });
    assert.equal(f.service.controller.snapshot().sessions.find((session) => session.id === a)?.parentSessionId, undefined);
    const fresh = previewSessionBulk(f.service.controller.snapshot(), input);
    await f.service.controller.dispatch(envelope({ type: "sessions.bulk", input, expectedDigest: fresh.digest, confirm: true }));
    assert.ok(f.service.controller.snapshot().sessions.filter((session) => [a, b].includes(session.id)).every((session) => session.parentSessionId === f.sessionId));
    const detach = { action: "detach" as const, sessionIds: [a, b] };
    const detached = previewSessionBulk(f.service.controller.snapshot(), detach);
    await f.service.controller.dispatch(envelope({ type: "sessions.bulk", input: detach, expectedDigest: detached.digest, confirm: true }));
    const one = f.service.controller.snapshot().sessions.find((session) => session.id === a)!;
    await f.service.controller.dispatch(envelope({ type: "session.organize", sessionId: a, expectedRevision: one.revision, changes: { parentSessionId: f.sessionId } }));
    assert.throws(() => previewSessionBulk(f.service.controller.snapshot(), input), { code: "session_bulk_homogeneous" });
    assert.throws(() => previewSessionBulk(f.service.controller.snapshot(), detach), { code: "session_bulk_homogeneous" });
  } finally { await f.close(); }
});

test("bulk archive and delete settle selected roots and commit one complete lifecycle set", async () => {
  const f = await setupFixture();
  try {
    const a = (await f.service.controller.dispatch(envelope({ type: "session.create", projectId: f.session().projectId }))).id!;
    const b = (await f.service.controller.dispatch(envelope({ type: "session.create", projectId: f.session().projectId }))).id!;
    const input = { action: "archive" as const, sessionIds: [a, b] };
    const preview = previewSessionBulk(f.service.controller.snapshot(), input);
    await f.service.controller.dispatch(envelope({ type: "sessions.bulk", input, expectedDigest: preview.digest, confirm: true }));
    assert.ok(f.service.controller.snapshot().sessions.filter((session) => [a, b].includes(session.id)).every((session) => session.status === "archived"));
    const deletion = { action: "delete" as const, sessionIds: [a, b] };
    const reviewed = previewSessionBulk(f.service.controller.snapshot(), deletion);
    await f.service.controller.dispatch(envelope({ type: "sessions.bulk", input: deletion, expectedDigest: reviewed.digest, confirm: true }));
    assert.equal(f.service.controller.snapshot().sessions.some((session) => [a, b].includes(session.id)), false);
    assert.ok(f.service.controller.snapshot().sessions.some((session) => session.id === f.sessionId));
  } finally { await f.close(); }
});

test("explicit Stop cancels only the user's live dependency and holds its undispatched prompt", async () => {
  const f = await setupFixture({ responseMode: "text" });
  try {
    await f.configure();
    const target = (await f.service.controller.dispatch(envelope({ type: "session.create", projectId: f.session().projectId }))).id!;
    const state = () => f.service.controller.snapshot().sessions.find((session) => session.id === target)!;
    await f.service.controller.dispatch(envelope({ type: "draft.save", sessionId: target, expectedRevision: 0, text: "Generated held prerequisite", attachments: [] }));
    await f.service.controller.dispatch(envelope({ type: "message.send", sessionId: target, expectedRevision: state().draft.revision, held: true, delivery: "queue" }));
    const read = await f.service.controller.platform.query({ type: "session.wait.preview", sessionId: f.sessionId, targetSessionId: target });
    if (read.type !== "session.wait.preview") assert.fail();
    await f.service.controller.dispatch(envelope({ type: "session.wait", sessionId: f.sessionId, targetSessionId: target, expectedDigest: read.preview.digest, confirm: true }));
    await f.send("Generated blocked dependent prompt");
    await f.service.controller.dispatch(envelope({ type: "session.stop", sessionId: f.sessionId }));
    assert.equal(f.session().wait?.status, "cancelled");
    assert.equal(f.session().queue.length, 1);
    assert.equal(f.session().queue[0]?.held, true);
    assert.equal(state().queue[0]?.held, true);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

for (const outcome of ["failed", "stopped"] as const) test(`a genuinely ${outcome} prerequisite never releases the dependent task`, async () => {
  const f = await setupFixture({ responseMode: "text" });
  try {
    await f.configure();
    const target = (await f.service.controller.dispatch(envelope({ type: "session.create", projectId: f.session().projectId,
      overrides: { ...f.session().controls } }))).id!;
    const state = () => f.service.controller.snapshot().sessions.find((session) => session.id === target)!;
    await f.service.controller.dispatch(envelope({ type: "draft.save", sessionId: target, expectedRevision: 0,
      text: outcome === "failed" ? "generated provider failure" : "generated delayed", attachments: [] }));
    await f.service.controller.dispatch(envelope({ type: "message.send", sessionId: target, expectedRevision: state().draft.revision, held: true, delivery: "queue" }));
    const read = await f.service.controller.platform.query({ type: "session.wait.preview", sessionId: f.sessionId, targetSessionId: target });
    if (read.type !== "session.wait.preview") assert.fail();
    await f.service.controller.dispatch(envelope({ type: "session.wait", sessionId: f.sessionId, targetSessionId: target, expectedDigest: read.preview.digest, confirm: true }));
    await f.send("Generated dependent must not run");
    await f.service.controller.dispatch(envelope({ type: "queue.release", sessionId: target, expectedRevision: state().queueRevision, messageId: state().queue[0]!.id }));
    if (outcome === "stopped") {
      await waitFor(() => f.requests.length === 1);
      await f.service.controller.dispatch(envelope({ type: "session.stop", sessionId: target }));
    }
    await waitFor(() => f.session().wait?.status === "blocked");
    assert.match(f.session().wait!.diagnostic!, new RegExp(`ended ${outcome}`));
    assert.equal(f.session().queue.length, 1);
    assert.equal(f.session().turnId, null);
    assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});

test("a captured headless queued command releases its dependent only after the exact command completes", async () => {
  const f = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure();
    const target = (await sdk.sessions.create(f.session().projectId, "Generated command prerequisite")).id!;
    await sdk.command({ type: "draft.save", sessionId: target, text: "/session-id", attachments: [], expectedRevision: 0 });
    await sdk.commands.submit(target, { client: "cli", expectedDraftRevision: sdk.sessions.get(target)!.draft.revision, delivery: "queue", held: true });
    const read = await sdk.sessions.waitPreview(f.sessionId, target);
    await sdk.sessions.waitFor(read.preview, true);
    await f.send("Generated dependent after exact command");
    assert.equal(f.requests.length, 0);
    const queued = sdk.sessions.get(target)!;
    await sdk.prompts.release(target, queued.queue[0]!.id, queued.queueRevision);
    await waitFor(() => f.session().wait?.status === "released");
    await f.terminal();
    assert.equal(f.requests.length, 1);
    assert.equal(f.service.controller.snapshot().commandExecutions.find((execution) => execution.sessionId === target)?.status, "completed");
  } finally { sdk.disconnect(); await f.close(); }
});

test("manual and automatic model retries cannot bypass an exact session wait or refund unknown usage", async () => {
  const clock = new GeneratedIntakeClock(), f = await setupFixture({ httpFailure: { status: 408, message: "Generated waiting retry." },
    responseMode: "text", maxOutputTokens: 128, platform: { intakeClock: clock } });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); await f.send("Generated original request."); await f.terminal();
    const target = (await sdk.sessions.create(f.session().projectId, "Generated held command")).id!;
    await sdk.command({ type: "draft.save", sessionId: target, text: "/session-id", attachments: [], expectedRevision: 0 });
    await sdk.commands.submit(target, { client: "cli", expectedDraftRevision: sdk.sessions.get(target)!.draft.revision, delivery: "queue", held: true });
    await sdk.sessions.waitFor((await sdk.sessions.waitPreview(f.sessionId, target)).preview, true);
    const original = f.service.controller.snapshot().modelFailures[0]!;
    await assert.rejects(() => sdk.sessions.retry(f.sessionId, original.id, original.revision), { code: "model_retry_blocked" });
    assert.equal(retryFailure(f.session(), f.service.controller.snapshot().modelFailures), undefined);
    clock.advanceBy(30000);
    assert.equal(f.requests.length, 1);
    assert.equal(f.session().wait?.status, "waiting");
    assert.equal(f.service.controller.snapshot().budgetEntries[0]?.status, "unknown");
    assert.ok(f.service.controller.snapshot().budgetEntries[0]!.reservedTokens! > 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("a wait admitted during an original-turn retry never adopts the earlier failed completion", async () => {
  const f = await setupFixture({ httpFailure: { status: 408, message: "Generated original retry prerequisite.", remaining: 1 },
    maxOutputTokens: 128, respond: () => ({ text: "Generated incomplete retry.", hold: true }) });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); await f.send("Generated original retry turn."); await f.terminal();
    const source = (await sdk.sessions.create(f.session().projectId, "Generated waiting source")).id!;
    const original = f.service.controller.snapshot().modelFailures[0]!;
    await sdk.sessions.retry(f.sessionId, original.id, original.revision);
    await waitFor(() => f.requests.length === 2);
    await sdk.sessions.waitFor((await sdk.sessions.waitPreview(source, f.sessionId)).preview, true);
    f.service.controller.wake();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(sdk.sessions.get(source)?.wait?.status, "waiting");
    await sdk.command({ type: "session.stop", sessionId: f.sessionId });
    await waitFor(() => sdk.sessions.get(source)?.wait?.status === "blocked");
    assert.match(sdk.sessions.get(source)!.wait!.diagnostic!, /ended stopped/);
    assert.equal(f.requests.length, 2);
  } finally { sdk.disconnect(); await f.close(); }
});
