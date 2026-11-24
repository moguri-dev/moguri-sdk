import assert from "node:assert/strict";
import { test } from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { projectEvents } from "../packages/sdk/src/index.ts";
import { compoundApiFixture } from "./fixtures/compound-api.ts";
import { waitFor } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("public role/test reports survive source deletion while candidates are deleted, and a lost original paid intent cannot replay after report deletion", { skip: process.platform !== "darwin", timeout: ciTime(25000) }, async () => {
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
    const candidate = (await f.sdk.candidates.read(candidateId)).candidate; assert.ok(candidate.compoundOrigin);
    await f.sdk.sessions.delete(f.sessionId, true);
    const retained = await f.sdk.compound.read(created.id);
    assert.equal(retained.workflow.status, "proposed");
    assert.ok(retained.roles[1]?.result?.includes("Generated public candidate"));
    assert.equal(retained.validations[0]?.result?.exitCode, 0);
    await assert.rejects(() => f.sdk.candidates.read(candidateId), { code: "candidate_missing" });
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
    assert.equal(restored.candidates.length, 0);
    for (const hash of [candidate.compoundOrigin.workflowInputDigest, candidate.compoundOrigin.roleInputDigest, candidate.compoundOrigin.resultDigest]) {
      assert.throws(() => reopened!.blob(hash), /Missing or deleted/);
    }
    assert.equal(restored.budgetEntries.reduce((tokens, entry) => tokens + (entry.reportedTokens ?? 0), 0), 84);
  } finally { reopened?.close(); await f.close(); }
});
