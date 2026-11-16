import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { PROTOCOL_VERSION } from "../packages/protocol/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { removeWorkspaceFoldersFixtureMarker } from "./fixtures/legacy-state.ts";
import { discoverRepositories } from "../apps/service/src/workspace-folders.ts";
import { EventStore, workspaceFoldersSchemaMarker } from "../apps/service/src/store.ts";
import { startService } from "../apps/service/src/server.ts";

async function repository(path: string) {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "fixture.txt"), "generated original\n");
  return initializeGeneratedRepository(path);
}
/** alpha and group/beta are importable; everything else must be skipped. */
async function generatedWorkspace(root: string) {
  const alpha = await repository(join(root, "alpha"));
  await repository(join(root, "group", "beta"));
  await repository(join(root, "group", "beta", "nested-inside-beta"));
  await repository(join(root, ".hidden", "gamma"));
  await repository(join(root, "node_modules", "delta"));
  await repository(join(root, "deep", "one", "two", "too-deep"));
  await symlink(join(root, "alpha"), join(root, "alpha-link"));
  alpha(["worktree", "add", "--quiet", join(root, "alpha-linked"), "-b", "generated-linked"]);
  return alpha;
}
const errorCode = (code: string) => (error: unknown) => (error as { code?: string }).code === code;

test("discovery lists real repositories without following links, entering repositories or hidden folders", async () => {
  const f = await setupFixture();
  try {
    const root = join(f.directory, "workspace");
    await generatedWorkspace(root);
    const result = await discoverRepositories(root, [join(f.directory, "state")], AbortSignal.timeout(10_000));
    assert.deepEqual(result.repositories.map((repository) => repository.relative), ["alpha", "group/beta"]);
    assert.equal(result.linkedWorktrees, 1);
    assert.equal(result.complete, true);
    const limited = await discoverRepositories(root, [], AbortSignal.timeout(10_000), { depth: 3, entries: 100, ms: 10_000, repositories: 1 });
    assert.equal(limited.complete, false);
    assert.match(limited.diagnostic ?? "", /more than 1 repositories/);
  } finally { await f.close(); }
});

test("a trusted folder registers read-only projects that only ever work in Moguri-owned worktrees", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const root = join(f.directory, "workspace");
    const alphaGit = await generatedWorkspace(root);
    const preview = (await sdk.projects.folders.preview(root)).preview;
    assert.deepEqual(preview.document.entries.map((entry) => [entry.relative, entry.disposition]), [["alpha", "new"], ["group/beta", "new"]]);
    await assert.rejects(sdk.projects.folders.import({ ...preview, digest: "0".repeat(64) }, ["alpha"], true, true), errorCode("workspace_folder_stale"));
    await assert.rejects(sdk.projects.folders.import(preview, ["alpha-linked"], true, true), errorCode("workspace_folder_selection"));
    await assert.rejects(sdk.command({ type: "projects.folders.import", path: root, expectedDigest: preview.digest, include: ["alpha"], sync: true } as never));
    const imported = await sdk.projects.folders.import(preview, ["alpha"], true, true);
    const folder = sdk.projects.folders.list().find((entry) => entry.id === imported.id)!;
    assert.equal(folder.sync, true); assert.deepEqual(folder.excluded, ["group/beta"]); assert.equal(folder.trust.actor, "user");
    const canonical = await realpath(root), alpha = sdk.getState().snapshot!.projects.find((project) => project.path === join(canonical, "alpha"))!;
    assert.equal(alpha.workspaceFolderId, folder.id);
    assert.equal(sdk.getState().snapshot!.projects.some((project) => project.path.endsWith("group/beta")), false);
    await assert.rejects(sdk.projects.folders.preview(join(root, "group")), errorCode("workspace_folder_overlap"));

    const index = alphaGit(["write-tree"]), branch = alphaGit(["branch", "--show-current"]);
    await assert.rejects(sdk.command({ type: "session.create", projectId: alpha.id, title: "Generated checkout", workspaceMode: "checkout" }), errorCode("project_read_only"));
    const configuration = (await sdk.projects.configuration(alpha.id)).configuration;
    await assert.rejects(sdk.projects.configure(alpha.id, { ...configuration.values, repo: { ...configuration.values.repo, workspaceMode: "checkout" } }, configuration.revision), errorCode("project_read_only"));
    await assert.rejects(sdk.projects.initialize(alpha.id, "generated-defaults", configuration.revision, true), errorCode("project_read_only"));
    await assert.rejects(sdk.projects.remotePreview(alpha.id, "origin", "https://github.com/generated-owner/generated-repository.git"), errorCode("project_read_only"));
    const created = await sdk.sessions.create(alpha.id, "Generated folder task", { modelId: f.modelId });
    const workspace = await sdk.workspaces.wait(sdk.sessions.get(created.id!)!.workspaceId!);
    assert.equal(workspace.status, "ready");
    assert.ok(workspace.path.startsWith(join(await realpath(join(f.directory, "state")), "worktrees", alpha.id)));
    assert.equal(await readFile(join(workspace.path, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(alphaGit(["write-tree"]), index); assert.equal(alphaGit(["branch", "--show-current"]), branch);
    assert.equal(alphaGit(["status", "--porcelain"]), "");
    const fresh = await sdk.sessions.create(alpha.id, "Generated rebind attempt");
    await assert.rejects(sdk.command({ type: "session.workspace", sessionId: fresh.id!, expectedRevision: sdk.sessions.get(fresh.id!)!.revision, workspaceId: null }), errorCode("project_read_only"));
  } finally { sdk.disconnect(); await f.close(); }
});

test("sync adds new repositories, honors exclusions and removals, pauses when off and survives restart", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture();
  let sdk = await new MoguriSdk(f.service.connection).ready(), restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const root = join(f.directory, "workspace");
    await repository(join(root, "alpha")); await repository(join(root, "beta"));
    const preview = (await sdk.projects.folders.preview(root)).preview;
    const folderId = (await sdk.projects.folders.import(preview, ["alpha"], true, true)).id!;
    const projects = () => sdk.getState().snapshot!.projects.filter((project) => project.workspaceFolderId === folderId).map((project) => project.name).sort();
    assert.deepEqual(projects(), ["alpha"]);
    const before = f.service.store.events().length;
    await sdk.projects.folders.check(folderId);
    assert.equal(f.service.store.events().length, before, "an unchanged check appends nothing");

    await repository(join(root, "gamma"));
    await sdk.projects.folders.check(folderId);
    assert.deepEqual(projects(), ["alpha", "gamma"]);
    const status = (await sdk.projects.folders.status()).folders.find((entry) => entry.folderId === folderId)!;
    assert.equal(status.added, 1); assert.equal(status.status, "idle");

    const gamma = sdk.getState().snapshot!.projects.find((project) => project.name === "gamma")!;
    const revision = (await sdk.projects.configuration(gamma.id)).configuration.revision;
    await sdk.projects.remove(gamma.id, true, revision, { action: "retain", expectedDigest: (await sdk.artifacts.projectPreview(gamma.id)).preview.digest });
    assert.deepEqual(sdk.projects.folders.list()[0]!.excluded, ["beta", "gamma"]);
    await sdk.projects.folders.check(folderId);
    assert.deepEqual(projects(), ["alpha"]);

    await sdk.projects.folders.configure(folderId, false);
    await repository(join(root, "delta"));
    await sdk.projects.folders.check(folderId);
    assert.deepEqual(projects(), ["alpha"]);
    assert.equal((await sdk.projects.folders.status()).folders[0]!.available, 1);

    sdk.disconnect(); await f.service.close();
    restarted = await startService({ stateDir: join(f.directory, "state"), provider: f.provider, retentionKey: f.retentionKey });
    sdk = await new MoguriSdk(restarted.connection).ready();
    assert.equal(sdk.projects.folders.list()[0]!.sync, false);
    await sdk.projects.folders.configure(folderId, true);
    await sdk.projects.folders.check(folderId);
    assert.deepEqual(projects(), ["alpha", "delta"]);
    await sdk.projects.folders.remove(folderId);
    assert.equal(sdk.projects.folders.list().length, 0);
    assert.equal(sdk.getState().snapshot!.projects.find((project) => project.name === "alpha")?.workspaceFolderId, folderId, "removing the folder keeps its projects read-only");
  } finally { sdk.disconnect(); await restarted?.close(); await f.close(); }
});

for (const change of ["upgrade", "missing", "premature", "history"] as const) {
  test(`workspace folder schema ${change} preserves original state`, async () => {
    const f = await setupFixture();
    try {
      if (change === "history") {
        const sdk = await new MoguriSdk(f.service.connection).ready();
        await repository(join(f.directory, "workspace", "alpha"));
        const preview = (await sdk.projects.folders.preview(join(f.directory, "workspace"))).preview;
        await sdk.projects.folders.import(preview, ["alpha"], false, true);
        sdk.disconnect();
      }
      await f.service.close();
      const path = f.service.store.path, raw = new DatabaseSync(path);
      try {
        if (change === "history") assert.throws(() => removeWorkspaceFoldersFixtureMarker(new DatabaseSync(":memory:"), f.service.controller.events(0)), /genuine pre-109 history/);
        else if (change === "upgrade") removeWorkspaceFoldersFixtureMarker(raw, f.service.controller.events(0));
        raw.exec(change === "missing" ? `DELETE FROM retention_metadata WHERE id='${workspaceFoldersSchemaMarker}'` :
          change === "history" ? `DELETE FROM retention_metadata WHERE id='${workspaceFoldersSchemaMarker}'; PRAGMA user_version=108` : "PRAGMA user_version=108");
      } finally { raw.close(); }
      if (change === "upgrade") {
        const reopened = new EventStore(path, f.retentionKey);
        try {
          assert.equal(reopened.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
          assert.equal(reopened.db.prepare("SELECT value FROM retention_metadata WHERE id=?").get(workspaceFoldersSchemaMarker)?.value, "1");
        } finally { reopened.close(); }
        return;
      }
      assert.throws(() => new EventStore(path, f.retentionKey),
        change === "missing" ? /Missing or invalid workspace folders schema marker/ : change === "premature" ? /Premature workspace folders schema marker/ : /pre-109 lineage/);
    } finally { await f.close(); }
  });
}
