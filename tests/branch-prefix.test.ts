import assert from "node:assert/strict";
import test from "node:test";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { generatedBranchName } from "../packages/protocol/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";

test("generated branch names add the optional prefix once", () => {
  assert.equal(generatedBranchName("moguri/{slug}-{id}", "fix-login", "1a2b3c4d"), "moguri/fix-login-1a2b3c4d");
  assert.equal(generatedBranchName("moguri/{slug}-{id}", "fix-login", "1a2b3c4d", "mb/"), "mb/moguri/fix-login-1a2b3c4d");
  assert.equal(generatedBranchName("mb/{slug}", "fix", "x", "mb/"), "mb/fix");
});

test("the profile branch prefix names new default worktree branches and rejects unsafe refs", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture(), git = initializeGeneratedRepository(f.project), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const values = sdk.settings.get()!.values;
    for (const branchPrefix of ["/mb", "mb//x", "a..b/", "mb.lock/", "with space/"]) {
      await assert.rejects(sdk.settings.update({ ...values, git: { branchPrefix } }, sdk.settings.get()!.revision), Error, branchPrefix);
    }
    await sdk.settings.update({ ...values, git: { branchPrefix: "generated-owner/" } }, sdk.settings.get()!.revision);
    const created = await sdk.sessions.create(f.session().projectId, "Generated prefixed task");
    const workspace = await sdk.workspaces.wait(sdk.sessions.get(created.id!)!.workspaceId!);
    assert.match(workspace.branch, /^generated-owner\/moguri\/generated-prefixed-task-[a-f0-9]{8}$/);
    assert.ok(git(["branch", "--list", workspace.branch]).includes(workspace.branch));
    assert.equal(git(["branch", "--show-current"]), "main");
    await sdk.settings.reset("git", sdk.settings.get()!.revision);
    assert.equal(sdk.settings.get()!.values.git, undefined);
  } finally { sdk.disconnect(); await f.close(); }
});
