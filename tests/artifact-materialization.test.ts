import test from "node:test";
import assert from "node:assert/strict";
import { lstat, readFile, readdir, realpath, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk, type LegacyVersionedArtifact } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { writeLegacyState } from "./fixtures/legacy-state.ts";
import { startService } from "../apps/service/src/server.ts";

test("artifact organization uses profile folders and same-project work items, retaining provenance and history", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const projectId = fixture.session().projectId, folder = await sdk.projects.folder("Generated retained work");
    const issue = await sdk.issues.create(projectId, { kind: "feature", title: "Generated artifact issue", body: "Generated issue body.", phaseId: "backlog", pullRequestUrl: null });
    const document = await sdk.artifacts.create(null, { projectId, kind: "report", name: "Generated organized report", text: "Generated retained text.", folderId: folder.id!, workItemId: issue.id! });
    const retained = (await sdk.artifacts.read(document.id!)).artifact;
    assert.equal(retained.folderId, folder.id); assert.equal(retained.workItemId, issue.id);
    await assert.rejects(() => sdk.artifacts.update(document.id!, { folderId: "generated-missing-folder" }, 0), /folder/);
    await assert.rejects(() => sdk.artifacts.create(null, { kind: "report", name: "Generated wrong scope", text: "", workItemId: issue.id! }), /work item|project/);
    await sdk.artifacts.update(document.id!, { folderId: null, workItemId: null }, 0);
    assert.equal((await sdk.artifacts.read(document.id!, 0)).artifact.folderId, folder.id);
    assert.equal((await sdk.artifacts.read(document.id!)).artifact.workItemId, null);
    const associated = await sdk.artifacts.create(null, { projectId, kind: "answer", name: "Generated issue answer", text: "Generated answer.", workItemId: issue.id! });
    const preview = (await sdk.artifacts.projectPreview(projectId)).preview;
    await sdk.projects.remove(projectId, true, 0, { action: "retain", expectedDigest: preview.digest });
    assert.equal((await sdk.artifacts.read(associated.id!)).artifact.workItemId, null);
    assert.equal((await sdk.artifacts.read(document.id!)).text, "Generated retained text.");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("reviewed repository materialization persists exact independent history and deletes grants only after verifying the real copy", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const projectId = fixture.session().projectId;
    const created = await sdk.artifacts.create(fixture.sessionId, { kind: "decision", name: "Generated materialized decision", text: "Generated first revision." });
    await sdk.artifacts.update(created.id!, { text: "Generated second revision." }, 0);
    const preview = (await sdk.artifacts.materializePreview(projectId)).preview;
    assert.equal(preview.commit, null); assert.ok(preview.path.startsWith("artifacts/")); assert.equal(preview.root, await realpath(fixture.project));
    const command = await sdk.artifacts.materialize(projectId, preview.digest);
    assert.equal((await sdk.jobs.wait(command.id!)).status, "completed");
    const result = (await sdk.artifacts.materialization(command.id!)).result!;
    const path = join(result.root, result.path), text = await readFile(path, "utf8");
    assert.equal(JSON.parse(text).documents[0].revisions.length, 2);
    assert.equal((await lstat(path)).mode & 0o777, 0o600);
    await writeFile(path, "Generated external modification.");
    const choice = { action: "materialize" as const, expectedDigest: preview.setDigest, materializationId: command.id! };
    await assert.rejects(() => sdk.projects.remove(projectId, true, 0, choice), /copy|materializ|changed/);
    assert.equal((await sdk.artifacts.read(created.id!)).text, "Generated second revision.");
    await writeFile(path, text);
    await sdk.projects.remove(projectId, true, 0, choice);
    await assert.rejects(() => sdk.artifacts.read(created.id!), /missing|deleted|outside/);
    assert.equal(await readFile(path, "utf8"), text);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("cancelling artifact publication after its real copy keeps source grants, quarantines the root and cannot become successful", async (t) => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const git = initializeGeneratedRepository(fixture.project);
    git(["config", "user.name", "Generated fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
    const projectId = fixture.session().projectId, artifact = await sdk.artifacts.create(fixture.sessionId, { kind: "plan", name: "Generated cancelled copy", text: "Generated preserved content." });
    await fixture.configure();
    const requestId = "generated-cancelled-materialization-request";
    let committing = false;
    t.mock.method(fixture.service.controller.platform.sessions.projects, "artifactCommit", async (...[_project, _path, _text, _expected, signal]: Parameters<typeof fixture.service.controller.platform.sessions.projects.artifactCommit>) => {
      committing = true;
      assert.ok(fixture.service.store.db.prepare("SELECT id FROM receipts WHERE id=?").get(requestId));
      assert.equal(fixture.service.controller.snapshot().jobs.find((job) => job.kind === "project.artifacts.materialize")?.materialization?.projectId, projectId);
      await new Promise<void>((_resolve, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
      throw new Error("Generated unreachable commit continuation");
    });
    const options = { commitBranch: "generated-cancelled-copy" }, preview = (await sdk.artifacts.materializePreview(projectId, options)).preview;
    const command = await fixture.service.controller.dispatch({ id: requestId, profileId: "default", command: { type: "project.artifacts.materialize", projectId, expectedDigest: preview.digest, confirm: true, ...options } });
    await waitFor(() => committing);
    await assert.rejects(() => sdk.artifacts.materialize(projectId, preview.digest, options), /busy|owned work/);
    await assert.rejects(() => sdk.terminal.open(fixture.sessionId), /owns this root|workspace/);
    await fixture.send("Generated queued writer while repository publication owns the root.");
    assert.equal(fixture.session().turnId, null); assert.equal(fixture.requests.length, 0);
    await sdk.jobs.cancel(command.id!);
    assert.equal((await sdk.jobs.wait(command.id!)).status, "partial");
    assert.equal((await sdk.artifacts.materialization(command.id!)).result, null);
    assert.equal(fixture.service.controller.snapshot().blockedProjects.includes(projectId), true);
    assert.equal((await sdk.artifacts.read(artifact.id!)).text, "Generated preserved content.");
    assert.ok((await readFile(join(preview.root, preview.path), "utf8")).includes("Generated preserved content."));
    await assert.rejects(() => sdk.projects.remove(projectId, true, 0, { action: "materialize", expectedDigest: preview.setDigest, materializationId: command.id! }), /not a completed copy/);
    assert.equal(git(["for-each-ref", "--format=%(refname)", "refs/heads/generated-cancelled-copy"]), "");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("an optional commit failure is partial even with a real persisted copy; another branch is never overwritten", async (t) => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const git = initializeGeneratedRepository(fixture.project);
    git(["config", "user.name", "Generated fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
    const projectId = fixture.session().projectId;
    await sdk.artifacts.create(fixture.sessionId, { kind: "report", name: "Generated racing publication", text: "Generated exact copy." });
    const original = fixture.service.controller.platform.sessions.projects.artifactCommit.bind(fixture.service.controller.platform.sessions.projects);
    t.mock.method(fixture.service.controller.platform.sessions.projects, "artifactCommit", async (...args: Parameters<typeof original>) => {
      git(["branch", args[3].branch]); return original(...args);
    });
    const options = { commitBranch: "generated-competing-branch" }, preview = (await sdk.artifacts.materializePreview(projectId, options)).preview;
    const command = await sdk.artifacts.materialize(projectId, preview.digest, options);
    const job = await sdk.jobs.wait(command.id!);
    assert.equal(job.status, "partial"); assert.match(job.error!, /already exists|partial/);
    assert.equal(git(["rev-parse", options.commitBranch]), git(["rev-parse", "HEAD"]));
    assert.ok((await readFile(join(preview.root, preview.path), "utf8")).includes("Generated exact copy."));
    assert.equal(fixture.service.controller.snapshot().artifacts.length, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("schema-11 artifact history and interrupted materialization recover without rewriting sources or replaying publication", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  let prepared: Awaited<ReturnType<typeof startService>> | undefined, restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const projectId = fixture.session().projectId, current = await sdk.artifacts.create(fixture.sessionId, { kind: "report", name: "Generated old report", text: "Generated historical content." });
    const { folderId: _folder, workItemId: _work, ...legacy } = (await sdk.artifacts.read(current.id!)).artifact;
    const old: LegacyVersionedArtifact = { ...legacy, revision: 1 };
    fixture.service.store.commit([{ event_type: "artifact.revised", profile_id: "default", project_id: projectId, payload: { artifact: old } }]);
    sdk.disconnect(); await fixture.service.close();
    prepared = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const response = await prepared.controller.platform.query({ type: "project.artifacts.materialize.preview", projectId });
    assert.ok(response.type === "project.artifacts.materialize.preview");
    const preview = response.preview;
    prepared.store.commit([{ event_type: "job.started", profile_id: "default", project_id: projectId, payload: { job: { id: "generated-interrupted-materialization", kind: "project.artifacts.materialize", projectId, workspaceId: null, sessionId: null, parentTurnId: null, status: "running", progress: "Generated crash before effects", resultDigest: null, error: null, materialization: preview } } }]);
    const identities = prepared.store.events().map(({ id, seq }) => ({ id, seq }));
    await writeLegacyState(prepared, 11);
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const peer = await new MoguriSdk(restarted.connection).ready();
    try {
      assert.equal(restarted.store.db.prepare("PRAGMA user_version").get()?.user_version, 14);
      assert.deepEqual(restarted.store.events().slice(0, identities.length).map(({ id, seq }) => ({ id, seq })), identities);
      assert.equal((await peer.artifacts.read(current.id!, 1)).artifact.folderId, null);
      assert.equal((await peer.artifacts.read(current.id!)).text, "Generated historical content.");
      const result = await peer.artifacts.materialization("generated-interrupted-materialization");
      assert.equal(result.job.status, "partial"); assert.equal(result.result, null); assert.equal(result.job.materialization?.path, preview.path);
      assert.equal((await readdir(fixture.project)).includes("artifacts"), false);
      assert.equal(restarted.controller.snapshot().blockedProjects.includes(projectId), true);
    } finally { peer.disconnect(); }
  } finally { sdk.disconnect(); await prepared?.close(); await restarted?.close(); await fixture.close(); }
});

test("optional artifact commits create only the reviewed new local branch, preserving HEAD, unrelated index and worktree edits", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const git = initializeGeneratedRepository(fixture.project);
    git(["config", "user.name", "Generated fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
    await writeFile(join(fixture.project, "generated-staged.txt"), "Generated staged edit.\n"); git(["add", "generated-staged.txt"]);
    await writeFile(join(fixture.project, "fixture.txt"), "Generated unstaged edit.\n");
    const head = git(["rev-parse", "HEAD"]), index = await readFile(join(fixture.project, ".git/index"));
    const projectId = fixture.session().projectId;
    await sdk.artifacts.create(fixture.sessionId, { kind: "plan", name: "Generated committed plan", text: "Generated exact committed content." });
    await assert.rejects(() => sdk.artifacts.materializePreview(projectId, { commitBranch: "main" }), /protected/);
    const options = { commitBranch: "generated-artifact-copy" }, preview = (await sdk.artifacts.materializePreview(projectId, options)).preview;
    const command = await sdk.artifacts.materialize(projectId, preview.digest, options);
    assert.equal((await sdk.jobs.wait(command.id!)).status, "completed");
    const result = (await sdk.artifacts.materialization(command.id!)).result!;
    assert.equal(result.commit?.branch, options.commitBranch);
    assert.equal(git(["rev-parse", "HEAD"]), head); assert.equal(git(["branch", "--show-current"]), "main");
    assert.deepEqual(await readFile(join(fixture.project, ".git/index")), index);
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "Generated unstaged edit.\n");
    assert.equal(git(["diff-tree", "--no-commit-id", "--name-only", "-r", result.commit!.commit]), result.path);
    assert.equal(git(["show", `${result.commit!.commit}:${result.path}`]), (await readFile(join(fixture.project, result.path), "utf8")).trim());
    assert.equal(git(["remote"]), "");
    assert.equal(git(["log", "-1", "--format=%B", result.commit!.commit]).includes("Co-authored-by"), false);
    git(["update-ref", "-d", `refs/heads/${options.commitBranch}`]);
    const choice = { action: "materialize" as const, expectedDigest: preview.setDigest, materializationId: command.id! };
    await assert.rejects(() => sdk.projects.remove(projectId, true, 0, choice), /Git|reference|revision|exited/);
    assert.equal(fixture.service.controller.snapshot().artifacts.length, 1);
    git(["update-ref", `refs/heads/${options.commitBranch}`, result.commit!.commit]);
    await sdk.projects.remove(projectId, true, 0, choice);
    assert.equal(fixture.service.controller.snapshot().artifacts.length, 0);
    assert.equal(git(["rev-parse", "HEAD"]), head);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("artifact materialization rejects stale reviews, symlink destinations and read-only policy before writing", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const projectId = fixture.session().projectId;
    const artifact = await sdk.artifacts.create(fixture.sessionId, { kind: "report", name: "Generated guarded report", text: "Generated guarded text." });
    const preview = (await sdk.artifacts.materializePreview(projectId)).preview;
    await sdk.artifacts.update(artifact.id!, { text: "Generated new version." }, 0);
    await assert.rejects(() => sdk.artifacts.materialize(projectId, preview.digest), /changed|review/);
    await symlink(fixture.directory, join(fixture.project, "artifacts"));
    await assert.rejects(() => sdk.artifacts.materializePreview(projectId), /symlink|canonical|directory/);
    await unlink(join(fixture.project, "artifacts"));
    const configuration = (await sdk.projects.configuration(projectId)).configuration;
    await sdk.projects.configure(projectId, { ...configuration.values, readOnlyFolders: ["artifacts"] }, configuration.revision);
    await assert.rejects(() => sdk.artifacts.materializePreview(projectId), /denied|read-only/);
    assert.equal((await readdir(fixture.project)).includes("artifacts"), false);
    assert.equal(fixture.service.controller.snapshot().jobs.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("repository copies use an explicit managed root and fail closed after its identity changes", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    initializeGeneratedRepository(fixture.project);
    const projectId = fixture.session().projectId;
    await sdk.artifacts.create(fixture.sessionId, { kind: "report", name: "Generated worktree report", text: "Generated branch-local copy." });
    const created = await sdk.workspaces.create(projectId, "generated/artifact-root"), workspace = await sdk.workspaces.wait(created.id!);
    const options = { workspaceId: workspace.id }, preview = (await sdk.artifacts.materializePreview(projectId, options)).preview;
    assert.equal(preview.root, workspace.path); assert.equal(preview.workspaceId, workspace.id);
    const command = await sdk.artifacts.materialize(projectId, preview.digest, options);
    assert.equal((await sdk.jobs.wait(command.id!)).status, "completed");
    assert.equal((await readdir(fixture.project)).includes("artifacts"), false);
    assert.ok((await readFile(join(workspace.path, preview.path), "utf8")).includes("Generated branch-local copy."));
    const git = (await import("node:child_process")).execFileSync;
    git("git", ["--no-pager", "-c", "core.hooksPath=/dev/null", "checkout", "--detach"], { cwd: workspace.path, stdio: "pipe" });
    await assert.rejects(() => sdk.artifacts.materializePreview(projectId, options), /registration|branch|identity|changed/);
  } finally { sdk.disconnect(); await fixture.close(); }
});
