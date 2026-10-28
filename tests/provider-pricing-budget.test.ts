import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { BudgetRuntime } from "../apps/service/src/budgets.ts";
import { MoguriSdk, type Snapshot } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { startService } from "../apps/service/src/server.ts";

test("provider-equivalent references price all roles but cannot bypass finite USD consent or explicit stale overrides", async () => {
  const fixture = await setupFixture();
  try {
    await fixture.configure();
    const session = { ...fixture.session(), controls: { ...fixture.session().controls, modelId: "generated-reseller-opus" } };
    const snapshot: Snapshot = { ...structuredClone(fixture.service.controller.snapshot()), sessions: [session],
      provider: { status: "connected", login: null, diagnostic: null, models: [{ id: session.controls.modelId, apiModelId: "claude-opus-5.5",
        name: "Claude Opus 5.5", contextWindow: 1000000, maxTokens: 1000, imageInput: false, providerId: "github-copilot" }] } };
    const runtime = new BudgetRuntime({ snapshot: () => snapshot, events: () => [] });
    for (const role of ["solver", "router", "critic", "revision", "decision", "checkpoint", "compaction"] as const) {
      const result = runtime.reserve(session, { stepId: `generated-${role}`, turnId: "generated-turn", role, providerId: "github-copilot",
        apiModelId: "claude-opus-5.5", inputEstimate: 100, maxOutputTokens: 1000 });
      assert.equal(result.event.event_type, "budget.recorded");
      if (result.event.event_type !== "budget.recorded") throw new Error("Generated reservation changed its event type.");
      assert.equal(result.event.payload.entry.rate?.source, "provider-api-equivalent");
      assert.equal(result.event.payload.entry.reservedUsdMicros, 20800);
    }
    snapshot.budgetPolicy = { revision: 1, limit: { usd: 1, basis: "estimate" } };
    assert.throws(() => runtime.reserve(session, { stepId: "generated-no-consent", turnId: "generated-turn", role: "solver", providerId: "github-copilot",
      apiModelId: "claude-opus-5.5", inputEstimate: 100, maxOutputTokens: 1000 }), /Explicitly allow/);
    assert.equal(snapshot.budgetPolicy.limit?.usd, 1);
    snapshot.settings.values.budgets.useProviderRatesForLimits = true;
    const admitted = runtime.reserve(session, { stepId: "generated-consent", turnId: "generated-turn", role: "solver", providerId: "github-copilot",
      apiModelId: "claude-opus-5.5", inputEstimate: 100, maxOutputTokens: 1000 });
    if (admitted.event.event_type !== "budget.recorded") throw new Error("Generated reservation changed its event type.");
    snapshot.budgetEntries = [admitted.event.payload.entry];
    assert.equal(runtime.status(session.id).totals.billedUsd, null);
    assert.equal(runtime.status(session.id).totals.providerReportedUsd, null);
    snapshot.settings.values.budgets.rates = [{ modelId: session.controls.modelId, inputUsdPerMillion: 1, outputUsdPerMillion: 2,
      effectiveAt: "2000-01-01", source: "user-estimate" }];
    assert.equal(runtime.status(session.id).rate, null, "An expired override cannot silently become a different provider price");
    assert.equal(snapshot.budgetEntries[0]!.rate?.inputUsdPerMillion, 4, "Captured historical rate cannot be rewritten by settings");
  } finally { await fixture.close(); }
});

const generatedPrices = `| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |
| --- | --- | --- | --- | --- | --- |
| Claude Opus 5.5 | $4 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok | $20 / MTok |
`;
test("an explicit public refresh survives restart; partial provider responses do not replace its catalog or reprice history", async () => {
  let malformed = false, requests = 0;
  const fetchPrices: typeof fetch = async (url, options) => {
    requests++;
    assert.equal(String(url), "https://platform.claude.com/docs/en/about-claude/pricing.md");
    assert.equal(options?.credentials, "omit");
    assert.equal(new Headers(options?.headers).has("authorization"), false);
    return new Response(malformed ? "Generated malformed document" : generatedPrices);
  };
  const fixture = await setupFixture({ platform: { pricing: { fetch: fetchPrices } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const before = await sdk.prices.catalog();
    assert.equal(requests, 0, "Reading references must not add provider network calls");
    assert.equal(fixture.requests.length, 0);
    const started = await sdk.prices.refresh(["anthropic"], before.revision);
    assert.equal((await sdk.jobs.wait(started.id!)).status, "completed");
    const fresh = await sdk.prices.catalog();
    assert.equal(fresh.revision, 1); assert.equal(requests, 1);
    assert.equal(fresh.catalogs.find((catalog) => catalog.provider === "anthropic")?.evidence, "fetched-document");
    malformed = true;
    const failed = await sdk.prices.refresh(["anthropic"], fresh.revision);
    assert.equal((await sdk.jobs.wait(failed.id!)).status, "failed");
    assert.deepEqual((await sdk.prices.catalog()).catalogs, fresh.catalogs);
    assert.equal(fixture.service.controller.snapshot().budgetEntries.length, 0);
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), retentionKey: fixture.retentionKey, provider: fixture.provider });
    const peer = await new MoguriSdk(restarted.connection).ready();
    try { assert.equal((await peer.prices.catalog()).revision, 1); assert.deepEqual((await peer.prices.catalog()).catalogs, fresh.catalogs); assert.equal(requests, 2); }
    finally { peer.disconnect(); }
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});
