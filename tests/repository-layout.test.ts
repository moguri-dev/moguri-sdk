import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repositoryLayout } from "../apps/service/src/repository-layout.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
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

test("upstream settings reject non-repositories and ambiguous layouts through the actual SDK", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const projectId = fixture.session().projectId, before = (await sdk.projects.configuration(projectId)).configuration;
    await assert.rejects(() => sdk.projects.configure(projectId, { ...before.values, repo: { ...before.values.repo, upstream: "generated-upstream" } }, before.revision), /exactly one verified repository/);
    await repository(join(fixture.project, "nested"));
    assert.equal((await sdk.projects.repositories(projectId)).roots.length, 1);
    await sdk.projects.configure(projectId, { ...before.values, repo: { ...before.values.repo, upstream: "generated-upstream" } }, before.revision);
    await repository(join(fixture.project, "another"));
    const current = (await sdk.projects.configuration(projectId)).configuration;
    await assert.rejects(() => sdk.projects.configure(projectId, { ...current.values, repo: { ...current.values.repo, upstream: "generated-other" } }, current.revision), /exactly one verified repository/);
    assert.equal((await sdk.projects.configuration(projectId)).configuration.values.repo.upstream, "generated-upstream");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
