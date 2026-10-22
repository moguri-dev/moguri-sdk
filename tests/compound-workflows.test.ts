import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { compoundApiFixture } from "./fixtures/compound-api.ts";
import { waitFor } from "./fixture.ts";
import { compoundModelBinding } from "../apps/service/src/compound-policy.ts";
import { digest } from "../apps/service/src/store.ts";

async function waitForValidation(f: Awaited<ReturnType<typeof compoundApiFixture>>, id: string, count: number) {
  return waitFor(() => {
    const value = f.service.controller.snapshot().compoundWorkflows.find((record) => record.id === id);
    return value?.status === "waiting_validation" && value.validations.length === count ? value : null;
  }, 12000);
}
async function approve(f: Awaited<ReturnType<typeof compoundApiFixture>>, id: string, count: number) {
  const value = await waitForValidation(f, id, count), review = (await f.sdk.compound.read(id)).pendingValidation;
  assert.ok(review);
  await f.sdk.compound.review(id, review.validationId, value.revision, review.digest, true);
}

test("public Cascade uses the actual selected route, pauses before staging/tests and recommends only the actually tested isolated candidate", { skip: process.platform !== "darwin", timeout: 30000 }, async () => {
  const f = await compoundApiFixture();
  try {
    await f.configure();
    const index = await readFile(join(f.project, ".git/index")), head = f.git(["rev-parse", "HEAD"]);
    const preview = await f.sdk.compound.preview(f.input);
    const started = await f.sdk.compound.start(f.input, preview.preview.digest, true); assert.ok(started.id);
    const pending = await waitForValidation(f, started.id, 1);
    assert.equal(f.providers[0]!.requests.length, 0); assert.equal(f.providers[1]!.requests.length, 1); assert.equal(f.providers[2]!.requests.length, 0);
    assert.equal(await f.source(), "generated original\n");
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "generated original\n");
    const review = (await f.sdk.compound.read(started.id)).pendingValidation; assert.ok(review);
    assert.equal(review.document.command, f.command); assert.equal(review.document.proposal.plan, f.proposal.plan);
    assert.equal(review.document.proposal.architecture, f.proposal.architecture);
    await f.sdk.compound.review(started.id, review.validationId, pending.revision, review.digest, true);
    const finished = await waitFor(() => {
      const value = f.service.controller.snapshot().compoundWorkflows.find((record) => record.id === started.id);
      return value?.status === "proposed" && !f.session().turnId ? value : null;
    });
    assert.equal(finished.route?.draftId, f.ids[1]); assert.ok(finished.selectedCandidateId);
    const result = await f.sdk.compound.read(started.id);
    assert.match(result.validations[0]!.result!.text, /GENERATED_REAL_PROJECT_TEST_PASSED/);
    assert.equal(result.validations[0]!.result!.exitCode, 0);
    assert.equal(f.providers[2]!.requests.length, 0);
    assert.equal(await f.source(), "generated original\n");
    assert.deepEqual(await readFile(join(f.project, ".git/index")), index); assert.equal(f.git(["rev-parse", "HEAD"]), head);
    assert.equal(JSON.stringify(f.providers[1]!.requests).includes("GENERATED_ROUTER_REASON_NOT_SOLVER_CONTEXT"), false);
    assert.ok(f.service.controller.snapshot().budgetEntries.every((entry) => entry.status === "settled"));
    const candidate = await f.sdk.candidates.read(finished.selectedCandidateId);
    assert.equal(candidate.candidate.acceptance, null);
    assert.equal(candidate.document.compoundOrigin?.workflowId, started.id);
  } finally { await f.close(); }
});

test("a known real project-test failure escalates once into the second clean worktree without resetting or applying the failed draft", { skip: process.platform !== "darwin", timeout: 30000 }, async () => {
  const f = await compoundApiFixture();
  try {
    f.options[1]!.replyText = JSON.stringify({ ...f.proposal, patch: { ...f.proposal.patch, edits: [{ ...f.proposal.patch.edits[0]!, text: "Generated failing draft.\n" }] } });
    await f.configure();
    const preview = await f.sdk.compound.preview(f.input), started = await f.sdk.compound.start(f.input, preview.preview.digest, true); assert.ok(started.id);
    await approve(f, started.id, 1);
    const second = await waitForValidation(f, started.id, 2);
    assert.equal(second.validations[0]?.status, "failed"); assert.equal(f.providers[2]!.requests.length, 1);
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "Generated failing draft.\n");
    assert.equal(await readFile(join(f.alternate.path, "fixture.txt"), "utf8"), "generated original\n");
    await approve(f, started.id, 2);
    const done = await waitFor(() => {
      const value = f.service.controller.snapshot().compoundWorkflows.find((record) => record.id === started.id);
      return value?.status === "proposed" && !f.session().turnId ? value : null;
    });
    assert.deepEqual(done.steps.map((step) => step.role), ["router", "draft", "escalation"]);
    assert.equal(done.selectedCandidateId, done.validations[1]?.candidateId);
    assert.equal(await f.source(), "generated original\n");
    assert.equal(await readFile(join(f.workspace.path, "fixture.txt"), "utf8"), "Generated failing draft.\n");
    assert.equal(await readFile(join(f.alternate.path, "fixture.txt"), "utf8"), "Generated passing candidate.\n");
    assert.deepEqual(f.service.controller.snapshot().budgetEntries.map((entry) => entry.role), ["router", "draft", "escalation"]);
    f.routerOptions.replyText = "Generated ordinary fixed-model follow-up.";
    await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, modelId: f.modelId });
    await f.send("Generated ordinary task after public routing."); await f.terminal();
    assert.equal(f.requests.length, 2);
    assert.equal(JSON.stringify(f.requests[1]?.messages).includes(f.proposal.plan), false);
  } finally { await f.close(); }
});

test("real critique covers the task plan, architecture and implementation but cannot override failed tests or accept the revision source", { skip: process.platform !== "darwin", timeout: 40000 }, async (t) => {
  const f = await compoundApiFixture();
  try {
    const models = f.sdk.getState().snapshot!.provider.models, draft = models.find((model) => model.id === f.ids[1])!, critic = models.find((model) => model.id === f.ids[3])!;
    const sourceText = "Generated reviewed source: synthetic lineage alpha and beta. Fixture data is not evidence about real training or quality.";
    f.policy.routes = [{ id: "generated-critique", pattern: "critique", draftId: draft.id, criticId: critic.id, lineageReviewId: "generated-lineage-review" }];
    f.policy.lineageReviews = [{ version: 1, id: "generated-lineage-review", actor: "user", draftBindingDigest: compoundModelBinding(draft), criticBindingDigest: compoundModelBinding(critic),
      draftLineage: "generated-alpha", criticLineage: "generated-beta", sourceKind: "reviewed-training-report", sourceUrl: "https://generated.example.invalid/training-report",
      sourceText, sourceDigest: digest(sourceText), reviewedAt: new Date(Date.now() - 1000).toISOString(), validUntil: new Date(Date.now() + 3600000).toISOString(),
      limitations: "Synthetic fixture policy claim, not training independence or calibrated code quality." }];
    f.routerOptions.replyText = JSON.stringify({ routeId: "generated-critique", pattern: "critique", draftId: draft.id, criticId: critic.id, confidence: 0.95, reason: "GENERATED_ROUTER_REASON_NOT_SOLVER_CONTEXT" });
    const pass = { verdict: "pass", reason: "Generated scoped observation, never approval.", issues: [] };
    f.options[3]!.replyText = JSON.stringify({ verdict: "pass", plan: pass, architecture: pass, implementation: pass });
    f.options[1]!.replyText = JSON.stringify({ ...f.proposal, patch: { ...f.proposal.patch, edits: [{ ...f.proposal.patch.edits[0]!, text: "Generated failing draft.\n" }] } });
    const prepare = f.service.controller.provider.prepare.bind(f.service.controller.provider); let drafts = 0;
    t.mock.method(f.service.controller.provider, "prepare", async (id: string, signal: AbortSignal) => {
      if (id === draft.id && ++drafts === 2) f.options[1]!.replyText = JSON.stringify(f.proposal);
      return prepare(id, signal);
    });
    await f.configure();
    const preview = await f.sdk.compound.preview(f.input), started = await f.sdk.compound.start(f.input, preview.preview.digest, true); assert.ok(started.id);
    await approve(f, started.id, 1);
    const revision = await waitForValidation(f, started.id, 2);
    assert.equal(revision.phase, "revision"); assert.equal(revision.validations[0]?.status, "failed");
    assert.equal(f.providers[3]!.requests.length, 1); assert.equal(f.providers[1]!.requests.length, 2);
    const criticInput = JSON.stringify(f.providers[3]!.requests[0]!.messages);
    for (const value of [f.input.input.task, f.proposal.plan, f.proposal.architecture, "Generated failing draft.", "[exit=7]"]) assert.ok(criticInput.includes(value));
    assert.equal(criticInput.includes("GENERATED_ROUTER_REASON_NOT_SOLVER_CONTEXT"), false);
    await approve(f, started.id, 2);
    const done = await waitFor(() => {
      const value = f.service.controller.snapshot().compoundWorkflows.find((record) => record.id === started.id);
      return value?.status === "proposed" && !f.session().turnId ? value : null;
    });
    assert.deepEqual(done.steps.map((step) => step.role), ["router", "draft", "critic", "revision"]);
    const retained = await f.sdk.compound.read(started.id);
    const actualCritic = retained.roles.find((role) => role.step.role === "critic");
    assert.ok(actualCritic); assert.ok(actualCritic.result?.includes("architecture"));
    assert.ok(actualCritic.input?.includes("untrustedValidationEvidence"));
    assert.equal(done.selectedCandidateId, done.validations[1]?.candidateId);
    assert.equal((await f.sdk.candidates.read(done.selectedCandidateId!)).candidate.acceptance, null);
    assert.equal(await f.source(), "generated original\n");
  } finally { await f.close(); }
});
