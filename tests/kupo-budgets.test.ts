import test from "node:test";
import assert from "node:assert/strict";
import { defaultKupoSettings, KUPO_MODEL_ID, MoguriSdk, type ModelInfo } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { routedFixture } from "./fixtures/single-routing.ts";
import { generatedKupoProfile } from "./fixtures/kupo-profiles.ts";

async function finite(sdk: MoguriSdk, sessionId: string, modelId: string, tokens: number, usd?: number) {
  const settings = sdk.settings.get()!;
  const models = sdk.getState().snapshot!.provider.models.filter((model): model is ModelInfo => !model.synthetic);
  await sdk.settings.update({ ...settings.values, winddown: { enabled: true, modelId, allowHosted: true, outputTokens: 32, timeoutMs: 15000 },
    budgets: { ...settings.values.budgets, rates: models.map((model) => ({ modelId: model.id, source: "user-estimate" as const,
      effectiveAt: new Date().toISOString().slice(0, 10), inputUsdPerMillion: 1, outputUsdPerMillion: 2 })) } }, settings.revision);
  const session = sdk.getState().snapshot!.sessions.find((session) => session.id === sessionId)!;
  await sdk.sessions.configure(sessionId, { ...session.controls, budget: { kind: "limited", tokens, ...(usd === undefined ? {} : { usd }), basis: "estimate" } });
}

test("finite automatic Single reserves its full actual role and checkpoint without labeling planned capacity a model call", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 128 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.selectModel(fixture.sessionId, KUPO_MODEL_ID);
    await finite(sdk, fixture.sessionId, fixture.modelId, 30000, 1);
    await fixture.send("Generated finite Kupo Single."); await fixture.terminal();
    assert.equal(fixture.session().status, "completed", fixture.session().lastError ?? "");
    const state = fixture.service.controller.snapshot(), role = state.routings[0]!.responseReservations![0]!;
    assert.equal(role.roles.length, 1); assert.equal(role.roles[0]?.phase, "solver");
    assert.equal(fixture.requests.length, 1);
    assert.equal(state.budgetEntries.length, 1); assert.equal(state.budgetEntries[0]?.reportedTokens, 42);
    assert.equal(state.budgetEntries[0]?.planId, role.roles[0]?.planId);
    assert.equal(state.winddowns[0]?.status, "unused");
    assert.deepEqual(state.budgetPlans.map((plan) => [plan.purpose, plan.status]), [["winddown", "released"], ["routing", "consumed"]]);
    const status = (await sdk.budgets.status(fixture.sessionId)).status;
    assert.equal(status.totals.calls, 1); assert.equal(status.totals.knownReportedTokens, 42);
    assert.equal(status.remainingTokens, 30000 - 42); assert.ok(status.remainingUsd! < 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("finite Cascade atomically holds all future escaped role contexts before its first draft and transfers only the actual roles", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await routedFixture({ configured: false, legacy: false });
  try {
    const draft = await generatedKupoProfile(fixture.sdk, fixture.solverId, { category: "economy", score: 0.4, price: 0 });
    const gate = await generatedKupoProfile(fixture.sdk, fixture.modelId, { category: "standard", score: 0.8, price: 2 });
    await fixture.sdk.routing.configure({ ...defaultKupoSettings(), modelProfiles: [draft, gate], automaticLimits: { maxEscalations: 2, maxRevisions: 1, maxResultBytes: 1024 } }, fixture.sdk.settings.get()!.revision);
    await fixture.select(); await finite(fixture.sdk, fixture.sessionId, fixture.modelId, 100000, 2);
    fixture.options.respond = (_request, index) => ({ text: index === 1 ? JSON.stringify({ pattern: "cascade", modelId: fixture.solverId,
      escalationId: fixture.modelId, complexity: "moderate", taskKind: "substantive", confidence: 1, reason: "Generated complete reservation route." }) :
      JSON.stringify({ verdict: "pass", reason: "Generated gate advice, not tool approval." }) });
    await fixture.send("Generated finite conditional Cascade."); await fixture.terminal();
    assert.equal(fixture.session().status, "completed", fixture.session().lastError ?? "");
    const state = fixture.service.controller.snapshot(), roleSet = state.routings[0]!.responseReservations![0]!;
    assert.deepEqual(roleSet.roles.map((role) => role.phase), ["draft", "gate", "escalation", "gate", "escalation", "gate"]);
    assert.equal(state.budgetEntries.length, 3); assert.equal(fixture.requests.length, 2); assert.equal(fixture.solver.requests.length, 1);
    const events = fixture.service.controller.events(0), owner = events.find((event) => event.event_type === "routing.roles_planned")!;
    const started = events.find((event) => event.event_type === "model.started" && event.payload.role === "draft")!;
    assert.ok(owner.seq < started.seq);
    assert.ok(roleSet.roles.every((role) => events.some((event) => event.event_type === "budget.plan_recorded" &&
      event.payload.plan.id === role.planId && event.payload.plan.status === "held" && event.seq < owner.seq)));
    assert.deepEqual(state.budgetPlans.filter((plan) => plan.purpose === "routing").map((plan) => plan.status),
      ["consumed", "consumed", "released", "released", "released", "released"]);
    assert.equal((await fixture.sdk.budgets.status(fixture.sessionId)).status.totals.knownReportedTokens, 126);
  } finally { await fixture.close(); }
});

test("an insufficient complete role set keeps the router charge and uses only its already held metadata checkpoint", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await routedFixture({ configured: false, legacy: false });
  try {
    const draft = await generatedKupoProfile(fixture.sdk, fixture.solverId, { category: "economy", score: 0.4, price: 0 });
    const gate = await generatedKupoProfile(fixture.sdk, fixture.modelId, { category: "standard", score: 0.8, price: 2 });
    await fixture.sdk.routing.configure({ ...defaultKupoSettings(), modelProfiles: [draft, gate], automaticLimits: { maxEscalations: 3, maxRevisions: 1, maxResultBytes: 1024 } }, fixture.sdk.settings.get()!.revision);
    await fixture.select(); await finite(fixture.sdk, fixture.sessionId, fixture.modelId, 12000);
    fixture.options.respond = (request) => ({ text: JSON.stringify(request).includes("untrustedCheckpointMetadata") ? JSON.stringify({ summary: "Generated canonical accounting checkpoint; no code acceptance or Git operation." }) :
      JSON.stringify({ pattern: "cascade", modelId: fixture.solverId, escalationId: fixture.modelId, complexity: "complex",
        taskKind: "substantive", confidence: 1, reason: "Generated full bound exceeds available capacity." }) });
    await fixture.send("Generated finite too-small Cascade set."); await fixture.terminal();
    assert.equal(fixture.session().status, "partial", fixture.session().lastError ?? ""); assert.equal(fixture.solver.requests.length, 0);
    const state = fixture.service.controller.snapshot();
    assert.equal(fixture.requests.length, 2);
    assert.deepEqual(state.budgetEntries.map((entry) => entry.role), ["router", "checkpoint"]);
    assert.equal(state.budgetPlans.some((plan) => plan.purpose === "routing"), false);
    assert.equal(state.routings[0]?.responseReservations, undefined);
    assert.equal(state.winddowns[0]?.status, "ready");
    assert.equal(state.githubOperations.length, 0);
    assert.ok((await fixture.sdk.budgets.status(fixture.sessionId)).status.remainingTokens! > 0);
  } finally { await fixture.close(); }
});

test("unknown finite draft usage cannot dispatch its paid critic or refund consumed capacity as zero", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await routedFixture({ configured: false, legacy: false });
  try {
    const draft = await generatedKupoProfile(fixture.sdk, fixture.solverId, { category: "economy", score: 0.4, price: 0 });
    const gate = await generatedKupoProfile(fixture.sdk, fixture.modelId, { category: "standard", score: 0.8, price: 2 });
    await fixture.sdk.routing.configure({ ...defaultKupoSettings(), modelProfiles: [draft, gate], automaticLimits: { maxEscalations: 1, maxRevisions: 1, maxResultBytes: 1024 } }, fixture.sdk.settings.get()!.revision);
    await fixture.select(); await finite(fixture.sdk, fixture.sessionId, fixture.modelId, 100000);
    fixture.options.respond = () => ({ text: JSON.stringify({ pattern: "cascade", modelId: fixture.solverId, escalationId: fixture.modelId,
      complexity: "moderate", taskKind: "substantive", confidence: 1, reason: "Generated unknown-accounting bound." }) });
    fixture.solverOptions.omitUsage = true;
    await fixture.send("Generated finite unreported draft."); await fixture.terminal();
    const state = fixture.service.controller.snapshot(), unknown = state.budgetEntries.find((entry) => entry.role === "draft")!;
    assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 1);
    assert.equal(unknown.status, "unknown"); assert.equal(unknown.reportedTokens, null); assert.ok(unknown.reservedTokens! > 0);
    assert.equal(state.budgetPlans.find((plan) => plan.id === unknown.planId)?.status, "consumed");
    assert.equal(state.budgetEntries.some((entry) => entry.role === "critic" || entry.role === "checkpoint"), false);
    const totals = (await fixture.sdk.budgets.status(fixture.sessionId)).status.totals;
    assert.equal(totals.unknownTokenCalls, 1); assert.ok(totals.heldTokens! > 0);
  } finally { await fixture.close(); }
});

test("a stricter profile cap between draft and gate blocks the existing hold without borrowing or repricing it", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await routedFixture({ configured: false, legacy: false });
  try {
    const draft = await generatedKupoProfile(fixture.sdk, fixture.solverId, { category: "economy", score: 0.4, price: 0 });
    const gate = await generatedKupoProfile(fixture.sdk, fixture.modelId, { category: "standard", score: 0.8, price: 2 });
    await fixture.sdk.routing.configure({ ...defaultKupoSettings(), modelProfiles: [draft, gate], automaticLimits: { maxEscalations: 1, maxRevisions: 1, maxResultBytes: 1024 } }, fixture.sdk.settings.get()!.revision);
    await fixture.select(); await finite(fixture.sdk, fixture.sessionId, fixture.modelId, 100000);
    fixture.options.respond = () => ({ text: JSON.stringify({ pattern: "cascade", modelId: fixture.solverId, escalationId: fixture.modelId,
      complexity: "moderate", taskKind: "substantive", confidence: 1, reason: "Generated later policy race." }) });
    fixture.solverOptions.respond = () => ({ text: "Generated held draft.", hold: true });
    await fixture.send("Generated current profile cap race."); await waitFor(() => fixture.solver.requests.length === 1);
    await fixture.sdk.budgets.policy({ tokens: 1, basis: "estimate" }, fixture.service.controller.snapshot().budgetPolicy.revision, true);
    await fixture.sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); await fixture.terminal();
    assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 1);
    const state = fixture.service.controller.snapshot();
    assert.ok(state.budgetEntries.find((entry) => entry.role === "draft")!.reservedTokens! > 1);
    assert.equal(state.budgetEntries.some((entry) => entry.role === "critic" || entry.role === "checkpoint"), false);
    assert.equal(state.budgetPolicy.limit?.tokens, 1);
  } finally { await fixture.close(); }
});
