import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { defaultCompactionSettings, MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { EventStore, smartCompactionSchemaMarker } from "../apps/service/src/store.ts";
import { setupFixture, type GeneratedProviderOptions } from "./fixture.ts";
import { removeSmartCompactionFixtureMarker } from "./fixtures/legacy-state.ts";

const COMPACTOR = "read-only conversation compactor";
const detail = (repeat: number) => "Generated complete historical detail. ".repeat(repeat);

/** A fixed-model session whose history sits just below the default trigger (16,384-token window: 10,240 tokens). */
async function historyFixture() {
  const configuration: GeneratedProviderOptions = { responseMode: "text", contextWindow: 16384, maxOutputTokens: 128, replyText: "Generated original concise answer." };
  const fixture = await setupFixture(configuration), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, compaction: { ...defaultCompactionSettings(), automatic: false } }, settings.revision);
    let turns = 0;
    for (; turns < 12; turns++) {
      await fixture.send(`Generated retained source ${turns}. KEEP_THIS_ORIGINAL_SOURCE. ${detail(180)}`);
      const state = await fixture.terminal();
      if (state.status !== "completed") throw new Error(`Generated history failed before smart compaction: ${state.lastError}`);
      if ((state.usage.at(-1)?.contextEstimate ?? 0) >= 8600) break;
    }
    if (turns === 12) throw new Error("Generated history never approached the smart compaction trigger.");
    configuration.respond = (request) => ({ text: JSON.stringify(request).includes(COMPACTOR) ?
      "Generated smart summary: KEEP_THIS_ORIGINAL_SOURCE remains the user's constraint. Prior generated answers completed." :
      "Generated final answer after smart compaction." });
    const useDefaults = async () => { await sdk.settings.reset("compaction", sdk.settings.get()!.revision); };
    return { ...fixture, sdk, configuration, calls: fixture.requests.length, useDefaults, close: async () => { sdk.disconnect(); await fixture.close(); } };
  } catch (error) { sdk.disconnect(); await fixture.close(); throw error; }
}

test("smart compaction is on by default for fixed-model sessions and resumes from one metered, source-bound summary", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await historyFixture();
  try {
    await fixture.useDefaults();
    assert.equal(fixture.sdk.settings.get()!.values.compaction, undefined, "absent settings mean the factory default");
    await fixture.send(`Generated next task needing room. ${detail(250)}`); await fixture.terminal();
    assert.equal(fixture.session().status, "completed", fixture.session().lastError ?? "");
    const state = await fixture.sdk.compactions.state(fixture.sessionId), entry = state.compactions.find((entry) => entry.automatic)!;
    assert.equal(entry.status, "applied"); assert.equal(entry.automatic?.actor, "default-policy"); assert.equal(entry.automatic?.scope, "session-model");
    assert.equal(entry.modelId, fixture.modelId); assert.equal(state.activeId, entry.id);
    assert.ok(entry.afterTokens! < entry.beforeTokens); assert.ok(state.estimatedTokens < state.originalEstimatedTokens);
    assert.equal(fixture.requests.length, fixture.calls + 2, "one compactor call, then the solver");
    const compactor = fixture.requests[fixture.calls]!;
    assert.equal(compactor.tools, undefined); assert.ok(Number(compactor.max_tokens ?? compactor.max_completion_tokens) <= 128);
    const final = JSON.stringify(fixture.requests.at(-1));
    assert.match(final, /Generated smart summary/); assert.equal(final.includes("Generated retained source 0."), false);
    const calls = (await fixture.sdk.budgets.calls({ sessionId: fixture.sessionId, role: "compaction" })).calls;
    assert.equal(calls.length, 1); assert.equal(calls[0]?.status, "settled");
    assert.ok(fixture.session().messages.some((message) => message.role === "notice" && /Smart compaction replaced older turns/.test(message.text)));
    const page = await fixture.sdk.tools.history(fixture.sessionId, { throughSequence: entry.throughSeq, limitMessages: 1 });
    assert.match(page.text, /Generated retained source 0/);
    assert.match((await fixture.sdk.slash(fixture.sessionId, "/compact restore")).kind, /ok/);
    assert.equal((await fixture.sdk.compactions.state(fixture.sessionId)).activeId, null);
  } finally { await fixture.close(); }
});

test("turning smart compaction off keeps the original context and sends no compactor call", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await historyFixture();
  try {
    await fixture.send(`Generated next task without compaction. ${detail(150)}`); await fixture.terminal();
    assert.equal(fixture.session().status, "completed", fixture.session().lastError ?? "");
    assert.ok(fixture.session().usage.at(-1)!.contextEstimate! >= 10240, "the request crossed the default trigger");
    assert.equal(fixture.requests.length, fixture.calls + 1);
    assert.equal((await fixture.sdk.compactions.state(fixture.sessionId)).compactions.length, 0);
    assert.equal(JSON.stringify(fixture.requests.at(-1)).includes(COMPACTOR), false);
  } finally { await fixture.close(); }
});

test("a failed smart compaction keeps original context, holds unknown usage and backs off instead of paying again next turn", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await historyFixture();
  try {
    await fixture.useDefaults();
    fixture.configuration.omitUsage = true;
    await fixture.send(`Generated next task with unknown compactor usage. ${detail(150)}`); await fixture.terminal();
    const state = await fixture.sdk.compactions.state(fixture.sessionId), entry = state.compactions.find((entry) => entry.automatic)!;
    assert.equal(fixture.requests.length, fixture.calls + 1); assert.equal(entry.status, "partial"); assert.equal(state.activeId, null);
    assert.match(entry.diagnostic!, /usage|meter/i); assert.match(entry.diagnostic!, /send again to continue/);
    assert.equal((await fixture.sdk.budgets.calls({ sessionId: fixture.sessionId, role: "compaction" })).calls[0]?.status, "unknown");
    fixture.configuration.omitUsage = false;
    await fixture.send("Generated short follow-up."); await fixture.terminal();
    assert.equal(fixture.session().status, "completed", fixture.session().lastError ?? "");
    assert.equal(fixture.requests.length, fixture.calls + 2, "the follow-up used the original context without another compactor call");
    assert.equal(JSON.stringify(fixture.requests.at(-1)).includes(COMPACTOR), false);
    assert.equal((await fixture.sdk.compactions.state(fixture.sessionId)).compactions.length, 1);
  } finally { await fixture.close(); }
});

test("/compact applies one explicit metered summary on an idle chat, and /compact restore brings originals back", { skip: process.platform !== "darwin", timeout: 30_000 }, async () => {
  const fixture = await historyFixture();
  try {
    const result = await fixture.sdk.slash(fixture.sessionId, "/compact");
    assert.equal(result.kind, "ok"); assert.match(result.kind === "ok" ? result.message : "", /Compacting .* older messages with .*restore/);
    const settled = await fixture.terminal();
    assert.equal(settled.status, "completed", settled.lastError ?? "");
    const state = await fixture.sdk.compactions.state(fixture.sessionId), entry = state.compactions[0]!;
    assert.equal(entry.applyOnSuccess, true); assert.equal(entry.automatic, undefined);
    assert.equal(entry.status, "applied"); assert.equal(state.activeId, entry.id);
    assert.equal(fixture.requests.length, fixture.calls + 1);
    assert.ok(fixture.service.controller.events(0).some((event) => event.event_type === "context.changed" && event.payload.actor === "user" && event.payload.activeCompactionId === entry.id));
    await fixture.sdk.slash(fixture.sessionId, "/compact restore");
    const restored = await fixture.sdk.compactions.state(fixture.sessionId);
    assert.equal(restored.activeId, null); assert.equal(restored.estimatedTokens, restored.originalEstimatedTokens);
    await assert.rejects(() => fixture.sdk.slash(fixture.sessionId, "/compact restore"), /No compaction is active/);
  } finally { await fixture.close(); }
});

for (const change of ["upgrade", "missing", "premature", "history"] as const) {
  test(`smart compaction schema ${change} preserves original state`, { timeout: 30_000 }, async () => {
    const f = await setupFixture();
    try {
      if (change === "history") {
        const sdk = await new MoguriSdk(f.service.connection).ready();
        const settings = sdk.settings.get()!;
        await sdk.settings.update({ ...settings.values, compaction: { ...defaultCompactionSettings(), triggerFraction: 0.6 } }, settings.revision);
        sdk.disconnect();
      }
      await f.service.close();
      const path = f.service.store.path, raw = new DatabaseSync(path);
      try {
        if (change === "history") assert.throws(() => removeSmartCompactionFixtureMarker(new DatabaseSync(":memory:"), f.service.controller.events(0)), /genuine pre-110 history/);
        else if (change === "upgrade") removeSmartCompactionFixtureMarker(raw, f.service.controller.events(0));
        raw.exec(change === "missing" ? `DELETE FROM retention_metadata WHERE id='${smartCompactionSchemaMarker}'` :
          change === "history" ? `DELETE FROM retention_metadata WHERE id='${smartCompactionSchemaMarker}'; PRAGMA user_version=109` : "PRAGMA user_version=109");
      } finally { raw.close(); }
      if (change === "upgrade") {
        const reopened = new EventStore(path, f.retentionKey);
        try {
          assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
          assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(smartCompactionSchemaMarker)?.value, "1");
        } finally { reopened.close(); }
        return;
      }
      assert.throws(() => new EventStore(path, f.retentionKey),
        change === "missing" ? /Missing or invalid smart compaction schema marker/ : change === "premature" ? /Premature smart compaction schema marker/ : /pre-110 lineage/);
    } finally { await f.close(); }
  });
}
