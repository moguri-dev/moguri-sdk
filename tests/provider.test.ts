import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { CopilotAdapter } from "../apps/service/src/provider.ts";
import { waitFor } from "./fixture.ts";
import { usagePresent } from "../apps/service/src/worker-protocol.ts";

test("the real pi-ai Copilot device flow discovers only enabled account models and refreshes through the secret backend", async () => {
  const fetch = globalThis.fetch;
  const credentials = new InMemoryCredentialStore();
  const adapter = new CopilotAdapter(credentials);
  const model = githubCopilotProvider().getModels()[0]!;
  let exchanges = 0;
  globalThis.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/login/device/code")) return Response.json({ device_code: "generated-device", user_code: "TEST-0000", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 1 });
    if (url.endsWith("/login/oauth/access_token")) return Response.json({ access_token: "generated-refresh-token" });
    if (url.endsWith("/copilot_internal/v2/token")) { exchanges++; return Response.json({ token: "generated-access-token", expires_at: Date.now() / 1000 + 3600 }); }
    if (url.endsWith("/models")) return Response.json({ data: [{ id: model.id, model_picker_enabled: true, policy: { state: "enabled" } }] });
    throw new Error("Unexpected fixture URL; no live network requests are permitted.");
  };
  try {
    await adapter.refresh();
    assert.equal(adapter.state.status, "disconnected");
    adapter.login();
    await waitFor(() => adapter.state.login);
    assert.equal(adapter.state.login?.code, "TEST-0000");
    await waitFor(() => adapter.state.status === "connected");
    assert.deepEqual(adapter.state.models.map((model) => model.id), [model.id]);
    assert.equal(adapter.state.models[0]?.maxTokens, model.maxTokens);
    assert.equal(adapter.state.models[0]?.endpointBoundary, "network");
    await credentials.modify("github-copilot", async (credential) => {
      if (credential?.type !== "oauth") throw new Error("Generated credential missing.");
      return { ...credential, expires: 0 };
    });
    const prepared = await adapter.prepare(model.id, AbortSignal.timeout(2000));
    assert.equal(prepared.auth.apiKey, "generated-access-token");
    assert.equal(exchanges, 2);
    await assert.rejects(() => adapter.prepare("generated-unavailable-model", AbortSignal.timeout(1000)), /unavailable/);
    await adapter.logout();
    assert.equal(await credentials.read("github-copilot"), undefined);
  } finally { await adapter.cancel(); globalThis.fetch = fetch; }
});

test("cancelling a pending device flow writes no credential and surfaces a cancelled state", async () => {
  const fetch = globalThis.fetch;
  const credentials = new InMemoryCredentialStore();
  const adapter = new CopilotAdapter(credentials);
  globalThis.fetch = async () => Response.json({ device_code: "generated-device", user_code: "TEST-0000", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 });
  try {
    adapter.login();
    await waitFor(() => adapter.state.login);
    const start = Date.now();
    await adapter.cancel();
    assert.ok(Date.now() - start < 200);
    assert.equal(adapter.state.status, "disconnected");
    assert.match(adapter.state.diagnostic!, /cancelled/);
    assert.equal(await credentials.read("github-copilot"), undefined);
  } finally { globalThis.fetch = fetch; }
});

test("empty or preliminary provider telemetry is not reported as zero complete usage", () => {
  assert.equal(usagePresent({ usage: {} }), false);
  assert.equal(usagePresent({ usage: { prompt_tokens: 30 } }), false);
  assert.equal(usagePresent({ type: "message_start", message: { usage: { input_tokens: 30, output_tokens: 0 } } }), false);
  assert.equal(usagePresent({ usage: { prompt_tokens: 30, completion_tokens: 12 } }), true);
  assert.equal(usagePresent({ type: "message_delta", usage: { output_tokens: 12 } }), true);
  assert.equal(usagePresent({ type: "response.completed", response: { usage: { input_tokens: 30, output_tokens: 12 } } }), true);
});

test("sign-out invalidates a racing token refresh and cannot be overwritten by stale connected state", async () => {
  const fetch = globalThis.fetch;
  const credentials = new InMemoryCredentialStore();
  const model = githubCopilotProvider().getModels()[0]!;
  await credentials.modify("github-copilot", async () => ({
    type: "oauth", refresh: "generated-refresh", access: "generated-expired", expires: 0, availableModelIds: [model.id],
  }));
  let entered = false;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/copilot_internal/v2/token")) {
      entered = true; await gate;
      return Response.json({ token: "generated-refreshed", expires_at: Date.now() / 1000 + 3600 });
    }
    if (url.endsWith("/models")) return Response.json({ data: [{ id: model.id, model_picker_enabled: true, policy: { state: "enabled" } }] });
    throw new Error("Unexpected fixture request.");
  };
  const adapter = new CopilotAdapter(credentials);
  try {
    const refreshing = adapter.refresh();
    await waitFor(() => entered);
    const logout = adapter.logout();
    assert.throws(() => adapter.login(), /account change/);
    release();
    await Promise.all([refreshing, logout]);
    assert.equal(adapter.state.status, "disconnected");
    assert.equal(adapter.state.models.length, 0);
    assert.equal(await credentials.read("github-copilot"), undefined);
  } finally { release(); globalThis.fetch = fetch; }
});
