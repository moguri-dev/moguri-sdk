import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { MoguriSdk, parse, UserQuestionSchema, type UserQuestion } from "../packages/sdk/src/index.ts";
import { startService } from "../apps/service/src/server.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { profileFixture } from "./fixtures/profiles.ts";
import { writeLegacyState } from "./fixtures/legacy-state.ts";

const native = { skip: process.platform !== "darwin", timeout: 20_000 };
test("a model's recommendation schema cannot forge trusted advice provenance or a user answer", () => {
  assert.throws(() => parse(UserQuestionSchema, { question: "Generated forgery fixture?", choices: ["Generated offered"], allowFreeform: false,
    recommendation: { choiceIndex: 0, reason: "Generated reason", actor: "user", modelId: "forged" } }));
});

test("Guided offered-choice advice belongs to the actual solver step and waits for a different actual user answer without an extra call", native, async () => {
  const fixture = await setupFixture({ questionRecommendation: { choiceIndex: 1, reason: "Generated comparison favors the second offered approach." } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: fixture.modelId, autonomy: "Guided" });
    await fixture.send("generated structured question choices only");
    const question = await waitFor(() => sdk.getState().snapshot!.questions.find((question) => question.status === "open"));
    assert.equal(question.answer, null); assert.equal(fixture.session().status, "waiting_input"); assert.equal(fixture.requests.length, 1);
    assert.equal(question.recommendation?.actor, "model");
    assert.equal(question.recommendation?.choice, question.choices[1]);
    assert.equal(question.recommendation?.modelId, fixture.session().usage[0]?.modelId);
    assert.equal(question.recommendation?.stepId, question.stepId); assert.equal(question.recommendation?.callId, question.callId);
    assert.equal(fixture.service.controller.snapshot().budgetEntries.length, 1);
    await sdk.questions.answer(question.id, question.choices[0]!, question.revision); await fixture.terminal(); await sdk.refresh();
    assert.equal(fixture.requests.length, 2);
    const answered = sdk.getState().snapshot!.questions.find((value) => value.id === question.id)!;
    assert.equal(answered.answer?.actor, "user"); assert.equal(answered.answer?.text, question.choices[0]);
    assert.equal(answered.recommendation?.choice, question.choices[1]);
    const artifact = sdk.getState().snapshot!.artifacts.find((artifact) => artifact.questionId === question.id)!;
    const retained = await sdk.artifacts.read(artifact.id);
    assert.match(retained.text, /Model recommendation \(not a user answer\)/);
    assert.match(retained.text, /Generated comparison favors/);
    assert.deepEqual(artifact.sources.map((source) => source.actor), ["model", "user"]);
    assert.deepEqual(sdk.settings.get()!.values.permissions.tools, []);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("Guided recommendation input cannot invent an alternative or permission outside the user's selected mode", native, async () => {
  for (const [autonomy, choiceIndex, reason] of [["Guided", 7, "Generated unavailable choice."], ["Manual", 1, "Generated unsolicited typed advice."], ["Guided", 1, " ".repeat(10)]] as const) {
    const fixture = await setupFixture({ questionRecommendation: { choiceIndex, reason } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
    try {
      await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: fixture.modelId, autonomy });
      await fixture.send("generated structured question"); await fixture.terminal(); await sdk.refresh();
      assert.equal(sdk.getState().snapshot!.questions.length, 0);
      assert.equal(sdk.getState().snapshot!.artifacts.length, 0);
      assert.ok(fixture.session().messages.some((message) => message.role === "tool" && message.outcome === "failed" && /Guided recommendations/.test(message.text)));
      assert.deepEqual(sdk.settings.get()!.values.permissions.tools, []);
    } finally { sdk.disconnect(); await fixture.close(); }
  }
});

test("an open-ended question cannot manufacture a recommended user-only fact", native, async () => {
  const fixture = await setupFixture({ questionChoices: [], questionRecommendation: { choiceIndex: 0, reason: "Generated ungrounded fact." } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: fixture.modelId, autonomy: "Guided" });
    await fixture.send("generated structured question"); await fixture.terminal(); await sdk.refresh();
    assert.equal(sdk.getState().snapshot!.questions.length, 0);
    assert.equal(sdk.getState().snapshot!.artifacts.length, 0);
    assert.ok(fixture.session().messages.some((message) => message.role === "tool" && /actual offered alternative/.test(message.text)));
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("Guided tool advice is exact-step model text, not approval, and still requires the actual user's decision", native, async () => {
  const fixture = await setupFixture({ toolAdvice: "Generated current solver advice: reading the requested fixture is useful." }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: fixture.modelId, autonomy: "Guided" });
    await fixture.send("generated tool guided approval");
    const approval = await waitFor(() => fixture.session().pendingApproval);
    assert.equal(approval.recommendation, "Generated current solver advice: reading the requested fixture is useful.");
    assert.equal(approval.recommendationSource?.actor, "model");
    assert.equal(approval.recommendationSource?.stepId, approval.stepId);
    assert.equal(approval.recommendationSource?.callId, approval.call.id);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
    assert.equal(fixture.requests.length, 1);
    await sdk.command({ type: "approval.respond", sessionId: fixture.sessionId, approvalId: approval.id, allow: false }); await fixture.terminal();
    assert.ok(fixture.service.controller.events(0).some((event) => event.event_type === "tool.decided" && event.payload.approvalId === approval.id && event.payload.actor === "user" && !event.payload.allow));
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("an older assistant message cannot masquerade as current-step Guided approval advice", native, async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: fixture.modelId, autonomy: "Guided" });
    await fixture.send("Generated prior completed explanation."); await fixture.terminal();
    assert.ok(fixture.session().messages.some((message) => message.role === "assistant" && message.text));
    await fixture.send("generated tool without current narration");
    const approval = await waitFor(() => fixture.session().pendingApproval);
    assert.equal(approval.recommendation, undefined); assert.equal(approval.recommendationSource, undefined);
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); await fixture.terminal();
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("stopping a Guided question preserves advice provenance but never fabricates its answer", native, async () => {
  const fixture = await setupFixture({ questionRecommendation: { choiceIndex: 0, reason: "Generated stop fixture advice." } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: fixture.modelId, autonomy: "Guided" });
    await fixture.send("generated structured question");
    const question = await waitFor(() => sdk.getState().snapshot!.questions.find((question) => question.status === "open"));
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); await fixture.terminal(); await sdk.refresh();
    const stopped = sdk.getState().snapshot!.questions.find((value) => value.id === question.id)!;
    assert.equal(stopped.status, "cancelled"); assert.equal(stopped.answer, null);
    assert.equal(stopped.recommendation?.actor, "model"); assert.equal(fixture.requests.length, 1);
    assert.equal(sdk.getState().snapshot!.artifacts.length, 0);
    await assert.rejects(() => sdk.questions.answer(question.id, stopped.recommendation!.choice, stopped.revision), /cancelled|interrupted/);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("schema 14 upgrades both profiles without changing encrypted grants, receipts or legacy question identity", async () => {
  const fixture = await profileFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const { client: beta, profile } = await fixture.create("Generated advice migration Beta");
    const first = await fixture.sdk.sessions.create(null, "Generated Default advice migration"), second = await beta.sessions.create(null, "Generated Beta advice migration");
    const document = await beta.artifacts.create(second.id!, { kind: "decision", name: "Generated scoped legacy note", text: "Generated retained Beta legacy bytes." });
    const control = await fixture.service.profiles.control(profile.id), questionId = randomUUID();
    const question: UserQuestion = { id: questionId, sessionId: second.id!, projectId: null, workspaceId: null, turnId: randomUUID(), stepId: randomUUID(), callId: "generated-legacy-advice", modelId: fixture.providers[1]!.modelId,
      question: "Generated legacy question?", choices: ["Generated legacy choice"], allowFreeform: false, sourceEventId: null, revision: 0, createdAt: "2026-01-01T00:00:00Z", status: "open", answer: null, diagnostic: null };
    control.store.commit([{ event_type: "question.asked", profile_id: profile.id, session_id: second.id!, payload: { question } },
      { event_type: "question.cancelled", profile_id: profile.id, session_id: second.id!, payload: { questionId, diagnostic: "Generated legacy cancellation." } }]);
    for (const client of fixture.clients) client.disconnect();
    await writeLegacyState(fixture.service, 14);
    const legacy = new DatabaseSync(fixture.service.store.path);
    const rows = legacy.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), receipts = legacy.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all();
    legacy.close();
    restarted = await startService(fixture.options);
    const current = await new MoguriSdk(restarted.connection).ready(), scoped = await current.profiles.open(profile.id);
    try {
      assert.equal(restarted.store.db.prepare("PRAGMA user_version").get()?.user_version, 16);
      assert.deepEqual(restarted.store.db.prepare("SELECT seq,id,data,payload FROM events WHERE seq<=? ORDER BY seq").all(Number(rows.at(-1)!.seq)), rows);
      assert.deepEqual(restarted.store.db.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all(), receipts);
      assert.equal(current.getState().snapshot!.sessions[0]?.id, first.id);
      assert.equal(current.getState().snapshot!.questions.length, 0);
      assert.equal(scoped.getState().snapshot!.questions[0]?.id, questionId);
      assert.equal(scoped.getState().snapshot!.questions[0]?.recommendation, null);
      assert.equal((await scoped.artifacts.read(document.id!)).text, "Generated retained Beta legacy bytes.");
      assert.equal(fixture.providers.reduce((sum, provider) => sum + provider.requests.length, 0), 0);
    } finally { current.disconnect(); scoped.disconnect(); }
  } finally { await restarted?.close(); await fixture.close(); }
});

test("a failed Guided-advice migration preserves schema-14 metadata and reopens without deleting state", async () => {
  const fixture = await setupFixture();
  let upgraded: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await writeLegacyState(fixture.service, 14);
    const legacy = new DatabaseSync(fixture.service.store.path);
    const rows = legacy.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), receipts = legacy.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all();
    legacy.exec(`CREATE TRIGGER generated_guidance_migration_failure BEFORE INSERT ON retention_metadata
      WHEN NEW.id='guided_advice_schema' BEGIN SELECT RAISE(ABORT,'Generated guidance migration failure'); END;`);
    legacy.close();
    const options = { stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey };
    await assert.rejects(() => startService(options), /Generated guidance migration failure/);
    const preserved = new DatabaseSync(fixture.service.store.path);
    try {
      assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 14);
      assert.deepEqual(preserved.prepare("SELECT seq,id,data,payload FROM events ORDER BY seq").all(), rows);
      assert.deepEqual(preserved.prepare("SELECT * FROM receipts ORDER BY profile_id,id").all(), receipts);
      preserved.exec("DROP TRIGGER generated_guidance_migration_failure");
    } finally { preserved.close(); }
    upgraded = await startService(options);
    assert.equal(upgraded.store.db.prepare("PRAGMA user_version").get()?.user_version, 16);
    assert.equal(upgraded.controller.snapshot().sessions[0]?.id, fixture.sessionId);
    assert.equal(fixture.requests.length, 0);
  } finally { await upgraded?.close(); await fixture.close(); }
});
