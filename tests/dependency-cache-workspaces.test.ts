import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { dependencyArchive } from "./fixtures/dependencies.ts";

async function monorepo(path: string, artifact: Awaited<ReturnType<typeof dependencyArchive>>, manager: "npm" | "pnpm") {
  const root = { name: "generated-workspace", version: "1.0.0", private: true, workspaces: ["packages/*"], scripts: { preinstall: "node -e \"throw Error('Root hooks must not run')\"" } };
  const a = { name: "@generated/member-a", version: "1.0.0", dependencies: { "@generated/member-b": manager === "pnpm" ? "workspace:*" : "*", [artifact.name]: artifact.version }, scripts: { postinstall: "node -e \"throw Error('Member hooks must not run')\"" } };
  const b = { name: "@generated/member-b", version: "1.0.0", dependencies: { [artifact.name]: artifact.version } };
  for (const [directory, manifest] of [["", root], ["packages/a", a], ["packages/b", b]] as const) {
    await mkdir(join(path, directory), { recursive: true }); await writeFile(join(path, directory, "package.json"), JSON.stringify(manifest));
  }
  await writeFile(join(path, "packages/a", "source-kept.js"), "generated source is never staged or replaced");
  if (manager === "npm") await writeFile(join(path, "package-lock.json"), JSON.stringify({ name: root.name, version: root.version, lockfileVersion: 3, packages: {
    "": { name: root.name, version: root.version, workspaces: root.workspaces },
    "packages/a": { name: a.name, version: a.version, dependencies: a.dependencies, hasInstallScript: true },
    "packages/b": { name: b.name, version: b.version, dependencies: b.dependencies },
    "node_modules/@generated/member-a": { resolved: "packages/a", link: true },
    "node_modules/@generated/member-b": { resolved: "packages/b", link: true },
    [`node_modules/${artifact.name}`]: { version: artifact.version, resolved: artifact.url, integrity: artifact.integrity, hasInstallScript: true },
  } }));
  else {
    await writeFile(join(path, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    await writeFile(join(path, "pnpm-lock.yaml"), stringify({ lockfileVersion: "9.0", settings: { autoInstallPeers: true, excludeLinksFromLockfile: false }, importers: {
      ".": {},
      "packages/a": { dependencies: { "@generated/member-b": { specifier: "workspace:*", version: "link:../b" }, [artifact.name]: { specifier: artifact.version, version: artifact.version } } },
      "packages/b": { dependencies: { [artifact.name]: { specifier: artifact.version, version: artifact.version } } },
    }, packages: { [`${artifact.name}@${artifact.version}`]: { resolution: { integrity: artifact.integrity } } }, snapshots: { [`${artifact.name}@${artifact.version}`]: {} } }));
  }
  return { root, a, b };
}
for (const manager of ["npm", "pnpm"] as const) {
  test(`${manager} installs a generated exact multi-member workspace without scripts or ambient config`, { timeout: 30_000 }, async () => {
    let artifact: Awaited<ReturnType<typeof dependencyArchive>>, downloads = 0;
    const fixture = await setupFixture({ platform: { cache: { fetch: async (url, init) => {
      if (String(url).includes("api.osv.dev")) { const body = JSON.parse(String(init?.body)); return Response.json({ results: body.queries.map(() => ({})) }); }
      assert.equal(String(url), artifact.url); downloads++; return new Response(artifact.bytes);
    } } } });
    const sdk = await new MoguriSdk(fixture.service.connection).ready();
    try {
      artifact = await dependencyArchive(fixture.directory);
      await monorepo(fixture.project, artifact, manager);
      await writeFile(join(fixture.project, ".npmrc"), "registry=https://unreviewed.invalid\n");
      await writeFile(join(fixture.project, ".pnpmfile.cjs"), "throw Error('Unreviewed hook must never run')");
      const { plan } = await sdk.cache.inspect(fixture.session().projectId, manager);
      assert.equal(plan.manifests?.length, 3);
      const job = await sdk.cache.install(plan.projectId, manager, plan.digest, true);
      const result = await sdk.jobs.wait(job.id!);
      assert.equal(result.status, "completed", result.error ?? "");
      assert.equal(downloads, 1);
      assert.match(await readFile(join(fixture.project, manager === "npm" ? "node_modules" : "packages/a/node_modules", artifact.name, "index.js"), "utf8"), /generated shared/);
      assert.equal(await realpath(join(fixture.project, manager === "npm" ? "node_modules/@generated/member-b" : "packages/a/node_modules/@generated/member-b")), await realpath(join(fixture.project, "packages/b")));
      assert.equal(await readFile(join(fixture.project, "packages/a/source-kept.js"), "utf8"), "generated source is never staged or replaced");
      assert.equal(existsSync(join(fixture.project, manager === "npm" ? "node_modules" : "packages/a/node_modules", artifact.name, "UNSAFE_SCRIPT_RAN")), false);
      await writeFile(join(fixture.project, "packages/b/package.json"), (await readFile(join(fixture.project, "packages/b/package.json"), "utf8")) + "\n");
      const stale = await sdk.cache.prepare(plan.projectId, manager, plan.digest, true);
      assert.match((await sdk.jobs.wait(stale.id!)).error!, /member.*changed|changed/);
      assert.equal(downloads, 1);
    } finally { sdk.disconnect(); await fixture.close(); }
  });
}
test("workspace discovery rejects symlink members, traversal and undeclared local lock links before networking", async () => {
  let requests = 0;
  const fixture = await setupFixture({ platform: { cache: { fetch: async () => { requests++; throw Error("No networking admitted"); } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const artifact = await dependencyArchive(fixture.directory);
    await monorepo(fixture.project, artifact, "npm");
    const root = JSON.parse(await readFile(join(fixture.project, "package.json"), "utf8"));
    root.workspaces = ["../outside"];
    await writeFile(join(fixture.project, "package.json"), JSON.stringify(root));
    await assert.rejects(() => sdk.cache.inspect(fixture.session().projectId, "npm"), /in-root|traversal/);
    root.workspaces = ["packages/*"];
    await writeFile(join(fixture.project, "package.json"), JSON.stringify(root));
    const external = join(fixture.directory, "generated-external"); await mkdir(external);
    await symlink(external, join(fixture.project, "packages/linked"), "dir");
    await assert.rejects(() => sdk.cache.inspect(fixture.session().projectId, "npm"), /symlink/);
    assert.equal(requests, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("multi-member publication restores all earlier roots when a later member target is unsafe", { timeout: 30_000 }, async () => {
  let artifact: Awaited<ReturnType<typeof dependencyArchive>>;
  const fixture = await setupFixture({ platform: { cache: { fetch: async (url) => String(url).includes("api.osv.dev") ? Response.json({ results: [{}] }) : new Response(artifact.bytes) } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    artifact = await dependencyArchive(fixture.directory); await monorepo(fixture.project, artifact, "npm");
    for (const directory of ["node_modules", "packages/a/node_modules"]) {
      await mkdir(join(fixture.project, directory), { recursive: true });
      await writeFile(join(fixture.project, directory, "old-tree-marker"), directory);
    }
    const external = join(fixture.directory, "unrelated-old-tree"); await mkdir(external); await writeFile(join(external, "keep"), "generated external tree");
    await symlink(external, join(fixture.project, "packages/b/node_modules"), "dir");
    const { plan } = await sdk.cache.inspect(fixture.session().projectId, "npm");
    const job = await sdk.cache.install(plan.projectId, "npm", plan.digest, true);
    const result = await sdk.jobs.wait(job.id!); assert.equal(result.status, "partial", result.error ?? "");
    for (const directory of ["node_modules", "packages/a/node_modules"]) assert.equal(await readFile(join(fixture.project, directory, "old-tree-marker"), "utf8"), directory);
    assert.equal(await readFile(join(external, "keep"), "utf8"), "generated external tree");
    assert.deepEqual((await readdir(fixture.project)).filter((name) => name.startsWith(".moguri-dependencies-")), []);
    assert.ok(sdk.getState().snapshot?.blockedProjects.includes(plan.projectId));
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("interrupted dependency journals and backups are retained rather than replayed or deleted", async () => {
  let artifact: Awaited<ReturnType<typeof dependencyArchive>>, requests = 0;
  const fixture = await setupFixture({ platform: { cache: { fetch: async () => { requests++; return new Response(artifact.bytes); } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    artifact = await dependencyArchive(fixture.directory); await monorepo(fixture.project, artifact, "npm");
    const retained = join(fixture.project, ".moguri-dependencies-generated-interrupted"); await mkdir(retained);
    await writeFile(join(retained, "publication.json"), JSON.stringify({ version: 1, status: "publishing", roots: [] }));
    await writeFile(join(retained, "protected-previous-tree"), "generated old bytes");
    const { plan } = await sdk.cache.inspect(fixture.session().projectId, "npm");
    const job = await sdk.cache.install(plan.projectId, "npm", plan.digest, true);
    assert.match((await sdk.jobs.wait(job.id!)).error!, /earlier protected|journal.*backups/);
    assert.equal(requests, 0); assert.equal(await readFile(join(retained, "protected-previous-tree"), "utf8"), "generated old bytes");
  } finally { sdk.disconnect(); await fixture.close(); }
});
test("a replaced root invalidates the plan even when every reviewed manifest and lock byte is unchanged", async () => {
  let artifact: Awaited<ReturnType<typeof dependencyArchive>>, requests = 0;
  const fixture = await setupFixture({ platform: { cache: { fetch: async () => { requests++; return new Response(artifact.bytes); } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    artifact = await dependencyArchive(fixture.directory); await monorepo(fixture.project, artifact, "npm");
    const { plan } = await sdk.cache.inspect(fixture.session().projectId, "npm");
    const previous = join(fixture.directory, "generated-previous-physical-root");
    await rename(fixture.project, previous); await mkdir(fixture.project);
    for (const path of ["package.json", "package-lock.json", "packages/a/package.json", "packages/b/package.json"]) {
      await mkdir(join(fixture.project, path.split("/").slice(0, -1).join("/")), { recursive: true });
      await writeFile(join(fixture.project, path), await readFile(join(previous, path)));
    }
    const changed = (await sdk.cache.inspect(plan.projectId, "npm")).plan;
    assert.equal(changed.manifestDigest, plan.manifestDigest); assert.equal(changed.lockDigest, plan.lockDigest);
    assert.notEqual(changed.root?.inode, plan.root?.inode); assert.notEqual(changed.digest, plan.digest);
    const job = await sdk.cache.prepare(plan.projectId, "npm", plan.digest, true);
    assert.match((await sdk.jobs.wait(job.id!)).error!, /changed/); assert.equal(requests, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
