import assert from "node:assert/strict";
import { test } from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { projectEvents } from "../packages/sdk/src/index.ts";
import { compoundApiFixture } from "./fixtures/compound-api.ts";
import { waitFor } from "./fixture.ts";

test("public role/test history survives source deletion; candidate model grants survive report deletion and the lost original paid intent cannot replay", { skip: process.platform !== "darwin", timeout: 25000 }, async () => {
  const f = await compoundApiFixture(); let reopened: EventStore | undefined;
  try {
    await f.configure();
    const preview = await f.sdk.compound.preview(f.input);
    const command = { type: "compound.start" as const, input: f.input, expectedDigest: preview.preview.digest, confirmCost: true as const };
    const created = await f.sdk.command(command); assert.ok(created.id);
    await waitFor(() => f.service.controller.snapshot().compoundWorkflows[0]?.status === "waiting_validation");
    const review = await f.sdk.compound.validationPreview(created.id);
    await f.sdk.compound.review(created.id, review.review.validationId, review.revision, review.review.digest, true);
    await waitFor(() => f.service.controller.snapshot().compoundWorkflows[0]?.status === "proposed" && !f.session().turnId);
    const original = await f.sdk.compound.read(created.id), candidateId = original.workflow.selectedCandidateId!;
    const exported = JSON.parse((await f.sdk.artifacts.export(created.id)).export.text);
    assert.equal(exported.schemaVersion, 7);
    assert.ok(JSON.stringify(exported.documents[0].compound).includes("GENERATED_REAL_PROJECT_TEST_PASSED"));
    const source = f.session();
    await f.sdk.sessions.delete(source.id, true, source.revision);
    const retained = await f.sdk.compound.read(created.id);
    assert.equal(retained.workflow.status, "proposed");
    assert.ok(retained.roles[1]?.result?.includes("Generated public candidate"));
    assert.equal(retained.validations[0]?.result?.exitCode, 0);
    const candidate = (await f.sdk.candidates.read(candidateId)).candidate; assert.ok(candidate.compoundOrigin);
    const report = (await f.sdk.artifacts.read(created.id)).artifact;
    await f.sdk.artifacts.delete(created.id, report.revision, true);
    f.service.store.db.prepare("DELETE FROM receipts WHERE id=?").run(original.workflow.commandId);
    await assert.rejects(() => f.sdk.command(command, original.workflow.commandId), { code: "compound_deleted" });
    assert.equal(f.requests.length, 1); assert.equal(f.providers[1]!.requests.length, 1);
    const path = f.service.store.path;
    f.sdk.disconnect(); await f.service.close();
    reopened = new EventStore(path, f.retentionKey);
    const restored = projectEvents(reopened.events());
    assert.equal(restored.compoundWorkflows.length, 0);
    assert.equal(restored.candidates.find((value) => value.id === candidateId)?.acceptance, null);
    assert.ok(reopened.blob(candidate.compoundOrigin.workflowInputDigest).includes(f.input.input.task));
    assert.ok(reopened.blob(candidate.compoundOrigin.roleInputDigest).includes("untrustedSelectedFiles"));
    assert.ok(reopened.blob(candidate.compoundOrigin.resultDigest).includes("Generated public candidate"));
  } finally { reopened?.close(); await f.close(); }
});
