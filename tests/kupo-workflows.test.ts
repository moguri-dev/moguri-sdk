import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { automaticPlan, automaticPool } from "../apps/service/src/routing.ts";
import { validateKupoWorkflows, type KupoConstraints } from "../apps/service/src/kupo-policy.ts";
import { remainingKupoRoles } from "../apps/service/src/kupo-reservations.ts";
import { referencePriceCatalogs } from "../apps/service/src/provider-pricing.ts";
import { defaultKupoSettings, defaultKupoWorkflows, kupoWorkflowAllowed, projectEvents, type AutomaticKupoSettings, type KupoMode, type KupoWorkflowSettings, type ModelInfo, type RoutingTurn, type StoredEvent } from "../packages/sdk/src/index.ts";
import { routedFixture } from "./fixtures/single-routing.ts";

const all = ["low", "medium", "high", "xhigh", "max"] as const;
const hosted = (id: string, providerId: string, extra: Partial<ModelInfo> = {}): ModelInfo => ({ id, name: `Generated ${id}`, providerId, apiModelId: id, source: "hosted",
  endpointBoundary: "network", contextWindow: 65536, maxTokens: 4096, imageInput: false, environments: ["Local"], thinkingLevels: [...all], kupoThinkingLevels: [...all], ...extra });
const local = hosted("generated-local-model", "local.generated", { name: "Generated local", source: "local", endpointBoundary: "loopback", apiModelId: "generated-local-api", thinkingLevels: [], kupoThinkingLevels: [] });
const nano = hosted("gpt-5-nano", "hosted.openai"), sonnet = hosted("claude-sonnet-4.6", "hosted.anthropic"), astra = hosted("gpt-6-astra", "hosted.openai");
const opus = hosted("claude-opus-4.6", "hosted.anthropic"), unpriced = hosted("generated-unpriced-model", "hosted.generated");
const models = [local, nano, sonnet, astra, opus, unpriced];
const settings = (workflows?: Partial<KupoWorkflowSettings>, extra: Partial<AutomaticKupoSettings> = {}): AutomaticKupoSettings =>
  ({ ...defaultKupoSettings(), ...extra, ...(workflows ? { workflows: { ...defaultKupoWorkflows(), ...workflows } } : {}) });
const constraints = (mode: KupoMode, extra: KupoConstraints = {}): KupoConstraints => ({ mode, profileId: "default", priceCatalogs: referencePriceCatalogs(), ...extra });
const pool = (mode: KupoMode, policy = settings(), extra: KupoConstraints = {}, pool = models) => automaticPool(policy, pool, "Local", 0, constraints(mode, extra));
const pairs = (entries: Array<{ modelId: string; escalationId?: string; criticId?: string }>) => entries.map((pair) => `${pair.modelId}>${pair.escalationId ?? pair.criticId}`);
const turn = (mode: KupoMode, policy = settings(), extra: KupoConstraints = {}, pool_ = models): RoutingTurn => {
  const result = pool(mode, policy, extra, pool_);
  return { mode, policy, candidateModelIds: result.candidates.map((model) => model.id), modelSnapshots: result.candidates, capabilities: result.capabilities,
    cascadePairs: result.cascadePairs, critiquePairs: result.critiquePairs, council: result.council, longTask: result.longTask } as unknown as RoutingTurn;
};
const plan = (routing: RoutingTurn, value: Record<string, unknown>) => automaticPlan({ complexity: "moderate", taskKind: "substantive", confidence: 0.9, reason: "Generated route.", ...value }, routing);

test("Cascade pairs a strictly cheaper class with a pricier one without reviewed profiles, honoring overrides, exclusions and the switch", () => {
  const balanced = pool("balanced");
  assert.deepEqual(balanced.capabilities.map((capability) => [capability.modelId, capability.cascadeClass, capability.lab]), [
    ["generated-local-model", "economy", "local"], ["gpt-5-nano", "economy", "openai"], ["claude-sonnet-4.6", "standard", "anthropic"],
    ["gpt-6-astra", "frontier", "openai"], ["claude-opus-4.6", "frontier", "anthropic"], ["generated-unpriced-model", null, "unknown"]]);
  assert.deepEqual(pairs(balanced.cascadePairs), ["generated-local-model>claude-sonnet-4.6", "generated-local-model>gpt-6-astra", "generated-local-model>claude-opus-4.6",
    "gpt-5-nano>claude-sonnet-4.6", "gpt-5-nano>gpt-6-astra", "gpt-5-nano>claude-opus-4.6", "claude-sonnet-4.6>gpt-6-astra", "claude-sonnet-4.6>claude-opus-4.6"]);
  const overridden = pool("balanced", settings({ cascade: { enabled: true, classes: { "claude-sonnet-4.6": "excluded", "generated-unpriced-model": "standard", "gpt-5-nano": "frontier" } } }));
  assert.deepEqual(pairs(overridden.cascadePairs), ["generated-local-model>gpt-5-nano", "generated-local-model>gpt-6-astra", "generated-local-model>claude-opus-4.6",
    "generated-local-model>generated-unpriced-model", "generated-unpriced-model>gpt-5-nano", "generated-unpriced-model>gpt-6-astra", "generated-unpriced-model>claude-opus-4.6"]);
  assert.deepEqual(pool("balanced", settings({ cascade: { enabled: false } })).cascadePairs, []);
  assert.deepEqual(pairs(pool("savings").cascadePairs), ["generated-local-model>claude-sonnet-4.6", "gpt-5-nano>claude-sonnet-4.6"], "Savings never escalates to frontier");
  assert.deepEqual(pool("performance").cascadePairs, [], "Performance does not run Cascade");
  const routing = turn("balanced");
  assert.equal(plan(routing, { pattern: "cascade", modelId: "gpt-5-nano", escalationId: "gpt-6-astra" }).pattern, "cascade");
  assert.throws(() => plan(routing, { pattern: "cascade", modelId: "gpt-6-astra", escalationId: "gpt-5-nano" }), /strictly cheaper class/);
  assert.throws(() => plan(routing, { pattern: "cascade", modelId: "gpt-6-astra", escalationId: "claude-opus-4.6" }), /strictly cheaper class/, "same class never cascades");
});

test("Critique pairs a critic from a different known lab, narrowed by lab pairs, and never an unknown lab or the same binding", () => {
  const balanced = pool("balanced");
  assert.deepEqual(pairs(balanced.critiquePairs), ["generated-local-model>gpt-5-nano", "generated-local-model>claude-sonnet-4.6", "generated-local-model>gpt-6-astra",
    "generated-local-model>claude-opus-4.6", "gpt-5-nano>generated-local-model", "gpt-5-nano>claude-sonnet-4.6", "gpt-5-nano>claude-opus-4.6",
    "claude-sonnet-4.6>generated-local-model", "claude-sonnet-4.6>gpt-5-nano", "claude-sonnet-4.6>gpt-6-astra", "gpt-6-astra>generated-local-model",
    "gpt-6-astra>claude-sonnet-4.6", "gpt-6-astra>claude-opus-4.6", "claude-opus-4.6>generated-local-model", "claude-opus-4.6>gpt-5-nano", "claude-opus-4.6>gpt-6-astra"]);
  assert.deepEqual(balanced.critiquePairs[0], { modelId: "generated-local-model", criticId: "gpt-5-nano", reviewId: null, labs: ["local", "openai"] });
  const narrowed = pool("balanced", settings({ critique: { enabled: true, labPairs: [["openai", "anthropic"]] } }));
  assert.ok(narrowed.critiquePairs.length && narrowed.critiquePairs.every((pair) => new Set(pair.labs).size === 2 && pair.labs!.every((lab) => ["openai", "anthropic"].includes(lab))));
  assert.deepEqual(pool("balanced", settings({ critique: { enabled: false, labPairs: [] } })).critiquePairs, []);
  assert.deepEqual(pool("savings").critiquePairs, [], "Savings does not run Critique");
  const aliases = pool("balanced", settings(), {}, [nano, { ...nano, id: "generated-alias-of-nano", name: "Claude alias" }]);
  assert.deepEqual(aliases.critiquePairs, [], "two IDs for one provider binding are not independent");
  const routing = turn("balanced");
  assert.equal(plan(routing, { pattern: "critique", modelId: "gpt-5-nano", criticId: "claude-sonnet-4.6" }).pattern, "critique");
  assert.throws(() => plan(routing, { pattern: "critique", modelId: "gpt-5-nano", criticId: "gpt-6-astra" }), /different known AI lab/);
  assert.throws(() => plan(routing, { pattern: "critique", modelId: "gpt-5-nano", criticId: "generated-unpriced-model" }), /different known AI lab/);
  assert.throws(() => plan(turn("balanced", settings({ critique: { enabled: false, labPairs: [] } })), { pattern: "critique", modelId: "gpt-5-nano", criticId: "claude-sonnet-4.6" }), /switched off/);
});

test("Council needs one drafter and size - 1 reviewers from as many distinct known labs, within any chosen labs", () => {
  const council = pool("balanced").council!;
  assert.equal(council.size, 3);
  assert.deepEqual(council.members.map((member) => [member.modelId, member.labId]), [["generated-local-model", "local"], ["gpt-5-nano", "openai"],
    ["claude-sonnet-4.6", "anthropic"], ["gpt-6-astra", "openai"], ["claude-opus-4.6", "anthropic"]]);
  assert.equal(pool("balanced", settings({ council: { enabled: true, labs: [], size: 4 } })).council, null, "only three known labs are available");
  assert.equal(pool("balanced", settings({ council: { enabled: true, labs: ["openai", "anthropic"], size: 3 } })).council, null);
  assert.equal(pool("balanced", settings({ council: { enabled: false, labs: [], size: 3 } })).council, null);
  assert.equal(pool("savings").council, null, "Savings does not run Council");
  const routing = turn("balanced");
  const accepted = plan(routing, { pattern: "council", modelId: "generated-local-model", councilIds: ["gpt-5-nano", "claude-sonnet-4.6"] });
  assert.deepEqual(accepted.pattern === "council" ? accepted.councilIds : null, ["gpt-5-nano", "claude-sonnet-4.6"]);
  assert.deepEqual(Object.keys(accepted.efforts ?? {}), ["generated-local-model", "gpt-5-nano", "claude-sonnet-4.6"]);
  assert.throws(() => plan(routing, { pattern: "council", modelId: "generated-local-model", councilIds: ["gpt-5-nano", "gpt-6-astra"] }), /different known AI lab/);
  assert.throws(() => plan(routing, { pattern: "council", modelId: "generated-local-model", councilIds: ["gpt-5-nano", "generated-unpriced-model"] }), /different known AI lab/);
  assert.throws(() => plan(routing, { pattern: "council", modelId: "generated-local-model", councilIds: ["gpt-5-nano"] }), /invalid or below-threshold/);
  assert.throws(() => plan({ ...routing, mode: undefined } as RoutingTurn, { pattern: "council", modelId: "generated-local-model", councilIds: ["gpt-5-nano", "claude-sonnet-4.6"] }), /needs a selected Kupo mode/);
  assert.deepEqual(remainingKupoRoles(accepted, "draft", {}), [{ phase: "draft", modelId: "generated-local-model" }, { phase: "critic", modelId: "gpt-5-nano" },
    { phase: "critic", modelId: "claude-sonnet-4.6" }, { phase: "revision", modelId: "generated-local-model" }, { phase: "critic", modelId: "gpt-5-nano" }, { phase: "critic", modelId: "claude-sonnet-4.6" }]);
  assert.deepEqual(remainingKupoRoles(accepted, "critic", { member: 1, revisions: 1 }), [{ phase: "critic", modelId: "claude-sonnet-4.6" }]);
  assert.throws(() => remainingKupoRoles(accepted, "critic", { member: 2 }), /outside its captured plan/);
});

test("preferences gate workflows: Savings runs Single and Cascade, Performance Single, Critique and Council, and Dynamic falls back to Balanced", () => {
  assert.deepEqual((["savings", "balanced", "performance"] as const).map((mode) => ["single", "cascade", "critique", "council"].filter((workflow) =>
    kupoWorkflowAllowed(mode, workflow as "single", undefined))), [["single", "cascade"], ["single", "cascade", "critique", "council"], ["single", "critique", "council"]]);
  assert.equal(kupoWorkflowAllowed("balanced", "council", { ...defaultKupoWorkflows(), council: { enabled: false, labs: [], size: 3 } }), false);
  const performance = turn("performance");
  assert.equal(plan(performance, { pattern: "critique", modelId: "gpt-6-astra", criticId: "claude-opus-4.6" }).pattern, "critique");
  assert.throws(() => plan(performance, { pattern: "critique", modelId: "claude-sonnet-4.6", criticId: "gpt-6-astra" }), /non-frontier/);
  const dynamic = turn("dynamic"), mode = (value: Record<string, unknown>) => { const result = plan(dynamic, value); return result.mode; };
  assert.equal(mode({ pattern: "critique", modelId: "gpt-6-astra", criticId: "claude-opus-4.6", complexity: "complex" }), "performance");
  assert.equal(mode({ pattern: "cascade", modelId: "generated-local-model", escalationId: "claude-sonnet-4.6", complexity: "simple", taskKind: "summary" }), "savings");
  assert.equal(mode({ pattern: "critique", modelId: "generated-local-model", criticId: "gpt-5-nano", complexity: "simple" }), "balanced", "Savings never runs Critique");
  assert.equal(mode({ pattern: "cascade", modelId: "gpt-5-nano", escalationId: "gpt-6-astra", complexity: "complex" }), "balanced", "Performance never runs Cascade");
  assert.equal(mode({ pattern: "council", modelId: "gpt-6-astra", councilIds: ["claude-opus-4.6", "generated-local-model"], complexity: "complex" }), "balanced", "a non-frontier member keeps Balanced");
});

test("Balanced avoids frontier drafts and solvers for long requests while a non-frontier model is eligible", () => {
  const long = { solverInputBound: 40_000 }, routing = turn("balanced", settings(), long);
  assert.equal(routing.longTask, true); assert.equal(turn("balanced").longTask, false);
  assert.throws(() => plan(routing, { pattern: "single", modelId: "gpt-6-astra" }), /avoids frontier models/);
  assert.throws(() => plan(routing, { pattern: "critique", modelId: "claude-opus-4.6", criticId: "gpt-6-astra" }), /avoids frontier models/);
  assert.equal(plan(routing, { pattern: "single", modelId: "claude-sonnet-4.6" }).pattern, "single");
  assert.equal(plan(routing, { pattern: "cascade", modelId: "gpt-5-nano", escalationId: "gpt-6-astra" }).pattern, "cascade", "escalation stays available");
  assert.equal(plan(turn("balanced", settings(), long, [astra, opus]), { pattern: "single", modelId: "gpt-6-astra" }).pattern, "single", "only frontier models remain");
  const dynamic = turn("dynamic", settings(), long);
  assert.equal(plan(dynamic, { pattern: "single", modelId: "gpt-6-astra", complexity: "complex" }).mode, "performance");
  assert.throws(() => plan(dynamic, { pattern: "single", modelId: "gpt-6-astra", complexity: "moderate" }), /avoids frontier models/);
});

test("provider-declared prices class models, Performance admits High-only frontier models for Single and workflow settings are validated", () => {
  const routed: ModelInfo = hosted("openrouter/generated-declared-model", "hosted.openrouter", { name: "Generated declared" });
  const declared = (output: number) => ({ declaredPrices: { [routed.id]: { inputUsdPerMillion: 1, outputUsdPerMillion: output, basis: "provider-declared" as const } } });
  assert.deepEqual(pool("balanced", settings(), declared(30), [routed]).capabilities[0]?.modelClass, { category: "frontier", basis: "provider-declared",
    inputUsdPerMillion: 1, outputUsdPerMillion: 30, sourceUrl: null });
  assert.equal(pool("savings", settings(), declared(2), [routed]).capabilities[0]?.modelClass?.category, "economy");
  const budgeted = { ...opus, maxTokens: 32000, kupoThinkingLevels: ["low", "medium", "high"] as ModelInfo["kupoThinkingLevels"], kupoThinkingMinimumOutput: { low: 3072, medium: 9216, high: 17408 } };
  const performance = pool("performance", settings(), {}, [budgeted, astra]);
  assert.deepEqual(performance.capabilities.map((capability) => [capability.modelId, capability.efforts]), [["claude-opus-4.6", ["high"]], ["gpt-6-astra", ["high", "xhigh"]]]);
  assert.deepEqual(performance.critiquePairs, [], "High's thinking budget cannot fit the bounded draft and review roles");
  const dynamic = turn("dynamic", settings(), {}, [budgeted, astra]);
  const single = plan(dynamic, { pattern: "single", modelId: "claude-opus-4.6", complexity: "complex" });
  assert.deepEqual([single.mode, single.efforts?.["claude-opus-4.6"]], ["performance", "high"]);
  assert.equal(plan(dynamic, { pattern: "critique", modelId: "claude-opus-4.6", criticId: "gpt-6-astra", complexity: "complex" }).mode, "balanced",
    "Dynamic keeps Balanced when a role cannot reach Performance's effort within its output bound");
  assert.throws(() => validateKupoWorkflows(settings({ critique: { enabled: true, labPairs: [["openai", "openai"]] } })), /two different known AI labs/);
  assert.throws(() => validateKupoWorkflows(settings({ critique: { enabled: true, labPairs: [["openai", "anthropic"], ["anthropic", "openai"]] } })), /duplicate/);
  assert.throws(() => validateKupoWorkflows(settings({ critique: { enabled: true, labPairs: [["openai", "unknown"]] } })), /known AI labs/);
  assert.throws(() => validateKupoWorkflows(settings({ council: { enabled: true, labs: ["generated-lab"], size: 3 } })), /known AI labs/);
  assert.deepEqual(validateKupoWorkflows(defaultKupoSettings()), defaultKupoWorkflows());
});

const limits = { automaticLimits: { maxEscalations: 1, maxRevisions: 1, maxResultBytes: 1024 } };

test("cross-lab Critique runs with no reviewed lineage or profile, revises with the critique and selects only the reviewed revision", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await routedFixture({ configured: false, legacy: false });
  try {
    await assert.rejects(() => fixture.sdk.routing.configure({ ...defaultKupoSettings(), workflows: { ...defaultKupoWorkflows(), critique: { enabled: true, labPairs: [["google", "google"]] } } },
      fixture.sdk.settings.get()!.revision), /two different known AI labs/);
    await fixture.sdk.routing.configure({ ...defaultKupoSettings(), ...limits }, fixture.sdk.settings.get()!.revision);
    fixture.options.respond = (_request, index) => ({ text: index === 1 ? JSON.stringify({ pattern: "critique", modelId: fixture.solverId, criticId: fixture.modelId,
      complexity: "moderate", taskKind: "substantive", confidence: 0.9, reason: "Generated cross-lab route." }) :
      JSON.stringify({ verdict: index === 2 ? "revise" : "pass", reason: "GENERATED_CROSS_LAB_CRITIQUE" }) });
    fixture.solverOptions.respond = (_request, index) => ({ text: `Generated cross-lab draft ${index}.` });
    await fixture.select();
    const { modes } = await fixture.sdk.routing.modes(fixture.sessionId), workflows = (mode: string) => modes.find((entry) => entry.mode === mode)!.workflows!;
    assert.match(modes.find((entry) => entry.mode === "balanced")!.reason, /runs Single, Critique;/);
    assert.deepEqual(workflows("balanced").map((workflow) => [workflow.id, workflow.available]), [["single", true], ["cascade", false], ["critique", true], ["council", false]]);
    assert.deepEqual(workflows("balanced").find((workflow) => workflow.id === "critique")!.pairs, [[fixture.modelId, fixture.solverId], [fixture.solverId, fixture.modelId]]);
    assert.equal(workflows("savings").find((workflow) => workflow.id === "critique")!.reason, "Savings does not use Critique.");
    await fixture.send("Generated cross-lab Critique task."); await fixture.terminal();
    assert.equal(fixture.session().status, "completed", fixture.session().lastError ?? "");
    assert.deepEqual(fixture.session().usage.map((usage) => usage.role), ["router", "draft", "critic", "revision", "critic"]);
    const routing = fixture.sdk.routing.history(fixture.sessionId).at(-1)!;
    assert.equal(routing.mode, "balanced");
    assert.deepEqual(routing.critiquePairs?.find((pair) => pair.modelId === fixture.solverId && pair.criticId === fixture.modelId), {
      modelId: fixture.solverId, criticId: fixture.modelId, reviewId: null, labs: ["local", "google"] });
    assert.match(JSON.stringify(fixture.solver.requests[1]), /GENERATED_CROSS_LAB_CRITIQUE/);
    assert.deepEqual(fixture.session().messages.filter((message) => message.role === "assistant").map((message) => message.text), ["Generated cross-lab draft 2."]);
  } finally { await fixture.close(); }
});

test("class Cascade drafts with a local economy model and gates one escalation to a published-price frontier model", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await routedFixture({ configured: false, legacy: false, modelId: "gpt-6-astra" });
  try {
    await fixture.sdk.routing.configure({ ...defaultKupoSettings(), ...limits }, fixture.sdk.settings.get()!.revision);
    fixture.options.respond = (_request, index) => ({ text: index === 1 ? JSON.stringify({ pattern: "cascade", modelId: fixture.solverId, escalationId: fixture.modelId,
      complexity: "moderate", taskKind: "substantive", confidence: 0.9, reason: "Generated class route." }) : index === 2 ?
      JSON.stringify({ verdict: "escalate", reason: "Generated escalation advice." }) : index === 3 ? "Generated frontier escalation." :
        JSON.stringify({ verdict: "pass", reason: "Generated gate advice, not acceptance." }) });
    fixture.solverOptions.respond = () => ({ text: "Generated economy draft.", tool: { name: "write_file", args: { path: "generated-unselected-cascade.txt", text: "Generated bytes.", expectedDigest: "absent" } } });
    await fixture.select(); await fixture.send("Generated class Cascade task."); await fixture.terminal();
    assert.equal(fixture.session().status, "completed", fixture.session().lastError ?? "");
    assert.deepEqual(fixture.session().usage.map((usage) => usage.role), ["router", "draft", "critic", "escalation", "critic"]);
    const routing = fixture.sdk.routing.history(fixture.sessionId).at(-1)!;
    assert.deepEqual(routing.capabilities?.map((capability) => [capability.modelId, capability.cascadeClass, capability.modelClass?.basis]).sort(), [
      [fixture.modelId, "frontier", "published-price"], [fixture.solverId, "economy", "local-no-api-fee"]].sort());
    assert.ok(routing.cascadePairs?.some((pair) => pair.modelId === fixture.solverId && pair.escalationId === fixture.modelId));
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
    await assert.rejects(() => access(join(fixture.project, "generated-unselected-cascade.txt")), { code: "ENOENT" });
    assert.deepEqual(fixture.session().messages.filter((message) => message.role === "assistant").map((message) => message.text), ["Generated frontier escalation."]);
  } finally { await fixture.close(); }
});

const councilPlan = (fixture: Awaited<ReturnType<typeof routedFixture>>) => JSON.stringify({ pattern: "council", modelId: fixture.solverId, councilIds: [fixture.modelId, fixture.thirdId],
  complexity: "complex", taskKind: "substantive", confidence: 0.9, reason: "Generated council route." });

test("Council reviews one draft with every lab, revises with all critiques after a minority rejection and selects only an all-pass revision", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await routedFixture({ configured: false, legacy: false, thirdModelId: "generated-qwen-council-api" });
  try {
    await fixture.sdk.routing.configure({ ...defaultKupoSettings(), ...limits }, fixture.sdk.settings.get()!.revision);
    fixture.options.respond = (_request, index) => ({ text: index === 1 ? councilPlan(fixture) :
      JSON.stringify({ verdict: index === 2 ? "reject" : "pass", reason: "GENERATED_GOOGLE_CRITIQUE" }) });
    fixture.thirdOptions!.respond = (_request, index) => ({ text: JSON.stringify({ verdict: index === 1 ? "revise" : "pass", reason: "GENERATED_QWEN_CRITIQUE" }) });
    fixture.solverOptions.respond = (_request, index) => index === 1 ?
      { text: "Generated council draft 1.", tool: { name: "write_file", args: { path: "generated-unselected-council.txt", text: "Generated bytes.", expectedDigest: "absent" } } } :
      { text: "Generated council revision 2." };
    await fixture.select(); await fixture.send("Generated Council task."); await fixture.terminal();
    assert.equal(fixture.session().status, "completed", fixture.session().lastError ?? "");
    assert.deepEqual(fixture.session().usage.map((usage) => [usage.role, usage.modelId]), [["router", fixture.modelId], ["draft", fixture.solverId],
      ["critic", fixture.modelId], ["critic", fixture.thirdId], ["revision", fixture.solverId], ["critic", fixture.modelId], ["critic", fixture.thirdId]]);
    const routing = fixture.sdk.routing.history(fixture.sessionId).at(-1)!;
    assert.deepEqual(new Set(routing.council?.members.map((member) => member.labId)), new Set(["google", "local", "qwen"]));
    const revision = JSON.stringify(fixture.solver.requests[1]);
    assert.match(revision, /untrustedCritiques/); assert.match(revision, /GENERATED_GOOGLE_CRITIQUE/); assert.match(revision, /GENERATED_QWEN_CRITIQUE/);
    const selected = fixture.service.controller.events(0).filter((event): event is Extract<StoredEvent, { event_type: "routing.response_selected" }> => event.event_type === "routing.response_selected");
    assert.equal(selected.length, 1); assert.equal(selected[0]!.payload.reviewStepIds?.length, 2);
    assert.equal(selected[0]!.payload.reviewStepId, selected[0]!.payload.reviewStepIds!.at(-1));
    const events = fixture.service.controller.events(0), index = events.findIndex((event) => event.event_type === "routing.response_selected");
    assert.doesNotThrow(() => projectEvents(events));
    const ids = selected[0]!.payload.reviewStepIds!, round = fixture.session().usage.filter((usage) => usage.role === "critic").map((usage) => usage.stepId);
    for (const reviewStepIds of [undefined, ids.slice(1), [...ids].reverse(), [round[0]!, ids[1]!]]) {
      const changed = structuredClone(events), payload = changed[index]!.payload as { reviewStepIds?: string[] };
      if (reviewStepIds) payload.reviewStepIds = reviewStepIds; else delete payload.reviewStepIds;
      assert.throws(() => projectEvents(changed), /selected Kupo response/i, "every reviewer's original pass on this exact source is required");
    }
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
    await assert.rejects(() => access(join(fixture.project, "generated-unselected-council.txt")), { code: "ENOENT" });
    assert.deepEqual(fixture.session().messages.filter((message) => message.role === "assistant").map((message) => message.text), ["Generated council revision 2."]);
  } finally { await fixture.close(); }
});

test("a Council majority rejection stops without tools, another model or a selected response", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await routedFixture({ configured: false, legacy: false, thirdModelId: "generated-qwen-council-api" });
  try {
    await fixture.sdk.routing.configure({ ...defaultKupoSettings(), ...limits }, fixture.sdk.settings.get()!.revision);
    fixture.options.respond = (_request, index) => ({ text: index === 1 ? councilPlan(fixture) : JSON.stringify({ verdict: "reject", reason: "Generated rejection." }) });
    fixture.thirdOptions!.respond = () => ({ text: JSON.stringify({ verdict: "reject", reason: "Generated rejection." }) });
    fixture.solverOptions.respond = () => ({ text: "Generated rejected draft.", tool: { name: "write_file", args: { path: "generated-rejected-council.txt", text: "Generated bytes.", expectedDigest: "absent" } } });
    await fixture.select(); await fixture.send("Generated rejected Council task."); await fixture.terminal();
    assert.notEqual(fixture.session().status, "completed"); assert.match(fixture.session().lastError ?? "", /majority of Kupo's council rejected/);
    assert.deepEqual(fixture.session().usage.map((usage) => usage.role), ["router", "draft", "critic", "critic"]);
    assert.equal(fixture.solver.requests.length, 1);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started" || event.event_type === "routing.response_selected"), false);
    await assert.rejects(() => access(join(fixture.project, "generated-rejected-council.txt")), { code: "ENOENT" });
    assert.equal(fixture.session().messages.some((message) => message.role === "assistant"), false);
  } finally { await fixture.close(); }
});

test("a finite Council reserves every future role before the draft and releases unused holds without unknown usage", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await routedFixture({ configured: false, legacy: false, thirdModelId: "generated-qwen-council-api" });
  try {
    await fixture.sdk.routing.configure({ ...defaultKupoSettings(), ...limits }, fixture.sdk.settings.get()!.revision);
    const current = fixture.sdk.settings.get()!;
    await fixture.sdk.settings.update({ ...current.values,
      winddown: { ...current.values.winddown, enabled: true, modelId: fixture.modelId, allowHosted: true, outputTokens: 32, timeoutMs: 15000 },
      budgets: { ...current.values.budgets, rates: [fixture.modelId, fixture.solverId, fixture.thirdId!].map((modelId) => ({ modelId, source: "user-estimate" as const,
        effectiveAt: new Date().toISOString().slice(0, 10), inputUsdPerMillion: 1, outputUsdPerMillion: 2 })) } }, current.revision);
    await fixture.select();
    await fixture.sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, budget: { kind: "limited", basis: "estimate", tokens: 100000 } });
    fixture.options.respond = (_request, index) => ({ text: index === 1 ? councilPlan(fixture) : JSON.stringify({ verdict: "pass", reason: "Generated pass." }) });
    fixture.thirdOptions!.respond = () => ({ text: JSON.stringify({ verdict: "pass", reason: "Generated pass." }) });
    await fixture.send("Generated finite Council task."); await fixture.terminal();
    assert.equal(fixture.session().status, "completed", fixture.session().lastError ?? "");
    const state = fixture.service.controller.snapshot();
    assert.deepEqual(state.budgetEntries.map((entry) => entry.role), ["router", "draft", "critic", "critic"]);
    assert.ok(state.budgetEntries.every((entry) => entry.status === "settled" && entry.reportedTokens === 42));
    const reservation = state.routings[0]?.responseReservations?.[0];
    assert.deepEqual(reservation?.roles.map((role) => [role.phase, role.modelId]), [["draft", fixture.solverId], ["critic", fixture.modelId], ["critic", fixture.thirdId],
      ["revision", fixture.solverId], ["critic", fixture.modelId], ["critic", fixture.thirdId]]);
    assert.equal(state.budgetPlans.some((plan) => plan.status === "held"), false);
    assert.equal((await fixture.sdk.budgets.status(fixture.sessionId)).status.totals.unknownTokenCalls, 0);
  } finally { await fixture.close(); }
});
