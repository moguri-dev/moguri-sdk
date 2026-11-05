import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultModelPreferences, MoguriSdk, type LocalEndpoint, type ProviderState } from "../packages/sdk/src/index.ts";
import { ModelRegistry } from "../apps/service/src/model-registry.ts";
import type { ProviderAdapter } from "../apps/service/src/provider.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { assertOperationLatency } from "./fixtures/latency-budgets.ts";

function generatedProvider() {
  const gate = Promise.withResolvers<void>();
  let calls = 0;
  const provider: ProviderAdapter = {
    state: { status: "connected", models: [{ id: "generated-refresh", name: "Generated refresh model", contextWindow: 8192, maxTokens: 1024, imageInput: false }],
      login: null, diagnostic: null } satisfies ProviderState,
    onChange: () => {},
    refresh: async (signal) => { calls++; await gate.promise; signal?.throwIfAborted(); },
    login: () => { throw new Error("Generated model refresh cannot authenticate."); },
    cancel: async () => {},
    logout: async () => {},
    prepare: async () => { throw new Error("Generated model refresh cannot prepare inference."); },
  };
  return { provider, gate, calls: () => calls };
}
const vault = { read: async () => null, write: async () => {}, remove: async () => {} };

test("concurrent startup/manual model refreshes share one actual current-scope discovery", async () => {
  const f = generatedProvider(), registry = new ModelRegistry(f.provider, () => [], { vault });
  const first = registry.refresh();
  await waitFor(() => f.calls() === 1);
  const second = registry.refresh();
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(f.calls(), 1);
    f.gate.resolve(); await Promise.all([first, second]);
    await registry.refresh();
    assert.equal(f.calls(), 2, "A later app start must perform fresh discovery, not borrow a settled result.");
  } finally { f.gate.resolve(); await Promise.allSettled([first, second]); await registry.close(); }
});

test("cancelling one refresh subscriber does not cancel or duplicate the original discovery", async () => {
  const f = generatedProvider(), registry = new ModelRegistry(f.provider, () => [], { vault });
  const first = registry.refresh();
  await waitFor(() => f.calls() === 1);
  const abort = new AbortController();
  let rejected = false;
  const second = registry.refresh(abort.signal).catch((error: unknown) => { assert.equal(error, abort.signal.reason); rejected = true; });
  try {
    abort.abort(new Error("Generated subscriber stopped."));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(rejected, true);
    assert.equal(f.calls(), 1);
    assert.equal(registry.state.models.length, 1);
    f.gate.resolve(); await Promise.all([first, second]);
  } finally { f.gate.resolve(); await Promise.allSettled([first, second]); await registry.close(); }
});

test("a changed provider scope waits for original refresh then discovers the new enabled source exactly once", async () => {
  const f = generatedProvider(), preferences = defaultModelPreferences(), release = Promise.withResolvers<void>();
  preferences.disabledProviders = ["github-copilot"];
  const endpoints: LocalEndpoint[] = [{ id: "generated", name: "Generated endpoint", enabled: true, baseUrl: "http://127.0.0.1:12345/v1", auth: "none",
    models: [{ id: "generated-local", name: "Generated local model", contextWindow: 8192, maxTokens: 1024, imageInput: false }] }];
  let fetches = 0;
  const registry = new ModelRegistry(f.provider, () => endpoints, { vault, preferences: () => preferences,
    fetch: async () => { fetches++; await release.promise; return Response.json({ data: [{ id: "generated-local" }] }); } });
  const first = registry.refresh();
  await waitFor(() => fetches === 1);
  preferences.disabledProviders = [];
  const second = registry.refresh();
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(f.calls(), 0, "A new-scope refresh cannot overtake the original owner.");
    assert.equal(fetches, 1);
    release.resolve(); f.gate.resolve(); await Promise.all([first, second]);
    assert.equal(f.calls(), 1); assert.equal(fetches, 2);
    assert.equal(registry.state.connections?.find((provider) => provider.id === "github-copilot")?.status, "connected");
  } finally { release.resolve(); f.gate.resolve(); await Promise.allSettled([first, second]); await registry.close(); }
});

test("closing before admitted discovery starts reads no account or endpoint", async () => {
  const f = generatedProvider(), registry = new ModelRegistry(f.provider, () => [], { vault });
  const refreshing = assert.rejects(registry.refresh(), /closed before discovery/);
  await registry.close(); await refreshing;
  assert.equal(f.calls(), 0);
  await assert.rejects(registry.refresh(), /discovery is closed/);
});

test("shared discovery failure remains a real failure for every caller and clears old availability", async () => {
  const f = generatedProvider(), error = new Error("Generated exact provider discovery failed.");
  let calls = 0;
  f.provider.refresh = async () => { calls++; await f.gate.promise; throw error; };
  const registry = new ModelRegistry(f.provider, () => [], { vault });
  const first = registry.refresh(), second = registry.refresh();
  const failures = Promise.all([assert.rejects(first, (value) => value === error), assert.rejects(second, (value) => value === error)]);
  try {
    f.gate.resolve(); await failures;
    assert.equal(calls, 1); assert.equal(registry.state.status, "error"); assert.deepEqual(registry.state.models, []);
    assert.match(registry.state.diagnostic!, /discovery failed/);
  } finally { f.gate.resolve(); await failures; await registry.close(); }
});

test("held model metadata discovery leaves ordinary session and draft acknowledgements responsive", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready(), release = Promise.withResolvers<void>();
  const original = f.provider.refresh.bind(f.provider);
  let entered = false, refresh: Promise<unknown> | undefined;
  f.provider.refresh = async (signal?: AbortSignal) => { entered = true; await release.promise; signal?.throwIfAborted(); await original(); };
  try {
    refresh = sdk.models.refresh(); await waitFor(() => entered);
    const began = performance.now(), created = await sdk.sessions.create(null, "Generated refresh-independent chat");
    assertOperationLatency("session.create", performance.now() - began);
    const draftBegan = performance.now();
    await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "Generated preserved refresh draft.", attachments: [] });
    assertOperationLatency("draft.save", performance.now() - draftBegan);
    assert.equal(f.requests.length, 0);
    release.resolve(); await refresh;
    assert.equal(sdk.sessions.get(created.id!)?.draft.text, "Generated preserved refresh draft.");
  } finally { release.resolve(); await refresh; f.provider.refresh = original; sdk.disconnect(); await f.close(); }
});
