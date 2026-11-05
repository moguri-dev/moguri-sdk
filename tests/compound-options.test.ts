import test from "node:test";
import assert from "node:assert/strict";
import { compoundApiFixture } from "./fixtures/compound-api.ts";
import { remoteCompoundFixture } from "./fixtures/compound-env-api.ts";
import { waitFor } from "./fixture.ts";
import { compoundModelBinding } from "../apps/service/src/compound-policy.ts";
import { digest } from "../apps/service/src/store.ts";
import type { CompoundResponse } from "../packages/sdk/src/index.ts";

type ValidationReview = Extract<CompoundResponse, { type: "compound.read" }>["pendingValidation"];

test("public compound options bind the classifier and every route role before preview or paid dispatch", {
  skip: process.platform !== "darwin", timeout: 40_000,
}, async () => {
  const f = await compoundApiFixture({ reasoning: true, hostedRoles: true });
  try {
    await f.configure();
    const options = { contextWindow: 98_305, thinkingEffort: "high" as const };
    const { report } = await f.sdk.routing.options(f.sessionId, options);
    assert.equal(report.available, true, report.diagnostic ?? "");
    assert.ok(report.modelIds.includes(f.modelId));
    for (const id of [f.ids[0]!, f.ids[1]!, f.ids[2]!]) assert.ok(report.modelIds.includes(id));
    assert.ok(report.thinkingLevels.includes("high"));
    await f.sdk.sessions.modelOptions(f.sessionId, options);
    const preview = (await f.sdk.compound.preview(f.input)).preview;
    for (const role of preview.document.roles) {
      assert.equal(JSON.parse(role.modelJson).contextWindow, 262144);
      assert.ok(role.inputBound + role.outputBound + 4096 <= options.contextWindow);
    }
    await f.sdk.sessions.modelOptions(f.sessionId, { ...options, contextWindow: 131_073 });
    await assert.rejects(() => f.sdk.compound.start(f.input, preview.digest, true), /review|changed|stale|original/i);
    assert.equal(f.requests.length, 0);
    assert.ok(f.providers.every((provider) => provider.requests.length === 0));
    await f.sdk.sessions.modelOptions(f.sessionId, { ...options, contextWindow: 8192 });
    await assert.rejects(() => f.sdk.compound.preview(f.input), /future|envelope|working window|bound/i);
    assert.equal(f.requests.length, 0);
    assert.ok(f.providers.every((provider) => provider.requests.length === 0));
  } finally { await f.close(); }
});

for (const pattern of ["cascade", "critique"] as const) test(`actual public ${pattern} forwards exact window/effort to every actual role without capacity relabeling`, {
  skip: process.platform !== "darwin", timeout: 40_000,
}, async () => {
  const f = await compoundApiFixture({ reasoning: true, hostedRoles: true });
  try {
    f.options[1]!.replyText = JSON.stringify({ ...f.proposal, patch: { ...f.proposal.patch,
      edits: [{ ...f.proposal.patch.edits[0]!, text: "Generated failing exact-options draft.\n" }] } });
    if (pattern === "critique") {
      const models = f.sdk.getState().snapshot!.provider.models, draft = models.find((model) => model.id === f.ids[1])!, critic = models.find((model) => model.id === f.ids[3])!;
      const sourceText = "Generated synthetic role lineage claim; not real training or quality evidence.";
      f.policy.routes = [{ id: "generated-options-critique", pattern: "critique", draftId: draft.id, criticId: critic.id, lineageReviewId: "generated-options-lineage" }];
      f.policy.lineageReviews = [{ version: 1, id: "generated-options-lineage", actor: "user", draftBindingDigest: compoundModelBinding(draft),
        criticBindingDigest: compoundModelBinding(critic), draftLineage: "generated-alpha", criticLineage: "generated-beta",
        sourceKind: "reviewed-training-report", sourceUrl: "https://generated.example.invalid/options-lineage", sourceText,
        sourceDigest: digest(sourceText), reviewedAt: new Date(Date.now() - 1000).toISOString(), validUntil: new Date(Date.now() + 3600000).toISOString(),
        limitations: "Fixture source claim, never independent model evaluation or permission." }];
      f.routerOptions.replyText = JSON.stringify({ routeId: f.policy.routes[0]!.id, pattern: "critique", draftId: draft.id, criticId: critic.id,
        confidence: 0.95, reason: "GENERATED_ROUTER_REASON_NOT_SOLVER_CONTEXT" });
      const pass = { verdict: "pass", reason: "Generated bounded observation, not acceptance.", issues: [] };
      f.options[3]!.replyText = JSON.stringify({ verdict: "pass", plan: pass, architecture: pass, implementation: pass });
    }
    await f.configure();
    await f.sdk.sessions.modelOptions(f.sessionId, { contextWindow: 98_305, thinkingEffort: "high" });
    const preview = (await f.sdk.compound.preview(f.input)).preview;
    const { id } = await f.sdk.compound.start(f.input, preview.digest, true);
    assert.ok(id);
    for (const count of [1, 2]) {
      const pending = await waitFor(() => {
        const value = f.service.controller.snapshot().compoundWorkflows.find((record) => record.id === id);
        return value?.status === "waiting_validation" && value.validations.length === count ? value : null;
      }, 12000);
      const review: ValidationReview = (await f.sdk.compound.read(id)).pendingValidation;
      assert.ok(review);
      if (count === 1) f.options[1]!.replyText = JSON.stringify(f.proposal);
      await f.sdk.compound.review(id, review.validationId, pending.revision, review.digest, true);
    }
    const done = await waitFor(() => {
      const value = f.service.controller.snapshot().compoundWorkflows.find((record) => record.id === id);
      return value?.status === "proposed" && !f.session().turnId ? value : null;
    }, 12000);
    assert.deepEqual(done.steps.map((step) => step.role), pattern === "cascade" ? ["router", "draft", "escalation"] : ["router", "draft", "critic", "revision"]);
    for (const request of [...f.requests, ...f.providers.flatMap((provider) => provider.requests)]) assert.equal(request.reasoning_effort, "high");
    const starts = f.service.controller.events(0).filter((event) => event.event_type === "model.started" && event.turn_id === id);
    assert.equal(starts.length, pattern === "cascade" ? 3 : 4);
    for (const event of starts) if (event.event_type === "model.started") {
      assert.equal(event.payload.contextWindow, 98_305);
      assert.equal(event.payload.thinkingEffort, "high");
    }
    assert.equal(await f.source(), "generated original\n");
    assert.equal((await f.sdk.candidates.read(done.selectedCandidateId!)).candidate.acceptance, null);
    assert.ok(f.service.controller.snapshot().budgetEntries.every((entry) => entry.status === "settled"));
  } finally { await f.close(); }
});

for (const pattern of ["cascade", "critique"] as const) test(`actual SSH ${pattern} preserves exact pooled windows through failed draft tests and the later ${pattern === "cascade" ? "escalation" : "critic/revision"}`, {
  skip: process.platform !== "darwin", timeout: 150_000,
}, async () => {
  const f = await remoteCompoundFixture(pattern);
  try {
    f.options[1]!.replyText = JSON.stringify({ ...f.proposal, patch: { ...f.proposal.patch,
      edits: [{ ...f.proposal.patch.edits[0]!, text: "Generated failing exact-window peer draft.\n" }] } });
    await f.sdk.sessions.modelOptions(f.sessionId, { contextWindow: 98_305 });
    const preview = (await f.sdk.compound.preview(f.input)).preview, { id } = await f.sdk.compound.start(f.input, preview.digest, true);
    assert.ok(id);
    for (const count of [1, 2]) {
      const pending = await waitFor(() => {
        const value = f.service.controller.snapshot().compoundWorkflows.find((record) => record.id === id);
        if (value && !["running", "waiting_validation", "validating"].includes(value.status)) throw new Error(value.diagnostic ?? `Unexpected peer outcome ${value.status}`);
        return value?.status === "waiting_validation" && value.validations.length === count ? value : null;
      }, 60000);
      const review: ValidationReview = (await f.sdk.compound.read(id)).pendingValidation;
      assert.ok(review);
      if (count === 1) f.options[1]!.replyText = JSON.stringify(f.proposal);
      await f.sdk.compound.review(id, review.validationId, pending.revision, review.digest, true);
    }
    const done = await waitFor(() => {
      const value = f.service.controller.snapshot().compoundWorkflows.find((record) => record.id === id);
      return value?.status === "proposed" && !f.session().turnId ? value : null;
    }, 30000);
    assert.deepEqual(done.steps.map((step) => step.role), pattern === "cascade" ? ["router", "draft", "escalation"] : ["router", "draft", "critic", "revision"]);
    assert.equal(done.validations[0]?.status, "failed");
    assert.equal(done.validations[1]?.status, "passed");
    const starts = f.service.controller.events(0).filter((event) => event.event_type === "model.started" && event.turn_id === id);
    assert.equal(starts.length, pattern === "cascade" ? 3 : 4);
    for (const event of starts) if (event.event_type === "model.started") assert.equal(event.payload.contextWindow, 98_305);
    assert.ok(f.service.controller.snapshot().budgetEntries.every((entry) => entry.env === "Remote" && entry.status === "settled"));
    assert.equal((await f.sdk.candidates.read(done.selectedCandidateId!)).candidate.acceptance, null);
    assert.equal(await f.source(), "generated original\n");
  } finally { await f.close(); }
});

test("a peer journal options change during validation cannot authorize a later role or retain the old project-test review", {
  skip: process.platform !== "darwin", timeout: 30_000,
}, async () => {
  const f = await compoundApiFixture({ reasoning: true, hostedRoles: true });
  try {
    await f.configure(); await f.sdk.sessions.modelOptions(f.sessionId, { contextWindow: 98_305, thinkingEffort: "high" });
    const preview = (await f.sdk.compound.preview(f.input)).preview, { id } = await f.sdk.compound.start(f.input, preview.digest, true);
    assert.ok(id);
    const pending = await waitFor(() => {
      const value = f.service.controller.snapshot().compoundWorkflows.find((record) => record.id === id);
      return value?.status === "waiting_validation" ? value : null;
    }, 12000);
    const review = (await f.sdk.compound.read(id)).pendingValidation;
    assert.ok(review);
    const session = f.session();
    f.service.store.commit([{ event_type: "session.configured", profile_id: f.sdk.profileId, project_id: session.projectId, session_id: session.id,
      payload: { controls: { ...session.controls, modelOptions: { contextWindow: 131_073, thinkingEffort: "high" } } } }]);
    f.service.controller.refreshProfile(); await f.sdk.refresh();
    await assert.rejects(() => f.sdk.compound.review(id, review.validationId, pending.revision, review.digest, true), /changed|stale|policy|review|controls/i);
    assert.equal(f.providers[2]!.requests.length, 0); assert.equal(f.providers[3]!.requests.length, 0);
    await f.sdk.compound.stop(id);
    await waitFor(() => !f.session().turnId);
    assert.equal(await f.source(), "generated original\n");
  } finally { await f.close(); }
});
