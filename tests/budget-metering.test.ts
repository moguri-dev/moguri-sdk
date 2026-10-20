import test from "node:test";
import assert from "node:assert/strict";
import { setupFixture } from "./fixture.ts";

test("budget primitive: the maintained adapter's cached input is not double-counted in provider totals", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ maxOutputTokens: 128, usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42, prompt_tokens_details: { cached_tokens: 10 } } });
  try {
    await fixture.configure(); await fixture.send("Generated metering primitive."); await fixture.terminal();
    const usage = fixture.session().usage[0]!;
    assert.equal(usage.quality, "provider-reported");
    assert.equal(usage.inputTokens, 20); assert.equal(usage.cacheReadTokens, 10); assert.equal(usage.outputTokens, 12);
    assert.equal(usage.totalTokens, 42);
    assert.equal(usage.totalTokens, usage.inputTokens! + usage.cacheReadTokens! + usage.outputTokens!);
    assert.equal(usage.estimatedUsd, null); assert.equal(usage.providerReportedUsd, null); assert.equal(usage.billedUsd, null);
    assert.equal(fixture.requests[0]?.max_tokens ?? fixture.requests[0]?.max_completion_tokens, 128);
  } finally { await fixture.close(); }
});

test("budget primitive: omitted provider telemetry stays unknown rather than inheriting zero usage or free cost", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ omitUsage: true, maxOutputTokens: 128 });
  try {
    await fixture.configure(); await fixture.send("Generated omitted metering primitive."); await fixture.terminal();
    const usage = fixture.session().usage[0]!;
    assert.equal(usage.quality, "unknown"); assert.equal(usage.totalTokens, null);
    assert.equal(usage.inputTokens, null); assert.equal(usage.outputTokens, null); assert.equal(usage.cacheReadTokens, null);
    assert.equal(usage.estimatedUsd, null); assert.equal(usage.providerReportedUsd, null); assert.equal(usage.billedUsd, null);
    assert.equal(fixture.requests.length, 1);
  } finally { await fixture.close(); }
});
