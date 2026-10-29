import assert from "node:assert/strict";
import test from "node:test";
import { DraftEditor, MoguriSdk } from "../packages/sdk/src/index.ts";
import { reviewNativeTools, setupFixture, waitFor } from "./fixture.ts";

test("live yolo delegates only this session and releases an actually automatic pending tool without another model call", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ respond: (_request, index) => index === 1 ?
    { tool: { name: "run_command", args: { command: "printf 'GENERATED_YOLO_PENDING_TOOL\\n'", timeoutMs: 2000 } } } :
    { text: "Generated original yolo continuation." } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    await fixture.configure(); await fixture.send("Generated original manual pending command.");
    const approval = await waitFor(() => fixture.session().pendingApproval);
    const before = structuredClone(fixture.session().controls), permissions = structuredClone(sdk.settings.get()!.values.permissions);
    editor.receive(fixture.session().draft); editor.edit("/yolo"); await editor.flush();
    await sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision: fixture.session().draft.revision });
    await waitFor(() => fixture.session().controls.autonomy === "Autopilot");
    await fixture.terminal();
    assert.equal(fixture.session().controls.automaticApprovals, true);
    assert.equal(fixture.session().controls.env, before.env); assert.equal(fixture.session().controls.modelId, before.modelId);
    assert.deepEqual(fixture.session().controls.budget, before.budget); assert.deepEqual(fixture.session().controls.modelOptions, before.modelOptions);
    assert.deepEqual(sdk.settings.get()!.values.permissions, permissions);
    const decision = fixture.service.controller.events(0).find((event) => event.event_type === "tool.decided" && event.payload.approvalId === approval.id && event.payload.allow);
    assert.ok(decision?.event_type === "tool.decided"); assert.equal(decision.payload.actor, "autonomy"); assert.equal(decision.payload.ruleId, `autonomy:${fixture.sessionId}`);
    assert.equal(fixture.requests.length, 2); assert.equal(fixture.session().queue.length, 0);
    assert.equal(fixture.session().messages.some((message) => message.role === "user" && message.text === "/yolo"), false);
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});

test("live yolo never lifts default-deny policy to bypass an actual review", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    await reviewNativeTools(fixture, ["read_file"]); await sdk.refresh();
    const policy = sdk.settings.get()!;
    await sdk.settings.update({ ...policy.values, permissions: { ...policy.values.permissions, defaultDecision: "deny" } }, policy.revision);
    await fixture.configure(); await fixture.send("generated tool under explicit review");
    const approval = await waitFor(() => fixture.session().pendingApproval);
    editor.receive(fixture.session().draft); editor.edit("/yolo"); await editor.flush();
    await sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision: fixture.session().draft.revision });
    await waitFor(() => fixture.session().controls.automaticApprovals === true);
    assert.equal(fixture.session().pendingApproval?.id, approval.id);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.decided" && event.payload.approvalId === approval.id && event.payload.allow), false);
    await sdk.approvals.respond(fixture.sessionId, approval.id, false); await fixture.terminal();
    assert.equal(fixture.service.controller.snapshot().settings.values.permissions.defaultDecision, "deny");
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});

test("live yolo leaves a pending structured question for its actual user", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    await fixture.configure(); await fixture.send("generated structured question choices only");
    const question = await waitFor(() => fixture.session().pendingQuestionId);
    editor.receive(fixture.session().draft); editor.edit("/yolo"); await editor.flush();
    await sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision: fixture.session().draft.revision });
    assert.equal(fixture.session().pendingQuestionId, question);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "question.answered" && event.payload.questionId === question), false);
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});

test("held yolo remains inert without a solver and selects Max only from actual configured readiness when released", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, decisions: { ...settings.values.decisions, enabled: true, modelId: fixture.modelId, allowHosted: true, outputTokens: 64 } }, settings.revision);
    const readiness = await sdk.decisions.status(fixture.sessionId);
    assert.equal(readiness.ready, true);
    editor.edit("/yolo"); await editor.flush();
    const queued = await sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision: fixture.session().draft.revision, held: true });
    assert.equal(fixture.session().controls.autonomy, "Manual"); assert.equal(fixture.session().controls.modelId, null);
    assert.equal(fixture.session().queue[0]?.held, true); assert.equal(fixture.requests.length, 0);
    await sdk.command({ type: "queue.release", sessionId: fixture.sessionId, messageId: queued.id!, expectedRevision: fixture.session().queueRevision });
    await waitFor(() => fixture.session().controls.autonomy === "Autopilot Max");
    assert.equal(fixture.session().controls.modelId, null); assert.equal(fixture.session().controls.automaticApprovals, true);
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.service.controller.snapshot().budgetEntries.length, 0);
    assert.equal(fixture.service.controller.snapshot().settings.values.startup.profile.autonomy, undefined);
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});

test("live stop holds undispatched commands and prompts rather than waiting behind the running model", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    await fixture.configure(); await fixture.send("generated slow original live-stop owner");
    await waitFor(() => fixture.requests.length === 1);
    await fixture.send("Generated undispatched input after the original turn.");
    editor.receive(fixture.session().draft); editor.edit("/stop"); await editor.flush();
    await sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision: fixture.session().draft.revision });
    await fixture.terminal();
    assert.ok(["stopped", "partial"].includes(fixture.session().status));
    assert.equal(fixture.session().queue.length, 1); assert.equal(fixture.session().queue[0]?.held, true);
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "slash.live_recorded" && event.payload.control.action === "stop" && event.payload.control.phase === "acknowledged"), true);
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});

test("live approval binds the actual pending action and remains a real user actor, not automatic advice", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ respond: (_request, index) => index === 1 ?
    { tool: { name: "run_command", args: { command: "printf 'GENERATED_EXACT_LIVE_APPROVAL\\n'", timeoutMs: 2000 } } } : { text: "Generated approved result." } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready(), editor = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
  try {
    await fixture.configure(); await fixture.send("Generated actual manual approval target.");
    const pending = await waitFor(() => fixture.session().pendingApproval);
    editor.receive(fixture.session().draft); editor.edit("/approve once"); await editor.flush();
    await sdk.commands.submit(fixture.sessionId, { client: "cli", expectedDraftRevision: fixture.session().draft.revision });
    await fixture.terminal();
    const decision = fixture.service.controller.events(0).find((event) => event.event_type === "tool.decided" && event.payload.approvalId === pending.id && event.payload.allow);
    assert.ok(decision?.event_type === "tool.decided"); assert.equal(decision.payload.actor, "user");
    assert.equal(fixture.session().controls.autonomy, "Manual"); assert.equal(fixture.requests.length, 2);
    assert.equal(fixture.session().queue.length, 0);
  } finally { editor.dispose(); sdk.disconnect(); await fixture.close(); }
});
