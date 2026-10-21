import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { MoguriSdk, projectEvents } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { roleSequenceFixture } from "./fixtures/role-sequence-api.ts";

test("shared read-only role APIs retain exact data, guard active/immutable artifacts and never promote critic data to user context", async () => {
  const f = await roleSequenceFixture();
  try {
    const read = await f.sdk.roleSequences.read(f.initial.id, 0);
    assert.equal(read.sequence.status, "running"); assert.equal(read.text, f.text); assert.deepEqual(read.step, { index: 0, input: null, result: null });
    const artifact = (await f.sdk.artifacts.read(f.initial.id)).artifact;
    await assert.rejects(() => f.sdk.artifacts.update(f.initial.id, { text: "Generated unauthorized replacement." }, artifact.revision), { code: "role_sequence_document" });
    await assert.rejects(() => f.sdk.artifacts.update(f.initial.id, { status: "archived" }, artifact.revision), { code: "role_sequence_busy" });
    await assert.rejects(() => f.sdk.artifacts.delete(f.initial.id, artifact.revision, true), { code: "role_sequence_busy" });
    f.start(0); f.result(0); f.start(1); f.result(1); f.complete();
    const result = await f.sdk.roleSequences.read(f.initial.id, 1);
    assert.equal(result.sequence.status, "completed"); assert.match(result.step!.result!, /GENERATED_RETAINED_CRITIC_RESULT_NOT_CONTEXT/);
    assert.equal(f.session().messages.some((message) => message.text.includes("RESULT_NOT_CONTEXT")), false);
    assert.equal(f.session().messages.some((message) => message.role === "user"), false);
    const shared = await f.sdk.slash(f.sessionId, `/roles ${f.initial.id} 1`, "tui"); assert.ok(shared.kind === "text");
    assert.equal(JSON.parse(shared.text).sequence.id, f.initial.id);
    assert.equal((await f.sdk.budgets.calls({ turnId: f.initial.id })).calls.length, 2); assert.equal(f.requests.length, 0);
    await f.send("Generated ordinary follow-up after retained roles."); await f.terminal();
    assert.equal(f.requests.length, 1); assert.equal(JSON.stringify(f.requests[0]?.messages).includes("RESULT_NOT_CONTEXT"), false);
  } finally { await f.close(); }
});

test("role intent/results survive source deletion and real reopen, export all role data and erase only their independent grant", async () => {
  const f = await roleSequenceFixture(); let reopened: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    f.start(0); f.result(0); f.start(1); f.result(1); f.complete();
    const sequence = f.current(), hashes = [sequence.inputDigest, ...sequence.steps.flatMap((step) => [step.inputDigest!, step.resultDigest!])];
    await f.sdk.sessions.delete(f.sessionId, true, f.session().revision);
    const configuration = (await f.sdk.projects.configuration(sequence.projectId!)).configuration, preview = (await f.sdk.artifacts.projectPreview(sequence.projectId!)).preview;
    await f.sdk.projects.remove(sequence.projectId!, true, configuration.revision, { action: "retain", expectedDigest: preview.digest });
    await f.service.close();
    reopened = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey, platform: { terminal: { vault: f.terminalVault } } });
    const peer = await new MoguriSdk(reopened.connection).ready();
    try {
      assert.equal((await peer.roleSequences.read(sequence.id, 1)).sequence.status, "completed");
      assert.equal((await peer.artifacts.read(sequence.id)).artifact.projectId, null);
      const exported = JSON.parse((await peer.artifacts.export(sequence.id)).export.text);
      assert.equal(exported.schemaVersion, 4); assert.ok(exported.documents[0].roles.events.length >= 6); assert.equal(exported.documents[0].roles.results.length, 5);
      assert.deepEqual(reopened.controller.platform.roles.original(sequence.commandId, sequence.commandDigest), { id: sequence.id, revision: sequence.revision });
      const artifact = (await peer.artifacts.read(sequence.id)).artifact; await peer.artifacts.delete(sequence.id, artifact.revision, true);
      await assert.rejects(() => peer.roleSequences.read(sequence.id), { code: "role_sequence_missing" });
      assert.throws(() => reopened!.controller.platform.roles.original(sequence.commandId, sequence.commandDigest), { code: "role_sequence_deleted" });
      for (const hash of hashes) assert.throws(() => reopened!.store.blob(hash), /Missing or deleted/);
      assert.equal((await peer.budgets.calls()).calls.length, 2); assert.equal(f.requests.length, 0);
    } finally { peer.disconnect(); }
  } finally { await reopened?.close(); await f.close(); }
});

test("unsettled role metadata recovers partial without model/root replay, releasing unused capacity but retaining the started unknown call", async () => {
  const f = await roleSequenceFixture(); let reopened: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    f.start(0); const before = f.current(); await f.service.close();
    reopened = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey, platform: { terminal: { vault: f.terminalVault } } });
    const peer = await new MoguriSdk(reopened.connection).ready();
    try {
      const recovered = (await peer.roleSequences.read(before.id)).sequence;
      assert.equal(recovered.status, "partial"); assert.equal(recovered.steps[0]?.state, "unconfirmed"); assert.equal(recovered.steps[0]?.stepId, before.steps[0]?.stepId);
      const budget = (await peer.budgets.status(f.sessionId)).status;
      assert.equal(budget.totals.calls, 1); assert.equal(budget.totals.plannedHolds, 0); assert.equal(budget.totals.reportedTokens, null); assert.equal(budget.totals.heldTokens, 164);
      assert.equal(peer.getState().snapshot!.blockedProjects.includes(before.projectId!), false); assert.equal(f.requests.length, 0);
    } finally { peer.disconnect(); }
  } finally { await reopened?.close(); await f.close(); }
});

test("an explicit stop of retained metadata without an active worker stays partial, not an invented cancellation acknowledgement", async () => {
  const f = await roleSequenceFixture();
  try {
    f.start(0); await f.sdk.command({ type: "session.stop", sessionId: f.sessionId });
    assert.equal(f.current().status, "partial"); assert.equal(f.current().stopRequested, true); assert.equal(f.current().steps[0]?.state, "unconfirmed");
    assert.equal(f.control.events(0).some((event) => event.turn_id === f.initial.id && event.event_type === "turn.stop_acknowledged"), false);
    assert.equal((await f.sdk.budgets.status(f.sessionId)).status.totals.plannedHolds, 0); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("same-profile role observations cannot be replaced or imported by another scoped SDK profile", async () => {
  const f = await roleSequenceFixture();
  try {
    f.start(0); f.result(0);
    const before = f.current(), events = f.control.events(0).length;
    assert.throws(() => f.result(0), { code: "role_sequence_corrupt" }); assert.equal(f.control.events(0).length, events);
    assert.deepEqual(f.current(), before);
    const created = await f.sdk.profiles.create("Generated retained-role peer"); await f.sdk.profiles.wait(created.id!);
    const peer = await f.sdk.profiles.open(created.id!);
    try {
      assert.deepEqual(peer.roleSequences.list(), []);
      await assert.rejects(() => peer.roleSequences.read(f.initial.id, 0), { code: "role_sequence_missing" });
      assert.equal(f.requests.length, 0);
    } finally { peer.disconnect(); }
  } finally { await f.close(); }
});

test("a live retained role cannot lose or replace its original data-only control ownership", async () => {
  const f = await roleSequenceFixture();
  try {
    const events = f.control.events(0);
    assert.throws(() => projectEvents(events.filter((event) => event.event_type !== "turn.control_started")), { code: "role_sequence_corrupt" });
    assert.throws(() => projectEvents(events.map((event) => event.event_type === "turn.control_started" && event.payload.purpose === "role.sequence" ?
      { ...event, payload: { ...event.payload, promptDigest: "f".repeat(64) } } : event)), { code: "role_sequence_corrupt" });
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
