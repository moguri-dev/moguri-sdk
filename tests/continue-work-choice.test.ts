import assert from "node:assert/strict";
import test from "node:test";
import { githubApplicationFixture } from "./github-workflows-fixture.ts";
import { fixtureProvider, waitFor } from "./fixture.ts";
import { DraftEditor } from "../packages/sdk/src/index.ts";

test("a continue-work draft requires an actual per-request route choice before consumption or model admission", async () => {
  const provider = await fixtureProvider({ responseMode: "text" }), fixture = await githubApplicationFixture({ provider: provider.provider, ownedNetwork: true });
  try {
    await fixture.sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: provider.modelId });
    await fixture.sdk.issues.create(fixture.projectId, { title: "Generated selectable task", body: "", kind: "feature", phaseId: "backlog", pullRequestUrl: null });
    await fixture.sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "continue work", attachments: [] });
    const before = fixture.service.controller.events(0);
    await assert.rejects(() => fixture.sdk.command({ type: "message.send", sessionId: fixture.sessionId,
      expectedRevision: fixture.session().draft.revision, delivery: "queue" }), { code: "continue_work_choice_required" });
    assert.equal(fixture.session().draft.text, "continue work");
    assert.deepEqual(fixture.service.controller.events(0), before);
    assert.equal(fixture.service.controller.snapshot().projectWorkRuns.length, 0);
    assert.equal(provider.requests.length, 0);
  } finally { await fixture.close(); await provider.close(); }
});

test("shared slash handling returns a typed per-request choice instead of dispatching a task or dropping an existing draft", { skip: process.platform !== "darwin" }, async () => {
  const provider = await fixtureProvider({ responseMode: "text" }), fixture = await githubApplicationFixture({ provider: provider.provider, ownedNetwork: true });
  try {
    await fixture.sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: provider.modelId });
    const result = await fixture.sdk.slash(fixture.sessionId, "/continue-work", "cli");
    assert.equal(result.kind, "continue-work");
    assert.equal(fixture.session().draft.text, "/continue-work");
    assert.equal(provider.requests.length, 0); assert.equal(fixture.service.controller.snapshot().projectWorkRuns.length, 0);
    if (result.kind !== "continue-work") throw new Error("The shared route review was not returned.");
    await fixture.sdk.kanban.choose(result.review, "prompt");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === fixture.sessionId)?.status === "completed");
    assert.equal(provider.requests.length, 1);
    assert.ok(fixture.session().messages.some((message) => message.role === "user" && message.text === "/continue-work"));
    await fixture.sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Generated different retained draft.", attachments: [] });
    await assert.rejects(() => fixture.sdk.slash(fixture.sessionId, "/continue-work", "cli"), { code: "continue_work_draft" });
    assert.equal(fixture.session().draft.text, "Generated different retained draft.");
  } finally { await fixture.close(); await provider.close(); }
});

test("an editor's route review binds its exact draft revision and immutable profile", async () => {
  const provider = await fixtureProvider({ responseMode: "text" }), fixture = await githubApplicationFixture({ provider: provider.provider, ownedNetwork: true });
  const editor = new DraftEditor(fixture.sdk, fixture.sessionId, fixture.session().draft);
  try {
    editor.edit("continue work"); const review = await editor.reviewContinueWork();
    editor.edit("Generated replacement text."); await editor.flush();
    await assert.rejects(() => editor.chooseContinueWork(review, "kanban"), { code: "continue_work_stale" });
    assert.equal(editor.getState().text, "Generated replacement text.");
    assert.throws(() => fixture.sdk.kanban.choose({ ...review, profileId: "generated-foreign-profile" }, "prompt"), { code: "continue_work_stale" });
    assert.equal(provider.requests.length, 0);
  } finally { editor.dispose(); await fixture.close(); await provider.close(); }
});

test("choosing the model sends the exact prompt normally and never remembers a Kanban routing preference", { skip: process.platform !== "darwin" }, async () => {
  const provider = await fixtureProvider({ responseMode: "text" }), fixture = await githubApplicationFixture({ provider: provider.provider, ownedNetwork: true });
  try {
    await fixture.sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: provider.modelId });
    await fixture.sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "Continue work.", attachments: [] });
    await fixture.sdk.command({ type: "message.send", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, delivery: "queue", continueWorkChoice: "prompt" });
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === fixture.sessionId)?.status === "completed");
    assert.equal(provider.requests.length, 1);
    assert.equal(fixture.service.controller.snapshot().projectWorkRuns.length, 0);
    assert.ok(fixture.session().messages.some((message) => message.role === "user" && message.text === "Continue work."));
    const choices = fixture.service.controller.events(0).filter((event) => event.event_type === "session.continue_work_chosen");
    assert.equal(choices.length, 1);
    assert.equal(choices[0]?.event_type === "session.continue_work_chosen" && choices[0].payload.actor, "user");
    await fixture.sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "continue work", attachments: [] });
    await assert.rejects(() => fixture.sdk.command({ type: "message.send", sessionId: fixture.sessionId,
      expectedRevision: fixture.session().draft.revision, delivery: "queue" }), { code: "continue_work_choice_required" });
    assert.equal(provider.requests.length, 1); assert.equal(fixture.session().draft.text, "continue work");
  } finally { await fixture.close(); await provider.close(); }
});

test("a stale route answer cannot consume a newer draft, and held text never becomes a work delegation", async () => {
  const provider = await fixtureProvider({ responseMode: "text" }), fixture = await githubApplicationFixture({ provider: provider.provider, ownedNetwork: true });
  try {
    await fixture.sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: provider.modelId });
    await fixture.sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "continue work", attachments: [] });
    const revision = fixture.session().draft.revision;
    await fixture.sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: revision, text: "Generated newer draft.", attachments: [] });
    await assert.rejects(() => fixture.sdk.command({ type: "message.send", sessionId: fixture.sessionId,
      expectedRevision: revision, delivery: "queue", continueWorkChoice: "kanban" }), { code: "revision_conflict" });
    assert.equal(fixture.session().draft.text, "Generated newer draft.");
    await fixture.sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, text: "continue work", attachments: [] });
    await fixture.sdk.command({ type: "message.send", sessionId: fixture.sessionId, expectedRevision: fixture.session().draft.revision, delivery: "queue", held: true });
    assert.equal(fixture.session().queue[0]?.text, "continue work");
    assert.equal(fixture.service.controller.snapshot().projectWorkRuns.length, 0);
    assert.equal(provider.requests.length, 0);
  } finally { await fixture.close(); await provider.close(); }
});
