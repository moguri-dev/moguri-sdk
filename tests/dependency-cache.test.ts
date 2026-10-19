import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import * as cacache from "cacache";
import { DraftEditor, MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { dependencyArchive, dependencyProject } from "./fixtures/dependencies.ts";

test("npm worktree branches share verified archives but retain their own lock plans and script-free installs", { timeout: 30_000 }, async () => {
  let downloads = 0; let audits = 0;
  let artifact: Awaited<ReturnType<typeof dependencyArchive>>;
  const fixture = await setupFixture({ platform: { cache: { fetch: async (url) => {
    if (String(url).includes("api.osv.dev")) { audits++; return Response.json({ results: [{}] }); }
    assert.equal(url, artifact.url); downloads++; return new Response(artifact.bytes);
  } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    artifact = await dependencyArchive(fixture.directory);
    await dependencyProject(fixture.project, artifact);
    const git = (args: string[]) => promisify(execFile)("git", ["-C", fixture.project, ...args]);
    await git(["init", "--initial-branch", "main"]);
    await git(["add", "."]);
    await git(["-c", "user.name=Generated Fixture", "-c", "user.email=generated@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "--no-gpg-sign", "-m", "generated"]);
    const branch = join(fixture.directory, "generated-branch");
    await git(["worktree", "add", "-b", "generated-branch", branch]);
    const second = await sdk.command({ type: "project.add", path: branch });
    for (const id of [fixture.session().projectId, second.id!]) {
      const { plan } = await sdk.cache.inspect(id, "npm");
      const job = await sdk.cache.install(id, "npm", plan.digest, true);
      const result = await sdk.jobs.wait(job.id!);
      assert.equal(result.status, "completed", result.error ?? "");
    }
    assert.equal(downloads, 1);
    assert.equal(audits, 2);
    assert.equal(sdk.getState().snapshot?.dependencyCaches.find((entry) => entry.projectId === second.id)?.reused, 1);
    for (const path of [fixture.project, branch]) {
      assert.match(await readFile(join(path, "node_modules", artifact.name, "index.js"), "utf8"), /generated shared dependency/);
      assert.equal(existsSync(join(path, "node_modules", artifact.name, "UNSAFE_SCRIPT_RAN")), false);
      assert.equal(existsSync(join(path, "UNSAFE_ROOT_SCRIPT_RAN")), false);
    }
    const { plan } = await sdk.cache.inspect(second.id!, "npm");
    const manifest = join(branch, "package.json");
    await writeFile(manifest, (await readFile(manifest, "utf8")) + "\n");
    const stale = await sdk.cache.prepare(second.id!, "npm", plan.digest, true);
    assert.match((await sdk.jobs.wait(stale.id!)).error!, /changed|branch switch/);
    assert.equal(downloads, 1);
    await assert.rejects(() => sdk.cache.install(second.id!, "npm", plan.digest, true, true), /SendBox/);
    await sdk.command({ type: "policy.set", allowedEnvs: ["Sandbox", "Remote"] });
    await assert.rejects(() => sdk.cache.prepare(second.id!, "npm", plan.digest, true), /Local/);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("concurrent preparation shares one in-flight immutable artifact", async () => {
  let artifact: Awaited<ReturnType<typeof dependencyArchive>>;
  let downloads = 0; let audits = 0; let release: (() => void) | undefined;
  const fixture = await setupFixture({ platform: { cache: { fetch: async (url) => {
    if (String(url).includes("api.osv.dev")) { audits++; return Response.json({ results: [{}] }); }
    downloads++; await new Promise<void>((resolve) => { release = resolve; });
    return new Response(artifact.bytes);
  } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    artifact = await dependencyArchive(fixture.directory); await dependencyProject(fixture.project, artifact);
    const { plan } = await sdk.cache.inspect(fixture.session().projectId, "npm");
    const first = await sdk.cache.prepare(plan.projectId, "npm", plan.digest, true);
    await waitFor(() => release);
    const second = await sdk.cache.prepare(plan.projectId, "npm", plan.digest, true);
    await waitFor(() => audits === 2);
    release!();
    assert.equal((await sdk.jobs.wait(first.id!)).status, "completed");
    assert.equal((await sdk.jobs.wait(second.id!)).status, "completed");
    assert.equal(downloads, 1);
  } finally { release?.(); sdk.disconnect(); await fixture.close(); }
});

test("a managed install owns the project lease until cancellation settles", { skip: process.platform !== "darwin", timeout: 15_000 }, async () => {
  let fetching = false;
  const fixture = await setupFixture({ platform: { cache: { fetch: async (url, init) => {
    if (String(url).includes("api.osv.dev")) return Response.json({ results: [{}] });
    fetching = true; return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Generated cancelled", "AbortError")), { once: true }));
  } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.configure();
    const artifact = await dependencyArchive(fixture.directory); await dependencyProject(fixture.project, artifact);
    const { plan } = await sdk.cache.inspect(fixture.session().projectId, "npm");
    const job = await sdk.cache.install(plan.projectId, "npm", plan.digest, true);
    await waitFor(() => fetching);
    await assert.rejects(() => sdk.cache.install(plan.projectId, "npm", plan.digest, true), /busy/);
    const draft = new DraftEditor(sdk, fixture.sessionId, fixture.session().draft);
    try { draft.edit("generated task after install"); await draft.send("queue"); } finally { draft.dispose(); }
    assert.equal(fixture.requests.length, 0);
    await sdk.jobs.cancel(job.id!);
    assert.equal((await sdk.jobs.wait(job.id!)).status, "cancelled");
    await waitFor(() => fixture.requests.length === 1);
    assert.equal((await fixture.terminal()).status, "completed");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("failed managed installs preserve the old dependency tree and quarantine automatic work", async () => {
  let artifact: Awaited<ReturnType<typeof dependencyArchive>>;
  const fixture = await setupFixture({ platform: { cache: { fetch: async (url) => String(url).includes("api.osv.dev") ? Response.json({ results: [{}] }) : new Response(artifact.bytes) } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    artifact = await dependencyArchive(fixture.directory); await dependencyProject(fixture.project, artifact);
    const previousTree = join(fixture.directory, "generated-existing-dependencies");
    await mkdir(previousTree, { recursive: true });
    await writeFile(join(previousTree, "generated-old-tree"), "generated original dependencies");
    await symlink(previousTree, join(fixture.project, "node_modules"), "dir");
    const { plan } = await sdk.cache.inspect(fixture.session().projectId, "npm");
    const job = await sdk.cache.install(plan.projectId, "npm", plan.digest, true);
    assert.equal((await sdk.jobs.wait(job.id!)).status, "partial");
    assert.equal(await readFile(join(fixture.project, "node_modules", "generated-old-tree"), "utf8"), "generated original dependencies");
    assert.ok(sdk.getState().snapshot?.blockedProjects.includes(plan.projectId));
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("cache admission rejects local manifest references and hidden pnpm directory/patch resolutions before networking", async () => {
  let requests = 0;
  const fixture = await setupFixture({ platform: { cache: { fetch: async () => { requests++; throw new Error("No network should be reached."); } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const artifact = await dependencyArchive(fixture.directory);
    await dependencyProject(fixture.project, artifact);
    const manifest = JSON.parse(await readFile(join(fixture.project, "package.json"), "utf8"));
    manifest.dependencies[artifact.name] = "file:/generated/private";
    await writeFile(join(fixture.project, "package.json"), JSON.stringify(manifest));
    await assert.rejects(() => sdk.cache.inspect(fixture.session().projectId, "npm"), /Local|local|registry names/);
    await dependencyProject(fixture.project, artifact, "pnpm");
    const lock = join(fixture.project, "pnpm-lock.yaml");
    const original = await readFile(lock, "utf8");
    await writeFile(lock, original.replace(`resolution: {integrity: ${artifact.integrity}}`, `resolution: {integrity: ${artifact.integrity}, directory: /generated/private, type: directory}`));
    await assert.rejects(() => sdk.cache.inspect(fixture.session().projectId, "pnpm"), /directory|resolution/);
    await writeFile(lock, original + "\npatchedDependencies:\n  generated-shared-package: /generated/private.patch\n");
    await assert.rejects(() => sdk.cache.inspect(fixture.session().projectId, "pnpm"), /patch/);
    await writeFile(lock, original.replace(`version: ${artifact.version}`, "version: file:/generated/private"));
    await assert.rejects(() => sdk.cache.inspect(fixture.session().projectId, "pnpm"), /reference|resolution/);
    assert.equal(requests, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("pnpm uses the same verified archive cache and native shared store without running hooks or scripts", { timeout: 30_000 }, async () => {
  let artifact: Awaited<ReturnType<typeof dependencyArchive>>;
  let downloads = 0;
  const fixture = await setupFixture({ platform: { cache: { fetch: async (url) => {
    if (String(url).includes("api.osv.dev")) return Response.json({ results: [{}] });
    downloads++; return new Response(artifact.bytes);
  } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    artifact = await dependencyArchive(fixture.directory, "@generated/shared-package");
    await dependencyProject(fixture.project, artifact, "pnpm");
    await writeFile(join(fixture.project, ".pnpmfile.cjs"), "require('node:fs').writeFileSync('UNSAFE_HOOK_RAN','generated'); module.exports={};");
    await writeFile(join(fixture.project, ".npmrc"), "modules-dir=../generated-outside\nregistry=https://generated.invalid\n");
    const { plan } = await sdk.cache.inspect(fixture.session().projectId, "pnpm");
    const prepared = await sdk.cache.prepare(fixture.session().projectId, "pnpm", plan.digest, true);
    assert.equal((await sdk.jobs.wait(prepared.id!)).status, "completed");
    const installed = await sdk.cache.install(fixture.session().projectId, "pnpm", plan.digest, true);
    const result = await sdk.jobs.wait(installed.id!);
    assert.equal(result.status, "completed", result.error ?? "");
    assert.equal(downloads, 1);
    assert.equal(existsSync(join(fixture.project, "UNSAFE_HOOK_RAN")), false);
    assert.equal(existsSync(join(fixture.project, "UNSAFE_ROOT_SCRIPT_RAN")), false);
    assert.equal(existsSync(join(fixture.project, "node_modules", artifact.name, "UNSAFE_SCRIPT_RAN")), false);
    assert.equal(existsSync(join(fixture.directory, "generated-outside")), false);
    assert.match(await readFile(join(fixture.project, "node_modules", artifact.name, "index.js"), "utf8"), /generated shared dependency/);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("known vulnerabilities, incomplete audits and corrupt archives cannot be served or installed", async () => {
  let artifact: Awaited<ReturnType<typeof dependencyArchive>>;
  let response: unknown = { results: [{ vulns: [{ id: "GENERATED-ADVISORY" }] }] };
  let downloads = 0;
  const fixture = await setupFixture({ platform: { cache: { fetch: async (url) => {
    if (String(url).includes("api.osv.dev")) return Response.json(response);
    downloads++; return new Response(artifact.bytes);
  } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    artifact = await dependencyArchive(fixture.directory); await dependencyProject(fixture.project, artifact);
    const { plan } = await sdk.cache.inspect(fixture.session().projectId, "npm");
    const denied = await sdk.cache.prepare(fixture.session().projectId, "npm", plan.digest, true);
    assert.match((await sdk.jobs.wait(denied.id!)).error!, /Known vulnerabilities/);
    assert.equal(downloads, 0);
    response = { results: [] };
    const unknown = await sdk.cache.prepare(fixture.session().projectId, "npm", plan.digest, true);
    assert.match((await sdk.jobs.wait(unknown.id!)).error!, /incomplete/);
    assert.equal(downloads, 0);
    response = { results: [{}] };
    const good = await sdk.cache.prepare(fixture.session().projectId, "npm", plan.digest, true);
    assert.equal((await sdk.jobs.wait(good.id!)).status, "completed");
    response = { results: [{ vulns: [{ id: "GENERATED-NEW-ADVISORY" }] }] };
    const revoked = await sdk.cache.prepare(fixture.session().projectId, "npm", plan.digest, true);
    assert.match((await sdk.jobs.wait(revoked.id!)).error!, /Known vulnerabilities/);
    assert.equal(downloads, 1);
    response = { results: [{}] };
    const info = await cacache.get.info(join(plan.npmCache, "_cacache"), `make-fetch-happen:request-cache:${artifact.url}`);
    assert.ok(info);
    await writeFile(info.path, "generated poisoned bytes");
    const corrupt = await sdk.cache.prepare(fixture.session().projectId, "npm", plan.digest, true);
    assert.match((await sdk.jobs.wait(corrupt.id!)).error!, /integrity/);
    assert.equal(downloads, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("cancelling an owned cache download leaves no successful receipt and no automatic retry", async () => {
  let fetching = false; let aborted = false;
  const fixture = await setupFixture({ platform: { cache: { fetch: async (url, init) => {
    if (String(url).includes("api.osv.dev")) return Response.json({ results: [{}] });
    fetching = true;
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("Generated cancellation", "AbortError")); }, { once: true }));
  } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const artifact = await dependencyArchive(fixture.directory); await dependencyProject(fixture.project, artifact);
    const { plan } = await sdk.cache.inspect(fixture.session().projectId, "npm");
    const job = await sdk.cache.prepare(fixture.session().projectId, "npm", plan.digest, true);
    await waitFor(() => fetching);
    await sdk.jobs.cancel(job.id!);
    assert.equal((await sdk.jobs.wait(job.id!)).status, "cancelled");
    assert.equal(aborted, true);
    assert.equal(sdk.getState().snapshot?.dependencyCaches.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
