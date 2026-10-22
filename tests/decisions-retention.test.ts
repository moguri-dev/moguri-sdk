import assert from "node:assert/strict";
import { test } from "node:test";
import { EventStore } from "../apps/service/src/store.ts";
import { projectEvents } from "../packages/sdk/src/index.ts";
import { setupDecisions } from "./fixtures/decisions-api.ts";

test("decision requests, actual role inputs/results, actor and charges export independently and survive source deletion plus actual store reopen", { skip: process.platform !== "darwin", timeout: 15000 }, async () => {
  const f = await setupDecisions();
  try {
    await f.send("generated tool independent retained decision"); await f.terminal(); await f.sdk.refresh();
    const record = f.sdk.decisions.list(f.sessionId)[0]; assert.ok(record);
    const original = await f.sdk.decisions.read(record.id), exported = await f.sdk.artifacts.export(record.id), text = exported.export.text;
    assert.equal(JSON.parse(text).schemaVersion, 9);
    assert.ok(text.includes('"decision.recorded"')); assert.ok(text.includes(record.actualInputDigest!));
    assert.ok(text.includes(record.resultDigest!)); assert.ok(text.includes(record.adviceDigest!)); assert.ok(text.includes('"decision-provider"'));
    await f.sdk.sessions.delete(f.sessionId, true);
    assert.deepEqual((await f.sdk.decisions.read(record.id)).input, original.input);
    assert.equal((await f.sdk.decisions.read(record.id)).result, original.result);
    assert.equal((await f.sdk.budgets.dashboard()).totals.calls, 3);
    const path = f.service.store.path; f.sdk.disconnect(); await f.service.close();
    const reopened = new EventStore(path, f.retentionKey);
    try {
      const snapshot = projectEvents(reopened.events());
      assert.equal(snapshot.sessions.some((session) => session.id === f.sessionId), false);
      assert.equal(snapshot.decisions.find((entry) => entry.id === record.id)?.status, "applied");
      assert.equal(reopened.blob(record.inputDigest), JSON.stringify(original.input));
      assert.equal(reopened.blob(record.resultDigest!), original.result);
      assert.equal(JSON.parse(reopened.blob(record.adviceDigest!)).answers.action.choice, "allow");
      assert.equal(snapshot.budgetEntries.filter((entry) => entry.ownerSessionId === f.sessionId).length, 3);
    } finally { reopened.close(); }
  } finally { await f.close(); }
});

test("an independently retained automated answer keeps canonical original decision evidence and its non-user actor after both report and source deletion", { skip: process.platform !== "darwin", timeout: 15000 }, async () => {
  const f = await setupDecisions({ advice: { replyText: JSON.stringify({ answers: { action: { type: "choice", choice: "option1", confidence: 0.98,
    probabilities: { option0: 0.01, option1: 0.98, askUser: 0.01 } } } }) } });
  try {
    const settings = structuredClone(f.sdk.settings.get()!.values);
    settings.decisions.technicalQuestions = [{ id: "generated-retained-technical", kind: "technical-choice", question: "Choose a generated fixture approach?",
      choices: ["Generated first choice", "Generated second choice"] }];
    settings.artifacts.retainAnswers = true; await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision);
    await f.send("generated structured question choices only"); await f.terminal(); await f.sdk.refresh();
    const record = f.sdk.decisions.list(f.sessionId)[0], artifact = f.service.controller.snapshot().artifacts.find((artifact) => artifact.kind === "answer"); assert.ok(record && artifact);
    const source = artifact.sources.find((source) => source.actor === "decision-provider");
    assert.ok(source?.decisionOrigin); assert.equal(source.decisionOrigin.decisionId, record.id); assert.equal(source.decisionOrigin.stepId, record.stepId);
    const raw = (await f.sdk.decisions.read(record.id)).result;
    await f.sdk.artifacts.delete(record.id, 0, true); await f.sdk.sessions.delete(f.sessionId, true);
    await assert.rejects(f.sdk.decisions.read(record.id), { code: "decision_missing" });
    const retained = await f.sdk.artifacts.read(artifact.id); assert.equal(retained.artifact.sources.at(-1)?.actor, "decision-provider");
    const exported = JSON.parse((await f.sdk.artifacts.export(artifact.id)).export.text);
    assert.equal(exported.schemaVersion, 9); assert.ok(exported.documents[0].decisionEvidence[0].results.some((entry: { digest: string; text: string }) => entry.digest === record.resultDigest && entry.text === raw));
    const path = f.service.store.path; f.sdk.disconnect(); await f.service.close(); const reopened = new EventStore(path, f.retentionKey);
    try {
      assert.equal(reopened.blob(source.decisionOrigin.resultDigest), raw);
      assert.ok(reopened.blob(source.decisionOrigin.inputDigest).includes('"technical-choice"'));
      assert.equal(projectEvents(reopened.events()).artifacts.find((entry) => entry.id === artifact.id)?.sources.at(-1)?.actor, "decision-provider");
    } finally { reopened.close(); }
  } finally { await f.close(); }
});
