import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultKupoSettings, KUPO_MODEL_ID, MoguriSdk, type ModelInfo } from "../packages/sdk/src/index.ts";
import { automaticPool, kupoAvailability } from "../apps/service/src/routing.ts";
import { reviewNativeTools, setupFixture, waitFor } from "./fixture.ts";
import { routedFixture } from "./fixtures/single-routing.ts";

test("Kupo stays in the shared catalogue without configured models or usable budget", () => {
  for (const hardBudget of [false, true]) {
    const result = kupoAvailability(defaultKupoSettings(), [], hardBudget);
    assert.equal(result.model?.id, KUPO_MODEL_ID);
    assert.equal(result.model?.name, "Kupo");
    assert.equal(result.model?.synthetic, true);
    assert.deepEqual(result.model?.environments, []);
    assert.ok(result.diagnostics.length > 0);
  }
});

test("configured pools from three through twenty models retain every exact capability profile", () => {
  for (let count = 3; count <= 20; count++) {
    const models: ModelInfo[] = Array.from({ length: count }, (_, index) => ({ id: `generated-${index}`, name: `Generated capability ${index}`,
      providerId: `generated-provider-${index}`, apiModelId: `generated-api-${index}`, source: "local", endpointBoundary: "loopback",
      contextWindow: index % 2 ? 32768 : 262144, maxTokens: 128, imageInput: index % 3 === 0,
      ...(index % 2 ? {} : { toolInput: true, thinkingLevels: ["high"] }), environments: ["Local"] }));
    const pool = automaticPool(defaultKupoSettings(), [...models, { ...models[0]!, id: KUPO_MODEL_ID, synthetic: true }], "Local");
    assert.equal(pool.candidates.length, count);
    assert.deepEqual(pool.capabilities.map((profile) => profile.modelId), models.map((model) => model.id));
    assert.deepEqual(pool.capabilities[0]?.categories, ["general", "reasoning", "tools", "vision", "long-context"]);
    assert.equal(pool.capabilities[1]?.toolInput, null);
    assert.equal(pool.critiquePairs.length, 0);
    assert.equal(automaticPool({ ...defaultKupoSettings(), approvedModelIds: models.slice(-2).map((model) => model.id) }, models, "Local").candidates.length, 2);
  }
});

test("the shared SDK exposes the service-owned capability inventory without inference", async () => {
  const fixture = await setupFixture({ maxOutputTokens: 128, contextWindow: 262144, reasoning: true, imageInput: true, toolInput: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const profiles = sdk.routing.capabilities();
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0]?.modelId, fixture.modelId);
    assert.deepEqual(profiles[0]?.categories, ["general", "reasoning", "tools", "vision", "long-context"]);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("automatic Cascade selects a gated original response without another solver or unselected tools", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await routedFixture({ configured: false });
  try {
    fixture.options.respond = (_request, index) => ({ text: JSON.stringify(index === 1 ?
      { pattern: "cascade", modelId: fixture.solverId, escalationId: fixture.modelId, complexity: "moderate", confidence: 0.95, reason: "GENERATED_ROUTER_REASON_NOT_CONTEXT" } :
      { verdict: "pass", reason: "Generated gate advice, not user approval." }) });
    await fixture.select(); await fixture.send("Generated automatic Cascade task."); await fixture.terminal(); await fixture.sdk.refresh();
    assert.equal(fixture.session().status, "completed");
    assert.deepEqual(fixture.session().usage.map((entry) => entry.role), ["router", "draft", "critic"]);
    assert.equal(fixture.requests.length, 2); assert.equal(fixture.solver.requests.length, 1);
    assert.ok(fixture.session().messages.some((message) => message.role === "assistant" && message.text === "Generated routed solver answer."));
    assert.equal(JSON.stringify(fixture.solver.requests).includes("GENERATED_ROUTER_REASON_NOT_CONTEXT"), false);
    assert.equal(fixture.sdk.routing.history(fixture.sessionId)[0]?.plan?.pattern, "cascade");
  } finally { await fixture.close(); }
});

test("selected Kupo drafts remain canonical artifact and activity sources with the actual model actor", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await routedFixture({ configured: false });
  try {
    fixture.options.respond = (_request, index) => ({ text: JSON.stringify(index === 1 ?
      { pattern: "cascade", modelId: fixture.solverId, escalationId: fixture.modelId, complexity: "moderate", confidence: 0.95, reason: "Generated source-preserving route." } :
      { verdict: "pass", reason: "Generated source-preserving review." }) });
    await fixture.select(); await fixture.send("Generated retained selected Kupo answer."); await fixture.terminal(); await fixture.sdk.refresh();
    const message = fixture.session().messages.find((message) => message.role === "assistant")!;
    const source = await fixture.sdk.artifacts.source(fixture.sessionId, "message", message.id);
    assert.equal(source.preview.text, "Generated routed solver answer.");
    assert.equal(source.preview.source.actor, "model"); assert.equal(source.preview.source.modelId, fixture.solverId);
    const activity = await fixture.sdk.activity.list(fixture.sessionId);
    assert.ok(activity.activity.entries.some((entry) => entry.source === "model" && entry.messageId === message.id));
    const promoted = await fixture.sdk.artifacts.promote(fixture.sessionId, { sourceKind: "message", sourceId: message.id, kind: "research-note",
      name: "Generated retained Kupo answer", expectedDigest: source.preview.digest });
    assert.equal((await fixture.sdk.artifacts.read(promoted.id!)).text, "Generated routed solver answer.");
  } finally { await fixture.close(); }
});

test("Cascade escalates once without executing or publishing the rejected draft's tool request", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await routedFixture({ configured: false });
  try {
    fixture.options.respond = (_request, index) => ({ text: index === 1 ? JSON.stringify({
      pattern: "cascade", modelId: fixture.solverId, escalationId: fixture.modelId, complexity: "moderate", confidence: 0.95, reason: "Generated cascade routing advice.",
    }) : index === 2 ? JSON.stringify({ verdict: "escalate", reason: "Generated draft requires a fresh model response." }) : "Generated selected escalation answer." });
    fixture.solverOptions.toolCall = { name: "write_file", args: { path: "unselected.txt", text: "Generated unselected bytes.", expectedDigest: "absent" } };
    await fixture.select(); await fixture.send("Generated escalation task."); await fixture.terminal(); await fixture.sdk.refresh();
    assert.equal(fixture.session().status, "completed");
    assert.deepEqual(fixture.session().usage.map((entry) => entry.role), ["router", "draft", "critic", "escalation"]);
    assert.equal(fixture.requests.length, 3); assert.equal(fixture.solver.requests.length, 1);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
    assert.equal(fixture.session().pendingApproval, null);
    await assert.rejects(() => access(join(fixture.project, "unselected.txt")), { code: "ENOENT" });
    assert.ok(fixture.session().messages.some((message) => message.role === "assistant" && message.text === "Generated selected escalation answer."));
    assert.equal((await fixture.sdk.budgets.status(fixture.sessionId)).status.totals.reportedTokens, 168);
  } finally { await fixture.close(); }
});

test("selected tool requests still need exact Manual approval and later cycles see only selected history", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await routedFixture({ configured: false });
  try {
    await reviewNativeTools(fixture, ["read_file"]);
    fixture.options.respond = (_request, index) => ({ text: JSON.stringify(index === 1 ?
      { pattern: "cascade", modelId: fixture.solverId, escalationId: fixture.modelId, complexity: "moderate", confidence: 0.95, reason: "GENERATED_ROUTER_REASON_NOT_CONTEXT" } :
      { verdict: "pass", reason: "GENERATED_GATE_REASON_NOT_CONTEXT" }) });
    await fixture.select(); await fixture.send("generated tool through automatic Kupo");
    const approval = await waitFor(() => fixture.session().pendingApproval);
    assert.equal(approval.call.name, "read_file");
    assert.equal(fixture.session().usage.find((entry) => entry.stepId === approval.stepId)?.role, "draft");
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
    await fixture.approve(); await fixture.terminal(); await fixture.sdk.refresh();
    assert.equal(fixture.session().status, "completed");
    assert.deepEqual(fixture.session().usage.map((entry) => entry.role), ["router", "draft", "critic", "draft", "critic"]);
    assert.equal(fixture.solver.requests.length, 2);
    assert.equal(JSON.stringify(fixture.solver.requests).includes("GENERATED_ROUTER_REASON_NOT_CONTEXT"), false);
    assert.equal(JSON.stringify(fixture.solver.requests).includes("GENERATED_GATE_REASON_NOT_CONTEXT"), false);
    assert.match(JSON.stringify(fixture.solver.requests[1]), /generated original/);
    assert.equal(fixture.sdk.routing.history(fixture.sessionId)[0]?.selectedStepIds?.length, 2);
  } finally { await fixture.close(); }
});

test("automatic Critique uses a reviewed distinct pair and one same-model revision inside the ordinary loop", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await routedFixture({ configured: false });
  try {
    const { review } = await fixture.sdk.compound.lineageDraft({ draftModelId: fixture.solverId, criticModelId: fixture.modelId,
      draftLineage: "generated-independent-alpha", criticLineage: "generated-independent-beta", sourceKind: "reviewed-training-report",
      sourceUrl: "https://generated-evidence.invalid/kupo", sourceText: "Generated fixture-only distinct training lineage assertion.",
      validUntil: new Date(Date.now() + 60_000).toISOString(), limitations: "Generated mechanical evidence, not real model independence." });
    await fixture.sdk.routing.configure({ ...defaultKupoSettings(), lineageReviews: [review] }, fixture.sdk.settings.get()!.revision);
    fixture.options.respond = (_request, index) => ({ text: JSON.stringify(index === 1 ?
      { pattern: "critique", modelId: fixture.solverId, criticId: fixture.modelId, complexity: "complex", confidence: 0.95, reason: "GENERATED_ROUTER_REASON_NOT_CONTEXT" } :
      { verdict: "revise", reason: "GENERATED_UNTRUSTED_CRITIQUE: clarify the generated answer." }) });
    fixture.solverOptions.respond = (_request, index) => ({ text: index === 1 ? "Generated original unselected draft." : "Generated selected revised answer." });
    await fixture.select(); await fixture.send("Generated complex Kupo task."); await fixture.terminal(); await fixture.sdk.refresh();
    assert.equal(fixture.session().status, "completed");
    assert.deepEqual(fixture.session().usage.map((entry) => entry.role), ["router", "draft", "critic", "revision"]);
    assert.equal(fixture.solver.requests.length, 2); assert.equal(fixture.requests.length, 2);
    assert.ok(fixture.session().messages.some((message) => message.role === "assistant" && message.text === "Generated selected revised answer."));
    assert.equal(fixture.session().messages.some((message) => message.role === "assistant" && message.text === "Generated original unselected draft."), false);
    assert.match(JSON.stringify(fixture.solver.requests[1]), /untrusted.*[Cc]ritique/);
    assert.equal(JSON.stringify(fixture.solver.requests).includes("GENERATED_ROUTER_REASON_NOT_CONTEXT"), false);
  } finally { await fixture.close(); }
});

test("default Kupo uses its only configured model in Single without a classifier request", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 128 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    assert.equal(sdk.routing.policy()?.workflow, "auto");
    await sdk.sessions.selectModel(fixture.sessionId, KUPO_MODEL_ID);
    assert.equal(fixture.requests.length, 0);
    await fixture.send("Generated sole-model Kupo task."); await fixture.terminal(); await sdk.refresh();
    assert.equal(fixture.session().status, "completed");
    assert.equal(fixture.requests.length, 1);
    assert.deepEqual(fixture.session().usage.map((entry) => [entry.role, entry.modelId]), [["solver", fixture.modelId]]);
    const route = sdk.routing.history(fixture.sessionId)[0]!;
    assert.equal(route.plan?.pattern, "single");
    assert.equal(route.plan?.modelId, fixture.modelId);
    assert.equal(route.classifierStepId, null);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("context filtering down to one eligible model still skips the classifier and preserves the full task", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await routedFixture({ configured: false });
  try {
    fixture.options.respond = (request) => ({ text: JSON.stringify(request).includes("Choose the least complex eligible Kupo workflow") ? JSON.stringify({
      pattern: "single", modelId: fixture.modelId, complexity: "simple", confidence: 0.95, reason: "Generated exact-capacity route.",
    }) : "Generated full-capacity direct answer." });
    const task = "Generated capacity. ".repeat(3000);
    await fixture.select(); await fixture.send(task); await fixture.terminal(); await fixture.sdk.refresh();
    assert.equal(fixture.session().status, "completed");
    assert.deepEqual(fixture.session().usage.map((entry) => entry.role), ["solver"]);
    assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 0);
    assert.equal(fixture.sdk.routing.history(fixture.sessionId)[0]?.classifierStepId, null);
    assert.ok(JSON.stringify(fixture.requests[0]).includes(task));
  } finally { await fixture.close(); }
});

test("losing the only configured model blocks Kupo without consuming a saved draft or substituting a provider", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.selectModel(fixture.sessionId, KUPO_MODEL_ID);
    await fixture.provider.logout(); await sdk.refresh();
    await assert.rejects(() => fixture.send("Generated preserved unavailable Kupo draft."), /No configured model/);
    assert.equal(fixture.session().draft.text, "Generated preserved unavailable Kupo draft.");
    assert.equal(fixture.requests.length, 0);
    assert.ok(sdk.getState().snapshot!.provider.models.some((model) => model.id === KUPO_MODEL_ID));
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("an Unlimited automatic Kupo session cannot lift a finite profile policy or spend its held draft", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ maxOutputTokens: 128 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.selectModel(fixture.sessionId, KUPO_MODEL_ID);
    await sdk.budgets.policy({ basis: "estimate", tokens: 50_000 }, sdk.getState().snapshot!.budgetPolicy.revision, true);
    await assert.rejects(() => fixture.send("Generated finite-policy automatic Kupo draft."), /finite reservations|hard cap/i);
    assert.equal(fixture.session().draft.text, "Generated finite-policy automatic Kupo draft.");
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.service.controller.snapshot().budgetPolicy.limit?.tokens, 50_000);
    assert.equal(fixture.service.controller.snapshot().budgetEntries.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("Kupo never dispatches a prepared API model different from its exact discovered binding", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture({ responseMode: "text", maxOutputTokens: 128 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const prepare = fixture.provider.prepare.bind(fixture.provider);
  try {
    fixture.provider.prepare = async (id, signal) => {
      const value = await prepare(id, signal);
      return { ...value, model: { ...value.model, id: "generated-unapproved-api-model" } };
    };
    await sdk.sessions.selectModel(fixture.sessionId, KUPO_MODEL_ID); await fixture.send("Generated exact prepared binding."); await fixture.terminal();
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.service.controller.snapshot().budgetEntries.length, 0);
    assert.notEqual(fixture.session().status, "completed");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("unknown draft or gate accounting blocks the next role and keeps its original capacity held", { skip: process.platform !== "darwin", timeout: 20_000 }, async (t) => {
  for (const missing of ["draft", "gate"] as const) await t.test(missing, async () => {
    const fixture = await routedFixture({ configured: false });
    try {
      fixture.options.respond = (_request, index) => {
        if (missing === "gate" && index > 1) fixture.options.omitUsage = true;
        return { text: JSON.stringify(index === 1 ?
          { pattern: "cascade", modelId: fixture.solverId, escalationId: fixture.modelId, complexity: "moderate", confidence: 0.95, reason: "Generated metering route." } :
          { verdict: "pass", reason: "Generated unmetered gate." }) };
      };
      fixture.solverOptions.omitUsage = missing === "draft";
      await fixture.select(); await fixture.send("Generated automatic unknown metering task."); await fixture.terminal(); await fixture.sdk.refresh();
      assert.equal(fixture.session().status, "partial");
      assert.equal(fixture.requests.length, missing === "draft" ? 1 : 2);
      assert.equal(fixture.solver.requests.length, 1);
      assert.equal(fixture.session().messages.some((message) => message.role === "assistant"), false);
      const held = fixture.sdk.getState().snapshot!.budgetEntries.at(-1)!;
      assert.equal(held.status, "unknown"); assert.ok(held.reservedTokens! > 0);
      assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "routing.response_selected"), false);
    } finally { await fixture.close(); }
  });
});

test("cancelling an actual gate request cannot select or execute the draft's tools", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await routedFixture({ configured: false });
  try {
    fixture.options.respond = (_request, index) => index === 1 ? { text: JSON.stringify({
      pattern: "cascade", modelId: fixture.solverId, escalationId: fixture.modelId, complexity: "moderate", confidence: 0.95, reason: "Generated cancelled route.",
    }) } : { hold: true };
    fixture.solverOptions.toolCall = { name: "write_file", args: { path: "unselected.txt", text: "Generated cancelled bytes.", expectedDigest: "absent" } };
    await fixture.select(); await fixture.send("Generated actual gate cancellation.");
    await waitFor(() => fixture.requests.length === 2);
    await fixture.sdk.command({ type: "session.stop", sessionId: fixture.sessionId });
    await fixture.terminal(); await fixture.sdk.refresh();
    assert.notEqual(fixture.session().status, "completed");
    assert.equal(fixture.solver.requests.length, 1);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started" || event.event_type === "routing.response_selected"), false);
    await assert.rejects(() => access(join(fixture.project, "unselected.txt")), { code: "ENOENT" });
    assert.equal(fixture.sdk.getState().snapshot!.budgetEntries.at(-1)?.status, "unknown");
  } finally { await fixture.close(); }
});

test("failed atomic response selection retains unknown gate ownership without publishing an answer or tools", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await routedFixture({ configured: false });
  try {
    fixture.options.respond = (_request, index) => ({ text: JSON.stringify(index === 1 ?
      { pattern: "cascade", modelId: fixture.solverId, escalationId: fixture.modelId, complexity: "moderate", confidence: 0.95, reason: "Generated failed selection route." } :
      { verdict: "pass", reason: "Generated selection must be durably acknowledged." }) });
    fixture.service.store.db.exec("CREATE TRIGGER generated_kupo_selection_failure BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.event_type')='routing.response_selected' BEGIN SELECT RAISE(ABORT,'Generated Kupo selection journal failure'); END");
    await fixture.select(); await fixture.send("Generated failed atomic Kupo selection."); await fixture.terminal(); await fixture.sdk.refresh();
    assert.notEqual(fixture.session().status, "completed");
    assert.equal(fixture.session().messages.some((message) => message.role === "assistant"), false);
    assert.equal(fixture.solver.requests.length, 1);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "routing.response_selected" || event.event_type === "tool.started"), false);
    assert.equal(fixture.sdk.getState().snapshot!.budgetEntries.at(-1)?.status, "unknown");
  } finally { await fixture.close(); }
});

test("changed routing policy during gate preparation blocks that dispatch without falling back to the now-single model", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await routedFixture({ configured: false }), gate = Promise.withResolvers<void>();
  const prepare = fixture.service.controller.provider.prepare.bind(fixture.service.controller.provider);
  let waiting = false;
  try {
    fixture.options.replyText = JSON.stringify({ pattern: "cascade", modelId: fixture.solverId, escalationId: fixture.modelId, complexity: "moderate", confidence: 0.95, reason: "Generated stale route." });
    fixture.service.controller.provider.prepare = async (id, signal) => {
      if (fixture.requests.length === 1 && fixture.solver.requests.length === 1) { waiting = true; await gate.promise; }
      return prepare(id, signal);
    };
    await fixture.select(); await fixture.send("Generated gate preparation race."); await waitFor(() => waiting);
    await fixture.sdk.routing.configure({ ...defaultKupoSettings(), approvedModelIds: [fixture.solverId] }, fixture.sdk.settings.get()!.revision);
    gate.resolve(); await fixture.terminal(); await fixture.sdk.refresh();
    assert.notEqual(fixture.session().status, "completed");
    assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 1);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "routing.response_selected" || event.event_type === "tool.started"), false);
  } finally { gate.resolve(); await fixture.close(); }
});

test("foreign bindings, extra authority and unknown critique lineage retain the router charge without a draft or fallback", { skip: process.platform !== "darwin", timeout: 20_000 }, async (t) => {
  for (const invalid of ["foreign", "duplicate", "authority", "lineage"] as const) await t.test(invalid, async () => {
    const fixture = await routedFixture({ configured: false });
    try {
      const common = { modelId: fixture.solverId, complexity: "complex", confidence: 0.99, reason: "Generated advice cannot grant a model or permission." };
      fixture.options.replyText = JSON.stringify(invalid === "lineage" ? { ...common, pattern: "critique", criticId: fixture.modelId } :
        { ...common, pattern: "cascade", escalationId: invalid === "foreign" ? "generated-not-configured" : invalid === "duplicate" ? fixture.solverId : fixture.modelId,
          ...(invalid === "authority" ? { approveAllTools: true } : {}) });
      await fixture.select(); await fixture.send("Generated invalid automatic plan."); await fixture.terminal(); await fixture.sdk.refresh();
      assert.equal(fixture.session().status, "partial");
      assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 0);
      assert.equal((await fixture.sdk.budgets.status(fixture.sessionId)).status.totals.reportedTokens, 42);
    } finally { await fixture.close(); }
  });
});

test("Guided recommendations from a selected Kupo draft keep its actual model actor and still wait for a human answer", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await routedFixture({ configured: false });
  try {
    fixture.options.respond = (_request, index) => ({ text: JSON.stringify(index === 1 ?
      { pattern: "cascade", modelId: fixture.solverId, escalationId: fixture.modelId, complexity: "moderate", confidence: 0.95, reason: "Generated Guided route." } :
      { verdict: "pass", reason: "Generated gate cannot answer questions." }) });
    fixture.solverOptions.questionRecommendation = { choiceIndex: 1, reason: "Generated selected solver advice." };
    await fixture.select();
    await fixture.sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, autonomy: "Guided" });
    await fixture.send("generated structured question choices only through automatic Kupo");
    const question = await waitFor(() => fixture.service.controller.snapshot().questions.find((question) => question.status === "open"));
    assert.equal(question.answer, null); assert.equal(question.recommendation?.actor, "model");
    assert.equal(question.recommendation?.modelId, fixture.solverId);
    assert.equal(fixture.session().usage.find((entry) => entry.stepId === question.stepId)?.role, "draft");
    await fixture.sdk.questions.answer(question.id, question.choices[0]!, question.revision);
    await fixture.terminal(); await fixture.sdk.refresh();
    assert.equal(fixture.session().status, "completed");
    assert.equal(fixture.service.controller.snapshot().questions[0]?.answer?.actor, "user");
  } finally { await fixture.close(); }
});

test("Remote automatic Cascade keeps selected tools and model calls on the pinned SSH root without Local writes", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await routedFixture({ env: "Remote", configured: false });
  try {
    fixture.options.respond = (_request, index) => ({ text: JSON.stringify(index === 1 ?
      { pattern: "cascade", modelId: fixture.solverId, escalationId: fixture.modelId, complexity: "moderate", confidence: 0.95, reason: "Generated SSH automatic route." } :
      { verdict: "pass", reason: "Generated SSH gate cannot grant file access." }) });
    await fixture.select(); await fixture.send("generated write through automatic SSH Kupo");
    await fixture.terminal(); await fixture.sdk.refresh();
    assert.equal(fixture.session().pendingApproval, null);
    assert.equal(fixture.session().status, "completed");
    assert.ok(fixture.workspace);
    assert.equal(await readFile(join(fixture.workspace, "fixture.txt"), "utf8"), "generated replacement\n");
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(fixture.requests.length, 4); assert.equal(fixture.solver.requests.length, 3);
    assert.deepEqual(fixture.session().usage.map((entry) => entry.role), ["router", "draft", "critic", "draft", "critic", "draft", "critic"]);
  } finally { await fixture.close(); }
});
