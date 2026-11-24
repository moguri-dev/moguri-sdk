import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { ciTime } from "./fixtures/time-scale.ts";

const darwin = { skip: process.platform !== "darwin" };
const run = (cwd: string, args: string[]) => execFileSync("git", ["--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "user.name=Generated fixture",
  "-c", "user.email=fixture@example.invalid", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const hasRef = (cwd: string, ref: string) => run(cwd, ["for-each-ref", "--format=%(refname)", ref]) === ref;

async function fixture() {
  const f = await setupFixture();
  await writeFile(join(f.project, ".gitignore"), ".env\nnode_modules/\n");
  const git = initializeGeneratedRepository(f.project, ["fixture.txt", ".gitignore"]), remote = await mkdtemp(join(tmpdir(), "moguri-generated-remote-"));
  run(remote, ["init", "--bare", "--initial-branch=main"]);
  git(["remote", "add", "origin", remote]); git(["push", "--quiet", "origin", "main"]);
  const sdk = await new MoguriSdk(f.service.connection).ready();
  const session = async (title: string) => {
    const created = await sdk.sessions.create(f.session().projectId, title, { modelId: f.modelId });
    const workspace = await sdk.workspaces.wait(sdk.sessions.get(created.id!)!.workspaceId!);
    return { id: created.id!, workspace };
  };
  const workspace = (id: string) => sdk.getState().snapshot!.managedWorkspaces.find((value) => value.id === id)!;
  const commit = (path: string, name: string) => { run(path, ["add", "--", name]); run(path, ["commit", "--no-gpg-sign", "--quiet", "-m", `Generated ${name}`]); return run(path, ["rev-parse", "HEAD"]); };
  return { f, sdk, remote, session, workspace, commit, close: async () => { sdk.disconnect(); await f.close(); await rm(remote, { recursive: true, force: true }); } };
}

test("archiving removes a clean pushed worktree and its local branch, and restoring recreates it from the remote branch", darwin, async () => {
  const t = await fixture();
  try {
    const { id, workspace } = await t.session("Generated pushed archive");
    await writeFile(join(workspace.path, "generated-change.txt"), "Generated committed change.\n");
    const head = t.commit(workspace.path, "generated-change.txt");
    run(workspace.path, ["push", "--quiet", "-u", "origin", workspace.branch]);
    await t.sdk.command({ type: "session.archive", sessionId: id });
    await waitFor(() => t.workspace(workspace.id).status === "removed", 20_000);
    const parked = t.workspace(workspace.id);
    assert.equal(parked.parked?.head, head); assert.equal(parked.parked?.remoteRef, `refs/remotes/origin/${workspace.branch}`);
    assert.equal(parked.parked?.branchDeleted, true); assert.equal(parked.cleanup?.outcome, "removed");
    assert.match(parked.cleanup!.reason, /local branch .* deleted; its commits are on origin\//);
    assert.equal(existsSync(workspace.path), false);
    assert.equal(hasRef(t.f.project, `refs/heads/${workspace.branch}`), false);
    assert.equal(run(t.f.project, [`--git-dir=${t.remote}`, "rev-parse", `refs/heads/${workspace.branch}`]), head);

    await t.sdk.command({ type: "session.restore", sessionId: id });
    await waitFor(() => t.workspace(workspace.id).status === "ready", 20_000);
    const restored = t.workspace(workspace.id);
    assert.equal(restored.path, workspace.path); assert.equal(restored.parked, null);
    assert.match(restored.diagnostic ?? "", /Restored from origin\/.* at /);
    assert.equal(await readFile(join(workspace.path, "generated-change.txt"), "utf8"), "Generated committed change.\n");
    assert.equal(run(workspace.path, ["rev-parse", "HEAD"]), head);
    assert.equal(run(workspace.path, ["branch", "--show-current"]), workspace.branch);
    assert.equal(run(workspace.path, ["rev-parse", "--abbrev-ref", "@{upstream}"]), `origin/${workspace.branch}`);
    assert.equal(run(workspace.path, ["status", "--porcelain"]), "");
  } finally { await t.close(); }
});

test("archiving keeps unpushed, dirty and untracked work with a visible reason, and the setting can turn cleanup off", darwin, async () => {
  const t = await fixture();
  try {
    const unpushed = await t.session("Generated unpushed archive");
    await writeFile(join(unpushed.workspace.path, "generated-local.txt"), "Generated local-only commit.\n");
    t.commit(unpushed.workspace.path, "generated-local.txt");
    const dirty = await t.session("Generated dirty archive");
    await writeFile(join(dirty.workspace.path, "generated-untracked.txt"), "Generated untracked bytes.\n");
    await t.sdk.command({ type: "session.archive", sessionId: unpushed.id });
    await t.sdk.command({ type: "session.archive", sessionId: dirty.id });
    await waitFor(() => Boolean(t.workspace(unpushed.workspace.id).cleanup && t.workspace(dirty.workspace.id).cleanup), 20_000);
    assert.equal(t.workspace(unpushed.workspace.id).status, "ready");
    assert.equal(t.workspace(unpushed.workspace.id).cleanup?.outcome, "kept");
    assert.match(t.workspace(unpushed.workspace.id).cleanup!.reason, /aren't on a remote branch yet/);
    assert.equal(hasRef(t.f.project, `refs/heads/${unpushed.workspace.branch}`), true);
    assert.equal(t.workspace(dirty.workspace.id).cleanup?.outcome, "kept");
    assert.match(t.workspace(dirty.workspace.id).cleanup!.reason, /uncommitted or untracked changes/);
    assert.equal(await readFile(join(dirty.workspace.path, "generated-untracked.txt"), "utf8"), "Generated untracked bytes.\n");

    const values = t.sdk.getState().snapshot!.settings;
    await t.sdk.settings.update({ ...values.values, retention: { ...values.values.retention, archiveBranchCleanup: false } }, values.revision, false);
    const off = await t.session("Generated cleanup off");
    run(off.workspace.path, ["push", "--quiet", "-u", "origin", off.workspace.branch]);
    await t.sdk.command({ type: "session.archive", sessionId: off.id });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(t.workspace(off.workspace.id).status, "ready");
    assert.equal(t.workspace(off.workspace.id).cleanup ?? null, null);
    assert.equal(hasRef(t.f.project, `refs/heads/${off.workspace.branch}`), true);
  } finally { await t.close(); }
});

test("a different local branch with the parked name blocks restoring instead of replacing it", darwin, async () => {
  const t = await fixture();
  try {
    const { id, workspace } = await t.session("Generated restore conflict");
    run(workspace.path, ["push", "--quiet", "-u", "origin", workspace.branch]);
    await t.sdk.command({ type: "session.archive", sessionId: id });
    await waitFor(() => t.workspace(workspace.id).status === "removed", 20_000);
    await writeFile(join(t.f.project, "generated-other.txt"), "Generated other branch.\n");
    run(t.f.project, ["checkout", "--quiet", "-b", workspace.branch]);
    t.commit(t.f.project, "generated-other.txt");
    run(t.f.project, ["checkout", "--quiet", "main"]);
    const other = run(t.f.project, ["rev-parse", `refs/heads/${workspace.branch}`]);
    await t.sdk.command({ type: "session.restore", sessionId: id });
    await waitFor(() => t.workspace(workspace.id).status === "partial", 20_000);
    assert.match(t.workspace(workspace.id).diagnostic ?? "", /different local branch named/);
    assert.equal(run(t.f.project, ["rev-parse", `refs/heads/${workspace.branch}`]), other);
    assert.ok(t.workspace(workspace.id).parked);
  } finally { await t.close(); }
});

test("archive cleanup keeps ignored files that may not be rebuildable but removes rebuildable dependency folders", darwin, async () => {
  const t = await fixture();
  try {
    const secret = await t.session("Generated ignored secret");
    await writeFile(join(secret.workspace.path, ".env"), "GENERATED_PLACEHOLDER=1\n");
    run(secret.workspace.path, ["push", "--quiet", "-u", "origin", secret.workspace.branch]);
    const rebuildable = await t.session("Generated dependency folder");
    await mkdir(join(rebuildable.workspace.path, "node_modules", "generated"), { recursive: true });
    await writeFile(join(rebuildable.workspace.path, "node_modules", "generated", "index.js"), "module.exports = 1;\n");
    run(rebuildable.workspace.path, ["push", "--quiet", "-u", "origin", rebuildable.workspace.branch]);
    await t.sdk.command({ type: "session.archive", sessionId: secret.id });
    await t.sdk.command({ type: "session.archive", sessionId: rebuildable.id });
    await waitFor(() => Boolean(t.workspace(secret.workspace.id).cleanup) && t.workspace(rebuildable.workspace.id).status === "removed", 20_000);
    assert.equal(t.workspace(secret.workspace.id).status, "ready");
    assert.match(t.workspace(secret.workspace.id).cleanup!.reason, /ignored files that may not be rebuildable \(\.env\)/);
    assert.equal(await readFile(join(secret.workspace.path, ".env"), "utf8"), "GENERATED_PLACEHOLDER=1\n");
    assert.equal(t.workspace(rebuildable.workspace.id).cleanup?.outcome, "removed");
  } finally { await t.close(); }
});

test("restoring a session while its worktree is still being removed recreates it once the removal settles", darwin, async () => {
  const t = await fixture();
  try {
    const { id, workspace } = await t.session("Generated restore during park");
    run(workspace.path, ["push", "--quiet", "-u", "origin", workspace.branch]);
    await t.f.service.controller.dispatch(envelope({ type: "session.archive", sessionId: id }));
    const state = () => t.f.service.controller.snapshot().managedWorkspaces.find((value) => value.id === workspace.id)!;
    const deadline = Date.now() + ciTime(10_000);
    while (state().status !== "removing") {
      if (Date.now() > deadline) throw new Error("The generated park never started.");
      await new Promise((resolve) => setImmediate(resolve));
    }
    await t.f.service.controller.dispatch(envelope({ type: "session.restore", sessionId: id }));
    await waitFor(() => state().status === "ready" && !state().parked, 20_000);
    assert.equal(run(workspace.path, ["branch", "--show-current"]), workspace.branch);
  } finally { await t.close(); }
});
