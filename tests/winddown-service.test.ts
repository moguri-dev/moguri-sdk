import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetCharges } from "../apps/service/src/budgets.ts";
import { fixtureProvider } from "./fixture.ts";
import { routedFixture } from "./fixtures/single-routing.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("finite Single reserves its whole finishing role before routing, then uses it at the actual cap without a solver call or invented Git success", { skip: process.platform !== "darwin", timeout: ciTime(20000) }, async (t) => {
  const f = await routedFixture(), checkpoint = await fixtureProvider({ modelId: "generated-service-checkpoint-api", responseMode: "text", exposeModels: true, replyText: JSON.stringify({ summary: "Generated wind-down: ordinary work was blocked by the actual cumulative cap. No code was accepted or committed." }) });
  try {
    const settings = structuredClone(f.sdk.settings.get()!.values);
    settings.localModels.push({ id: "generated-winddown", name: "Generated wind-down model", enabled: true, baseUrl: checkpoint.baseUrl + "/v1", auth: "none",
      models: [{ id: checkpoint.modelId, name: "Generated wind-down model", contextWindow: 32768, maxTokens: 128, imageInput: false }] });
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision); await f.sdk.models.refresh();
    const model = f.sdk.getState().snapshot!.provider.models.find((model) => model.name === "Generated wind-down model"); assert.ok(model);
    const configured = structuredClone(f.sdk.settings.get()!.values);
    configured.winddown = { enabled: true, modelId: model.id, allowHosted: false, outputTokens: 64, timeoutMs: 10000 };
    await f.sdk.settings.update(configured, f.sdk.settings.get()!.revision);
    await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, budget: { kind: "limited", basis: "estimate", tokens: 1000000 } });
    await f.select();
    const prepare = f.service.controller.provider.prepare.bind(f.service.controller.provider); let cap: number | null = null;
    t.mock.method(f.service.controller.provider, "prepare", async (id: string, signal: AbortSignal) => {
      const value = await prepare(id, signal);
      if (id === f.solverId) {
        const state = f.service.controller.snapshot();
        cap = budgetCharges(state.budgetEntries, state.budgetPlans).tokens;
        assert.ok(cap !== null); assert.ok(state.budgetPlans.some((plan) => plan.role === "checkpoint" && plan.status === "held"));
        await f.sdk.budgets.policy({ basis: "estimate", tokens: cap }, state.budgetPolicy.revision, true);
      }
      return value;
    });
    await f.send("Generated finite routed request with reserved final checkpoint."); await f.terminal(); await f.sdk.refresh();
    assert.equal(f.session().status, "partial"); assert.equal(f.requests.length, 1); assert.equal(f.solver.requests.length, 0); assert.equal(checkpoint.requests.length, 1);
    const record = f.sdk.winddown.list(f.sessionId)[0]; assert.ok(record);
    const result = await f.sdk.winddown.read(record.id);
    assert.equal(result.winddown.status, "ready"); assert.equal(result.winddown.step.role, "checkpoint");
    assert.equal(result.winddown.commit, null); assert.ok(result.result?.includes("No code was accepted or committed"));
    assert.equal(f.service.controller.snapshot().budgetEntries.find((entry) => entry.role === "checkpoint")?.planId, record.step.planId);
    assert.deepEqual(f.service.controller.snapshot().budgetEntries.map((entry) => entry.role), ["router", "checkpoint"]);
    const status = (await f.sdk.budgets.status(f.sessionId)).status;
    assert.equal(status.totals.reportedTokens, 84); assert.equal(status.totals.plannedHolds, 0);
    assert.ok(cap !== null && status.totals.knownReportedTokens <= cap);
    assert.equal(checkpoint.requests[0]?.tools, undefined); assert.equal(checkpoint.requests[0]?.max_tokens ?? checkpoint.requests[0]?.max_completion_tokens, 64);
    assert.equal(JSON.stringify(checkpoint.requests).includes("Generated finite routed request with reserved final checkpoint."), false);
  } finally { await f.close(); await checkpoint.close(); }
});
