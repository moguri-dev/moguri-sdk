import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { CopilotAdapter } from "../apps/service/src/provider.ts";
import { ModelRegistry } from "../apps/service/src/model-registry.ts";
import { modelEvidenceEndpoint, declaredModelEvidence } from "../apps/service/src/model-evidence.ts";
import { waitFor } from "./fixture.ts";

async function configuredAdapter(access = "generated-evidence-only") {
  const credentials = new InMemoryCredentialStore(), model = githubCopilotProvider().getModels()[0]!;
  await credentials.modify("github-copilot", async () => ({ type: "oauth", refresh: "generated-unused-refresh", access, expires: Date.now() + 3_600_000, availableModelIds: [model.id] }));
  const adapter = new CopilotAdapter(credentials); await adapter.refresh();
  return { adapter, credentials, model };
}

test("explicit Copilot evidence reads exact provider declarations without inferring from names or changing ordinary discovery", async () => {
  const fetch = globalThis.fetch, credentials = new InMemoryCredentialStore(), model = githubCopilotProvider().getModels()[0]!;
  await credentials.modify("github-copilot", async () => ({
    type: "oauth", refresh: "generated-unused-refresh", access: "generated-short-lived-inspection-only", expires: Date.now() + 3_600_000, availableModelIds: [model.id],
  }));
  const requests: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input); requests.push({ url, init });
    assert.equal(url, "https://api.individual.githubcopilot.com/models");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer generated-short-lived-inspection-only");
    assert.equal(init?.redirect, "error");
    return Response.json({ data: [{ id: model.id, version: "generated-provider-version", vendor: "Generated publisher claim",
      capabilities: { family: "generated-explicit-family-not-name-prefix" } }] });
  };
  const adapter = new CopilotAdapter(credentials);
  try {
    await adapter.refresh(); const before = structuredClone(adapter.state.models);
    assert.equal(requests.length, 0);
    const evidence = await adapter.evidence(model.id, AbortSignal.timeout(5000));
    assert.equal(evidence.status, "declared"); assert.equal(evidence.claimed.family, "generated-explicit-family-not-name-prefix");
    assert.equal(evidence.claimed.vendor, "Generated publisher claim"); assert.equal(evidence.claimed.version, "generated-provider-version");
    assert.equal(evidence.apiModelId, model.id); assert.match(evidence.digest, /^[a-f0-9]{64}$/);
    assert.match(evidence.warning, /not.*independen/i); assert.equal(requests.length, 1);
    assert.deepEqual(adapter.state.models, before); assert.equal(JSON.stringify(evidence).includes("generated-short-lived-inspection-only"), false);
  } finally { await adapter.cancel(); globalThis.fetch = fetch; }
});

test("an absent family is an explicit unknown declaration, never inferred from the actual model ID", async () => {
  const fetch = globalThis.fetch, credentials = new InMemoryCredentialStore(), model = githubCopilotProvider().getModels()[0]!;
  await credentials.modify("github-copilot", async () => ({
    type: "oauth", refresh: "generated-unused-refresh", access: "generated-evidence-token", expires: Date.now() + 3_600_000, availableModelIds: [model.id],
  }));
  globalThis.fetch = async () => Response.json({ data: [{ id: model.id, name: "Generated misleading independent-family name", capabilities: {} }] });
  const adapter = new CopilotAdapter(credentials);
  try {
    await adapter.refresh(); const evidence = await adapter.evidence(model.id, AbortSignal.timeout(5000));
    assert.equal(evidence.status, "unknown"); assert.equal(evidence.claimed.family, null);
    assert.equal(evidence.claimed.vendor, null); assert.equal(evidence.claimed.version, null);
  } finally { await adapter.cancel(); globalThis.fetch = fetch; }
});

test("evidence accepts only exact known HTTPS Copilot API roots without credentials, redirects, alternate ports or paths", () => {
  assert.equal(modelEvidenceEndpoint("https://api.individual.githubcopilot.com"), "https://api.individual.githubcopilot.com/models");
  assert.equal(modelEvidenceEndpoint("https://api.business.githubcopilot.com/"), "https://api.business.githubcopilot.com/models");
  for (const value of [undefined, "", "http://api.githubcopilot.com", "https://api.githubcopilot.com.attacker.invalid", "https://api.githubcopilot.com:8443",
    "https://generated@api.githubcopilot.com", "https://api.githubcopilot.com/?token=generated", "https://api.githubcopilot.com/#generated", "https://api.githubcopilot.com/v1/"]) {
    assert.throws(() => modelEvidenceEndpoint(value));
  }
});

test("duplicate/missing IDs, lossy/control declarations, disabled models and request-access echoes cannot become family evidence", () => {
  const endpoint = "https://api.individual.githubcopilot.com/models", secret = "generated-secret-access", modelId = "generated-real-api-model";
  for (const data of [
    [{ id: modelId }, { id: modelId }], [{ id: "generated-other-api-model", capabilities: { family: "generated" } }],
    [{ id: modelId, capabilities: { family: "\ud800" } }], [{ id: modelId, capabilities: { family: "generated\nfamily" } }],
    [{ id: modelId, capabilities: { family: "x".repeat(257) } }], [{ id: modelId, capabilities: { family: secret } }],
    [{ id: modelId }, { id: "generated\nmodel" }], [{ id: modelId }, { id: "generated model" }],
    [{ id: modelId }, { id: "\ud800" }], [{ id: modelId }, { id: "x".repeat(129) }],
    [{ id: modelId, capabilities: null }], [{ id: modelId, policy: { state: "disabled" }, capabilities: { family: "generated-family" } }],
  ]) assert.throws(() => declaredModelEvidence({ data }, modelId, endpoint, secret));
  const report = declaredModelEvidence({ data: [{ id: modelId, capabilities: { family: "Generated Exact Family" }, version: "version-without-normalization" }] }, modelId, endpoint, secret);
  assert.equal(report.claimed.family, "Generated Exact Family"); assert.equal(report.claimed.version, "version-without-normalization");
  assert.equal("independent" in report, false);
});

test("explicit inspection rejects unavailable IDs before network and HTTP failures expose no raw response or cached success", async () => {
  const fetch = globalThis.fetch, f = await configuredAdapter(); let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response("generated-evidence-only echoed diagnostic", { status: 403 }); };
  try {
    await assert.rejects(() => f.adapter.evidence("generated-foreign-model", AbortSignal.timeout(1000)), { code: "model_evidence_unavailable" });
    assert.equal(requests, 0);
    await assert.rejects(() => f.adapter.evidence(f.model.id, AbortSignal.timeout(1000)), (error: unknown) => error instanceof Error &&
      "code" in error && error.code === "model_evidence_http" && !error.message.includes("generated-evidence-only"));
    assert.equal(f.adapter.state.status, "connected"); assert.equal(f.adapter.state.models.length, 1); assert.equal(requests, 1);
  } finally { await f.adapter.cancel(); globalThis.fetch = fetch; }
});

test("catalogue bytes are bounded and malformed UTF-8, JSON or absent bodies never produce evidence", async () => {
  const fetch = globalThis.fetch, f = await configuredAdapter();
  try {
    for (const response of [() => new Response(new Uint8Array(256 * 1024 + 1)), () => new Response(new Uint8Array([0xff])),
      () => new Response("{generated-not-json"), () => new Response(null, { status: 204 })]) {
      globalThis.fetch = async () => response();
      await assert.rejects(() => f.adapter.evidence(f.model.id, AbortSignal.timeout(1000)));
      assert.equal(f.adapter.state.status, "connected"); assert.equal(f.adapter.state.models.length, 1);
    }
  } finally { await f.adapter.cancel(); globalThis.fetch = fetch; }
});

test("logout aborts the owned actual catalogue request and cannot publish old-account evidence afterward", async () => {
  const fetch = globalThis.fetch, f = await configuredAdapter(); let entered = false, aborted = false;
  globalThis.fetch = async (_input, init) => {
    entered = true;
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => { aborted = true; reject(init.signal?.reason); }, { once: true }));
  };
  try {
    const pending = f.adapter.evidence(f.model.id, AbortSignal.timeout(5000));
    const rejected = assert.rejects(() => pending, { code: "model_evidence_cancelled" });
    await waitFor(() => entered); await f.adapter.logout(); await rejected;
    assert.equal(aborted, true); assert.equal(f.adapter.state.status, "disconnected"); assert.equal(f.adapter.state.models.length, 0);
    assert.equal(await f.credentials.read("github-copilot"), undefined);
  } finally { await f.adapter.cancel(); globalThis.fetch = fetch; }
});

test("caller cancellation, provider shutdown and concurrent inspection limits retain no success-shaped report", async () => {
  const fetch = globalThis.fetch, f = await configuredAdapter(); let requests = 0;
  globalThis.fetch = async (_input, init) => {
    requests++;
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
  };
  try {
    const caller = new AbortController(), request = f.adapter.evidence(f.model.id, caller.signal);
    const cancelled = assert.rejects(() => request, { code: "model_evidence_cancelled" });
    await waitFor(() => requests === 1); caller.abort(); await cancelled;
    const pending = Array.from({ length: 4 }, () => f.adapter.evidence(f.model.id, AbortSignal.timeout(5000)));
    const outcomes = pending.map((value) => assert.rejects(() => value, { code: "model_evidence_cancelled" }));
    await waitFor(() => requests === 5);
    await assert.rejects(() => f.adapter.evidence(f.model.id, AbortSignal.timeout(1000)), { code: "model_evidence_busy" });
    await f.adapter.cancel(); await Promise.all(outcomes);
    assert.equal(f.adapter.state.status, "connected"); assert.equal(f.adapter.state.models.length, 1);
  } finally { await f.adapter.cancel(); globalThis.fetch = fetch; }
});

test("pre-aborted reads and caller deadlines return explicit cancellation/timeout without changing ordinary provider state", { timeout: 5000 }, async () => {
  const fetch = globalThis.fetch, f = await configuredAdapter(); let requests = 0;
  globalThis.fetch = async (_input, init) => {
    requests++;
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
  };
  try {
    const stopped = new AbortController(); stopped.abort();
    await assert.rejects(() => f.adapter.evidence(f.model.id, stopped.signal), { code: "model_evidence_cancelled" });
    assert.equal(requests, 0);
    await assert.rejects(() => f.adapter.evidence(f.model.id, AbortSignal.timeout(30)), { code: "model_evidence_timeout" });
    assert.equal(requests, 1); assert.equal(f.adapter.state.status, "connected"); assert.equal(f.adapter.state.models.length, 1);
  } finally { await f.adapter.cancel(); globalThis.fetch = fetch; }
});

test("the registry rejects Local/Remote/foreign/synthetic/aliased model claims and closed readers before making a catalogue request", async () => {
  const fetch = globalThis.fetch, f = await configuredAdapter(), registry = new ModelRegistry(f.adapter, () => []); let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("No unsupported reader may send a request."); };
  try {
    const canonical = registry.state.models[0]!;
    await assert.rejects(() => registry.evidence("generated-foreign-id", AbortSignal.timeout(1000)), { code: "model_evidence_unavailable" });
    for (const model of [
      { ...canonical, id: "local.generated.model", source: "local" as const, providerId: "local.generated" },
      { ...canonical, id: "remote.generated.model", source: "local" as const, providerId: "remote.generated" },
      { ...canonical, id: "generated-synthetic", synthetic: true },
      { ...canonical, providerId: "generated-other-provider" },
      { ...canonical, apiModelId: "generated-alias" },
    ]) {
      registry.state.models = [model];
      await assert.rejects(() => registry.evidence(model.id, AbortSignal.timeout(1000)), { code: "model_evidence_unavailable" });
    }
    registry.state.models = [canonical]; await registry.close();
    await assert.rejects(() => registry.evidence(canonical.id, AbortSignal.timeout(1000)), { code: "model_evidence_unavailable" });
    assert.equal(requests, 0);
  } finally { await registry.close(); globalThis.fetch = fetch; }
});

test("the registry cannot publish a valid declaration after its actual model binding changes during the read", async () => {
  const fetch = globalThis.fetch, f = await configuredAdapter(), registry = new ModelRegistry(f.adapter, () => []), gate = Promise.withResolvers<void>(); let entered = false;
  globalThis.fetch = async (_input, init) => {
    entered = true; await gate.promise; init?.signal?.throwIfAborted();
    return Response.json({ data: [{ id: f.model.id, capabilities: { family: "generated-old-binding" } }] });
  };
  try {
    const read = registry.evidence(f.model.id, AbortSignal.timeout(1000)), rejected = assert.rejects(() => read, { code: "model_evidence_stale" });
    await waitFor(() => entered);
    registry.state.models = registry.state.models.map((model) => ({ ...model, contextWindow: model.contextWindow + 1024 }));
    gate.resolve(); await rejected; assert.equal(f.adapter.state.status, "connected");
  } finally { gate.resolve(); await registry.close(); globalThis.fetch = fetch; }
});

test("the inspector's own ten-second total bound aborts an otherwise unbounded catalogue request", { timeout: 15_000 }, async () => {
  const fetch = globalThis.fetch, f = await configuredAdapter(); let requests = 0;
  globalThis.fetch = async (_input, init) => {
    requests++;
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
  };
  try {
    const start = performance.now();
    await assert.rejects(() => f.adapter.evidence(f.model.id, new AbortController().signal), { code: "model_evidence_timeout" });
    const elapsed = performance.now() - start;
    assert.ok(elapsed >= 10_000 && elapsed < 14_000); assert.equal(requests, 1);
    assert.equal(f.adapter.state.status, "connected"); assert.equal(f.adapter.state.models.length, 1);
  } finally { await f.adapter.cancel(); globalThis.fetch = fetch; }
});
