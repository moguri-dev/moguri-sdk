import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isRecord, MoguriSdk, type LocalEndpoint } from "../packages/sdk/src/index.ts";
import { fixtureProvider, reviewNativeTools, setupFixture, waitFor, type GeneratedProviderOptions } from "./fixture.ts";

const mac = { skip: process.platform !== "darwin", timeout: 20_000 };
const reasoning = "Generated DS4 protocol reasoning, not private user context.";
test("the live DS4 compatibility probe makes no endpoint request without explicit inference opt-in", { timeout: 10_000 }, async () => {
  let requests = 0;
  const server = createServer((_request, response) => { requests++; response.writeHead(500).end(); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    await assert.rejects(() => promisify(execFile)(process.execPath, [resolve("scripts/qualify-ds4.mjs"),
      "--base-url", `http://127.0.0.1:${address.port}/v1`, "--model", "generated-ds4",
      "--context-window", "32768", "--tools"], { timeout: 5000 }), /Explicit live inference is required/);
    assert.equal(requests, 0);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test("the opt-in probe requires a real one-use file approval even when factory Manual would allow writes", mac, async () => {
  const api = await fixtureProvider({ exposeModels: true, modelId: "generated-ds4-probe",
    modelMetadata: { owned_by: "ds4.c", context_length: 32768,
      architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: ["tools", "stream"] },
    respond: (request) => {
      const history = messages(request), prompt = history.findLast((entry) => entry.role === "user")?.content;
      const text = typeof prompt === "string" ? prompt : Array.isArray(prompt) ? prompt.filter(isRecord).map((entry) => entry.text).join("") : "";
      if (text.includes("fictional generated counting algorithm")) return { hold: true, text: "Generated held DS4 probe." };
      if (text.includes("Create one generated file")) {
        if (history.at(-1)?.role === "tool") return { text: "MOGURI_DS4_FILE_READY" };
        return { tool: { name: "write_file", args: { path: "ds4-generated.txt", text: "MOGURI_DS4_FILE_READY\n", expectedDigest: "absent" } } };
      }
      return { text: "MOGURI_DS4_READY" };
    },
  });
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [resolve("scripts/qualify-ds4.mjs"), "--live",
      "--base-url", `${api.baseUrl}/v1`, "--model", api.modelId, "--context-window", "32768", "--tools"], { timeout: 15_000 });
    const report: unknown = JSON.parse(stdout);
    assert.ok(isRecord(report) && Array.isArray(report.results));
    assert.equal(report.results.filter(isRecord).find((entry) => entry.label === "explicit approved generated-file tool round trip")?.outcome, "completed");
    assert.equal(report.results.filter(isRecord).find((entry) => entry.label === "live cancellation")?.outcome, "stopped");
    assert.match(String(report.cleanup), /state, generated files and workers removed/);
    assert.equal(api.requests.length, 5);
  } finally { await api.close(); }
});

async function configuredDs4(options: GeneratedProviderOptions = {}) {
  const f = await setupFixture({
    modelId: "generated-ds4-v4.1", exposeModels: true, reasoningText: reasoning, reasoningOnToolCalls: true, splitToolArguments: true,
    modelMetadata: { object: "model", owned_by: "ds4.c", name: "Generated DS4 protocol model", context_length: 32768,
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      top_provider: { context_length: 32768, max_completion_tokens: 4096 },
      supported_parameters: ["tools", "tool_choice", "max_tokens", "stream", "reasoning_effort"] },
    usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52,
      prompt_tokens_details: { cached_tokens: 9, cache_write_tokens: 11 } },
    ...options,
  });
  let sdk: MoguriSdk | undefined;
  try {
    await f.provider.logout();
    sdk = await new MoguriSdk(f.service.connection).ready();
    const settings = sdk.settings.get()!;
    const endpoint: LocalEndpoint = { id: "generated-ds4", name: "Generated DS4 protocol endpoint", enabled: true,
      baseUrl: `${f.baseUrl}/v1`, auth: "none", runtime: { kind: "ds4" },
      models: [{ id: f.modelId, name: "Generated DS4 protocol model", contextWindow: 32768,
        maxTokens: 4096, imageInput: false, toolInput: true }] };
    await sdk.settings.update({ ...settings.values, localModels: [endpoint], chatTitles: { enabled: false, modelId: null } }, settings.revision);
    await sdk.models.refresh();
    const model = sdk.getState().snapshot!.provider.models.find((entry) => entry.source === "local");
    assert.ok(model);
    await sdk.sessions.selectModel(f.sessionId, model.id);
    return { f, sdk, model, close: async () => { sdk!.disconnect(); await f.close(); } };
  } catch (error) {
    sdk?.disconnect();
    try { await f.close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "Generated DS4 setup and cleanup both failed."); }
    throw error;
  }
}
function messages(request: Record<string, unknown>) {
  assert.ok(Array.isArray(request.messages));
  return request.messages.filter(isRecord);
}

test("DS4-shaped streamed replies preserve reasoning/history and exact keyless model provenance", mac, async () => {
  const { f, sdk, model, close } = await configuredDs4({ replyText: "Generated DS4 response." });
  try {
    await f.send("Generated DS4 ordinary request.");
    assert.equal((await f.terminal()).status, "completed");
    await f.send("Generated ordinary DS4 follow-up.");
    assert.equal((await f.terminal()).status, "completed");
    assert.equal(f.requests.length, 2);
    for (const request of f.requests) {
      assert.equal(request.model, f.modelId); assert.equal(request.stream, true);
      assert.equal(request.max_tokens, 4096);
      assert.deepEqual(request.stream_options, { include_usage: true });
      assert.equal(request.store, undefined); assert.equal(request.reasoning_effort, undefined);
      assert.equal(messages(request).some((message) => message.role === "developer"), false);
    }
    assert.deepEqual(f.headers, [undefined, undefined]);
    assert.equal(messages(f.requests[1]!).find((message) => message.role === "assistant")?.reasoning_content, reasoning);
    const deltas = f.service.controller.events(0).filter((event) => event.event_type === "assistant.delta");
    assert.ok(deltas.length >= 2);
    for (const usage of f.session().usage) {
      assert.equal(usage.modelId, model.id); assert.equal(usage.apiModelId, f.modelId);
      assert.equal(usage.providerId, "local.generated-ds4"); assert.equal(usage.source, "local");
      assert.equal(usage.quality, "provider-reported"); assert.equal(usage.totalTokens, 52);
      assert.equal(usage.inputTokens, 20); assert.equal(usage.cacheReadTokens, 9); assert.equal(usage.cacheWriteTokens, 11);
      assert.equal(usage.billedUsd, null); assert.equal(usage.providerReportedUsd, null);
    }
    assert.equal(f.provider.state.status, "disconnected");
    assert.deepEqual(model.thinkingLevels, []);
    const saved = await sdk.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: f.session().draft.revision, text: "Generated preserved DS4 draft.", attachments: [] });
    await assert.rejects(() => sdk.sessions.configure(f.sessionId, { ...f.session().controls, modelOptions: { thinkingEffort: "low" } }), /not supported/i);
    await sdk.sessions.configure(f.sessionId, { ...f.session().controls, modelOptions: { contextWindow: 24577 } });
    assert.equal(f.session().controls.modelOptions?.contextWindow, 24577);
    assert.equal(f.session().draft.revision, saved.revision); assert.equal(f.session().draft.text, "Generated preserved DS4 draft.");
    assert.equal(f.requests.length, 2);
  } finally { await close(); }
});

test("explicit DS4 cache-write zero stays reported zero rather than unknown or double-counted input", mac, async () => {
  const { f, close } = await configuredDs4({ usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52,
    prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 0 } } });
  try {
    await f.send("Generated DS4 fully cached input.");
    assert.equal((await f.terminal()).status, "completed");
    const usage = f.session().usage[0]!;
    assert.equal(usage.cacheWriteTokens, 0);
    assert.equal(usage.stream?.cacheWriteReported, true);
    assert.equal(usage.inputTokens, 0); assert.equal(usage.cacheReadTokens, 40);
    assert.equal(usage.totalTokens, 52); assert.equal(usage.billedUsd, null);
  } finally { await close(); }
});

for (const id of ["generated-ds4-opaque-9f0bd", "generated\u0000malformed-id"]) {
  test(`DS4 tool round trips retain approved arguments and ${id.includes("\u0000") ? "normalize malformed" : "preserve opaque"} IDs`, mac, async () => {
    const { f, sdk, close } = await configuredDs4({ toolCallId: id,
      toolCall: { name: "write_file", args: { path: "ds4-generated.txt", text: "Generated DS4 file.\n", expectedDigest: "absent" } } });
    try {
      await reviewNativeTools(sdk, ["write_file"]);
      await f.send("Generated DS4 tool round trip.");
      const approval = await waitFor(() => f.session().pendingApproval);
      assert.equal(approval.call.name, "write_file");
      assert.deepEqual(approval.call.arguments, { path: "ds4-generated.txt", text: "Generated DS4 file.\n", expectedDigest: "absent" });
      if (!id.includes("\u0000")) assert.equal(approval.call.id, id);
      else { assert.notEqual(approval.call.id, id); assert.ok(!/[\u0000-\u001f\u007f]/.test(approval.call.id)); }
      await f.approve();
      assert.equal((await f.terminal()).status, "completed");
      assert.equal(await readFile(join(f.project, "ds4-generated.txt"), "utf8"), "Generated DS4 file.\n");
      const replay = messages(f.requests[1]!);
      const assistant = replay.find((message) => message.role === "assistant" && Array.isArray(message.tool_calls));
      assert.equal(assistant?.reasoning_content, reasoning);
      assert.equal(replay.find((message) => message.role === "tool")?.tool_call_id, approval.call.id);
      assert.equal(f.requests.length, 2);
    } finally { await close(); }
  });
}

test("DS4-shaped truncated tool output stays partial and performs no generated-file effect", mac, async () => {
  const { f, close } = await configuredDs4({ finishReason: "length",
    toolCall: { name: "write_file", args: { path: "ds4-generated.txt", text: "Generated forbidden partial effect.\n", expectedDigest: "absent" } } });
  try {
    await f.send("Generated DS4 output-limit failure.");
    const terminal = await f.terminal();
    assert.equal(terminal.status, "partial"); assert.match(terminal.lastError!, /output limit|incomplete/i);
    assert.equal(terminal.pendingApproval, null); assert.equal(f.requests.length, 1);
    await assert.rejects(() => access(join(f.project, "ds4-generated.txt")), { code: "ENOENT" });
  } finally { await close(); }
});

for (const options of [{ omitUsage: true }, { incompleteStream: true }, { httpFailure: { status: 503, message: "Generated DS4 endpoint loss." } }]) {
  test(`DS4 ${"omitUsage" in options ? "missing usage" : "incompleteStream" in options ? "missing terminal frame" : "endpoint failure"} never invents usage or substitutes a provider`, mac, async () => {
    const { f, model, close } = await configuredDs4(options);
    try {
      await f.send("Generated DS4 accounting/error qualification.");
      const terminal = await f.terminal();
      assert.equal(terminal.status, "omitUsage" in options ? "completed" : "failed");
      assert.equal(terminal.usage[0]?.quality, "unknown"); assert.equal(terminal.usage[0]?.totalTokens, null);
      assert.equal(terminal.usage[0]?.inputTokens, null); assert.equal(terminal.usage[0]?.outputTokens, null);
      assert.equal(terminal.usage[0]?.billedUsd, null);
      assert.equal(terminal.controls.modelId, model.id); assert.equal(f.requests.length, 1);
      assert.equal(f.provider.state.status, "disconnected");
      assert.ok(f.service.controller.snapshot().budgetEntries.some((entry) => entry.id === terminal.usage[0]?.stepId && entry.status === "unknown"));
    } finally { await close(); }
  });
}

test("cancelling an owned DS4 stream preserves an unrelated saved draft and unknown accounting without replay", mac, async () => {
  const { f, sdk, model, close } = await configuredDs4({ respond: () => ({ hold: true, text: "Generated DS4 partial stream." }) });
  try {
    await f.send("Generated DS4 cancellation request.");
    await waitFor(() => f.requests.length === 1);
    await sdk.command({ type: "draft.save", sessionId: f.sessionId, expectedRevision: f.session().draft.revision, text: "Generated preserved after DS4 cancellation.", attachments: [] });
    await sdk.command({ type: "session.stop", sessionId: f.sessionId });
    const terminal = await f.terminal();
    assert.equal(terminal.status, "stopped"); assert.equal(terminal.usage[0]?.outcome, "aborted");
    assert.equal(terminal.usage[0]?.quality, "unknown"); assert.equal(terminal.usage[0]?.totalTokens, null);
    assert.equal(terminal.draft.text, "Generated preserved after DS4 cancellation.");
    assert.equal(terminal.controls.modelId, model.id); assert.equal(f.requests.length, 1);
  } finally { await close(); }
});
