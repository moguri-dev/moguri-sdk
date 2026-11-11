import assert from "node:assert/strict";
import test from "node:test";
import { filterInboxAttention, isRecord, MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { scriptReviewFixture } from "./fixtures/script-review.ts";
import { profileFixture } from "./fixtures/profiles.ts";

test("notification search uses original question/error sources and type/read filters never answer or approve", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture({ respond: (request) => {
    const messages = Array.isArray(request.messages) ? request.messages.filter(isRecord) : [];
    const prompt = String(messages.findLast((message) => message.role === "user")?.content ?? "");
    return prompt.includes("complete") ? { text: "Generated completed task." } :
      { tool: { name: "ask_user", args: { question: "Choose the generated lighthouse approach?", choices: ["Keep", "Change"], allowFreeform: true } } };
  } });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  const send = async (id: string, text: string) => {
    const session = sdk.sessions.get(id)!;
    const saved = await sdk.command({ type: "draft.save", sessionId: id, expectedRevision: session.draft.revision, text, attachments: [] });
    await sdk.command({ type: "message.send", sessionId: id, expectedRevision: saved.revision!, delivery: "queue" });
  };
  try {
    await f.configure(); await f.send("Generated original question.");
    await waitFor(() => f.session().pendingQuestionId);
    const failed = await sdk.sessions.create(null, "Generated original provider error", { modelId: f.modelId });
    await send(failed.id!, "generated provider failure");
    await waitFor(() => sdk.sessions.get(failed.id!)?.status === "failed");
    const completed = await sdk.sessions.create(null, "Generated complete task", { modelId: f.modelId });
    await send(completed.id!, "Generated complete task.");
    await waitFor(() => sdk.sessions.get(completed.id!)?.status === "completed");
    await sdk.refresh();
    const question = sdk.getState().snapshot!.questions.find((entry) => entry.id === f.session().pendingQuestionId)!;
    assert.deepEqual(sdk.attention.list({ type: "question", query: "LIGHTHOUSE" }).map((entry) => entry.messageId), [question.id]);
    const errors = sdk.attention.list({ type: "failed", query: "unavailable provider" });
    assert.equal(errors.length, 1); assert.equal(errors[0]!.sessionId, failed.id);
    assert.equal(sdk.attention.list({ type: "completed", query: "complete task" }).length, 1);
    assert.equal(sdk.attention.list({ type: "script-review" }).length, 0);
    await sdk.attention.acknowledge([errors[0]!.id]);
    assert.deepEqual(sdk.attention.list({ state: "read" }).map((entry) => entry.id), [errors[0]!.id]);
    assert.equal(sdk.attention.list({ type: "failed", state: "unread" }).length, 0);
    assert.equal(f.service.controller.snapshot().questions.find((entry) => entry.id === question.id)?.status, "open");
    assert.equal(f.session().pendingQuestionId, question.id);
    assert.equal(sdk.attention.list({ query: "not-present-in-any-notification" }).length, 0);
    assert.throws(() => filterInboxAttention(sdk.getState().snapshot!, { query: "x".repeat(201) }), /notification|search|filter/i);
  } finally { sdk.disconnect(); await f.close(); }
});

test("notification filters never select another profile's actual question source", { skip: process.platform !== "darwin" }, async () => {
  const f = await profileFixture();
  try {
    const own = await f.sdk.sessions.create(null, "Generated scoped harbor question", { modelId: f.providers[0]!.modelId });
    await f.send(f.sdk, own.id!, "generated question");
    await waitFor(() => f.session(f.sdk, own.id!).status === "completed");
    const { client } = await f.create("Generated empty Inbox");
    assert.equal(f.sdk.attention.list({ query: "harbor", type: "question" }).length, 1);
    assert.deepEqual(client.attention.list({ query: "harbor", type: "question" }), []);
  } finally { await f.close(); }
});

test("script review filters match original paths and findings without approving or losing pending source records", { skip: process.platform !== "darwin" }, async () => {
  const f = await scriptReviewFixture({ autopilot: true, findings: ["Generated harbor marker only."] });
  try {
    await f.send("Generated notification source."); await f.terminal(); await f.sdk.refresh();
    const review = f.review()!, requests = f.requests.length;
    const before = structuredClone(review);
    const selected = f.sdk.attention.list({ type: "script-review", query: "generated-script.sh harbor" });
    assert.equal(selected.length, 1); assert.equal(selected[0]!.messageId, review.id);
    assert.equal(f.sdk.attention.list({ type: "question", query: "harbor" }).length, 0);
    assert.deepEqual(f.review(), before);
    assert.equal(f.requests.length, requests);
  } finally { await f.close(); }
});
