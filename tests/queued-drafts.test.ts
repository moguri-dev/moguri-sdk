import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DraftEditor, MoguriSdk, type Command, type CommandResult } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("an acknowledged queued context command cannot conflict with or consume the next locally typed command", { timeout: 10000 }, async () => {
  const accepted = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  class DelayedIntake extends MoguriSdk {
    private delayed = false;
    override async command(command: Command, id = crypto.randomUUID()): Promise<CommandResult> {
      const result = await super.command(command, id);
      if (command.type === "message.send" && !this.delayed) { this.delayed = true; accepted.resolve(); await release.promise; }
      return result;
    }
  }
  const fixture = await setupFixture(), sdk = await new DelayedIntake(fixture.service.connection).ready(), editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  const unsubscribe = sdk.subscribe(() => { const draft = sdk.getState().snapshot?.sessions.find((session) => session.id === fixture.sessionId)?.draft; if (draft) editor.receive(draft); });
  let first: Promise<CommandResult> | undefined, second: Promise<CommandResult> | undefined;
  try {
    const path = join(fixture.directory, "generated-queued-draft.txt"); await writeFile(path, "Generated owned queued context.");
    editor.edit(`/attach-file ${path}`); first = editor.submit((expectedDraftRevision) => sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision }));
    await accepted.promise;
    const attachment = await waitFor(() => fixture.session().draft.attachments[0]);
    assert.equal(editor.getState().text, "");
    editor.edit(`/attached ${attachment.id}`);
    second = editor.submit((expectedDraftRevision) => sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision }));
    release.resolve(); await first; await second;
    await waitFor(() => fixture.service.controller.snapshot().commandExecutions.filter((entry) => entry.status === "completed").length === 2);
    assert.equal(editor.getState().conflict, false); assert.equal(fixture.session().draft.text, "");
    assert.equal(fixture.session().draft.attachments[0]?.id, attachment.id); assert.equal(fixture.requests.length, 0);
    const read = fixture.service.controller.snapshot().commandExecutions.find((entry) => entry.name === "attached")!;
    assert.match(JSON.stringify((await sdk.commands.read(read.id)).result), /Generated owned queued context/);
  } finally {
    release.resolve(); await Promise.allSettled([first, second].filter((value): value is Promise<CommandResult> => value !== undefined));
    unsubscribe(); editor.dispose(); sdk.disconnect(); await fixture.close();
  }
});

test("an explicitly queued restore preserves an archived draft and never releases older held model work", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    editor.edit("Generated earlier held model work."); const earlier = await editor.send("queue", true);
    editor.edit("Generated archived draft must survive."); await editor.flush();
    await sdk.command({ type: "session.archive", sessionId: fixture.sessionId });
    const original = structuredClone(fixture.session().draft), queued = await sdk.commands.restore(fixture.sessionId, "cli", fixture.session().revision, true);
    assert.equal(fixture.session().status, "archived"); assert.deepEqual(fixture.session().draft, original);
    assert.ok(fixture.session().queue.every((item) => item.held));
    await sdk.prompts.release(fixture.sessionId, queued.id!, fixture.session().queueRevision);
    await waitFor(() => fixture.service.controller.snapshot().commandExecutions.some((entry) => entry.name === "restore" && entry.status === "completed"));
    assert.notEqual(fixture.session().status, "archived"); assert.deepEqual(fixture.session().draft, original); assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.session().queue.length, 1); assert.equal(fixture.session().queue[0]?.id, earlier.id); assert.equal(fixture.session().queue[0]?.held, true);
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});

test("a genuinely foreign draft cannot borrow the queued command's merge provenance while intake acknowledgement waits", { timeout: 10000 }, async () => {
  const accepted = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  class DelayedIntake extends MoguriSdk {
    override async command(command: Command, id = crypto.randomUUID()): Promise<CommandResult> {
      const result = await super.command(command, id);
      if (command.type === "message.send") { accepted.resolve(); await release.promise; }
      return result;
    }
  }
  const fixture = await setupFixture(), sdk = await new DelayedIntake(fixture.service.connection).ready(), peer = await new MoguriSdk(fixture.service.connection).ready();
  const editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft), unsubscribe = sdk.subscribe(() => {
    const saved = sdk.getState().snapshot?.sessions.find((session) => session.id === fixture.sessionId)?.draft; if (saved) editor.receive(saved);
  });
  let pending: Promise<CommandResult> | undefined;
  try {
    editor.edit("/theme rose"); pending = editor.submit((expectedDraftRevision) => sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision, held: true }));
    await accepted.promise;
    editor.edit("Generated newer local text.");
    await peer.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated actual foreign draft.", attachments: [] });
    await sdk.refresh(); release.resolve(); await pending;
    assert.equal(editor.getState().conflict, true); assert.equal(editor.getState().text, "Generated newer local text.");
    assert.equal(fixture.session().draft.text, "Generated actual foreign draft."); assert.equal(fixture.requests.length, 0);
    const count = fixture.service.store.events().length;
    assert.throws(() => fixture.service.controller.dispatch({ id: crypto.randomUUID(), profileId: "default", command: { type: "draft.save",
      sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated forged owner.", attachments: [],
      source: { actor: "user", executionId: "generated-forged", inputId: "generated-forged" } } }), /protocol schema/);
    assert.equal(fixture.service.store.events().length, count);
  } finally {
    release.resolve(); if (pending) await Promise.allSettled([pending]);
    unsubscribe(); editor.dispose(); sdk.disconnect(); peer.disconnect(); await fixture.close();
  }
});
