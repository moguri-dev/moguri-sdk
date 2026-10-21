import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { createModels, createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

const native = [["sendbox", ["--version"]], ["container", ["--version"]], ["ssh", ["-V"]], ["porto", ["--version"]], ["sqnsl", ["version"]]]
  .map(([command, args]) => {
    const probe = spawnSync(command, args, { encoding: "utf8", timeout: 5000 });
    return { command, installed: !probe.error, healthy: probe.status === 0, diagnostic: probe.error?.code ?? (probe.status === 0 ? "Executable responded" : `Exit ${probe.status}`) };
  });
let endpoint = "";
const requests = [], held = new Set();
const server = createServer((request, response) => {
  void (async () => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ body, authorization: request.headers.authorization });
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({ id: "generated-local", object: "chat.completion.chunk", model: "generated-local", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (body.messages.some((message) => message.content === "generated hold")) {
      chunk({ role: "assistant", content: "Generated pending local response." });
      held.add(response); response.once("close", () => held.delete(response)); return;
    }
    chunk({ role: "assistant", tool_calls: [{ index: 0, id: "generated-tool-call", type: "function", function: { name: "generated_lookup", arguments: '{"query":"generated"}' } }] });
    chunk({}, "tool_calls");
    response.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 19, completion_tokens: 7, total_tokens: 26 } })}\n\n`);
    response.end("data: [DONE]\n\n");
  })().catch((error) => { console.error("Generated runtime spike failed:", error.message); if (!response.headersSent) response.writeHead(500); response.end(); });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
endpoint = `http://127.0.0.1:${server.address().port}/v1`;
try {
  const started = performance.now();
  const model = { id: "generated-local", name: "Generated local model", api: "openai-completions", provider: "moguri-local", baseUrl: endpoint, reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 4096, compat: { supportsStore: false, supportsReasoningEffort: false, maxTokensField: "max_tokens", supportsDeveloperRole: false } };
  const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
  models.setProvider(createProvider({ id: "moguri-local", auth: { apiKey: { name: "Explicit keyless endpoint", resolve: async () => ({ auth: { apiKey: "moguri-keyless", headers: { Authorization: null } }, source: "explicit-keyless" }) } }, models: [model], api: openAICompletionsApi() }));
  const result = await models.streamSimple(model, { messages: [{ role: "user", content: "Generated local tool task.", timestamp: 0 }], tools: [{ name: "generated_lookup", description: "Generated only", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }] }, { maxTokens: 128, maxRetries: 0 }).result();
  assert.equal(result.stopReason, "toolUse");
  assert.equal(result.content[0].type, "toolCall");
  assert.deepEqual(result.content[0].arguments, { query: "generated" });
  assert.equal(result.usage.totalTokens, 26);
  assert.equal(requests[0].authorization, undefined);
  assert.equal(requests[0].body.max_tokens, 128);
  const abort = new AbortController();
  const stream = models.streamSimple(model, { messages: [{ role: "user", content: "generated hold", timestamp: 0 }] }, { signal: abort.signal, maxTokens: 128, maxRetries: 0 });
  for await (const event of stream) if (event.type === "text_delta") abort.abort();
  assert.equal((await stream.result()).stopReason, "aborted");
  console.log(JSON.stringify({ status: "PASS", primitive: "Maintained OpenAI-compatible local provider, keyless transport, tools, usage and cancellation", requests: requests.length, ms: performance.now() - started, native, qualification: { sendbox: "BLOCKED: requires verified host runtime, guest bundle and workload", remote: "BLOCKED: no user-configured SSH target; an installed ssh client is not qualification" } }, null, 2));
} finally {
  for (const response of held) response.destroy();
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
}
