import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as cacache from "cacache";
import { DependencyCache } from "../apps/service/src/dependency-cache.ts";
import type { DependencyRegistry } from "../packages/protocol/src/workspace.ts";
import type { Project } from "../packages/protocol/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { dependencyArchive, dependencyProject } from "./fixtures/dependencies.ts";
import { ciTime } from "./fixtures/time-scale.ts";

test("private registry bytes, metadata consent, source paths and real bearer requests stay profile/credential scoped", { timeout: ciTime(30_000) }, async () => {
  let artifact: Awaited<ReturnType<typeof dependencyArchive>>, downloads = 0, audits = 0, redirects = false, advisory: unknown = {};
  const headers: (string | undefined)[] = [];
  const outsider = createServer((_request, response) => { outsiderRequests++; response.end("Never forward registry credentials here."); }); let outsiderRequests = 0;
  await new Promise<void>((resolve) => outsider.listen(0, "127.0.0.1", resolve));
  const outside = outsider.address(); assert.ok(outside && typeof outside !== "string");
  const server = createServer((request, response) => {
    if (request.url === "/advisories") { audits++; assert.equal(request.headers.authorization, undefined); response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ results: [advisory] })); return; }
    assert.equal(request.url, "/npm/@generated/private-package/-/private-package-1.0.0.tgz");
    downloads++; headers.push(request.headers.authorization);
    if (redirects) { response.writeHead(302, { Location: `http://127.0.0.1:${outside.port}/unreviewed` }).end(); return; }
    response.end(artifact.bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const fixture = await setupFixture();
  const stores = [fixture.service.store, fixture.service.store.view("generated-private-beta")];
  const caches: DependencyCache[] = [];
  const sets: DependencyRegistry[][] = [[], []];
  const vaults = [new Map<string, string>(), new Map<string, string>()];
  try {
    artifact = await dependencyArchive(fixture.directory, "@generated/private-package");
    await dependencyProject(fixture.project, artifact);
    const lock = JSON.parse(await readFile(join(fixture.project, "package-lock.json"), "utf8"));
    lock.packages[`node_modules/${artifact.name}`].resolved = `${url}/npm/${artifact.name}/-/private-package-1.0.0.tgz`;
    await writeFile(join(fixture.project, "package-lock.json"), JSON.stringify(lock));
    await writeFile(join(fixture.project, ".npmrc"), "//unreviewed.invalid/:_authToken=GENERATED_AMBIENT_TOKEN_MUST_NOT_BE_READ\n");
    const project = fixture.service.controller.snapshot().projects.find((entry) => entry.id === fixture.session().projectId)!;
    for (const [index, store] of stores.entries()) {
      const vault = vaults[index]!;
      const cache = new DependencyCache(store, join(fixture.directory, `private-state-${index}`), {
        cacheDirectory: join(fixture.directory, "shared-cache"), allowLoopback: true, registries: () => sets[index]!,
        vault: { read: async (key) => vault.get(key) ?? null, write: async (key, value) => { vault.set(key, value); }, remove: async (key) => { vault.delete(key); } },
      });
      caches.push(cache);
      const config = cache.registries.validate({ name: "Generated private registry", url: `${url}/npm/`, packages: ["@generated/*"], advisoryUrl: `${url}/advisories`, sharePrivateMetadata: false });
      sets[index]!.push(config);
      await cache.registries.changeToken(config, `GENERATED_PRIVATE_TOKEN_${index}`, (next) => { sets[index]![0] = next; });
    }
    let plan = await caches[0]!.inspect(project, "npm");
    await assert.rejects(() => caches[0]!.prepare(project, "npm", plan.digest, AbortSignal.timeout(10_000), () => {}), /Private dependency names/);
    assert.equal(audits, 0); assert.equal(downloads, 0);
    for (const [index, cache] of caches.entries()) {
      const previous = sets[index]![0]!, next = cache.registries.validate({ ...previous, sharePrivateMetadata: true }, previous);
      sets[index]![0] = next; await cache.registries.revoke(previous);
      await cache.registries.changeToken(next, `GENERATED_PRIVATE_TOKEN_${index}`, (saved) => { sets[index]![0] = saved; });
      const scopedProject: Project = { ...project, id: index ? "generated-beta-project" : project.id };
      plan = await cache.inspect(scopedProject, "npm"); assert.equal(plan.cachedPackages, 0);
      const first = await cache.prepare(scopedProject, "npm", plan.digest, AbortSignal.timeout(10_000), () => {});
      assert.equal(first.reused, 0);
      const reused = await cache.prepare(scopedProject, "npm", plan.digest, AbortSignal.timeout(10_000), () => {});
      assert.equal(reused.reused, 1);
      assert.equal(JSON.stringify(plan).includes("GENERATED_PRIVATE_TOKEN"), false);
      assert.equal(await cacache.get.hasContent(join(fixture.directory, "shared-cache/npm/_cacache"), artifact.integrity), false);
      assert.match(plan.npmCache, /private/);
    }
    assert.equal(downloads, 2); assert.deepEqual(headers, ["Bearer GENERATED_PRIVATE_TOKEN_0", "Bearer GENERATED_PRIVATE_TOKEN_1"]); assert.equal(audits, 4);
    plan = await caches[0]!.inspect(project, "npm");
    const installed = await caches[0]!.install(project, "npm", plan.digest, AbortSignal.timeout(10_000), () => {});
    assert.equal(installed.reused, 1); assert.match(await readFile(join(fixture.project, "node_modules", artifact.name, "index.js"), "utf8"), /generated shared/);
    advisory = { vulns: [{ id: "GENERATED-PRIVATE-REVOKED" }] };
    await assert.rejects(() => caches[0]!.prepare(project, "npm", plan.digest, AbortSignal.timeout(10_000), () => {}), /Known vulnerabilities/);
    assert.equal(downloads, 2);
    advisory = {};
    await caches[0]!.registries.changeToken(sets[0]![0]!, "GENERATED_PRIVATE_NEW_ACCOUNT", (next) => { sets[0]![0] = next; });
    await assert.rejects(() => caches[0]!.prepare(project, "npm", plan.digest, AbortSignal.timeout(10_000), () => {}), /authorization changed|registry.*changed/);
    plan = await caches[0]!.inspect(project, "npm"); assert.equal(plan.cachedPackages, 0);
    redirects = true;
    await assert.rejects(() => caches[0]!.prepare(project, "npm", plan.digest, AbortSignal.timeout(10_000), () => {}), /redirect|request failed/);
    assert.equal(outsiderRequests, 0);
    lock.packages[`node_modules/${artifact.name}`].resolved = `${url}/unreviewed/${artifact.name}.tgz`;
    await writeFile(join(fixture.project, "package-lock.json"), JSON.stringify(lock));
    await assert.rejects(() => caches[0]!.inspect(project, "npm"), /outside.*authorization/);
    assert.throws(() => caches[0]!.registries.validate({ name: "Generated bad URL", url: "https://token:password@example.invalid/npm/", packages: ["other-package"], advisoryUrl: "https://api.osv.dev/v1/querybatch", sharePrivateMetadata: true }), /credentials/);
  } finally {
    for (const cache of caches) cache.close();
    stores[1]!.close(); await fixture.close();
    server.closeAllConnections(); outsider.closeAllConnections();
    await Promise.all([new Promise<void>((resolve) => server.close(() => resolve())), new Promise<void>((resolve) => outsider.close(() => resolve()))]);
  }
});

test("private pnpm installs use only the verified mirror, never direct registry credentials or ambient hooks", { timeout: ciTime(30_000) }, async () => {
  const fixture = await setupFixture();
  let registries: DependencyRegistry[] = [], artifacts = 0, metadata = 0;
  const secrets = new Map<string, string>();
  const cache = new DependencyCache(fixture.service.store, join(fixture.directory, "state"), {
    allowLoopback: true, registries: () => registries,
    vault: { read: async (key) => secrets.get(key) ?? null, write: async (key, value) => { secrets.set(key, value); }, remove: async (key) => { secrets.delete(key); } },
    fetch: async (url, init) => {
      if (String(url) === "https://generated-advisories.invalid/querybatch") { metadata++; assert.equal(new Headers(init?.headers).get("Authorization"), null); return Response.json({ results: [{}] }); }
      assert.equal(String(url), "https://generated-registry.invalid/npm/@generated/private-package/-/private-package-1.0.0.tgz");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer GENERATED_PNPM_PRIVATE_TOKEN"); artifacts++; return new Response(artifact.bytes);
    },
  });
  let artifact: Awaited<ReturnType<typeof dependencyArchive>>;
  try {
    artifact = await dependencyArchive(fixture.directory, "@generated/private-package");
    await dependencyProject(fixture.project, artifact, "pnpm");
    registries = [cache.registries.validate({ name: "Generated pnpm registry", url: "https://generated-registry.invalid/npm/", packages: ["@generated/*"], advisoryUrl: "https://generated-advisories.invalid/querybatch", sharePrivateMetadata: true })];
    await cache.registries.changeToken(registries[0]!, "GENERATED_PNPM_PRIVATE_TOKEN", (next) => { registries[0] = next; });
    const project = fixture.service.controller.snapshot().projects.find((entry) => entry.id === fixture.session().projectId)!;
    await mkdir(join(fixture.project, "generated-unread-source"));
    const plan = await cache.inspect(project, "pnpm");
    const receipt = await cache.install(project, "pnpm", plan.digest, AbortSignal.timeout(15_000), () => {});
    assert.equal(receipt.packages, 1); assert.equal(artifacts, 1); assert.equal(metadata, 1);
    assert.match(await readFile(join(fixture.project, "node_modules", artifact.name, "index.js"), "utf8"), /generated shared/);
  } finally { cache.close(); await fixture.close(); }
});
