import assert from "node:assert/strict";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { createModels, getSupportedThinkingLevels, normalizeContext } from "@earendil-works/pi-ai";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { clampMaxTokensToContext } from "@earendil-works/pi-ai/api/simple-options";

const catalog = githubCopilotProvider().getModels();
const fixtures = [
  catalog.find((model) => model.api === "openai-responses" && model.reasoning),
  catalog.find((model) => model.api === "anthropic-messages" && model.reasoning),
  catalog.find((model) => model.api === "openai-completions" && model.reasoning && model.compat?.supportsReasoningEffort === false),
];
if (fixtures.some((model) => !model)) throw new Error("Compatible generated reasoning-model fixtures are required.");
let payload;
const server = createServer((request, response) => {
  void (async () => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { type: "generated_probe", message: "Intentional generated endpoint: request options captured without inference." } }));
  })().catch((error) => { if (!response.headersSent) response.writeHead(500); response.end(); console.error(error); });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const started = performance.now();
  const context = normalizeContext({ systemPrompt: "Generated policy.", messages: [{ role: "user", content: "Generated context probe.", timestamp: 0 }] });
  const estimate = estimateContextTokens(context);
  assert.ok(estimate.tokens > 0); assert.equal(estimate.lastUsageIndex, null);
  const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
  models.setProvider(githubCopilotProvider());
  const results = [];
  for (const base of fixtures) {
    const model = { ...base, contextWindow: 16384, baseUrl: `http://127.0.0.1:${server.address().port}` };
    const maxTokens = clampMaxTokensToContext(model, context, 8192);
    payload = undefined;
    const result = await models.streamSimple(model, context, { apiKey: "generated-only", reasoning: "low", maxTokens, maxRetries: 0 }).result();
    assert.equal(result.stopReason, "error");
    assert.ok(getSupportedThinkingLevels(model).includes("low"));
    const effort = payload.reasoning?.effort ?? payload.output_config?.effort ?? payload.reasoning_effort;
    if (model.api === "openai-completions") assert.equal(effort, undefined);
    else if (model.api === "anthropic-messages" && payload.thinking?.type === "enabled") assert.equal(payload.thinking.budget_tokens, 2048);
    else assert.equal(effort, "low");
    assert.ok((payload.max_tokens ?? payload.max_completion_tokens ?? payload.max_output_tokens) <= 8192);
    results.push({ api: model.api, configurableEffort: model.api !== "openai-completions", effort: effort ?? payload.thinking?.type ?? "not forwarded", maxTokens });
  }
  const crowded = { messages: [{ role: "user", content: "x".repeat(100000), timestamp: 0 }] };
  assert.ok(estimateContextTokens(crowded).tokens + 4096 >= 16384);
  console.log(JSON.stringify({ status: "PASS", contextWindow: 16384, estimatedInput: estimate.tokens, results, ms: performance.now() - started }, null, 2));
} finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
