import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { DraftEditor, MoguriSdk } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { generatedDocx } from "./fixtures/documents.ts";
import { profileFixture } from "./fixtures/profiles.ts";

async function ask(sdk: MoguriSdk, id: string, text: string) {
  await sdk.refresh();
  const session = sdk.getState().snapshot!.sessions.find((entry) => entry.id === id)!;
  const editor = new DraftEditor(sdk, id, session.draft);
  try { editor.edit(text); await editor.send("queue"); } finally { editor.dispose(); }
}
test("each new side question includes later main turns exactly once and preserves its own previous exchange through restart", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  const send = async (client: MoguriSdk, id: string, text: string) => {
    await client.refresh();
    const session = client.getState().snapshot!.sessions.find((entry) => entry.id === id)!;
    const editor = new DraftEditor(client, id, session.draft);
    try { editor.edit(text); await editor.send("queue"); } finally { editor.dispose(); }
    await waitFor(() => client.getState().snapshot?.sessions.find((entry) => entry.id === id)?.status === "completed");
  };
  try {
    await fixture.configure(); await fixture.send("Generated MAIN_CONTEXT_TIME_ONE."); await fixture.terminal();
    const side = await sdk.sessions.side(fixture.sessionId);
    await send(sdk, side.id!, "Generated SIDE_QUESTION_ONE.");
    const first = JSON.stringify(fixture.requests.at(-1)?.messages);
    const originalCapture = fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)!.sideContext!;
    const originalBytes = fixture.service.store.blob(originalCapture.contextDigest);
    assert.match(first, /MAIN_CONTEXT_TIME_ONE/);
    await fixture.send("Generated MAIN_CONTEXT_TIME_TWO."); await fixture.terminal();
    await send(sdk, side.id!, "Generated SIDE_QUESTION_TWO.");
    const second = JSON.stringify(fixture.requests.at(-1)?.messages);
    assert.match(second, /MAIN_CONTEXT_TIME_TWO/, "A second side question must refresh its original main session, not reuse only its creation snapshot.");
    assert.equal(second.match(/MAIN_CONTEXT_TIME_ONE/g)?.length, 1);
    assert.equal(second.match(/MAIN_CONTEXT_TIME_TWO/g)?.length, 1);
    assert.equal(second.match(/SIDE_QUESTION_ONE/g)?.length, 1);
    assert.match(second, /SIDE_QUESTION_TWO/);
    assert.doesNotMatch(first, /MAIN_CONTEXT_TIME_TWO/);
    assert.equal(fixture.service.store.blob(originalCapture.contextDigest), originalBytes);
    assert.equal(fixture.requests.length, 4);
    const saved = fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)!;
    assert.equal(saved.mode, "read-only");
    const usage = JSON.stringify(saved.usage);
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const reopened = await new MoguriSdk(restarted.connection).ready();
    try {
      assert.equal(JSON.stringify(reopened.getState().snapshot!.sessions.find((entry) => entry.id === side.id)?.usage), usage);
      await send(reopened, side.id!, "Generated SIDE_QUESTION_THREE_AFTER_RESTART.");
      const last = JSON.stringify(fixture.requests.at(-1)?.messages);
      for (const sentinel of ["MAIN_CONTEXT_TIME_ONE", "MAIN_CONTEXT_TIME_TWO", "SIDE_QUESTION_ONE", "SIDE_QUESTION_TWO"]) assert.equal(last.match(new RegExp(sentinel, "g"))?.length, 1);
      assert.equal(fixture.requests.length, 5);
    } finally { reopened.disconnect(); }
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("main progress while a side read waits does not change that turn's captured context, but the next question includes it", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ respond: (_body, index) => index === 2 ? { tool: { name: "read_file", args: { path: "fixture.txt" } } } : { text: "Generated frozen side-context reply." } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated MAIN_BEFORE_SIDE_TOOL."); await fixture.terminal();
    const side = await sdk.sessions.side(fixture.sessionId);
    await ask(sdk, side.id!, "Generated SIDE_NEEDS_READ.");
    const approval = await waitFor(() => fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)?.pendingApproval);
    const original = fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)!.sideContext!;
    await fixture.send("Generated MAIN_DURING_SIDE_TOOL."); await fixture.terminal();
    await sdk.approvals.respond(side.id!, approval.id, true);
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)?.status === "completed");
    const continuation = JSON.stringify(fixture.requests.at(-1)?.messages);
    assert.doesNotMatch(continuation, /MAIN_DURING_SIDE_TOOL/);
    assert.deepEqual(fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)?.sideContext, original);
    await ask(sdk, side.id!, "Generated SIDE_NEXT_QUESTION.");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)?.status === "completed");
    assert.match(JSON.stringify(fixture.requests.at(-1)?.messages), /MAIN_DURING_SIDE_TOOL/);
    assert.notEqual(fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)?.sideContext?.contextDigest, original.contextDigest);
    assert.equal(fixture.requests.length, 5);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("later main paste-file grants are independently retained by the exact side turn and survive parent deletion", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated main before later scoped source."); await fixture.terminal();
    const side = await sdk.sessions.side(fixture.sessionId);
    const path = join(fixture.directory, "generated-later-parent.docx"); await writeFile(path, generatedDocx());
    await sdk.attachments.document(fixture.sessionId, path);
    await fixture.send(Array.from({ length: 60 }, (_, index) => `Generated later parent pasted line ${index}.`).join("\n")); await fixture.terminal();
    const file = fixture.service.controller.platform.inputs.admittedFiles(fixture.sessionId)[0]!;
    const document = fixture.service.controller.platform.inputs.admittedDocuments(fixture.sessionId)[0]!;
    await ask(sdk, side.id!, "Generated side inspect later main source.");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)?.status === "completed");
    const saved = fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)!.sideContext!;
    assert.deepEqual(saved.pasteFiles, [file]);
    assert.deepEqual(saved.documents, [document]);
    assert.equal(saved.parentSessionId, fixture.sessionId);
    assert.ok(saved.throughSeq < fixture.service.controller.events(0).find((event) => event.event_type === "turn.started" && event.session_id === side.id)?.seq!);
    const source = fixture.service.store.blob(file.digest), context = fixture.service.store.blob(saved.contextDigest);
    assert.deepEqual(fixture.service.controller.platform.inputs.admittedFiles(side.id!), [file]);
    assert.deepEqual(fixture.service.controller.platform.inputs.admittedDocuments(side.id!), [document]);
    assert.ok(fixture.service.store.db.prepare("SELECT scope FROM blob_payloads WHERE digest=? AND scope LIKE ?").get(file.digest, `%/session/${side.id}`));
    await sdk.sessions.delete(fixture.sessionId, true);
    assert.equal(fixture.service.store.blob(file.digest), source);
    assert.equal(fixture.service.store.blob(saved.contextDigest), context);
    assert.deepEqual(fixture.service.controller.platform.inputs.admittedFiles(side.id!), [file]);
    assert.deepEqual(fixture.service.controller.platform.inputs.admittedDocuments(side.id!), [document]);
    await ask(sdk, side.id!, "Generated side question with removed main.");
    const blocked = await waitFor(() => {
      const current = fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)!;
      return current.lastError ? current : false;
    });

    assert.match(blocked.lastError!, /original main session.*unavailable|valid original owner|existing session/i);
    assert.equal(blocked.queue.length, 1); assert.equal(fixture.requests.length, 3);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a held side question captures latest main context only when explicitly resumed, and finite policy still blocks the paid call", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated MAIN_BEFORE_HELD_SIDE."); await fixture.terminal();
    const side = await sdk.sessions.side(fixture.sessionId);
    await sdk.command({ type: "draft.save", sessionId: side.id!, expectedRevision: 0, text: "Generated held side question.", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: side.id!, expectedRevision: 1, delivery: "queue", held: true });
    await fixture.send("Generated MAIN_AFTER_HELD_SIDE."); await fixture.terminal();
    assert.equal(fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)?.sideContext, undefined);
    const charges = fixture.service.controller.snapshot().budgetEntries.reduce((sum, entry) => sum + (entry.reportedTokens ?? 0), 0);
    await sdk.budgets.policy({ basis: "estimate", tokens: charges }, fixture.service.controller.snapshot().budgetPolicy.revision, true);
    await sdk.command({ type: "session.resume", sessionId: side.id! });
    await waitFor(() => ["partial", "failed"].includes(fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)!.status));
    const current = fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)!;
    assert.ok(current.sideContext);
    assert.match(fixture.service.store.blob(current.sideContext.contextDigest), /MAIN_AFTER_HELD_SIDE/);
    assert.equal(fixture.requests.length, 2);
    assert.equal(fixture.service.controller.snapshot().budgetEntries.length, 2);
    assert.match(current.lastError ?? "", /budget|capacity|exhausted/i);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the complete refreshed main context is sized against the side working window without truncation or paid fallback", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text", contextWindow: 16384 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated small original main context."); await fixture.terminal();
    const side = await sdk.sessions.side(fixture.sessionId);
    await sdk.sessions.modelOptions(side.id!, { contextWindow: 8192 });
    await fixture.send("Generated MAIN_CONTEXT_FULL_BOUND. " + "Generated complete main context detail. ".repeat(600)); await fixture.terminal();
    await ask(sdk, side.id!, "Generated side with smaller working window.");
    await waitFor(() => ["partial", "failed"].includes(fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)!.status));
    const current = fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)!;
    assert.match(current.lastError ?? "", /context|window|headroom|large/i);
    assert.match(fixture.service.store.blob(current.sideContext!.contextDigest), /MAIN_CONTEXT_FULL_BOUND/);
    assert.equal(fixture.requests.length, 2);
    assert.equal(current.usage.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a later main image cannot silently disappear from a text-only side model's refreshed question", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text", imageInput: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated main before image."); await fixture.terminal();
    const side = await sdk.sessions.side(fixture.sessionId);
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 25, g: 65, b: 45 } } }).png().toBuffer();
    await sdk.attachments.image(fixture.sessionId, image.toString("base64"), "Generated later main image");
    await fixture.send("Generated new main image."); await fixture.terminal();
    fixture.provider.state.models[0]!.imageInput = false; fixture.provider.onChange();
    await ask(sdk, side.id!, "Generated text-only side must preserve new image.");
    const blocked = await waitFor(() => {
      const current = fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)!;
      return current.lastError ? current : false;
    });
    assert.match(blocked.lastError!, /image-capable/); assert.equal(blocked.queue.length, 1);
    assert.equal(blocked.sideContext, undefined); assert.equal(fixture.requests.length, 2);
    fixture.provider.state.models[0]!.imageInput = true; fixture.provider.onChange();
    await sdk.command({ type: "session.resume", sessionId: side.id! });
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)?.status === "completed");
    assert.match(JSON.stringify(fixture.requests.at(-1)?.messages), /data:image\/png;base64,/);
    assert.equal(fixture.requests.length, 3);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a failed side capture append retains the queued question and cannot launch or charge a model", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated main retained before failure."); await fixture.terminal();
    const side = await sdk.sessions.side(fixture.sessionId);
    fixture.service.store.db.exec(`CREATE TRIGGER generated_side_capture_failure BEFORE INSERT ON events
      WHEN json_extract(NEW.data,'$.event_type')='turn.started'
      BEGIN SELECT RAISE(ABORT,'Generated side context append interruption'); END;`);
    await assert.rejects(() => ask(sdk, side.id!, "Generated queued side capture failure."), /append interruption|failed/i);
    const current = fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)!;
    assert.equal(current.queue.length, 1); assert.equal(current.turnId, null); assert.equal(current.sideContext, undefined);
    assert.equal(fixture.requests.length, 1);
    fixture.service.store.db.exec("DROP TRIGGER generated_side_capture_failure");
    await sdk.command({ type: "session.resume", sessionId: side.id! });
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)?.status === "completed");
    assert.equal(fixture.requests.length, 2);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("reviewed side-history compaction stays separate from refreshed main context and keeps truthful complete estimates", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated MAIN_BEFORE_SIDE_COMPACTION."); await fixture.terminal();
    const side = await sdk.sessions.side(fixture.sessionId);
    for (let index = 0; index < 3; index++) {
      await ask(sdk, side.id!, `Generated own side detail ${index}. ` + "Generated retained side detail. ".repeat(200));
      await waitFor(() => fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)?.status === "completed");
    }
    const preview = (await sdk.compactions.preview(side.id!, { keepRecentTurns: 1 })).preview;
    await sdk.compactions.generate(side.id!, preview, true);
    await waitFor(() => ["completed", "partial", "failed"].includes(fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)!.status));
    const proposal = (await sdk.compactions.state(side.id!)).compactions[0]!;
    assert.equal(proposal.status, "proposed", proposal.diagnostic ?? "");
    await sdk.compactions.apply(side.id!, proposal.id, proposal.revision);
    assert.equal((await sdk.compactions.state(side.id!)).estimatedTokens, proposal.afterTokens);
    await fixture.send("Generated MAIN_AFTER_SIDE_COMPACTION."); await fixture.terminal();
    await ask(sdk, side.id!, "Generated side after reviewed own summary.");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)?.status === "completed");
    const messages = JSON.stringify(fixture.requests.at(-1)?.messages);
    assert.equal(messages.match(/MAIN_BEFORE_SIDE_COMPACTION/g)?.length, 1);
    assert.equal(messages.match(/MAIN_AFTER_SIDE_COMPACTION/g)?.length, 1);
    assert.match(messages, /Moguri retained context: model-produced/);
    assert.match(messages, /Generated own side detail 2/);
    assert.equal(fixture.requests.length, 7);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("navigation attachment cannot substitute another main session for a side chat's actual birth source", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated ORIGINAL_MAIN_BIRTH_SOURCE."); await fixture.terminal();
    const side = await sdk.sessions.side(fixture.sessionId);
    const other = await sdk.sessions.create(fixture.session().projectId, "Generated other navigation parent", { modelId: fixture.modelId });
    await ask(sdk, other.id!, "Generated FOREIGN_NAVIGATION_PARENT.");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((entry) => entry.id === other.id)?.status === "completed");
    await sdk.sessions.organize(side.id!, { parentSessionId: other.id! });
    await fixture.send("Generated ORIGINAL_MAIN_LATEST_SOURCE."); await fixture.terminal();
    await ask(sdk, side.id!, "Generated side follows actual origin.");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)?.status === "completed");
    const messages = JSON.stringify(fixture.requests.at(-1)?.messages);
    assert.match(messages, /ORIGINAL_MAIN_BIRTH_SOURCE/); assert.match(messages, /ORIGINAL_MAIN_LATEST_SOURCE/);
    assert.doesNotMatch(messages, /FOREIGN_NAVIGATION_PARENT/);
    assert.equal(fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)?.sideContext?.parentSessionId, fixture.sessionId);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("refreshed main captures remain scoped to the owning profile and never expose another profile's transcript", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await profileFixture();
  try {
    const main = await fixture.sdk.sessions.create(null, "Generated scoped main", { modelId: fixture.providers[0]!.modelId });
    await fixture.send(fixture.sdk, main.id!, "Generated DEFAULT_MAIN_CAPTURE.");
    await waitFor(() => fixture.session(fixture.sdk, main.id!).status === "completed");
    const side = await fixture.sdk.sessions.side(main.id!);
    const { client: beta } = await fixture.create("Generated side source Beta");
    const other = await beta.sessions.create(null, "Generated foreign source", { modelId: fixture.providers[1]!.modelId });
    await fixture.send(beta, other.id!, "Generated BETA_NEVER_SIDE_SOURCE.");
    await waitFor(() => fixture.session(beta, other.id!).status === "completed");
    await fixture.send(fixture.sdk, side.id!, "Generated profile-owned side question.");
    await waitFor(() => fixture.session(fixture.sdk, side.id!).status === "completed");
    const context = JSON.stringify(fixture.providers[0]!.requests.at(-1)?.messages);
    assert.match(context, /DEFAULT_MAIN_CAPTURE/); assert.doesNotMatch(context, /BETA_NEVER_SIDE_SOURCE/);
    assert.equal(beta.getState().snapshot?.sessions.some((entry) => entry.sideContext?.parentSessionId === main.id), false);
  } finally { await fixture.close(); }
});

test("cancelling a captured side question retains its original source and unknown hold through restart without replay", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ respond: (_body, index) => index === 2 ? { hold: true } : { text: "Generated complete main result." } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await fixture.configure(); await fixture.send("Generated frozen main before cancelled side."); await fixture.terminal();
    const side = await sdk.sessions.side(fixture.sessionId);
    await ask(sdk, side.id!, "Generated cancelled side request.");
    await waitFor(() => fixture.requests.length === 2);
    const saved = fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)!.sideContext!;
    await sdk.command({ type: "session.stop", sessionId: side.id! });
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((entry) => entry.id === side.id)?.status === "stopped");
    const entry = fixture.service.controller.snapshot().budgetEntries.find((entry) => entry.sessionId === side.id)!;
    assert.equal(entry.status, "unknown"); assert.ok(entry.reservedTokens! > 0);
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    assert.deepEqual(restarted.controller.snapshot().sessions.find((entry) => entry.id === side.id)?.sideContext, saved);
    assert.equal(restarted.controller.snapshot().budgetEntries.find((value) => value.id === entry.id)?.reservedTokens, entry.reservedTokens);
    assert.equal(fixture.requests.length, 2);
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});
