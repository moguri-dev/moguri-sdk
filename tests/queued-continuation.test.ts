import assert from "node:assert/strict";
import test from "node:test";
import { DraftEditor, MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("the original claimed continuation waits for an actual user choice, then runs ahead of later input without consuming a newer draft", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready(), clientId = crypto.randomUUID();
  const editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  let attached = false;
  try {
    await fixture.configure(); await sdk.refresh(); await editor.attach("fixture.txt");
    for (const text of ["/continue-work", "Generated later ordered continuation prompt."]) {
      editor.edit(text); await editor.submit((expectedDraftRevision) => sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision, held: true }));
    }
    editor.edit("Generated newer composer draft, not this choice."); await editor.flush();
    await sdk.command({ type: "session.resume", sessionId: fixture.sessionId });
    const execution = await waitFor(() => fixture.service.controller.snapshot().commandExecutions.find((entry) => entry.status === "waiting-client"));
    const retained = await sdk.commands.read(execution.id);
    assert.equal(retained.result?.kind, "continue-work");
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.session().queue.length, 1);
    await sdk.command({ type: "slash.client.attach", clientId, client: "cli", handlers: ["continue-work"] });
    attached = true;
    const claim = await sdk.commands.claim(clientId, execution.id, execution.revision);
    await assert.rejects(() => sdk.commands.choose(clientId, { ...claim, token: "0".repeat(64) }, "prompt"), { code: "command_claim" });
    assert.equal(fixture.requests.length, 0);
    await sdk.commands.choose(clientId, claim, "prompt");
    await waitFor(() => fixture.requests.length === 2 && fixture.session().status === "completed");
    assert.deepEqual(fixture.session().messages.filter((message) => message.role === "user").map((message) => message.text),
      ["/continue-work\n\nAttached: fixture.txt", "Generated later ordered continuation prompt."]);
    assert.match(JSON.stringify(fixture.requests[0]), /fixture\.txt/);
    assert.equal(JSON.stringify(fixture.requests).includes("Generated newer composer draft"), false);
    assert.equal(fixture.session().draft.text, "Generated newer composer draft, not this choice.");
    const choice = fixture.service.controller.events(0).find((event) => event.event_type === "slash.continuation_chosen");
    assert.ok(choice?.event_type === "slash.continuation_chosen");
    assert.equal(choice.payload.choice.actor, "user"); assert.equal(choice.payload.choice.inputDigest, execution.inputDigest);
    await assert.rejects(() => sdk.commands.choose(clientId, claim, "prompt"), { code: "command_revision" });
    assert.equal(fixture.requests.length, 2);
  } finally {
    editor.dispose();
    try { if (attached) await sdk.command({ type: "slash.client.detach", clientId }); } finally { sdk.disconnect(); await fixture.close(); }
  }
});

for (const newer of [false, true]) test(`cancelled queued continuation ${newer ? "preserves a newer composer" : "restores only its unchanged empty composer"} without running a model`, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), clientId = crypto.randomUUID();
  const editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  let attached = false;
  try {
    editor.edit("/continue-work");
    await editor.submit((expectedDraftRevision) => sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision }));
    const execution = await waitFor(() => fixture.service.controller.snapshot().commandExecutions.find((entry) => entry.status === "waiting-client"));
    if (newer) { editor.edit("Generated newer input remains owned."); await editor.flush(); }
    await sdk.command({ type: "slash.client.attach", clientId, client: "cli", handlers: ["continue-work"] });
    attached = true;
    const claim = await sdk.commands.claim(clientId, execution.id, execution.revision);
    await sdk.commands.complete(clientId, execution.id, claim.revision, claim.token, { outcome: "cancelled", restoreInput: true });
    assert.equal(fixture.session().draft.text, newer ? "Generated newer input remains owned." : "/continue-work");
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.session().controls.modelId, null);
    assert.equal(fixture.service.controller.snapshot().commandExecutions[0]?.status, "cancelled");
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "slash.continuation_chosen"), false);
    assert.match((await sdk.commands.read(execution.id)).item.text, /^\/continue-work$/);
  } finally {
    editor.dispose();
    try { if (attached) await sdk.command({ type: "slash.client.detach", clientId }); } finally { sdk.disconnect(); await fixture.close(); }
  }
});
