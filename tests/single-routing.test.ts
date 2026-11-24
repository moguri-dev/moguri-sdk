import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { MoguriSdk, KUPO_MODEL_ID, defaultKupoSettings, defaultSingleKupoSettings, executeSlash } from "../packages/sdk/src/index.ts";
import { reviewNativeTools, setupFixture, waitFor } from "./fixture.ts";
import { profileFixture } from "./fixtures/profiles.ts";
import { routedFixture } from "./fixtures/single-routing.ts";
import { kupoPool } from "../apps/service/src/routing.ts";
import { localModelId, modelEndpointBoundary } from "../apps/service/src/model-registry.ts";
import { ciTime } from "./fixtures/time-scale.ts";
const native = { skip: process.platform !== "darwin", timeout: 20_000 };

async function useLoopbackClassifier(fixture: Awaited<ReturnType<typeof routedFixture>>) {
  const settings = structuredClone(fixture.sdk.settings.get()!.values);
  settings.localModels.push({ id: "generated-loopback-router", name: "Generated loopback router", enabled: true, baseUrl: `${fixture.baseUrl}/v1`, auth: "none",
    models: [{ id: fixture.modelId, name: "Generated local classifier", contextWindow: 16384, maxTokens: 128, imageInput: false }] });
  await fixture.sdk.settings.update(settings, fixture.sdk.settings.get()!.revision); await fixture.sdk.models.refresh();
  await fixture.sdk.models.selectSource(fixture.modelId, localModelId("generated-loopback-router", fixture.modelId));
  const classifier = fixture.sdk.getState().snapshot!.provider.models.find((model) => model.name === "Generated local classifier");
  if (!classifier) throw new Error("The generated loopback classifier was not discovered.");
  await fixture.sdk.routing.configure({ ...fixture.sdk.routing.policy()!, classifierModelId: classifier.id, allowHosted: false }, fixture.sdk.settings.get()!.revision);
  return classifier;
}

test("configured provider labels never substitute for an actual loopback boundary or consent for network/unknown model destinations", () => {
  assert.equal(modelEndpointBoundary("http://127.0.0.1:4321/v1"), "loopback");
  assert.equal(modelEndpointBoundary("https://localhost/v1"), "loopback");
  assert.equal(modelEndpointBoundary("http://[::1]:4321/v1"), "loopback");
  assert.equal(modelEndpointBoundary("https://generated-model.invalid/v1"), "network");
  const network = { id: "generated-network", name: "Generated nominally local provider", contextWindow: 8192, maxTokens: 128, imageInput: false, source: "local" as const, endpointBoundary: "network" as const };
  const policy = { ...defaultSingleKupoSettings(), enabled: true, classifierModelId: network.id, approvedModelIds: [network.id] };
  assert.throws(() => kupoPool(policy, [network], "Local"), /classifier|hosted-data/i);
  assert.throws(() => kupoPool(policy, [{ ...network, endpointBoundary: undefined }], "Local"), /classifier|hosted-data/i);
  assert.equal(kupoPool({ ...policy, allowHosted: true }, [network], "Local").classifier.id, network.id);
  const classifier = { ...network, id: "generated-loopback", endpointBoundary: "loopback" as const };
  assert.throws(() => kupoPool({ ...policy, classifierModelId: classifier.id }, [classifier, network], "Local"), /approved solver|privacy/i);
});

test("a fully configured loopback-only pool routes through local adapters with hosted consent off and no Copilot credential", native, async () => {
  const fixture = await routedFixture();
  try {
    const classifier = await useLoopbackClassifier(fixture);
    assert.equal(classifier.endpointBoundary, "loopback");
    await fixture.select(); await fixture.send("Generated local-only routing task."); await fixture.terminal(); await fixture.sdk.refresh();
    assert.equal(fixture.session().status, "completed"); assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 1);
    assert.equal(fixture.headers[0], undefined);
    assert.deepEqual(fixture.session().usage.map((usage) => [usage.role, usage.source]), [["router", "local"], ["solver", "local"]]);
  } finally { await fixture.close(); }
});

test("a configured classifier cannot redirect private task data to another destination or continue to a solver", native, async () => {
  const fixture = await routedFixture();
  try {
    await useLoopbackClassifier(fixture);
    fixture.options.redirectTo = `${fixture.solver.baseUrl}/v1/chat/completions`;
    await fixture.select(); await fixture.send("Generated private routing redirect fixture."); await fixture.terminal(); await fixture.sdk.refresh();
    assert.equal(fixture.session().status, "partial");
    assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 0);
    assert.equal(fixture.sdk.routing.history(fixture.sessionId)[0]?.plan, null);
    const entry = fixture.service.controller.snapshot().budgetEntries[0]!;
    assert.equal(entry.status, "unknown"); assert.ok(entry.reservedTokens! > 0);
  } finally { await fixture.close(); }
});

test("automatic routing defaults stay profile-scoped and legacy Single needs an observed settings revision without selecting a model", async () => {
  const fixture = await profileFixture();
  try {
    const { client: beta } = await fixture.create("Generated explicit routing Beta"), first = await fixture.sdk.sessions.create(), second = await beta.sessions.create();
    assert.deepEqual(fixture.sdk.routing.policy(), defaultKupoSettings()); assert.deepEqual(beta.routing.policy(), defaultKupoSettings());
    const revision = fixture.sdk.settings.get()!.revision;
    await fixture.sdk.routing.configure({ ...defaultSingleKupoSettings(), enabled: true, classifierModelId: fixture.providers[0]!.modelId, approvedModelIds: [fixture.providers[0]!.modelId], allowHosted: true }, revision);
    assert.equal(fixture.sdk.getState().snapshot!.provider.models.some((model) => model.synthetic), true);
    await beta.refresh(); assert.equal(beta.getState().snapshot!.provider.models.some((model) => model.id === KUPO_MODEL_ID), true);
    assert.deepEqual(beta.routing.policy(), defaultKupoSettings());
    assert.equal(fixture.session(fixture.sdk, first.id!).controls.modelId, null); assert.equal(fixture.session(beta, second.id!).controls.modelId, null);
    assert.throws(() => fixture.sdk.routing.history(second.id!), /profile|existing session/);
    await assert.rejects(() => fixture.sdk.routing.configure(defaultKupoSettings(), revision), /revision|changed/i);
    await fixture.sdk.settings.reset("kupo", fixture.sdk.settings.get()!.revision);
    assert.deepEqual(fixture.sdk.routing.policy(), defaultKupoSettings());
    assert.equal(fixture.providers.reduce((sum, provider) => sum + provider.requests.length, 0), 0);
  } finally { await fixture.close(); }
});

test("shared slash configuration and model selection use the same scoped SDK without inference or carrying fixed-model options", async () => {
  const fixture = await setupFixture({ maxOutputTokens: 128, contextWindow: 32768 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.refresh(); await sdk.sessions.modelOptions(fixture.sessionId, { contextWindow: 16384 });
    const policy = { ...defaultSingleKupoSettings(), enabled: true, classifierModelId: fixture.modelId, approvedModelIds: [fixture.modelId], allowHosted: true };
    await executeSlash(sdk, fixture.sessionId, `/kupo set ${JSON.stringify(policy)}`, "cli");
    const selected = await executeSlash(sdk, fixture.sessionId, "/model kupo", "cli");
    assert.equal(selected.kind, "ok"); assert.equal(fixture.session().controls.modelId, KUPO_MODEL_ID);
    assert.equal(fixture.session().controls.modelOptions, undefined); assert.equal(fixture.requests.length, 0);
    const status = await executeSlash(sdk, fixture.sessionId, "/kupo status", "cli");
    assert.equal(status.kind, "text");
    if (status.kind === "text") assert.match(status.text, /Experimental Single only/);
    const models = await executeSlash(sdk, fixture.sessionId, "/models", "cli");
    assert.equal(models.kind, "text");
    if (models.kind === "text") assert.match(models.text, /"synthetic": true/);
    await assert.rejects(() => executeSlash(sdk, fixture.sessionId, '/kupo set {"enabled":true}', "cli"), /schema|valid|field|expected/i);
    assert.deepEqual(sdk.routing.policy(), policy); assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("the actual owned worker routes once then solves with real role-aware reservations and no classifier context promotion", native, async () => {
  const fixture = await routedFixture();
  try {
    assert.ok(fixture.sdk.getState().snapshot!.provider.models.some((model) => model.id === KUPO_MODEL_ID && model.synthetic));
    await fixture.select(); await fixture.send("Generated actual Single routing task."); await fixture.terminal(); await fixture.sdk.refresh();
    assert.equal(fixture.session().status, "completed"); assert.equal(fixture.session().controls.modelId, KUPO_MODEL_ID);
    assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 1);
    assert.equal(fixture.requests[0]?.max_tokens ?? fixture.requests[0]?.max_completion_tokens, 128);
    assert.equal(fixture.requests[0]?.tools, undefined);
    assert.equal(JSON.stringify(fixture.requests[0]).includes(fixture.solver.baseUrl), false);
    assert.equal(JSON.stringify(fixture.solver.requests[0]).includes("Generated classifier advice"), false);
    assert.ok(fixture.session().messages.some((message) => message.role === "assistant" && message.text === "Generated routed solver answer."));
    assert.equal(fixture.session().messages.some((message) => message.role === "assistant" && message.text.includes('"pattern":"single"')), false);
    assert.deepEqual(fixture.session().usage.map((usage) => usage.role), ["router", "solver"]);
    assert.deepEqual(fixture.service.controller.snapshot().budgetEntries.map((entry) => [entry.role, entry.modelId, entry.reportedTokens]), [["router", fixture.modelId, 42], ["solver", fixture.solverId, 42]]);
    assert.equal((await fixture.sdk.budgets.status(fixture.sessionId)).status.totals.reportedTokens, 84);
    const routing = fixture.sdk.getState().snapshot!.routings[0]!;
    assert.equal(routing.status, "completed"); assert.equal(routing.plan?.modelId, fixture.solverId);
  } finally { await fixture.close(); }
});

test("an invalid or low-confidence classifier plan retains its actual charge and dispatches no solver", native, async () => {
  for (const output of [{ pattern: "single", modelId: "generated-unapproved", confidence: 1, reason: "Generated invalid model" }, { pattern: "single", modelId: "", confidence: 0.1, reason: "Generated uncertainty" }, { pattern: "single", modelId: "", confidence: 0.95, reason: " " }]) {
    const fixture = await routedFixture();
    try {
      fixture.options.replyText = JSON.stringify({ ...output, modelId: output.modelId || fixture.solverId });
      await fixture.select(); await fixture.send("Generated rejected actual route."); await fixture.terminal(); await fixture.sdk.refresh();
      assert.equal(fixture.session().status, "partial");
      assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 0);
      assert.equal((await fixture.sdk.budgets.dashboard({ role: "router" })).totals.reportedTokens, 42);
      assert.equal(fixture.sdk.getState().snapshot!.routings[0]?.status, "partial");
    } finally { await fixture.close(); }
  }
});

test("unreported or output-violating classifier metering never dispatches a solver or refunds the router", native, async () => {
  for (const unreported of [true, false]) {
    const fixture = await routedFixture();
    try {
      fixture.options.omitUsage = unreported;
      if (!unreported) fixture.options.usage = { prompt_tokens: 30, completion_tokens: 129, total_tokens: 159 };
      await fixture.select(); await fixture.send("Generated classifier telemetry boundary."); await fixture.terminal(); await fixture.sdk.refresh();
      assert.equal(fixture.session().status, "partial");
      assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 0);
      const entry = fixture.service.controller.snapshot().budgetEntries[0]!;
      if (unreported) {
        assert.equal(entry.status, "unknown"); assert.equal(entry.reportedTokens, null); assert.ok(entry.reservedTokens! > 0);
      } else {
        assert.equal(entry.reportedTokens, 159); assert.equal(entry.outputLimitViolation, true);
        assert.equal(fixture.sdk.routing.history(fixture.sessionId)[0]?.plan, null);
      }
      assert.equal(fixture.sdk.routing.history(fixture.sessionId)[0]?.status, "partial");
    } finally { await fixture.close(); }
  }
});

test("a hard cap applied during classification retains the router charge but blocks solver continuation", native, async () => {
  const fixture = await routedFixture();
  try {
    await fixture.select(); await fixture.send("generated delayed finite policy change");
    await waitFor(() => fixture.requests.length === 1);
    await fixture.sdk.profiles.globalBudget({ basis: "estimate", tokens: 100_000 }, 0, true);
    await fixture.terminal(); await fixture.sdk.refresh();
    assert.equal(fixture.session().status, "partial"); assert.equal(fixture.solver.requests.length, 0);
    assert.equal((await fixture.sdk.budgets.dashboard({ role: "router" })).totals.reportedTokens, 42);
    assert.match(fixture.sdk.routing.history(fixture.sessionId)[0]!.diagnostic!, /finite|wind-down|cap/i);
    assert.equal((await fixture.sdk.profiles.list()).catalog.globalBudget.limit?.tokens, 100_000);
  } finally { await fixture.close(); }
});

test("classifier cancellation propagates through the same owned worker and holds unreported cost without running the solver", native, async () => {
  const fixture = await routedFixture();
  try {
    fixture.options.respond = () => ({ text: "Generated owned classifier held.", hold: true });
    await fixture.select(); await fixture.send("generated slow actual router cancellation");
    await waitFor(() => fixture.requests.length === 1);
    await fixture.sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); await fixture.terminal(); await fixture.sdk.refresh();
    assert.equal(fixture.session().status, "stopped"); assert.equal(fixture.solver.requests.length, 0);
    assert.equal(fixture.sdk.getState().snapshot!.routings[0]?.status, "stopped");
    const entry = fixture.service.controller.snapshot().budgetEntries[0]!;
    assert.equal(entry.role, "router"); assert.equal(entry.status, "unknown"); assert.ok(entry.reservedTokens! > 0);
  } finally { await fixture.close(); }
});

test("hosted-data permission and all inherited finite caps remain authoritative over experimental Single selection", native, async () => {
  const fixture = await routedFixture();
  try {
    const settings = structuredClone(fixture.sdk.settings.get()!.values); settings.kupo.allowHosted = false;
    await fixture.sdk.settings.update(settings, fixture.sdk.settings.get()!.revision);
    await assert.rejects(() => fixture.select(), /hosted-data permission|classifier/);
    settings.kupo.allowHosted = true; await fixture.sdk.settings.update(settings, fixture.sdk.settings.get()!.revision);
    await fixture.sdk.budgets.policy({ basis: "estimate", tokens: 100_000 }, 0, true);
    await assert.rejects(() => fixture.select(), /finite budgets|wind-down/);
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.solver.requests.length, 0);
  } finally { await fixture.close(); }
});

test("a fixed model remains fixed even when the routing policy is configured", native, async () => {
  const fixture = await routedFixture();
  try {
    await fixture.sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: fixture.solverId });
    await fixture.send("Generated explicitly fixed model."); await fixture.terminal(); await fixture.sdk.refresh();
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.solver.requests.length, 1);
    assert.equal(fixture.sdk.getState().snapshot!.routings.length, 0);
    assert.deepEqual(fixture.session().usage.map((usage) => usage.role), ["solver"]);
  } finally { await fixture.close(); }
});

test("a pool or hosted-data change while the classifier runs invalidates advice but preserves the real call's accounting", native, async () => {
  const fixture = await routedFixture();
  try {
    await fixture.select(); await fixture.send("generated delayed routing policy race");
    await waitFor(() => fixture.requests.length === 1);
    const settings = structuredClone(fixture.sdk.settings.get()!.values); settings.kupo.approvedModelIds = [];
    await fixture.sdk.settings.update(settings, fixture.sdk.settings.get()!.revision); await fixture.terminal(); await fixture.sdk.refresh();
    assert.equal(fixture.session().status, "partial"); assert.equal(fixture.solver.requests.length, 0);
    assert.equal((await fixture.sdk.budgets.dashboard({ role: "router" })).totals.reportedTokens, 42);
    assert.match(fixture.sdk.getState().snapshot!.routings[0]!.diagnostic!, /policy|changed|approved/i);
  } finally { await fixture.close(); }
});

test("a steer arriving during classification cannot reuse the old task plan or silently trigger another classifier", native, async () => {
  const fixture = await routedFixture();
  try {
    await fixture.select(); await fixture.send("generated delayed routing task race");
    await waitFor(() => fixture.requests.length === 1);
    const text = "Generated changed routing goal.";
    await fixture.sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text, attachments: [] });
    await fixture.sdk.command({ type: "message.send", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, delivery: "steer" });
    await fixture.terminal(); await fixture.sdk.refresh();
    assert.equal(fixture.session().status, "partial"); assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 0);
    assert.ok(fixture.session().queue.some((item) => item.text === text));
  } finally { await fixture.close(); }
});

test("a classifier cannot ask questions or execute tools even with a valid-looking confidence", native, async () => {
  const fixture = await routedFixture();
  try {
    fixture.options.toolCall = { name: "ask_user", args: { question: "Generated invalid classifier question.", choices: ["Generated one", "Generated two"], allowFreeform: false } };
    await fixture.select(); await fixture.send("generated structured question from an invalid router"); await fixture.terminal(); await fixture.sdk.refresh();
    assert.equal(fixture.session().status, "partial"); assert.equal(fixture.solver.requests.length, 0);
    assert.equal(fixture.sdk.getState().snapshot!.questions.length, 0);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
    assert.equal(fixture.service.controller.snapshot().budgetEntries[0]?.reportedTokens, 42);
  } finally { await fixture.close(); }
});

test("the selected solver uses the existing exact-argument human approval path rather than router permission", native, async () => {
  const fixture = await routedFixture();
  try {
    await reviewNativeTools(fixture, ["read_file"]);
    const policy = structuredClone(fixture.service.controller.snapshot().settings.values.permissions.tools);
    await fixture.select(); await fixture.send("generated tool through the routed solver");
    const approval = await waitFor(() => fixture.session().pendingApproval);
    assert.equal(approval.call.name, "read_file"); assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 1);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
    await fixture.sdk.command({ type: "approval.respond", sessionId: fixture.sessionId, approvalId: approval.id, allow: true }); await fixture.terminal(); await fixture.sdk.refresh();
    assert.equal(fixture.session().status, "completed"); assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 2);
    assert.deepEqual(fixture.session().usage.map((usage) => usage.role), ["router", "solver", "solver"]);
    assert.deepEqual(fixture.sdk.settings.get()!.values.permissions.tools, policy);
  } finally { await fixture.close(); }
});

test("remembering an actual routed solver approval does not revoke its unchanged model policy or interrupt later solver steps", native, async () => {
  const fixture = await routedFixture();
  try {
    await reviewNativeTools(fixture, ["read_file"]);
    await fixture.select(); await fixture.send("generated tool through the routed solver with a remembered grant");
    const approval = await waitFor(() => fixture.session().pendingApproval);
    await fixture.sdk.approvals.respond(fixture.sessionId, approval.id, true, { scope: "project", match: "exact" });
    await fixture.terminal(); await fixture.sdk.refresh();
    assert.equal(fixture.session().status, "completed", fixture.session().lastError ?? "The original solver route must retain its unchanged authority.");
    assert.equal(fixture.solver.requests.length, 2);
    assert.equal(fixture.sdk.approvals.list().length, 1);
    await fixture.send("generated tool through the routed solver again");
    assert.equal((await fixture.terminal()).status, "completed");
    assert.equal(fixture.solver.requests.length, 4);
  } finally { await fixture.close(); }
});

test("Guided questions in a routed solver retain the actual solver model, never the synthetic label or router", native, async () => {
  const fixture = await routedFixture();
  try {
    fixture.solverOptions.questionRecommendation = { choiceIndex: 1, reason: "Generated selected solver recommendation." };
    await fixture.sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: KUPO_MODEL_ID, autonomy: "Guided" });
    await fixture.send("generated structured question in the routed solver");
    const question = await waitFor(() => fixture.sdk.getState().snapshot!.questions.find((question) => question.status === "open"));
    assert.equal(question.modelId, fixture.solverId); assert.equal(question.recommendation?.modelId, fixture.solverId);
    assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 1); assert.equal(question.answer, null);
    await fixture.sdk.questions.answer(question.id, question.choices[0]!, question.revision); await fixture.terminal(); await fixture.sdk.refresh();
    assert.equal(fixture.session().status, "completed"); assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 2);
    assert.equal(fixture.sdk.getState().snapshot!.questions[0]?.answer?.actor, "user");
  } finally { await fixture.close(); }
});

test("opt-in routed model children retain their actual subagent role and charge both legs to the parent after source deletion", native, async () => {
  const fixture = await routedFixture();
  try {
    await fixture.select();
    const settings = structuredClone(fixture.sdk.settings.get()!.values); settings.subagents.enabled = true;
    await fixture.sdk.settings.update(settings, fixture.sdk.settings.get()!.revision);
    const child = await fixture.sdk.subagents.run(fixture.sessionId, "Generated routed child analysis.");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === child.id)?.status === "completed");
    assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 1);
    assert.equal(fixture.solver.requests[0]?.tools, undefined);
    const entries = fixture.service.controller.snapshot().budgetEntries;
    assert.deepEqual(entries.map((entry) => [entry.role, entry.ownerSessionId]), [["router", fixture.sessionId], ["subagent", fixture.sessionId]]);
    assert.equal((await fixture.sdk.budgets.status(fixture.sessionId)).status.totals.reportedTokens, 84);
    await fixture.sdk.sessions.delete(child.id!, true);
    assert.equal((await fixture.sdk.budgets.status(fixture.sessionId)).status.totals.reportedTokens, 84);
    assert.equal((await fixture.sdk.budgets.dashboard({ role: "router" })).totals.reportedTokens, 42);
  } finally { await fixture.close(); }
});

test("revoking routing authority invalidates an actual pending solver approval rather than authorizing old arguments", native, async () => {
  const fixture = await routedFixture();
  try {
    await reviewNativeTools(fixture, ["read_file"]);
    await fixture.select(); await fixture.send("generated tool before routing revocation");
    const approval = await waitFor(() => fixture.session().pendingApproval);
    const settings = structuredClone(fixture.sdk.settings.get()!.values); settings.kupo.enabled = false;
    await fixture.sdk.settings.update(settings, fixture.sdk.settings.get()!.revision);
    await assert.rejects(() => fixture.sdk.command({ type: "approval.respond", sessionId: fixture.sessionId, approvalId: approval.id, allow: true }), /expired|changed|cancelled/i);
    await fixture.terminal();
    assert.equal(fixture.session().status, "partial");
    assert.equal(fixture.session().controls.modelId, null);
    assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 1);
    assert.ok(fixture.service.controller.snapshot().budgetEntries.every((entry) => entry.status === "settled" && entry.reportedTokens === 42));
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
  } finally { await fixture.close(); }
});

test("failed route-plan commitment rolls back completion/settlement and prevents solver continuation while retaining an unknown hold", native, async () => {
  const fixture = await routedFixture();
  try {
    fixture.service.store.db.exec(`CREATE TRIGGER generated_routing_plan_failure BEFORE INSERT ON events
      WHEN json_extract(NEW.data,'$.event_type')='routing.planned'
      BEGIN SELECT RAISE(ABORT,'Generated routing plan failure'); END;`);
    await fixture.select(); await fixture.send("Generated failed route receipt."); await fixture.terminal();
    assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 0);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "model.completed"), false);
    assert.equal(fixture.service.controller.snapshot().budgetEntries[0]?.status, "unknown");
    assert.ok(fixture.service.controller.snapshot().budgetEntries[0]!.reservedTokens! > 0);
    assert.notEqual(fixture.session().status, "completed");
  } finally { fixture.service.store.db.exec("DROP TRIGGER IF EXISTS generated_routing_plan_failure"); await fixture.close(); }
});

test("global caps cannot be escaped by selecting the synthetic model instead of a fixed one", native, async () => {
  const fixture = await routedFixture();
  try {
    await fixture.sdk.profiles.globalBudget({ basis: "estimate", tokens: 100_000 }, 0, true);
    await assert.rejects(() => fixture.select(), /finite budgets|wind-down/);
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.solver.requests.length, 0);
    assert.equal((await fixture.sdk.profiles.list()).catalog.globalBudget.limit?.tokens, 100_000);
  } finally { await fixture.close(); }
});

test("a task that fits no approved solver is blocked before sending private context to the classifier", native, async () => {
  const fixture = await routedFixture();
  try {
    await fixture.select(); await fixture.send("Generated bounded routing context. ".repeat(3000)); await fixture.terminal();
    assert.equal(fixture.session().status, "partial");
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.solver.requests.length, 0);
    assert.equal(fixture.service.controller.snapshot().budgetEntries.length, 0);
    assert.match(fixture.session().lastError ?? "", /approved solver|context/i);
  } finally { await fixture.close(); }
});

test("Single accepts a supported exact pool window but preserves unsupported image context before any classifier call", native, async () => {
  const fixture = await routedFixture();
  try {
    await fixture.select();
    await fixture.sdk.sessions.modelOptions(fixture.sessionId, { contextWindow: 8192 });
    assert.equal(fixture.session().controls.modelOptions?.contextWindow, 8192);
    await assert.rejects(() => fixture.sdk.sessions.modelOptions(fixture.sessionId, { contextWindow: 65536 }), /solver|context|pool/i);
    assert.equal(fixture.session().controls.modelOptions?.contextWindow, 8192);
    const image = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#304050" } }).png().toBuffer();
    await fixture.sdk.attachments.image(fixture.sessionId, image.toString("base64"), "Generated routing image");
    const attachment = fixture.session().draft.attachments[0]!;
    await assert.rejects(() => fixture.send("Generated image task stays saved."), /image|model/i);
    assert.equal(fixture.session().draft.attachments[0]?.id, attachment.id); assert.equal(fixture.session().draft.attachments[0]?.digest, attachment.digest);
    assert.equal(fixture.session().draft.text, "Generated image task stays saved.");
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.solver.requests.length, 0);
  } finally { await fixture.close(); }
});

test("Remote Single runs both owned roles through pinned SSH and accounts the actual remote-local solver", { skip: process.platform !== "darwin", timeout: ciTime(30_000) }, async () => {
  const fixture = await routedFixture({ env: "Remote" });
  try {
    await fixture.select(); await fixture.send("Generated genuine SSH Single routing."); await fixture.terminal(); await fixture.sdk.refresh();
    assert.equal(fixture.session().status, "completed"); assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 1);
    assert.ok(fixture.solverId.startsWith("remote."));
    assert.deepEqual(fixture.service.controller.snapshot().budgetEntries.map((entry) => [entry.role, entry.env]), [["router", "Remote"], ["solver", "Remote"]]);
    const execution = fixture.service.controller.snapshot().executions[0]!;
    assert.equal(execution.workspace, fixture.workspace); assert.ok(execution.workerPid); assert.ok(execution.lastSequence >= 4);
    assert.equal(fixture.sdk.getState().snapshot!.routings[0]?.status, "completed");
  } finally { await fixture.close(); }
});

test("routed Remote file tools use native policy and never write the Local mapping", { skip: process.platform !== "darwin", timeout: ciTime(30_000) }, async () => {
  const fixture = await routedFixture({ env: "Remote" });
  try {
    await fixture.select(); await fixture.send("generated write from the selected SSH solver");
    await waitFor(() => !fixture.session().turnId && ["completed", "stopped", "partial", "failed"].includes(fixture.session().status), 25_000); await fixture.sdk.refresh();
    assert.equal(fixture.session().pendingApproval, null);
    assert.equal(fixture.session().status, "completed"); assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 3);
    if (!fixture.workspace) throw new Error("Generated SSH workspace missing.");
    assert.equal(await readFile(join(fixture.workspace, "fixture.txt"), "utf8"), "generated replacement\n");
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated original\n");
  } finally { await fixture.close(); }
});
