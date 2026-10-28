import assert from "node:assert/strict";
import test from "node:test";
import { sessionChildBindings } from "../packages/protocol/src/index.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("deletion requires an exact reviewed child tree and rejects a stale scope without deleting sessions", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const child = await sdk.sessions.spawn(fixture.sessionId, "agent", "Generated child");
    const reviewed = sessionChildBindings(sdk.getState().snapshot!.sessions, fixture.sessionId);
    await assert.rejects(() => sdk.sessions.delete(fixture.sessionId, true, fixture.session().revision), { code: "session_children_review" });
    const grandchild = await sdk.sessions.spawn(child.id!, "agent", "Generated grandchild");
    await assert.rejects(() => sdk.sessions.delete(fixture.sessionId, true, fixture.session().revision, { action: "delete", expected: reviewed }),
      { code: "session_children_stale" });
    assert.deepEqual(sdk.getState().snapshot!.sessions.map((session) => session.id).sort(), [fixture.sessionId, child.id!, grandchild.id!].sort());
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("deleting reviewed subsessions removes the full subtree in one session transaction", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const child = await sdk.sessions.spawn(fixture.sessionId, "agent", "Generated child");
    const grandchild = await sdk.sessions.spawn(child.id!, "side", "Generated grandchild");
    const expected = sessionChildBindings(sdk.getState().snapshot!.sessions, fixture.sessionId);
    await sdk.sessions.delete(fixture.sessionId, true, fixture.session().revision, { action: "delete", expected });
    assert.deepEqual(sdk.getState().snapshot!.sessions, []);
    const deleted = fixture.service.controller.events(0).filter((event) => event.event_type === "session.deleted");
    assert.deepEqual(deleted.map((event) => event.event_type === "session.deleted" ? event.payload.deletedSessionId : "").sort(),
      [fixture.sessionId, child.id!, grandchild.id!].sort());
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("cascade deletion leaves the whole tree intact when a child has unconfirmed tool effects", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const child = await sdk.sessions.spawn(fixture.sessionId, "agent", "Generated child");
    const expected = sessionChildBindings(sdk.getState().snapshot!.sessions, fixture.sessionId);
    const session = sdk.getState().snapshot!.sessions.find((value) => value.id === child.id)!;
    const scope = { profile_id: sdk.profileId, project_id: session.projectId, session_id: session.id, turn_id: "generated-child-partial-turn" };
    fixture.service.store.commit([
      { ...scope, event_type: "tool.completed", payload: {
        call: { id: "generated-child-partial-call", name: "run_command", arguments: { command: "generated fixture only" } },
        text: "Generated child partial result.", isError: true, outcome: "unconfirmed",
      } },
      { ...scope, event_type: "turn.finished", payload: { outcome: "partial", diagnostic: "Generated child cleanup is unconfirmed." } },
    ]);
    fixture.service.controller.refreshProfile(); await sdk.refresh();
    await assert.rejects(() => sdk.sessions.delete(fixture.sessionId, true, fixture.session().revision, { action: "delete", expected }),
      { code: "cleanup_unconfirmed" });
    assert.deepEqual(new Set(sdk.getState().snapshot!.sessions.map((value) => value.id)), new Set([fixture.sessionId, child.id!]));
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "session.deleted"), false);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("archiving the reviewed subtree archives every descendant", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const child = await sdk.sessions.spawn(fixture.sessionId, "agent", "Generated child");
    const grandchild = await sdk.sessions.spawn(child.id!, "side", "Generated grandchild");
    const expected = sessionChildBindings(sdk.getState().snapshot!.sessions, fixture.sessionId);
    await assert.rejects(() => sdk.command({ type: "session.archive", sessionId: fixture.sessionId }), { code: "session_children_review" });
    await sdk.command({ type: "session.archive", sessionId: fixture.sessionId, expectedRevision: fixture.session().revision,
      children: { action: "archive", expected } });
    assert.ok(sdk.getState().snapshot!.sessions.every((session) => session.status === "archived"));
    assert.equal(sdk.getState().snapshot!.sessions.length, 3);
    assert.ok(sdk.getState().snapshot!.sessions.some((session) => session.id === grandchild.id));
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("archiving with detach preserves child status and nested parent links", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const child = await sdk.sessions.spawn(fixture.sessionId, "agent", "Generated child");
    const grandchild = await sdk.sessions.spawn(child.id!, "side", "Generated grandchild");
    const before = sdk.getState().snapshot!.sessions;
    const childStatus = before.find((session) => session.id === child.id)!.status;
    const grandchildStatus = before.find((session) => session.id === grandchild.id)!.status;
    const expected = sessionChildBindings(before, fixture.sessionId);
    await sdk.command({ type: "session.archive", sessionId: fixture.sessionId, expectedRevision: fixture.session().revision,
      children: { action: "detach", expected } });
    const snapshot = sdk.getState().snapshot!;
    assert.equal(snapshot.sessions.find((session) => session.id === fixture.sessionId)?.status, "archived");
    assert.equal(snapshot.sessions.find((session) => session.id === child.id)?.status, childStatus);
    assert.equal(snapshot.sessions.find((session) => session.id === child.id)?.parentSessionId ?? null, null);
    assert.equal(snapshot.sessions.find((session) => session.id === grandchild.id)?.status, grandchildStatus);
    assert.equal(snapshot.sessions.find((session) => session.id === grandchild.id)?.parentSessionId, child.id);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("detaching a running child during parent archive or deletion settles its turn without deleting the session", async () => {
  const fixture = await setupFixture({ respond: () => ({ text: "Generated held child work.", hold: true }) });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    const child = await sdk.sessions.spawn(fixture.sessionId, "agent", "Generated running child");
    const currentChild = () => sdk.getState().snapshot!.sessions.find((session) => session.id === child.id)!;
    await sdk.command({ type: "draft.save", sessionId: child.id!, expectedRevision: currentChild().draft.revision,
      text: "generated slow detached child work", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: child.id!, expectedRevision: currentChild().draft.revision, delivery: "queue" });
    await waitFor(() => fixture.requests.length === 1);
    const turnId = currentChild().turnId;
    assert.ok(turnId);
    const expected = sessionChildBindings(sdk.getState().snapshot!.sessions, fixture.sessionId);
    await sdk.command({ type: "session.archive", sessionId: fixture.sessionId, expectedRevision: fixture.session().revision,
      children: { action: "detach", expected } });
    assert.equal(sdk.getState().snapshot!.sessions.find((session) => session.id === child.id)?.parentSessionId ?? null, null);
    await waitFor(() => !currentChild().turnId);
    assert.equal(currentChild().turnId, null);
    assert.notEqual(currentChild().status, "running");
    assert.equal(fixture.requests.length, 1);

    const deleteParent = await sdk.sessions.create(null, "Generated active delete parent");
    const createdParent = sdk.getState().snapshot!.sessions.find((session) => session.id === deleteParent.id)!;
    await sdk.command({ type: "session.configure", sessionId: deleteParent.id!, expectedRevision: createdParent.revision,
      controls: { ...createdParent.controls, modelId: fixture.modelId } });
    const deleteChild = await sdk.sessions.spawn(deleteParent.id!, "agent", "Generated active delete child");
    const currentDeleteChild = () => sdk.getState().snapshot!.sessions.find((session) => session.id === deleteChild.id)!;
    await sdk.command({ type: "draft.save", sessionId: deleteChild.id!, expectedRevision: currentDeleteChild().draft.revision,
      text: "generated slow child work for delete", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: deleteChild.id!, expectedRevision: currentDeleteChild().draft.revision, delivery: "queue" });
    await waitFor(() => fixture.requests.length === 2);
    const deleteTurnId = currentDeleteChild().turnId;
    assert.ok(deleteTurnId);
    await sdk.sessions.delete(deleteParent.id!, true, sdk.getState().snapshot!.sessions.find((value) => value.id === deleteParent.id)!.revision, {
      action: "detach", expected: sessionChildBindings(sdk.getState().snapshot!.sessions, deleteParent.id!),
    });
    assert.equal(sdk.getState().snapshot!.sessions.some((session) => session.id === deleteParent.id), false);
    assert.equal(currentDeleteChild().parentSessionId ?? null, null);
    await waitFor(() => !currentDeleteChild().turnId);
    assert.equal(currentDeleteChild().turnId, null);
    assert.notEqual(currentDeleteChild().status, "running");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("automatic session retention skips child trees until archive/delete dispositions are saved", async () => {
  let now = Date.now() + 40 * 86_400_000;
  const fixture = await setupFixture({ platform: { now: () => now } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated completed auto-archive session."); await fixture.terminal();
    const child = await sdk.sessions.spawn(fixture.sessionId, "agent", "Generated retained child");
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, retention: { ...settings.values.retention, archiveCompleted: true, archiveAfterDays: 7 } }, settings.revision);
    assert.deepEqual(await fixture.service.controller.platform.sessions.retention(), { deleted: 0, archived: 0 });
    assert.equal(sdk.getState().snapshot!.sessions.find((session) => session.id === fixture.sessionId)?.status, "completed");
    assert.equal(sdk.getState().snapshot!.sessions.find((session) => session.id === child.id)?.status, "idle");
    const latest = sdk.settings.get()!;
    await sdk.settings.update({ ...latest.values, retention: { ...latest.values.retention, archiveChildren: "archive", deleteArchived: true, afterDays: 7 } }, latest.revision);
    assert.deepEqual(await fixture.service.controller.platform.sessions.retention(), { deleted: 0, archived: 2 });
    await sdk.refresh();
    assert.ok(sdk.getState().snapshot!.sessions.every((session) => session.status === "archived"));
    now += 40 * 86_400_000;
    const retained = sdk.settings.get()!;
    await sdk.settings.update({ ...retained.values, retention: { ...retained.values.retention, deleteChildren: "delete" } }, retained.revision);
    assert.deepEqual(await fixture.service.controller.platform.sessions.retention(), { deleted: 2, archived: 0 });
    await sdk.refresh();
    assert.equal(sdk.getState().snapshot!.sessions.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
