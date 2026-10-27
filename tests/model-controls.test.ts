import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createModels, hasApi, normalizeContext, type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import { estimateMessageTokens } from "@earendil-works/pi-ai/utils/estimate";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { estimateModelContext, modelRequest, supportedThinking } from "../apps/service/src/model-controls.ts";
import { startService } from "../apps/service/src/server.ts";
import { isRecord, MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { assertCurrentSchema, writeLegacyState } from "./fixtures/legacy-state.ts";

test("transport capability lists reject silently ignored or unsupported thinking effort", () => {
  const catalog = githubCopilotProvider().getModels();
  const ignored = catalog.find((model) => hasApi(model, "openai-completions") && model.reasoning && model.compat?.supportsReasoningEffort === false)!;
  assert.deepEqual(supportedThinking(ignored), []);
  assert.throws(() => modelRequest(ignored, { thinkingEffort: "low" }, { messages: [] }), /not supported/);
  const supported = catalog.find((model) => model.api === "openai-responses" && model.reasoning)!;
  assert.ok(supportedThinking(supported).includes("low"));
  assert.throws(() => modelRequest(supported, { contextWindow: supported.contextWindow + 1 }, { messages: [] }), /supported maximum/);
  assert.throws(() => modelRequest({ ...supported, contextWindow: 16384 }, { contextWindow: 8192 }, { systemPrompt: "x".repeat(50000), messages: [] }), /working context/);
});

test("historical usage cannot undercut the fresh source estimate or output headroom after stable context reconstruction", () => {
  const base = { ...githubCopilotProvider().getModels().find((model) => hasApi(model, "openai-completions"))!, contextWindow: 16384 };
  const prior: AssistantMessage = { role: "assistant", api: "openai-completions", provider: "github-copilot", model: base.id, timestamp: 2, stopReason: "stop",
    content: [{ type: "text", text: "Generated prior result." }], usage: { input: 30, output: 12, cacheRead: 0, cacheWrite: 0, totalTokens: 42, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  const context: Context = { systemPrompt: "Generated current system contract.", messages: [
    { role: "user", content: "Generated retained source. ".repeat(350), timestamp: 1 }, prior,
    { role: "user", content: "Generated follow-up.", timestamp: 3 },
  ] };
  const fresh = normalizeContext(context).messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  assert.ok(fresh > 1000);
  assert.equal(estimateModelContext(context), fresh);
  const request = modelRequest(base, { contextWindow: 8192 }, context);
  assert.equal(request.estimatedTokens, fresh);
  assert.ok(request.maxTokens + request.estimatedTokens + 4096 <= 8192);
  assert.equal(prior.usage.totalTokens, 42);
  const larger: AssistantMessage = { ...prior, usage: { ...prior.usage, input: 3488, totalTokens: 3500 } };
  assert.ok(estimateModelContext({ ...context, messages: [context.messages[0]!, larger, context.messages[2]!] }) > fresh);
  assert.throws(() => modelRequest(base, { contextWindow: 8192 }, { ...context, systemPrompt: "Generated expanded policy. ".repeat(2000) }), /working context/);
});

test("retained text above one MiB is admitted when it fits the actual model window without dropping history", () => {
  const model = { ...githubCopilotProvider().getModels().find((model) => hasApi(model, "openai-completions"))!, contextWindow: 2_097_152 };
  const text = "Generated retained conversation. ".repeat(40_000);
  const messages: Context["messages"] = [{ role: "user", timestamp: 1, content: text }];
  assert.ok(Buffer.byteLength(JSON.stringify(messages)) > 1024 * 1024);
  const request = modelRequest(model, undefined, { messages });
  assert.ok(request.estimatedTokens > 0);
  assert.equal(messages[0]?.content, text);
  assert.ok(request.estimatedTokens + request.maxTokens + 4096 <= model.contextWindow);
  assert.throws(() => modelRequest({ ...model, contextWindow: 8192 }, undefined, { messages }), /working context/);
});

test("reasoning cannot expand the output ceiling beyond the configured context room", async () => {
  const catalog = githubCopilotProvider().getModels();
  const base = { ...catalog.find((model) => hasApi(model, "anthropic-messages") && model.reasoning && !model.compat?.forceAdaptiveThinking)!, contextWindow: 16384 };
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

test("large reasoning responses use the declared model ceiling on each actual transport, not an unrelated 8192-token cap", async (t) => {
  const catalog = githubCopilotProvider().getModels();
  const context: Context = { systemPrompt: "Generated repository policy.", messages: [{ role: "user", content: "Add a generated README users section.", timestamp: 0 }] };
  for (const api of ["openai-responses", "anthropic-messages", "openai-completions"] as const) await t.test(api, async () => {
    const base = catalog.find((model) => model.api === api && model.reasoning)!;
    const model = { ...base, contextWindow: 262144, maxTokens: 32768 };
    const thinkingEffort = supportedThinking(model).includes("high") ? "high" : undefined;
    const request = modelRequest(model, thinkingEffort ? { thinkingEffort } : undefined, context);
    assert.equal(request.maxTokens, 32768); assert.equal(request.model.maxTokens, 32768);
    assert.ok(request.maxTokens + request.estimatedTokens + 4096 <= request.model.contextWindow);
    const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
    models.setProvider(githubCopilotProvider());
    let payload: unknown;
    const result = await models.streamSimple(request.model, context, {
      apiKey: "generated-only", maxTokens: request.maxTokens, maxRetries: 0,
      ...(thinkingEffort ? { reasoning: thinkingEffort } : {}),
      onPayload: (value) => { payload = value; },
      fetch: async () => Response.json({ error: { type: "generated", message: "Generated wire-only output probe." } }, { status: 400 }),
    }).result();
    assert.equal(result.stopReason, "error"); assert.ok(isRecord(payload));
    assert.equal(payload.max_output_tokens ?? payload.max_completion_tokens ?? payload.max_tokens, request.maxTokens);
    assert.equal(modelRequest({ ...model, maxTokens: 128 }, undefined, context).maxTokens, 128);
  });
});

test("an approved README edit can finish with reported reasoning output above 8192 without fallback or retry", { skip: process.platform !== "darwin" }, async () => {
  const original = "# Generated repository\n", text = `${original}\n## Users\n\nMoguri is an AI harness for local development.\n`;
  const fixture = await setupFixture({
    reasoning: true, maxOutputTokens: 32768, contextWindow: 262144,
    usage: { prompt_tokens: 30, completion_tokens: 9500, total_tokens: 9530 },
    toolCall: { name: "write_file", args: { path: "README.md", text, expectedDigest: createHash("sha256").update(original).digest("hex") } },
  });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await writeFile(join(fixture.project, "README.md"), original);
    await fixture.configure();
    await fixture.send("Add to readme file a mention to users of this repo, the first user is an app called Moguri which is an AI harness for local development.");
    const request = await waitFor(() => fixture.requests[0]);
    assert.equal(request.max_tokens ?? request.max_completion_tokens, 32768);
    await fixture.approve(); assert.equal((await fixture.terminal()).status, "completed");
    assert.equal(await readFile(join(fixture.project, "README.md"), "utf8"), text);
    assert.equal(fixture.requests.length, 2);
    const entries = fixture.service.controller.snapshot().budgetEntries;
    assert.equal(entries.length, 2);
    assert.ok(entries.every((entry) => entry.status === "settled" && entry.outputLimit === 32768 && !entry.outputLimitViolation));
    assert.deepEqual(fixture.session().usage.map((usage) => usage.outputTokens), [9500, 9500]);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("genuinely incomplete tool output stays partial with its actual limit and cannot execute or replay a file write", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({
    reasoning: true, maxOutputTokens: 4096, finishReason: "length",
    toolCall: { name: "write_file", args: { path: "README.md", text: "Generated forbidden partial write.", expectedDigest: "absent" } },
  });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated incomplete README request.");
    assert.equal((await fixture.terminal()).status, "partial");
    assert.match(fixture.session().lastError!, /4096-token output limit/);
    assert.match(fixture.session().lastError!, /reasoning/i);
    assert.equal(fixture.session().pendingApproval, null);
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started"), false);
    await assert.rejects(() => readFile(join(fixture.project, "README.md")), { code: "ENOENT" });
    await sdk.command({ type: "session.resume", sessionId: fixture.sessionId });
    assert.equal(fixture.requests.length, 1);
    await assert.rejects(() => readFile(join(fixture.project, "README.md")), { code: "ENOENT" });
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("context/effort settings share the SDK, remain independent of autonomy and bind actual worker requests", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture({ reasoning: true, contextWindow: 32768 });
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
  const fixture = await setupFixture({ contextWindow: 16384 });
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
  const fixture = await setupFixture({ contextWindow: 65536 });
  let sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const before = fixture.service.controller.events(0).map(({ id, seq }) => ({ id, seq }));
    sdk.disconnect(); await writeLegacyState(fixture.service, 4);
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    assertCurrentSchema(restarted.store);
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
