import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { createCacheApi } from "../packages/sdk/src/cache.ts";
import { startService } from "../apps/service/src/server.ts";
import { WorkspaceRuntime } from "../apps/service/src/workspace.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { dependencyArchive, dependencyProject } from "./fixtures/dependencies.ts";

test("cache lease checks use retained root metadata without resolving a Local source, including active physical aliases", async () => {
  const fixture = await setupFixture(), base = fixture.service.controller.snapshot(), project = base.projects[0]!;
  const alias = { ...project, id: "generated-physical-alias", name: "Generated alias" };
  const snapshot = { ...base, projects: [...base.projects, alias] };
  let resolveAllowed = false, resolutions = 0;
  const runtime = new WorkspaceRuntime({
    snapshot: () => snapshot,
    project: () => { resolutions++; if (!resolveAllowed) throw new Error("Lease inspection must not probe a Local source."); return project; },
    commit: () => {}, job: () => "generated-held-cache-job", wake: () => {}, closing: () => false, publicationBusy: () => false,
  }, fixture.service.controller.store, join(fixture.directory, "cache-lease-state"));
  try {
    assert.equal(runtime.isBusy(project.id), false); assert.equal(resolutions, 0);
    resolveAllowed = true;
    await runtime.execute({ type: "cache.install", projectId: project.id, manager: "npm", expectedDigest: "a".repeat(64), acceptMetadataSharing: true, runScripts: false },
      (_events, result = {}) => result);
    resolveAllowed = false;
    const before = resolutions;
    assert.equal(runtime.isBusy(alias.id), true);
    assert.equal(resolutions, before);
    assert.equal(fixture.requests.length, 0);
  } finally { runtime.close(); await fixture.close(); }
});

test("registry commands retain reviewed scope and masked generations, survive restart and never replay interrupted installs", { timeout: 30_000 }, async () => {
  const secrets = new Map<string, string>();
  let artifact: Awaited<ReturnType<typeof dependencyArchive>>, downloads = 0, audits = 0;
  const cacheOptions = {
    vault: { read: async (key: string) => secrets.get(key) ?? null, write: async (key: string, value: string) => { assert.match(key, /^[A-Za-z0-9._-]{1,100}$/); secrets.set(key, value); }, remove: async (key: string) => { secrets.delete(key); } },
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://generated-advisory.invalid/querybatch") { audits++; assert.equal(new Headers(init?.headers).get("Authorization"), null); return Response.json({ results: [{}] }); }
      assert.equal(String(url), "https://generated-registry.invalid/npm/@generated/private-package/-/private-package-1.0.0.tgz"); downloads++;
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer GENERATED_RUNTIME_SECRET"); return new Response(artifact.bytes);
    },
  };
  const fixture = await setupFixture({ platform: { cache: cacheOptions } });
  let sdk = await new MoguriSdk(fixture.service.connection).ready(), api = createCacheApi(sdk);
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    artifact = await dependencyArchive(fixture.directory, "@generated/private-package"); await dependencyProject(fixture.project, artifact);
    const lock = JSON.parse(await readFile(join(fixture.project, "package-lock.json"), "utf8")); lock.packages[`node_modules/${artifact.name}`].resolved = "https://generated-registry.invalid/npm/@generated/private-package/-/private-package-1.0.0.tgz";
    await writeFile(join(fixture.project, "package-lock.json"), JSON.stringify(lock));
    const config = { name: "Generated reviewed registry", url: "https://generated-registry.invalid/npm/", packages: ["@generated/*"], advisoryUrl: "https://generated-advisory.invalid/querybatch", sharePrivateMetadata: true };
    const saved = await api.registries.save(config), registryId = saved.id!;
    assert.equal(saved.revision, 0); assert.equal((await api.registries.list()).registries[0]?.credential, "required");
    await api.registries.setToken(registryId, "GENERATED_RUNTIME_SECRET");
    const registry = (await api.registries.list()).registries[0]!;
    assert.equal(registry.credential, "configured"); assert.equal(registry.revision, 1); assert.notEqual(registry.credentialRevision, "GENERATED_RUNTIME_SECRET");
    await assert.rejects(() => api.registries.save(config, 0, registryId), /Another client changed/);
    const { plan } = await api.inspect(fixture.session().projectId, "npm"), prepared = await api.prepare(plan.projectId, "npm", plan.digest, true);
    assert.equal((await sdk.jobs.wait(prepared.id!)).status, "completed"); assert.equal(downloads, 1); assert.equal(audits, 1);
    assert.equal(JSON.stringify(sdk.getState()).includes("GENERATED_RUNTIME_SECRET"), false);
    assert.equal(JSON.stringify(fixture.service.store.events()).includes("GENERATED_RUNTIME_SECRET"), false);
    assert.equal(JSON.stringify(fixture.service.store.db.prepare("SELECT * FROM receipts").all()).includes("GENERATED_RUNTIME_SECRET"), false);
    fixture.service.store.commit([{ event_type: "job.started", profile_id: "default", project_id: plan.projectId, payload: { job: {
      id: "generated-private-interrupted-install", kind: "cache.install", projectId: plan.projectId, sessionId: null, parentTurnId: null, status: "running", progress: "Generated interrupted publication", resultDigest: null, error: null,
    } } }]);
    sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey, platform: { cache: cacheOptions, terminal: { vault: fixture.terminalVault } } });
    sdk = await new MoguriSdk(restarted.connection).ready(); api = createCacheApi(sdk);
    const retained = (await api.registries.list()).registries[0]!;
    assert.equal(retained.id, registryId); assert.equal(retained.credentialRevision, registry.credentialRevision); assert.equal(retained.credential, "configured");
    assert.equal(sdk.getState().snapshot!.jobs.find((job) => job.id === "generated-private-interrupted-install")?.status, "partial");
    assert.ok(sdk.getState().snapshot!.blockedProjects.includes(plan.projectId)); assert.equal(downloads, 1); assert.equal(audits, 1);
    await api.registries.clearToken(registryId); assert.equal((await api.registries.list()).registries[0]?.credential, "required");
    await assert.rejects(() => api.registries.remove(registryId, retained.revision), /Another client changed/);
    const next = (await api.registries.list()).registries[0]!;
    await api.registries.remove(registryId, next.revision);
    assert.deepEqual((await api.registries.list()).registries, []); assert.equal(secrets.size, 0);
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});

test("credential revocation aborts generation-bound downloads before private bytes or receipts are admitted", { timeout: 15_000 }, async () => {
  const secrets = new Map<string, string>();
  let fetching = false, cancelled = false, retries = 0;
  const fixture = await setupFixture({ platform: { cache: {
    vault: { read: async (key) => secrets.get(key) ?? null, write: async (key, value) => { secrets.set(key, value); }, remove: async (key) => { secrets.delete(key); } },
    fetch: async (url, init) => {
      if (String(url) === "https://generated-advisory.invalid/querybatch") return Response.json({ results: [{}] });
      fetching = true; retries++;
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => { cancelled = true; reject(new Error("Generated registry generation revoked")); }, { once: true }));
    },
  } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready(), api = createCacheApi(sdk);
  try {
    const artifact = await dependencyArchive(fixture.directory, "@generated/private-package"); await dependencyProject(fixture.project, artifact);
    const lock = JSON.parse(await readFile(join(fixture.project, "package-lock.json"), "utf8")); lock.packages[`node_modules/${artifact.name}`].resolved = "https://generated-registry.invalid/npm/@generated/private-package/-/private-package-1.0.0.tgz"; await writeFile(join(fixture.project, "package-lock.json"), JSON.stringify(lock));
    const registry = await api.registries.save({ name: "Generated revoked registry", url: "https://generated-registry.invalid/npm/", packages: ["@generated/*"], advisoryUrl: "https://generated-advisory.invalid/querybatch", sharePrivateMetadata: true });
    await api.registries.setToken(registry.id!, "GENERATED_REVOKABLE_SECRET");
    const { plan } = await api.inspect(fixture.session().projectId, "npm"), job = await api.prepare(plan.projectId, "npm", plan.digest, true);
    await waitFor(() => fetching);
    await api.registries.clearToken(registry.id!);
    const result = await sdk.jobs.wait(job.id!); assert.equal(result.status, "failed"); assert.match(result.error!, /authorization changed|registry authorization changed/);
    assert.equal(cancelled, true); assert.equal(retries, 1); assert.equal(sdk.getState().snapshot?.dependencyCaches.length, 0);
    assert.equal((await api.inspect(plan.projectId, "npm")).plan.cachedPackages, 0);
    assert.equal(JSON.stringify(sdk.getState()).includes("GENERATED_REVOKABLE_SECRET"), false);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("secret-backend failures never echo a credential or turn a failed write into registry authorization", async () => {
  const fixture = await setupFixture({ platform: { cache: { vault: {
    read: async () => null, write: async (_key, value) => { throw new Error(`Generated untrusted backend error: ${value}`); }, remove: async () => {},
  } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready(), api = createCacheApi(sdk);
  try {
    const registry = await api.registries.save({ name: "Generated backend failure", url: "https://generated-registry.invalid/npm/", packages: ["@generated/*"], advisoryUrl: "https://generated-advisory.invalid/querybatch", sharePrivateMetadata: false });
    await assert.rejects(() => api.registries.setToken(registry.id!, "GENERATED_SECRET_ERROR_MUST_NOT_LEAK"), (error: unknown) => error instanceof Error && /secret backend/.test(error.message) && !error.message.includes("GENERATED_SECRET_ERROR_MUST_NOT_LEAK"));
    const preview = (await api.registries.list()).registries[0]!;
    assert.equal(preview.revision, 0); assert.equal(preview.credential, "required");
    assert.equal(JSON.stringify(sdk.getState()).includes("GENERATED_SECRET_ERROR_MUST_NOT_LEAK"), false);
    assert.equal(JSON.stringify(fixture.service.store.events()).includes("GENERATED_SECRET_ERROR_MUST_NOT_LEAK"), false);
  } finally { sdk.disconnect(); await fixture.close(); }
});
