import assert from "node:assert/strict";
import { test } from "node:test";
import { DraftEditor, MoguriSdk, defaultSettings } from "../packages/sdk/src/index.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { projectEvents, PROTOCOL_VERSION } from "../packages/protocol/src/index.ts";
import { retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("session confirmation preferences default on and save only the requested profile fields", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    assert.equal(defaultSettings().retention.confirmArchive, true);
    assert.equal(defaultSettings().retention.confirmDelete, true);
    const current = sdk.settings.get();
    assert.ok(current);
    await sdk.settings.update({ ...current.values, retention: { ...current.values.retention, confirmArchive: false } }, current.revision);
    assert.equal(sdk.settings.get()?.values.retention.confirmArchive, false);
    assert.equal(sdk.settings.get()?.values.retention.confirmDelete, true);
    assert.equal(sdk.settings.get()?.values.retention.deleteArchived, false);
    assert.equal(sdk.getState().snapshot!.sessions.length, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("schema-50 interaction upgrade rolls back a failed marker and preserves exact encrypted content and receipts", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated original interaction upgrade draft", attachments: [] }, "generated-interaction-upgrade-receipt");
    sdk.disconnect(); await writeLegacyState(fixture.service, 50);
    const path = fixture.service.store.path, before = new DatabaseSync(path), rows = retainedCiphertextRows(before);
    before.exec("CREATE TRIGGER generated_interaction_failure BEFORE INSERT ON retention_metadata WHEN NEW.id='session_interactions_schema' BEGIN SELECT RAISE(ABORT,'generated interaction migration failure'); END");
    before.close();
    assert.throws(() => new EventStore(path, fixture.retentionKey), /generated interaction migration failure/);
    const failed = new DatabaseSync(path);
    assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 50);
    assert.deepEqual(retainedCiphertextRows(failed), rows);
    failed.exec("DROP TRIGGER generated_interaction_failure"); failed.close();
    const upgraded = new EventStore(path, fixture.retentionKey);
    try {
      assert.equal(upgraded.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
      assert.deepEqual(retainedCiphertextRows(upgraded.db), rows);
      const state = projectEvents(upgraded.events());
      assert.equal(state.settings.values.retention.confirmArchive, true);
      assert.equal(state.settings.values.retention.confirmDelete, true);
      assert.equal(state.sessions[0]?.draft.text, "Generated original interaction upgrade draft");
      assert.ok(upgraded.db.prepare("SELECT id FROM receipts WHERE id=?").get("generated-interaction-upgrade-receipt"));
    } finally { upgraded.close(); }
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("session order and remembered confirmations recover after an actual service restart without launching work", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, client: MoguriSdk | undefined;
  try {
    const second = await sdk.sessions.create(fixture.session().projectId, "Generated restart second");
    const state = sdk.getState().snapshot!, desired = [second.id!, fixture.sessionId];
    await sdk.sessions.reorder(fixture.session().projectId, null, null, false, desired.map((id) => ({ sessionId: id, revision: state.sessions.find((entry) => entry.id === id)!.revision })));
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, retention: { ...settings.values.retention, confirmArchive: false, confirmDelete: false } }, settings.revision);
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey,
      platform: { terminal: { vault: fixture.terminalVault, executable: process.execPath, args: ["-e", "process.stdin.resume()"] } } });
    client = await new MoguriSdk(restarted.connection).ready();
    const recovered = client.getState().snapshot!;
    assert.deepEqual(recovered.sessions.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((entry) => entry.id), desired);
    assert.equal(recovered.settings.values.retention.confirmArchive, false); assert.equal(recovered.settings.values.retention.confirmDelete, false);
    assert.equal(recovered.settings.values.retention.deleteArchived, false);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); client?.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("session reorder checks complete sibling revisions atomically and preserves roots and attachment authority", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const second = await sdk.sessions.create(fixture.session().projectId, "Generated second");
    const third = await sdk.sessions.create(fixture.session().projectId, "Generated third");
    const sessions = () => sdk.getState().snapshot!.sessions;
    const order = [third.id!, fixture.sessionId, second.id!].map((id) => ({ sessionId: id, revision: sessions().find((session) => session.id === id)!.revision }));
    await sdk.sessions.reorder(fixture.session().projectId, null, null, false, order);
    assert.deepEqual(sessions().slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((session) => session.id), order.map((entry) => entry.sessionId));
    const before = fixture.service.controller.events(0).length;
    await assert.rejects(() => sdk.sessions.reorder(fixture.session().projectId, null, null, false, order), /revision|changed/i);
    assert.equal(fixture.service.controller.events(0).length, before);
    await assert.rejects(() => sdk.sessions.reorder(fixture.session().projectId, null, null, false, order.slice(1)), /exact|sibling/i);
    await sdk.sessions.organize(second.id!, { parentSessionId: third.id! });
    const child = sessions().find((session) => session.id === second.id)!;
    assert.equal(child.workspaceId, null); assert.equal(child.mode, "agent");
    await assert.rejects(() => sdk.sessions.organize(third.id!, { parentSessionId: second.id! }), /acyclic|cycle/i);
    await sdk.sessions.organize(second.id!, { parentSessionId: null }, undefined, true);
    assert.equal(sessions().find((session) => session.id === second.id)?.parentSessionId, undefined);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("Other is an explicit real-user answer, not a new choice or permission and not an unrelated draft", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ holdAfterTool: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("generated structured question choices only");
    const question = await waitFor(() => sdk.getState().snapshot?.questions.find((question) => question.status === "open"));
    assert.equal(question.allowFreeform, false);
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated unrelated queued draft", attachments: [] });
    await assert.rejects(() => sdk.questions.answer(question.id, "Generated different approach", question.revision), /offered|permits/i);
    await sdk.questions.answerOther(question.id, "Generated different approach", question.revision);
    const answered = sdk.getState().snapshot!.questions.find((entry) => entry.id === question.id)!;
    assert.equal(answered.answer?.actor, "user"); assert.equal(answered.answer?.other, true);
    assert.equal(answered.answer?.modelId, null);
    assert.equal(fixture.session().draft.text, "Generated unrelated queued draft");
    assert.deepEqual(sdk.settings.get()?.values.permissions, defaultSettings().permissions);
    await assert.rejects(() => sdk.questions.answerOther(question.id, "Generated late answer", question.revision), /changed|revision|answered/i);
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); await fixture.terminal();
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("resuming three held prompts waits for three separate owned terminal turns", { skip: process.platform !== "darwin", timeout: ciTime(25_000) }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    await fixture.configure();
    for (const text of ["generated serial question A", "generated serial question B", "generated serial question C"]) {
      editor.edit(text); await editor.send("queue", true);
    }
    assert.equal(fixture.requests.length, 0);
    await sdk.command({ type: "session.resume", sessionId: fixture.sessionId });
    await waitFor(() => fixture.service.controller.events(0).filter((event) => event.event_type === "turn.finished").length === 3, 20_000);
    const lifecycle = fixture.service.controller.events(0).filter((event) => event.event_type === "turn.started" || event.event_type === "turn.finished");
    assert.deepEqual(lifecycle.map((event) => event.event_type), ["turn.started", "turn.finished", "turn.started", "turn.finished", "turn.started", "turn.finished"]);
    const starts = lifecycle.filter((event) => event.event_type === "turn.started");
    assert.equal(new Set(starts.map((event) => event.turn_id)).size, 3);
    assert.deepEqual(starts.map((event) => event.payload.item.text), ["generated serial question A", "generated serial question B", "generated serial question C"]);
    assert.equal(fixture.session().queue.length, 0);
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});

test("cancelling a resumed queue retains undispatched prompts and restart never drains them without another explicit resume", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await fixture.configure();
    for (const text of ["generated slow first queued task", "Generated queued task B", "Generated queued task C"]) { editor.edit(text); await editor.send("queue", true); }
    await sdk.command({ type: "session.resume", sessionId: fixture.sessionId });
    await waitFor(() => fixture.requests.length === 1);
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); await fixture.terminal();
    assert.equal(fixture.session().queue.length, 2); assert.equal(fixture.requests.length, 1);
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    assert.equal(restarted.controller.snapshot().sessions.find((session) => session.id === fixture.sessionId)?.queue.length, 2);
    const client = await new MoguriSdk(restarted.connection).ready();
    try {
      await client.models.refresh();
      assert.equal(restarted.controller.snapshot().sessions.find((session) => session.id === fixture.sessionId)?.turnId, null);
      assert.equal(restarted.controller.events(0).filter((event) => event.event_type === "turn.started").length, 1);
      assert.equal(fixture.requests.length, 1);
    } finally { client.disconnect(); }
  } finally { editor.dispose(); sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});
