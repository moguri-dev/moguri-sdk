import { ciTime } from "./fixtures/time-scale.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { access, chmod, mkdir, readFile, writeFile, rename, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture, waitFor } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { startService } from "../apps/service/src/server.ts";
import { randomUUID } from "node:crypto";

const native = { skip: process.platform !== "darwin", timeout: ciTime(30_000) };
async function gitFixture() {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const git = initializeGeneratedRepository(fixture.project);
  const create = async (branch: string) => { const result = await sdk.workspaces.create(fixture.session().projectId, branch); return sdk.workspaces.wait(result.id!); };
  return { ...fixture, sdk, git, create, close: async () => { sdk.disconnect(); await fixture.close(); } };
}

test("the same SDK binds worker/files/diff/plan/attachments to an isolated worktree without changing the base checkout", native, async () => {
  const fixture = await gitFixture();
  try {
    const originalIndex = fixture.git(["write-tree"]);
    await writeFile(join(fixture.project, "unrelated.txt"), "Generated user edit remains in the base checkout.");
    const workspace = await fixture.create("moguri/generated-slice");
    assert.equal(workspace.status, "ready");
    const discovered = (await fixture.sdk.workspaces.discover(fixture.session().projectId)).registrations;
    assert.ok(discovered.some((entry) => entry.managedId === workspace.id && entry.path === workspace.path && entry.locked));
    assert.ok(discovered.some((entry) => entry.branch === "main" && entry.managedId === null));
    const created = await fixture.sdk.sessions.create(fixture.session().projectId, "Generated isolated work", { modelId: fixture.modelId }, workspace.id);
    const session = () => fixture.sdk.getState().snapshot!.sessions.find((value) => value.id === created.id)!;
    await fixture.sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "generated write", attachments: [] });
    await fixture.sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => session().status === "completed");
    assert.equal(session().pendingApproval, null);
    assert.equal(await readFile(join(workspace.path, "fixture.txt"), "utf8"), "generated replacement\n");
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(fixture.git(["write-tree"]), originalIndex); assert.equal(fixture.git(["branch", "--show-current"]), "main");
    assert.match((await fixture.sdk.workspaces.git(session().id)).diff, /generated replacement/);
    assert.equal((await fixture.sdk.workspaces.file(session().id, "fixture.txt")).text, "generated replacement\n");
    assert.ok((await fixture.sdk.workspaces.files(session().id)).entries.includes("fixture.txt"));
    const plan = await fixture.sdk.plans.save(session().id, "Generated isolated retained plan.", "absent");
    assert.equal((await fixture.sdk.plans.read(session().id)).text, "Generated isolated retained plan.");
    await assert.rejects(() => readFile(join(fixture.project, "docs/plan.md")), /ENOENT/);
    await fixture.sdk.attachments.file(session().id, join(workspace.path, "fixture.txt"));
    assert.equal(session().draft.attachments.at(-1)?.kind, "local_file");
    await assert.rejects(() => fixture.sdk.workspaces.bind(session().id, null), /fresh idle session/);
    const meta = await fixture.sdk.metachat.create(fixture.session().projectId, session().id);
    const proposal = await fixture.sdk.configuration.propose(meta.id!, { target: "repo-instructions", section: "AGENTS.md", value: "Generated instructions for this isolated worktree.", reason: "Generated exact root review." });
    const review = await fixture.sdk.configuration.review(proposal.id!);
    assert.equal(review.proposal.workspaceId, workspace.id);
    await fixture.sdk.sessions.delete(meta.id!, true);
    await fixture.sdk.configuration.decide(proposal.id!, true, review.proposal.contentDigest, true);
    assert.equal(await readFile(join(workspace.path, "AGENTS.md"), "utf8"), "Generated instructions for this isolated worktree.");
    await assert.rejects(() => readFile(join(fixture.project, "AGENTS.md")), /ENOENT/);
    await fixture.sdk.sessions.delete(session().id, true);
    assert.equal((await fixture.sdk.plans.artifact(plan.id!)).text, "Generated isolated retained plan.");
    assert.equal((await fixture.sdk.workspaces.inspect(workspace.id)).inspection.workspace.status, "ready");
    assert.equal(await readFile(join(fixture.project, "unrelated.txt"), "utf8"), "Generated user edit remains in the base checkout.");
  } finally { await fixture.close(); }
});

test("worktree creation suppresses checkout hooks and arbitrary filters; removal refuses dirty or retained bindings and preserves branches", async () => {
  const fixture = await gitFixture();
  try {
    const hookMarker = join(fixture.directory, "generated-hook-marker"), filterMarker = join(fixture.directory, "generated-filter-marker");
    await writeFile(join(fixture.project, ".gitattributes"), "fixture.txt filter=generated\n");
    fixture.git(["add", "--", ".gitattributes"]);
    fixture.git(["-c", "user.name=Generated fixture", "-c", "user.email=fixture@example.invalid", "commit", "--no-gpg-sign", "-m", "Generated checkout attribute"]);
    const hook = join(fixture.project, ".git/hooks/post-checkout");
    await writeFile(hook, `#!/bin/sh\nprintf generated > '${hookMarker}'\n`); await chmod(hook, 0o700);
    fixture.git(["config", "filter.generated.smudge", `sh -c "printf generated > '${filterMarker}'; cat"`]);
    fixture.git(["config", "filter.generated.required", "true"]);
    const workspace = await fixture.create("moguri/generated-clean");
    assert.equal(workspace.status, "ready");
    await assert.rejects(() => access(hookMarker), /ENOENT/); await assert.rejects(() => access(filterMarker), /ENOENT/);
    fixture.git(["config", "filter.generated.clean", `sh -c "printf generated > '${filterMarker}'; cat"`]);
    const viewer = await fixture.sdk.sessions.create(fixture.session().projectId, "Generated safe viewer", undefined, workspace.id);
    await writeFile(join(workspace.path, "fixture.txt"), "Generated changed view.");
    assert.match((await fixture.sdk.workspaces.git(viewer.id!)).diff, /Generated changed view/);
    await assert.rejects(() => access(filterMarker), /ENOENT/);
    await fixture.sdk.sessions.delete(viewer.id!, true);
    await writeFile(join(workspace.path, "fixture.txt"), "Generated uncommitted work.");
    await assert.rejects(() => fixture.sdk.workspaces.remove(workspace.id, workspace.revision, true), /clean|dirty|untracked/i);
    await writeFile(join(workspace.path, "fixture.txt"), "generated original\n");
    const created = await fixture.sdk.sessions.create(fixture.session().projectId, undefined, undefined, workspace.id);
    await assert.rejects(() => fixture.sdk.workspaces.remove(workspace.id, workspace.revision, true), /still has sessions/);
    await fixture.sdk.sessions.delete(created.id!, true);
    await fixture.sdk.workspaces.remove(workspace.id, workspace.revision, true);
    const removed = await fixture.sdk.workspaces.wait(workspace.id);
    assert.equal(removed.status, "removed");
    assert.equal(fixture.git(["rev-parse", `refs/heads/${workspace.branch}`]), workspace.baseCommit);
    await assert.rejects(() => fixture.sdk.sessions.create(fixture.session().projectId, undefined, undefined, workspace.id), /removed|unready|missing/);
  } finally { await fixture.close(); }
});

test("repository memory indexes and writer leases follow the actual worktree rather than the logical project's base", native, async () => {
  const fixture = await gitFixture();
  try {
    const one = await fixture.create("moguri/generated-one"), two = await fixture.create("moguri/generated-two");
    await writeFile(join(one.path, "knowledge.ts"), "export const OneWorkspaceOnlyKnowledge = 'generated first';\n");
    await writeFile(join(two.path, "knowledge.ts"), "export const TwoWorkspaceOnlyKnowledge = 'generated second';\n");
    const settings = structuredClone(fixture.sdk.settings.get()!.values); settings.memory.enabled = true;
    await fixture.sdk.settings.update(settings, fixture.sdk.settings.get()!.revision);
    for (const workspace of [one, two]) {
      const job = await fixture.sdk.memory.index(fixture.session().projectId, workspace.id); assert.equal((await fixture.sdk.jobs.wait(job.id!)).status, "completed");
    }
    const hits = (await fixture.sdk.memory.search(fixture.session().projectId, "OneWorkspaceOnlyKnowledge", 6, one.id)).items;
    assert.ok(hits.some((hit) => hit.text.includes("OneWorkspaceOnlyKnowledge"))); assert.ok(!hits.some((hit) => hit.text.includes("TwoWorkspaceOnlyKnowledge")));
    const a = await fixture.sdk.sessions.create(fixture.session().projectId, "Generated branch one", { modelId: fixture.modelId }, one.id);
    const b = await fixture.sdk.sessions.create(fixture.session().projectId, "Generated branch two", { modelId: fixture.modelId }, two.id);
    for (const created of [a, b]) {
      await fixture.sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "generated slow isolated roots", attachments: [] });
      await fixture.sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    }
    await waitFor(() => fixture.requests.length === 2);
    for (const created of [a, b]) await fixture.sdk.command({ type: "session.stop", sessionId: created.id! });
    await waitFor(() => [a, b].every((created) => !fixture.sdk.getState().snapshot!.sessions.find((value) => value.id === created.id)?.turnId));
    assert.equal(fixture.requests.length, 2);
  } finally { await fixture.close(); }
});
test("managed dependency installation targets the selected checkout while sharing immutable package plans", native, async () => {
  const fixture = await gitFixture();
  try {
    const workspace = await fixture.create("moguri/generated-dependencies"), projectId = fixture.session().projectId;
    const manifest = { name: "generated-worktree-cache", version: "1.0.0" };
    await writeFile(join(workspace.path, "package.json"), JSON.stringify(manifest));
    await writeFile(join(workspace.path, "package-lock.json"), JSON.stringify({ ...manifest, lockfileVersion: 3, packages: { "": manifest } }));
    const plan = (await fixture.sdk.cache.inspect(projectId, "npm", workspace.id)).plan;
    assert.equal(plan.workspaceId, workspace.id);
    const job = await fixture.sdk.cache.install(projectId, "npm", plan.digest, true, false, workspace.id);
    assert.equal((await fixture.sdk.jobs.wait(job.id!)).status, "completed");
    await access(join(workspace.path, "node_modules"));
    await assert.rejects(() => access(join(fixture.project, "node_modules")), /ENOENT/);
    assert.ok(fixture.sdk.getState().snapshot!.dependencyCaches.some((receipt) => receipt.projectId === projectId && receipt.workspaceId === workspace.id));
  } finally { await fixture.close(); }
});
test("changed branches fail before inference and quarantine only their bound worktree", native, async () => {
  const fixture = await gitFixture();
  try {
    const workspace = await fixture.create("moguri/generated-binding");
    const created = await fixture.sdk.sessions.create(fixture.session().projectId, "Generated changed branch", { modelId: fixture.modelId }, workspace.id);
    fixture.git(["-C", workspace.path, "switch", "-c", "moguri/generated-external-change"]);
    await fixture.sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "Generated branch must be checked first.", attachments: [] });
    await fixture.sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => fixture.sdk.getState().snapshot!.sessions.find((session) => session.id === created.id)?.status === "failed");
    assert.equal(fixture.requests.length, 0);
    assert.ok(fixture.sdk.getState().snapshot!.blockedWorkspaces.includes(workspace.id));
    assert.equal(fixture.sdk.getState().snapshot!.blockedProjects.includes(fixture.session().projectId), false);
    await fixture.configure(); await fixture.send("Generated unaffected base-root answer.");
    assert.equal((await fixture.terminal()).status, "completed"); assert.equal(fixture.requests.length, 1);
  } finally { await fixture.close(); }
});
test("a rename made inside the worktree is adopted from Git's reflog before inference, keeping the change set", native, async () => {
  const fixture = await gitFixture();
  try {
    const workspace = await fixture.create("moguri/generated-placeholder-1234");
    const created = await fixture.sdk.sessions.create(fixture.session().projectId, "Generated renamed branch", { modelId: fixture.modelId }, workspace.id);
    fixture.git(["-C", workspace.path, "branch", "-m", "moguri/generated-step-1234"]);
    fixture.git(["-C", workspace.path, "branch", "-m", "moguri/generated-topic-1234"]);
    fixture.git(["-C", workspace.path, "-c", "user.name=Generated fixture", "-c", "user.email=fixture@example.invalid", "commit", "--no-gpg-sign", "--allow-empty", "-m", "Generated agent commit"]);
    await fixture.sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "Generated work after a branch rename.", attachments: [] });
    await fixture.sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    await waitFor(() => ["completed", "failed"].includes(fixture.sdk.getState().snapshot!.sessions.find((session) => session.id === created.id)?.status ?? ""));
    const state = fixture.service.controller.snapshot(), adopted = state.managedWorkspaces.find((value) => value.id === workspace.id)!;
    assert.equal(state.sessions.find((session) => session.id === created.id)!.status, "completed"); assert.equal(fixture.requests.length, 1);
    assert.equal(adopted.branch, "moguri/generated-topic-1234"); assert.equal(adopted.revision, workspace.revision + 1);
    assert.equal(adopted.baseCommit, workspace.baseCommit); assert.match(adopted.diagnostic!, /Adopted the Git rename of moguri\/generated-placeholder-1234/);
    assert.equal(state.changeSets.find((changeSet) => changeSet.id === workspace.changeSetId)!.branch, "moguri/generated-topic-1234");
    assert.equal(state.blockedWorkspaces.includes(workspace.id), false);
    fixture.git(["-C", workspace.path, "switch", "-c", "moguri/generated-switch"]);
    await assert.rejects(() => fixture.sdk.workspaces.reconcile(workspace.id, adopted.revision), /branch or directory identity changed/);
  } finally { await fixture.close(); }
});
test("replaced owned directories never become symlink grants or silently fall back to the base project", async () => {
  const fixture = await gitFixture();
  try {
    const workspace = await fixture.create("moguri/generated-identity"), created = await fixture.sdk.sessions.create(fixture.session().projectId, undefined, undefined, workspace.id);
    await rename(workspace.path, `${workspace.path}-moved`); await symlink(fixture.project, workspace.path);
    await assert.rejects(() => fixture.sdk.workspaces.file(created.id!, "fixture.txt"), /identity changed/);
    const inspection = (await fixture.sdk.workspaces.inspect(workspace.id)).inspection;
    assert.equal(inspection.exists, true); assert.equal(inspection.canonical, false);
    await assert.rejects(() => fixture.sdk.workspaces.reconcile(workspace.id, workspace.revision), /symlink|non-directory/);
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated original\n");
  } finally { await fixture.close(); }
});
test("restart reconciles interrupted worktree intent without replaying creation/removal or losing its independent ownership", async () => {
  const fixture = await gitFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const workspace = await fixture.create("moguri/generated-recovery"), jobId = randomUUID();
    fixture.service.store.commit([
      { event_type: "workspace.saved", profile_id: "default", project_id: workspace.projectId, payload: { workspace: { ...workspace, status: "removing", jobId, revision: workspace.revision + 1 } } },
      { event_type: "job.started", profile_id: "default", project_id: workspace.projectId, payload: { job: { id: jobId, kind: "workspace.remove", projectId: workspace.projectId, sessionId: null, parentTurnId: null, status: "running", progress: "Generated interrupted intent", resultDigest: null, error: null } } },
    ]);
    const ids = fixture.service.store.events().map((event) => event.id);
    fixture.sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: join(fixture.directory, "state"), provider: fixture.provider, retentionKey: fixture.retentionKey });
    const recovered = restarted.controller.snapshot().managedWorkspaces.find((value) => value.id === workspace.id)!;
    assert.equal(recovered.status, "partial"); assert.equal(restarted.controller.snapshot().jobs.find((job) => job.id === jobId)?.status, "partial");
    assert.deepEqual(restarted.controller.events(0).slice(0, ids.length).map((event) => event.id), ids);
    assert.equal(await readFile(join(workspace.path, "fixture.txt"), "utf8"), "generated original\n");
    const client = await new MoguriSdk(restarted.connection).ready();
    try {
      await client.workspaces.reconcile(workspace.id, recovered.revision);
      assert.equal(client.getState().snapshot!.managedWorkspaces[0]?.status, "ready");
      assert.equal(fixture.git(["rev-parse", `refs/heads/${workspace.branch}`]), workspace.baseCommit);
      assert.equal(fixture.requests.length, 0);
    } finally { client.disconnect(); }
  } finally { await restarted?.close(); await fixture.close(); }
});
test("a state folder configured in another letter case still owns its worktrees on a case-insensitive disk", native, async (t) => {
  const fixture = await gitFixture();
  let restarted: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    const workspace = await fixture.create("moguri/generated-case"), spelled = join(fixture.directory, "STATE");
    if (!existsSync(spelled)) { t.skip("This volume is case-sensitive."); return; }
    fixture.sdk.disconnect(); await fixture.service.close();
    restarted = await startService({ stateDir: spelled, provider: fixture.provider, retentionKey: fixture.retentionKey });
    const client = await new MoguriSdk(restarted.connection).ready();
    try {
      const { inspection } = await client.workspaces.inspect(workspace.id);
      assert.equal(inspection.workspace.path, workspace.path); assert.equal(inspection.canonical, true); assert.equal(inspection.diagnostic, null);
      const session = await client.sessions.create(workspace.projectId, "Generated case-insensitive session", { modelId: fixture.modelId }, workspace.id);
      assert.equal((await client.workspaces.file(session.id!, "fixture.txt")).text, "generated original\n");
    } finally { client.disconnect(); }
  } finally { await restarted?.close(); await fixture.close(); }
});
test("concurrent removal claims one clean root even when its Git pruning lock was explicitly released", async () => {
  const fixture = await gitFixture();
  try {
    const workspace = await fixture.create("moguri/generated-remove-race");
    fixture.git(["worktree", "unlock", workspace.path]);
    const outcomes = await Promise.allSettled([
      fixture.sdk.workspaces.remove(workspace.id, workspace.revision, true),
      fixture.sdk.workspaces.remove(workspace.id, workspace.revision, true),
    ]);
    assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((result) => result.status === "rejected").length, 1);
    assert.equal((await fixture.sdk.workspaces.wait(workspace.id)).status, "removed");
    assert.equal(fixture.git(["rev-parse", `refs/heads/${workspace.branch}`]), workspace.baseCommit);
    assert.equal(fixture.service.controller.snapshot().jobs.filter((job) => job.kind === "workspace.remove").length, 1);
  } finally { await fixture.close(); }
});
test("cancelling owned creation retains partial intent without changing the base checkout or recording success", async () => {
  const fixture = await gitFixture();
  try {
    const tree = join(fixture.project, "generated-cancellation");
    await mkdir(tree);
    await Promise.all(Array.from({ length: 500 }, (_, index) => writeFile(join(tree, `${index}.txt`), `Generated cancellation file ${index}.\n`)));
    fixture.git(["add", "--", "generated-cancellation"]);
    fixture.git(["-c", "user.name=Generated fixture", "-c", "user.email=fixture@example.invalid", "commit", "--no-gpg-sign", "-m", "Generated cancellation tree"]);
    const base = fixture.git(["write-tree"]), result = await fixture.sdk.workspaces.create(fixture.session().projectId, "moguri/generated-cancellation");
    const workspace = fixture.sdk.getState().snapshot!.managedWorkspaces.find((workspace) => workspace.id === result.id)!;
    assert.equal(fixture.sdk.getState().snapshot!.jobs.find((job) => job.id === workspace.jobId)?.workspaceId, workspace.id);
    await fixture.sdk.jobs.cancel(workspace.jobId!);
    assert.equal((await fixture.sdk.jobs.wait(workspace.jobId!)).status, "partial");
    assert.equal(fixture.sdk.getState().snapshot!.managedWorkspaces.find((workspace) => workspace.id === result.id)?.status, "partial");
    assert.equal(fixture.git(["branch", "--show-current"]), "main");
    assert.equal(fixture.git(["write-tree"]), base);
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});
test("two agent sessions sharing one managed root serialize their writer turns", native, async () => {
  const fixture = await gitFixture();
  try {
    const workspace = await fixture.create("moguri/generated-shared-writer");
    const sessions = await Promise.all([1, 2].map((index) => fixture.sdk.sessions.create(fixture.session().projectId, `Generated shared writer ${index}`, { modelId: fixture.modelId }, workspace.id)));
    for (const created of sessions) {
      await fixture.sdk.command({ type: "draft.save", sessionId: created.id!, expectedRevision: 0, text: "generated slow shared root", attachments: [] });
      await fixture.sdk.command({ type: "message.send", sessionId: created.id!, expectedRevision: 1, delivery: "queue" });
    }
    await waitFor(() => fixture.requests.length === 1);
    const state = fixture.sdk.getState().snapshot!, running = state.sessions.find((session) => session.workspaceId === workspace.id && session.turnId)!;
    assert.equal(state.sessions.filter((session) => session.workspaceId === workspace.id && session.turnId).length, 1);
    assert.equal(state.sessions.filter((session) => session.workspaceId === workspace.id && session.queue.length).length, 1);
    await fixture.sdk.command({ type: "session.stop", sessionId: running.id });
    await waitFor(() => fixture.requests.length === 2);
    for (const created of sessions) await fixture.sdk.command({ type: "session.stop", sessionId: created.id! });
    await waitFor(() => sessions.every((created) => !fixture.sdk.getState().snapshot!.sessions.find((session) => session.id === created.id)?.turnId));
  } finally { await fixture.close(); }
});
