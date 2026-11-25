import assert from "node:assert/strict";
import test from "node:test";
import { isProviderPriceSource, LEGACY_PROVIDER_PRICE_SOURCES, PROVIDER_PRICE_SOURCES } from "../packages/protocol/src/pricing.ts";
import { effectivePriceCatalogs, estimateRateMicros, matchProviderRate, parseProviderPriceDocument, publishedPrice, referencePriceCatalogs, REFERENCE_PRICES_OBSERVED_AT,
  stalePriceProviders } from "../apps/service/src/provider-pricing.ts";
import { bundledPriceAgeFailure } from "../scripts/check-price-freshness.ts";

const now = Date.parse("2026-11-25T00:00:00.000Z");
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

test("long-context thresholds, dated successors, promotional expiry and stale sources are enforced exactly", () => {
  const rate = match("gpt-6.1-sol").rate!;
  assert.equal(estimateRateMicros(rate, 272000, 1000), 554000);
  assert.equal(estimateRateMicros(rate, 272001, 1000), 1103004);
  assert.equal(match("claude-opus-5.5", undefined, now + 31 * 86400000).rate, null);
  assert.equal(match("gemini-4-argon", undefined, Date.parse("2026-11-30T23:59:59.000Z")).rate?.inputUsdPerMillion, 2);
  const successor = match("gemini-4-argon", undefined, Date.parse("2026-12-01T00:00:00.000Z")).rate!;
  assert.deepEqual([successor.inputUsdPerMillion, successor.outputUsdPerMillion, successor.effectiveAt], [4, 20, "2026-12-01"]);
  assert.equal(successor.source === "provider-api-equivalent" ? successor.pricing.validUntil : "", undefined);
  assert.equal(publishedPrice({ id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" }, catalogs(), Date.parse("2027-01-01T00:00:00.000Z"))?.price.inputUsdPerMillion, 1.5);
  assert.equal(match("gpt-5.6-sol", undefined, Date.parse("2026-12-01T00:00:00.000Z")).rate, null);
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
  assert.deepEqual(g.prices[0]?.next, { effectiveFrom: "2026-12-01", inputUsdPerMillion: 4, outputUsdPerMillion: 20, cacheReadUsdPerMillion: 0.2 });
  assert.equal(parseProviderPriceDocument("google", google, "2026-12-01").prices[0]?.inputUsdPerMillion, 4);
  assert.throws(() => parseProviderPriceDocument("anthropic", "Generated no pricing rows", "2026-10-26"), /price|pricing/i);
  assert.throws(() => parseProviderPriceDocument("anthropic", anthropic.replace("$4 / MTok", "contact sales"), "2026-10-26"), /price|pricing/i);
});

test("the Markdoc Gemini page yields Standard paid prices, long-context tiers and dated successors only when every price changes together", () => {
  const section = (id: string, input: string, output: string, cache: string) => `## Generated ${id}  {% id="${id}" %}

{% tabs %}
  {% tab title="Standard" %}
  {% table %}
  * Feature
  * Free Tier
  * Paid Tier, per 1M tokens in USD{% sup %}*{% /sup %}

  ---

  * Input price
  * Not available
  * ${input}

  ---

  * Output price (including thinking tokens)
  * Not available
  * ${output}

  ---

  * Context caching price
  * Not available
  * ${cache}
  {% /table %}
  {% /tab %}
  {% tab title="Batch" %}
  {% table %}
  * Feature
  * Paid Tier, per 1M tokens in USD

  ---

  * Input price
  * $0.01
  {% /table %}
  {% /tab %}
{% /tabs %}
`;
  const page = section("gemini-4-argon", "$2.00 through November 30, 2026.\n  $4.00 starting December 1, 2026.", "$10.00 through November 30, 2026. $20.00 starting December 1, 2026.",
    "$0.10 through November 30, 2026. $0.20 starting December 1, 2026.\n  $0.50 / 1,000,000 tokens per hour (storage price)")
    + section("gemini-2.5-pro", "$1.25, prompts <= 200k tokens\n  $2.50, prompts > 200k tokens", "$10.00, prompts <= 200k tokens\n  $15.00, prompts > 200k",
      "$0.125, prompts <= 200k tokens\n  $0.25, prompts > 200k\n  $4.50 / 1,000,000 tokens per hour (storage price)");
  const parsed = parseProviderPriceDocument("google", page, "2026-11-25");
  assert.deepEqual(parsed.prices.map((price) => price.modelId), ["gemini-4-argon", "gemini-2.5-pro"]);
  assert.deepEqual(parsed.prices[0], { modelId: "gemini-4-argon", inputUsdPerMillion: 2, outputUsdPerMillion: 10, cacheReadUsdPerMillion: 0.1, validUntil: "2026-11-30",
    next: { effectiveFrom: "2026-12-01", inputUsdPerMillion: 4, outputUsdPerMillion: 20, cacheReadUsdPerMillion: 0.2 } });
  assert.deepEqual(parsed.prices[1]?.longContext, { aboveInputTokens: 200000, inputUsdPerMillion: 2.5, outputUsdPerMillion: 15, cacheReadUsdPerMillion: 0.25 });
  const split = section("gemini-4-argon", "$2.00 through November 30, 2026. $4.00 starting December 1, 2026.", "$10.00 through December 31, 2026. $20.00 starting January 1, 2027.", "$0.10");
  assert.throws(() => parseProviderPriceDocument("google", split, "2026-11-25"), /different dates/);
  const overlapping = section("gemini-4-argon", "$2.00 through November 30, 2026. $4.00 starting November 30, 2026.", "$10.00 through November 30, 2026. $20.00 starting November 30, 2026.", "$0.10");
  assert.throws(() => parseProviderPriceDocument("google", overlapping, "2026-11-25"), /before its predecessor ends/);
});

test("OpenAI grouped tables use only the Standard tier and promotional notes set the price end date", () => {
  const page = `### Standard pricing data
| Model | Input | Output | Cached input |
| --- | --- | --- | --- |
| gpt-5.6-sol | $4 | $20 | $0.40 |
GPT-5.6 Sol’s promotional pricing is available until November 30, 2026.
Standard
### Grouped Pricing Table data
| Category | Model | Input | Output | Cached input |
| --- | --- | --- | --- | --- |
| Codex | gpt-5.3-codex | $1.75 | $14.00 | $0.175 |
Fast
### Grouped Pricing Table data
| Category | Model | Input | Output | Cached input |
| --- | --- | --- | --- | --- |
| Codex | gpt-5.3-codex | $3.50 | $28.00 | $0.35 |
`;
  const parsed = parseProviderPriceDocument("openai", page, "2026-11-25");
  assert.deepEqual(parsed.prices, [{ modelId: "gpt-5.6-sol", inputUsdPerMillion: 4, outputUsdPerMillion: 20, cacheReadUsdPerMillion: 0.4, validUntil: "2026-11-30" },
    { modelId: "gpt-5.3-codex", inputUsdPerMillion: 1.75, outputUsdPerMillion: 14, cacheReadUsdPerMillion: 0.175 }]);
});

test("the newest catalog per provider wins, stale providers are listed and old Google sources still replay", () => {
  const bundled = catalogs(), older = { ...bundled[0]!, observedAt: "2026-11-01", prices: [] }, tie = { ...bundled[1]!, sourceDigest: "generated-refresh" };
  const effective = effectivePriceCatalogs({ providerPriceCatalogs: [older, tie] });
  assert.equal(effective[0]?.observedAt, REFERENCE_PRICES_OBSERVED_AT); assert.equal(effective[0]?.evidence, "bundled-verified-table");
  assert.equal(effective[1]?.sourceDigest, "generated-refresh");
  assert.deepEqual(stalePriceProviders(bundled, 30, now), []);
  assert.deepEqual(stalePriceProviders([older, ...bundled.slice(1)], 20, now), [older.provider]);
  assert.equal(stalePriceProviders(bundled, 30, now + 31 * 86400000).length, bundled.length);
  assert.ok(isProviderPriceSource("google", PROVIDER_PRICE_SOURCES.google) && isProviderPriceSource("google", LEGACY_PROVIDER_PRICE_SOURCES.google[0]!));
  assert.equal(isProviderPriceSource("openai", LEGACY_PROVIDER_PRICE_SOURCES.google[0]!), false);
});

test("the release check refuses a bundled price table older than 14 days", () => {
  assert.equal(bundledPriceAgeFailure("2026-11-25", "2026-12-09"), null);
  assert.match(bundledPriceAgeFailure("2026-11-25", "2026-12-10") ?? "", /15 days before 2026-12-10 \(limit 14\)/);
  assert.match(bundledPriceAgeFailure("2026-11-25", "2026-11-24") ?? "", /after today/);
});
