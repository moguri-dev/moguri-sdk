import assert from "node:assert/strict";
import { test } from "node:test";
import { winddownCapability } from "../apps/service/src/winddown-policy.ts";
import { compoundApiFixture } from "./fixtures/compound-api.ts";
import { waitFor } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("finite public compound admission reserves router and finishing capacity atomically, then winds down instead of admitting an unaffordable draft/escalation batch", { skip: process.platform !== "darwin", timeout: ciTime(20000) }, async () => {
  const f = await compoundApiFixture();
  try {
    f.options[2]!.replyText = JSON.stringify({ summary: "Generated compound wind-down: the full selected route cannot fit; no draft was staged or accepted." });
    const settings = structuredClone(f.sdk.settings.get()!.values);
    settings.winddown = { enabled: true, modelId: f.ids[2]!, allowHosted: false, outputTokens: 64, timeoutMs: 10000 };
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision); await f.configure();
    const initial = await f.sdk.compound.preview(f.input), router = initial.preview.document.roles.find((role) => role.role === "router"); assert.ok(router);
    const finish = winddownCapability(settings.winddown, f.service.controller.snapshot().provider.models, "Local");
    const tokens = finish.inputBound + finish.outputBound + router.inputBound + router.outputBound + 128;
    await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, budget: { kind: "limited", basis: "estimate", tokens } });
    const preview = await f.sdk.compound.preview(f.input), started = await f.sdk.compound.start(f.input, preview.preview.digest, true); assert.ok(started.id);
    await waitFor(() => !f.session().turnId, 10000);
    const report = (await f.sdk.compound.read(started.id)).workflow, winddown = f.sdk.winddown.list(f.sessionId)[0]; assert.ok(winddown);
    assert.equal(report.status, "partial"); assert.equal(report.selectedCandidateId, null);
    assert.equal((await f.sdk.winddown.read(winddown.id)).winddown.status, "ready");
    assert.equal(f.requests.length, 1); assert.equal(f.providers[1]!.requests.length, 0); assert.equal(f.providers[2]!.requests.length, 1);
    assert.equal(f.service.controller.snapshot().candidates.length, 0); assert.equal(await f.source(), "generated original\n");
    assert.deepEqual(f.service.controller.snapshot().budgetEntries.map((entry) => entry.role), ["router", "checkpoint"]);
    assert.equal(f.service.controller.snapshot().budgetPlans.filter((plan) => plan.status === "held").length, 0);
    const status = (await f.sdk.budgets.status(f.sessionId)).status;
    assert.equal(status.totals.reportedTokens, 84); assert.ok(status.totals.knownReportedTokens <= tokens);
  } finally { await f.close(); }
});
