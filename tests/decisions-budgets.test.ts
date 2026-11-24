import assert from "node:assert/strict";
import { test } from "node:test";
import { setupDecisions } from "./fixtures/decisions-api.ts";
import { waitFor } from "./fixture.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("a finite parent cannot shrink the complete decision output contract to its remaining affordable prefix or remove a hard cap", { skip: process.platform !== "darwin", timeout: ciTime(12000) }, async () => {
  const f = await setupDecisions({ primary: { maxOutputTokens: 64 } });
  try {
    const settings = structuredClone(f.sdk.settings.get()!.values);
    settings.localModels[0]!.models[0]!.maxTokens = 4096; settings.decisions.outputTokens = 4096;
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision); await f.sdk.models.refresh();
    const text = "generated tool exact finite decision output contract";
    await f.sdk.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: f.session().draft.revision, text, attachments: [] });
    const estimate = (await f.sdk.sessions.context(f.sessionId)).context.estimatedTokens, cap = estimate + 64;
    await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, budget: { kind: "limited", basis: "estimate", tokens: cap } });
    await f.sdk.command({ type: "message.send", sessionId: f.sessionId, expectedRevision: f.session().draft.revision, delivery: "queue" });
    const record = await waitFor(() => f.service.controller.snapshot().decisions.find((record) => record.status === "rejected"));
    assert.equal(record.outputBound, 4096); assert.ok(record.inputBound + record.outputBound > cap - 42);
    assert.equal(record.stepId, null); assert.match(record.diagnostic ?? "", /budget|capacity|output contract/i);
    assert.equal(f.advice.requests.length, 0); assert.equal(f.requests.length, 1); assert.ok(f.session().pendingApproval);
    assert.equal(f.service.controller.snapshot().budgetEntries.length, 1); assert.equal((await f.sdk.budgets.status(f.sessionId)).status.totals.reportedTokens, 42);
    assert.deepEqual(f.session().controls.budget, { kind: "limited", basis: "estimate", tokens: cap });
  } finally { await f.close(); }
});

test("a missing decision-model USD rate stays unpriced and blocks that actual role before dispatch instead of borrowing the solver price", { skip: process.platform !== "darwin", timeout: ciTime(12000) }, async () => {
  const f = await setupDecisions();
  try {
    const settings = structuredClone(f.sdk.settings.get()!.values);
    settings.budgets.rates = [{ modelId: f.modelId, inputUsdPerMillion: 1, outputUsdPerMillion: 2, effectiveAt: new Date().toISOString().slice(0, 10), source: "user-estimate" }];
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision);
    await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, budget: { kind: "limited", basis: "estimate", usd: 0.1 } });
    assert.equal((await f.sdk.decisions.status(f.sessionId)).ready, false);
    await f.send("generated tool explicitly unpriced decision");
    const record = await waitFor(() => f.service.controller.snapshot().decisions.find((record) => record.status === "rejected"));
    assert.equal(record.stepId, null); assert.match(record.diagnostic ?? "", /price|USD|estimate|unpriced/i);
    assert.equal(f.advice.requests.length, 0); assert.equal(f.requests.length, 1); assert.ok(f.session().pendingApproval);
    assert.equal(f.service.controller.snapshot().budgetEntries.some((entry) => entry.role === "decision"), false);
  } finally { await f.close(); }
});

test("explicit fresh per-model USD estimates account for solver and decision roles once without inventing provider-reported or billed spend", { skip: process.platform !== "darwin", timeout: ciTime(12000) }, async () => {
  const f = await setupDecisions();
  try {
    const settings = structuredClone(f.sdk.settings.get()!.values);
    settings.budgets.rates = [f.modelId, f.decisionModelId].map((modelId) => ({ modelId, inputUsdPerMillion: 1, outputUsdPerMillion: 2,
      effectiveAt: new Date().toISOString().slice(0, 10), source: "user-estimate" }));
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision);
    await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, budget: { kind: "limited", basis: "estimate", usd: 0.1 } });
    await f.send("generated tool all-role USD accounting"); await f.terminal();
    const status = (await f.sdk.budgets.status(f.sessionId)).status;
    assert.equal(status.totals.reportedTokens, 126); assert.equal(status.totals.estimatedUsd, 0.000162);
    assert.equal(status.totals.billedUsd, null); assert.equal(status.totals.heldTokens, 0);
    assert.equal(f.service.controller.snapshot().budgetEntries.filter((entry) => entry.role === "decision").length, 1);
    assert.equal(f.service.controller.snapshot().decisions[0]?.status, "applied");
  } finally { await f.close(); }
});
