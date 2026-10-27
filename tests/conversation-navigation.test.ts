import assert from "node:assert/strict";
import test from "node:test";
import * as sdk from "../packages/sdk/src/index.ts";
import type { PublicMessage, UserQuestion } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { startService } from "../apps/service/src/server.ts";
import { join } from "node:path";

const message = (id: string, role: PublicMessage["role"], text = "", turnId = "generated-turn"): PublicMessage =>
  ({ id, role, text, turnId, timestamp: "2026-01-01T00:00:00Z" });
const question = (changes: Partial<UserQuestion> = {}): UserQuestion => ({
  id: "generated-question", sessionId: "generated-session", projectId: null, workspaceId: null, turnId: "generated-turn",
  stepId: "generated-model", callId: "generated-call", modelId: "generated-fixture-model", sourceEventId: "generated-source",
  revision: 1, createdAt: "2025-01-01T00:00:00Z", status: "answered", question: "Generated approach?",
  choices: ["Generated first choice", "Generated second choice"], allowFreeform: false, diagnostic: null,
  answer: { text: "Generated second choice", actor: "user", modelId: null, sourceCallId: null, answeredAt: "2025-01-01T00:00:00Z" },
  ...changes,
});
const state = (messages: PublicMessage[], questions: UserQuestion[] = []) => ({
  profileId: "default", sessions: [{ id: "generated-session", messages }], questions,
});

test("conversation navigation uses original prompt order and exact actual-user question answers, not timestamps", () => {
  const snapshot = state([message("generated-prompt-1", "user", "Generated first prompt."), message("generated-model", "assistant"),
    message("generated-call", "tool", "Generated tool result."), message("generated-prompt-2", "user", "Generated second prompt.")], [question()]);
  const original = structuredClone(snapshot), entries = sdk.conversationNavigation(snapshot, "generated-session");
  assert.deepEqual(entries.map((entry) => entry.kind), ["prompt", "answer", "prompt"]);
  assert.deepEqual(entries.map((entry) => entry.messageIndex), [0, 1, 3]);
  assert.deepEqual(entries.map((entry) => entry.text), ["Generated first prompt.", "Generated approach?", "Generated second prompt."]);
  assert.equal(entries[1]?.kind === "answer" && entries[1].answer, "Generated second choice");
  assert.equal(entries[1]?.kind === "answer" && entries[1].questionId, "generated-question");
  assert.ok(entries.every((entry) => entry.profileId === "default" && entry.sessionId === "generated-session"));
  assert.equal(new Set(entries.map((entry) => entry.id)).size, 3);
  assert.deepEqual(snapshot, original);
});

test("permission results, delegated notices, open/cancelled questions and automated answers never become user navigation turns", () => {
  const base = question();
  const snapshot = state([message("generated-prompt", "user", "Generated actual prompt."), message("generated-model", "assistant"),
    message("generated-permission", "tool", '{"allow":true,"actor":"user"}'), message("generated-delegation", "notice", "Generated delegated message.")], [
    question({ id: "generated-open", status: "open", answer: null }),
    question({ id: "generated-cancelled", status: "cancelled" }),
    question({ id: "generated-model-answer", answer: { ...base.answer!, actor: "model" } }),
    question({ id: "generated-provider-answer", answer: { ...base.answer!, actor: "decision-provider" } }),
    question({ id: "generated-foreign", sessionId: "generated-other-session" }),
    question({ id: "generated-wrong-turn", turnId: "generated-other-turn" }),
    question({ id: "generated-wrong-step", stepId: "generated-absent-model" }),
  ]);
  assert.deepEqual(sdk.conversationNavigation(snapshot, "generated-session").map((entry) => entry.kind), ["prompt"]);
  assert.throws(() => sdk.conversationNavigation(snapshot, "generated-other-session"), /existing session/i);
});

test("repeated prompts, attachment-only prompts and actual custom answers keep distinct stable profile-scoped identities", () => {
  const snapshot = state([message("generated-prompt-1", "user", "Generated repeated prompt."), message("generated-prompt-2", "user", "Generated repeated prompt."),
    message("generated-attachment", "user"), message("generated-model", "assistant")], [question({ answer: { ...question().answer!, text: "Generated custom answer.\nPreserve its original text.", other: true } })]);
  const first = sdk.conversationNavigation(snapshot, "generated-session");
  assert.equal(first.length, 4); assert.equal(new Set(first.map((entry) => entry.id)).size, 4);
  assert.equal(first[2]?.text, "Attached context");
  assert.equal(first[3]?.kind === "answer" && first[3].answer, "Generated custom answer.\nPreserve its original text.");
  assert.deepEqual(sdk.conversationNavigation({ ...snapshot, sessions: [{ ...snapshot.sessions[0]!, messages: [...snapshot.sessions[0]!.messages, message("generated-stream", "assistant", "Generated streaming output.")] }] }, "generated-session"), first);
  assert.notDeepEqual(sdk.conversationNavigation({ ...snapshot, profileId: "generated-other-profile" }, "generated-session").map((entry) => entry.id), first.map((entry) => entry.id));
});

test("reused tool call IDs and private model notices cannot reorder or relabel actual user answers", () => {
  const snapshot = state([message("generated-prompt", "user", "Generated owning prompt."), message("generated-model", "assistant"),
    message("generated-later-model", "notice", "Generated model-role placeholder.")], [
    question({ id: "generated-later-question", stepId: "generated-later-model", question: "Generated later question?" }),
    question(),
  ]);
  const entries = sdk.conversationNavigation(snapshot, "generated-session");
  assert.deepEqual(entries.map((entry) => entry.text), ["Generated owning prompt.", "Generated approach?", "Generated later question?"]);
  assert.deepEqual(entries.map((entry) => entry.messageIndex), [0, 1, 2]);
});

test("navigation covers a long retained conversation without loading older activity pages", () => {
  const messages = Array.from({ length: 5000 }, (_, index) => message(`generated-long-prompt-${index}`, "user", `Generated retained navigation ${index}.`, `generated-long-turn-${index}`));
  const entries = sdk.conversationNavigation(state(messages), "generated-session");
  assert.equal(entries.length, 5000);
  assert.equal(entries[0]?.messageIndex, 0); assert.equal(entries.at(-1)?.messageIndex, 4999);
  assert.equal(new Set(entries.map((entry) => entry.id)).size, 5000);
});

test("the actual retained question and user choice are immediately navigable and survive restart without another model or permission", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture(), client = await new sdk.MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await fixture.configure(); await fixture.send("generated structured question choices only");
    const pending = await waitFor(() => client.getState().snapshot?.questions.find((entry) => entry.status === "open"));
    assert.deepEqual(sdk.conversationNavigation(client.getState().snapshot!, fixture.sessionId).map((entry) => entry.kind), ["prompt"]);
    await client.questions.answer(pending.id, pending.choices[1]!, pending.revision); await fixture.terminal(); await client.refresh();
    const original = sdk.conversationNavigation(client.getState().snapshot!, fixture.sessionId);
    assert.deepEqual(original.map((entry) => entry.kind), ["prompt", "answer"]);
    assert.equal(original[1]?.kind === "answer" && original[1].answer, pending.choices[1]);
    assert.equal(fixture.requests.length, 2); assert.deepEqual(client.settings.get()!.values.permissions.tools, []);
    client.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    assert.deepEqual(sdk.conversationNavigation(restarted.controller.snapshot(), fixture.sessionId), original);
    assert.equal(fixture.requests.length, 2);
  } finally { client.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("an actual automatically routed model question retains one user-answer point under its original public step", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ exposeModels: true }), client = await new sdk.MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    await client.routing.configure({ ...sdk.defaultKupoSettings(), enabled: true, allowHosted: true, classifierModelId: fixture.modelId, approvedModelIds: [fixture.modelId] }, client.settings.get()!.revision);
    await client.sessions.selectModel(fixture.sessionId, sdk.KUPO_MODEL_ID);
    await fixture.send("generated structured question choices only");
    const pending = await waitFor(() => client.getState().snapshot?.questions.find((entry) => entry.status === "open"));
    await client.questions.answer(pending.id, pending.choices[0]!, pending.revision); await fixture.terminal(); await client.refresh();
    const entries = sdk.conversationNavigation(client.getState().snapshot!, fixture.sessionId);
    assert.deepEqual(entries.map((entry) => entry.kind), ["prompt", "answer"]);
    assert.equal(entries[1]?.kind === "answer" && entries[1].answer, pending.choices[0]);
    assert.equal(entries[1]?.messageId, pending.stepId);
    assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
  } finally { client.disconnect(); await fixture.close(); }
});
