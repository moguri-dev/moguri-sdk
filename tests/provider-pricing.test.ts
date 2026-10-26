import assert from "node:assert/strict";
import test from "node:test";
import { estimateRateMicros, matchProviderRate, parseProviderPriceDocument, referencePriceCatalogs } from "../apps/service/src/provider-pricing.ts";

const now = Date.parse("2026-10-26T00:00:00.000Z");
const catalogs = () => referencePriceCatalogs();
const match = (id: string, name = id, date = now) => matchProviderRate({ id, apiModelId: id, name }, catalogs(), 30, date);

test("originating-provider API rates price exact model aliases across reseller names without claiming billed spend", () => {
  for (const id of ["claude-opus-5.5", "anthropic/claude-opus-5-5", "github-copilot/claude-opus-5.5", "openrouter/anthropic/claude-opus-5.5"]) {
    const result = match(id, "Claude Opus 5.5");
    assert.equal(result.rate?.inputUsdPerMillion, 4);
    assert.equal(result.rate?.outputUsdPerMillion, 20);
    assert.equal(result.rate?.source, "provider-api-equivalent");
    assert.equal(result.rate?.source === "provider-api-equivalent" ? result.rate.pricing.provider : null, "anthropic");
  }
  assert.equal(match("generated-local-model", "Opus 5.5").rate?.inputUsdPerMillion, 4);
  assert.equal(match("gpt-6.1-sol", "GPT-6.1 Sol").rate?.outputUsdPerMillion, 10);
  assert.equal(match("claude-sonnet-5.5", "Claude Opus 5.5").rate, null);
  assert.match(match("claude-sonnet-5.5", "Claude Opus 5.5").diagnostic ?? "", /ambiguous/i);
  assert.equal(match("generated-unknown-model").rate, null);
});

test("API-equivalent cache subsets are not double counted and reservations retain conservative write headroom", () => {
  const rate = match("claude-opus-5.5").rate!;
  assert.equal(estimateRateMicros(rate, 1000000, 1000, { cacheReadTokens: 750000, cacheWriteTokens: 50000 }), 1370000);
  assert.equal(estimateRateMicros(rate, 1000000, 1000, undefined, true), 8020000);
  assert.equal(estimateRateMicros(rate, 100, 1, { cacheReadTokens: 101, cacheWriteTokens: 0 }), null);
  assert.equal(estimateRateMicros({ modelId: "generated", effectiveAt: "2026-10-26", source: "user-estimate", inputUsdPerMillion: 4,
    outputUsdPerMillion: 20 }, 1000000, 1000, { cacheReadTokens: 750000, cacheWriteTokens: 50000 }), 4020000);
});

test("long-context thresholds, promotional expiry and stale sources are enforced exactly", () => {
  const rate = match("gpt-6.1-sol").rate!;
  assert.equal(estimateRateMicros(rate, 272000, 1000), 554000);
  assert.equal(estimateRateMicros(rate, 272001, 1000), 1103004);
  assert.equal(match("claude-opus-5.5", undefined, now + 31 * 86400000).rate, null);
  assert.equal(match("gemini-4-argon", undefined, Date.parse("2026-12-01T00:00:00.000Z")).rate, null);
  assert.equal(match("claude-opus-5.5", undefined, now - 86400000).rate, null);
});

test("official price-table parsers ignore batch/free tiers and reject incomplete or contradictory data", () => {
  const anthropic = `# Generated official-format fixture
| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |
| --- | --- | --- | --- | --- | --- |
| Claude Opus 5.5 | $4 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok | $20 / MTok |
`;
  const parsed = parseProviderPriceDocument("anthropic", anthropic, "2026-10-26");
  assert.equal(parsed.prices[0]?.inputUsdPerMillion, 4);
  assert.equal(parsed.prices[0]?.cacheWriteUsdPerMillion, 8);
  const openai = `### Standard pricing data
| Model | Short context input | Short context output | Short context cached input | Short context 30m write | Short context 12h write | Long context input | Long context output | Long context cached input | Long context 30m write | Long context 12h write |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-6.1-sol | $2 | $10 | $0.10 | $2.50 | $5 | $4 | $15 | $0.20 | $5 | $10 |
### Batch pricing data
| Model | Input | Output |
| --- | --- | --- |
| gpt-6.1-sol | $1 | $5 |
`;
  const o = parseProviderPriceDocument("openai", openai, "2026-10-26");
  assert.equal(o.prices.length, 1);
  assert.equal(o.prices[0]?.inputUsdPerMillion, 2);
  assert.equal(o.prices[0]?.longContext?.inputUsdPerMillion, 4);
  const google = `<h2 id="gemini-4-argon">Generated Gemini 4 Argon</h2><h3>Standard</h3>
<table><tr><th></th><th>Free Tier</th><th>Paid Tier, per 1M tokens in USD</th></tr>
<tr><td>Input price</td><td>Free</td><td>$2.00 through November 30, 2026. $4.00 starting December 1, 2026.</td></tr>
<tr><td>Output price (including thinking tokens)</td><td>Free</td><td>$10.00 through November 30, 2026. $20.00 starting December 1, 2026.</td></tr>
<tr><td>Context caching price</td><td>Free</td><td>$0.10 through November 30, 2026. $0.20 starting December 1, 2026.</td></tr></table>`;
  const g = parseProviderPriceDocument("google", google, "2026-10-26");
  assert.equal(g.prices[0]?.inputUsdPerMillion, 2);
  assert.equal(g.prices[0]?.validUntil, "2026-11-30");
  assert.equal(parseProviderPriceDocument("google", google, "2026-12-01").prices[0]?.inputUsdPerMillion, 4);
  assert.throws(() => parseProviderPriceDocument("anthropic", "Generated no pricing rows", "2026-10-26"), /price|pricing/i);
  assert.throws(() => parseProviderPriceDocument("anthropic", anthropic.replace("$4 / MTok", "contact sales"), "2026-10-26"), /price|pricing/i);
});
