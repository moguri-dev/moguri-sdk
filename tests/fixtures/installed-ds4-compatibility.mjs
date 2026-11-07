import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fixtureProvider, waitFor } from "../fixture.ts";

const packageRoot = process.argv[2];
assert.ok(packageRoot, "Pass the exact independently installed SDK package root.");
const { MoguriSdk } = await import(pathToFileURL(join(packageRoot, "dist/sdk/index.mjs")).href);
const { createRuntime } = await import(pathToFileURL(join(packageRoot, "dist/sdk/node.mjs")).href);
const directory = await mkdtemp(join(tmpdir(), "moguri-packed-ds4-"));
const home = join(directory, "home"), retentionKey = randomBytes(32);
let api, runtime, sdk;
try {
  await mkdir(home, { mode: 0o700 });
  api = await fixtureProvider({ exposeModels: true, modelId: "generated-packed-ds4",
    modelMetadata: { owned_by: "ds4.c", context_length: 32768 },
    usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52,
      prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 0 } } });
  await api.provider.logout();
  const vault = { read: async () => null, write: async () => { throw new Error("Generated DS4 has no credentials."); }, remove: async () => {} };
  const options = { stateDir: join(directory, "state"), retentionKey, provider: api.provider,
    platform: { models: { vault }, terminal: { defaultRoot: home, vault } } };
  runtime = await createRuntime(options);
  sdk = await new MoguriSdk(runtime.connection).ready();
  const settings = sdk.settings.get();
  await sdk.settings.update({ ...settings.values, chatTitles: { enabled: false, modelId: null },
    localModels: [{ id: "packed-ds4", name: "Generated installed DS4", enabled: true, baseUrl: `${api.baseUrl}/v1`, auth: "none",
      models: [{ id: api.modelId, name: "Generated DS4 model", contextWindow: 32768, maxTokens: 4096, imageInput: false, toolInput: false }] }],
  }, settings.revision);
  await sdk.models.refresh();
  const model = sdk.getState().snapshot.provider.models.find((entry) => entry.source === "local");
  assert.ok(model);
  const created = await sdk.sessions.create(null, "Generated packed DS4", { modelId: model.id, env: "Local", autonomy: "Manual" });
  const session = () => runtime.controller.snapshot().sessions.find((entry) => entry.id === created.id);
  const saved = await sdk.command({ type: "draft.save", sessionId: created.id, expectedRevision: session().draft.revision,
    text: "Generated packed DS4 compatibility request.", attachments: [] });
  await sdk.command({ type: "message.send", sessionId: created.id, expectedRevision: saved.revision, delivery: "queue" });
  await waitFor(() => !session().turnId && session().status === "completed");
  await sdk.refresh();
  const usage = sdk.sessions.get(created.id).usage[0];
  assert.equal(usage.cacheWriteTokens, 0); assert.equal(usage.stream.cacheWriteReported, true);
  assert.equal(usage.inputTokens, 0); assert.equal(usage.cacheReadTokens, 40); assert.equal(usage.totalTokens, 52);
  assert.equal(usage.source, "local"); assert.equal(usage.apiModelId, api.modelId); assert.equal(usage.billedUsd, null);
  assert.equal(api.headers[0], undefined); assert.equal(api.requests.length, 1);
  sdk.disconnect(); await runtime.close();
  runtime = await createRuntime(options);
  sdk = await new MoguriSdk(runtime.connection).ready();
  assert.deepEqual(sdk.sessions.get(created.id).usage[0], usage);
  assert.equal(api.requests.length, 1);
  console.log("Installed SDK DS4 cache categories and no-replay restart: PASS (generated protocol, not live weights).");
} finally {
  sdk?.disconnect();
  await runtime?.close();
  await api?.close();
  await rm(directory, { recursive: true });
}
