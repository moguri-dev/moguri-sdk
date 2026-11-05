import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { envelope } from "../apps/service/src/controller.ts";
import { githubApplicationFixture, githubServiceFixture } from "./github-workflows-fixture.ts";
import { runProgram } from "../apps/service/src/program.ts";
import { waitFor } from "./fixture.ts";
import { profileFixture } from "./fixtures/profiles.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { candidateApiFixture } from "./fixtures/candidate-api.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { applyRemoteChange } from "../apps/service/src/project-remote.ts";

const moved = "https://github.com/generated-new-org/fixture.git";
test("reviewed remote relocation updates fetch/explicit push and future repository identity without changing HEAD, dirty bytes, index or unrelated remotes", async () => {
  const f = await githubServiceFixture();
  try {
    f.git(["remote", "add", "backup", "https://github.com/generated-backup/fixture.git"]);
    f.git(["config", "remote.origin.pushurl", "git@github.com:generated-old-org/fixture.git"]);
    await writeFile(join(f.root, "fixture.txt"), "Generated staged edit.\n"); f.git(["add", "--", "fixture.txt"]);
    await writeFile(join(f.root, "fixture.txt"), "Generated unstaged edit.\n");
    const index = await readFile(join(f.root, ".git", "index")), head = f.git(["rev-parse", "HEAD"]), revision = (await f.sdk.projects.configuration(f.projectId)).configuration.revision;
    const { preview } = await f.sdk.projects.remotePreview(f.projectId, "origin", moved);
    assert.equal(preview.document.action.kind, "git.remote.set");
    assert.equal(preview.document.remoteChange?.common.root, join(f.root, ".git"));
    assert.deepEqual(preview.document.remoteChange?.pushUrls, ["git@github.com:generated-old-org/fixture.git"]);
    const started = await f.sdk.projects.setRemote(preview, preview.document.confirmations, true), result = await f.sdk.github.wait(started.id!);
    assert.equal(result.operation.status, "completed");
    assert.equal(f.git(["remote", "get-url", "origin"]), moved);
    assert.equal(f.git(["remote", "get-url", "--push", "origin"]), moved);
    assert.equal(f.git(["remote", "get-url", "backup"]), "https://github.com/generated-backup/fixture.git");
    assert.deepEqual(await readFile(join(f.root, ".git", "index")), index);
    assert.equal(f.git(["rev-parse", "HEAD"]), head);
    assert.equal(await readFile(join(f.root, "fixture.txt"), "utf8"), "Generated unstaged edit.\n");
    assert.equal((await f.sdk.projects.git(f.projectId)).repository, "https://github.com/generated-new-org/fixture");
    assert.equal((await f.sdk.projects.configuration(f.projectId)).configuration.revision, revision + 1);
    assert.equal(result.document.remoteChange?.fetchUrl, f.remote);
  } finally { await f.close(); }
});

test("a linked worktree review exposes and updates the actual common-dir boundary, preserving both checkouts", async () => {
  const f = await githubServiceFixture();
  try {
    const linked = join(f.directory, "linked"); f.git(["worktree", "add", "-b", "generated-linked", linked]);
    const other = await f.sdk.projects.add(linked);
    await writeFile(join(linked, "fixture.txt"), "Generated linked dirty edit.\n");
    const { preview } = await f.sdk.projects.remotePreview(other.id!, "origin", moved);
    assert.deepEqual(preview.document.remoteChange?.worktrees.map((root) => root.root).sort(), [f.root, linked].sort());
    const started = await f.sdk.projects.setRemote(preview, preview.document.confirmations, true), result = await f.sdk.github.wait(started.id!);
    assert.equal(result.operation.status, "completed");
    assert.equal(result.operation.leaseRoots?.length, 3);
    assert.equal(f.git(["remote", "get-url", "origin"]), moved);
    assert.equal((await f.sdk.projects.git(other.id!)).repository, "https://github.com/generated-new-org/fixture");
    assert.equal(await readFile(join(linked, "fixture.txt"), "utf8"), "Generated linked dirty edit.\n");
    assert.equal(f.git(["branch", "--show-current"]), "main");
  } finally { await f.close(); }
});

test("stale config, URL credentials, custom transports, ambiguous push URLs and hard denials never mutate a remote", async () => {
  const f = await githubServiceFixture();
  try {
    const review = (await f.sdk.projects.remotePreview(f.projectId, "origin", moved)).preview;
    f.git(["config", "generated.concurrent", "preserved"]);
    await assert.rejects(() => f.sdk.projects.setRemote(review, review.document.confirmations, true), /changed|review/i);
    for (const url of ["ext::generated-command", "https://generated:secret@example.invalid/repo", "ssh://git@example.invalid/a;echo-bad", "file:///generated/repo"]) {
      await assert.rejects(() => f.sdk.projects.remotePreview(f.projectId, "origin", url), /URL|HTTPS|SSH|credentials|transport/i);
    }
    f.git(["config", "--add", "remote.origin.pushurl", "https://github.com/generated-a/fixture.git"]);
    f.git(["config", "--add", "remote.origin.pushurl", "https://github.com/generated-b/fixture.git"]);
    await assert.rejects(() => f.sdk.projects.remotePreview(f.projectId, "origin", moved), /push URL|multi-destination/);
    f.git(["config", "--unset-all", "remote.origin.pushurl"]);
    const settings = f.sdk.settings.get()!;
    await f.sdk.settings.update({ ...settings.values, permissions: { ...settings.values.permissions,
      tools: [{ id: "generated-deny", tool: "git_write", decision: "deny", pathPrefix: "" }] } }, settings.revision);
    await assert.rejects(() => f.sdk.projects.remotePreview(f.projectId, "origin", moved), /denial|denied/);
    assert.equal(f.git(["remote", "get-url", "origin"]), f.remote);
    assert.equal(f.service.controller.snapshot().githubOperations.length, 0);
  } finally { await f.close(); }
});

test("a failed terminal publication preserves actual remote effects and original intent; missing receipts cannot replay the change", async (context) => {
  const f = await githubServiceFixture();
  try {
    const { preview } = await f.sdk.projects.remotePreview(f.projectId, "origin", moved), command = envelope({
      type: "github.execute", scope: preview.document.scope, action: preview.document.action, expectedDigest: preview.digest,
      confirm: true, confirmations: preview.document.confirmations,
    });
    const commit = f.service.store.commit.bind(f.service.store);
    let failed = false;
    const mock = context.mock.method(f.service.store, "commit", (...args: Parameters<typeof commit>) => {
      if (!failed && args[0].some((event) => event.event_type === "github.operation_recorded" && event.payload.operation.kind === "git.remote.set" && event.payload.operation.status === "completed")) {
        failed = true; throw new Error("Generated remote publication failure.");
      }
      return commit(...args);
    });
    const started = await f.service.controller.dispatch(command), result = await f.sdk.github.wait(started.id!);
    mock.mock.restore();
    assert.equal(result.operation.status, "partial"); assert.equal(f.git(["remote", "get-url", "origin"]), moved);
    assert.equal(result.document.remoteChange?.fetchUrl, f.remote);
    assert.equal(JSON.parse(f.service.store.blob(result.operation.inputDigest)).expectedDigest, preview.digest);
    f.service.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run(f.sdk.profileId, command.id);
    await assert.rejects(() => f.service.controller.dispatch(command), /no command receipt|no.*replay|retained operation/i);
    assert.equal(f.service.controller.snapshot().githubOperations.length, 1);
    assert.equal(f.git(["remote", "get-url", "origin"]), moved);
  } finally { await f.close(); }
});

test("cancelling an undispatched remote change preserves the original config and does not become a successful update", async () => {
  const f = await githubServiceFixture();
  try {
    const { preview } = await f.sdk.projects.remotePreview(f.projectId, "origin", moved);
    const started = await f.sdk.projects.setRemote(preview, preview.document.confirmations, true);
    await f.sdk.github.cancel(started.id!);
    const result = await f.sdk.github.wait(started.id!);
    assert.equal(result.operation.status, "cancelled");
    assert.equal(result.operation.dispatched, false);
    assert.equal(f.git(["remote", "get-url", "origin"]), f.remote);
  } finally { await f.close(); }
});

test("moved-repository metadata and fresh account identity do not retarget original PR sources or transfer scoped Git approvals", async () => {
  const old = "generated-owner/fixture", next = "generated-new-org/fixture", oldPr = `https://github.com/${old}/pull/11`;
  const f = await githubApplicationFixture({ integrations: { fetch: async () => Response.json({
    number: 11, html_url: oldPr, state: "open", draft: true, merged: false, merged_at: null,
  }) } });
  try {
    const configuration = (await f.sdk.projects.configuration(f.projectId)).configuration;
    await f.sdk.projects.configure(f.projectId, { ...configuration.values, repo: { ...configuration.values.repo, githubAccess: "gh-cli" } }, configuration.revision);
    const settings = f.sdk.settings.get()!;
    await f.sdk.settings.update({ ...settings.values, permissions: { ...settings.values.permissions, remembered: [
      { id: "generated-project-git", scope: { kind: "project", projectId: f.projectId }, env: "Local", target: { kind: "tool", tool: "git_write" } },
      { id: "generated-global-policy", scope: { kind: "global" }, env: "Local", target: { kind: "tool", tool: "read_file" } },
    ] } }, settings.revision);
    const project = await f.sdk.github.project(f.scope), source = { kind: "pull" as const, repository: old, account: project.account, accountId: project.accountId, number: 11 };
    const original = await f.sdk.github.source(f.scope, source), startedSession = await f.sdk.github.startSession(f.scope, source, original.digest);
    const saved = structuredClone(f.sdk.getState().snapshot!.sessions.find((session) => session.id === startedSession.id)!);
    const repository = (await f.sdk.repositories.preview(f.sessionId)).preview;
    await f.sdk.jobs.wait((await f.sdk.repositories.refresh(f.sessionId, repository.bindingDigest, repository.revision, true)).id!);
    const observed = (await f.sdk.repositories.state(f.sessionId)).observation!;
    const stale = (await f.sdk.github.preview(f.scope, { kind: "github.issue.create", repository: old, account: project.account, title: "Generated original write", body: "" })).preview;
    const { preview } = await f.sdk.projects.remotePreview(f.projectId, "origin", `https://github.com/${next}.git`);
    f.relocate(next);
    const operation = await f.sdk.projects.setRemote(preview, preview.document.confirmations, true);
    assert.equal((await f.sdk.github.wait(operation.id!)).operation.status, "completed");
    f.changeAccount(43);
    await assert.rejects(() => f.sdk.github.execute(stale, stale.document.confirmations, true), /changed|review|account/i);
    const fresh = await f.sdk.github.project(f.scope);
    assert.equal(fresh.repository, next); assert.equal(fresh.accountId, "generated-owner:43");
    await assert.rejects(() => f.sdk.github.source(f.scope, { ...source, repository: next }), /account|source/i);
    const retained = f.sdk.getState().snapshot!.sessions.find((session) => session.id === saved.id)!;
    assert.deepEqual(retained.githubSource, saved.githubSource); assert.deepEqual(retained.prAssociations, saved.prAssociations);
    assert.equal(retained.prUrl, saved.prUrl); assert.deepEqual(retained.draft, saved.draft);
    assert.equal((await f.sdk.repositories.state(f.sessionId)).observation, null);
    assert.equal(f.sdk.settings.get()!.values.permissions.remembered?.some((grant) => grant.id === "generated-project-git"), false);
    assert.equal(f.sdk.settings.get()!.values.permissions.remembered?.some((grant) => grant.id === "generated-global-policy"), true);
    const originalEvent = f.service.controller.events(0).find((event) => event.event_type === "repository.recorded" && event.payload.observation.id === observed.id)!;
    assert.ok(originalEvent.event_type === "repository.recorded");
    assert.equal(originalEvent.payload.observation.repository?.fullName, old);
    const freshBinding = (await f.sdk.repositories.preview(f.sessionId)).preview;
    await f.sdk.jobs.wait((await f.sdk.repositories.refresh(f.sessionId, freshBinding.bindingDigest, freshBinding.revision, true)).id!);
    assert.equal((await f.sdk.repositories.state(f.sessionId)).observation?.repository?.fullName, next);
    assert.deepEqual(f.writes(), { issues: 0, pulls: 0 });
  } finally { await f.close(); }
});

test("a remote move preserves an older candidate's first recorded PR association and original source snapshots", async () => {
  const originalPr = "https://github.com/generated-candidate/fixture/pull/7";
  const f = await candidateApiFixture({ platform: { github: { runProgram: async (executable, args, options) => {
    if (executable !== "git") throw new Error("Generated candidate relocation fixture forbids real GitHub.");
    return runProgram(executable, args, { ...options, env: { ...options.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  } }, integrations: { fetch: async () => Response.json({
    number: 7, html_url: originalPr, state: "open", draft: true, merged: false, merged_at: null,
  }) } } });
  try {
    f.git(["remote", "add", "origin", "https://github.com/generated-candidate/fixture.git"]);
    await f.sdk.sessions.organize(f.sessionId, { prUrl: originalPr });
    const staged = await f.stage(), owner = structuredClone(f.sdk.getState().snapshot!.candidateOwners.find((owner) => owner.id === staged.candidate.id)!);
    assert.ok(JSON.stringify(owner).includes("generated-candidate"));
    const before = structuredClone((await f.sdk.candidates.read(staged.candidate.id)).candidate);
    const { preview } = await f.sdk.projects.remotePreview(f.session().projectId!, "origin", moved);
    const changed = await f.sdk.projects.setRemote(preview, preview.document.confirmations, true);
    assert.equal((await f.sdk.github.wait(changed.id!)).operation.status, "completed");
    assert.deepEqual(f.sdk.getState().snapshot!.candidateOwners.find((value) => value.id === owner.id), owner);
    assert.deepEqual((await f.sdk.candidates.read(staged.candidate.id)).candidate, before);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("cancellation after actual config publication retains a partial outcome and leases every original linked worktree until inspection", async () => {
  let root = "", held = false;
  const f = await githubServiceFixture({ runProgram: async (executable, args, options) => {
    if (executable !== "git") throw new Error("Generated cancellation fixture forbids GitHub/authentication.");
    if (!held && root && options.cwd === root && args.includes("rev-parse") && (await readFile(join(root, ".git", "config"), "utf8")).includes(moved)) {
      held = true;
      await new Promise<void>((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
        if (options.signal.aborted) reject(options.signal.reason);
      });
    }
    return runProgram(executable, args, { ...options, env: { ...options.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  } });
  try {
    root = f.root;
    const linked = join(f.directory, "cancel-linked"); f.git(["worktree", "add", "-b", "generated-cancel-linked", linked]);
    const { preview } = await f.sdk.projects.remotePreview(f.projectId, "origin", moved), started = await f.sdk.projects.setRemote(preview, preview.document.confirmations, true);
    await waitFor(() => held); await f.sdk.github.cancel(started.id!);
    const result = await f.sdk.github.wait(started.id!);
    assert.equal(result.operation.status, "partial"); assert.equal(result.operation.dispatched, true);
    assert.equal(f.git(["remote", "get-url", "origin"]), moved);
    assert.ok(f.service.controller.ownedLocalRoots().includes(linked));
    await f.sdk.github.acknowledge(result.operation.id, result.operation.revision, result.operation.inputDigest, true);
    assert.equal((await f.sdk.github.read(result.operation.id)).operation.status, "partial");
    assert.equal(f.service.controller.ownedLocalRoots().includes(linked), false);
  } finally { await f.close(); }
});

test("a shared remote change refuses a different profile's exact console owner without exposing its private sessions", { skip: process.platform !== "darwin" }, async () => {
  const f = await profileFixture(() => ({ terminal: { executable: process.execPath, args: ["-e", "process.stdin.resume()"] },
    github: { runProgram: async (executable, args, options) => {
      if (executable !== "git") throw new Error("Generated shared-console fixture forbids real GitHub.");
      return runProgram(executable, args, { ...options, env: { ...options.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
    } } }));
  try {
    const root = join(f.directory, "generated-shared-repository"); await mkdir(root);
    await writeFile(join(root, "fixture.txt"), "Generated shared Git root.\n");
    const git = initializeGeneratedRepository(root, ["fixture.txt"]); git(["remote", "add", "origin", "https://github.com/generated-old/fixture.git"]);
    const project = await f.sdk.projects.add(root), other = await f.create("Generated independent console profile");
    const otherProject = await other.client.projects.add(root), session = await other.client.sessions.create(otherProject.id!, "Generated private console");
    const terminal = await other.client.terminal.open(session.id!);
    await assert.rejects(() => f.sdk.projects.remotePreview(project.id!, "origin", moved), /owned writer|console|boundary|workspace/i);
    assert.equal(JSON.stringify(f.sdk.getState()).includes("Generated private console"), false);
    await other.client.terminal.close(terminal.id!);
    assert.equal((await f.sdk.projects.remotePreview(project.id!, "origin", moved)).preview.document.remoteChange?.url, moved);
  } finally { await f.close(); }
});

test("safe GitHub HTTPS-to-SSH rewrites are reviewed as actual destinations, while different-host/custom transports and foreign config locks are never adopted", async () => {
  let global = "/dev/null";
  const f = await githubServiceFixture({ runProgram: async (executable, args, options) => {
    if (executable !== "git") throw new Error("Generated URL-rewrite fixture forbids real GitHub.");
    return runProgram(executable, args, { ...options, env: { ...options.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: "1" } });
  } });
  try {
    global = join(f.directory, "generated-global-config");
    await writeFile(global, '[url "git@github.com:"]\n\tinsteadOf = https://github.com/\n');
    const { preview } = await f.sdk.projects.remotePreview(f.projectId, "origin", moved);
    assert.equal(preview.document.remoteChange?.worktrees[0]?.nextFetchUrl, "git@github.com:generated-new-org/fixture.git");
    const changed = await f.sdk.projects.setRemote(preview, preview.document.confirmations, true);
    assert.equal((await f.sdk.github.wait(changed.id!)).operation.status, "completed");
    assert.equal(f.git(["config", "--get", "remote.origin.url"]), moved);
    await writeFile(global, '[url "git@different-host.invalid:"]\n\tinsteadOf = https://github.com/\n');
    await assert.rejects(() => f.sdk.projects.remotePreview(f.projectId, "origin", "https://github.com/generated-next/fixture.git"), /different repository|host|substitut/i);
    await writeFile(global, '[url "ext::generated-never-run "]\n\tinsteadOf = https://github.com/\n');
    await assert.rejects(() => f.sdk.projects.remotePreview(f.projectId, "origin", "https://github.com/generated-next/fixture.git"), /URL|transport|credential/i);
    await writeFile(global, "");
    const next = (await f.sdk.projects.remotePreview(f.projectId, "origin", "git@github.com:generated-next/fixture.git")).preview;
    const lock = join(f.root, ".git", "config.lock"); await writeFile(lock, "Generated foreign lock owner.\n");
    const held = await f.sdk.projects.setRemote(next, next.document.confirmations, true), result = await f.sdk.github.wait(held.id!);
    assert.equal(result.operation.status, "partial"); assert.match(result.operation.diagnostic!, /already has a lock/);
    assert.equal(await readFile(lock, "utf8"), "Generated foreign lock owner.\n");
    assert.equal(f.git(["config", "--get", "remote.origin.url"]), moved);
    await rm(lock);
  } finally { await f.close(); }
});

test("a non-cooperating write to the prepared config lock is retained, never published or mistaken for reviewed bytes", async () => {
  const f = await githubServiceFixture();
  try {
    const review = (await f.sdk.projects.remotePreview(f.projectId, "origin", moved)).preview.document.remoteChange!;
    const lockPath = `${review.config.path}.lock`, config = await readFile(review.config.path);
    let injected = false, acknowledged = false;
    await assert.rejects(() => applyRemoteChange(review, f.stateDir, new AbortController().signal, () => {
      if (!injected && existsSync(lockPath) && readFileSync(lockPath).length) {
        injected = true; writeFileSync(lockPath, "Generated non-cooperating lock write.\n");
      }
    }, () => { acknowledged = true; }), { code: "remote_lock_changed" });
    assert.equal(injected, true); assert.equal(acknowledged, false);
    assert.deepEqual(await readFile(review.config.path), config);
    assert.equal(await readFile(lockPath, "utf8"), "Generated non-cooperating lock write.\n");
    assert.equal(f.git(["remote", "get-url", "origin"]), f.remote);
    await rm(lockPath);
  } finally { await f.close(); }
});
