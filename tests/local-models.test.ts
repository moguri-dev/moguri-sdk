import { ciTime } from "./fixtures/time-scale.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { MoguriSdk, type LocalEndpoint } from "../packages/sdk/src/index.ts";
import { localModelId } from "../apps/service/src/model-registry.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { appendLegacyProjectFreeSession, assertCurrentSchema, writeLegacyState } from "./fixtures/legacy-state.ts";
import { startService } from "../apps/service/src/server.ts";
import { SecretStreamRedactor, redactSecrets } from "../apps/service/src/secret-redactor.ts";

const mac = { skip: process.platform !== "darwin", timeout: ciTime(20_000) };
const definition = (fixture: Awaited<ReturnType<typeof setupFixture>>, id = "generated-local"): LocalEndpoint => ({
  id, name: "Generated local server", enabled: true, baseUrl: `${fixture.baseUrl}/v1`, auth: "none",
  models: [{ id: fixture.modelId, name: "Generated local solver", contextWindow: fixture.contextWindow, maxTokens: 4096, imageInput: false }],
});
test("explicit local endpoints use the maintained worker without Copilot, ambient auth or provider-name collisions", mac, async () => {
  const fixture = await setupFixture({ exposeModels: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.provider.logout();
    const settings = sdk.settings.get()!;
    const endpoint = definition(fixture);
    await sdk.settings.update({ ...settings.values, localModels: [endpoint] }, settings.revision);
    const model = await waitFor(() => sdk.getState().snapshot?.provider.models.find((model) => model.source === "local"));
    assert.equal(fixture.requests.length, 0);
    assert.equal(sdk.getState().snapshot!.provider.connections?.find((connection) => connection.id === "github-copilot")?.status, "disconnected");
    assert.equal(model.id, localModelId(endpoint.id, fixture.modelId));
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: model.id });
    await fixture.send("Generated local-only request.");
    assert.equal((await fixture.terminal()).status, "completed");
    assert.equal(fixture.headers[0], undefined);
    assert.equal(fixture.requests[0]?.model, fixture.modelId);
    assert.equal(fixture.session().usage[0]?.modelId, model.id);
    assert.equal(fixture.session().usage[0]?.source, "local");
    assert.equal(fixture.session().usage[0]?.providerId, `local.${endpoint.id}`);
    assert.equal(fixture.session().usage[0]?.apiModelId, fixture.modelId);
    assert.equal(fixture.session().usage[0]?.inputTokens, 30);
    assert.equal(fixture.session().usage[0]?.billedUsd, null);
    await sdk.command({ type: "provider.login" });
    fixture.provider.authorize();
    await waitFor(() => sdk.models.catalogue().models[0]?.offerings.length === 2);
    assert.equal(sdk.getState().snapshot!.provider.models.filter((model) => !model.synthetic).length, 0);
    await sdk.models.selectSource(fixture.modelId, model.id);
    assert.ok(sdk.getState().snapshot!.provider.models.some((candidate) => candidate.id === model.id));
    assert.equal(sdk.getState().snapshot!.provider.models.some((candidate) => candidate.id === fixture.modelId), false);
    await sdk.models.selectSource(fixture.modelId, fixture.modelId);
    assert.equal(sdk.getState().snapshot!.provider.models.some((candidate) => candidate.id === model.id), false);
    assert.ok(sdk.getState().snapshot!.provider.models.some((candidate) => candidate.id === fixture.modelId));
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("local credentials are resource-bound, echoed secrets never enter streaming/events, and endpoint changes do not reuse keys", mac, async () => {
  const secrets = new Map<string, string>();
  const fixture = await setupFixture({ exposeModels: true, platform: { models: { vault: { read: async (id) => secrets.get(id) ?? null, write: async (id, value) => { secrets.set(id, value); }, remove: async (id) => { secrets.delete(id); } } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const settings = sdk.settings.get()!, endpoint = { ...definition(fixture), auth: "bearer" as const };
    await sdk.settings.update({ ...settings.values, localModels: [endpoint] }, settings.revision);
    await waitFor(() => sdk.getState().snapshot?.provider.connections?.find((entry) => entry.source === "local")?.status === "error");
    await sdk.models.setToken(endpoint.id, "generated-private-local-key");
    await sdk.models.selectSource(fixture.modelId, localModelId(endpoint.id, fixture.modelId));
    const model = await waitFor(() => sdk.getState().snapshot?.provider.models.find((model) => model.source === "local"));
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: model.id });
    await fixture.send("generated echo credential");
    await fixture.terminal();
    assert.match(fixture.session().messages.findLast((message) => message.role === "assistant")!.text, /\[redacted\]/);
    assert.equal(JSON.stringify(fixture.service.controller.events(0)).includes("generated-private-local-key"), false);
    assert.equal(JSON.stringify(fixture.service.controller.snapshot()).includes("generated-private-local-key"), false);
    const current = sdk.settings.get()!;
    await sdk.settings.update({ ...current.values, localModels: [{ ...endpoint, baseUrl: `${fixture.baseUrl}/different/v1` }] }, current.revision);
    await waitFor(() => sdk.getState().snapshot?.provider.connections?.find((entry) => entry.source === "local")?.status === "error");
    assert.equal(sdk.getState().snapshot!.provider.models.some((entry) => entry.id === model.id), false);
    assert.equal(fixture.requests.length, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("local model configuration rejects unsafe endpoints/limits, never advertises undeclared models and honors cancellation", mac, async () => {
  const fixture = await setupFixture({ exposeModels: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const original = sdk.settings.get()!, endpoint = definition(fixture);
    await assert.rejects(() => sdk.settings.update({ ...original.values, localModels: [{ ...endpoint, baseUrl: "http://unapproved.example.test/v1" }] }, original.revision), /HTTPS or explicit loopback/);
    await assert.rejects(() => sdk.settings.update({ ...original.values, localModels: [{ ...endpoint, models: [{ ...endpoint.models[0]!, maxTokens: endpoint.models[0]!.contextWindow }] }] }, original.revision), /output limit/);
    await sdk.settings.update({ ...original.values, localModels: [endpoint] }, original.revision);
    await waitFor(() => sdk.models.catalogue().models[0]?.offerings.find((entry) => entry.model.source === "local")?.available);
    await sdk.models.selectSource(fixture.modelId, localModelId(endpoint.id, fixture.modelId));
    const model = await waitFor(() => sdk.getState().snapshot?.provider.models.find((model) => model.source === "local"));
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, modelId: model.id });
    await fixture.send("generated slow local request");
    await waitFor(() => fixture.requests.length === 1);
    await sdk.command({ type: "session.stop", sessionId: fixture.sessionId });
    assert.equal((await fixture.terminal()).status, "stopped");
    const current = sdk.settings.get()!;
    await sdk.settings.update({ ...current.values, localModels: [{ ...endpoint, models: [{ ...endpoint.models[0]!, id: "generated-not-advertised" }] }] }, current.revision);
    await waitFor(() => sdk.getState().snapshot?.provider.connections?.find((entry) => entry.source === "local")?.status === "error");
    assert.equal(sdk.getState().snapshot!.provider.models.some((entry) => entry.source === "local"), false);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("startup preferences preserve precedence/provenance and existing sessions across schema-6 recovery", async () => {
  const fixture = await setupFixture({ legacySessionControlsJournal: true }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, notifications: { inApp: true, os: false, previewContent: false },
      startup: { global: { modelId: fixture.modelId, autonomy: "Guided" }, profile: { autonomy: "Manual" } } }, settings.revision);
    const project = (await sdk.projects.configuration(fixture.session().projectId)).configuration;
    await sdk.projects.configure(project.projectId, { ...project.values, defaults: { autonomy: "Guided", modelOptions: { contextWindow: 16384 } } }, project.revision);
    const created = await sdk.sessions.create(project.projectId, "Generated inherited session", { autonomy: "Manual" });
    const session = sdk.getState().snapshot!.sessions.find((session) => session.id === created.id)!;
    assert.equal(session.controls.modelId, fixture.modelId); assert.equal(session.controls.autonomy, "Manual");
    assert.deepEqual(session.controls.modelOptions, { contextWindow: 16384 });
    assert.equal(session.defaults?.sources.modelId, "global"); assert.equal(session.defaults?.sources.modelOptions, "project"); assert.equal(session.defaults?.sources.autonomy, "session");
    assert.equal(fixture.session().controls.modelId, null);
    const general = await appendLegacyProjectFreeSession(sdk, fixture.service.controller, "Generated inherited pre-Home chat");
    assert.equal(sdk.getState().snapshot!.sessions.find((session) => session.id === general.id)?.defaults?.sources.autonomy, "profile");
    sdk.disconnect(); await writeLegacyState(fixture.service, 6);
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    assertCurrentSchema(restarted.store);
    const recovered = restarted.controller.snapshot().sessions.find((value) => value.id === session.id)!;
    assert.deepEqual(recovered.controls, session.controls); assert.deepEqual(recovered.defaults, session.defaults);
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});
test("streaming secret redaction handles every split, overlapping prefixes and structured model arguments", () => {
  const input = "Generated abcab-private-token then abcab-private-token and trailing abca", secret = "abcab-private-token";
  for (let index = 0; index <= input.length; index++) {
    const redactor = new SecretStreamRedactor([secret]);
    assert.equal(redactor.push(input.slice(0, index)) + redactor.push(input.slice(index)) + redactor.finish(), "Generated [redacted] then [redacted] and trailing abca");
  }
  assert.deepEqual(redactSecrets({ value: secret, arguments: [secret] }, [secret]), { value: "[redacted]", arguments: ["[redacted]"] });
});
