import assert from "node:assert/strict";
import { test } from "node:test";
import { compoundApiFixture } from "./fixtures/compound-api.ts";
import { waitFor } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("an active public workflow report cannot be deleted or archived out from under its real pending validation owner", { skip: process.platform !== "darwin", timeout: ciTime(20000) }, async () => {
  const f = await compoundApiFixture();
  try {
    await f.configure();
    const preview = await f.sdk.compound.preview(f.input), created = await f.sdk.compound.start(f.input, preview.preview.digest, true); assert.ok(created.id);
    await waitFor(() => f.service.controller.snapshot().compoundWorkflows.find((record) => record.id === created.id)?.status === "waiting_validation");
    const artifact = (await f.sdk.artifacts.read(created.id)).artifact;
    await assert.rejects(() => f.sdk.artifacts.delete(created.id!, artifact.revision, true), { code: "compound_busy" });
    await assert.rejects(() => f.sdk.artifacts.update(created.id!, { status: "archived" }, artifact.revision), { code: "compound_busy" });
    await assert.rejects(() => f.sdk.artifacts.update(created.id!, { text: "Generated replacement input is not authority." }, artifact.revision), { code: "compound_document" });
    await f.sdk.compound.stop(created.id);
    await waitFor(() => !f.session().turnId);
    assert.ok(["stopped", "partial"].includes((await f.sdk.compound.read(created.id)).workflow.status));
    assert.equal(f.providers[2]!.requests.length, 0); assert.equal(await f.source(), "generated original\n");
  } finally { await f.close(); }
});

test("Manual rejection of the exact stage/test review starts no candidate or command, releases only future holds and does not quarantine untouched source", { skip: process.platform !== "darwin", timeout: ciTime(20000) }, async () => {
  const f = await compoundApiFixture();
  try {
    await f.configure();
    const preview = await f.sdk.compound.preview(f.input), created = await f.sdk.compound.start(f.input, preview.preview.digest, true); assert.ok(created.id);
    const pending = await waitFor(() => {
      const record = f.service.controller.snapshot().compoundWorkflows.find((record) => record.id === created.id);
      return record?.status === "waiting_validation" ? record : null;
    });
    const review = (await f.sdk.compound.read(created.id)).pendingValidation; assert.ok(review);
    await f.sdk.compound.review(created.id, review.validationId, pending.revision, review.digest, false);
    await waitFor(() => !f.session().turnId);
    const result = await f.sdk.compound.read(created.id);
    assert.equal(result.workflow.status, "stopped");
    assert.equal(result.workflow.validations[0]?.status, "denied");
    assert.equal(f.service.controller.snapshot().candidates.length, 0);
    assert.equal(f.service.controller.events(0).some((event) => event.event_type === "process.started"), false);
    assert.equal(f.service.controller.snapshot().blockedProjects.includes(f.session().projectId), false);
    assert.equal(f.service.controller.snapshot().budgetEntries.length, 2);
    assert.ok(f.service.controller.snapshot().budgetPlans.some((plan) => plan.role === "escalation" && plan.status === "released"));
    assert.equal(f.providers[2]!.requests.length, 0);
  } finally { await f.close(); }
});

test("held public-compound prompts stay held when ordinary Resume lacks exact source/worktree/test review", { skip: process.platform !== "darwin", timeout: ciTime(15000) }, async () => {
  const f = await compoundApiFixture();
  try {
    await f.configure();
    await f.sdk.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: f.session().draft.revision, text: "Generated held public request.", attachments: [] });
    const held = await f.sdk.command({ type: "message.send", sessionId: f.sessionId, expectedRevision: f.session().draft.revision, delivery: "queue", held: true });
    await assert.rejects(() => f.sdk.command({ type: "session.resume", sessionId: f.sessionId }), { code: "compound_review_required" });
    assert.equal(f.session().queue.find((item) => item.id === held.id)?.held, true);
    assert.equal(f.session().turnId, null); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
