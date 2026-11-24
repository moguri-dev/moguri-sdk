import { ciTime } from "./fixtures/time-scale.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk, type StoredEvent } from "../packages/sdk/src/index.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { automaticFixture } from "./fixtures/automatic-sandbox.ts";

const native = { skip: process.platform !== "darwin", timeout: ciTime(20_000) };
test("idle scheduling prepares the complete owned native source before ghost capture, without a model turn or inference", native, async (t) => {
  const fixture = await automaticFixture(t);
  try {
    await writeFile(join(fixture.project, "generated-scheduled.txt"), "Generated complete scheduled source.\n");
    await fixture.sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision,
      text: "Generated native scheduled original.", attachments: [] });
    const before = fixture.session().draft.revision;
    const scheduled = await fixture.sdk.scheduledPrompts.create(fixture.sessionId, { kind: "delay", minutes: 5, timeZone: "UTC" });
    const state = fixture.controller.snapshot(), workspace = state.sandboxWorkspaces!.find((entry) => entry.id === fixture.session().sandboxWorkspaceId)!;
    assert.equal(workspace.status, "ready"); assert.equal(workspace.preparation?.kind, "scheduled");
    assert.equal(workspace.preparation?.version, 2);
    if (workspace.preparation?.version === 2) assert.equal(workspace.preparation.draftRevision, before);
    const record = state.scheduledPrompts.find((entry) => entry.id === scheduled.id)!;
    assert.equal(record.commandId, workspace.commandId); assert.equal(record.commandDigest, workspace.commandDigest);
    assert.equal(record.status, "scheduled"); assert.equal(fixture.session().draft.text, "");
    assert.equal(fixture.session().turnId, null); assert.equal(fixture.session().queue.length, 0); assert.equal(fixture.session().messages.length, 0);
    assert.equal(state.budgetEntries.length, 0); assert.equal(fixture.requests.length, 0); assert.equal(fixture.executions.length, 0);
    assert.equal((await fixture.sdk.workspaces.file(fixture.sessionId, "generated-scheduled.txt")).text, "Generated complete scheduled source.\n");
    const intent = fixture.controller.events(0).find((event) => event.event_type === "sandbox.workspace_recorded" &&
      event.payload.workspace.id === workspace.id && event.payload.workspace.revision === 0)!;
    assert.ok(intent?.event_type === "sandbox.workspace_recorded");
    assert.match(fixture.service.store.blob(intent.payload.workspace.inputDigest), /Generated native scheduled original/);
    assert.equal(fixture.controller.events(0).some((event) => event.event_type === "turn.started"), false);
  } finally { await fixture.close(); }
});

for (const action of ["draft", "stop", "authorization"] as const) {
  test(`${action} during native scheduled preparation preserves the original intent and admits no ghost/model`, native, async (t) => {
    const fixture = await automaticFixture(t);
    let mutation: Promise<unknown> | undefined;
    const change = (events: StoredEvent[]) => {
      if (mutation || !events.some((event) => event.event_type === "sandbox.workspace_recorded" && event.payload.workspace.status === "preparing" &&
        event.payload.workspace.preparation?.kind === "scheduled")) return;
      mutation = fixture.controller.dispatch(envelope(action === "draft" ? { type: "draft.save", sessionId: fixture.sessionId,
        expectedRevision: fixture.session().draft.revision, text: "Generated newer draft during private copy.", attachments: [] } :
        action === "stop" ? { type: "session.stop", sessionId: fixture.sessionId } : { type: "provider.logout" }));
    };
    try {
      await fixture.sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision,
        text: "Generated exact pending native input.", attachments: [] });
      fixture.controller.on("change", change);
      await assert.rejects(() => fixture.sdk.scheduledPrompts.create(fixture.sessionId, { kind: "delay", minutes: 5, timeZone: "UTC" }));
      await mutation;
      assert.equal(fixture.controller.snapshot().scheduledPrompts.length, 0); assert.equal(fixture.executions.length, 0);
      assert.equal(fixture.requests.length, 0); assert.equal(fixture.controller.snapshot().budgetEntries.length, 0);
      assert.equal(fixture.session().draft.text, action === "draft" ? "Generated newer draft during private copy." : "Generated exact pending native input.");
      assert.equal(fixture.session().turnId, null);
      assert.ok(fixture.controller.events(0).some((event) => event.event_type === "sandbox.workspace_recorded" &&
        event.payload.workspace.preparation?.kind === "scheduled"));
    } finally { fixture.controller.off("change", change); await mutation; await fixture.close(); }
  });
}

test("two clients cannot prepare or consume one native draft twice, and a second prompt reuses only the verified ready stage", native, async (t) => {
  const fixture = await automaticFixture(t), other = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision,
      text: "Generated one concurrent native input.", attachments: [] });
    await other.refresh(); const revision = fixture.session().draft.revision;
    const results = await Promise.allSettled([fixture.sdk, other].map((sdk) =>
      sdk.scheduledPrompts.create(fixture.sessionId, { kind: "delay", minutes: 5, timeZone: "UTC" }, revision)));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(fixture.controller.snapshot().scheduledPrompts.length, 1);
    const workspaceId = fixture.session().sandboxWorkspaceId;
    await fixture.sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision,
      text: "Generated later ready-stage input.", attachments: [] });
    await fixture.sdk.scheduledPrompts.create(fixture.sessionId, { kind: "delay", minutes: 10, timeZone: "UTC" });
    assert.equal(fixture.session().sandboxWorkspaceId, workspaceId); assert.equal(fixture.controller.snapshot().sandboxWorkspaces!.length, 1);
    assert.equal(fixture.executions.length, 0); assert.equal(fixture.requests.length, 0);
  } finally { other.disconnect(); await fixture.close(); }
});
