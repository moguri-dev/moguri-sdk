import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk, PROTOCOL_VERSION, projectEvents } from "../packages/sdk/src/index.ts";
import { retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";
import { setupFixture, waitFor } from "./fixture.ts";

test("schema-35 migration rollback preserves exact ciphertext, receipts, queued text and unsupported saved windows", async () => {
  const fixture = await setupFixture(); let reopened: EventStore | undefined;
  try {
    const original = fixture.session(), text = Array.from({ length: 51 }, (_, index) => `Generated legacy queued ${index}`).join("\r\n");
    fixture.service.store.commit([
      { event_type: "session.configured", profile_id: "default", project_id: original.projectId, session_id: original.id, payload: { controls: { ...original.controls, modelId: fixture.modelId, modelOptions: { contextWindow: 24576 } } } },
      { event_type: "queue.enqueued", profile_id: "default", project_id: original.projectId, session_id: original.id, payload: { item: { id: randomUUID(), text, attachments: [], delivery: "queue", held: true } } },
    ]);
    const before = retainedCiphertextRows(fixture.service.store.db), path = fixture.service.store.path;
    await writeLegacyState(fixture.service, 35);
    const raw = new DatabaseSync(path);
    try { raw.exec(`CREATE TRIGGER generated_paste_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='paste_file_schema'
      BEGIN SELECT RAISE(ABORT,'Generated paste marker failure'); END;`); } finally { raw.close(); }
    assert.throws(() => new EventStore(path, fixture.retentionKey), /paste marker failure/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 35);
      assert.deepEqual(retainedCiphertextRows(failed), before);
      failed.exec("DROP TRIGGER generated_paste_marker");
    } finally { failed.close(); }
    reopened = new EventStore(path, fixture.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(reopened.db), before);
    const restored = projectEvents(reopened.events()).sessions.find((session) => session.id === original.id)!;
    assert.equal(restored.controls.modelOptions?.contextWindow, 24576);
    assert.equal(restored.queue[0]?.text, text);
    assert.equal(fixture.requests.length, 0);
  } finally { reopened?.close(); await fixture.close(); }
});

test("queue edits retain file grants through restart and old queued multiline text is captured only on explicit release", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture();
  let sdk = await new MoguriSdk(fixture.service.connection).ready(), restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await fixture.configure(); await sdk.refresh();
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated original held prompt", attachments: [] });
    const queued = await sdk.command({ type: "message.send", sessionId: fixture.sessionId, expectedRevision: 1, delivery: "queue", held: true });
    const text = Array.from({ length: 51 }, (_, index) => `Generated queue edit ${index}`).join("\r");
    await sdk.command({ type: "queue.edit", sessionId: fixture.sessionId, messageId: queued.id!, expectedRevision: fixture.session().queueRevision, text });
    const file = fixture.session().queue[0]!.attachments[0]!;
    const legacyId = randomUUID(), legacyText = Array.from({ length: 51 }, (_, index) => `Generated legacy held ${index}`).join("\n");
    fixture.service.store.commit([{ event_type: "queue.enqueued", profile_id: "default", project_id: fixture.session().projectId, session_id: fixture.sessionId,
      payload: { item: { id: legacyId, text: legacyText, attachments: [], delivery: "queue", held: true } } }]);
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    sdk = await new MoguriSdk(restarted.connection).ready();
    assert.deepEqual((await sdk.attachments.read(fixture.sessionId, file.id)).content, { kind: "text", text });
    assert.equal(fixture.requests.length, 0);
    const session = () => restarted!.controller.snapshot().sessions.find((session) => session.id === fixture.sessionId)!;
    assert.equal(session().queue[1]?.text, legacyText);
    await sdk.command({ type: "queue.remove", sessionId: fixture.sessionId, messageId: queued.id!, expectedRevision: session().queueRevision });
    await sdk.command({ type: "session.resume", sessionId: fixture.sessionId });
    await waitFor(() => !session().turnId && session().status === "completed");
    const message = session().messages.find((message) => message.role === "user")!;
    assert.doesNotMatch(message.text, /Generated legacy held/);
    assert.equal(message.attachments?.[0]?.kind, "paste_file");
    assert.equal(JSON.stringify(fixture.requests).includes("Generated legacy held"), false);
    assert.deepEqual((await sdk.attachments.read(fixture.sessionId, message.attachments![0]!.id)).content, { kind: "text", text: legacyText });
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});
