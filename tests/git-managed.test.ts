import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { githubServiceFixture } from "./github-workflows-fixture.ts";
import { fixtureProvider, waitFor } from "./fixture.ts";
import { startService } from "../apps/service/src/server.ts";

async function fixture() {
  const provider = await fixtureProvider(), key = Buffer.alloc(32, 0x6a);
  const f = await githubServiceFixture({}, provider.provider, key);
  try {
    const created = await f.sdk.command({ type: "workspace.create", projectId: f.projectId, branch: "generated/managed-original", baseRef: "main" });
    const workspace = await waitFor(() => {
      const snapshot = f.service.controller.snapshot(), workspace = snapshot.managedWorkspaces.find((workspace) => workspace.id === created.id);
      return workspace?.status === "ready" && snapshot.jobs.find((job) => job.id === workspace.jobId)?.status === "completed" && workspace;
    });
    const sessionId = (await f.sdk.sessions.create(f.projectId, "Generated managed Git", undefined, workspace.id)).id!;
    const git = (args: string[]) => f.git(["-C", workspace.path, ...args]);
    return { ...f, provider, key, workspace, managedSessionId: sessionId, managedGit: git,
      close: async () => { await f.close(); await provider.close(); } };
  } catch (error) { await f.close(); await provider.close(); throw error; }
}

test("a verified managed branch rename atomically preserves its root/base/change set and remains usable after restart", async () => {
  const f = await fixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined;
  try {
    const indexPath = f.managedGit(["rev-parse", "--path-format=absolute", "--git-path", "index"]), index = await readFile(indexPath);
    const review = (await f.sdk.git.preview(f.managedSessionId, { kind: "git.branch.rename", from: f.workspace.branch, to: "generated/managed-renamed" })).preview;
    assert.equal(review.document.managedBranch?.revision, f.workspace.revision);
    assert.deepEqual(await readFile(indexPath), index, "managed preview must not refresh the original index");
    const admitted = await f.sdk.git.execute(review, review.document.confirmations, true), result = await f.sdk.git.wait(admitted.id!);
    assert.equal(result.operation.status, "completed", result.operation.diagnostic ?? "");
    const snapshot = f.service.controller.snapshot(), workspace = snapshot.managedWorkspaces.find((workspace) => workspace.id === f.workspace.id)!;
    assert.equal(workspace.branch, "generated/managed-renamed"); assert.equal(workspace.baseCommit, f.workspace.baseCommit);
    assert.equal(workspace.path, f.workspace.path); assert.deepEqual(workspace.identity, f.workspace.identity);
    assert.equal(snapshot.changeSets.find((changeSet) => changeSet.id === workspace.changeSetId)?.branch, workspace.branch);
    assert.deepEqual(await readFile(indexPath), index); assert.equal(f.git(["branch", "--show-current"]), "main");
    assert.equal((await f.sdk.workspaces.inspect(workspace.id)).inspection.diagnostic, null);
    assert.equal((await f.sdk.workspaces.git(f.managedSessionId)).branch, workspace.branch);
    f.sdk.disconnect(); await f.service.close();
    restarted = await startService({ stateDir: f.stateDir, provider: f.provider.provider, retentionKey: f.key });
    sdk = await new MoguriSdk(restarted.connection).ready();
    assert.equal((await sdk.workspaces.inspect(workspace.id)).inspection.diagnostic, null);
    assert.equal((await sdk.git.status(f.managedSessionId)).git.branch, workspace.branch);
    assert.equal(restarted.controller.snapshot().githubOperations.length, 1); assert.equal(f.provider.requests.length, 0);
  } finally { sdk?.disconnect(); await restarted?.close(); await f.close(); }
});

test("lost managed-rename metadata stays partial until exact user inspection and metadata-only reconciliation without another Git rename", async (t) => {
  const f = await fixture(), commit = f.service.store.commit.bind(f.service.store);
  let failed = false;
  const mock = t.mock.method(f.service.store, "commit", (...args: Parameters<typeof commit>) => {
    if (!failed && args[0].some((event) => event.event_type === "workspace.saved" && event.payload.branchOperation)) {
      failed = true; throw new Error("Generated managed branch metadata acknowledgement failure.");
    }
    return commit(...args);
  });
  try {
    const review = (await f.sdk.git.preview(f.managedSessionId, { kind: "git.branch.rename", from: f.workspace.branch, to: "generated/managed-partial" })).preview;
    const admitted = await f.sdk.git.execute(review, review.document.confirmations, true), result = await f.sdk.git.wait(admitted.id!);
    mock.mock.restore();
    assert.equal(failed, true); assert.equal(result.operation.status, "partial");
    assert.equal(f.managedGit(["branch", "--show-current"]), "generated/managed-partial");
    assert.equal(f.service.controller.snapshot().managedWorkspaces.find((workspace) => workspace.id === f.workspace.id)?.branch, f.workspace.branch);
    await assert.rejects(() => f.sdk.workspaces.reconcile(f.workspace.id, f.workspace.revision), { code: "workspace_busy" });
    await f.sdk.github.acknowledge(result.operation.id, result.operation.revision, result.operation.inputDigest, true);
    await f.sdk.workspaces.reconcile(f.workspace.id, f.workspace.revision);
    assert.equal((await f.sdk.workspaces.inspect(f.workspace.id)).inspection.diagnostic, null);
    assert.equal((await f.sdk.git.operation(result.operation.id)).operation.status, "partial");
    assert.equal(f.service.controller.snapshot().githubOperations.length, 1); assert.equal(f.provider.requests.length, 0);
    const revision = f.service.controller.snapshot().managedWorkspaces.find((workspace) => workspace.id === f.workspace.id)!.revision;
    f.managedGit(["branch", "--move", "--", "generated/managed-partial", f.workspace.branch]);
    await assert.rejects(() => f.sdk.workspaces.reconcile(f.workspace.id, revision), { code: "workspace_unconfirmed" });
  } finally { mock.mock.restore(); await f.close(); }
});

test("managed checkout changes fail before effects rather than moving an existing captured change set or using the base checkout", async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => f.sdk.git.preview(f.managedSessionId, { kind: "git.switch", branch: "main" }), { code: "git_workspace_switch" });
    await assert.rejects(() => f.sdk.git.preview(f.managedSessionId, { kind: "git.branch.create", branch: "generated/no-managed-switch", start: "main", checkout: true }), { code: "git_workspace_switch" });
    assert.equal(f.managedGit(["branch", "--show-current"]), f.workspace.branch);
    assert.equal(f.git(["branch", "--show-current"]), "main");
    assert.equal(f.service.controller.snapshot().githubOperations.length, 0);
    assert.equal((await f.sdk.workspaces.inspect(f.workspace.id)).inspection.diagnostic, null);
  } finally { await f.close(); }
});

test("a managed metadata revision change invalidates a saved rename review before Git dispatch", async () => {
  const f = await fixture();
  try {
    const review = (await f.sdk.git.preview(f.managedSessionId, { kind: "git.branch.rename", from: f.workspace.branch, to: "generated/managed-stale" })).preview;
    await f.sdk.workspaces.reconcile(f.workspace.id, f.workspace.revision);
    await assert.rejects(() => f.sdk.git.execute(review, review.document.confirmations, true), { code: "github_review" });
    assert.equal(f.managedGit(["branch", "--show-current"]), f.workspace.branch);
    assert.equal(f.service.controller.snapshot().githubOperations.length, 0);
  } finally { await f.close(); }
});
