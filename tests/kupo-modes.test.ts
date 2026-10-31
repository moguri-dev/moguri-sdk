import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { automaticPool } from "../apps/service/src/routing.ts";
import { defaultKupoSettings, kupoThinking, KUPO_MODEL_ID, MoguriSdk, type ModelInfo } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { routedFixture } from "./fixtures/single-routing.ts";
import { generatedKupoProfile } from "./fixtures/kupo-profiles.ts";
import { kupoThinkingMinimumOutput, qualifiedKupoThinking, validateKupoThinking } from "../apps/service/src/model-controls.ts";
import type { Model } from "@earendil-works/pi-ai";
import { GeneratedIntakeClock } from "./fixtures/intake-clock.ts";

test("mode effort selection uses only genuine supported levels and never clamps Performance to High", () => {
  const model: ModelInfo = { id: "generated-mode-model", name: "Generated mode", contextWindow: 32768, maxTokens: 512, imageInput: false, thinkingLevels: ["low", "medium", "high"], kupoThinkingLevels: ["low", "medium", "high"] };
  assert.equal(kupoThinking(model, "savings", "simple"), "low"); assert.equal(kupoThinking(model, "savings", "complex"), "high");
  assert.equal(kupoThinking(model, "balanced", "moderate"), "medium"); assert.equal(kupoThinking(model, "performance", "complex"), undefined);
  assert.equal(kupoThinking({ ...model, kupoThinkingLevels: ["high", "xhigh", "max"] }, "performance", "simple"), "xhigh");
  assert.equal(kupoThinking({ ...model, kupoThinkingLevels: ["high", "xhigh", "max"] }, "performance", "complex"), "max");
  assert.throws(() => automaticPool(defaultKupoSettings(), [{ ...model, id: "generated-frontier-name-only", environments: ["Local"] }], "Local", 0,
    { mode: "performance", profileId: "default" }), /No configured model/);
});

test("budget-based thinking cannot be labeled xhigh/max or silently lose its complete thinking budget under a small role ceiling", () => {
  const budgeted: Model<"anthropic-messages"> = { id: "generated-budgeted-api", name: "Generated budgeted reasoning",
    provider: "github-copilot", api: "anthropic-messages", baseUrl: "http://127.0.0.1:1", reasoning: true, input: ["text"],
    contextWindow: 65536, maxTokens: 32768, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { forceAdaptiveThinking: false }, thinkingLevelMap: { xhigh: "xhigh", max: "max" } };
  assert.equal(qualifiedKupoThinking(budgeted).includes("xhigh"), false);
  assert.equal(qualifiedKupoThinking(budgeted).includes("max"), false);
  assert.equal(kupoThinkingMinimumOutput(budgeted).low, 3072);
  assert.throws(() => validateKupoThinking(budgeted, "performance", "xhigh"), /qualified thinking option/);
  assert.throws(() => validateKupoThinking(budgeted, "savings", "low", 512), /qualified thinking option/);
  assert.doesNotThrow(() => validateKupoThinking(budgeted, "savings", "low", 3072));
  assert.doesNotThrow(() => validateKupoThinking({ ...budgeted, compat: { forceAdaptiveThinking: true } }, "performance", "xhigh", 512));
  const metadata: ModelInfo = { id: budgeted.id, name: budgeted.name, contextWindow: budgeted.contextWindow, maxTokens: budgeted.maxTokens,
    imageInput: false, thinkingLevels: ["low", "medium", "high", "xhigh", "max"], kupoThinkingLevels: qualifiedKupoThinking(budgeted),
    kupoThinkingMinimumOutput: kupoThinkingMinimumOutput(budgeted) };
  assert.equal(kupoThinking(metadata, "balanced", "complex", 8192), "low");
  assert.equal(kupoThinking(metadata, "savings", "moderate", 512), undefined);
});

test("new Balanced uses actual medium effort and the full qualified context without changing fixed-model preferences", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ reasoning: true, contextWindow: 32768, supportedContextWindows: [32768, 16384], responseMode: "text", maxOutputTokens: 512 });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.selectModel(fixture.sessionId, KUPO_MODEL_ID);
    assert.equal(fixture.session().controls.kupoMode, "balanced"); assert.equal(fixture.session().controls.modelOptions, undefined);
    const { modes } = await sdk.routing.modes(fixture.sessionId);
    assert.deepEqual(modes.map((mode) => [mode.mode, mode.available]), [["balanced", true], ["savings", false], ["performance", false]]);
    await fixture.send("Generated moderate Balanced task."); await fixture.terminal();
    assert.equal(fixture.session().status, "completed"); assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.requests[0]!.reasoning_effort, "medium");
    assert.equal(fixture.session().usage[0]?.thinkingEffort, "medium"); assert.equal(fixture.session().usage[0]?.contextWindow, 32768);
    await sdk.refresh(); await sdk.sessions.selectModel(fixture.sessionId, fixture.modelId);
    assert.equal(fixture.session().controls.modelOptions, undefined);
    assert.equal(sdk.routing.history(fixture.sessionId)[0]?.mode, "balanced");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("Savings excludes reviewed frontier models and actually runs an eligible execution-host local model without erasing tokens", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await routedFixture({ configured: false, legacy: false });
  try {
    const local = await generatedKupoProfile(fixture.sdk, fixture.solverId, { category: "economy", score: 0.4, price: 0 });
    const frontier = await generatedKupoProfile(fixture.sdk, fixture.modelId, { category: "frontier", score: 0.9, price: 10 });
    await fixture.sdk.routing.configure({ ...defaultKupoSettings(), modelProfiles: [local, frontier] }, fixture.sdk.settings.get()!.revision);
    await fixture.select(); await fixture.sdk.sessions.kupoMode(fixture.sessionId, "savings");
    await fixture.send("Generated Savings local task."); await fixture.terminal();
    assert.equal(fixture.session().status, "completed"); assert.equal(fixture.requests.length, 0); assert.equal(fixture.solver.requests.length, 1);
    assert.equal(fixture.session().usage[0]?.modelId, fixture.solverId); assert.equal(fixture.session().usage[0]?.totalTokens, 42);
    assert.equal(fixture.service.controller.snapshot().budgetEntries[0]?.reportedTokens, 42);
    assert.equal(fixture.session().controls.autonomy, "Manual");
  } finally { await fixture.close(); }
});

test("Performance dispatches actual xhigh through a qualified generated transport and refuses unsupported High-only models before paid work", { skip: process.platform !== "darwin" }, async () => {
  for (const qualified of [false, true]) {
    const fixture = await setupFixture({ reasoning: true, modelId: "generated-performance-api", contextWindow: 32768, maxOutputTokens: 512, responseMode: "text",
      ...(qualified ? { thinkingLevelMap: { xhigh: "xhigh", max: "max" } } : {}) });
    const sdk = await new MoguriSdk(fixture.service.connection).ready();
    try {
      const profile = await generatedKupoProfile(sdk, fixture.modelId, { category: "frontier", score: 0.9, price: 10 });
      await sdk.routing.configure({ ...defaultKupoSettings(), modelProfiles: [profile] }, sdk.settings.get()!.revision);
      await sdk.sessions.selectModel(fixture.sessionId, KUPO_MODEL_ID);
      if (!qualified) {
        await assert.rejects(() => sdk.sessions.kupoMode(fixture.sessionId, "performance"), /No configured model/);
        assert.equal(fixture.requests.length, 0); assert.equal(fixture.session().controls.kupoMode, "balanced");
      } else {
        await sdk.sessions.kupoMode(fixture.sessionId, "performance"); await fixture.send("Generated Performance substantive task."); await fixture.terminal();
        assert.equal(fixture.session().status, "completed"); assert.equal(fixture.requests[0]!.reasoning_effort, "xhigh");
        assert.equal(fixture.session().usage[0]?.thinkingEffort, "xhigh"); assert.equal(fixture.session().usage[0]?.contextWindow, 32768);
      }
    } finally { sdk.disconnect(); await fixture.close(); }
  }
});

test("modern Cascade repeats only within configured bounds and gates the final original response before tools", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await routedFixture({ configured: false, legacy: false });
  try {
    const draft = await generatedKupoProfile(fixture.sdk, fixture.solverId, { category: "economy", score: 0.3, price: 0 });
    const escalation = await generatedKupoProfile(fixture.sdk, fixture.modelId, { category: "frontier", score: 0.8, price: 5 });
    await fixture.sdk.routing.configure({ ...defaultKupoSettings(), modelProfiles: [draft, escalation], automaticLimits: { maxEscalations: 2, maxRevisions: 1, maxResultBytes: 1024 } }, fixture.sdk.settings.get()!.revision);
    fixture.options.respond = (_request, index) => ({ text: index === 1 ? JSON.stringify({ pattern: "cascade", modelId: fixture.solverId, escalationId: fixture.modelId,
      taskKind: "substantive", complexity: "complex", confidence: 0.9, reason: "Generated reviewed route." }) : [2, 4].includes(index) ?
      JSON.stringify({ verdict: "escalate", reason: "Generated bounded escalation advice." }) : index === 6 ?
        JSON.stringify({ verdict: "pass", reason: "Generated final gate advice, not acceptance." }) : `Generated escalation ${index}.` });
    fixture.solverOptions.toolCall = { name: "write_file", args: { path: "generated-unselected-mode.txt", text: "Generated unselected mode bytes.", expectedDigest: "absent" } };
    await fixture.select(); await fixture.send("Generated bounded repeated Cascade."); await fixture.terminal();
    assert.equal(fixture.session().status, "completed", fixture.session().lastError ?? "");
    assert.deepEqual(fixture.session().usage.map((usage) => usage.role), ["router", "draft", "critic", "escalation", "critic", "escalation", "critic"]);
    assert.equal(fixture.requests.length, 6); assert.equal(fixture.solver.requests.length, 1);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
    assert.ok(fixture.session().messages.some((message) => message.role === "assistant" && message.text === "Generated escalation 5."));
    await assert.rejects(() => access(join(fixture.project, "generated-unselected-mode.txt")), { code: "ENOENT" });
    assert.equal(fixture.service.controller.snapshot().budgetEntries.length, 7);
  } finally { await fixture.close(); }
});

test("modern Critique repeats same-model revisions with independent same-cost-class reviews and an exact final selection", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await routedFixture({ configured: false, legacy: false });
  try {
    const draft = await generatedKupoProfile(fixture.sdk, fixture.solverId, { category: "economy", score: 0.5, price: 0 });
    const critic = await generatedKupoProfile(fixture.sdk, fixture.modelId, { category: "standard", score: 0.5, price: 0 });
    const { review } = await fixture.sdk.compound.lineageDraft({ draftModelId: fixture.solverId, criticModelId: fixture.modelId,
      draftLineage: "generated-mode-alpha", criticLineage: "generated-mode-beta", sourceKind: "reviewed-training-report",
      sourceUrl: "https://generated-evidence.invalid/mode-lineage", sourceText: "Generated independent-lineage mechanics, not actual training evidence.",
      validUntil: new Date(Date.now() + 3600000).toISOString(), limitations: "Generated fixture; no real independence or quality claim." });
    await fixture.sdk.routing.configure({ ...defaultKupoSettings(), modelProfiles: [draft, critic], lineageReviews: [review],
      automaticLimits: { maxEscalations: 1, maxRevisions: 2, maxResultBytes: 1024 } }, fixture.sdk.settings.get()!.revision);
    fixture.options.respond = (_request, index) => ({ text: index === 1 ? JSON.stringify({ pattern: "critique", modelId: fixture.solverId, criticId: fixture.modelId,
      complexity: "complex", taskKind: "substantive", confidence: 0.9, reason: "GENERATED_ROUTER_NOT_SOLVER_CONTEXT" }) :
      JSON.stringify({ verdict: index < 4 ? "revise" : "pass", reason: "GENERATED_UNTRUSTED_MODE_CRITIQUE" }) });
    fixture.solverOptions.respond = (_request, index) => ({ text: `Generated drafting model version ${index}.` });
    await fixture.select(); await fixture.send("Generated repeated Critique task."); await fixture.terminal();
    assert.equal(fixture.session().status, "completed", fixture.session().lastError ?? "");
    assert.deepEqual(fixture.session().usage.map((usage) => usage.role), ["router", "draft", "critic", "revision", "critic", "revision", "critic"]);
    assert.equal(fixture.solver.requests.length, 3); assert.equal(fixture.requests.length, 4);
    assert.equal(JSON.stringify(fixture.solver.requests).includes("GENERATED_ROUTER_NOT_SOLVER_CONTEXT"), false);
    assert.ok(fixture.session().messages.some((message) => message.role === "assistant" && message.text === "Generated drafting model version 3."));
    assert.equal(fixture.session().messages.filter((message) => message.role === "assistant").length, 1);
  } finally { await fixture.close(); }
});

test("Savings and original-request recovery execute through the pinned owned SSH worker, never a Local model or controller checkout", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const clock = new GeneratedIntakeClock(), fixture = await routedFixture({ env: "Remote", configured: false, legacy: false, platform: { intakeClock: clock } });
  try {
    const local = await generatedKupoProfile(fixture.sdk, fixture.solverId, { category: "economy", score: 0.4, price: 0 });
    await fixture.sdk.routing.configure({ ...defaultKupoSettings(), approvedModelIds: [fixture.solverId], modelProfiles: [local] }, fixture.sdk.settings.get()!.revision);
    await fixture.select(); await fixture.sdk.sessions.kupoMode(fixture.sessionId, "savings");
    fixture.solverOptions.httpFailure = { status: 408, message: "Generated owned SSH model failure.", remaining: 1 };
    await fixture.send("Generated Savings work at its actual SSH boundary."); await fixture.terminal();
    await waitFor(() => fixture.service.controller.snapshot().executions.every((execution) => execution.cleanup === "owned-worker-stopped"));
    assert.equal(fixture.session().status, "failed"); assert.equal(fixture.solver.requests.length, 1); assert.equal(fixture.requests.length, 0);
    clock.advanceBy(30000);
    await waitFor(() => fixture.solver.requests.length === 2 && fixture.session().status === "completed" && !fixture.session().turnId);
    const state = fixture.service.controller.snapshot();
    assert.equal(fixture.session().controls.env, "Remote"); assert.equal(fixture.session().controls.kupoMode, "savings");
    assert.ok(fixture.session().usage.every((usage) => usage.modelId === fixture.solverId && usage.contextWindow === 16384));
    assert.equal(state.modelFailures[0]?.status, "recovered"); assert.equal(state.modelRecoveryCycle?.generation, 1);
    assert.deepEqual(fixture.solver.requests[0]!.messages, fixture.solver.requests[1]!.messages);
    assert.equal(fixture.requests.length, 0); assert.equal(state.executions.length, 2);
    assert.ok(state.executions.every((execution) => execution.workspace === fixture.workspace && execution.workerDigest === fixture.service.controller.remote.readiness.workerDigest));
    assert.deepEqual(state.executions[0]?.target, state.executions[1]?.target);
    assert.deepEqual(state.budgetEntries.map((entry) => [entry.env, entry.status]), [["Remote", "unknown"], ["Remote", "settled"]]);
    assert.equal(state.sessions[0]?.messages.filter((message) => message.role === "user").length, 1);
  } finally { await fixture.close(); }
});
