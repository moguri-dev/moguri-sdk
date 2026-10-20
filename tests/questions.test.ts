import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { MoguriSdk, type UserQuestion } from "../packages/sdk/src/index.ts";
import { EventStore } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { writeLegacyState } from "./fixtures/legacy-state.ts";

const native = { skip: process.platform !== "darwin", timeout: 20_000 };
test("a real typed question routes without redundant approval and atomically retains the actual user answer from the shared draft", native, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("generated structured question");
    const question = await waitFor(() => sdk.getState().snapshot!.questions.find((question) => question.status === "open"));
    assert.equal(fixture.session().status, "waiting_input"); assert.equal(fixture.session().pendingApproval, null); assert.equal(fixture.requests.length, 1);
    assert.equal(sdk.getState().snapshot!.attention.findLast((attention) => attention.messageId === question.id)?.source, "state");
    await sdk.attachments.file(fixture.sessionId, join(fixture.project, "fixture.txt"));
    const session = fixture.session(), text = "Generated actual user clarification.";
    await sdk.command({ type: "draft.save", sessionId: session.id, expectedRevision: session.draft.revision, text, attachments: session.draft.attachments });
    await assert.rejects(() => sdk.questions.answer(question.id, text, 0, { sessionId: session.id, expectedRevision: fixture.session().draft.revision - 1 }), /draft changed/i);
    assert.equal(fixture.session().draft.text, text); assert.equal(fixture.service.controller.snapshot().questions[0]?.status, "open");
    const answered = await sdk.questions.answerDraft(question.id, 0);
    assert.equal(answered.revision, 1);
    await fixture.terminal(); await sdk.refresh();
    assert.equal(fixture.session().draft.text, ""); assert.equal(fixture.session().draft.attachments.length, 1);
    const artifact = sdk.getState().snapshot!.artifacts.find((artifact) => artifact.questionId === question.id)!;
    assert.ok(artifact); assert.deepEqual(artifact.sources.map((source) => source.actor), ["model", "user"]);
    assert.equal((await sdk.artifacts.read(artifact.id)).artifact.origin, "question");
    assert.match((await sdk.artifacts.read(artifact.id)).text, /Generated actual user clarification/);
    assert.equal(sdk.getState().snapshot!.questions[0]?.answer?.actor, "user");
    assert.equal(fixture.session().messages.some((message) => message.role === "tool" && message.text.includes('"permissionGrant":false')), true);
    assert.deepEqual(sdk.settings.get()!.values.permissions.tools, []);
    await sdk.sessions.delete(session.id, true);
    assert.equal(sdk.getState().snapshot!.questions.length, 0);
    assert.match((await sdk.artifacts.read(artifact.id)).text, /Choose a generated fixture approach/);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("choice-only validation and concurrent actual user answers cannot invent or overwrite an answer", native, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready(), peer = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("generated structured question choices only");
    const question = await waitFor(() => sdk.getState().snapshot!.questions.find((question) => question.status === "open"));
    await assert.rejects(() => sdk.questions.answer(question.id, "Generated unoffered answer", 0), /exact offered answer/);
    assert.equal(sdk.getState().snapshot!.artifacts.length, 0); assert.equal(fixture.requests.length, 1);
    const responses = await Promise.allSettled([sdk.questions.answer(question.id, question.choices[0]!, 0), peer.questions.answer(question.id, question.choices[1]!, 0)]);
    assert.equal(responses.filter((response) => response.status === "fulfilled").length, 1);
    assert.equal(responses.filter((response) => response.status === "rejected").length, 1);
    await fixture.terminal(); await sdk.refresh();
    assert.equal(sdk.getState().snapshot!.artifacts.length, 1);
    assert.equal(sdk.getState().snapshot!.questions[0]?.answer?.actor, "user");
    const forged = await fetch(`${fixture.service.connection.baseUrl}/v1/commands`, { method: "POST", headers: { Authorization: `Bearer ${fixture.service.connection.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: randomUUID(), profileId: "default", command: { type: "question.answer", questionId: question.id, expectedRevision: 1, text: question.choices[0]!, actor: "model" } }) });
    assert.equal(forged.status, 400);
  } finally { sdk.disconnect(); peer.disconnect(); await fixture.close(); }
});
test("stopping a waiting question propagates cancellation without deadlock, fake answers or a second model call", native, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("generated structured question");
    const question = await waitFor(() => sdk.getState().snapshot!.questions.find((question) => question.status === "open"));
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId });
    const session = await fixture.terminal(); await sdk.refresh();
    assert.notEqual(session.status, "completed"); assert.equal(fixture.requests.length, 1);
    assert.equal(sdk.getState().snapshot!.questions[0]?.status, "cancelled");
    assert.equal(sdk.getState().snapshot!.questions[0]?.answer, null); assert.equal(sdk.getState().snapshot!.artifacts.length, 0);
    await assert.rejects(() => sdk.questions.answer(question.id, question.choices[0]!, 0), /changed|cancelled|interrupted/i);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("answer retention can be disabled without losing canonical user provenance or enabling memory policy", native, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, artifacts: { retainAnswers: false } }, settings.revision);
    await fixture.configure(); await fixture.send("generated structured question");
    const question = await waitFor(() => sdk.getState().snapshot!.questions.find((question) => question.status === "open"));
    await sdk.questions.answer(question.id, question.choices[0]!, 0); await fixture.terminal(); await sdk.refresh();
    assert.equal(sdk.getState().snapshot!.questions[0]?.answer?.actor, "user"); assert.equal(sdk.getState().snapshot!.artifacts.length, 0);
    assert.equal(sdk.settings.get()!.values.memory.enabled, false);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("question relay respects explicit tool denial instead of using its routing policy as an approval bypass", native, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, permissions: { ...settings.values.permissions, tools: [{ id: "generated-deny-question", tool: "ask_user", decision: "deny", pathPrefix: "" }] } }, settings.revision);
    await fixture.configure(); await fixture.send("generated structured question"); await fixture.terminal(); await sdk.refresh();
    assert.equal(sdk.getState().snapshot!.questions.length, 0); assert.equal(sdk.getState().snapshot!.artifacts.length, 0);
    assert.ok(fixture.session().messages.some((message) => message.role === "tool" && message.outcome === "denied"));
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("project-free read-only conversations may ask a clarification without receiving filesystem or edit authority", native, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const created = await sdk.sessions.create(null, "Generated root-free clarification", { modelId: fixture.modelId });
    await sdk.sessions.mode(created.id!, "read-only");
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "generated structured question", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    const question = await waitFor(() => sdk.getState().snapshot!.questions.find((question) => question.sessionId === created.id && question.status === "open"));
    assert.equal(question.projectId, null);
    await sdk.questions.answer(question.id, question.choices[0]!, 0);
    await waitFor(() => sdk.getState().snapshot!.sessions.find((session) => session.id === created.id)?.status === "completed");
    const artifact = sdk.getState().snapshot!.artifacts.find((artifact) => artifact.questionId === question.id)!;
    assert.equal(artifact.projectId, null); assert.equal(sdk.getState().snapshot!.sessions.find((session) => session.id === created.id)?.mode, "read-only");
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("failed derived artifact commitment rolls back answer, draft clearing and receipt together", native, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("generated structured question");
    const question = await waitFor(() => sdk.getState().snapshot!.questions.find((question) => question.status === "open"));
    const text = "Generated atomically retained answer.";
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text, attachments: [] });
    const command = { type: "question.answer" as const, questionId: question.id, expectedRevision: 0, text, consumeDraft: { sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision } };
    fixture.service.store.db.exec("CREATE TRIGGER generated_fail_answer_artifact BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.event_type')='artifact.revised' BEGIN SELECT RAISE(ABORT,'Generated answer artifact failure'); END");
    try { await assert.rejects(() => sdk.command(command, "generated-atomic-answer-receipt")); }
    finally { fixture.service.store.db.exec("DROP TRIGGER generated_fail_answer_artifact"); }
    assert.equal(fixture.session().draft.text, text); assert.equal(fixture.session().pendingQuestionId, question.id);
    assert.equal(fixture.service.controller.snapshot().questions[0]?.status, "open");
    assert.equal(fixture.service.store.db.prepare("SELECT id FROM receipts WHERE id=?").get("generated-atomic-answer-receipt"), undefined);
    await sdk.command(command, "generated-atomic-answer-receipt"); await fixture.terminal();
    assert.equal(fixture.service.controller.snapshot().artifacts.length, 1); assert.equal(fixture.session().draft.text, "");
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("schema-10 state upgrades and interrupted question recovery never replay a prompt or accept a stale answer", async () => {
  const fixture = await setupFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const original = fixture.session(), questionId = randomUUID(), turnId = randomUUID(), stepId = randomUUID();
    await writeLegacyState(fixture.service, 10);
    const store = new EventStore(fixture.service.store.path, fixture.retentionKey);
    const question: UserQuestion = { id: questionId, sessionId: original.id, projectId: original.projectId, workspaceId: null, turnId, stepId, callId: "generated-recovery-question", modelId: fixture.modelId,
      question: "Generated interrupted question?", choices: ["Generated choice"], allowFreeform: false, sourceEventId: null, revision: 0, createdAt: "2026-01-01T00:00:00Z", status: "open", answer: null, diagnostic: null };
    store.commit([
      { event_type: "turn.started", profile_id: "default", project_id: original.projectId, session_id: original.id, turn_id: turnId, payload: { item: { id: randomUUID(), text: "Generated recovered question", attachments: [], delivery: "queue" }, controls: original.controls, policyRevision: 0 } },
      { event_type: "question.asked", profile_id: "default", project_id: original.projectId, session_id: original.id, turn_id: turnId, step_id: stepId, payload: { question } },
    ]);
    store.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    assert.equal(restarted.store.db.prepare("PRAGMA user_version").get()?.user_version, 17);
    assert.equal(restarted.controller.snapshot().settings.values.artifacts.retainAnswers, true);
    assert.equal(restarted.controller.snapshot().questions[0]?.status, "cancelled");
    assert.equal(restarted.controller.snapshot().sessions[0]?.status, "partial"); assert.equal(fixture.requests.length, 0);
    const sdk = await new MoguriSdk(restarted.connection).ready();
    try { await assert.rejects(() => sdk.questions.answer(questionId, "Generated choice", 1), /cancelled|interrupted/); }
    finally { sdk.disconnect(); }
  } finally { await restarted?.close(); await fixture.close(); }
});
