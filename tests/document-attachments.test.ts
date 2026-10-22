import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ChildProcess } from "node:child_process";
import sharp from "sharp";
import { MoguriSdk, DraftEditor, PROTOCOL_VERSION, type DocumentAttachment } from "../packages/sdk/src/index.ts";
import { DocumentParsers } from "../apps/service/src/documents.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { profileFixture } from "./fixtures/profiles.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";
import { holdRemoteFrame } from "./fixtures/remote-frame-gate.ts";
import { generatedDocx, generatedXlsx, generatedPdf } from "./fixtures/documents.ts";
import { retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";
import { compactionFixture } from "./fixtures/compaction-service.ts";

const mac = { skip: process.platform !== "darwin", timeout: 25_000 };
function document(attachments: ReturnType<typeof fixtureAttachments>, id?: string): DocumentAttachment {
  const value = attachments.find((attachment) => attachment.kind === "document" && (!id || attachment.id === id));
  assert.ok(value?.kind === "document"); return value;
}
const fixtureAttachments = (fixture: Awaited<ReturnType<typeof setupFixture>>) => fixture.session().draft.attachments;

test("shared attachment selection retains validated PDF/XLSX/DOCX plus Java/source and image support without changing the prompt", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    editor.edit("Generated unsent document question."); await editor.flush();
    for (const [name, bytes] of [["generated.PDF", generatedPdf({ imagePage: true })], ["generated.xlsx", generatedXlsx()], ["generated.docx", generatedDocx()]] as const) {
      const path = join(fixture.directory, name); await writeFile(path, bytes);
      const result = await sdk.attachments.file(fixture.sessionId, path);
      const attachment = document(fixtureAttachments(fixture), result.id);
      assert.equal(attachment.bytes, bytes.length);
      assert.deepEqual(Buffer.from((await sdk.attachments.original(fixture.sessionId, attachment.id)).data, "base64"), bytes);
      assert.equal((await sdk.attachments.read(fixture.sessionId, attachment.id)).content.kind, "document");
      assert.throws(() => fixture.service.controller.platform.inputs.scopedDocument(fixture.sessionId, attachment.id), /admitted/);
      await writeFile(path, "Generated source changed after immutable capture.");
      assert.ok((await sdk.attachments.searchDocument(fixture.sessionId, attachment.id, { query: "GENERATED_DOCUMENT_SECRET" })).result.matches.length > 0);
    }
    const java = join(fixture.directory, "Generated.java"); await writeFile(java, "class Generated { int value = 42; }\n");
    await sdk.attachments.file(fixture.sessionId, java);
    const source = fixture.session().draft.attachments.find((attachment) => attachment.path === "Generated.java")!;
    assert.equal(source.kind, "local_file");
    assert.deepEqual((await sdk.attachments.read(fixture.sessionId, source.id)).content, { kind: "text", text: "class Generated { int value = 42; }\n" });
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#224466" } }).png().toBuffer();
    const imagePath = join(fixture.directory, "generated.png"); await writeFile(imagePath, image);
    await sdk.attachments.file(fixture.sessionId, imagePath);
    assert.equal(fixture.session().draft.attachments.at(-1)?.kind, "image");
    assert.equal(fixture.session().draft.text, "Generated unsent document question.");
    assert.doesNotMatch(JSON.stringify(fixture.service.store.db.prepare("SELECT * FROM blob_payloads").all()), /GENERATED_DOCUMENT_SECRET|class Generated/);
    assert.equal(fixture.requests.length, 0);
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});

test("SDK reads/searches are bounded, provenance-bearing and session scoped, including draft snapshots", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const path = join(fixture.directory, "generated.docx"); await writeFile(path, generatedDocx());
    const created = await sdk.attachments.document(fixture.sessionId, path), attachment = document(fixtureAttachments(fixture));
    const read = (await sdk.attachments.readDocument(fixture.sessionId, created.id!, { section: 2, limit: 120 })).page;
    assert.ok(Buffer.byteLength(read.text) <= 120); assert.equal(read.firstLocation?.paragraph, 2); assert.equal(read.untrusted, true);
    const listed = (await sdk.attachments.listDocuments(fixture.sessionId, { limit: 1 })).result;
    assert.equal(listed.documents[0]?.attachmentId, created.id); assert.equal(JSON.stringify(listed).includes(fixture.directory), false);
    const modelInventory = fixture.service.controller.platform.inputs.documentTool(fixture.sessionId, { id: "generated-list", name: "list_documents", arguments: {} });
    assert.ok("documents" in modelInventory); assert.deepEqual(modelInventory.documents, []);
    await assert.rejects(() => sdk.attachments.readDocument(fixture.sessionId, created.id!, { limit: 16385 }), /validation|invalid|schema/i);
    await assert.rejects(() => sdk.attachments.readDocument(fixture.sessionId, created.id!, { section: 999 }), /does not exist/);
    const other = await sdk.sessions.create(null);
    await assert.rejects(() => sdk.attachments.readDocument(other.id!, created.id!), /grant|admitted/i);
    await assert.rejects(() => sdk.attachments.original(other.id!, created.id!), /grant|admitted/i);
    await assert.rejects(() => sdk.command({ type: "draft.save", sessionId: other.id!, expectedRevision: 0, text: "", attachments: [attachment] }), /not authorized/);
    const match = (await sdk.attachments.searchDocument(fixture.sessionId, created.id!, { query: "table cell B" })).result.matches[0]!;
    assert.equal(match.location.table, 1); assert.equal(match.location.column, 2);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("malformed/encrypted/oversized selections preserve the exact saved draft and all earlier attachments", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated complete unsent prompt.", attachments: [] });
    const valid = join(fixture.directory, "generated.docx"); await writeFile(valid, generatedDocx()); await sdk.attachments.document(fixture.sessionId, valid);
    const before = fixture.session().draft;
    for (const [name, bytes] of [["renamed.pdf", Buffer.from("Generated not a PDF")], ["encrypted.pdf", generatedPdf({ encrypted: true })], ["encrypted.docx", Buffer.from("d0cf11e0a1b11ae100", "hex")], ["oversized.xlsx", Buffer.alloc(8 * 1024 * 1024 + 1)]] as const) {
      const path = join(fixture.directory, name); await writeFile(path, bytes);
      await assert.rejects(() => sdk.attachments.document(fixture.sessionId, path), /PDF|Encrypted|encrypted|8192 KiB|8 MiB/);
      assert.deepEqual(fixture.session().draft, before);
    }
    assert.deepEqual(fixture.session().queue, []); assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("two clients racing one draft revision cannot overwrite the winner or consume unsent text", async () => {
  const fixture = await setupFixture(), first = await new MoguriSdk(fixture.service.connection).ready(), second = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await first.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated race draft.", attachments: [] }); await second.refresh();
    const path = join(fixture.directory, "generated.docx"); await writeFile(path, generatedDocx());
    const results = await Promise.allSettled([first.attachments.document(fixture.sessionId, path), second.attachments.document(fixture.sessionId, path)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(fixture.session().draft.attachments.length, 1); assert.equal(fixture.session().draft.text, "Generated race draft.");
    assert.equal(fixture.requests.length, 0);
  } finally { first.disconnect(); second.disconnect(); await fixture.close(); }
});

test("cancel and shutdown stop the exact parser, release capacity and never publish a late document", async (t) => {
  const fixture = await setupFixture({ platform: { documents: { workerPath: resolve("tests/fixtures/document-hold-worker.mjs") } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const original = DocumentParsers.prototype.capture; let started = 0;
  t.mock.method(DocumentParsers.prototype, "capture", function(this: DocumentParsers, ...args: Parameters<DocumentParsers["capture"]>) { started++; return original.call(this, ...args); });
  try {
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated cancellable draft.", attachments: [] });
    const path = join(fixture.directory, "generated.docx"); await writeFile(path, generatedDocx());
    const pending = sdk.attachments.document(fixture.sessionId, path, { captureId: "generated-capture" });
    const rejected = assert.rejects(() => pending, /cancelled/i);
    await waitFor(() => started === 1);
    const other = await sdk.sessions.create(null);
    await assert.rejects(() => sdk.attachments.cancelDocument(other.id!, "generated-capture"), /not active/i);
    await sdk.attachments.cancelDocument(fixture.sessionId, "generated-capture"); await rejected;
    assert.equal(fixture.session().draft.text, "Generated cancellable draft."); assert.deepEqual(fixture.session().draft.attachments, []);
    const shutdown = sdk.attachments.document(fixture.sessionId, path, { captureId: "generated-shutdown" }).then(() => false, () => true);
    await waitFor(() => started === 2);
    await fixture.service.close(); assert.equal(await shutdown, true);
    const reopened = new EventStore(fixture.service.store.path, fixture.retentionKey);
    try {
      assert.equal(reopened.events().filter((event) => event.event_type === "draft.saved").at(-1)?.payload.attachments.length, 0);
      assert.equal(reopened.db.prepare("SELECT count(*) AS count FROM blob_payloads").get()?.count, 0);
    } finally { reopened.close(); }
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("failed atomic persistence creates neither an original nor extraction grant and preserves the saved prompt", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated original draft.", attachments: [] });
    fixture.service.store.db.exec(`CREATE TRIGGER generated_document_failure BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.event_type')='draft.saved'
      BEGIN SELECT RAISE(ABORT,'Generated document persistence failure'); END;`);
    const path = join(fixture.directory, "generated.docx"); await writeFile(path, generatedDocx());
    await assert.rejects(() => sdk.attachments.document(fixture.sessionId, path), /failure|failed/);
    assert.equal(fixture.session().draft.text, "Generated original draft."); assert.deepEqual(fixture.session().draft.attachments, []);
    assert.equal(fixture.service.store.db.prepare("SELECT count(*) AS count FROM blob_payloads").get()?.count, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("an unacknowledged parser kill cannot turn a cancelled capture into a successful late attachment", async (t) => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const captureSource = DocumentParsers.prototype.capture, kill = ChildProcess.prototype.kill;
  let started = false, attempts = 0;
  t.mock.method(DocumentParsers.prototype, "capture", function(this: DocumentParsers, ...args: Parameters<DocumentParsers["capture"]>) {
    const [key, read, format, signal] = args;
    return captureSource.call(this, key, async () => { const bytes = await read(); setImmediate(() => { started = true; }); return bytes; }, format, signal);
  });
  const stopped = t.mock.method(ChildProcess.prototype, "kill", function(this: ChildProcess, ...args: Parameters<ChildProcess["kill"]>) {
    if (this.spawnargs.includes(resolve("dist/document-worker.mjs"))) { attempts++; return false; }
    return kill.call(this, ...args);
  });
  try {
    const path = join(fixture.directory, "generated.docx"); await writeFile(path, generatedDocx());
    const capture = sdk.attachments.document(fixture.sessionId, path, { captureId: "generated-unacknowledged-stop" });
    const rejected = assert.rejects(() => capture, /cancelled/i);
    await waitFor(() => started); await sdk.attachments.cancelDocument(fixture.sessionId, "generated-unacknowledged-stop"); await rejected;
    assert.ok(attempts > 0); assert.deepEqual(fixture.session().draft.attachments, []);
    assert.equal(fixture.service.store.db.prepare("SELECT count(*) AS count FROM blob_payloads").get()?.count, 0);
  } finally { stopped.mock.restore(); sdk.disconnect(); await fixture.close(); }
});

test("held queue/edit/restart preserves exact encrypted originals and extracted snapshots without reparsing", async (t) => {
  const fixture = await setupFixture();
  let sdk = await new MoguriSdk(fixture.service.connection).ready(), restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const path = join(fixture.directory, "generated.xlsx"), bytes = generatedXlsx(); await writeFile(path, bytes);
    const attached = await sdk.attachments.document(fixture.sessionId, path);
    await sdk.command({ type: "message.send", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, delivery: "queue", held: true });
    const item = fixture.session().queue[0]!;
    await sdk.command({ type: "queue.edit", sessionId: fixture.sessionId, messageId: item.id, expectedRevision: fixture.session().queueRevision, text: "Generated edited held question." });
    sdk.disconnect(); await fixture.service.close();
    t.mock.method(DocumentParsers.prototype, "parse", () => assert.fail("Retained documents must not reparse on restart."));
    t.mock.method(DocumentParsers.prototype, "capture", () => assert.fail("Retained documents must not recapture source paths on restart."));
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    sdk = await new MoguriSdk(restarted.connection).ready();
    assert.equal(sdk.getState().snapshot!.sessions.find((session) => session.id === fixture.sessionId)!.queue[0]?.held, true);
    assert.deepEqual(Buffer.from((await sdk.attachments.original(fixture.sessionId, attached.id!)).data, "base64"), bytes);
    assert.match((await sdk.attachments.readDocument(fixture.sessionId, attached.id!, { sheet: "Generated sheet", range: "C1:C1" })).page.text, /"formula":"1\+2"/);
    assert.equal(fixture.requests.length, 0);
    await sdk.sessions.delete(fixture.sessionId, true);
    await assert.rejects(() => sdk.attachments.original(fixture.sessionId, attached.id!), { code: "attachment_session" });
    assert.equal(restarted.store.db.prepare("SELECT count(*) AS count FROM blob_payloads").get()?.count, 0);
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("the actual owning worker receives only descriptors, then an explicitly approved document section", mac, async () => {
  const fixture = await setupFixture({ documentTool: { name: "read_document", arguments: { section: 2, limit: 512 } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const free = await sdk.sessions.create(null, "Generated project-free document", { modelId: fixture.modelId });
    const path = join(fixture.directory, "generated.docx"); await writeFile(path, generatedDocx());
    const capture = await sdk.attachments.document(free.id!, path);
    const session = () => fixture.service.controller.snapshot().sessions.find((session) => session.id === free.id)!;
    await sdk.command({ type: "message.send", sessionId: free.id!, expectedRevision: session().draft.revision, delivery: "queue" });
    const approval = await waitFor(() => session().pendingApproval);
    assert.equal(approval.call.name, "read_document");
    assert.doesNotMatch(JSON.stringify(fixture.requests[0]), /GENERATED_DOCUMENT_SECRET|word\/document.xml/);
    assert.equal(JSON.stringify(fixture.requests[0]).includes(path), false);
    await sdk.command({ type: "approval.respond", sessionId: free.id!, approvalId: approval.id, allow: true });
    await waitFor(() => session().status === "completed");
    const result = session().messages.find((message) => message.role === "tool")!;
    assert.equal(result.outcome, "completed"); assert.match(result.text, /GENERATED_DOCUMENT_SECRET/);
    assert.doesNotMatch(result.text, /Generated table cell B/);
    assert.equal(fixture.requests.length, 2);
    const side = await sdk.sessions.spawn(free.id!, "side");
    await sdk.sessions.delete(free.id!, true);
    assert.equal((await sdk.attachments.original(side.id!, capture.id!)).attachment.format, "docx");
    assert.match((await sdk.attachments.readDocument(side.id!, capture.id!, { section: 2 })).page.text, /GENERATED_DOCUMENT_SECRET/);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("tool-less and explicitly tool-incompatible models preserve document drafts and held queues before inference", mac, async () => {
  const fixture = await setupFixture({ toolInput: false }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const path = join(fixture.directory, "generated.docx"); await writeFile(path, generatedDocx());
    await fixture.configure(); await sdk.refresh(); await sdk.attachments.document(fixture.sessionId, path);
    const before = fixture.session().draft;
    await assert.rejects(() => sdk.command({ type: "message.send", sessionId: fixture.sessionId, expectedRevision: before.revision, delivery: "queue" }), /without document tool support/);
    assert.deepEqual(fixture.session().draft, before);
    await sdk.command({ type: "message.send", sessionId: fixture.sessionId, expectedRevision: before.revision, delivery: "queue", held: true });
    await sdk.command({ type: "session.resume", sessionId: fixture.sessionId });
    assert.equal(fixture.session().queue[0]?.attachments[0]?.kind, "document"); assert.equal(fixture.session().messages.some((message) => message.role === "user"), false);
    const meta = await sdk.metachat.create(null), session = () => sdk.getState().snapshot!.sessions.find((session) => session.id === meta.id)!;
    await sdk.sessions.configure(meta.id!, { ...session().controls, modelId: fixture.modelId });
    await sdk.attachments.document(meta.id!, path);
    await assert.rejects(() => sdk.command({ type: "message.send", sessionId: meta.id!, expectedRevision: session().draft.revision, delivery: "queue" }), /support|tool-less/);
    assert.equal(session().draft.attachments.length, 1); assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("bounded admitted descriptor inventory survives explicit compaction without expanding document bodies", mac, async () => {
  const fixture = await compactionFixture(), sdk = fixture.sdk;
  try {
    const path = join(fixture.directory, "generated.docx"); await writeFile(path, generatedDocx());
    const captured = await sdk.attachments.document(fixture.sessionId, path);
    await fixture.send("Generated source document turn."); await fixture.terminal();
    await fixture.send("Generated recent turn to keep."); await fixture.terminal();
    const preview = (await sdk.compactions.preview(fixture.sessionId, { keepRecentTurns: 1 })).preview;
    const started = await sdk.compactions.generate(fixture.sessionId, { modelId: preview.modelId, keepRecentTurns: preview.keepRecentTurns, digest: preview.digest }, true);
    await waitFor(() => !fixture.session().turnId && fixture.session().status === "completed");
    const read = await sdk.compactions.read(fixture.sessionId, started.id!);
    await sdk.compactions.apply(fixture.sessionId, started.id!, read.compaction.revision);
    const inventory = fixture.service.controller.platform.inputs.documentTool(fixture.sessionId, { id: "generated-compacted-list", name: "list_documents", arguments: { limit: 1 } });
    assert.ok("documents" in inventory);
    assert.equal(inventory.documents[0]?.attachmentId, captured.id);
    assert.doesNotMatch(JSON.stringify(inventory), /GENERATED_DOCUMENT_SECRET/);
    assert.equal(JSON.stringify(inventory).includes(path), false);
    assert.match((await sdk.attachments.readDocument(fixture.sessionId, captured.id!, { section: 2 })).page.text, /GENERATED_DOCUMENT_SECRET/);
  } finally { await fixture.close(); }
});

test("document originals and extractions remain private to immutable profiles even when content digests match", async () => {
  const fixture = await profileFixture();
  try {
    const first = await fixture.sdk.sessions.create(null), { client: beta } = await fixture.create("Generated document profile"), second = await beta.sessions.create(null);
    const path = join(fixture.directory, "generated.docx"); await writeFile(path, generatedDocx());
    const a = await fixture.sdk.attachments.document(first.id!, path), b = await beta.attachments.document(second.id!, path);
    await assert.rejects(() => beta.attachments.original(first.id!, a.id!), { code: "attachment_session" });
    await assert.rejects(() => fixture.sdk.attachments.readDocument(second.id!, b.id!), { code: "attachment_session" });
    await fixture.sdk.sessions.delete(first.id!, true);
    assert.match((await beta.attachments.readDocument(second.id!, b.id!, { section: 2 })).page.text, /GENERATED_DOCUMENT_SECRET/);
    assert.equal((await beta.attachments.original(second.id!, b.id!)).attachment.originalDigest.length, 64);
    assert.equal(fixture.providers[0]!.requests.length + fixture.providers[1]!.requests.length, 0);
  } finally { await fixture.close(); }
});

test("schema-42 migration rollback preserves ciphertext, receipts and legacy text grants before additive upgrade", async () => {
  const fixture = await setupFixture(); let reopened: EventStore | undefined;
  try {
    const sdk = await new MoguriSdk(fixture.service.connection).ready(), path = join(fixture.directory, "Generated.java");
    try { await writeFile(path, "class Generated {}\n"); await sdk.attachments.file(fixture.sessionId, path); } finally { sdk.disconnect(); }
    const before = retainedCiphertextRows(fixture.service.store.db), database = fixture.service.store.path;
    await writeLegacyState(fixture.service, 42);
    const raw = new DatabaseSync(database);
    try { raw.exec(`CREATE TRIGGER generated_document_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='document_attachment_schema'
      BEGIN SELECT RAISE(ABORT,'Generated document marker failure'); END;`); } finally { raw.close(); }
    assert.throws(() => new EventStore(database, fixture.retentionKey), /document marker failure/);
    const failed = new DatabaseSync(database);
    try { assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 42); assert.deepEqual(retainedCiphertextRows(failed), before); failed.exec("DROP TRIGGER generated_document_marker"); } finally { failed.close(); }
    reopened = new EventStore(database, fixture.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(reopened.db), before);
  } finally { reopened?.close(); await fixture.close(); }
});

test("pinned SSH workers inspect only approved document snapshots, never source workstation paths", mac, async () => {
  const fixture = await remoteFixture({ documentTool: { name: "search_document", arguments: { query: "table cell B", limit: 2 } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.probe(); await fixture.select();
    const path = join(fixture.directory, "generated.docx"); await writeFile(path, generatedDocx()); await sdk.attachments.document(fixture.sessionId, path);
    await fixture.send("Generated Remote document inspection."); await fixture.approve();
    assert.equal((await fixture.terminal()).status, "completed");
    const result = fixture.session().messages.find((message) => message.role === "tool")!;
    assert.equal(result.outcome, "completed"); assert.match(result.text, /table cell B/); assert.match(result.text, /"column":2/);
    assert.equal(JSON.stringify(fixture.requests[0]).includes(path), false); assert.doesNotMatch(JSON.stringify(fixture.requests[0]), /GENERATED_DOCUMENT_SECRET/);
    assert.equal(fixture.service.controller.snapshot().executions[0]?.workspace, fixture.workspace);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("policy revocation after an SSH document approval prevents snapshot reads without a Local fallback", mac, async (t) => {
  const fixture = await remoteFixture({ documentTool: { name: "read_document", arguments: { section: 2, limit: 512 } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const gate = holdRemoteFrame(t, fixture.service.controller.remote, "delegate");
  try {
    await fixture.probe(); await fixture.select();
    const path = join(fixture.directory, "generated.docx"); await writeFile(path, generatedDocx()); await sdk.attachments.document(fixture.sessionId, path);
    await fixture.send("Generated revoked document inspection."); await fixture.approve(); await waitFor(() => gate.held);
    const settings = structuredClone(sdk.settings.get()!.values);
    settings.permissions.tools.push({ id: "generated-document-denial", tool: "read_document", pathPrefix: "", decision: "deny" });
    await sdk.settings.update(settings, sdk.settings.get()!.revision);
    gate.release(); await fixture.terminal();
    const result = fixture.session().messages.find((message) => message.role === "tool")!;
    assert.equal(result.outcome, "failed"); assert.match(result.text, /changed|stale|deny/i);
    assert.doesNotMatch(JSON.stringify(fixture.requests), /GENERATED_DOCUMENT_SECRET/);
  } finally { gate.release(); gate.restore(); sdk.disconnect(); await fixture.close(); }
});
