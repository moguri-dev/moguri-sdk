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
