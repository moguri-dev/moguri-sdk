import assert from "node:assert/strict";
import test from "node:test";
import { setupFixture, waitFor } from "./fixture.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { previewSessionBulk } from "../apps/service/src/session-bulk.ts";

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
