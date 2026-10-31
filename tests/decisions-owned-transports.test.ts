import test from "node:test";
import assert from "node:assert/strict";
import { waitFor } from "./fixture.ts";
import { nativeConfiguration } from "./fixtures/native-target.ts";
import { nativeApiFixture } from "./fixtures/native-api.ts";
import { defaultKupoSettings, defaultSandboxManagement, isRecord, KUPO_MODEL_ID } from "../packages/sdk/src/index.ts";
import { holdRemoteFrame } from "./fixtures/remote-frame-gate.ts";
import { setupRemoteDecisions as remoteDecisions } from "./fixtures/decisions-api.ts";

for (const kupo of [false, true]) test(`the actual SSH ${kupo ? "Balanced Kupo" : "fixed-model"} parent runs one private bounded decision at its pinned peer without Local inference`, { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await remoteDecisions(kupo);
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
    if (kupo) assert.equal(state.routings[0]?.mode, "balanced");
  } finally { await fixture.close(); }
});

test("inline SSH steering acknowledges only the current durable contiguous cursor, never an older waiting-parent frame", { skip: process.platform !== "darwin", timeout: 30_000 }, async (t) => {
  const fixture = await remoteDecisions(), launch = fixture.service.controller.remote.launch.bind(fixture.service.controller.remote), cursors: number[] = [];
  try {
    t.mock.method(fixture.service.controller.remote, "launch", (...args: Parameters<typeof launch>) => {
      const connection = launch(...args);
      if (!connection.acknowledge) throw new Error("The generated SSH parent has no durable cursor acknowledgement.");
      const acknowledge = connection.acknowledge.bind(connection);
      return { events: connection.events, get connected() { return connection.connected; },
        send: connection.send.bind(connection), kill: connection.kill.bind(connection),
        acknowledge: (sequence: number) => { cursors.push(sequence); acknowledge(sequence); } };
    });
    const settings = structuredClone(fixture.sdk.settings.get()!.values);
    settings.decisions.technicalQuestions = []; settings.decisions.steering = true;
    settings.decisions.steeringChoices = [{ id: "refocus", text: "Generated exact SSH technical focus." }];
    await fixture.sdk.settings.update(settings, fixture.sdk.settings.get()!.revision);
    fixture.options.respond = (request) => JSON.stringify(request.messages).includes('"role":"tool"') ? { text: "Generated ordinary answer." } :
      { tool: { name: "read_file", args: { path: "fixture.txt" } } };
    fixture.solverOptions.replyText = JSON.stringify({ answers: { action: { type: "choice", choice: "refocus", confidence: 0.98,
      probabilities: { continue: 0.01, refocus: 0.98, askUser: 0.01 } } } });
    await fixture.send("Generated original inline steering task.");
    await waitFor(() => !fixture.session().turnId && ["completed", "failed", "partial"].includes(fixture.session().status), 20000);
    assert.equal(fixture.session().status, "completed", fixture.session().lastError ?? "");
    assert.equal(fixture.service.controller.snapshot().decisions[0]?.kind, "steering");
    assert.equal(fixture.service.controller.snapshot().decisions[0]?.status, "applied");
    assert.ok(cursors.length > 1); assert.ok(cursors.every((value, index) => index === 0 || value >= cursors[index - 1]!));
    assert.deepEqual(fixture.service.controller.snapshot().budgetEntries.map((entry) => entry.role), ["solver", "steering", "solver"]);
    assert.equal(fixture.solver.requests.length, 1); assert.equal(fixture.requests.length, 2);
  } finally { await fixture.close(); t.mock.restoreAll(); }
});

for (const boundary of ["owned-model.complete", "owned-model.finished"] as const) test(`SSH private ${boundary} reply loss retains exact cleanup/accounting and never answers its parent`, { skip: process.platform !== "darwin", timeout: 30_000 }, async (t) => {
  const fixture = await remoteDecisions(), launch = fixture.service.controller.remote.launch.bind(fixture.service.controller.remote);
  let replyId: string | undefined, dropped = false;
  try {
    t.mock.method(fixture.service.controller.remote, "launch", (...args: Parameters<typeof launch>) => {
      const connection = launch(...args), send = connection.send.bind(connection);
      connection.events.on("message", (message) => {
        if (isRecord(message) && message.kind === boundary && typeof message.requestId === "string") replyId = message.requestId;
      });
      t.mock.method(connection, "send", (...args: Parameters<typeof send>) => {
        if (!dropped && args[0].kind === "reply" && args[0].requestId === replyId) {
          dropped = true; args[1]?.(null); return;
        }
        send(...args);
      });
      return connection;
    });
    await fixture.send("generated structured question choices only with a lost private model reply");
    const record = await waitFor(() => fixture.service.controller.snapshot().decisions.find((entry) => entry.resultDigest && dropped &&
      (boundary === "owned-model.complete" || entry.workerOutcome)), 15000);
    await fixture.sdk.decisions.stop(record.id);
    await waitFor(() => fixture.service.controller.snapshot().decisions.find((entry) => entry.id === record.id)?.status === "partial", 12000);
    const state = fixture.service.controller.snapshot();
    assert.equal(state.decisions[0]?.cleanup, boundary === "owned-model.complete" ? "owned-role-acknowledged" : "unconfirmed");
    assert.equal(state.budgetEntries.find((entry) => entry.role === "decision")?.status, "settled");
    assert.equal(state.questions[0]?.answer, null);
    assert.equal(fixture.session().status, boundary === "owned-model.complete" ? "waiting_input" : "stopped");
    assert.equal(state.executions[0]?.status, boundary === "owned-model.complete" ? "running" : "stopped");
    assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 1);
  } finally { await fixture.close(); t.mock.restoreAll(); }
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

test("failed SSH private-result persistence cannot acknowledge its frame or answer/continue the parent with free usage", { skip: process.platform !== "darwin", timeout: 30_000 }, async (t) => {
  const fixture = await remoteDecisions(), commit = fixture.service.store.commit.bind(fixture.service.store);
  let injected = false, retainedSequence: number | undefined;
  try {
    t.mock.method(fixture.service.store, "commit", (...args: Parameters<typeof commit>) => {
      if (!injected && args[0].some((event) => event.event_type === "decision.recorded" && event.payload.decision.resultDigest)) {
        injected = true; retainedSequence = fixture.service.controller.snapshot().executions[0]?.lastSequence;
        throw new Error("Generated owned decision result transaction interruption.");
      }
      return commit(...args);
    });
    await fixture.send("generated structured question choices only with failed original result receipt");
    await waitFor(() => !fixture.session().turnId && fixture.session().status === "partial", 15000);
    assert.equal(injected, true); assert.equal(fixture.solver.requests.length, 1); assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.service.controller.snapshot().questions[0]?.answer, null);
    assert.equal(fixture.service.controller.snapshot().budgetEntries.find((entry) => entry.role === "decision")?.status, "unknown");
    assert.equal(fixture.service.controller.snapshot().decisions[0]?.resultDigest, null);
    assert.ok(retainedSequence !== undefined);
    assert.equal(fixture.service.controller.snapshot().executions[0]?.lastSequence, retainedSequence);
  } finally { t.mock.restoreAll(); await fixture.close(); }
});

test("late exact SSH private result settles its original hold and retains raw evidence without cleanup, answer or parent replay", { skip: process.platform !== "darwin", timeout: 30_000 }, async (t) => {
  const fixture = await remoteDecisions(), gate = holdRemoteFrame(t, fixture.service.controller.remote, "owned-model.complete");
  try {
    await fixture.send("generated structured question choices only with original late owned result");
    await waitFor(() => gate.held, 15000);
    const record = fixture.service.controller.snapshot().decisions[0]!;
    await fixture.sdk.command({ type: "session.stop", sessionId: fixture.sessionId });
    await waitFor(() => !fixture.session().turnId && fixture.service.controller.snapshot().decisions[0]?.status === "partial" &&
      fixture.service.controller.snapshot().executions.every((execution) => !fixture.service.controller.remote.owns(execution.id)), 15000);
    const originalStatus = fixture.session().status, execution = fixture.service.controller.snapshot().executions[0]!;
    assert.equal(fixture.service.controller.snapshot().budgetEntries.find((entry) => entry.id === record.stepId)?.status, "unknown");
    await fixture.sdk.remote.reconcile(execution.id);
    const read = await fixture.sdk.decisions.read(record.id);
    assert.equal(read.decision.status, "partial"); assert.equal(read.decision.cleanup, "unconfirmed");
    assert.equal(read.decision.applied, null); assert.equal(read.decision.adviceDigest, null);
    assert.ok(read.result);
    const raw = JSON.parse(read.result), text = raw.content.find((block: { type: string }) => block.type === "text").text;
    assert.equal(JSON.parse(text).answers.action.choice, "option1"); assert.equal(fixture.session().status, originalStatus);
    const entry = fixture.service.controller.snapshot().budgetEntries.find((entry) => entry.id === record.stepId)!;
    assert.equal(entry.status, "settled"); assert.equal(entry.reportedTokens, 42);
    assert.equal(fixture.requests.length, 1); assert.equal(fixture.solver.requests.length, 1);
    assert.equal(fixture.service.controller.snapshot().questions[0]?.answer, null);
    await fixture.sdk.remote.reconcile(execution.id);
    assert.equal((await fixture.sdk.decisions.read(record.id)).decision.resultDigest, read.decision.resultDigest);
    assert.equal(fixture.service.controller.snapshot().budgetEntries.length, 2);
  } finally { gate.restore(); await fixture.close(); }
});

const native = await nativeConfiguration();
for (const { kupo, steering } of [{ kupo: false, steering: false }, { kupo: true, steering: false }, { kupo: true, steering: true }])
test(`the actual native ${kupo ? "Balanced Kupo" : "fixed-model"} guest owns its solver/${steering ? "steering" : "decision"}/solver sequence and exact actor`, { skip: !native, timeout: 90_000 }, async () => {
  assert.ok(native);
  const fixture = await nativeApiFixture(native, { scenario: steering ? "steering" : "decisions" }), { sdk, service, provider, project } = fixture;
  let passed = false;
  try {
    const settings = structuredClone(sdk.settings.get()!);
    settings.values.sandbox = fixture.reviewedConfiguration;
    settings.values.sandboxManagement = { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false };
    if (kupo) settings.values.kupo = { ...defaultKupoSettings(), approvedModelIds: [provider.modelId] };
    settings.values.decisions = { ...settings.values.decisions, enabled: true, provider: "bounded-model", modelId: provider.modelId,
      allowHosted: true, outputTokens: 128, steering, steeringChoices: steering ? [{ id: "refocus", text: "Generated exact native technical focus." }] : [],
      technicalQuestions: steering ? [] : [{ id: "generated-native-technical", kind: "technical-choice",
        question: "Choose a generated fixture approach?", choices: ["Generated first choice", "Generated second choice"] }] };
    await sdk.settings.update(settings.values, settings.revision); await sdk.sandbox.probe();
    const bound = await sdk.projects.add(project), created = await sdk.sessions.create(bound.id!, "Generated native owned decisions",
      { env: "Sandbox", modelId: kupo ? KUPO_MODEL_ID : provider.modelId, autonomy: "Autopilot Max" });
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
      [["Sandbox", "solver", 42], ["Sandbox", steering ? "steering" : "decision", 42], ["Sandbox", "solver", 42]]);
    if (steering) {
      assert.equal(state.questions.length, 0); assert.ok(service.controller.events(0).some((event) => event.event_type === "steering.applied" &&
        event.payload.decisionId === record.id && event.payload.text === "Generated exact native technical focus."));
    } else assert.equal(state.questions[0]?.answer?.actor, "decision-provider");
    assert.equal(provider.requests.length, 0);
    const result = (await sdk.sandbox.result(execution.id)).result!;
    const proof = JSON.parse(result.files.find((file) => file.path === "generated-native-decisions.json")!.text);
    assert.deepEqual(proof.calls.map((call: { role: string }) => call.role), ["solver", steering ? "steering" : "decision", "solver"]);
    assert.equal(new Set(proof.calls.map((call: { pid: number }) => call.pid)).size, 1);
    assert.deepEqual(proof.calls[1].tools, []); assert.equal(proof.calls[1].maxOutput, 128);
    if (kupo) assert.equal(state.routings[0]?.mode, "balanced");
    passed = true;
  } finally { await fixture.close(passed); }
});

test("actual native private Stop releases only its bounded Kupo role, retaining an unanswered parent and unknown charge", { skip: !native, timeout: 90_000 }, async () => {
  assert.ok(native);
  const fixture = await nativeApiFixture(native, { scenario: "decisions", behavior: "hold-decision" }), { sdk, service, provider, project } = fixture;
  let passed = false;
  try {
    const settings = structuredClone(sdk.settings.get()!);
    settings.values.sandbox = fixture.reviewedConfiguration; settings.values.sandboxManagement = { ...defaultSandboxManagement(), enabled: true, automaticUpdates: false };
    settings.values.kupo = { ...defaultKupoSettings(), approvedModelIds: [provider.modelId] };
    settings.values.decisions = { ...settings.values.decisions, enabled: true, modelId: provider.modelId, allowHosted: true, outputTokens: 128,
      technicalQuestions: [{ id: "generated-native-held", kind: "technical-choice", question: "Choose a generated fixture approach?",
        choices: ["Generated first choice", "Generated second choice"] }] };
    await sdk.settings.update(settings.values, settings.revision); await sdk.sandbox.probe();
    const bound = await sdk.projects.add(project), created = await sdk.sessions.create(bound.id!, "Generated native private Stop",
      { env: "Sandbox", modelId: KUPO_MODEL_ID, autonomy: "Autopilot Max" });
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "Generated exact native cancellable choice.", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    const record = await waitFor(() => service.controller.snapshot().decisions.find((record) => record.status === "running"), 30000);
    await sdk.decisions.stop(record.id);
    await waitFor(() => service.controller.snapshot().decisions[0]?.status === "partial", 12000);
    const state = service.controller.snapshot(), session = state.sessions.find((session) => session.id === created.id)!;
    assert.equal(session.status, "waiting_input"); assert.ok(session.turnId); assert.equal(state.questions[0]?.answer, null);
    assert.equal(state.decisions[0]?.cleanup, "owned-role-acknowledged"); assert.equal(state.decisions[0]?.env, "Sandbox");
    assert.equal(state.budgetEntries.find((entry) => entry.role === "decision")?.status, "unknown"); assert.equal(provider.requests.length, 0);
    await sdk.command({ type: "session.stop", sessionId: session.id });
    await waitFor(() => !service.controller.snapshot().sessions.find((value) => value.id === session.id)?.turnId, 30000);
    assert.equal(service.controller.snapshot().sandboxExecutions!.length, 1);
    assert.equal(service.controller.snapshot().sandboxExecutions![0]?.cleanup, "owned-guest-stopped");
    passed = true;
  } finally { await fixture.close(passed); }
});
