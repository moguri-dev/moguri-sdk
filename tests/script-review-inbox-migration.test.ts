import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { EventStore, scriptInboxSchemaMarkers } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk, PROTOCOL_VERSION, type EventInput } from "../packages/sdk/src/index.ts";
import { scriptReviewFixture } from "./fixtures/script-review.ts";
import { removeRepositoryWorkflowFixtureMarkers, removeScriptInboxFixtureMarkers, retainedCiphertextRows } from "./fixtures/legacy-state.ts";
import { setupFixture } from "./fixture.ts";

test("genuine99 reviews upgrade atomically and gain Inbox notifications on restart without source or model replay", { skip: process.platform !== "darwin" }, async () => {
  const f = await scriptReviewFixture({ autopilot: true }), originalCommit = EventStore.prototype.commit;
  const legacy = (inputs: EventInput[]) => inputs.filter((input) => {
    if (input.event_type === "script.review_approved" || input.event_type === "tool.completed" && input.payload.errorCode) {
      throw new Error("Generate original pre-100 work, not stripped current approval/failure history.");
    }
    return input.event_type !== "attention.raised" || input.payload.attention.reason !== "script-review";
  });
  EventStore.prototype.commit = function(inputs, receipt, forget, derive) {
    return this.path === f.service.store.path ? originalCommit.call(this, legacy(inputs), receipt, forget,
      derive ? (events) => legacy(derive(events)) : undefined) : originalCommit.call(this, inputs, receipt, forget, derive);
  };
  let reopened: EventStore | undefined, service: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined;
  try {
    await f.send("Generated original99 source assessment."); await f.terminal();
    const review = structuredClone(f.review()!), events = f.service.controller.events(0), calls = f.requests.length;
    f.sdk.disconnect(); await f.service.close(); EventStore.prototype.commit = originalCommit;
    const raw = new DatabaseSync(f.service.store.path);
    removeScriptInboxFixtureMarkers(raw, events); raw.exec("PRAGMA user_version=99");
    const original = retainedCiphertextRows(raw);
    raw.exec("CREATE TRIGGER generated100_interruption BEFORE INSERT ON retention_metadata WHEN NEW.id='tool_failure_schema' BEGIN SELECT RAISE(ABORT,'Generated atomic100 interruption'); END"); raw.close();
    assert.throws(() => new EventStore(f.service.store.path, f.retentionKey), /Generated atomic100 interruption/);
    const failed = new DatabaseSync(f.service.store.path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 99);
      for (const marker of scriptInboxSchemaMarkers) assert.equal(failed.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker), undefined);
      assert.deepEqual(retainedCiphertextRows(failed), original);
      failed.exec("DROP TRIGGER generated100_interruption");
    } finally { failed.close(); }
    reopened = new EventStore(f.service.store.path, f.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(reopened.db), original);
    for (const marker of scriptInboxSchemaMarkers) assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(marker)?.value, "1");
    reopened.close(); reopened = undefined;
    service = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    sdk = await new MoguriSdk(service.connection).ready();
    assert.deepEqual((await sdk.scriptReviews.read(f.sessionId, review.id)).review, review);
    assert.equal(sdk.attention.list().filter((entry) => entry.reason === "script-review" && entry.messageId === review.id).length, 1);
    assert.equal(f.requests.length, calls);
    assert.equal(service.controller.events(0).filter((event) => event.event_type === "tool.started").length,
      events.filter((event) => event.event_type === "tool.started").length);
  } finally { EventStore.prototype.commit = originalCommit; reopened?.close(); sdk?.disconnect(); await service?.close(); await f.close(); }
});

for (const variant of ["missing", "premature", "approval-downgrade", "forgotten-approval-downgrade"] as const) {
  test(`invalid100 ${variant} preserves retained history and cannot relabel actual user approval`, { skip: process.platform !== "darwin" }, async () => {
    const f = await scriptReviewFixture({ autopilot: true });
    try {
      await f.send("Generated retained approval lineage."); await f.terminal();
      const review = f.review()!;
      await f.sdk.scriptReviews.approve(f.sessionId, review.id, review.source.digest, review.revision);
      if (variant === "forgotten-approval-downgrade") await f.sdk.sessions.delete(f.sessionId, true, f.session().revision);
      f.sdk.disconnect(); await f.service.close();
      const raw = new DatabaseSync(f.service.store.path);
      if (variant === "missing") raw.prepare("DELETE FROM retention_metadata WHERE id=?").run(scriptInboxSchemaMarkers[0]);
      else if (variant === "premature") raw.exec("PRAGMA user_version=99");
      else {
        removeRepositoryWorkflowFixtureMarkers(raw, f.service.controller.events(0));
        raw.exec("DELETE FROM retention_metadata WHERE id IN ('script_review_inbox_schema','tool_failure_schema'); PRAGMA user_version=99");
      }
      const original = retainedCiphertextRows(raw); raw.close();
      assert.throws(() => new EventStore(f.service.store.path, f.retentionKey), /script Inbox|pre-100/i);
      const preserved = new DatabaseSync(f.service.store.path);
      try { assert.deepEqual(retainedCiphertextRows(preserved), original); } finally { preserved.close(); }
    } finally { await f.close(); }
  });
}

test("encrypted Not Found metadata cannot be relabelled as pre-100 tool history", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture({ toolCall: { name: "read_file", args: { path: "generated-missing.txt" } } });
  try {
    await f.configure(); await f.send("Generated original Not Found outcome."); await f.terminal(); await f.service.close();
    const raw = new DatabaseSync(f.service.store.path);
    removeRepositoryWorkflowFixtureMarkers(raw, f.service.controller.events(0));
    raw.exec("DELETE FROM retention_metadata WHERE id IN ('script_review_inbox_schema','tool_failure_schema'); PRAGMA user_version=99");
    const original = retainedCiphertextRows(raw); raw.close();
    assert.throws(() => new EventStore(f.service.store.path, f.retentionKey), /pre-100/);
    const preserved = new DatabaseSync(f.service.store.path);
    try { assert.deepEqual(retainedCiphertextRows(preserved), original); } finally { preserved.close(); }
  } finally { await f.close(); }
});
