import assert from "node:assert/strict";
import test from "node:test";
import { MoguriSdk, defaultModelPreferences, type LocalEndpoint } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { localModelId, ModelRegistry } from "../apps/service/src/model-registry.ts";
import { startService } from "../apps/service/src/server.ts";
import { join } from "node:path";
import { profileFixture } from "./fixtures/profiles.ts";

test("a profile can keep only three of twenty-one models enabled and disabled IDs cannot be selected through slash or raw commands", async () => {
  const fixture = await setupFixture();
  const original = fixture.provider.state.models[0]!;
  const generated = Array.from({ length: 20 }, (_, index) => ({ ...original, id: `generated-catalog-model-${index + 1}`,
    apiModelId: `generated-catalog-model-${index + 1}`, name: `Generated catalog model ${index + 1}` }));
  fixture.provider.state.models.push(...generated); fixture.provider.onChange();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await sdk.refresh();
    for (const model of generated.slice(2)) await sdk.models.setEnabled(model.apiModelId, false);
    const selectable = sdk.getState().snapshot!.provider.models.filter((model) => !model.synthetic);
    assert.deepEqual(selectable.map((model) => model.id).sort(), [fixture.modelId, generated[0]!.id, generated[1]!.id].sort());
    const catalogue = sdk.models.catalogue();
    assert.equal(catalogue.models.length, 21);
    assert.equal(catalogue.models.filter((model) => model.enabled).length, 3);
    const saved = structuredClone(fixture.session().controls);
    await assert.rejects(() => sdk.slash(fixture.sessionId, `/model ${generated[2]!.id}`), /disabled|available/i);
    await assert.rejects(() => sdk.command({ type: "session.configure", sessionId: fixture.sessionId,
      expectedRevision: fixture.session().revision, controls: { ...saved, modelId: generated[2]!.id } }), /disabled|available/i);
    await assert.rejects(() => sdk.sessions.create(null, "Generated rejected disabled override", { modelId: generated[2]!.id }), /disabled|available/i);
    await assert.rejects(() => fixture.service.controller.provider.prepare(generated[2]!.id, AbortSignal.timeout(1000)), /disabled|available/i);
    assert.deepEqual(fixture.session().controls, saved);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("configured but unqualified SSH inventory never discovers hosts, reads credentials or prepares a model", async () => {
  let fetches = 0, credentialReads = 0;
  const registry = new ModelRegistry({
    state: { status: "disconnected", models: [], diagnostic: null, login: null }, onChange: () => {},
    refresh: async () => {}, cancel: async () => {}, logout: async () => {}, login: () => { throw new Error("Generated forbidden login."); },
    prepare: async () => { throw new Error("Generated forbidden provider preparation."); },
  }, () => [{ id: "unqualified", name: "Generated unqualified endpoint", enabled: true, baseUrl: "https://generated-model.invalid/v1", auth: "bearer",
    models: [{ id: "generated-unqualified-api", name: "Generated unqualified model", contextWindow: 8192, maxTokens: 128, imageInput: false }] }], {
    includeCopilot: false, nested: true, scope: "remote", ready: () => false, environments: ["Remote"], idPrefix: () => "remote.generated.local",
    preferences: defaultModelPreferences, fetch: async () => { fetches++; throw new Error("Generated forbidden discovery."); },
    vault: { read: async () => { credentialReads++; return "generated-unread-secret"; }, write: async () => {}, remove: async () => {} },
  });

  try {
    await registry.refresh();
    assert.equal(registry.state.catalogue!.providers[0]!.enabled, true);
    assert.equal(registry.state.catalogue!.providers[0]!.scope, "remote");
    assert.equal(registry.state.catalogue!.models[0]!.offerings[0]!.available, false);
    assert.match(registry.state.catalogue!.providers[0]!.diagnostic!, /Probe the exact configured SSH peer/);
    assert.equal(registry.state.models.length, 0);
    await assert.rejects(() => registry.prepare(registry.state.catalogue!.models[0]!.offerings[0]!.model.id, AbortSignal.timeout(1000)), /unavailable/);
    assert.equal(fetches, 0); assert.equal(credentialReads, 0);
  } finally { await registry.close(); }
});

test("a prepared API identity cannot replace the exact advertised source, and an upstream API named kupo is not the synthetic router", async (t) => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const prepare = fixture.provider.prepare.bind(fixture.provider);
    t.mock.method(fixture.provider, "prepare", async (id: string, signal: AbortSignal) => {
      const prepared = await prepare(id, signal);
      return { ...prepared, model: { ...prepared.model, id: "generated-other-api" } };
    });
    await assert.rejects(() => fixture.service.controller.provider.prepare(fixture.modelId, AbortSignal.timeout(1000)), /identity|exact.*API/i);
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, localModels: [{ id: "named-kupo", name: "Generated upstream name", enabled: false,
      baseUrl: `${fixture.baseUrl}/v1`, auth: "none", models: [{ id: "kupo", name: "Generated concrete upstream model", contextWindow: 8192, maxTokens: 128, imageInput: false }] }] }, settings.revision);
    await sdk.models.setEnabled("kupo", false);
    assert.equal(sdk.models.catalogue().models.find((model) => model.apiModelId === "kupo")!.enabled, false);
    assert.ok(sdk.getState().snapshot!.provider.models.some((model) => model.id === fixture.modelId));
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("provider switches preserve authentication, credentials and model flags, including existing endpoint settings", async () => {
  const secrets = new Map<string, string>();
  const fixture = await setupFixture({ exposeModels: true, platform: { models: { vault: {
    read: async (id) => secrets.get(id) ?? null, write: async (id, value) => { secrets.set(id, value); }, remove: async (id) => { secrets.delete(id); },
  } } } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const settings = sdk.settings.get()!, endpoint: LocalEndpoint = { id: "credential", name: "Generated credential source", enabled: true,
      baseUrl: `${fixture.baseUrl}/v1`, auth: "bearer", models: [{ id: fixture.modelId, name: "Generated shared model", contextWindow: fixture.contextWindow, maxTokens: 128, imageInput: false }] };
    await sdk.settings.update({ ...settings.values, localModels: [endpoint] }, settings.revision);
    await sdk.models.setToken(endpoint.id, "generated-availability-secret");
    const retainedSecrets = [...secrets];
    assert.equal(retainedSecrets.length, 1);
    await sdk.models.selectSource(fixture.modelId, localModelId(endpoint.id, fixture.modelId));
    await sdk.models.setEnabled(fixture.modelId, false);
    await sdk.models.setProviderEnabled("local.credential", false);
    await sdk.models.setProviderEnabled("github-copilot", false);
    assert.equal(fixture.provider.state.status, "connected");
    assert.deepEqual([...secrets], retainedSecrets);
    await assert.rejects(() => sdk.command({ type: "provider.login" }), /Enable GitHub Copilot/i);
    await sdk.models.setProviderEnabled("github-copilot", true);
    assert.equal(sdk.models.catalogue().models[0]!.enabled, false);
    const current = sdk.settings.get()!;
    await sdk.settings.update({ ...current.values, localModels: [{ ...endpoint, enabled: true }] }, current.revision);
    await waitFor(() => sdk.models.catalogue().providers.find((provider) => provider.id === "local.credential")?.enabled);
    await sdk.models.setEnabled(fixture.modelId, true);
    await waitFor(() => sdk.getState().snapshot?.provider.models.some((model) => model.id === localModelId(endpoint.id, fixture.modelId)));
    assert.deepEqual([...secrets], retainedSecrets);
    assert.equal(fixture.requests.length, 0);
    assert.equal(JSON.stringify(sdk.getState()).includes("generated-availability-secret"), false);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("availability commands reject stale peers and remain isolated to the immutable profile", async () => {
  const fixture = await profileFixture();
  try {
    const { client: other } = await fixture.create("Generated availability profile"), apiModelId = fixture.providers[0]!.modelId;
    const revision = fixture.sdk.settings.get()!.revision;
    const results = await Promise.allSettled([
      fixture.sdk.models.setEnabled(apiModelId, false, revision),
      fixture.sdk.models.setProviderEnabled("github-copilot", false, revision),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected?.status === "rejected"); assert.equal(rejected.reason.code, "revision_conflict");
    await other.refresh();
    assert.equal(other.models.catalogue().providers[0]!.enabled, true);
    assert.equal(other.models.catalogue().models[0]!.enabled, true);
    assert.ok(other.getState().snapshot!.provider.models.some((model) => model.id === apiModelId));
    assert.ok(other.getState().events.every((event) => event.profile_id === other.profileId));
    assert.equal(fixture.providers.reduce((sum, provider) => sum + provider.requests.length, 0), 0);
  } finally { await fixture.close(); }
});

test("disabled IDs and exact provider choices survive a real service restart without inference or fallback", async () => {
  const fixture = await setupFixture({ exposeModels: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const settings = sdk.settings.get()!, local = localModelId("restart", fixture.modelId);
    await sdk.settings.update({ ...settings.values, localModels: [{ id: "restart", name: "Generated restart source", enabled: true,
      baseUrl: `${fixture.baseUrl}/v1`, auth: "none", models: [{ id: fixture.modelId, name: "Generated restart model", contextWindow: fixture.contextWindow, maxTokens: 128, imageInput: false }] }] }, settings.revision);
    await waitFor(() => sdk.models.catalogue().models[0]?.offerings.find((offering) => offering.model.id === local)?.available);
    await sdk.models.selectSource(fixture.modelId, local);
    await sdk.models.setProviderEnabled("local.restart", false);
    await sdk.models.setEnabled(fixture.modelId, false);
    const preferences = structuredClone(sdk.settings.get()!.values.modelPreferences);
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const reopened = await new MoguriSdk(restarted.connection).ready();
    try {
      assert.deepEqual(reopened.settings.get()!.values.modelPreferences, preferences);
      assert.equal(reopened.models.catalogue().models[0]!.sourceModelId, local);
      assert.equal(reopened.getState().snapshot!.provider.models.filter((model) => !model.synthetic).length, 0);
      await reopened.models.setEnabled(fixture.modelId, true);
      assert.equal(reopened.getState().snapshot!.provider.models.filter((model) => !model.synthetic).length, 0);
      await assert.rejects(() => reopened.slash(fixture.sessionId, `/model ${fixture.modelId}`), /available|disabled/i);
      assert.equal(fixture.requests.length, 0);
    } finally { reopened.disconnect(); }
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

for (const cached of [false, true]) test(`disabling a model while ${cached ? "an already prepared result" : "provider preparation"} is held blocks admission without a paid request`, { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let release!: () => void, preparing = false;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const adapter = cached ? fixture.service.controller.provider : fixture.provider, original = adapter.prepare.bind(adapter);
  adapter.prepare = async (id, signal) => { const prepared = await original(id, signal); preparing = true; await held; return prepared; };
  try {
    await fixture.configure(); await fixture.send("Generated held model availability.");
    await waitFor(() => preparing); await sdk.models.setEnabled(fixture.modelId, false); release();
    assert.notEqual((await fixture.terminal()).status, "completed");
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "model.started").length, 0);
    assert.equal(fixture.service.controller.snapshot().budgetEntries.length, 0);
  } finally { release(); sdk.disconnect(); await fixture.close(); }
});

test("losing the exact source during repository attribution cannot dispatch previously prepared credentials", { skip: process.platform !== "darwin" }, async (t) => {
  const fixture = await setupFixture({ responseMode: "text" }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let release!: () => void, capturing = false;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const repositories = fixture.service.controller.platform.repositories, capture = repositories.capture.bind(repositories);
  t.mock.method(repositories, "capture", async (...args: Parameters<typeof capture>) => { const result = await capture(...args); capturing = true; await held; return result; });
  try {
    await fixture.configure(); await fixture.send("Generated source loss before atomic model admission.");
    await waitFor(() => capturing); await fixture.provider.logout(); release();
    assert.notEqual((await fixture.terminal()).status, "completed");
    assert.equal(fixture.requests.length, 0); assert.equal(fixture.service.controller.snapshot().budgetEntries.length, 0);
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "model.started").length, 0);
  } finally { release(); sdk.disconnect(); await fixture.close(); }
});

test("disabling a model after admission retains the actual completion and charges without replay", { skip: process.platform !== "darwin" }, async () => {
  const fixture = await setupFixture({ stream: { chunks: ["Generated admitted ", "model result."], delayMs: 180 } }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure(); await fixture.send("Generated already admitted availability.");
    await waitFor(() => fixture.requests.length === 1);
    await sdk.models.setEnabled(fixture.modelId, false);
    await fixture.terminal();
    const state = fixture.service.controller.snapshot(), entries = state.budgetEntries;
    assert.equal(entries.length, 1); assert.equal(entries[0]!.status, "settled"); assert.equal(entries[0]!.reportedTokens, 42);
    assert.equal(fixture.session().usage[0]!.inputTokens, 30);
    assert.equal(fixture.requests.length, 1);
    assert.equal(state.provider.models.some((model) => model.id === fixture.modelId), false);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("duplicate upstream IDs require one explicit provider and disabling that source never enables another offering", async () => {
  const fixture = await setupFixture({ exposeModels: true, maxOutputTokens: 128 }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const endpoint = (id: string): LocalEndpoint => ({ id, name: `Generated ${id}`, enabled: true, baseUrl: `${fixture.baseUrl}/v1`, auth: "none",
      models: [{ id: fixture.modelId, name: "Generated shared model", contextWindow: fixture.contextWindow, maxTokens: 128, imageInput: false }] });
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, localModels: [endpoint("first"), endpoint("second")] }, settings.revision);
    await waitFor(() => sdk.getState().snapshot?.provider.catalogue?.models.find((entry) => entry.apiModelId === fixture.modelId)?.offerings.every((entry) => entry.available));
    const group = sdk.models.catalogue().models.find((entry) => entry.apiModelId === fixture.modelId)!;
    assert.equal(group.offerings.length, 3); assert.equal(group.sourceModelId, null);
    assert.equal(sdk.getState().snapshot!.provider.models.filter((model) => !model.synthetic).length, 0);
    const first = localModelId("first", fixture.modelId), second = localModelId("second", fixture.modelId);
    await assert.rejects(() => sdk.slash(fixture.sessionId, `/model ${first}`), /available|source/i);
    await sdk.models.selectSource(fixture.modelId, first);
    assert.deepEqual(sdk.getState().snapshot!.provider.models.filter((model) => !model.synthetic).map((model) => model.id), [first]);
    await assert.rejects(() => sdk.slash(fixture.sessionId, `/model ${second}`), /available|source/i);
    await assert.rejects(() => sdk.slash(fixture.sessionId, `/model ${fixture.modelId}`), /available|source/i);
    await sdk.models.setProviderEnabled("local.first", false);
    assert.equal(sdk.models.catalogue().models[0]?.sourceModelId, first);
    assert.equal(sdk.getState().snapshot!.provider.models.filter((model) => !model.synthetic).length, 0);
    assert.equal(sdk.settings.get()!.values.localModels[0]!.enabled, false);
    await sdk.models.setProviderEnabled("local.first", true);
    await waitFor(() => sdk.getState().snapshot?.provider.models.some((model) => model.id === first));
    assert.deepEqual(sdk.getState().snapshot!.provider.models.filter((model) => !model.synthetic).map((model) => model.id), [first]);
    const current = sdk.settings.get()!;
    await sdk.settings.update({ ...current.values, localModels: [endpoint("second")] }, current.revision);
    assert.equal(sdk.models.catalogue().models[0]!.sourceModelId, first);
    assert.match(sdk.models.catalogue().models[0]!.diagnostic!, /selected source is unavailable/i);
    assert.equal(sdk.getState().snapshot!.provider.models.filter((model) => !model.synthetic).length, 0);
    await sdk.models.selectSource(fixture.modelId, fixture.modelId);
    assert.deepEqual(sdk.getState().snapshot!.provider.models.filter((model) => !model.synthetic).map((model) => model.id), [fixture.modelId]);
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
