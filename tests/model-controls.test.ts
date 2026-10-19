import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { createModels, hasApi } from "@earendil-works/pi-ai";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { modelRequest, supportedThinking } from "../apps/service/src/model-controls.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { writeLegacyState } from "./fixtures/legacy-state.ts";

test("transport capability lists reject silently ignored or unsupported thinking effort", () => {
  const catalog = githubCopilotProvider().getModels();
  const ignored = catalog.find((model) => hasApi(model, "openai-completions") && model.reasoning && model.compat?.supportsReasoningEffort === false)!;
  assert.deepEqual(supportedThinking(ignored), []);
  assert.throws(() => modelRequest(ignored, { thinkingEffort: "low" }, { messages: [] }), /not supported/);
  const supported = catalog.find((model) => model.api === "openai-responses" && model.reasoning)!;
  assert.ok(supportedThinking(supported).includes("low"));
  assert.throws(() => modelRequest(supported, { contextWindow: supported.contextWindow + 1 }, { messages: [] }), /supported maximum/);
  assert.throws(() => modelRequest(supported, { contextWindow: 8192 }, { systemPrompt: "x".repeat(50000), messages: [] }), /working context/);
});

test("reasoning cannot expand the output ceiling beyond the configured context room", async () => {
  const catalog = githubCopilotProvider().getModels();
  const base = catalog.find((model) => hasApi(model, "anthropic-messages") && model.reasoning && !model.compat?.forceAdaptiveThinking)!;
  const request = modelRequest(base, { contextWindow: 8192, thinkingEffort: "high" }, { systemPrompt: "Generated policy.", messages: [{ role: "user", content: "Generated question.", timestamp: 0 }] });
  let payload: unknown;
  const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
  models.setProvider(githubCopilotProvider());
  await models.streamSimple(request.model, { messages: [{ role: "user", content: "Generated question.", timestamp: 0 }] }, {
    apiKey: "generated-only", reasoning: "high", maxTokens: request.maxTokens, maxRetries: 0,
    onPayload: (value) => { payload = value; },
    fetch: async () => Response.json({ error: { type: "generated", message: "Generated option-only probe." } }, { status: 400 }),
  }).result();
  assert.ok(payload && typeof payload === "object" && "max_tokens" in payload && typeof payload.max_tokens === "number");
  assert.ok(payload.max_tokens <= request.maxTokens);
  assert.ok(payload.max_tokens + request.estimatedTokens + 4096 <= 8192);
});

test("context/effort settings share the SDK, remain independent of autonomy and bind actual worker requests", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture({ reasoning: true });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, autonomy: "Guided" });
    assert.equal(fixture.session().controls.modelId, null);
    assert.equal(fixture.session().controls.autonomy, "Guided");
    const initial = await sdk.sessions.context(fixture.sessionId);
    assert.equal(initial.context.modelMaximum, null);
    assert.ok(initial.context.estimatedTokens > 0);
    assert.equal(fixture.requests.length, 0);
    await fixture.configure(); await sdk.refresh();
    await sdk.sessions.modelOptions(fixture.sessionId, { contextWindow: 16384, thinkingEffort: "low" });
    const context = await sdk.sessions.context(fixture.sessionId);
    assert.equal(context.context.contextWindow, 16384);
    assert.equal(context.context.source, "estimated");
    await assert.rejects(() => sdk.sessions.modelOptions(fixture.sessionId, { thinkingEffort: "max" }), /not supported/);
    await fixture.send("Generated tuned question.");
    assert.equal((await fixture.terminal()).status, "completed");
    assert.equal(fixture.requests[0]?.reasoning_effort, "low");
    const usage = fixture.session().usage[0]!;
    assert.equal(usage.contextWindow, 16384); assert.equal(usage.thinkingEffort, "low");
    assert.ok(usage.contextEstimate! > 0);
    assert.equal(usage.inputTokens, 30); assert.equal(usage.estimatedUsd, null);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("overfull working context stops before any model call and preserves the full admitted prompt", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.refresh();
    await sdk.sessions.modelOptions(fixture.sessionId, { contextWindow: 8192 });
    const text = "Generated bounded context. ".repeat(3000);
    await fixture.send(text);
    assert.equal((await fixture.terminal()).status, "failed");
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.session().messages.find((message) => message.role === "user")?.text, text);
    assert.match(fixture.session().lastError!, /working context/);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("schema-4 state upgrades without changing events, receipts or encrypted content and model options survive restart", async () => {
  const fixture = await setupFixture();
  let sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const before = fixture.service.controller.events(0).map(({ id, seq }) => ({ id, seq }));
    sdk.disconnect(); await writeLegacyState(fixture.service, 4);
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    assert.equal(restarted.store.db.prepare("PRAGMA user_version").get()?.user_version, 9);
    assert.deepEqual(restarted.controller.events(0).slice(0, before.length).map(({ id, seq }) => ({ id, seq })), before);
    sdk = await new MoguriSdk(restarted.connection).ready();
    if (process.platform === "darwin") {
      await sdk.sessions.configure(fixture.sessionId, { ...restarted.controller.snapshot().sessions[0]!.controls, modelId: fixture.modelId });
      await sdk.sessions.modelOptions(fixture.sessionId, { contextWindow: 32768 });
    } else restarted.store.commit([{ event_type: "session.configured", profile_id: "default", project_id: fixture.session().projectId, session_id: fixture.sessionId, payload: { controls: { ...fixture.session().controls, modelId: fixture.modelId, modelOptions: { contextWindow: 32768 } } } }]);
    sdk.disconnect(); await restarted.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    assert.equal(restarted.controller.snapshot().sessions[0]?.controls.modelOptions?.contextWindow, 32768);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});
