import test from "node:test";
import assert from "node:assert/strict";
import { routedFixture } from "./fixtures/single-routing.ts";
import { waitFor } from "./fixture.ts";
import { nativeConfiguration } from "./fixtures/native-target.ts";
import { nativeApiFixture } from "./fixtures/native-api.ts";
import { defaultSandboxManagement } from "../packages/sdk/src/index.ts";

const choice = JSON.stringify({ answers: { action: { type: "choice", choice: "option1", confidence: 0.98,
  probabilities: { option0: 0.01, option1: 0.98, askUser: 0.01 } } } });
async function remoteDecisions() {
  const fixture = await routedFixture({ env: "Remote", configured: false, legacy: false });
  try {
    const settings = structuredClone(fixture.sdk.settings.get()!.values);
    settings.decisions = { ...settings.decisions, enabled: true, provider: "bounded-model", modelId: fixture.solverId, outputTokens: 128,
      technicalQuestions: [{ id: "generated-owned-technical", kind: "technical-choice", question: "Choose a generated fixture approach?",
        choices: ["Generated first choice", "Generated second choice"] }] };
    await fixture.sdk.settings.update(settings, fixture.sdk.settings.get()!.revision);
    await fixture.sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, env: "Remote", modelId: fixture.modelId });
    await fixture.sdk.sessions.autonomy(fixture.sessionId, "Autopilot Max");
    fixture.options.responseMode = "auto"; fixture.solverOptions.responseMode = "text"; fixture.solverOptions.replyText = choice;
    return fixture;
  } catch (error) { await fixture.close(); throw error; }
}

test("the actual SSH parent runs one private bounded decision at its pinned peer, then answers the exact delegated question without Local inference", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await remoteDecisions();
  try {
    await fixture.send("generated structured question choices only through owned SSH decisions");
    await waitFor(() => !fixture.session().turnId && ["completed", "failed", "partial"].includes(fixture.session().status), 20_000).catch((error: unknown) => {
      const state = fixture.service.controller.snapshot();
      throw new Error(`Generated owned decision did not settle: ${JSON.stringify({ status: fixture.session().status, error: fixture.session().lastError,
        calls: fixture.requests.length, privateCalls: fixture.solver.requests.length, decisions: state.decisions, questions: state.questions.map((question) =>
          ({ status: question.status, answer: question.answer, diagnostic: question.diagnostic })) })}`, { cause: error });
    });
    const state = fixture.service.controller.snapshot();
    assert.equal(fixture.session().status, "completed", fixture.session().lastError ?? "");
    const record = state.decisions[0]!;
    assert.ok(record); assert.equal(record.version, 2); assert.equal(record.env, "Remote"); assert.equal(record.status, "applied");
    assert.equal(record.cleanup, "owned-role-acknowledged"); assert.equal(fixture.solver.requests.length, 1);
    assert.equal(state.executions.length, 1); assert.equal(record.version === 2 && record.transport.executionId, state.executions[0]?.id);
    assert.equal(state.questions[0]?.answer?.actor, "decision-provider"); assert.equal(state.questions[0]?.answer?.modelId, fixture.solverId);
    assert.deepEqual(state.budgetEntries.map((entry) => [entry.env, entry.role]), [["Remote", "solver"], ["Remote", "decision"], ["Remote", "solver"]]);
    assert.equal(state.budgetEntries.reduce((sum, entry) => sum + (entry.reportedTokens ?? 0), 0), 126);
    assert.equal(fixture.solver.requests[0]?.tools, undefined);
    assert.equal(fixture.session().messages.filter((message) => message.role === "user").length, 1);
    assert.equal(JSON.stringify(fixture.requests.at(-1)).includes('"confidence"'), false);
  } finally { await fixture.close(); }
});

test("stopping only the actual SSH private decision cancels its model without terminating or answering the waiting parent", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await remoteDecisions();
  try {
    fixture.solverOptions.respond = () => ({ text: "Generated held private decision.", hold: true });
    await fixture.send("generated structured question choices only with cancellable SSH decision");
    const record = await waitFor(() => fixture.service.controller.snapshot().decisions.find((entry) => entry.status === "running"), 15000);
    await waitFor(() => fixture.solver.requests.length === 1);
    await fixture.sdk.decisions.stop(record.id);
    await waitFor(() => fixture.service.controller.snapshot().decisions.find((entry) => entry.id === record.id)?.status === "partial", 12000);
    assert.equal(fixture.session().status, "waiting_input"); assert.ok(fixture.session().turnId); assert.ok(fixture.session().pendingQuestionId);
    assert.equal(fixture.service.controller.snapshot().questions[0]?.answer, null);
    assert.equal(fixture.solver.requests.length, 1);
    assert.equal(fixture.service.controller.snapshot().budgetEntries.find((entry) => entry.role === "decision")?.status, "unknown");
    assert.equal(fixture.service.controller.snapshot().decisions[0]?.cleanup, "owned-role-acknowledged");
  } finally { await fixture.close(); }
});

test("a tool-calling SSH decision is retained as partial advice and cannot execute tools or answer the parent", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await remoteDecisions();
  try {
    fixture.solverOptions.toolCall = { name: "write_file", args: { path: "generated-forbidden-private.txt", text: "Generated private tool advice.", expectedDigest: "absent" } };
    await fixture.send("generated structured question choices only with rejected private tool output");
    await waitFor(() => fixture.service.controller.snapshot().decisions[0]?.status === "partial", 15000);
    assert.equal(fixture.service.controller.snapshot().questions[0]?.answer, null);
    assert.equal(fixture.solver.requests.length, 1);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started" &&
      event.payload.call.name === "write_file"), false);
    assert.equal(fixture.service.controller.snapshot().decisions[0]?.cleanup, "owned-role-acknowledged");
  } finally { await fixture.close(); }
});

const native = await nativeConfiguration();
test("the actual native guest owns its solver/decision/solver sequence and only the explicit technical-choice actor answers", { skip: !native, timeout: 90_000 }, async () => {
  assert.ok(native);
  const fixture = await nativeApiFixture(native, { scenario: "decisions" }), { sdk, service, provider, project } = fixture;
  let passed = false;
  try {
    const settings = structuredClone(sdk.settings.get()!);
    settings.values.sandbox = fixture.reviewedConfiguration;
    settings.values.sandboxManagement = { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false };
    settings.values.decisions = { ...settings.values.decisions, enabled: true, provider: "bounded-model", modelId: provider.modelId,
      allowHosted: true, outputTokens: 128, technicalQuestions: [{ id: "generated-native-technical", kind: "technical-choice",
        question: "Choose a generated fixture approach?", choices: ["Generated first choice", "Generated second choice"] }] };
    await sdk.settings.update(settings.values, settings.revision); await sdk.sandbox.probe();
    const bound = await sdk.projects.add(project), created = await sdk.sessions.create(bound.id!, "Generated native owned decisions",
      { env: "Sandbox", modelId: provider.modelId, autonomy: "Autopilot Max" });
    const session = () => service.controller.snapshot().sessions.find((entry) => entry.id === created.id)!;
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "Generated native exact technical choice.", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => !session().turnId && ["completed", "partial", "failed"].includes(session().status), 30000).catch((error: unknown) => {
      throw new Error(`Generated native decision gate: ${JSON.stringify({ status: session().status, error: session().lastError,
        decisions: service.controller.snapshot().decisions, questions: service.controller.snapshot().questions })}`, { cause: error });
    });
    const state = service.controller.snapshot(), record = state.decisions[0]!, execution = state.sandboxExecutions![0]!;
    assert.equal(session().status, "completed", session().lastError ?? "");
    assert.equal(record.version, 2); assert.equal(record.env, "Sandbox"); assert.equal(record.status, "applied");
    assert.equal(record.cleanup, "owned-role-acknowledged"); assert.equal(execution.cleanup, "owned-guest-stopped");
    assert.equal(record.version === 2 && record.transport.executionId, execution.id); assert.equal(state.sandboxExecutions!.length, 1);
    assert.deepEqual(state.budgetEntries.map((entry) => [entry.env, entry.role, entry.reportedTokens]),
      [["Sandbox", "solver", 42], ["Sandbox", "decision", 42], ["Sandbox", "solver", 42]]);
    assert.equal(state.questions[0]?.answer?.actor, "decision-provider"); assert.equal(provider.requests.length, 0);
    const result = (await sdk.sandbox.result(execution.id)).result!;
    const proof = JSON.parse(result.files.find((file) => file.path === "generated-native-decisions.json")!.text);
    assert.deepEqual(proof.calls.map((call: { role: string }) => call.role), ["solver", "decision", "solver"]);
    assert.equal(new Set(proof.calls.map((call: { pid: number }) => call.pid)).size, 1);
    assert.deepEqual(proof.calls[1].tools, []); assert.equal(proof.calls[1].maxOutput, 128);
    passed = true;
  } finally { await fixture.close(passed); }
});
