import assert from "node:assert/strict";
import { test } from "node:test";
import { DraftEditor, MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { textFilePage } from "../apps/service/src/files.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";
import { holdRemoteFrame } from "./fixtures/remote-frame-gate.ts";
import { digest } from "../apps/service/src/store.ts";

test("shared send keeps exactly 50 lines inline and retains 51 exact lines as a scoped file, including project-free held queues", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const short = Array.from({ length: 50 }, (_, index) => `Generated line ${index + 1}`).join("\r\n");
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: short, attachments: [] });
    await sdk.command({ type: "message.send", sessionId: fixture.sessionId, expectedRevision: 1, delivery: "queue", held: true });
    assert.equal(fixture.session().queue[0]?.text, short);
    assert.deepEqual(fixture.session().queue[0]?.attachments, []);
    const created = await sdk.sessions.create(null, "Generated project-free paste");
    const text = `${short}\r\nGenerated exact final line \u{1f34a}`;
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text, attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue", held: true });
    const queued = sdk.getState().snapshot!.sessions.find((session) => session.id === created.id)!.queue[0]!;
    assert.equal(queued.text, "");
    assert.equal(queued.attachments.length, 1);
    assert.equal(queued.attachments[0]?.kind, "paste_file");
    assert.equal(queued.attachments[0]?.bytes, Buffer.byteLength(text));
    const read = await sdk.attachments.read(created.id!, queued.attachments[0]!.id);
    assert.deepEqual(read.content, { kind: "text", text });
    await assert.rejects(() => sdk.attachments.read(fixture.sessionId, queued.attachments[0]!.id), /grant|scope/i);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("UTF-8 file pages and literal searches remain bounded without splitting or dropping characters", () => {
  const text = "A\u{1f34a}BC\r\nGenerated selected section";
  const first = textFilePage(text, { limit: 4 });
  assert.equal(first.text, "A"); assert.equal(first.nextOffset, 1);
  const second = textFilePage(text, { offset: first.nextOffset!, limit: 4 });
  assert.equal(second.text, "\u{1f34a}"); assert.equal(second.nextOffset, 5);
  assert.throws(() => textFilePage(text, { offset: 2 }), /splits.*UTF-8/);
  assert.throws(() => textFilePage(text, { offset: 1, limit: 1 }), /cannot contain/);
  assert.equal(textFilePage(text, { search: "missing" }).matchOffset, null);
  assert.equal(textFilePage(text, { search: "Generated", limit: 9 }).text, "Generated");
  assert.throws(() => textFilePage(text, { limit: 16385 }), /16,384/);
});

test("failed persistence and UTF-8 byte limits preserve the exact long paste and original saved draft", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    editor.edit("Generated original draft"); await editor.flush();
    const pasted = Array.from({ length: 51 }, (_, index) => `Generated failed-persistence ${index}\r\n`).join("");
    fixture.service.store.db.exec(`CREATE TRIGGER generated_paste_failure BEFORE INSERT ON events
      WHEN json_extract(NEW.data,'$.event_type')='draft.saved' BEGIN SELECT RAISE(ABORT,'Generated paste persistence failure'); END;`);
    await assert.rejects(() => editor.paste(pasted), /failure|failed/i);
    assert.equal(editor.getState().text, `Generated original draft${pasted}`);
    assert.equal(editor.getState().dirty, true);
    assert.equal(fixture.session().draft.text, "Generated original draft");
    assert.deepEqual(fixture.session().draft.attachments, []);
    fixture.service.store.db.exec("DROP TRIGGER generated_paste_failure");
    editor.receive(fixture.session().draft); editor.reload();
    const tooLarge = `${"\u{1f34a}".repeat(32768)}${"\n".repeat(51)}`;
    await assert.rejects(() => editor.paste(tooLarge), /128 KiB/);
    assert.equal(editor.getState().text, `Generated original draft${tooLarge}`);
    assert.equal(fixture.session().draft.text, "Generated original draft");
    assert.deepEqual(fixture.session().draft.attachments, []);
    assert.equal(fixture.requests.length, 0);
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});

test("two clients cannot consume the same draft revision and the losing exact paste stays unsent", async () => {
  const fixture = await setupFixture(), first = await new MoguriSdk(fixture.service.connection).ready(), second = await new MoguriSdk(fixture.service.connection).ready();
  const editors = [new DraftEditor(first, fixture.sessionId, fixture.session().draft), new DraftEditor(second, fixture.sessionId, fixture.session().draft)];
  const texts = ["A", "B"].map((prefix) => Array.from({ length: 51 }, (_, index) => `Generated ${prefix} ${index}`).join("\r"));
  try {
    const results = await Promise.allSettled(editors.map((editor, index) => editor.paste(texts[index]!)));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const failed = results.findIndex((result) => result.status === "rejected");
    assert.equal(editors[failed]!.getState().text, texts[failed]);
    assert.equal(editors[failed]!.getState().conflict, true);
    assert.equal(fixture.session().draft.attachments.length, 1);
    assert.equal(fixture.requests.length, 0);
  } finally { for (const editor of editors) editor.dispose(); first.disconnect(); second.disconnect(); await fixture.close(); }
});

test("edits arriving during an acknowledged capture remain a conflict instead of being silently discarded", async (t) => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  const command = sdk.command.bind(sdk); let held = false, release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  t.mock.method(sdk, "command", async (...args: Parameters<typeof command>) => {
    if (args[0].type === "draft.paste") { held = true; await gate; }
    return command(...args);
  });
  try {
    const text = Array.from({ length: 51 }, (_, index) => `Generated overlapping edit ${index}`).join("\n");
    const capturing = editor.paste(text); await waitFor(() => held);
    editor.edit(`Generated concurrent prefix\n${editor.getState().text}`);
    release(); await assert.rejects(() => capturing, /changed while.*saving/i);
    assert.equal(editor.getState().text, `Generated concurrent prefix\n${text}`);
    assert.equal(editor.getState().conflict, true);
    assert.equal(fixture.session().draft.attachments.length, 1);
    assert.equal(fixture.session().draft.text, "");
  } finally { release(); editor.dispose(); sdk.disconnect(); await fixture.close(); }
});

test("Remote scoped-file reads use authenticated owned frames and a policy change invalidates an earlier approval", { skip: process.platform !== "darwin", timeout: 25_000 }, async (t) => {
  const fixture = await remoteFixture({ readPaste: { search: "Generated selected section", limit: 64 } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const gate = holdRemoteFrame(t, fixture.service.controller.remote, "delegate");
  try {
    await fixture.probe(); await fixture.select();
    const text = Array.from({ length: 51 }, (_, index) => index === 40 ? "Generated selected section ONLY_IN_SCOPED_FILE" : `Generated retained-only Remote ${index}`).join("\r\n");
    await fixture.send(text); await waitFor(() => gate.held);
    const settings = structuredClone(sdk.settings.get()!.values);
    settings.permissions.tools.push({ id: "generated-unrelated-revocation", tool: "write_file", pathPrefix: "generated-unrelated", decision: "deny" });
    await sdk.settings.update(settings, sdk.settings.get()!.revision);
    gate.release(); await fixture.terminal();
    const result = fixture.session().messages.find((message) => message.role === "tool")!;
    assert.equal(result.outcome, "failed");
    assert.match(result.text, /stale|changed|expired/i);
    assert.equal(JSON.stringify(fixture.requests).includes("ONLY_IN_SCOPED_FILE"), false);
    assert.equal(fixture.service.controller.snapshot().executions[0]?.workspace, fixture.workspace);
  } finally { gate.release(); gate.restore(); sdk.disconnect(); await fixture.close(); }
});

test("an actual pinned SSH worker reads only the explicitly approved paste page without any local checkout write", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const fixture = await remoteFixture({ readPaste: { search: "Generated selected section", limit: 64 } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.probe(); await fixture.select();
    const text = Array.from({ length: 51 }, (_, index) => index === 40 ? "Generated selected section REMOTE_PAGE_PROOF" : `Generated retained-only Remote ${index}`).join("\r\n");
    await fixture.send(text);
    assert.equal((await fixture.terminal()).status, "completed");
    const result = fixture.session().messages.find((message) => message.role === "tool")!;
    assert.equal(result.outcome, "completed");
    const page = JSON.parse(result.text);
    assert.equal(page.boundary, "scoped-controller-snapshot");
    assert.ok(Buffer.byteLength(page.text) <= 64);
    assert.match(page.text, /REMOTE_PAGE_PROOF/);
    assert.equal(JSON.stringify(fixture.requests[0]).includes("REMOTE_PAGE_PROOF"), false);
    assert.equal(fixture.service.controller.snapshot().executions[0]?.workspace, fixture.workspace);
    assert.equal(fixture.requests.length, 2);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("context preview sizes the pending file descriptor without retaining or injecting its large source body", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ contextWindow: 16384 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const created = await sdk.sessions.create(null, "Generated paste preview", { modelId: fixture.modelId, modelOptions: { contextWindow: 8192 } });
    const text = Array.from({ length: 51 }, (_, index) => `Generated withheld source ${index} ${"x".repeat(1800)}`).join("\n"), hash = digest(text);
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text, attachments: [] });
    assert.throws(() => fixture.service.store.blob(hash), /missing|grant/i);
    const seq = fixture.service.controller.snapshot().seq;
    const preview = (await sdk.sessions.context(created.id!)).context;
    assert.equal(fixture.service.controller.snapshot().seq, seq);
    assert.throws(() => fixture.service.store.blob(hash), /missing|grant/i);
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    const session = () => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)!;
    await waitFor(() => !session().turnId && session().status === "completed");
    assert.equal(preview.estimatedTokens, session().usage[0]?.contextEstimate);
    assert.ok(preview.estimatedTokens + 4096 < 8192);
    assert.equal(JSON.stringify(fixture.requests).includes("Generated withheld source"), false);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the shared editor captures a long paste immediately without normalizing CRLF or losing surrounding unsent text", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    editor.edit("Before SELECT After");
    const pasted = Array.from({ length: 51 }, (_, index) => `Generated clipboard ${index} \u{1f34a}`).join("\r\n");
    await editor.paste(pasted, 7, 13);
    assert.equal(editor.getState().text, "Before  After");
    assert.equal(editor.getState().dirty, false);
    assert.equal(fixture.session().draft.text, "Before  After");
    const attachment = fixture.session().draft.attachments[0]!;
    assert.equal(attachment.kind, "paste_file");
    assert.deepEqual((await sdk.attachments.read(fixture.sessionId, attachment.id)).content, { kind: "text", text: pasted });
    assert.equal(fixture.requests.length, 0);
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});

test("a project-free owned worker receives only paste metadata, then uses its approved bounded file search", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ readPaste: { search: "Generated selected section", limit: 64 } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const created = await sdk.sessions.create(null, "Generated bounded paste read", { modelId: fixture.modelId });
    const session = () => fixture.service.controller.snapshot().sessions.find((item) => item.id === created.id)!;
    const text = Array.from({ length: 51 }, (_, index) => index === 40 ? "Generated selected section \u{1f34a}\r\n" : `Generated retained-only ${index} ${"x".repeat(100)}\r\n`).join("");
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text, attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => !session().turnId && session().status === "completed");
    assert.equal(session().pendingApproval, null);
    assert.equal(JSON.stringify(fixture.requests[0]).includes("Generated retained-only"), false);
    const result = session().messages.find((message) => message.role === "tool")!;
    assert.equal(result.outcome, "completed");
    assert.match(result.text, /Generated selected section/);
    assert.ok(Buffer.byteLength(result.text) < 1024);
    assert.equal(JSON.stringify(fixture.requests).includes("Generated retained-only 0 "), false);
    assert.equal(fixture.requests.length, 2);
    assert.deepEqual(session().draft.attachments, []);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("explicit child context copies retain their own scoped file grant after source-session deletion", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    const text = Array.from({ length: 51 }, (_, index) => `Generated inherited pasted file ${index}`).join("\r\n");
    await fixture.send(text); await fixture.terminal();
    const file = fixture.session().messages.find((message) => message.role === "user")!.attachments![0]!;
    const side = await sdk.sessions.spawn(fixture.sessionId, "side", "Generated inherited file");
    await sdk.sessions.delete(fixture.sessionId, true);
    assert.deepEqual((await sdk.attachments.read(side.id!, file.id)).content, { kind: "text", text });
    assert.equal(fixture.service.controller.platform.inputs.scopedFile(side.id!, file.path).digest, file.digest);
    assert.equal(fixture.requests.length, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a settings-only chat preserves a pasted file and blocks before inference when no file tool is exposed", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const created = await sdk.metachat.create(null);
    const session = () => fixture.service.controller.snapshot().sessions.find((session) => session.id === created.id)!;
    await sdk.sessions.configure(created.id!, { ...session().controls, modelId: fixture.modelId });
    await sdk.attachments.paste(created.id!, Array.from({ length: 51 }, (_, index) => `Generated settings paste ${index}`).join("\n"));
    const before = session().draft;
    await assert.rejects(() => sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: before.revision, delivery: "queue" }), /file tool|tool-less|settings-only/i);
    assert.deepEqual(session().draft, before);
    assert.deepEqual(session().queue, []);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
