import { ciTime } from "./fixtures/time-scale.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { groqProvider } from "@earendil-works/pi-ai/providers/groq";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { bedrockEndpoint, bedrockGeographies, hostedModelId, hostedSecretId } from "../apps/service/src/hosted-providers.ts";
import { modelLab, parseHostedKeyArgument } from "../packages/protocol/src/index.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";

const mac = { skip: process.platform !== "darwin", timeout: ciTime(90_000) };
type Seen = { path: string; headers: IncomingMessage["headers"]; body: Record<string, unknown> | null };
/** Generated loopback stand-ins for the Gemini API and OpenAI-compatible chat completions (Groq, DeepSeek, Azure). No real provider is contacted. */
async function fakeCloud() {
  const seen: Seen[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString("utf8"), path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    seen.push({ path, headers: request.headers, body: text ? JSON.parse(text) as Record<string, unknown> : null });
    if (path.endsWith(":streamGenerateContent")) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Generated Gemini reply." }] }, finishReason: "STOP", index: 0 }],
        usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3, totalTokenCount: 10 } })}\r\n\r\n`);
      response.end();
    } else if (path.endsWith("/chat/completions")) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = (delta: unknown, finish: string | null = null) => response.write(`data: ${JSON.stringify({ id: "generated", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      chunk({ role: "assistant", content: `Generated completion for ${path}.` }); chunk({}, "stop");
      response.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 } })}\n\n`);
      response.end("data: [DONE]\n\n");
    } else response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return { base: `http://127.0.0.1:${port}`, seen, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
const memoryVault = () => {
  const secrets = new Map<string, string>();
  return { secrets, vault: { read: async (id: string) => secrets.get(id) ?? null, write: async (id: string, value: string) => { secrets.set(id, value); }, remove: async (id: string) => { secrets.delete(id); } } };
};

test("Bedrock regions limit cross-Region inference profiles and name their regional endpoint", () => {
  assert.deepEqual(bedrockGeographies("us-west-2"), ["us"]);
  assert.deepEqual(bedrockGeographies("eu-central-1"), ["eu"]);
  assert.deepEqual(bedrockGeographies("ap-northeast-1"), ["apac", "jp"]);
  assert.deepEqual(bedrockGeographies("us-gov-west-1"), ["us-gov"]);
  assert.equal(bedrockEndpoint("eu-west-1"), "https://bedrock-runtime.eu-west-1.amazonaws.com");
  assert.equal(bedrockEndpoint("cn-north-1"), "https://bedrock-runtime.cn-north-1.amazonaws.com.cn");
  assert.deepEqual(parseHostedKeyArgument(" groq "), { providerId: "groq" });
  assert.deepEqual(parseHostedKeyArgument("bedrock eu-west-1"), { providerId: "bedrock", options: { region: "eu-west-1" } });
  assert.deepEqual(parseHostedKeyArgument("azure https://generated.openai.azure.com a=gpt-5.4 b=gpt-4.1"),
    { providerId: "azure", options: { endpoint: "https://generated.openai.azure.com", deployments: [{ name: "a", model: "gpt-5.4" }, { name: "b", model: "gpt-4.1" }] } });
  for (const bad of ["chatgpt", "groq sk-generated-key", "bedrock", "bedrock us-east-1 extra", "azure https://example.invalid a=b", "azure https://generated.openai.azure.com"]) {
    assert.throws(() => parseHostedKeyArgument(bad), /Never put credentials in the composer/, bad);
  }
  const lab = (apiModelId: string, providerId: string) => modelLab({ id: `hosted.${providerId}.x`, name: apiModelId, apiModelId, providerId, source: "hosted" }).id;
  assert.deepEqual([lab("us.anthropic.claude-sonnet-5", "bedrock"), lab("amazon.nova-pro-v1:0", "bedrock"), lab("meta.llama3-3-70b-instruct-v1:0", "bedrock"),
    lab("gemini-3.8-flash", "vertex"), lab("grok-4.7", "xai"), lab("openai/gpt-oss-120b", "groq"), lab("deepseek-flash", "deepseek")],
  ["anthropic", "amazon", "meta", "google", "xai", "openai", "deepseek"]);
});

test("cloud and catalogue providers keep keys in the vault, need their own connection options and stream through the worker", mac, async () => {
  const api = await fakeCloud(), { secrets, vault } = memoryVault();
  const fixture = await setupFixture({ platform: { models: { vault, hosted: { baseUrls: { gemini: `${api.base}/v1beta`, groq: `${api.base}/openai/v1`, deepseek: api.base, azure: `${api.base}/openai/v1` } } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const keys = { gemini: "AIza-generated-gemini-key", groq: "gsk_generated_groq_key", deepseek: "sk-generated-deepseek-key", azure: "generated-azure-key-0001",
    bedrock: "ABSK-generated-bedrock-key", vertex: "AQ.generated-vertex-key", xai: "xai-generated-key", mistral: "generated-mistral-key" };
  // Offerings, not selectable models: Vertex AI serves the same upstream IDs as the Gemini API, so those wait for an explicit source choice.
  const listed = (providerId: string) => (sdk.getState().snapshot?.provider.catalogue?.models ?? []).flatMap((entry) => entry.offerings)
    .filter((offering) => offering.model.providerId === providerId).map((offering) => offering.model);
  const turn = async (modelId: string, prompt: string) => {
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId });
    await fixture.send(prompt);
    const finished = await fixture.terminal();
    assert.equal(finished.status, "completed", finished.lastError ?? "");
    return finished;
  };
  try {
    // Gemini API: the key travels only as the Gemini API key header.
    await sdk.models.hosted.setKey("gemini", keys.gemini);
    const gemini = googleProvider().getModels().find((model) => model.id === "gemini-2.5-flash")!;
    await waitFor(() => listed("gemini").some((model) => model.apiModelId === gemini.id), 15_000);
    const replied = await turn(hostedModelId("gemini", gemini.id), "Generated Gemini request.");
    assert.ok(replied.messages.some((message) => message.role === "assistant" && message.text.includes("Generated Gemini reply.")));
    const geminiRequest = api.seen.find((entry) => entry.path.endsWith(`models/${gemini.id}:streamGenerateContent`))!;
    assert.equal(geminiRequest.headers["x-goog-api-key"], keys.gemini);

    // Groq and DeepSeek: OpenAI-compatible catalogue providers.
    for (const [id, model] of [["groq", groqProvider().getModels()[0]!], ["deepseek", deepseekProvider().getModels()[0]!]] as const) {
      await sdk.models.hosted.setKey(id, keys[id]);
      await waitFor(() => listed(id).some((entry) => entry.apiModelId === model.id), 15_000);
      await turn(hostedModelId(id, model.id), `Generated ${id} request.`);
      const sent = api.seen.findLast((entry) => entry.path.endsWith("/chat/completions"))!;
      assert.deepEqual([sent.headers.authorization, sent.body?.model], [`Bearer ${keys[id]}`, model.id]);
    }

    // Azure needs its endpoint and deployments with the key; each deployment is routed by its own name.
    await assert.rejects(sdk.models.hosted.setKey("azure", keys.azure), /endpoint and at least one deployment/);
    await assert.rejects(sdk.models.hosted.setKey("azure", keys.azure, undefined, { endpoint: "https://generated.openai.azure.com", deployments: [{ name: "generated", model: "generated-unknown-model" }] }), /isn't in the Azure OpenAI catalogue/);
    await assert.rejects(sdk.models.hosted.setKey("groq", keys.groq, undefined, { region: "us-east-1" }), /takes only an API key/);
    assert.equal(secrets.has(hostedSecretId("azure")), false);
    const azure = { endpoint: "https://generated-resource.openai.azure.com", deployments: [{ name: "generated-deployment", model: "deepseek-v4-pro" }] };
    await sdk.models.hosted.setKey("azure", keys.azure, undefined, azure);
    await waitFor(() => listed("azure").some((entry) => entry.apiModelId === "generated-deployment"), 15_000);
    assert.deepEqual(sdk.settings.get()!.values.hostedProviderOptions?.azure, azure);
    await turn(hostedModelId("azure", "generated-deployment"), "Generated Azure request.");
    const azureRequest = api.seen.findLast((entry) => entry.path.endsWith("/chat/completions"))!;
    assert.equal(azureRequest.body?.model, "generated-deployment");
    assert.ok(JSON.stringify(azureRequest.headers).includes(keys.azure));

    // A generic settings write cannot redirect a stored key to another endpoint or region.
    const current = sdk.settings.get()!;
    await assert.rejects(sdk.settings.update({ ...current.values, hostedProviderOptions: { azure: { ...azure, endpoint: "https://other-resource.openai.azure.com" } } }, current.revision), /cannot redirect a stored key/);

    // Bedrock: the Region decides which cross-Region inference profiles are listed.
    await assert.rejects(sdk.models.hosted.setKey("bedrock", keys.bedrock), /AWS Region/);
    await sdk.models.hosted.setKey("bedrock", keys.bedrock, undefined, { region: "eu-west-1" });
    await waitFor(() => listed("bedrock").length > 0, 15_000);
    const bedrock = listed("bedrock").map((model) => model.apiModelId!);
    assert.ok(bedrock.some((id) => id.startsWith("eu.")));
    assert.equal(bedrock.some((id) => /^(us|apac|au|jp|ca)\./.test(id)), false);
    assert.deepEqual(sdk.settings.get()!.values.hostedProviderOptions?.bedrock, { region: "eu-west-1" });

    // Vertex AI, xAI and Mistral connect with a key alone and label their models with the training lab.
    for (const id of ["vertex", "xai", "mistral"] as const) {
      await sdk.models.hosted.setKey(id, keys[id]);
      await waitFor(() => listed(id).length > 0, 15_000);
      const provider = sdk.getState().snapshot!.provider.catalogue!.providers.find((entry) => entry.id === id)!;
      assert.deepEqual([provider.status, provider.account?.credential], ["connected", "api_key"]);
      assert.equal(modelLab(listed(id)[0]!).id, { vertex: "google", xai: "xai", mistral: "mistral" }[id]);
    }
    const shared = sdk.getState().snapshot!.provider.catalogue!.models.find((entry) => entry.apiModelId === "gemini-2.5-flash")!;
    assert.deepEqual([shared.offerings.map((offering) => offering.model.providerId).sort(), shared.diagnostic], [["gemini", "vertex"], "Choose one provider for this model."]);
    for (const [id, key] of Object.entries(keys)) assert.deepEqual(JSON.parse(secrets.get(hostedSecretId(id as "gemini"))!), { type: "api_key", key });
    const retained = JSON.stringify([sdk.getState().snapshot, fixture.service.controller.events(0)]);
    for (const key of Object.values(keys)) assert.equal(retained.includes(key), false, "a key reached the snapshot or event history");

    // Removing a provider deletes its key and its connection options.
    await sdk.models.hosted.remove("bedrock");
    await sdk.models.hosted.remove("azure");
    assert.equal(secrets.has(hostedSecretId("bedrock")), false);
    assert.equal(sdk.settings.get()!.values.hostedProviderOptions, undefined);
    await waitFor(() => !listed("azure").length && !listed("bedrock").length);
  } finally { sdk.disconnect(); await fixture.close(); await api.close(); }
});
