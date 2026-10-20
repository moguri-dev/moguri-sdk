import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { BudgetRuntime } from "../apps/service/src/budgets.ts";
import { MoguriSdk, type Session, type Snapshot } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { startService } from "../apps/service/src/server.ts";
import { writeLegacyState } from "./fixtures/legacy-state.ts";

test("exact token/USD reservations share one owner across internal roles and cannot reuse another pending leg's capacity", async () => {
  const fixture = await setupFixture();
  try {
    await fixture.configure();
    const current: Session = { ...fixture.session(), controls: { ...fixture.session().controls, budget: { kind: "limited", basis: "estimate", tokens: 100 } } };
    let snapshot: Snapshot = { ...structuredClone(fixture.service.controller.snapshot()), sessions: [current], budgetEntries: [] };
    const date = new Date().toISOString().slice(0, 10);
    snapshot.settings.values.budgets.rates = [{ modelId: fixture.modelId, inputUsdPerMillion: 1, outputUsdPerMillion: 2, effectiveAt: date, source: "user-estimate" }];
    snapshot.budgetPolicy = { revision: 1, limit: { usd: 0.000190, basis: "estimate" } };
    const runtime = new BudgetRuntime({ snapshot: () => snapshot, events: () => [] });
    const first = runtime.reserve(current, { stepId: "generated-router", turnId: "generated-turn", role: "router", providerId: "generated", apiModelId: fixture.modelId, inputEstimate: 10, maxOutputTokens: 100 });
    assert.equal(first.maxTokens, 90);
    assert.ok(first.event.event_type === "budget.recorded");
    snapshot = { ...snapshot, budgetEntries: [first.event.payload.entry] };
    const entry = snapshot.budgetEntries[0]!;
    assert.equal(entry.reservedTokens, 100); assert.equal(entry.reservedUsdMicros, 190);
    assert.throws(() => runtime.reserve(current, { stepId: "generated-critic", turnId: "generated-turn", role: "critic", providerId: "generated", apiModelId: fixture.modelId, inputEstimate: 1, maxOutputTokens: 1 }), /cannot reserve/);
    assert.throws(() => runtime.reserve(current, { stepId: "generated-router", turnId: "generated-turn", role: "router", providerId: "generated", apiModelId: fixture.modelId, inputEstimate: 1, maxOutputTokens: 1 }), /already has/);
    assert.equal(runtime.status(current.id).remainingTokens, 0);
    assert.equal(runtime.status(current.id).totals.reportedTokens, null);
    assert.equal(runtime.status(current.id).totals.heldTokens, 100);
    assert.equal(runtime.status(current.id).totals.billedUsd, null);
    assert.equal(runtime.query({ type: "budget.dashboard", role: "router" }).type, "budget.dashboard");
  } finally { await fixture.close(); }
});

test("a finite estimate policy forwards the reduced output bound and preserves cumulative reported usage across turns", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ maxOutputTokens: 128 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    await sdk.command({ type: "draft.save", sessionId: fixture.sessionId, expectedRevision: 0, text: "Generated finite metering.", attachments: [] });
    const estimate = (await sdk.sessions.context(fixture.sessionId)).context.estimatedTokens, cap = Math.ceil(estimate) + 16;
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, budget: { kind: "limited", basis: "estimate", tokens: cap } });
    await sdk.command({ type: "message.send", sessionId: fixture.sessionId, expectedRevision: 1, delivery: "queue" });
    await fixture.terminal();
    const request = fixture.requests[0]!;
    assert.equal(request.max_tokens ?? request.max_completion_tokens, 16);
    const status = (await sdk.budgets.status(fixture.sessionId)).status;
    assert.equal(status.totals.reportedTokens, 42); assert.equal(status.remainingTokens, cap - 42);
    assert.equal(status.totals.heldTokens, 0); assert.equal(status.totals.billedUsd, null);
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelOptions: { contextWindow: 8192 } });
    assert.equal((await sdk.budgets.status(fixture.sessionId)).status.totals.reportedTokens, 42);
    await fixture.send("Generated second cumulative request with a larger retained context."); await fixture.terminal();
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.session().status, "partial");
    assert.ok(fixture.service.controller.snapshot().artifacts.some((artifact) => artifact.origin === "checkpoint"));
    assert.equal((await sdk.budgets.status(fixture.sessionId)).status.totals.calls, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("actual concurrent project-free calls cannot overbook profile capacity, and deletion/reset do not refund unknown work", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ maxOutputTokens: 128 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const first = await sdk.sessions.create(null, "Generated budget race A", { modelId: fixture.modelId });
    const second = await sdk.sessions.create(null, "Generated budget race B", { modelId: fixture.modelId });
    for (const session of [first, second]) await sdk.command({ type: "draft.save", sessionId: session.id!, expectedRevision: 0, text: "generated slow shared budget", attachments: [] });
    const estimate = (await sdk.sessions.context(first.id!)).context.estimatedTokens;
    await sdk.budgets.policy({ tokens: Math.ceil(estimate) + 128, basis: "estimate" }, 0, true);
    await assert.rejects(() => sdk.budgets.policy({ tokens: 1_000_000, basis: "estimate" }, 0, true), /policy changed/);
    await Promise.all([first, second].map((session) => sdk.command({ type: "message.send", sessionId: session.id!, expectedRevision: 1, delivery: "queue" })));
    await waitFor(() => fixture.requests.length === 1);
    await waitFor(() => fixture.service.controller.snapshot().sessions.some((session) => [first.id, second.id].includes(session.id) && session.status === "partial"));
    assert.equal(fixture.requests.length, 1);
    for (const session of [first, second]) await sdk.command({ type: "session.stop", sessionId: session.id! });
    await waitFor(() => !fixture.service.controller.snapshot().sessions.some((session) => [first.id, second.id].includes(session.id) && session.turnId));
    const prior = (await sdk.budgets.dashboard()).totals;
    assert.equal(prior.calls, 1); assert.equal(prior.reportedTokens, null); assert.ok(prior.heldTokens! > 0);
    for (const session of [first, second]) await sdk.sessions.delete(session.id!, true);
    await sdk.settings.reset("all", sdk.settings.get()!.revision);
    assert.equal(sdk.getState().snapshot!.budgetPolicy.limit?.tokens, Math.ceil(estimate) + 128);
    const after = (await sdk.budgets.dashboard()).totals;
    assert.equal(after.calls, 1); assert.equal(after.heldTokens, prior.heldTokens);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("stale/unknown USD prices fail closed, while explicit zero prices stay labeled estimates and never billed costs", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ maxOutputTokens: 128 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    await assert.rejects(() => sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, budget: { kind: "limited", tokens: 10 } }, fixture.session().revision), /explicitly accept/);
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, budget: { kind: "limited", basis: "estimate", usd: 1 } }, fixture.session().revision);
    await fixture.send("Generated no-price request."); await fixture.terminal();
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.session().status, "partial");
    assert.match((await sdk.budgets.status(fixture.sessionId)).status.diagnostics.join(" "), /fresh dated/);
    const settings = structuredClone(sdk.settings.get()!.values);
    settings.budgets.rates = [{ modelId: fixture.modelId, inputUsdPerMillion: 0, outputUsdPerMillion: 0, effectiveAt: "2000-01-01", source: "user-estimate" }];
    await sdk.settings.update(settings, sdk.settings.get()!.revision);
    assert.match((await sdk.budgets.status(fixture.sessionId)).status.diagnostics.join(" "), /fresh dated/);
    settings.budgets.rates = [{ modelId: fixture.modelId, inputUsdPerMillion: 0, outputUsdPerMillion: 0, effectiveAt: new Date().toISOString().slice(0, 10), source: "user-estimate" }];
    await sdk.settings.update(settings, sdk.settings.get()!.revision);
    await sdk.command({ type: "session.resume", sessionId: fixture.sessionId });
    await fixture.send("Generated explicitly free estimate request."); await fixture.terminal();
    assert.equal(fixture.requests.length, 1);
    const status = (await sdk.budgets.status(fixture.sessionId)).status;
    assert.equal(status.totals.estimatedUsd, 0); assert.equal(status.totals.providerReportedUsd, null); assert.equal(status.totals.billedUsd, null);
    assert.equal(fixture.session().usage[0]?.estimatedUsd, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("stopped provider work keeps its full unknown reservation through a real service restart without replay", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ maxOutputTokens: 128 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await fixture.configure(); await fixture.send("generated slow budget recovery");
    await waitFor(() => fixture.requests.length === 1);
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId }); await fixture.terminal();
    const held = (await sdk.budgets.status(fixture.sessionId)).status.totals.heldTokens;
    assert.ok(held! > 0);
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const peer = await new MoguriSdk(restarted.connection).ready();
    try {
      assert.equal((await peer.budgets.status(fixture.sessionId)).status.totals.heldTokens, held);
      assert.equal((await peer.budgets.status(fixture.sessionId)).status.totals.reportedTokens, null);
      assert.equal(fixture.requests.length, 1);
      assert.equal(restarted.controller.snapshot().budgetEntries.length, 1);
    } finally { peer.disconnect(); }
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("model-created subagent usage charges its real parent cap even after its source conversation is deleted", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ maxOutputTokens: 128 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    const settings = structuredClone(sdk.settings.get()!.values); settings.subagents.enabled = true;
    await sdk.settings.update(settings, sdk.settings.get()!.revision);
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, budget: { kind: "limited", basis: "estimate", tokens: 100_000 } }, fixture.session().revision);
    const child = await sdk.subagents.run(fixture.sessionId, "Generated child budget analysis.");
    await waitFor(() => fixture.service.controller.snapshot().sessions.find((session) => session.id === child.id)?.status === "completed");
    assert.equal((await sdk.budgets.status(fixture.sessionId)).status.totals.reportedTokens, 42);
    const entry = fixture.service.controller.snapshot().budgetEntries[0]!;
    assert.equal(entry.role, "subagent"); assert.equal(entry.ownerSessionId, fixture.sessionId); assert.equal(entry.sessionId, child.id);
    await sdk.sessions.delete(child.id!, true);
    assert.equal((await sdk.budgets.status(fixture.sessionId)).status.remainingTokens, 100_000 - 42);
    assert.equal((await sdk.budgets.dashboard({ role: "subagent" })).totals.calls, 1);
    assert.equal(fixture.requests[0]?.tools, undefined);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a provider that ignores the actual output bound is partial and cannot silently qualify finite retries", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ maxOutputTokens: 1 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated output-limit violation."); await fixture.terminal();
    assert.equal(fixture.session().status, "partial");
    assert.equal(fixture.service.controller.snapshot().budgetEntries[0]?.outputLimitViolation, true);
    assert.equal((await sdk.budgets.status(fixture.sessionId)).status.totals.reportedTokens, 42);
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, budget: { kind: "limited", basis: "estimate", tokens: 100_000 } }, fixture.session().revision);
    assert.match((await sdk.budgets.status(fixture.sessionId)).status.diagnostics.join(" "), /exceeded an actual forwarded/);
    assert.equal(fixture.requests.length, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("schema-12 accounting imports exact legacy usage without rewriting identities, inventing historical USD or double charging restart", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture();
  let upgraded: Awaited<ReturnType<typeof startService>> | undefined, restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await fixture.configure(); await fixture.send("Generated legacy accounting."); await fixture.terminal();
    await writeLegacyState(fixture.service, 12);
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(fixture.service.store.path);
    try {
      db.exec("BEGIN IMMEDIATE; DROP TRIGGER events_no_delete;");
      const rows = db.prepare("SELECT seq,data FROM events").all();
      for (const row of rows) {
        const value: unknown = JSON.parse(String(row.data));
        if (typeof value === "object" && value !== null && "event_type" in value && value.event_type === "budget.recorded") db.prepare("DELETE FROM events WHERE seq=?").run(Number(row.seq));
      }
      db.exec("CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END; COMMIT;");
    } finally { db.close(); }
    upgraded = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const peer = await new MoguriSdk(upgraded.connection).ready();
    try {
      assert.equal(upgraded.store.db.prepare("PRAGMA user_version").get()?.user_version, 14);
      const entry = upgraded.controller.snapshot().budgetEntries[0]!;
      assert.equal(entry.imported, true); assert.equal(entry.reportedTokens, 42); assert.equal(entry.rate, null);
      assert.equal((await peer.budgets.status(fixture.sessionId)).status.totals.estimatedUsd, null);
      const identities = upgraded.store.events().map(({ id, seq }) => ({ id, seq }));
      peer.disconnect(); await writeLegacyState(upgraded, 12);
      restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
      assert.equal(restarted.controller.snapshot().budgetEntries.length, 1);
      assert.deepEqual(restarted.store.events().slice(0, identities.length).map(({ id, seq }) => ({ id, seq })), identities);
      assert.equal(fixture.requests.length, 1);
    } finally { peer.disconnect(); }
  } finally { await upgraded?.close(); await restarted?.close(); await fixture.close(); }
});

test("explicit dated USD estimates count cached input once and remain separate from unreported provider/billed prices", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ maxOutputTokens: 128, usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42, prompt_tokens_details: { cached_tokens: 10 } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    const settings = structuredClone(sdk.settings.get()!.values);
    settings.budgets.rates = [{ modelId: fixture.modelId, inputUsdPerMillion: 1, outputUsdPerMillion: 2, effectiveAt: new Date().toISOString().slice(0, 10), source: "user-estimate" }];
    await sdk.settings.update(settings, sdk.settings.get()!.revision);
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, budget: { kind: "limited", basis: "estimate", usd: 1 } }, fixture.session().revision);
    await fixture.send("Generated priced cached request."); await fixture.terminal();
    const status = (await sdk.budgets.status(fixture.sessionId)).status;
    assert.equal(status.totals.reportedTokens, 42); assert.equal(status.totals.estimatedUsd, 0.000054);
    assert.equal(status.remainingUsd, 0.999946);
    assert.equal(status.totals.billedUsd, null); assert.equal(status.totals.providerReportedUsd, null);
    assert.equal(fixture.session().usage[0]?.inputTokens, 20); assert.equal(fixture.session().usage[0]?.cacheReadTokens, 10);
    assert.equal(fixture.session().usage[0]?.estimatedUsd, 0.000054);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("a failed accounting settlement rolls back primary completion and retains an unknown hold instead of free usage", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ maxOutputTokens: 128 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    fixture.service.store.db.exec(`CREATE TRIGGER generated_budget_settlement_failure BEFORE INSERT ON events
      WHEN json_extract(NEW.data,'$.event_type')='budget.recorded'
        AND EXISTS(SELECT 1 FROM events WHERE json_extract(data,'$.event_type')='model.completed')
      BEGIN SELECT RAISE(ABORT,'Generated budget settlement failure'); END;`);
    await fixture.send("Generated transactional metering."); await fixture.terminal();
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "model.completed"), false);
    const status = (await sdk.budgets.status(fixture.sessionId)).status;
    assert.equal(status.totals.reportedTokens, null); assert.ok(status.totals.heldTokens! > 0);
    assert.equal(fixture.service.controller.snapshot().budgetEntries[0]?.status, "unknown");
    assert.notEqual(fixture.session().status, "completed");
  } finally {
    fixture.service.store.db.exec("DROP TRIGGER IF EXISTS generated_budget_settlement_failure"); sdk.disconnect(); await fixture.close();
    await waitFor(() => !process.getActiveResourcesInfo().includes("ProcessWrap"), 3000);
  }
});
