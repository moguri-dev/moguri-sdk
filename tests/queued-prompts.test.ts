import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { MoguriSdk, DraftEditor } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { reviewNativeTools, setupFixture, waitFor } from "./fixture.ts";

const mac = { skip: process.platform !== "darwin", timeout: 30_000 };
async function hold(sdk: MoguriSdk, sessionId: string, text: string) {
  const editor = new DraftEditor(sdk, sessionId, sdk.sessions.get(sessionId)!.draft);
  try { editor.edit(text); await editor.send("queue", true); } finally { editor.dispose(); }
}

test("send now steers a queued prompt into the running turn and refuses commands", mac, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await reviewNativeTools(fixture, ["read_file"]);
    await fixture.configure();
    await fixture.send("generated tool task");
    await waitFor(() => fixture.session().pendingApproval);
    const turnId = fixture.session().turnId;
    await hold(sdk, fixture.sessionId, "generated queued correction");
    await hold(sdk, fixture.sessionId, "/rename Generated later name");
    const [prompt, command] = fixture.session().queue;
    await assert.rejects(sdk.prompts.sendNow(fixture.sessionId, command!.id), /can't steer/);
    await sdk.prompts.sendNow(fixture.sessionId, prompt!.id);
    const steer = fixture.session().queue.find((item) => item.text === "generated queued correction")!;
    assert.equal(steer.delivery, "steer"); assert.equal(steer.targetTurnId, turnId); assert.equal(steer.held, undefined);
    assert.notEqual(steer.id, prompt!.id);
    await assert.rejects(sdk.prompts.sendNow(fixture.sessionId, steer.id), /already steering/);
    await fixture.approve();
    await fixture.terminal();
    const applied = fixture.service.controller.events(0).find((event) => event.event_type === "steer.applied");
    assert.equal(applied?.turn_id, turnId);
    assert.equal(applied?.event_type === "steer.applied" ? applied.payload.item.text : "", "generated queued correction");
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "turn.started").length, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("send now runs an idle held prompt next, ahead of earlier queued work", mac, async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    await hold(sdk, fixture.sessionId, "generated first held prompt");
    await hold(sdk, fixture.sessionId, "generated second held prompt");
    const second = fixture.session().queue[1]!;
    await sdk.prompts.sendNow(fixture.sessionId, second.id);
    await waitFor(() => fixture.session().status === "completed", 10_000);
    const starts = fixture.service.controller.events(0).filter((event) => event.event_type === "turn.started");
    assert.deepEqual(starts.map((event) => event.event_type === "turn.started" ? event.payload.item.text : ""), ["generated second held prompt"]);
    assert.deepEqual(fixture.session().queue.map((item) => [item.text, item.held]), [["generated first held prompt", true]]);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a queued prompt's edit stages attachments without touching the draft, saves them durably and refuses forged ones", mac, async () => {
  const fixture = await setupFixture();
  let sdk = await new MoguriSdk(fixture.service.connection).ready(), restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const notes = join(fixture.directory, "generated-notes.txt"), picture = join(fixture.directory, "generated.png");
    await writeFile(notes, "Generated queued attachment text.\n");
    await writeFile(picture, await sharp({ create: { width: 4, height: 4, channels: 3, background: "#336699" } }).png().toBuffer());
    await hold(sdk, fixture.sessionId, "generated queued prompt");
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "generated unsent draft", attachments: [] });
    const item = fixture.session().queue[0]!, draft = structuredClone(fixture.session().draft), queueRevision = fixture.session().queueRevision;
    const text = await sdk.attachments.queued.file(fixture.sessionId, item.id, notes);
    const image = await sdk.attachments.queued.file(fixture.sessionId, item.id, picture);
    assert.equal(text.attachment?.kind, "local_file"); assert.equal(image.attachment?.kind, "image");
    assert.deepEqual(fixture.session().draft, draft, "staging never writes the draft");
    assert.equal(fixture.session().queueRevision, queueRevision); assert.deepEqual(fixture.session().queue[0]!.attachments, []);
    const preview = await sdk.attachments.read(fixture.sessionId, text.attachment!.id);
    assert.equal(preview.content.kind === "text" ? preview.content.text : "", "Generated queued attachment text.\n");
    await sdk.command({ type: "message.send", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, delivery: "queue", held: true });
    assert.deepEqual(fixture.session().queue.at(-1)!.attachments, [], "a held draft never picks up staged queue captures");

    const forged = { ...text.attachment!, id: "generated-forged-attachment" };
    await assert.rejects(sdk.prompts.edit(fixture.sessionId, item.id, "generated forged edit", [forged]), /not authorized/);
    await sdk.prompts.edit(fixture.sessionId, item.id, "generated edited queued prompt", [text.attachment!]);
    const saved = fixture.session().queue.find((queued) => queued.id === item.id)!;
    assert.equal(saved.text, "generated edited queued prompt");
    assert.deepEqual(saved.attachments.map((attachment) => attachment.id), [text.attachment!.id]);
    await assert.rejects(sdk.prompts.edit(fixture.sessionId, item.id, "generated stale staging", [text.attachment!, image.attachment!]), /not authorized/,
      "a capture dropped from a saved edit isn't reusable afterwards");
    await assert.rejects(sdk.attachments.queued.file(fixture.sessionId, "generated-missing-item", notes), /already been sent or removed/);

    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    sdk = await new MoguriSdk(restarted.connection).ready();
    const reopened = await sdk.attachments.read(fixture.sessionId, text.attachment!.id);
    assert.equal(reopened.content.kind === "text" ? reopened.content.text : "", "Generated queued attachment text.\n");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("removing or sending a queued prompt discards captures staged for its edit", mac, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const notes = join(fixture.directory, "generated-notes.txt");
    await writeFile(notes, "Generated discarded staging.\n");
    await hold(sdk, fixture.sessionId, "generated removed prompt");
    const item = fixture.session().queue[0]!;
    const staged = await sdk.attachments.queued.file(fixture.sessionId, item.id, notes);
    await fixture.service.controller.dispatch(envelope({ type: "queue.remove", sessionId: fixture.sessionId, messageId: item.id, expectedRevision: fixture.session().queueRevision }));
    await assert.rejects(sdk.attachments.read(fixture.sessionId, staged.attachment!.id), /no content grant/);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a send-now steer that misses the turn's last step still runs as the next turn", mac, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    await fixture.send("generated delayed task");
    await waitFor(() => fixture.requests.length === 1);
    await hold(sdk, fixture.sessionId, "generated late follow-up");
    await sdk.prompts.sendNow(fixture.sessionId, fixture.session().queue[0]!.id);
    assert.equal(fixture.session().queue[0]!.delivery, "steer");
    await waitFor(() => fixture.service.controller.events(0).filter((event) => event.event_type === "turn.started").length === 2 && !fixture.session().turnId, 15_000);
    const starts = fixture.service.controller.events(0).filter((event) => event.event_type === "turn.started");
    assert.equal(starts[1]?.event_type === "turn.started" ? starts[1].payload.item.text : "", "generated late follow-up");
    assert.equal(fixture.session().queue.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("staged captures stay out of uncommitted store memory and command receipts, and steers must fit the model", mac, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await reviewNativeTools(fixture, ["read_file"]);
    const picture = join(fixture.directory, "Generated-Private-Name.png");
    await writeFile(picture, await sharp({ create: { width: 4, height: 4, channels: 3, background: "#996633" } }).png().toBuffer());
    await fixture.configure();
    await fixture.send("generated tool task");
    await waitFor(() => fixture.session().pendingApproval);
    await fixture.send("generated pending steer", "steer");
    const steer = fixture.session().queue[0]!;
    await waitFor(() => sdk.sessions.get(fixture.sessionId)?.queueRevision === fixture.session().queueRevision);
    const staged = await sdk.attachments.queued.file(fixture.sessionId, steer.id, picture);
    const pending = (fixture.service.store as unknown as { pending: Map<string, string> }).pending;
    assert.equal(pending.has(staged.attachment.digest), false, "staged content is held by staging, not the commit-scoped pending map");
    assert.deepEqual((await sdk.attachments.queued.list(fixture.sessionId, steer.id)).attachments.map((attachment) => attachment.id), [staged.attachment.id]);
    const tables = fixture.service.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'receipts%'").all().map((row) => String(row.name));
    for (const table of tables) {
      for (const row of fixture.service.store.db.prepare(`SELECT result FROM ${table}`).all()) assert.doesNotMatch(String(row.result), /Generated-Private-Name/);
    }
    await assert.rejects(sdk.prompts.edit(fixture.sessionId, steer.id, "generated pending steer", [staged.attachment]), /image-capable model/);
    assert.deepEqual(fixture.session().queue[0]!.attachments, []);
    await fixture.approve();
    await fixture.terminal();
  } finally { sdk.disconnect(); await fixture.close(); }
});
