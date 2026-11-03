import assert from "node:assert/strict";
import { test } from "node:test";
import { DraftEditor } from "../packages/client/src/draft.ts";
import { ClientError, MoguriClient } from "../packages/client/src/index.ts";
import type { CommandResult } from "../packages/protocol/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("shared draft editors preserve conflicting local text until the user explicitly resolves it", async () => {
  const fixture = await setupFixture();
  const a = new MoguriClient(fixture.service.connection);
  const b = new MoguriClient(fixture.service.connection);
  let first: DraftEditor | undefined;
  let second: DraftEditor | undefined;
  try {
    await Promise.all([a.connect(), b.connect()]);
    await waitFor(() => a.getState().status === "connected" && b.getState().status === "connected");
    first = new DraftEditor(a, fixture.sessionId, fixture.session().draft);
    second = new DraftEditor(b, fixture.sessionId, fixture.session().draft);
    second.edit("generated unsent second-client text");
    first.edit("generated saved first-client text");
    await first.flush();
    second.receive(fixture.session().draft);
    assert.equal(second.getState().conflict, true);
    assert.equal(second.getState().text, "generated unsent second-client text");
    assert.equal(fixture.session().draft.text, "generated saved first-client text");
    await second.keepMine();
    assert.equal(fixture.session().draft.text, "generated unsent second-client text");
    assert.equal(second.getState().dirty, false);
    first.receive(fixture.session().draft);
    assert.equal(first.getState().text, "generated unsent second-client text");
  } finally { first?.dispose(); second?.dispose(); a.disconnect(); b.disconnect(); await fixture.close(); }
});

test("only canonically undispatched autosaves resume after the original client reconnects", async () => {
  const f = await setupFixture(), client = new MoguriClient(f.service.connection);
  let editor: DraftEditor | undefined;
  try {
    await client.connect(); await waitFor(() => client.getState().status === "connected");
    editor = new DraftEditor(client, f.sessionId, f.session().draft);
    client.disconnect(); editor.edit("Generated undispatched draft.");
    await assert.rejects(() => editor!.flush(), { code: "disconnected" });
    assert.equal(f.session().draft.revision, 0);
    await client.connect(); await waitFor(() => !editor!.getState().dirty && !editor!.getState().saving);
    assert.equal(f.session().draft.text, "Generated undispatched draft.");
    assert.equal(f.service.controller.events(0).filter((event) => event.event_type === "draft.saved").length, 1);
    assert.equal(f.requests.length, 0);
  } finally { editor?.dispose(); client.disconnect(); await f.close(); }
});

test("reconnected unsent autosaves preserve another client's newer revision as a visible conflict", async () => {
  const f = await setupFixture(), client = new MoguriClient(f.service.connection), peer = new MoguriClient(f.service.connection);
  let editor: DraftEditor | undefined;
  try {
    await Promise.all([client.connect(), peer.connect()]);
    await waitFor(() => client.getState().status === "connected" && peer.getState().status === "connected");
    editor = new DraftEditor(client, f.sessionId, f.session().draft);
    client.disconnect(); editor.edit("Generated preserved offline edit.");
    await assert.rejects(() => editor!.flush(), { code: "disconnected" });
    await peer.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: 0, text: "Generated newer peer edit.", attachments: [] });
    await client.connect(); await waitFor(() => editor!.getState().conflict);
    assert.equal(editor.getState().text, "Generated preserved offline edit.");
    assert.equal(f.session().draft.text, "Generated newer peer edit.");
    assert.equal(f.service.controller.events(0).filter((event) => event.event_type === "draft.saved").length, 1);
  } finally { editor?.dispose(); client.disconnect(); peer.disconnect(); await f.close(); }
});

test("unknown dispatched draft outcomes are never automatically retried after reconnect", async () => {
  class UnknownDraftClient extends MoguriClient {
    draftAttempts = 0;
    override async command(...args: Parameters<MoguriClient["command"]>): Promise<CommandResult> {
      if (args[0].type === "draft.save") this.draftAttempts++;
      const result = await super.command(...args);
      if (args[0].type === "draft.save") throw new ClientError("command_outcome_unknown", "Generated acknowledgement remains unknown.");
      return result;
    }
  }
  const f = await setupFixture(), client = new UnknownDraftClient(f.service.connection);
  let editor: DraftEditor | undefined;
  try {
    await client.connect(); await waitFor(() => client.getState().status === "connected");
    editor = new DraftEditor(client, f.sessionId, f.session().draft);
    editor.edit("Generated dispatched original.");
    await assert.rejects(() => editor!.flush(), { code: "command_outcome_unknown" });
    client.disconnect(); await client.connect(); await waitFor(() => client.getState().status === "connected");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(client.draftAttempts, 1); assert.equal(editor.getState().dirty, true);
    assert.equal(editor.getState().text, "Generated dispatched original.");
    assert.equal(f.service.controller.events(0).filter((event) => event.event_type === "draft.saved").length, 1);
  } finally { editor?.dispose(); client.disconnect(); await f.close(); }
});

test("a submitted draft stays represented while its original input is awaiting acknowledgement", async () => {
  const gate = Promise.withResolvers<void>();
  class HeldInputClient extends MoguriClient {
    entered = false;
    override async command(...args: Parameters<MoguriClient["command"]>): Promise<CommandResult> {
      if (args[0].type === "message.send") { this.entered = true; await gate.promise; }
      return super.command(...args);
    }
  }
  const f = await setupFixture(), client = new HeldInputClient(f.service.connection);
  let editor: DraftEditor | undefined;
  let sending: Promise<CommandResult> | undefined;
  try {
    await client.connect(); await waitFor(() => client.getState().status === "connected");
    editor = new DraftEditor(client, f.sessionId, f.session().draft);
    editor.edit("Generated original in-flight prompt.");
    sending = editor.send("queue", true);
    await waitFor(() => client.entered);
    assert.equal(editor.getState().text, "");
    assert.deepEqual(editor.getState().pendingInput, {
      text: "Generated original in-flight prompt.", attachments: [], delivery: "queue", held: true,
    });
    assert.equal(f.session().queue.length, 0);
    editor.edit("Generated newer unsent draft.");
    assert.equal(editor.getState().pendingInput?.text, "Generated original in-flight prompt.");
    gate.resolve(); await sending;
    assert.equal(editor.getState().pendingInput, null);
    assert.equal(f.session().queue[0]?.text, "Generated original in-flight prompt.");
    assert.equal(f.session().queue[0]?.held, true);
    assert.equal(editor.getState().text, "Generated newer unsent draft.");
    await editor.flush();
    assert.equal(f.session().draft.text, "Generated newer unsent draft.");
    assert.equal(f.requests.length, 0);
  } finally { gate.resolve(); await sending; editor?.dispose(); client.disconnect(); await f.close(); }
});

test("a refused pending input restores its exact draft without retaining a sending row or replaying it", async () => {
  const gate = Promise.withResolvers<void>();
  class RefusedInputClient extends MoguriClient {
    attempts = 0;
    override async command(...args: Parameters<MoguriClient["command"]>): Promise<CommandResult> {
      if (args[0].type === "message.send") {
        this.attempts++; await gate.promise;
        throw new ClientError("generated_input_refused", "Generated original input was refused.");
      }
      return super.command(...args);
    }
  }
  const f = await setupFixture(), client = new RefusedInputClient(f.service.connection);
  let editor: DraftEditor | undefined;
  try {
    await client.connect(); await waitFor(() => client.getState().status === "connected");
    editor = new DraftEditor(client, f.sessionId, f.session().draft);
    editor.edit("Generated refused original.");
    const sending = editor.send("queue", true);
    const failed = assert.rejects(sending, { code: "generated_input_refused" });
    await waitFor(() => client.attempts === 1);
    assert.equal(editor.getState().pendingInput?.text, "Generated refused original.");
    gate.resolve(); await failed;
    assert.equal(editor.getState().pendingInput, null);
    assert.equal(editor.getState().text, "Generated refused original.");
    assert.match(editor.getState().error!, /Generated original input was refused/);
    assert.equal(f.session().queue.length, 0);
    assert.equal(client.attempts, 1);
    assert.equal(f.requests.length, 0);
  } finally { gate.resolve(); editor?.dispose(); client.disconnect(); await f.close(); }
});

test("unknown input acknowledgement clears only the local sending state and never resends its retained original", async () => {
  const gate = Promise.withResolvers<void>();
  class UnknownInputClient extends MoguriClient {
    attempts = 0;
    override async command(...args: Parameters<MoguriClient["command"]>): Promise<CommandResult> {
      if (args[0].type === "message.send") { this.attempts++; await gate.promise; }
      const result = await super.command(...args);
      if (args[0].type === "message.send") throw new ClientError("command_outcome_unknown", "Generated original acknowledgement was lost.");
      return result;
    }
  }
  const f = await setupFixture(), client = new UnknownInputClient(f.service.connection);
  let editor: DraftEditor | undefined;
  try {
    await client.connect(); await waitFor(() => client.getState().status === "connected");
    editor = new DraftEditor(client, f.sessionId, f.session().draft);
    editor.edit("Generated input with unknown acknowledgement.");
    const sending = editor.send("queue", true), failed = assert.rejects(sending, { code: "command_outcome_unknown" });
    await waitFor(() => client.attempts === 1);
    assert.equal(editor.getState().pendingInput?.text, "Generated input with unknown acknowledgement.");
    gate.resolve(); await failed;
    assert.equal(editor.getState().pendingInput, null);
    assert.equal(editor.getState().text, "Generated input with unknown acknowledgement.");
    assert.match(editor.getState().error!, /Inspect the original queue before retrying/);
    assert.equal(f.session().queue.length, 1);
    assert.equal(f.session().queue[0]?.held, true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(client.attempts, 1);
    assert.equal(f.requests.length, 0);
  } finally { gate.resolve(); editor?.dispose(); client.disconnect(); await f.close(); }
});
