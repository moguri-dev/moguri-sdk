import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { createServer as createNetServer } from "node:net";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { hostedModelId, hostedSecretId } from "../apps/service/src/hosted-providers.ts";
import { localModelId } from "../apps/service/src/model-registry.ts";
import { MoguriSdk, type LocalEndpoint } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

const mac = { skip: process.platform !== "darwin", timeout: 60_000 };
type Seen = { method: string; path: string; headers: IncomingMessage["headers"]; body: Record<string, unknown> | null };
/** Generated loopback stand-in for the OpenRouter, Anthropic Messages and OpenAI-compatible APIs. */
async function fakeApi(allowedOpenRouter: string[]) {
  const seen: Seen[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString("utf8"), path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    seen.push({ method: request.method ?? "", path, headers: request.headers, body: text ? JSON.parse(text) as Record<string, unknown> : null });
    if (request.method === "GET" && path.endsWith("/models/user")) {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data: allowedOpenRouter.map((id) => ({ id, context_length: 100_000, top_provider: { context_length: 100_000, max_completion_tokens: 8000 } })) }));
    } else if (request.method === "GET" && path.endsWith("/models")) {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data: [{ id: "generated-gateway-model" }] }));
    } else if (path.endsWith("/chat/completions")) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = (delta: unknown, finish: string | null = null) => response.write(`data: ${JSON.stringify({ id: "generated", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      chunk({ role: "assistant", content: "Generated hosted completion." }); chunk({}, "stop");
      response.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 } })}\n\n`);
      response.end("data: [DONE]\n\n");
    } else if (path.endsWith("/v1/messages")) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const event = (type: string, data: unknown) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data as object })}\n\n`);
      event("message_start", { message: { id: "msg_generated", type: "message", role: "assistant", model: "generated", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 9, output_tokens: 1 } } });
      event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
      event("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Generated Anthropic reply." } });
      event("content_block_stop", { index: 0 });
      event("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } });
      event("message_stop", {});
      response.end();
    } else response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return { base: `http://127.0.0.1:${address.port}`, seen, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
const memoryVault = () => {
  const secrets = new Map<string, string>();
  return { secrets, vault: { read: async (id: string) => secrets.get(id) ?? null, write: async (id: string, value: string) => { secrets.set(id, value); }, remove: async (id: string) => { secrets.delete(id); } } };
};
const portFree = (port: number) => new Promise<boolean>((resolve) => {
  const probe = createNetServer().once("error", () => resolve(false)).once("listening", () => probe.close(() => resolve(true)));
  probe.listen(port, "127.0.0.1");
});

test("hosted API keys stay in the secret backend, list provider models, stream through the worker and refuse Claude subscription tokens", mac, async () => {
  const routerModel = openrouterProvider().getModels().find((model) => model.api === "openai-completions")!;
  const anthropicModel = anthropicProvider().getModels().find((model) => model.id === "claude-sonnet-4-5")!;
  const api = await fakeApi([routerModel.id]), { secrets, vault } = memoryVault();
  const fixture = await setupFixture({ platform: { models: { vault, hosted: { baseUrls: { openrouter: `${api.base}/api/v1`, anthropic: api.base } } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const routerKey = "sk-or-v1-generated-router-key", anthropicKey = "sk-ant-api03-generated-anthropic-key";
  try {
    await sdk.models.hosted.setKey("openrouter", routerKey);
    const routerId = hostedModelId("openrouter", routerModel.id);
    await waitFor(() => sdk.getState().snapshot?.provider.models.some((model) => model.id === routerId), 15_000);
    const provider = sdk.getState().snapshot!.provider.catalogue!.providers.find((entry) => entry.id === "openrouter")!;
    assert.deepEqual([provider.status, provider.scope, provider.account?.credential], ["connected", "hosted", "api_key"]);
    assert.deepEqual(sdk.getState().snapshot!.provider.models.filter((model) => model.providerId === "openrouter").map((model) => model.apiModelId), [routerModel.id]);
    assert.equal(api.seen.find((entry) => entry.path.endsWith("/models/user"))?.headers.authorization, `Bearer ${routerKey}`);
    assert.deepEqual(JSON.parse(secrets.get(hostedSecretId("openrouter"))!), { type: "api_key", key: routerKey });
    assert.deepEqual(sdk.settings.get()!.values.hostedProviders, ["openrouter"]);

    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: routerId });
    await fixture.send("Generated hosted request.");
    const routed = await fixture.terminal();
    assert.equal(routed.status, "completed", routed.lastError ?? "");
    assert.ok(routed.messages.some((message) => message.role === "assistant" && message.text.includes("Generated hosted completion.")));
    const completion = api.seen.find((entry) => entry.path.endsWith("/chat/completions"))!;
    assert.deepEqual([completion.headers.authorization, completion.body?.model], [`Bearer ${routerKey}`, routerModel.id]);
    assert.deepEqual([routed.usage.at(-1)?.source, routed.usage.at(-1)?.providerId, routed.usage.at(-1)?.apiModelId], ["hosted", "openrouter", routerModel.id]);

    await assert.rejects(sdk.models.hosted.setKey("anthropic", "sk-ant-oat01-generated-subscription-token"), /subscription token/);
    assert.equal(secrets.has(hostedSecretId("anthropic")), false);
    await sdk.models.hosted.setKey("anthropic", anthropicKey);
    const claudeId = hostedModelId("anthropic", anthropicModel.id);
    await waitFor(() => sdk.getState().snapshot?.provider.models.some((model) => model.id === claudeId), 15_000);
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: claudeId });
    await fixture.send("Generated Anthropic request.");
    const claude = await fixture.terminal();
    assert.equal(claude.status, "completed", claude.lastError ?? "");
    assert.ok(claude.messages.some((message) => message.role === "assistant" && message.text.includes("Generated Anthropic reply.")));
    const message = api.seen.find((entry) => entry.path.endsWith("/v1/messages"))!;
    assert.deepEqual([message.headers["x-api-key"], message.headers.authorization, message.body?.model], [anthropicKey, undefined, anthropicModel.id]);

    const retained = JSON.stringify([sdk.getState().snapshot, fixture.service.controller.events(0)]);
    for (const key of [routerKey, anthropicKey]) assert.equal(retained.includes(key), false);
    assert.deepEqual(fixture.service.controller.events(0).filter((event) => event.event_type === "model.authorization_changed").map((event) => event.payload.providerId), ["openrouter", "anthropic", "anthropic"]);

    await sdk.models.hosted.remove("openrouter");
    assert.equal(secrets.has(hostedSecretId("openrouter")), false);
    assert.deepEqual(sdk.settings.get()!.values.hostedProviders, ["anthropic"]);
    await waitFor(() => !sdk.getState().snapshot?.provider.models.some((model) => model.providerId === "openrouter"));
    await assert.rejects(sdk.models.hosted.submitCode("chatgpt", "http://127.0.0.1:1455/auth/callback?code=x"), /No ChatGPT account sign-in is waiting/);
  } finally { sdk.disconnect(); await fixture.close(); await api.close(); }
});

test("Sign in with ChatGPT and OpenRouter surface only official sign-in URLs, bind a stable installation ID and store nothing on cancel or a bad redirect", mac, async () => {
  const { secrets, vault } = memoryVault();
  const fixture = await setupFixture({ platform: { models: { vault } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const login = (id: string) => waitFor(() => sdk.getState().snapshot?.provider.catalogue?.providers.find((entry) => entry.id === id)?.account?.login ?? false, 15_000);
  const provider = (id: string) => sdk.getState().snapshot?.provider.catalogue?.providers.find((entry) => entry.id === id);
  try {
    await sdk.models.hosted.login("openrouter");
    const router = new URL((await login("openrouter")).url);
    assert.deepEqual([router.protocol, router.hostname, router.pathname], ["https:", "openrouter.ai", "/auth"]);
    assert.match(router.searchParams.get("callback_url") ?? "", /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback\//);
    assert.equal(router.searchParams.get("code_challenge_method"), "S256");
    await sdk.models.hosted.cancel("openrouter");
    await waitFor(() => provider("openrouter")?.status === "disconnected" && /cancelled/.test(provider("openrouter")?.diagnostic ?? ""));
    assert.equal(secrets.has(hostedSecretId("openrouter")), false);

    if (!await portFree(1455)) { console.log("Port 1455 is busy on this machine; the ChatGPT callback check was skipped."); return; }
    await sdk.models.hosted.login("chatgpt");
    const deviceId = sdk.settings.get()!.values.hostedDeviceId!;
    assert.match(deviceId, /^[0-9a-f-]{36}$/);
    const chatgpt = new URL((await login("chatgpt")).url);
    assert.deepEqual([chatgpt.hostname, chatgpt.searchParams.get("client_id"), chatgpt.searchParams.get("agent_name_hint"), chatgpt.searchParams.get("ext_agent_host_id"), chatgpt.searchParams.get("resource")],
      ["auth.openai.com", "dynamic_agent_client", "Moguri", `urn:uuid:${deviceId}`, "https://api.openai.com/v1"]);
    assert.match(chatgpt.searchParams.get("scope") ?? "", /chatgpt\.tokens\.use\.direct/);
    await sdk.models.hosted.submitCode("chatgpt", "http://127.0.0.1:1455/auth/callback?code=generated&state=wrong&client_id=generated");
    await waitFor(() => provider("chatgpt")?.status === "error" && !provider("chatgpt")?.account?.login);
    assert.equal(secrets.has(hostedSecretId("chatgpt")), false);
    await sdk.models.hosted.login("chatgpt");
    assert.equal(sdk.settings.get()!.values.hostedDeviceId, deviceId);
    await login("chatgpt");
    await sdk.models.hosted.cancel("chatgpt");
    await waitFor(() => provider("chatgpt")?.status === "disconnected");
    assert.ok(await portFree(1455));
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("generic endpoints send plain headers and header-scoped keys, skip discovery for explicit models and reject credential headers", mac, async () => {
  const api = await fakeApi([]), { vault } = memoryVault();
  const fixture = await setupFixture({ platform: { models: { vault } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const endpoint: LocalEndpoint = { id: "generated-gateway", name: "Generated gateway", enabled: true, baseUrl: `${api.base}/v1`, auth: "header", authHeader: "api-key",
    headers: { "X-Org": "generated-org" }, discovery: false,
    models: [{ id: "generated-explicit-model", name: "Generated explicit model", contextWindow: 32_000, maxTokens: 4096, imageInput: false }] };
  const update = async (endpoints: LocalEndpoint[]) => { const settings = sdk.settings.get()!; await sdk.settings.update({ ...settings.values, localModels: endpoints }, settings.revision); };
  try {
    for (const [change, pattern] of [[{ headers: { Authorization: "Bearer generated" } }, /secret backend/], [{ headers: { "X-Api-Key": "generated" } }, /secret backend/],
      [{ auth: "bearer" as const }, /exactly one header name/], [{ headers: { "Content-Type": "text/plain" } }, /transport or authentication/]] as const) {
      await assert.rejects(update([{ ...endpoint, ...change }]), pattern);
    }
    await update([endpoint]);
    await sdk.models.setToken(endpoint.id, "generated-gateway-secret");
    const id = localModelId(endpoint.id, "generated-explicit-model");
    await waitFor(() => sdk.getState().snapshot?.provider.models.some((model) => model.id === id), 15_000);
    assert.equal(api.seen.some((entry) => entry.method === "GET"), false);
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: id });
    await fixture.send("Generated gateway request.");
    assert.equal((await fixture.terminal()).status, "completed");
    const request = api.seen.find((entry) => entry.path.endsWith("/chat/completions"))!;
    assert.deepEqual([request.headers["api-key"], request.headers["x-org"], request.headers.authorization, request.body?.model],
      ["generated-gateway-secret", "generated-org", undefined, "generated-explicit-model"]);
    assert.equal(JSON.stringify(fixture.service.controller.events(0)).includes("generated-gateway-secret"), false);
  } finally { sdk.disconnect(); await fixture.close(); await api.close(); }
});
