import assert from "node:assert/strict";
import test from "node:test";
import { join, resolve } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { startService } from "../apps/service/src/server.ts";
import { recoverCachedUsage, RetainedTelemetry, retainedSessionTelemetry } from "../apps/service/src/retained-telemetry.ts";

test("the chat snapshot already contains original turn, cache, context and cost information without a detail query", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text", usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42, prompt_tokens_details: { cached_tokens: 10 } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated retained telemetry input."); await fixture.terminal(); await sdk.refresh();
    const saved = sdk.getState().snapshot?.sessionTelemetry?.[fixture.sessionId];
    assert.ok(saved, "Original chat telemetry must arrive with the retained session snapshot, before any info popover is opened.");
    assert.equal(saved.sessionId, fixture.sessionId);
    assert.equal(saved.budget?.totals.cacheReadTokens, 10);
    assert.equal(saved.turns.length, 1);
    assert.equal(saved.turns[0]?.outcome, "completed");
    assert.equal(saved.turns[0]?.usage.inputTokens, 30);
    assert.equal(saved.turns[0]?.usage.outputTokens, 12);
    assert.equal(saved.turns[0]?.usage.cacheReadTokens, 10);
    assert.equal(saved.context?.window, fixture.session().usage[0]?.contextWindow);
    assert.equal(saved.context?.modelId, fixture.modelId);
    assert.equal(fixture.requests.length, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("saved turn, cache and context data survive disconnect, chat reopen and an actual service restart without another model call", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text", usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42, prompt_tokens_details: { cached_tokens: 10 } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  let reopened: MoguriSdk | undefined, restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await fixture.configure(); await fixture.send("Generated persistent turn telemetry."); await fixture.terminal(); await sdk.refresh();
    const original = sdk.getState().snapshot?.sessionTelemetry?.[fixture.sessionId];
    assert.ok(original);
    sdk.disconnect();
    reopened = await new MoguriSdk(fixture.service.connection).ready();
    assert.deepEqual(reopened.getState().snapshot?.sessionTelemetry?.[fixture.sessionId]?.turns, original.turns);
    reopened.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    reopened = await new MoguriSdk(restarted.connection).ready();
    const restored = reopened.getState().snapshot?.sessionTelemetry?.[fixture.sessionId];
    assert.deepEqual(restored?.turns, original.turns);
    assert.deepEqual(restored?.context, original.context);
    assert.deepEqual(restored?.estimate, original.estimate);
    assert.equal(restored?.budget?.totals.cacheReadTokens, 10);
    assert.equal(fixture.requests.length, 1);
  } finally { sdk.disconnect(); reopened?.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("a running call does not hide cached tokens already reported by earlier calls", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ respond: (_request, index) => index === 1 ? { text: "Generated completed cached call." } : { hold: true },
    usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42, prompt_tokens_details: { cached_tokens: 10 } } });
  try {
    await fixture.configure(); await fixture.send("Generated completed cached telemetry."); await fixture.terminal();
    await fixture.send("Generated held telemetry call."); await waitFor(() => fixture.requests.length === 2);
    const saved = fixture.service.controller.snapshot().sessionTelemetry?.[fixture.sessionId];
    assert.equal(saved?.budget?.totals.cacheReadTokens, null);
    assert.equal(saved?.budget?.totals.knownCacheReadTokens, 10);
    assert.equal(saved?.budget?.totals.unknownCacheReadCalls, 1);
  } finally { await fixture.close(); }
});

test("positive provider-normalized cached tokens survive missing transport presence metadata", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ workerPath: resolve("tests/fixtures/cache-presence-worker.ts"), responseMode: "text",
    usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42, prompt_tokens_details: { cached_tokens: 10 } } });
  try {
    await fixture.configure(); await fixture.send("Generated normalized cached usage."); await fixture.terminal();
    assert.equal(fixture.session().usage[0]?.cacheReadTokens, 10);
    assert.equal(fixture.service.controller.snapshot().budgetEntries[0]?.cacheReadTokens, 10);
    assert.equal(fixture.requests.length, 1);
  } finally { await fixture.close(); }
});

test("streaming output and captured-rate estimates are saved while reported usage and reservations remain distinct", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ stream: { chunks: ["Generated first saved fragment. ", "Generated second saved fragment. ", "Generated final saved fragment."], delayMs: 180 } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, budgets: { ...settings.values.budgets, rates: [{ modelId: fixture.modelId,
      inputUsdPerMillion: 1, outputUsdPerMillion: 2, effectiveAt: new Date().toISOString().slice(0, 10), source: "user-estimate" }] } }, settings.revision);
    await fixture.configure(); await fixture.send("Generated live saved telemetry.");
    await waitFor(() => fixture.session().messages.some((message) => message.role === "assistant" && message.text.includes("Generated first saved fragment.")));
    const saved = fixture.service.controller.snapshot().sessionTelemetry?.[fixture.sessionId];
    assert.ok(saved?.context?.outputEstimate && saved.context.outputEstimate > 0, "Streamed output estimates must already be saved before completion.");
    assert.ok(saved.estimate?.outputTokens !== null && saved.estimate?.outputTokens !== undefined && saved.estimate.outputTokens > 0);
    assert.ok(saved.estimate.estimatedUsd !== null && saved.estimate.estimatedUsd > 0);
    assert.equal(saved.budget?.totals.outputTokens, null);
    assert.equal(fixture.service.controller.snapshot().budgetEntries[0]?.status, "reserved");
    const delta = fixture.service.controller.events(0).find((event) => event.event_type === "assistant.delta");
    assert.ok(delta?.event_type === "assistant.delta" && delta.payload.text.includes("Generated first saved fragment."));
    await fixture.terminal(); await sdk.refresh();
    const completed = sdk.getState().snapshot?.sessionTelemetry?.[fixture.sessionId];
    assert.equal(completed?.budget?.totals.outputTokens, 12);
    assert.equal(completed?.estimate?.outputTokens, 12);
    assert.equal(completed?.estimate?.estimatedCalls, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("restart recovers a legacy discarded positive cache count only from its exact retained model result and never repeats recovery", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ workerPath: resolve("tests/fixtures/cache-presence-worker.ts"), responseMode: "text",
    usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42, prompt_tokens_details: { cached_tokens: 10 } } });
  const originalCommit = fixture.service.store.commit.bind(fixture.service.store);
  fixture.service.store.commit = (events, ...rest) => originalCommit(events.map((event) => event.event_type === "model.completed" ?
    { ...event, payload: { ...event.payload, usage: { ...event.payload.usage, cacheReadTokens: null, cacheWriteTokens: null } } } : event), ...rest);
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined;
  try {
    await fixture.configure(); await fixture.send("Generated legacy lost cache metadata."); await fixture.terminal();
    assert.equal(fixture.session().usage[0]?.cacheReadTokens, null);
    assert.equal(fixture.service.controller.snapshot().budgetEntries[0]?.cacheReadTokens, null);
    fixture.service.store.commit = originalCommit; await fixture.service.close();
    const options = { stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey };
    restarted = await startService(options); sdk = await new MoguriSdk(restarted.connection).ready();
    const saved = sdk.getState().snapshot?.sessionTelemetry[fixture.sessionId];
    assert.equal(saved?.budget?.totals.cacheReadTokens, 10);
    assert.equal(saved?.turns[0]?.usage.cacheReadTokens, 10);
    assert.equal(restarted.controller.snapshot().budgetEntries[0]?.reportedTokens, 42);
    assert.equal(restarted.controller.snapshot().budgetEntries[0]?.status, "settled");
    const count = restarted.controller.events(0).filter((event) => event.event_type === "budget.recorded").length;
    sdk.disconnect(); await restarted.close(); restarted = await startService(options);
    assert.equal(restarted.controller.events(0).filter((event) => event.event_type === "budget.recorded").length, count);
    assert.equal(fixture.requests.length, 1);
  } finally { fixture.service.store.commit = originalCommit; sdk?.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("reported zero cache and absent cache remain distinct in saved chat and owning-turn totals", { skip: process.platform !== "darwin" }, async (t) => {
  for (const reported of [true, false]) await t.test(reported ? "explicit zero" : "not reported", async () => {
    const fixture = await setupFixture({ responseMode: "text", usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42,
      ...(reported ? { prompt_tokens_details: { cached_tokens: 0 } } : {}) } });
    try {
      await fixture.configure(); await fixture.send("Generated zero versus missing cache."); await fixture.terminal();
      const saved = fixture.service.controller.snapshot().sessionTelemetry[fixture.sessionId]!;
      assert.equal(saved.budget?.totals.cacheReadTokens, reported ? 0 : null);
      assert.equal(saved.budget?.totals.unknownCacheReadCalls, reported ? 0 : 1);
      assert.equal(saved.turns[0]?.usage.cacheReadTokens, reported ? 0 : null);
      assert.equal(saved.turns[0]?.usage.cacheWriteTokens, null);
    } finally { await fixture.close(); }
  });
});

test("stopping an unreported stream preserves the last saved estimate and unknown reservation through restart without replay", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ respond: () => ({ hold: true, text: "Generated retained partial output." }) });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await fixture.configure(); await fixture.send("Generated partial telemetry.");
    await waitFor(() => fixture.session().messages.some((message) => message.role === "assistant" && message.text.includes("Generated retained partial output.")));
    const live = fixture.service.controller.snapshot().sessionTelemetry[fixture.sessionId]!;
    assert.ok(live.estimate?.outputTokens && live.estimate.outputTokens > 0);
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); await fixture.terminal();
    const stopped = fixture.service.controller.snapshot(), saved = stopped.sessionTelemetry[fixture.sessionId]!;
    assert.equal(stopped.budgetEntries[0]?.status, "unknown");
    assert.equal(saved.budget?.totals.outputTokens, null);
    assert.equal(saved.budget?.totals.cacheReadTokens, null);
    assert.equal(saved.estimate?.outputTokens, live.estimate.outputTokens);
    assert.equal(saved.turns[0]?.outcome, "stopped");
    assert.ok(saved.budget?.totals.heldTokens && saved.budget.totals.heldTokens > 0);
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const reopened = restarted.controller.snapshot().sessionTelemetry[fixture.sessionId]!;
    assert.deepEqual(reopened.estimate, saved.estimate);
    assert.deepEqual(reopened.context, saved.context);
    assert.deepEqual(reopened.turns, saved.turns);
    assert.equal(reopened.budget?.totals.heldTokens, saved.budget.totals.heldTokens);
    assert.equal(fixture.requests.length, 1);
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("cache recovery refuses mismatched model evidence, absent reports, changed totals and deleted source sessions", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text",
    usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42, prompt_tokens_details: { cached_tokens: 10 } } });
  try {
    await fixture.configure(); await fixture.send("Generated exact original cache evidence."); await fixture.terminal();
    const snapshot = structuredClone(fixture.service.controller.snapshot()), history = fixture.service.controller.events(0);
    snapshot.budgetEntries[0]!.cacheReadTokens = null;
    const read = (hash: string) => fixture.service.store.blob(hash);
    assert.equal(recoverCachedUsage(snapshot, history, read).length, 1);
    assert.deepEqual(recoverCachedUsage(snapshot, history, (hash) => {
      const source = JSON.parse(read(hash)); source.model = "generated-other-model"; return JSON.stringify(source);
    }), []);
    const changed = structuredClone(snapshot); changed.budgetEntries[0]!.reportedTokens = 43;
    assert.deepEqual(recoverCachedUsage(changed, history, read), []);
    const unreported = structuredClone(snapshot); unreported.budgetEntries[0]!.status = "unknown";
    assert.deepEqual(recoverCachedUsage(unreported, history, read), []);
    const deleted = structuredClone(snapshot); deleted.sessions = [];
    assert.deepEqual(recoverCachedUsage(deleted, history, () => { throw new Error("Deleted source bytes must not be read."); }), []);
  } finally { await fixture.close(); }
});

test("saved turns retain every model group beyond dashboard pagination and reuse unchanged snapshot views", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text" });
  try {
    await fixture.configure(); await fixture.send("Generated complete owning-turn groups."); await fixture.terminal();
    const snapshot = structuredClone(fixture.service.controller.snapshot()), history = fixture.service.controller.events(0), original = snapshot.budgetEntries[0]!;
    snapshot.budgetEntries = Array.from({ length: 61 }, (_, index) => ({ ...original, id: `generated-group-step-${index}`, modelId: `generated-group-model-${index}` }));
    const saved = retainedSessionTelemetry(snapshot, history)[fixture.sessionId]!;
    assert.equal(saved.turns[0]?.models.length, 61);
    assert.equal(saved.turns[0]?.usage.calls, 61);
    assert.equal(saved.turns[0]?.usage.reportedTokens, 61 * 42);
    const view = new RetainedTelemetry(), first = view.snapshot(snapshot, history);
    for (let count = 0; count < 100; count++) assert.equal(view.snapshot(snapshot, history), first);
    assert.notEqual(view.snapshot({ ...snapshot, seq: snapshot.seq + 1 }, history), first);
    assert.equal(fixture.requests.length, 1);
  } finally { await fixture.close(); }
});

test("a missing original accounting owner is visible as a diagnostic without breaking retained chat snapshots", async () => {
  const fixture = await setupFixture();
  try {
    const snapshot = structuredClone(fixture.service.controller.snapshot());
    snapshot.sessions[0]!.coordinationParentId = "generated-missing-original-owner";
    const saved = retainedSessionTelemetry(snapshot, fixture.service.controller.events(0))[fixture.sessionId]!;
    assert.equal(saved.budget, null);
    assert.match(saved.budgetDiagnostic!, /existing session|original owner/);
  } finally { await fixture.close(); }
});

test("long retained histories rebuild every original turn without model calls or per-turn dashboard pagination", { skip: process.platform !== "darwin" }, async (t) => {
  const fixture = await setupFixture({ responseMode: "text" });
  try {
    await fixture.configure(); await fixture.send("Generated long retained history."); await fixture.terminal();
    const snapshot = structuredClone(fixture.service.controller.snapshot()), session = snapshot.sessions[0]!, original = snapshot.budgetEntries[0]!;
    const turns = Array.from({ length: 2000 }, (_, index) => `generated-retained-turn-${index}`);
    const source = fixture.service.controller.events(0).filter((event) => event.turn_id === session.messages[0]!.turnId);
    session.messages = turns.flatMap((turnId, index) => session.messages.map((message) => ({ ...message, id: `${message.id}:${index}`, turnId })));
    session.usage = turns.flatMap((_turnId, index) => session.usage.map((usage) => ({ ...usage, stepId: `${usage.stepId}:${index}` })));
    snapshot.budgetEntries = turns.map((turnId, index) => ({ ...original, id: `${original.id}:${index}`, turnId, ownerTurnId: turnId }));
    let seq = 0;
    const history = turns.flatMap((turn_id, index) => source.map((event) => ({ ...event, seq: ++seq, id: `${event.id}:${index}`, turn_id,
      ...(event.step_id ? { step_id: `${event.step_id}:${index}` } : {}) })));
    snapshot.seq = seq;
    const started = performance.now(), saved = retainedSessionTelemetry(snapshot, history)[fixture.sessionId]!;
    t.diagnostic(`Rebuilt ${saved.turns.length} original saved turns in ${(performance.now() - started).toFixed(2)} ms.`);
    assert.equal(saved.turns.length, 2000);
    assert.equal(saved.turns.at(-1)?.turnId, turns.at(-1));
    assert.equal(saved.turns.at(-1)?.usage.reportedTokens, 42);
    assert.equal(saved.budget?.totals.reportedTokens, 2000 * 42);
    assert.equal(fixture.requests.length, 1);
  } finally { await fixture.close(); }
});
