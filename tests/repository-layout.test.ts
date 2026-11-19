import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { repositoryLayout } from "../apps/service/src/repository-layout.ts";
import { startService } from "../apps/service/src/server.ts";
import { MoguriSdk, PROTOCOL_VERSION } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";

async function repository(path: string) {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "fixture.txt"), "Generated repository layout fixture.\n");
  initializeGeneratedRepository(path);
}

test("repository layout finds one actual nested root without following links or adopting a parent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-repository-layout-"));
  try {
    const root = join(directory, "attached"), nested = join(root, "one", "two", "repo"), external = join(directory, "external");
    await repository(nested); await repository(external); await symlink(external, join(root, "external-link"));
    const layout = await repositoryLayout(root, [], AbortSignal.timeout(5000));
    assert.equal(layout.complete, true); assert.deepEqual(layout.roots, [await realpath(nested)]);
    assert.equal((await repositoryLayout(root, ["one"], AbortSignal.timeout(5000))).complete, false);
    assert.equal((await repositoryLayout(root, [], AbortSignal.timeout(5000), { entries: 1, ms: 2000 })).complete, false);
    await repository(join(root, "another"));
    const multiple = await repositoryLayout(root, [], AbortSignal.timeout(5000));
    assert.equal(multiple.complete, false); assert.equal(multiple.roots.length, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the project Git remote is read live, never saved, and pre-115 stored upstreams are ignored across restart", async () => {
  const fixture = await setupFixture();
  let sdk = await new MoguriSdk(fixture.service.connection).ready(), restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const projectId = fixture.session().projectId;
    assert.equal((await sdk.projects.repositories(projectId)).upstream, null);
    await repository(fixture.project);
    const git = (...args: string[]) => execFileSync("git", ["--no-pager", ...args], { cwd: fixture.project, encoding: "utf8" }).trim();
    assert.equal((await sdk.projects.repositories(projectId)).upstream, null);
    git("remote", "add", "origin", "https://github.com/generated/base.git");
    assert.equal((await sdk.projects.repositories(projectId)).upstream, "origin");
    git("remote", "add", "generated-fork", "https://github.com/generated/fork.git");
    git("config", "--add", "remote.generated-fork.gh-resolved", "base");
    assert.equal((await sdk.projects.repositories(projectId)).upstream, "generated-fork");
    const view = await sdk.projects.git(projectId, false);
    assert.equal(view.type === "project.git" && view.repository, "https://github.com/generated/fork");
    const before = (await sdk.projects.configuration(projectId)).configuration;
    assert.equal(Object.hasOwn(before.values.repo, "upstream"), false);
    await sdk.projects.configure(projectId, { ...before.values, repo: { ...before.values.repo, upstream: "generated-ignored" } }, before.revision);
    const saved = fixture.service.store.events().filter((event) => event.event_type === "project.configured" && event.project_id === projectId).at(-1);
    assert.equal(saved?.event_type === "project.configured" && Object.hasOwn(saved.payload.configuration.values.repo, "upstream"), false);
    const current = (await sdk.projects.configuration(projectId)).configuration;
    fixture.service.store.commit([{ event_type: "project.configured", profile_id: "default", project_id: projectId,
      payload: { configuration: { ...current, revision: current.revision + 1, values: { ...current.values, repo: { ...current.values.repo, upstream: "generated-legacy" } } } } }]);
    sdk.disconnect(); await fixture.service.close();
    const raw = new DatabaseSync(fixture.service.store.path);
    try { raw.exec("PRAGMA user_version=114"); } finally { raw.close(); }
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    sdk = await new MoguriSdk(restarted.connection).ready();
    assert.equal(restarted.store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
    const legacy = (await sdk.projects.configuration(projectId)).configuration;
    assert.equal(legacy.revision, current.revision + 1); assert.equal(Object.hasOwn(legacy.values.repo, "upstream"), false);
    await sdk.projects.configure(projectId, { ...legacy.values, repo: { ...legacy.values.repo, mainBranch: "generated-main" } }, legacy.revision);
    assert.equal((await sdk.projects.repositories(projectId)).upstream, "generated-fork");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await restarted?.close(); await fixture.close(); }
});
