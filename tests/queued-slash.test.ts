import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DraftEditor, MoguriSdk, isRecord, type CommandClientAttachment, type CommandViewHandler } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("one service queue runs held model and theme commands in order after every text client disconnects, without model inference", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    assert.equal(fixture.session().controls.modelId, null);
    for (const text of [`/model ${fixture.modelId}`, "/theme crystal light"]) {
      editor.edit(text); await editor.flush();
      await sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision: fixture.session().draft.revision, held: true });
      editor.receive(fixture.session().draft);
    }
    assert.equal(fixture.session().queue.length, 2);
    assert.ok(fixture.session().queue.every((item) => item.held && item.command?.version === 1));
    sdk.disconnect();
    await fixture.service.controller.dispatch({ id: "generated-headless-command-release", profileId: "default",
      command: { type: "session.resume", sessionId: fixture.sessionId } });
    await waitFor(() => fixture.service.controller.snapshot().settings.values.appearance.palette === "crystal");
    const snapshot = fixture.service.controller.snapshot();
    assert.equal(fixture.session().controls.modelId, fixture.modelId);
    assert.equal(snapshot.settings.values.appearance.theme, "light");
    assert.equal(fixture.session().queue.length, 0);
    assert.equal(snapshot.commandExecutions.filter((entry) => entry.sessionId === fixture.sessionId && entry.status === "completed").length, 2);
    assert.equal(snapshot.budgetEntries.length, 0); assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.session().messages.some((message) => message.role === "user" && message.text.startsWith("/")), false);
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});

test("commands share prompt ordering and never enter either model request as raw slash text", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    for (const text of [`/model ${fixture.modelId}`, "Generated first ordered prompt.", "/theme terminal dark", "Generated second ordered prompt."]) {
      editor.edit(text); await editor.flush();
      await sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision: fixture.session().draft.revision, held: true });
      editor.receive(fixture.session().draft);
    }
    sdk.disconnect();
    await fixture.service.controller.dispatch({ id: "generated-headless-mixed-release", profileId: "default", command: { type: "session.resume", sessionId: fixture.sessionId } });
    await waitFor(() => fixture.requests.length === 2 && fixture.session().status === "completed");
    const snapshot = fixture.service.controller.snapshot();
    assert.equal(snapshot.settings.values.appearance.palette, "terminal");
    assert.deepEqual(fixture.session().messages.filter((message) => message.role === "user").map((message) => message.text),
      ["Generated first ordered prompt.", "Generated second ordered prompt."]);
    assert.equal(JSON.stringify(fixture.requests).includes("/theme terminal"), false);
    assert.equal(JSON.stringify(fixture.requests).includes(`/model ${fixture.modelId}`), false);
    const history = fixture.service.controller.events(0);
    const starts = history.filter((event) => event.event_type === "turn.started").map((event) => event.seq);
    const theme = history.find((event) => event.event_type === "slash.command_recorded" && event.payload.execution.name === "theme" && event.payload.execution.revision === 0)!;
    assert.ok(starts[0]! < theme.seq && theme.seq < starts[1]!);
    assert.equal(snapshot.budgetEntries.length, 2);
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});

test("a failed queued model selection preserves its exact input and holds later work instead of using the old model", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    await fixture.configure(); await sdk.refresh();
    for (const text of ["/model generated-unavailable-model", "Generated must not use a previous model."]) {
      editor.edit(text); await editor.flush();
      await sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision: fixture.session().draft.revision, held: true });
      editor.receive(fixture.session().draft);
    }
    await sdk.command({ type: "session.resume", sessionId: fixture.sessionId });
    const failed = await waitFor(() => fixture.service.controller.snapshot().commandExecutions.find((entry) => entry.status === "failed"));
    assert.equal(failed.name, "model"); assert.equal(failed.actor, "user");
    assert.equal(fixture.session().queue.length, 1); assert.equal(fixture.session().queue[0]?.held, true);
    assert.equal(fixture.requests.length, 0);
    assert.match(fixture.service.store.blob(failed.inputDigest), /generated-unavailable-model/);
    assert.equal(failed.resultDigest, null);
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});

test("a queued file read refuses a replaced source inode before reading the replacement or dispatching a model", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    editor.edit("/file fixture.txt"); await editor.flush();
    await sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision: fixture.session().draft.revision, held: true });
    await rename(fixture.project, `${fixture.project}-original`); await mkdir(fixture.project);
    await writeFile(join(fixture.project, "fixture.txt"), "GENERATED_REPLACEMENT_SOURCE_MUST_NOT_BE_READ");
    await sdk.command({ type: "session.resume", sessionId: fixture.sessionId });
    const failed = await waitFor(() => fixture.service.controller.snapshot().commandExecutions.find((entry) => entry.status === "failed"));
    assert.match(failed.diagnostic ?? "", /original.*root changed|profile, Env or root changed/i);
    assert.equal(failed.resultDigest, null); assert.equal(fixture.requests.length, 0);
    assert.equal(JSON.stringify(fixture.service.controller.events(0)).includes("GENERATED_REPLACEMENT_SOURCE_MUST_NOT_BE_READ"), false);
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});

test("a disconnected text client ignores a late real invalidation instead of scheduling another snapshot request", { timeout: 10000 }, async (t) => {
  const OriginalSocket = globalThis.WebSocket, sockets: DelayedSocket[] = [];
  class DelayedSocket extends OriginalSocket {
    constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); sockets.push(this); }
    override close(): void {}
    release(): void { super.close(); }
  }
  globalThis.WebSocket = DelayedSocket;
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const socket = sockets[0]!, delivered = Promise.withResolvers<void>();
    socket.addEventListener("message", (event) => {
      const frame: unknown = JSON.parse(String(event.data));
      if (isRecord(frame) && frame.type === "invalidate") delivered.resolve();
    });
    const timers = t.mock.method(globalThis, "setTimeout");
    sdk.disconnect();
    fixture.service.controller.emit("change", []);
    await delivered.promise;
    assert.equal(timers.mock.calls.filter((call) => call.arguments[1] === 40).length, 0,
      "A late invalidation cannot create a fresh read timer after the actual client disconnect.");
    assert.equal(sdk.getState().status, "disconnected");
  } finally { sdk.disconnect(); for (const socket of sockets) socket.release(); globalThis.WebSocket = OriginalSocket; await fixture.close(); }
});

test("one compatible client claims a UI-only result and later prompts wait for its exact real acknowledgement", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready(), peer = await new MoguriSdk(fixture.service.connection).ready();
  const editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft), gate = Promise.withResolvers<void>(), errors: string[] = [];
  let first: CommandClientAttachment | undefined, second: CommandClientAttachment | undefined, applied = 0;
  const handler: CommandViewHandler = async (context) => {
    applied++; assert.equal(context.sessionId, fixture.sessionId); assert.equal(context.result.kind, "panel");
    await gate.promise; context.signal.throwIfAborted(); return { outcome: "completed" };
  };
  try {
    await fixture.configure(); await sdk.refresh(); await peer.refresh();
    first = await sdk.commands.attach("cli", { panel: handler }, { onError: (error) => errors.push(error.message) });
    second = await peer.commands.attach("cli", { panel: handler }, { onError: (error) => errors.push(error.message) });
    for (const text of ["/queue", "Generated prompt after actual UI acknowledgement."]) {
      editor.edit(text); await editor.flush();
      await sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision: fixture.session().draft.revision, held: true });
      editor.receive(fixture.session().draft);
    }
    await sdk.command({ type: "session.resume", sessionId: fixture.sessionId });
    const claimed = await waitFor(() => fixture.service.controller.snapshot().commandExecutions.find((entry) => entry.status === "claimed"));
    await waitFor(() => applied === 1);
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.session().queue.length, 1);
    const foreign = claimed.claim?.clientId === first.clientId ? second.clientId : first.clientId;
    await assert.rejects(() => sdk.commands.complete(foreign, claimed.id, claimed.revision, "0".repeat(64), { outcome: "completed" }), { code: "command_claim" });
    gate.resolve();
    await waitFor(() => fixture.requests.length === 1 && fixture.session().status === "completed");
    assert.equal(applied, 1); assert.equal(fixture.service.controller.snapshot().commandExecutions[0]?.status, "completed");
    assert.deepEqual(errors, []);
  } finally { gate.resolve(); await first?.dispose(); await second?.dispose(); editor.dispose(); sdk.disconnect(); peer.disconnect(); await fixture.close(); }
});

test("editing a held command rebinds its actual new command intent instead of replaying stale arguments", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    editor.edit("/theme rose"); await editor.flush();
    const queued = await sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision: fixture.session().draft.revision, held: true });
    await sdk.command({ type: "queue.edit", sessionId: fixture.sessionId, messageId: queued.id!, expectedRevision: fixture.session().queueRevision, text: "/theme crystal light" });
    assert.equal(fixture.session().queue[0]?.command?.argument, "crystal light");
    await sdk.command({ type: "queue.release", sessionId: fixture.sessionId, messageId: queued.id!, expectedRevision: fixture.session().queueRevision });
    await waitFor(() => fixture.service.controller.snapshot().commandExecutions.some((entry) => entry.status === "completed"));
    assert.equal(fixture.service.controller.snapshot().settings.values.appearance.palette, "crystal");
    assert.equal(fixture.service.controller.snapshot().settings.values.appearance.theme, "light");
    assert.equal(fixture.requests.length, 0);
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});

test("service-capable former TUI commands finish headlessly instead of waiting for a terminal view", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    for (const text of ["/notifications", "/defaults", "/board", "/issue create feature Generated headless card"]) {
      editor.edit(text); await editor.submit((expectedDraftRevision) => sdk.commands.submit(fixture.sessionId, { client: "tui", expectedDraftRevision, held: true }));
    }
    sdk.disconnect();
    await fixture.service.controller.dispatch({ id: "generated-headless-former-tui-release", profileId: "default", command: { type: "session.resume", sessionId: fixture.sessionId } });
    await waitFor(() => fixture.service.controller.snapshot().commandExecutions.filter((entry) => entry.status === "completed").length === 4);
    assert.ok(fixture.service.controller.snapshot().issues.some((issue) => issue.title === "Generated headless card"));
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.session().queue.length, 0);
    assert.equal(fixture.session().messages.length, 0);
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});

test("non-model commands preserve composer attachments rather than silently consuming unrelated context", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    await editor.attach("fixture.txt"); const original = editor.getState().attachments;
    editor.edit("/theme rose");
    await editor.submit((expectedDraftRevision) => sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision }));
    await waitFor(() => fixture.service.controller.snapshot().commandExecutions.some((entry) => entry.status === "completed"));
    assert.deepEqual(fixture.session().draft.attachments, original);
    assert.equal(fixture.session().draft.text, ""); assert.equal(fixture.requests.length, 0);
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});

test("a queued side question uses original input context without consuming the newer main draft", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready(), editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    await fixture.configure(); await sdk.refresh(); await editor.attach("fixture.txt");
    editor.edit("/side Generated queued read-only question.");
    await editor.submit((expectedDraftRevision) => sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision, held: true }));
    assert.equal(fixture.session().draft.attachments.length, 0);
    editor.edit("Generated newer main draft that must not be sent."); await editor.flush();
    await sdk.command({ type: "session.resume", sessionId: fixture.sessionId });
    const side = await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.kind === "side" && session.status === "completed"));
    assert.equal(side.mode, "read-only"); assert.equal(fixture.requests.length, 1);
    assert.match(JSON.stringify(fixture.requests[0]), /fixture\.txt/);
    assert.equal(JSON.stringify(fixture.requests[0]).includes("Generated newer main draft"), false);
    assert.equal(fixture.session().draft.text, "Generated newer main draft that must not be sent.");
    assert.equal(fixture.session().messages.length, 0);
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});

test("typed interrupt stays ordered and derives its exact follow-up without interrupting an earlier model or consuming a newer draft", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready(), editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    await fixture.configure(); await sdk.refresh(); await fixture.send("generated slow original follow-up boundary");
    await waitFor(() => fixture.requests.length === 1); const turnId = fixture.session().turnId;
    await sdk.refresh(); editor.receive(fixture.session().draft);
    for (const text of ["/interrupt Generated exact queued follow-up.", "Generated later ordinary prompt."]) {
      editor.edit(text); await editor.submit((expectedDraftRevision) => sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision }));
    }
    assert.equal(fixture.session().turnId, turnId); assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "turn.stop_requested"), false);
    editor.edit("Generated newer composer remains unsent."); await editor.flush();
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); await fixture.terminal();
    await sdk.command({ type: "session.resume", sessionId: fixture.sessionId });
    await waitFor(() => fixture.requests.length === 3 && fixture.session().status === "completed");
    assert.deepEqual(fixture.session().messages.filter((message) => message.role === "user").map((message) => message.text),
      ["generated slow original follow-up boundary", "Generated exact queued follow-up.", "Generated later ordinary prompt."]);
    assert.equal(fixture.session().draft.text, "Generated newer composer remains unsent.");
    await assert.rejects(() => sdk.command({ type: "slash.prompt.enqueue", sessionId: fixture.sessionId }), { code: "command_source" });
    assert.equal(fixture.requests.length, 3);
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});
