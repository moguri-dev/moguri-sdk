import assert from "node:assert/strict";
import { test } from "node:test";
import { compoundModelBinding, compoundPlan, compoundPool } from "../apps/service/src/compound-policy.ts";
import type { ModelInfo } from "../packages/sdk/src/index.ts";
import type { CompoundSettings } from "../packages/protocol/src/compound.ts";
import { digest } from "../apps/service/src/store.ts";

function fixture() {
  const models: ModelInfo[] = ["router", "draft", "critic", "escalation"].map((id) => ({
    id: `generated-${id}`, name: `Generated ${id}`, providerId: "generated-provider", apiModelId: `generated-api-${id}`,
    source: "copilot", contextWindow: 131072, maxTokens: 8192, imageInput: false, environments: ["Local"],
  }));
  const policy: CompoundSettings = { enabled: true, workflow: "compound", classifierModelId: "generated-router", approvedModelIds: ["generated-draft", "generated-critic", "generated-escalation"],
    allowHosted: true, minimumConfidence: 0.9, routes: [
      { id: "generated-cascade", pattern: "cascade", draftId: "generated-draft", escalationId: "generated-escalation" },
      { id: "generated-critique", pattern: "critique", draftId: "generated-draft", criticId: "generated-critic", lineageReviewId: null },
    ], lineageReviews: [], limits: { routerTokens: 512, proposalTokens: 8192, criticTokens: 2048, timeoutMs: 300000 } };
  return { policy, models };
}
test("public critique never treats provider family labels or different display names as reviewed training-lineage eligibility", () => {
  const { policy, models } = fixture(); policy.routes = policy.routes.filter((route) => route.pattern === "critique");
  assert.throws(() => compoundPool(policy, models, "Local"), { code: "compound_lineage" });
});

test("the classifier receives only eligible declared routes while missing critique evidence does not disable a configured Cascade alternative", () => {
  const { policy, models } = fixture();
  const pool = compoundPool(policy, models, "Local");
  assert.deepEqual(pool.routes.map((route) => route.id), ["generated-cascade"]);
  assert.equal(pool.diagnostics[0]?.code, "compound_lineage");
});

function reviewedFixture() {
  const { policy, models } = fixture(), sourceText = "Generated external lineage source: synthetic roots alpha and beta. This fixture is not real-model independence or quality evidence.";
  policy.routes = [{ id: "generated-critique", pattern: "critique", draftId: "generated-draft", criticId: "generated-critic", lineageReviewId: "generated-review" }];
  policy.lineageReviews = [{ version: 1, id: "generated-review", actor: "user",
    draftBindingDigest: compoundModelBinding(models[1]!), criticBindingDigest: compoundModelBinding(models[2]!),
    draftLineage: "generated-alpha", criticLineage: "generated-beta", sourceKind: "reviewed-training-report",
    sourceUrl: "https://generated.example.invalid/training-report", sourceText, sourceDigest: digest(sourceText),
    reviewedAt: new Date(Date.now() - 1000).toISOString(), validUntil: new Date(Date.now() + 86400_000).toISOString(),
    limitations: "Generated policy fixture only; actual training remains unobservable and no code quality is established." }];
  return { policy, models };
}
test("a reviewed lineage assertion binds exact source bytes and remains an explicitly limited eligibility claim", () => {
  const { policy, models } = reviewedFixture();
  const pool = compoundPool(policy, models, "Local");
  assert.equal(pool.routes[0]?.pattern, "critique"); assert.match(pool.warning, /not proof|not.*quality/i);
  policy.lineageReviews[0]!.sourceText += " Generated changed source bytes.";
  assert.throws(() => compoundPool(policy, models, "Local"), { code: "compound_lineage" });
});

test("expired, future-reviewed or unsafe-source lineage claims never enable a critic", () => {
  for (const changes of [
    { validUntil: new Date(Date.now() - 1000).toISOString() },
    { reviewedAt: new Date(Date.now() + 60_000).toISOString() },
    { validUntil: "Generated invalid timestamp" },
    { sourceUrl: "http://127.0.0.1/generated-source" },
    { sourceUrl: "https://generated:private@example.invalid/model-card" },
  ]) {
    const { policy, models } = reviewedFixture();
    Object.assign(policy.lineageReviews[0]!, changes);
    assert.throws(() => compoundPool(policy, models, "Local"), { code: "compound_lineage" });
  }
});

test("compound capacity uses each reviewed actual role output bound rather than the provider's theoretical maximum", () => {
  const { policy, models } = fixture();
  policy.routes = policy.routes.filter((route) => route.pattern === "cascade");
  policy.limits.routerTokens = 512; policy.limits.proposalTokens = 512;
  const bounded = models.map((model) => ({ ...model, contextWindow: 16384, maxTokens: 16384 }));
  const pool = compoundPool(policy, bounded, "Local", 1024);
  assert.equal(pool.routes[0]?.id, "generated-cascade");
});

test("the actual classifier result binds one eligible route and its concrete roles rather than silently using the first configured route", () => {
  const { policy, models } = fixture();
  policy.routes = [
    { id: "generated-first", pattern: "cascade", draftId: "generated-draft", escalationId: "generated-escalation" },
    { id: "generated-selected", pattern: "cascade", draftId: "generated-critic", escalationId: "generated-escalation" },
  ];
  const pool = compoundPool(policy, models, "Local");
  const advice = { routeId: "generated-selected", pattern: "cascade", draftId: "generated-critic", escalationId: "generated-escalation",
    confidence: 0.95, reason: "Generated router text is data, not implementation instructions or permission." };
  const selected = compoundPlan(JSON.stringify(advice), pool.routes, policy.minimumConfidence);
  assert.equal(selected.route.draftId, "generated-critic");
  assert.equal(selected.plan.reason, advice.reason);
  assert.throws(() => compoundPlan(JSON.stringify({ ...advice, draftId: "generated-draft" }), pool.routes, 0.9), { code: "compound_plan" });
});
