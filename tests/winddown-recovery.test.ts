import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { PROTOCOL_VERSION, projectEvents } from "../packages/sdk/src/index.ts";
import { retainedCiphertextRows, writeLegacyState } from "./fixtures/legacy-state.ts";
import { compoundApiFixture } from "./fixtures/compound-api.ts";
import { waitFor } from "./fixture.ts";

test("schema-39 wind-down migration preserves exact schema-38 compound roles/tests, receipts and independent ciphertext through failure/reopen", { skip: process.platform !== "darwin", timeout: 20000 }, async () => {
  const f = await compoundApiFixture({ legacyNotifications: true }); let reopened: EventStore | undefined;
  try {
    await f.configure();
    const preview = await f.sdk.compound.preview(f.input), started = await f.sdk.compound.start(f.input, preview.preview.digest, true); assert.ok(started.id);
    await waitFor(() => f.service.controller.snapshot().compoundWorkflows[0]?.status === "waiting_validation");
    const review = await f.sdk.compound.validationPreview(started.id);
    await f.sdk.compound.review(started.id, review.review.validationId, review.revision, review.review.digest, true);
    await waitFor(() => f.service.controller.snapshot().compoundWorkflows[0]?.status === "proposed" && !f.session().turnId);
    const before = retainedCiphertextRows(f.service.store.db), path = f.service.store.path;
    f.sdk.disconnect(); await writeLegacyState(f.service, 38);
    const raw = new DatabaseSync(path);
    try { raw.exec(`CREATE TRIGGER generated_winddown_marker BEFORE INSERT ON retention_metadata WHEN NEW.id='budget_winddown_schema'
      BEGIN SELECT RAISE(ABORT,'Generated budget wind-down migration failure'); END;`); } finally { raw.close(); }
    assert.throws(() => new EventStore(path, f.retentionKey), /wind-down migration failure/);
    const failed = new DatabaseSync(path);
    try {
      assert.equal(failed.prepare("PRAGMA user_version").get()?.user_version, 38); assert.deepEqual(retainedCiphertextRows(failed), before);
      failed.exec("DROP TRIGGER generated_winddown_marker");
    } finally { failed.close(); }
    reopened = new EventStore(path, f.retentionKey);
    assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    assert.deepEqual(retainedCiphertextRows(reopened.db), before);
    const state = projectEvents(reopened.events());
    assert.equal(state.compoundWorkflows[0]?.status, "proposed"); assert.equal(state.compoundWorkflows[0]?.validations[0]?.status, "passed");
    assert.equal(state.winddowns.length, 0); assert.equal(state.settings.values.winddown.enabled, false);
    assert.ok(reopened.blob(state.compoundWorkflows[0]!.steps[1]!.resultDigest!).includes(f.proposal.plan));
  } finally { reopened?.close(); await f.close(); }
});
