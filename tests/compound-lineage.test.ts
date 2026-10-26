import assert from "node:assert/strict";
import { test } from "node:test";
import { compoundApiFixture } from "./fixtures/compound-api.ts";
import { compoundModelBinding } from "../apps/service/src/compound-policy.ts";
import { digest } from "../apps/service/src/store.ts";

test("the browser-safe SDK prepares only an unpersisted exact-model/source lineage claim without inspecting providers or granting critique", async () => {
  const f = await compoundApiFixture();
  try {
    const sourceText = "Generated reviewed synthetic source; no real-model quality or independence is established.";
    const value = await f.sdk.compound.lineageDraft({ draftModelId: f.ids[1]!, criticModelId: f.ids[3]!, draftLineage: "generated-alpha", criticLineage: "generated-beta",
      sourceKind: "reviewed-training-report", sourceUrl: "https://generated.example.invalid/source", sourceText, validUntil: new Date(Date.now() + 3600000).toISOString(),
      limitations: "Generated eligibility claim only. Actual training is not observable and quality is not calibrated." });
    const models = f.sdk.getState().snapshot!.provider.models;
    assert.equal(value.review.draftBindingDigest, compoundModelBinding(models.find((model) => model.id === f.ids[1])!));
    assert.equal(value.review.criticBindingDigest, compoundModelBinding(models.find((model) => model.id === f.ids[3])!));
    assert.equal(value.review.sourceDigest, digest(sourceText));
    assert.match(value.warning, /not.*persisted|unpersisted/i);
    const policy = f.sdk.routing.policy();
    assert.equal(policy?.workflow, "auto");
    assert.deepEqual(policy?.workflow === "auto" ? policy.lineageReviews : null, []);
    assert.equal(f.requests.length, 0); assert.ok(f.providers.every((provider) => provider.requests.length === 0));
  } finally { await f.close(); }
});
