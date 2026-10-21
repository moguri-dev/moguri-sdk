import test from "node:test";
import assert from "node:assert/strict";
import { modelEvidenceFixture } from "./fixtures/model-evidence-api.ts";

test("profile-scoped SDK and shared evidence reads use the real explicit adapter without a model call, permission or durable event", async () => {
  const f = await modelEvidenceFixture();
  try {
    const before = f.service.controller.events(0).length;
    assert.equal(f.reads(), 0);
    const read = await f.sdk.models.evidence(f.modelId);
    assert.equal(read.type, "model.evidence"); assert.equal(read.evidence.status, "declared");
    assert.equal(read.evidence.claimed.family, "generated-provider-declared-family");
    assert.equal(f.reads(), 1); assert.equal(f.requests.length, 0); assert.equal(f.service.controller.events(0).length, before);
    assert.equal((await f.sdk.budgets.calls()).calls.length, 0);
    const shared = await f.sdk.slash(f.sessionId, "/model-evidence", "tui");
    assert.ok(shared.kind === "text"); assert.equal(JSON.parse(shared.text).evidence.apiModelId, f.modelId);
    assert.equal(f.reads(), 2); assert.equal(f.requests.length, 0);
    assert.equal(f.service.controller.events(0).length, before);
    await assert.rejects(() => f.sdk.models.evidence("generated-foreign-model"), { code: "model_evidence_unavailable" });
    assert.equal(f.reads(), 2);
  } finally { await f.close(); }
});

test("an inspector read cannot silently select a model, change family settings or weaken policy", async () => {
  const f = await modelEvidenceFixture();
  try {
    const controls = structuredClone(f.session().controls), settings = structuredClone(f.service.controller.snapshot().settings), policy = structuredClone(f.service.controller.snapshot().policy);
    f.catalogue({ data: [{ id: f.modelId }] });
    const report = (await f.sdk.models.evidence(f.modelId)).evidence;
    assert.equal(report.status, "unknown"); assert.equal(report.claimed.family, null);
    assert.deepEqual(f.session().controls, controls); assert.deepEqual(f.service.controller.snapshot().settings, settings);
    assert.deepEqual(f.service.controller.snapshot().policy, policy); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
