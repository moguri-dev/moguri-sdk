import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { defaultKupoSettings, type Controls } from "../packages/sdk/src/index.ts";
import { routedFixture } from "./fixtures/single-routing.ts";
import { generatedKupoProfile } from "./fixtures/kupo-profiles.ts";
import { ciTime } from "./fixtures/time-scale.ts";

const cases: Array<{
  env: "Local" | "Remote"; pattern: "single" | "cascade" | "critique";
  autonomy: Controls["autonomy"]; cap: "tokens" | "usd" | "both"; image: boolean;
}> = [
  { env: "Local", pattern: "single", autonomy: "Manual", cap: "tokens", image: false },
  { env: "Remote", pattern: "single", autonomy: "Autopilot", cap: "tokens", image: true },
  { env: "Local", pattern: "cascade", autonomy: "Guided", cap: "usd", image: true },
  { env: "Remote", pattern: "cascade", autonomy: "Autopilot Max", cap: "both", image: true },
  { env: "Local", pattern: "critique", autonomy: "Autopilot Max", cap: "both", image: true },
  { env: "Remote", pattern: "critique", autonomy: "Manual", cap: "usd", image: false },
];

for (const selected of cases) test(`finite ${selected.env} ${selected.pattern}/${selected.autonomy}/${selected.cap}${selected.image ? "/image" : ""} retains every real role, context and charge`, {
  skip: process.platform !== "darwin", timeout: ciTime(40_000),
}, async () => {
  const fixture = await routedFixture({ env: selected.env, configured: false, legacy: false, imageInput: selected.image, toolInput: true });
  try {
    const draft = await generatedKupoProfile(fixture.sdk, fixture.solverId, { category: "economy", score: 0.4, price: 0 });
    const review = await generatedKupoProfile(fixture.sdk, fixture.modelId, { category: "standard", score: 0.8, price: selected.pattern === "cascade" ? 1 : 0 });
    const lineage = selected.pattern === "critique" ? (await fixture.sdk.compound.lineageDraft({
      draftModelId: fixture.solverId, criticModelId: fixture.modelId, draftLineage: "generated-finite-alpha", criticLineage: "generated-finite-beta",
      sourceKind: "reviewed-training-report", sourceUrl: "https://generated-evidence.invalid/finite-lineage",
      sourceText: "Generated independent-lineage fixture; no real training or quality claim.",
      validUntil: new Date(Date.now() + 3600000).toISOString(), limitations: "Mechanical generated evidence only.",
    })).review : undefined;
    await fixture.sdk.routing.configure({
      ...defaultKupoSettings(), approvedModelIds: selected.pattern === "single" ? [fixture.solverId] : [fixture.modelId, fixture.solverId],
      modelProfiles: [draft, review], lineageReviews: lineage ? [lineage] : [],
      automaticLimits: { maxEscalations: 1, maxRevisions: 1, maxResultBytes: 1024 },
    }, fixture.sdk.settings.get()!.revision);
    const settings = fixture.sdk.settings.get()!;
    await fixture.sdk.settings.update({
      ...settings.values,
      winddown: { ...settings.values.winddown, enabled: true, modelId: fixture.modelId, allowHosted: true, outputTokens: 32, timeoutMs: 15000 },
      decisions: { ...settings.values.decisions, enabled: true, provider: "bounded-model", modelId: fixture.modelId, allowHosted: true, outputTokens: 128 },
      budgets: { ...settings.values.budgets, rates: [fixture.modelId, fixture.solverId].map((modelId) => ({
        modelId, source: "user-estimate" as const, effectiveAt: new Date().toISOString().slice(0, 10), inputUsdPerMillion: 1, outputUsdPerMillion: 2,
      })) },
    }, settings.revision);
    await fixture.select();
    await fixture.sdk.sessions.configure(fixture.sessionId, {
      ...fixture.session().controls, autonomy: selected.autonomy,
      budget: { kind: "limited", basis: "estimate", ...(selected.cap !== "usd" ? { tokens: 100000 } : {}), ...(selected.cap !== "tokens" ? { usd: 1 } : {}) },
    });
    fixture.options.respond = (_request, index) => ({ text: index === 1 ? JSON.stringify({
      pattern: selected.pattern, modelId: fixture.solverId, complexity: "moderate", taskKind: "substantive", confidence: 1,
      reason: "Generated exact finite combination.", ...(selected.pattern === "cascade" ? { escalationId: fixture.modelId } : { criticId: fixture.modelId }),
    }) : JSON.stringify({ verdict: selected.pattern === "critique" && index === 2 ? "revise" : "pass", reason: "Generated untrusted review, not source acceptance." }) });
    if (selected.image) {
      const png = await sharp({ create: { width: 16, height: 12, channels: 3, background: { r: 41, g: 82, b: 123 } } }).png().toBuffer();
      await fixture.sdk.attachments.image(fixture.sessionId, png.toString("base64"), "Generated finite context");
    }
    await fixture.send("Generated complete finite route with unchanged approved context.");
    await fixture.terminal();
    assert.equal(fixture.session().status, "completed", fixture.session().lastError ?? "");
    const state = fixture.service.controller.snapshot(), entries = state.budgetEntries;
    const roles = selected.pattern === "single" ? ["solver"] : selected.pattern === "cascade" ? ["router", "draft", "critic"] :
      ["router", "draft", "critic", "revision", "critic"];
    assert.deepEqual(entries.map((entry) => entry.role), roles);
    assert.ok(entries.every((entry) => entry.env === selected.env && entry.status === "settled" && entry.reportedTokens === 42));
    assert.equal(new Set(entries.map((entry) => entry.id)).size, roles.length);
    const status = (await fixture.sdk.budgets.status(fixture.sessionId)).status;
    assert.equal(status.totals.knownReportedTokens, roles.length * 42);
    assert.equal(status.totals.unknownTokenCalls, 0);
    assert.equal(status.totals.billedUsd, null);
    assert.equal(state.budgetPlans.some((plan) => plan.status === "held"), false);
    assert.equal(state.routings[0]?.plan?.pattern, selected.pattern);
    assert.equal(fixture.session().controls.autonomy, selected.autonomy);
    if (selected.image) {
      assert.equal(fixture.session().messages.find((message) => message.role === "user")?.attachments?.[0]?.kind, "image");
      for (const request of [...fixture.requests, ...fixture.solver.requests]) assert.match(JSON.stringify(request.messages), /data:image\/png;base64,/);
    }
    if (selected.env === "Remote") {
      assert.equal(state.executions.length, 1);
      assert.ok(state.executions.every((execution) => execution.workspace === fixture.workspace));
    }
  } finally { await fixture.close(); }
});
