import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtureProvider, waitFor } from "./fixture.ts";
import { setupDecisions } from "./fixtures/decisions-api.ts";
import { isRecord } from "../packages/sdk/src/index.ts";
import { routedFixture } from "./fixtures/single-routing.ts";
import { generatedAdvice } from "./fixtures/decisions-api.ts";

test("legacy bounded Max preserves its separately configured delegated tool review and original all-role charges", { skip: process.platform !== "darwin", timeout: 20000 }, async () => {
  const f = await setupDecisions(), { sdk, advice } = f;
  try {
    await f.send("generated tool with explicitly delegated bounded decision review"); await f.terminal(); await sdk.refresh();
    assert.equal(f.session().status, "completed"); assert.equal(f.requests.length, 2); assert.equal(advice.requests.length, 1);
    assert.equal(f.session().controls.modelId, f.modelId); assert.equal(f.session().controls.env, "Local");
    const report = sdk.decisions.list(f.sessionId)[0]; assert.ok(report);
    assert.equal(report.status, "applied"); assert.equal(report.kind, "tool"); assert.equal(report.cleanup, "owned-worker-stopped");
    const decided = f.service.controller.events(0).find((event) => event.event_type === "tool.decided" && event.payload.actor === "decision-provider");
    assert.ok(decided?.event_type === "tool.decided"); assert.equal(decided.payload.ruleId, "generated-read-delegation");
    assert.equal(decided.payload.decisionId, report.id);
    assert.deepEqual(f.service.controller.snapshot().budgetEntries.map((entry) => entry.role), ["solver", "decision", "solver"]);
    assert.equal((await sdk.budgets.status(f.sessionId)).status.totals.reportedTokens, 126);
    assert.equal(JSON.stringify(f.requests[1]?.messages).includes('"confidence"'), false);
  } finally { await f.close(); }
});

test("new Max automatically approves an undelegated tool without introducing a legacy decision-provider permission gate", { skip: process.platform !== "darwin", timeout: 15000 }, async () => {
  const fixture = await setupDecisions({ delegated: false });
  try {
    await fixture.sdk.sessions.autonomy(fixture.sessionId, "Autopilot Max");
    await fixture.send("generated tool with automatic Max approval"); await fixture.terminal();
    assert.equal(fixture.session().status, "completed"); assert.equal(fixture.session().pendingApproval, null);
    assert.equal(fixture.advice.requests.length, 0);
    assert.ok(fixture.service.controller.events(0).some((event) => event.event_type === "tool.decided" && event.payload.actor === "autonomy"));
    assert.deepEqual(fixture.sdk.settings.get()!.values.permissions.tools, []);
  } finally { await fixture.close(); }
});

test("active decision input/results cannot be edited, archived or deleted; only the actual one-shot owner can stop them", { skip: process.platform !== "darwin", timeout: 20000 }, async () => {
  const f = await setupDecisions({ advice: { stream: { chunks: ['{"answers":'], delayMs: 2000 } } });
  try {
    await f.send("generated tool retained decision owner");
    const record = await waitFor(() => f.service.controller.snapshot().decisions.find((record) => record.status === "running"));
    await assert.rejects(f.sdk.artifacts.update(record.id, { text: "Generated replacement advice" }, 0), { code: "decision_document" });
    await assert.rejects(f.sdk.artifacts.update(record.id, { status: "archived" }, 0), { code: "decision_busy" });
    await assert.rejects(f.sdk.artifacts.delete(record.id, 0, true), { code: "decision_busy" });
    await waitFor(() => f.advice.requests.length === 1);
    await f.sdk.decisions.stop(record.id);
    await waitFor(() => f.service.controller.snapshot().decisions.find((entry) => entry.id === record.id)?.status === "partial");
    assert.ok(f.session().pendingApproval); assert.equal(f.session().status, "waiting_input");
    assert.equal(f.service.controller.snapshot().budgetEntries.find((entry) => entry.role === "decision")?.status, "unknown");
    assert.equal(f.advice.requests.length, 1);
  } finally { await f.close(); }
});

test("only exact user-delegated technical choices can be answered automatically, with decision-provider provenance instead of a human answer or permission", { skip: process.platform !== "darwin", timeout: 15000 }, async () => {
  const f = await setupDecisions({ advice: { replyText: JSON.stringify({ answers: { action: {
    type: "choice", choice: "option1", confidence: 0.98, probabilities: { option0: 0.01, option1: 0.98, askUser: 0.01 },
  } } }) } });
  try {
    const settings = structuredClone(f.sdk.settings.get()!.values);
    settings.decisions.technicalQuestions.push({ id: "generated-technical-choice", kind: "technical-choice", question: "Choose a generated fixture approach?",
      choices: ["Generated first choice", "Generated second choice"] });
    settings.artifacts.retainAnswers = true;
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision);
    await f.sdk.sessions.autonomy(f.sessionId, "Autopilot Max");
    await f.send("generated structured question choices only");
    await waitFor(() => f.service.controller.snapshot().decisions.some((record) => record.kind === "question"), 2500);
    await f.terminal(); await f.sdk.refresh();
    const question = f.service.controller.snapshot().questions.find((question) => question.sessionId === f.sessionId); assert.ok(question);
    assert.equal(question.status, "answered"); assert.equal(question.answer?.text, "Generated second choice");
    assert.equal(question.answer?.actor, "decision-provider"); assert.equal(question.answer?.modelId, f.decisionModelId);
    const report = f.sdk.decisions.list(f.sessionId).find((record) => record.kind === "question"); assert.ok(report);
    assert.equal(report.status, "applied"); assert.equal(question.answer?.decisionId, report.id); assert.equal(question.answer?.sourceCallId, report.stepId);
    const artifact = f.service.controller.snapshot().artifacts.find((artifact) => artifact.questionId === question.id); assert.ok(artifact);
    assert.equal(artifact.sources.some((source) => source.actor === "user"), false);
    assert.equal(artifact.sources.some((source) => source.actor === "decision-provider" && source.modelId === f.decisionModelId), true);
    const messages = f.requests.at(-1)?.messages; assert.ok(Array.isArray(messages));
    const tool = messages.filter(isRecord).find((message) => message.role === "tool"); assert.equal(typeof tool?.content, "string");
    const result: unknown = JSON.parse(String(tool?.content)); assert.ok(isRecord(result));
    assert.equal(result.actor, "decision-provider"); assert.equal(result.permissionGrant, false); assert.equal(result.userFact, false);
  } finally { await f.close(); }
});

test("Max steering runs only after a real safe solver boundary, selects exact user-configured text and never invents a user message, model or permission", { skip: process.platform !== "darwin", timeout: 15000 }, async () => {
  const f = await setupDecisions({ advice: { replyText: JSON.stringify({ answers: { action: {
    type: "choice", choice: "focus", confidence: 0.98, probabilities: { continue: 0.01, focus: 0.98, askUser: 0.01 },
  } } }) } });
  try {
    const settings = structuredClone(f.sdk.settings.get()!.values), text = "Recheck the last result against the existing task without expanding scope.";
    settings.decisions.reviewDelegatedTools = false; settings.decisions.steering = true; settings.decisions.steeringChoices = [{ id: "focus", text }];
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision);
    await f.send("generated tool safe owned steering boundary"); await f.terminal(); await f.sdk.refresh();
    assert.equal(f.session().status, "completed"); assert.equal(f.advice.requests.length, 1); assert.equal(f.requests.length, 2);
    const report = f.sdk.decisions.list(f.sessionId).find((record) => record.kind === "steering"); assert.ok(report); assert.equal(report.status, "applied");
    const event = f.service.controller.events(0).find((event) => event.event_type === "steering.applied"); assert.ok(event?.event_type === "steering.applied");
    assert.equal(event.payload.text, text); assert.equal(event.payload.modelId, f.decisionModelId); assert.equal(event.payload.decisionId, report.id);
    assert.equal(f.session().messages.filter((message) => message.role === "user").length, 1);
    assert.equal(JSON.stringify(f.requests.at(-1)?.messages).includes("untrusted-decision-steer"), true);
    assert.deepEqual(f.service.controller.snapshot().budgetEntries.map((entry) => entry.role), ["solver", "steering", "solver"]);
    assert.equal(f.session().controls.modelId, f.modelId); assert.equal(f.session().controls.env, "Local");
  } finally { await f.close(); }
});

test("kupo Single and explicitly bounded Max remain independent: the real routed solver uses the same owned decision authority and all-role ledger without promoting router/advice text into its context", { skip: process.platform !== "darwin", timeout: 15000 }, async () => {
  const f = await routedFixture(), advice = await fixtureProvider({ responseMode: "text", exposeModels: true, replyText: generatedAdvice() });
  try {
    const settings = structuredClone(f.sdk.settings.get()!.values);
    settings.permissions.tools.push({ id: "generated-routed-read", tool: "read_file", decision: "allow", pathPrefix: "fixture.txt" });
    settings.localModels.push({ id: "generated-max-decisions", name: "Generated routed Max decisions", enabled: true, baseUrl: advice.baseUrl + "/v1", auth: "none",
      models: [{ id: advice.modelId, name: "Generated routed Max decisions", contextWindow: 32768, maxTokens: 2048, imageInput: false }] });
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision); await f.sdk.models.refresh();
    const model = f.sdk.getState().snapshot!.provider.models.find((model) => model.name === "Generated routed Max decisions"); assert.ok(model);
    const configured = structuredClone(f.sdk.settings.get()!.values);
    configured.decisions = { ...configured.decisions, enabled: true, modelId: model.id, outputTokens: 256 };
    await f.sdk.settings.update(configured, f.sdk.settings.get()!.revision); await f.select();
    await f.sdk.sessions.configure(f.sessionId, { ...f.session().controls, autonomy: "Autopilot Max", automaticApprovals: false });
    await f.send("generated tool from actual routed Max"); await f.terminal();
    assert.equal(f.session().status, "completed"); assert.equal(f.session().controls.modelId, "kupo");
    assert.equal(f.requests.length, 1); assert.equal(f.solver.requests.length, 2); assert.equal(advice.requests.length, 1);
    assert.deepEqual(f.service.controller.snapshot().budgetEntries.map((entry) => entry.role), ["router", "solver", "decision", "solver"]);
    assert.equal((await f.sdk.budgets.status(f.sessionId)).status.totals.reportedTokens, 168);
    assert.equal(f.service.controller.snapshot().decisions[0]?.status, "applied");
    assert.equal(JSON.stringify(f.solver.requests.at(-1)?.messages).includes("Generated classifier advice"), false);
    assert.equal(JSON.stringify(f.solver.requests.at(-1)?.messages).includes('"confidence"'), false);
  } finally { await f.close(); await advice.close(); }
});
