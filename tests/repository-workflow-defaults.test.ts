import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord, MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { envelope } from "../apps/service/src/controller.ts";

test("a new Local Git project task owns an isolated default worktree and draft-PR guidance without touching the original checkout", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture(), git = initializeGeneratedRepository(f.project), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const index = git(["write-tree"]), branch = git(["branch", "--show-current"]);
    await writeFile(join(f.project, "generated-user-edit.txt"), "Generated unrelated user bytes.\n");
    const created = await sdk.sessions.create(f.session().projectId, "Generated isolated default", { modelId: f.modelId });
    const current = () => sdk.sessions.get(created.id!)!;
    assert.ok(current().workspaceId);
    assert.equal(current().workspaceOrigin, "default-worktree");
    const workspace = await sdk.workspaces.wait(current().workspaceId!);
    assert.equal(workspace.status, "ready"); assert.notEqual(workspace.path, f.project);
    const saved = await sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "generated write", attachments: [] });
    await sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: saved.revision!, delivery: "queue" });
    await waitFor(() => current().status === "completed");
    assert.equal(await readFile(join(workspace.path, "fixture.txt"), "utf8"), "generated replacement\n");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(await readFile(join(f.project, "generated-user-edit.txt"), "utf8"), "Generated unrelated user bytes.\n");
    assert.equal(git(["write-tree"]), index); assert.equal(git(["branch", "--show-current"]), branch);
    const request = f.requests.find((request) => Array.isArray(request.messages))!;
    if (!Array.isArray(request.messages)) throw new Error("The generated model request has no message array.");
    const system = request.messages.filter(isRecord).find((message) => message.role === "system");
    assert.match(String(system?.content), /draft pull request/i);
    assert.match(String(system?.content), /explicit.*(?:opt|request)|unless.*user/i);
    assert.equal(sdk.approvals.list().length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("an explicit original-checkout choice and existing conversations are retained instead of being silently moved", { skip: process.platform !== "darwin" }, async () => {
  const f = await setupFixture(), git = initializeGeneratedRepository(f.project), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const created = await sdk.command({ type: "session.create", projectId: f.session().projectId, title: "Generated explicit checkout", workspaceMode: "checkout" });
    assert.equal(sdk.sessions.get(created.id!)?.workspaceId, null);
    assert.equal(sdk.sessions.get(created.id!)?.workspaceOrigin, "explicit-checkout");
    assert.equal(sdk.sessions.get(f.sessionId)?.workspaceId, null);
    assert.equal(sdk.getState().snapshot?.managedWorkspaces.length, 0);
    assert.equal(git(["branch", "--show-current"]), "main");
  } finally { sdk.disconnect(); await f.close(); }
});

test("a non-Git folder remains attached without inventing a managed-worktree origin or PR", async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const created = await sdk.sessions.create(f.session().projectId, "Generated plain folder");
    assert.equal(sdk.sessions.get(created.id!)?.workspaceId, null);
    assert.equal(sdk.sessions.get(created.id!)?.workspaceOrigin, undefined);
    assert.equal(sdk.getState().snapshot?.managedWorkspaces.length, 0);
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("failed atomic default-session persistence cannot create a branch, worktree job or original-checkout fallback", async () => {
  const f = await setupFixture(), git = initializeGeneratedRepository(f.project), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const original = git(["worktree", "list", "--porcelain"]), sessions = sdk.getState().snapshot!.sessions.length;
    f.service.store.db.exec("CREATE TRIGGER generated_default_root_failure BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.event_type')='session.created' BEGIN SELECT RAISE(ABORT,'Generated default-root persistence failure'); END");
    await assert.rejects(() => sdk.sessions.create(f.session().projectId, "Generated failed default root"), /operation failed.*no success/i);
    assert.equal(git(["worktree", "list", "--porcelain"]), original);
    assert.equal(sdk.getState().snapshot!.sessions.length, sessions);
    assert.equal(sdk.getState().snapshot!.managedWorkspaces.length, 0);
    assert.equal(sdk.getState().snapshot!.jobs.some((job) => job.kind === "workspace.create"), false);
    assert.equal(f.requests.length, 0);
    f.service.store.db.exec("DROP TRIGGER generated_default_root_failure");
  } finally { sdk.disconnect(); await f.close(); }
});

test("unqualified multi-repository defaults never silently acquire original Git checkouts", async () => {
  const f = await setupFixture(), git = initializeGeneratedRepository(f.project), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const projectId = f.session().projectId, configuration = (await sdk.projects.configuration(projectId)).configuration;
    const secondPath = join(f.directory, "generated-second-folder"); await mkdir(secondPath);
    const second = await sdk.command({ type: "project.add", path: secondPath });
    const secondConfiguration = (await sdk.projects.configuration(second.id!)).configuration;
    const folder = await sdk.projects.group("Generated exact Git group", [{ projectId, revision: configuration.revision },
      { projectId: second.id!, revision: secondConfiguration.revision }]);
    await assert.rejects(() => sdk.sessions.createFolder(folder.id!), /one explicit Local project|original.*silently/i);
    assert.equal(sdk.getState().snapshot!.sessions.length, 1);
    const { configuration: current } = await sdk.projects.configuration(projectId);
    await sdk.projects.configure(projectId, { ...current.values, repo: { ...current.values.repo, workspaceMode: "checkout" } }, current.revision);
    const chosen = await sdk.sessions.createFolder(folder.id!);
    assert.equal(sdk.sessions.get(chosen.id!)?.repositories?.[0]?.root.root, await realpath(f.project));
    assert.equal(git(["branch", "--show-current"]), "main"); assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("a prompt really queued during default-root preparation waits for the actual ready worktree without borrowing the original checkout", { skip: process.platform !== "darwin", timeout: 10_000 }, async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  initializeGeneratedRepository(f.project);
  const queued = Promise.withResolvers<string>();
  let captured = false, preparingAtQueue = false;
  const listener = () => {
    const snapshot = f.service.controller.snapshot(), session = snapshot.sessions.find((session) => session.workspaceOrigin === "default-worktree");
    if (!session || captured) return;
    captured = true;
    void (async () => {
      await f.service.controller.dispatch(envelope({ type: "draft.save", sessionId: session.id, expectedRevision: 0, text: "generated write", attachments: [] }));
      await f.service.controller.dispatch(envelope({ type: "message.send", sessionId: session.id, expectedRevision: 1, delivery: "queue" }));
      const current = f.service.controller.snapshot();
      preparingAtQueue = current.managedWorkspaces.find((workspace) => workspace.id === session.workspaceId)?.status === "creating";
      assert.equal(current.sessions.find((value) => value.id === session.id)?.queue.length, 1);
      assert.equal(f.requests.length, 0);
      queued.resolve(session.id);
    })().catch(queued.reject);
  };
  f.service.controller.on("change", listener);
  try {
    await sdk.sessions.create(f.session().projectId, "Generated queued preparation", { modelId: f.modelId });
    const id = await queued.promise;
    assert.equal(preparingAtQueue, true);
    const workspace = await sdk.workspaces.wait(sdk.sessions.get(id)!.workspaceId!);
    await waitFor(() => sdk.sessions.get(id)?.status === "completed");
    assert.equal(await readFile(join(workspace.path, "fixture.txt"), "utf8"), "generated replacement\n");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
  } finally { f.service.controller.off("change", listener); sdk.disconnect(); await f.close(); }
});
