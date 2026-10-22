import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  defaultProjectConfiguration, factoryControls, MoguriError, projectEvents, PROTOCOL_VERSION,
  type CapabilityJob, type CommandResult, type EventInput, type Snapshot, type StoredEvent,
} from "../packages/protocol/src/index.ts";
import {
  GithubCommandSchema, GithubQuerySchema, isGithubCommand, isGithubQuery, projectGithubOperation,
  type GithubAction, type GithubCommand, type GithubOperation, type GithubPreview, type GithubScope,
} from "../packages/protocol/src/github-workflows.ts";
import { Value } from "typebox/value";
import { GitHubWorkflows, githubCiState, validateGithubRef, validateGithubRemoteUrl, type GitHubWorkflowOptions } from "../apps/service/src/github-workflows.ts";
import { digest, EventStore } from "../apps/service/src/store.ts";
import { runProgram } from "../apps/service/src/program.ts";
import type { WorkflowHost } from "../apps/service/src/workflow-host.ts";
import type { WorkspaceFinish } from "../apps/service/src/session-workspace.ts";

const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);
type Fields = Record<string, string | number | boolean>;
class GeneratedGithub {
  login = "generated-user";
  writes: Array<{ path: string; method: string; fields: Fields }> = [];
  calls: string[] = [];
  issue = { id: 3, number: 3, title: "Generated issue", body: "Generated original body", state: "open", updated_at: "2026-01-01T00:00:00Z", html_url: "https://github.com/generated/repo/issues/3" };
  pull = { id: 7, number: 7, title: "Generated PR", body: "Generated PR body", state: "open", merged: false, merge_commit_sha: null as string | null,
    head: { ref: "topic", sha: A, repo: { full_name: "generated/repo" } }, base: { ref: "main", sha: B, repo: { full_name: "generated/repo" } }, updated_at: "2026-01-01T00:00:00Z" };
  release = { id: 11, tag_name: "v1", target_commitish: A, name: "Generated release", body: "Generated release body", draft: true, prerelease: false, updated_at: "2026-01-01T00:00:00Z" };
  tag: string | null = null;
  resolved = false;
  deletedComment = false;
  comment = { id: 21, body: "Generated original comment", updated_at: "2026-01-01T00:00:00Z", issue_url: "https://api.github.com/repos/generated/repo/issues/3", pull_request_url: "https://api.github.com/repos/generated/repo/pulls/7" };
  checks: unknown[] = [];
  statuses: unknown[] = [];
  runs: unknown[] = [];
  pages = false;
  loseResponse = false;
  before?: (path: string, method: string, fields: Fields) => void;
  handle(args: string[]): string {
    if (args[0] === "run") return "Generated bounded CI log. Untrusted data only.\n";
    const method = args[args.indexOf("--method") + 1]!, path = args[args.indexOf("--method") + 2]!, fields: Fields = {};
    for (let index = 0; index < args.length; index++) if (args[index] === "--field" || args[index] === "--raw-field") {
      const value = args[index + 1]!, split = value.indexOf("="), key = value.slice(0, split), raw = value.slice(split + 1);
      fields[key] = args[index] === "--field" ? raw === "true" ? true : raw === "false" ? false : Number(raw) : raw;
    }
    this.calls.push(`${method} ${path}`); this.before?.(path, method, fields);
    const write = method !== "GET" && (path !== "graphql" || String(fields.query).startsWith("mutation"));
    let data: unknown, next = false;
    if (write) {
      this.writes.push({ path, method, fields });
      if (path.endsWith("/merge")) {
        if (fields.sha !== this.pull.head.sha) throw new MoguriError("program_failed", "Generated GitHub HTTP 409 exact-head mismatch.", 409);
        this.pull.merged = true; this.pull.state = "closed"; this.pull.merge_commit_sha = C; data = { merged: true, sha: C };
      } else if (path === "graphql") {
        this.resolved = !String(fields.query).includes("unresolveReviewThread");
        data = { data: { [this.resolved ? "resolveReviewThread" : "unresolveReviewThread"]: { thread: { id: "GENERATED_THREAD", isResolved: this.resolved } } } };
      } else if (path.endsWith("/comments/21")) {
        if (method === "DELETE") { this.deletedComment = true; data = null; }
        else { this.comment.body = String(fields.body); data = this.comment; }
      } else if (path.endsWith("/reviews")) data = { id: 30, body: fields.body, state: fields.event === "APPROVE" ? "APPROVED" : "COMMENTED", commit_id: fields.commit_id };
      else if (path.endsWith("/comments") || path.endsWith("/replies")) data = { id: 21, body: fields.body, state: "open" };
      else if (path.includes("/releases")) {
        this.release = { ...this.release, ...fields } as typeof this.release;
        if (fields.draft === false) this.tag = String(fields.target_commitish);
        data = this.release;
      } else if (path.endsWith("/issues") || path.endsWith("/issues/3")) { this.issue = { ...this.issue, ...fields } as typeof this.issue; data = this.issue; }
      else if (path.endsWith("/pulls") || path.endsWith("/pulls/7")) {
        this.pull = { ...this.pull, ...Object.fromEntries(Object.entries(fields).filter(([key]) => !["head", "base"].includes(key))) } as typeof this.pull; data = this.pull;
      } else throw new Error(`Unexpected generated write ${method} ${path}`);
      if (this.loseResponse) throw new MoguriError("program_partial", "Generated lost remote response after an actual effect.", 409);
    } else if (path === "user") data = { id: 101, login: this.login };
    else if (path === "graphql" && String(fields.query).includes("reviewThreads(")) data = { data: { repository: { nameWithOwner: "generated/repo", pullRequest: { number: 7, headRefOid: A,
      reviewThreads: { nodes: [{ id: "GENERATED_THREAD", isResolved: this.resolved, isOutdated: false, comments: { nodes: [{ databaseId: 21, body: "Generated thread comment" }] } }],
        pageInfo: { hasNextPage: false, endCursor: null } } } } } };
    else if (path === "graphql") data = { data: { node: { __typename: "PullRequestReviewThread", id: "GENERATED_THREAD", isResolved: this.resolved, isOutdated: false,
      pullRequest: { number: 7, headRefOid: A, state: "OPEN", repository: { nameWithOwner: "generated/repo" } },
      comments: { nodes: [{ id: "COMMENT_NODE", databaseId: 21, body: "Generated original review comment", updatedAt: "2026-01-01T00:00:00Z" }], pageInfo: { hasNextPage: false } } } } };
    else if (path.includes("/check-runs?")) data = { total_count: this.checks.length, check_runs: this.checks };
    else if (path.includes("/status?")) data = { sha: A, statuses: this.statuses };
    else if (path.includes("/actions/runs?")) data = { total_count: this.runs.length, workflow_runs: this.runs };
    else if (path.endsWith("/actions/runs/44")) data = { id: 44, name: "Generated CI", head_sha: A, status: "completed", conclusion: "success" };
    else if (path.includes("/branches/")) { const name = decodeURIComponent(path.split("/branches/")[1]!); data = { name, commit: { sha: name === "main" ? B : A } }; }
    else if (path.includes("/git/ref/tags/")) {
      if (!this.tag) throw new MoguriError("program_failed", "Generated GitHub HTTP 404 Not Found.", 409);
      data = { ref: "refs/tags/v1", object: { type: "commit", sha: this.tag } };
    } else if (path.includes("/commits/")) data = { sha: A };
    else if (path.endsWith("/issues/3")) data = this.issue;
    else if (path.endsWith("/pulls/7")) data = this.pull;
    else if (path.endsWith("/pulls/comments/21") || path.endsWith("/issues/comments/21")) {
      if (this.deletedComment) throw new MoguriError("program_failed", "Generated GitHub HTTP 404 comment deleted.", 409);
      data = this.comment;
    }
    else if (path.endsWith("/releases/11")) data = this.release;
    else if (path.includes("/issues?")) { data = [{ ...this.issue, number: path.includes("page=2") ? 4 : 3 }]; next = this.pages && !path.includes("page=2"); }
    else if (path.includes("/pulls?")) data = [this.pull];
    else if (path.includes("/releases?")) data = [this.release];
    else if (path.includes("/reviews?")) data = [{ id: 30, body: "Generated review", state: "COMMENTED", commit_id: A }];
    else if (path.includes("/comments?")) data = [{ id: 21, body: "Generated comment" }];
    else if (path === "repos/generated/repo") data = { id: 1, name: "repo", full_name: "generated/repo", default_branch: "main", delete_branch_on_merge: false };
    else throw new Error(`Unexpected generated read ${method} ${path}`);
    if (method === "DELETE") return "HTTP/2.0 204 No Content\n\n";
    return `HTTP/2.0 200 OK\nETag: "${digest(JSON.stringify(data))}"\n${next ? 'Link: <https://api.github.com/generated?page=2>; rel="next"\n' : ""}\n${JSON.stringify(data)}`;
  }
}

async function generated(options: GitHubWorkflowOptions & { gh?: GeneratedGithub; beforeRun?: (executable: string, args: string[]) => void; persistent?: boolean } = {}) {
  const directory = resolve("tests", `.generated-github-${randomUUID()}`); await mkdir(directory);
  const root = join(directory, "checkout"), remote = join(directory, "remote.git"), hooks = join(directory, "hooks");
  await mkdir(root); await mkdir(hooks);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
  const invoke = (cwd: string, args: string[]) => execFileSync("git", ["--no-pager", ...args], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const git = (args: string[]) => invoke(root, args), bare = (args: string[]) => invoke(remote, args);
  invoke(directory, ["init", "--bare", "--initial-branch=main", remote]);
  git(["init", "--initial-branch=main"]); git(["config", "user.name", "Generated GitHub Fixture"]); git(["config", "user.email", "generated@example.invalid"]);
  git(["config", "commit.gpgSign", "false"]); git(["config", "tag.gpgSign", "false"]); git(["config", "core.hooksPath", hooks]);
  bare(["config", "core.hooksPath", hooks]); await writeFile(join(root, "fixture.txt"), "generated base\n");
  git(["add", "--", "fixture.txt"]); git(["commit", "-m", "Generated base"]); git(["remote", "add", "origin", remote]); git(["push", "origin", "main"]);
  const key = randomBytes(32), storePath = options.persistent ? join(directory, "state.sqlite") : ":memory:";
  const store = new EventStore(storePath, key);
  let history: StoredEvent[] = [], operations: GithubOperation[] = [];
  const configuration = defaultProjectConfiguration("generated-project");
  const project = { id: "generated-project", name: "Generated", path: await realpath(root) };
  const extra = { policy: { revision: 0, allowedEnvs: ["Local"] as Snapshot["policy"]["allowedEnvs"] }, settings: projectEvents([]).settings };
  const state = (): Snapshot => ({ ...projectEvents(history), githubOperations: operations, ...extra, protocolVersion: PROTOCOL_VERSION,
    seq: history.at(-1)?.seq ?? 0, profileId: "default", provider: { status: "disconnected", models: [], login: null, diagnostic: null }, capabilities: [] });
  const append = (events: EventInput[], receipt?: { id: string; digest: string; result: CommandResult }) => {
    const saved = store.commit(events, receipt); history.push(...saved);
    for (const event of saved) if (event.event_type === "github.operation_recorded") {
      const next = projectGithubOperation(operations.find((value) => value.id === event.payload.operation.id), event.payload.operation);
      operations = [...operations.filter((value) => value.id !== next.id), next];
    }
  };
  append([{ event_type: "project.added", profile_id: "default", project_id: project.id, payload: { project } }]);
  const jobs = new Map<string, { abort: AbortController; done: Promise<void> }>();
  const host: WorkflowHost = {
    snapshot: state, events: () => history, project: (id, workspaceId) => {
      if (id !== project.id || workspaceId || !state().projects.some((value) => value.id === id)) throw new MoguriError("workspace_scope", "Generated exact project/workspace missing.", 404);
      return project;
    },
    configuration: () => configuration, assertRoot: async (id, workspaceId, signal) => { signal.throwIfAborted(); host.project(id, workspaceId); },
    rootBusy: (value, except) => value === root && state().jobs.some((job) => job.id !== except && job.kind.startsWith("git.") && ["running", "waiting_input"].includes(job.status)),
    closing: () => false, commit: (events) => append(events),
    job: (kind, projectId, workspaceId, execute, start, settled, lifecycle, sessionId) => {
      const id = randomUUID(), abort = new AbortController(), job: CapabilityJob = { id, kind, projectId, workspaceId: workspaceId ?? null, sessionId: sessionId ?? null, parentTurnId: null,
        status: "running", progress: "Starting generated work", resultDigest: null, error: null };
      start(job);
      const done = Promise.resolve().then(() => execute(abort.signal, () => {}, id)).then((value) => {
        abort.signal.throwIfAborted();
        const resultDigest = store.putBlob(JSON.stringify(value)), observed = state().jobs.find((job) => job.id === id)!;
        append([...(lifecycle?.completed(value, resultDigest) ?? []), { event_type: "job.finished", profile_id: "default", project_id: projectId,
          payload: { jobId: id, status: "completed", resultDigest, error: null, operationId: observed.operationId } }]);
      }).catch((error: unknown) => {
        const failure = lifecycle!.failed(error, abort.signal.aborted), observed = state().jobs.find((job) => job.id === id)!;
        append([...failure.events, { event_type: "job.finished", profile_id: "default", project_id: projectId,
          payload: { jobId: id, status: failure.status, resultDigest: null, error: failure.error, operationId: observed.operationId } }]);
      }).finally(() => { settled?.(); });
      jobs.set(id, { abort, done }); return id;
    },
  };
  const run: typeof runProgram = async (executable, args, runOptions) => {
    options.beforeRun?.(executable, args);
    if (executable === "gh") {
      if (!options.gh) throw new Error("Generated test refused real GitHub access.");
      runOptions.signal.throwIfAborted(); return options.gh.handle(args);
    }
    return runProgram(executable, args, { ...runOptions, env: { ...runOptions.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  };
  const runtime = new GitHubWorkflows(store, host, { ...options, runProgram: options.runProgram ?? run });
  const scope: GithubScope = { env: "Local", projectId: project.id };
  const finish = (command: GithubCommand, id = randomUUID()): WorkspaceFinish => {
    const hash = digest(JSON.stringify(command));
    return Object.assign((events: EventInput[], result: CommandResult = {}) => { append(events, { id, digest: hash, result }); return result; }, { intent: { id, digest: hash } });
  };
  const preview = async (action: GithubAction): Promise<GithubPreview> => {
    const value = await runtime.query({ type: "github.preview", scope, action }); assert.equal(value.type, "github.preview");
    return value.preview;
  };
  const command = (value: GithubPreview): Extract<GithubCommand, { type: "github.execute" }> => ({ type: "github.execute", scope: value.document.scope, action: value.document.action,
    expectedDigest: value.digest, confirm: true, confirmations: value.document.confirmations });
  const start = async (action: GithubAction) => { const review = await preview(action), value = command(review), result = await runtime.execute(value, finish(value)); assert.ok(result.id); return result.id; };
  const settled = async (id: string) => {
    const operation = operations.find((value) => value.id === id)!; await jobs.get(operation.jobId)!.done;
    const value = await runtime.query({ type: "github.read", operationId: id }); assert.equal(value.type, "github.read"); return value;
  };
  return { directory, root, remote, hooks, git, bare, store, storePath, key, runtime, host, state, extra, configuration, scope, preview, command, finish, start, settled, append, jobs,
    close: async () => { runtime.close(); await Promise.all([...jobs.values()].map((value) => value.done)); store.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("GitHub workflow protocol is typed, Local-only, and rejects unsafe remote/ref syntax without retaining credentials", () => {
  assert.equal(Value.Check(GithubCommandSchema, { type: "github.raw", endpoint: "/arbitrary" }), false);
  assert.equal(Value.Check(GithubQuerySchema, { type: "github.browse", scope: { env: "Remote", projectId: "generated" }, input: {} }), false);
  assert.equal(isGithubCommand({ type: "github.execute", scope: { env: "Local", projectId: "generated" }, action: { kind: "git.push", remote: "origin", branch: "main", forceWithLease: false },
    expectedDigest: "a".repeat(64), confirm: true, confirmations: [] }), true);
  assert.equal(isGithubQuery({ type: "github.history", offset: 0, limit: 20 }), true);
  for (const repository of ["../repo", "generated/..", "generated/.", "generated/repo?x=y", "generated/repo/extra"]) assert.equal(isGithubQuery({
    type: "github.browse", scope: { env: "Local", projectId: "generated" }, input: { resource: "issues", repository, account: "generated-user", page: 1, perPage: 20 },
  }), false);
  for (const value of ["-main", "topic:main", "../main", "refs/heads/main", "branch.lock", "main@{1}", "a//b"]) assert.throws(() => validateGithubRef(value));
  for (const value of ["https://secret:token@github.com/a/b.git", "ext::sh -c anything", "https://github.com/a/b?access_token=secret", "ssh://git@host/a%60b",
    "git@-host:repo", "ssh://git@-host/repo", "-user@host:repo", "git@host:-option"]) assert.throws(() => validateGithubRemoteUrl(value));
  assert.equal(validateGithubRemoteUrl("git@github.com:generated/repo.git"), "git@github.com:generated/repo.git");
});

test("reviewed main push requires explicit protected confirmation, uses user hooks, and preserves source index/HEAD", async () => {
  const f = await generated();
  try {
    const original = f.git(["rev-parse", "HEAD"]); f.git(["commit", "--allow-empty", "-m", "Generated main change"]);
    const head = f.git(["rev-parse", "HEAD"]), index = await readFile(join(f.root, ".git/index"));
    await writeFile(join(f.hooks, "pre-push"), "#!/bin/sh\nprintf generated-hook > hook-marker\n"); await chmod(join(f.hooks, "pre-push"), 0o700);
    const review = await f.preview({ kind: "git.push", remote: "origin", branch: "main", forceWithLease: false });
    assert.equal(review.document.remote?.sha, original); assert.ok(review.document.confirmations.some((value) => value.includes("protected/main")));
    const missing = { ...f.command(review), confirmations: [] }; await assert.rejects(() => f.runtime.execute(missing, f.finish(missing)), { code: "github_review" });
    const value = f.command(review), admitted = await f.runtime.execute(value, f.finish(value)), result = await f.settled(admitted.id!);
    // The hook's untracked output is truthfully partial instead of claiming unchanged source state.
    assert.equal(result.operation.status, "partial"); assert.equal(f.bare(["rev-parse", "refs/heads/main"]), head);
    assert.equal(await readFile(join(f.root, "hook-marker"), "utf8"), "generated-hook");
    assert.equal(f.git(["rev-parse", "HEAD"]), head); assert.deepEqual(await readFile(join(f.root, ".git/index")), index);
  } finally { await f.close(); }
});

test("normal main push and deliberate non-fast-forward replacement complete only at the separately captured lease", async () => {
  const f = await generated();
  try {
    f.git(["commit", "--allow-empty", "-m", "Generated fast-forward"]);
    const descendant = f.git(["rev-parse", "HEAD"]);
    const pushed = await f.settled(await f.start({ kind: "git.push", remote: "origin", branch: "main", forceWithLease: false }));
    assert.equal(pushed.operation.status, "completed"); assert.equal(f.bare(["rev-parse", "main"]), descendant);
    const orphan = f.git(["commit-tree", "HEAD^{tree}", "-m", "Generated separately reviewed rewrite"]);
    f.git(["branch", "generated-rewrite", orphan]); f.git(["switch", "generated-rewrite"]);
    const review = await f.preview({ kind: "git.push", remote: "origin", branch: "main", forceWithLease: true });
    assert.equal(review.document.remote?.sha, descendant);
    const command = f.command(review), forced = await f.settled((await f.runtime.execute(command, f.finish(command))).id!);
    assert.equal(forced.operation.status, "completed"); assert.equal(f.bare(["rev-parse", "main"]), orphan);
    f.git(["switch", "main"]);
    const denied = await f.settled(await f.start({ kind: "git.push", remote: "origin", branch: "main", forceWithLease: false }));
    assert.equal(denied.operation.status, "partial"); assert.equal(f.bare(["rev-parse", "main"]), orphan);
  } finally { await f.close(); }
});

test("stale HEAD/index/remote previews and policy denials do not dispatch, and exact force-with-lease never overwrites a raced destination", async () => {
  let raced = false, replacement = "", f: Awaited<ReturnType<typeof generated>>;
  f = await generated({ beforeRun: (executable, args) => {
    if (!raced && executable === "git" && args.includes("push") && args.some((value) => value.startsWith("--force-with-lease="))) {
      raced = true; f.bare(["update-ref", "refs/heads/main", replacement]);
      assert.equal(args.includes("--force"), false);
    }
  } });
  try {
    const base = f.git(["rev-parse", "HEAD"]);
    f.git(["commit", "--allow-empty", "-m", "Generated descendant"]);
    replacement = f.git(["commit-tree", "HEAD^{tree}", "-p", base, "-m", "Generated competing remote history"]);
    f.git(["push", "origin", `${replacement}:refs/heads/generated-other`]);
    const review = await f.preview({ kind: "git.push", remote: "origin", branch: "main", forceWithLease: true });
    assert.ok(review.document.confirmations.some((value) => value.includes(`force-with-lease at ${base}`)));
    const value = f.command(review), result = await f.settled((await f.runtime.execute(value, f.finish(value))).id!);
    assert.equal(raced, true); assert.equal(result.operation.status, "partial"); assert.equal(f.bare(["rev-parse", "refs/heads/main"]), replacement);
    const inspection: GithubCommand = { type: "github.acknowledge", operationId: result.operation.id, expectedRevision: result.operation.revision,
      expectedInputDigest: result.operation.inputDigest, confirm: true };
    await f.runtime.execute(inspection, f.finish(inspection));
    f.append([{ event_type: "session.resumed", profile_id: "default", project_id: f.scope.projectId, payload: {} }]);
    const stale = await f.preview({ kind: "git.push", remote: "origin", branch: "main", forceWithLease: true });
    await writeFile(join(f.root, "fixture.txt"), "generated later staged edit\n"); f.git(["add", "--", "fixture.txt"]);
    const staleCommand = f.command(stale); await assert.rejects(() => f.runtime.execute(staleCommand, f.finish(staleCommand)), { code: "github_review" });
    f.extra.policy = { revision: 1, allowedEnvs: ["Remote"] };
    await assert.rejects(() => f.preview({ kind: "git.push", remote: "origin", branch: "main", forceWithLease: false }), { code: "github_env" });
    f.extra.policy = { revision: 2, allowedEnvs: ["Local"] }; f.extra.settings.values.permissions.tools.push({ id: "generated-deny", tool: "git", decision: "deny", pathPrefix: "" });
    await assert.rejects(() => f.preview({ kind: "git.tag.create", tag: "v1", target: base, annotated: false, message: "" }), { code: "github_denied" });
    f.extra.settings.values.permissions.tools = []; f.configuration.values.readOnlyFolders = ["private"];
    await assert.rejects(() => f.preview({ kind: "git.push", remote: "origin", branch: "main", forceWithLease: false }), { code: "folder_containment" });
  } finally { await f.close(); }
});

test("generated annotated/lightweight tags use exact objects and separately reviewed push/local/remote deletion", async () => {
  const f = await generated();
  try {
    const head = f.git(["rev-parse", "HEAD"]), index = await readFile(join(f.root, ".git/index"));
    for (const annotated of [false, true]) {
      const tag = annotated ? "generated-annotated" : "generated-lightweight";
      const created = await f.settled(await f.start({ kind: "git.tag.create", tag, target: head, annotated, message: annotated ? "Generated annotation" : "" }));
      assert.equal(created.operation.status, "completed"); assert.equal(f.git(["cat-file", "-t", `refs/tags/${tag}`]), annotated ? "tag" : "commit");
      const pushed = await f.settled(await f.start({ kind: "git.tag.push", remote: "origin", tag }));
      assert.equal(pushed.operation.status, "completed"); assert.equal(f.bare(["rev-parse", `refs/tags/${tag}`]), f.git(["rev-parse", `refs/tags/${tag}`]));
      assert.equal((await f.settled(await f.start({ kind: "git.tag.delete", tag, location: "remote", remote: "origin" }))).operation.status, "completed");
      assert.equal(f.bare(["for-each-ref", "--format=%(refname)", `refs/tags/${tag}`]), "");
      assert.equal((await f.settled(await f.start({ kind: "git.tag.delete", tag, location: "local" }))).operation.status, "completed");
    }
    assert.equal(f.git(["rev-parse", "HEAD"]), head); assert.deepEqual(await readFile(join(f.root, ".git/index")), index);
  } finally { await f.close(); }
});

async function conflicting(f: Awaited<ReturnType<typeof generated>>) {
  f.git(["switch", "-c", "topic"]); await writeFile(join(f.root, "fixture.txt"), "generated topic\n"); f.git(["add", "--", "fixture.txt"]); f.git(["commit", "-m", "Generated topic"]);
  const original = f.git(["rev-parse", "HEAD"]); f.git(["switch", "main"]);
  await writeFile(join(f.root, "fixture.txt"), "generated main\n"); f.git(["add", "--", "fixture.txt"]); f.git(["commit", "-m", "Generated main"]);
  const onto = f.git(["rev-parse", "HEAD"]); f.git(["switch", "topic"]);
  const result = await f.settled(await f.start({ kind: "git.rebase", mode: "start", onto: "main" }));
  assert.equal(result.operation.status, "partial"); assert.equal(result.result?.outcome, "conflicts");
  assert.match(await readFile(join(f.root, "fixture.txt"), "utf8"), /<<<<<<< /);
  assert.equal(f.git(["rev-parse", `refs/moguri/rebase/${result.operation.id}/original`]), original);
  assert.equal(f.git(["rev-parse", `refs/moguri/rebase/${result.operation.id}/onto`]), onto);
  return { original, onto, result };
}
test("real generated rebase conflicts retain both histories/index until a new exact continue review", async () => {
  const f = await generated();
  try {
    const { onto, original, result } = await conflicting(f), unmerged = f.git(["ls-files", "--unmerged"]);
    await assert.rejects(() => f.preview({ kind: "git.rebase", mode: "continue" }), /Resolve and stage/);
    assert.equal(f.git(["ls-files", "--unmerged"]), unmerged);
    await writeFile(join(f.root, "fixture.txt"), "generated explicitly resolved\n"); f.git(["add", "--", "fixture.txt"]);
    const continued = await f.settled(await f.start({ kind: "git.rebase", mode: "continue" }));
    assert.equal(continued.operation.status, "completed"); assert.equal(continued.result?.rebaseInProgress, false);
    assert.equal(f.git(["merge-base", "HEAD", onto]), onto);
    assert.equal(f.git(["rev-parse", `refs/moguri/rebase/${result.operation.id}/original`]), original);
    assert.equal(await readFile(join(f.root, "fixture.txt"), "utf8"), "generated explicitly resolved\n");
  } finally { await f.close(); }
});
test("real generated rebase abort is separately reviewed and returns the original branch without erasing retained histories", async () => {
  const f = await generated();
  try {
    const { original, onto, result } = await conflicting(f), review = await f.preview({ kind: "git.rebase", mode: "abort" });
    assert.ok(review.document.warnings.some((value) => value.includes("discards")));
    const value = f.command(review), aborted = await f.settled((await f.runtime.execute(value, f.finish(value))).id!);
    assert.equal(aborted.operation.status, "completed"); assert.equal(f.git(["rev-parse", "HEAD"]), original);
    assert.equal(f.git(["rev-parse", `refs/moguri/rebase/${result.operation.id}/onto`]), onto);
    assert.equal(await readFile(join(f.root, "fixture.txt"), "utf8"), "generated topic\n");
  } finally { await f.close(); }
});

test("a native external HEAD race cannot become a claimed exact-input rebase success", async () => {
  let f: Awaited<ReturnType<typeof generated>>, replacement = "", raced = false;
  f = await generated({ beforeRun: (executable, args) => {
    if (executable === "git" && args.includes("rebase") && args.includes("--no-autostash") && !raced) {
      raced = true;
      const previous = f.git(["rev-parse", "HEAD"]);
      replacement = f.git(["commit-tree", "HEAD^{tree}", "-p", previous, "-m", "Generated external source race"]);
      f.git(["update-ref", "refs/heads/generated-topic", replacement, previous]);
    }
  } });
  try {
    f.git(["switch", "-c", "generated-topic"]); f.git(["commit", "--allow-empty", "-m", "Generated topic"]);
    const original = f.git(["rev-parse", "HEAD"]); f.git(["switch", "main"]); f.git(["commit", "--allow-empty", "-m", "Generated onto"]); f.git(["switch", "generated-topic"]);
    const result = await f.settled(await f.start({ kind: "git.rebase", mode: "start", onto: "main" }));
    assert.equal(raced, true); assert.equal(result.operation.status, "partial"); assert.match(result.operation.diagnostic!, /original rebase head differs/);
    assert.equal(f.git(["rev-parse", "ORIG_HEAD"]), replacement);
    assert.equal(f.git(["rev-parse", `refs/moguri/rebase/${result.operation.id}/original`]), original);
  } finally { await f.close(); }
});

test("bounded typed GitHub pagination, reviews, comments, exact-head checks/runs/logs and account mismatches use only generated requests", async () => {
  const gh = new GeneratedGithub(), f = await generated({ gh }); gh.pages = true;
  try {
    const browse = async (input: Extract<Parameters<typeof f.runtime.query>[0], { type: "github.browse" }>["input"]) => {
      const result = await f.runtime.query({ type: "github.browse", scope: f.scope, input }); assert.equal(result.type, "github.browse"); return result;
    };
    const page = await browse({ resource: "issues", repository: "generated/repo", account: gh.login, page: 1, perPage: 1 });
    assert.equal(page.nextPage, 2); assert.equal(page.items[0]?.number, 3); assert.equal(page.boundary, "controller-gh-account-not-ssh");
    assert.equal((await browse({ resource: "issues", repository: "generated/repo", account: gh.login, page: 2, perPage: 1 })).items[0]?.number, 4);
    for (const resource of ["reviews", "comments", "review-comments"] as const) assert.equal((await browse({ resource, repository: "generated/repo", account: gh.login, number: 7, page: 1, perPage: 10 })).items.length, 1);
    const threads = await browse({ resource: "threads", repository: "generated/repo", account: gh.login, number: 7, page: 1, perPage: 10 });
    assert.equal(threads.items[0]?.nodeId, "GENERATED_THREAD"); assert.equal(threads.items[0]?.id, 21);
    assert.match((await browse({ resource: "logs", repository: "generated/repo", account: gh.login, runId: 44, page: 1, perPage: 10 })).items[0]!.body, /Generated bounded/);
    gh.login = "different-user"; await assert.rejects(() => browse({ resource: "pulls", repository: "generated/repo", account: "generated-user", page: 1, perPage: 10 }), { code: "github_account" });
    assert.equal(gh.writes.length, 0);
  } finally { await f.close(); }
});

test("read-only/side sessions and foreign workspace/profile scopes cannot acquire Git mutation authority", async () => {
  const gh = new GeneratedGithub(), f = await generated({ gh });
  try {
    f.append([{ event_type: "session.created", profile_id: "default", project_id: f.scope.projectId, session_id: "generated-side",
      payload: { title: "Generated side session", controls: factoryControls(), kind: "side", mode: "read-only" } }]);
    const scope: GithubScope = { ...f.scope, sessionId: "generated-side" };
    await assert.rejects(() => f.runtime.query({ type: "github.preview", scope, action: { kind: "github.issue.comment", repository: "generated/repo", account: gh.login, number: 3, body: "Generated forbidden mutation" } }), { code: "read_only" });
    await assert.rejects(() => f.runtime.query({ type: "github.preview", scope: { ...f.scope, workspaceId: "missing-owned-worktree" }, action: { kind: "git.tag.push", remote: "origin", tag: "v1" } }), { code: "workspace_scope" });
    const read = await f.runtime.query({ type: "github.browse", scope, input: { resource: "issues", repository: "generated/repo", account: gh.login, page: 1, perPage: 10 } });
    assert.equal(read.type, "github.browse"); assert.equal(gh.writes.length, 0);
    await assert.rejects(() => f.runtime.query({ type: "github.read", operationId: "foreign-operation" }), { code: "github_missing" });
  } finally { await f.close(); }
});

test("issues, PRs, review comments/replies/thread resolution and close/reopen are actual reviewed typed mutations", async () => {
  const gh = new GeneratedGithub(), f = await generated({ gh }), identity = { repository: "generated/repo", account: gh.login };
  try {
    const actions: GithubAction[] = [
      { kind: "github.issue.create", ...identity, title: "Generated created issue", body: "Generated issue input" },
      { kind: "github.issue.update", ...identity, number: 3, title: "Generated edited title", body: "", state: "closed" },
      { kind: "github.issue.update", ...identity, number: 3, state: "open" },
      { kind: "github.issue.comment", ...identity, number: 3, body: "Generated issue comment" },
      { kind: "github.pr.create", ...identity, title: "Generated created PR", body: "Generated PR input", base: "main", head: "topic", draft: false },
      { kind: "github.pr.update", ...identity, number: 7, title: "Generated edited PR", state: "closed" },
      { kind: "github.pr.update", ...identity, number: 7, state: "open" },
      { kind: "github.pr.comment", ...identity, number: 7, body: "Generated PR comment" },
      { kind: "github.review.submit", ...identity, number: 7, event: "COMMENT", body: "Generated review" },
      { kind: "github.review.reply", ...identity, number: 7, commentId: 21, body: "Generated inline reply" },
      { kind: "github.review.resolve", ...identity, number: 7, threadId: "GENERATED_THREAD", resolve: true },
      { kind: "github.review.resolve", ...identity, number: 7, threadId: "GENERATED_THREAD", resolve: false },
    ];
    for (const action of actions) {
      const result = await f.settled(await f.start(action)); assert.equal(result.operation.status, "completed", `${action.kind}: ${result.operation.diagnostic}`);
      assert.equal(result.operation.actor, "user"); assert.equal(result.document.accountId, "generated-user:101");
    }
    assert.equal(gh.writes.length, actions.length);
    assert.equal(gh.writes.find((value) => value.path.endsWith("/replies"))?.fields.body, "Generated inline reply");
    assert.equal(gh.writes.find((value) => value.path.endsWith("/reviews"))?.fields.commit_id, A);
  } finally { await f.close(); }
});

test("PR creation captures real branch API SHAs, explicit fork identity and excludes transient repository credentials", async () => {
  const gh = new GeneratedGithub(), f = await generated({ gh }), identity = { repository: "generated/repo", account: gh.login };
  try {
    await assert.rejects(() => f.preview({ kind: "github.pr.create", ...identity, title: "Generated cross-repo PR", body: "", base: "main", head: "other-owner:topic", draft: true }), { code: "github_ref" });
    gh.pull.head.repo = { full_name: "generated/custom-fork" };
    Object.assign(gh.pull.head.repo, { temp_clone_token: "GENERATED_TRANSIENT_CLONE_CREDENTIAL" });
    const review = await f.preview({ kind: "github.pr.create", ...identity, title: "Generated cross-repo PR", body: "", base: "main", head: "topic",
      headRepository: "generated/custom-fork", draft: false });
    assert.equal(review.document.resource?.headSha, A);
    const command = f.command(review), result = await f.settled((await f.runtime.execute(command, f.finish(command))).id!);
    assert.equal(result.operation.status, "completed");
    assert.equal(gh.calls.some((value) => value.includes("/compare/")), false);
    assert.ok(gh.calls.some((value) => value.includes("/repos/generated/custom-fork/branches/topic") || value.includes("repos/generated/custom-fork/branches/topic")));
    assert.equal(gh.writes[0]?.fields.head, "generated:topic"); assert.equal(gh.writes[0]?.fields.head_repo, "custom-fork");
    const editReview = await f.preview({ kind: "github.pr.update", ...identity, number: 7, title: "Generated safe metadata review" });
    assert.equal(editReview.document.resource!.content.includes("GENERATED_TRANSIENT_CLONE_CREDENTIAL"), false);
    assert.equal(JSON.stringify(f.store.events()).includes("GENERATED_TRANSIENT_CLONE_CREDENTIAL"), false);
    assert.equal(JSON.stringify(result).includes("GENERATED_TRANSIENT_CLONE_CREDENTIAL"), false);
  } finally { await f.close(); }
});

test("existing conversation and inline-review comment edits/deletes bind the exact original owner, bytes and revision", async () => {
  const gh = new GeneratedGithub(), f = await generated({ gh }), identity = { repository: "generated/repo", account: gh.login };
  try {
    for (const channel of ["conversation", "review"] as const) {
      const number = channel === "conversation" ? 3 : 7;
      gh.deletedComment = false;
      const changed = await f.settled(await f.start({ kind: "github.comment.update", ...identity, channel, number, commentId: 21, body: `Generated ${channel} edit` }));
      assert.equal(changed.operation.status, "completed"); assert.equal(gh.comment.body, `Generated ${channel} edit`);
      const review = await f.preview({ kind: "github.comment.delete", ...identity, channel, number, commentId: 21 });
      assert.ok(review.document.confirmations.some((text) => text.includes(`deleting ${channel} comment 21`)));
      gh.comment.body = "Generated concurrent comment edit";
      const stale = f.command(review); await assert.rejects(() => f.runtime.execute(stale, f.finish(stale)), { code: "github_review" });
      const deleted = await f.settled(await f.start({ kind: "github.comment.delete", ...identity, channel, number, commentId: 21 }));
      assert.equal(deleted.operation.status, "completed"); assert.equal(deleted.result?.resource?.state, "deleted");
      assert.match(deleted.document.resource!.content, /Generated concurrent comment edit/);
    }
    gh.deletedComment = false; gh.comment.issue_url = "https://api.github.com/repos/generated/repo/issues/99";
    await assert.rejects(() => f.preview({ kind: "github.comment.delete", ...identity, channel: "conversation", number: 3, commentId: 21 }), { code: "github_comment" });
    assert.equal(gh.writes.filter((value) => value.method === "DELETE").length, 2);
  } finally { await f.close(); }
});

test("remote edits and account/policy changes invalidate exact previews before GitHub mutation", async () => {
  const gh = new GeneratedGithub(), f = await generated({ gh }), action: GithubAction = { kind: "github.issue.update", repository: "generated/repo", account: gh.login, number: 3, body: "Generated changed" };
  try {
    const review = await f.preview(action), command = f.command(review);
    gh.issue.body = "Generated concurrent user edit";
    await assert.rejects(() => f.runtime.execute(command, f.finish(command)), { code: "github_review" }); assert.equal(gh.writes.length, 0);
    const fresh = await f.preview(action), value = f.command(fresh);
    let reads = 0; gh.before = (path, method) => { if (method === "GET" && path.endsWith("/issues/3") && ++reads === 3) gh.issue.body = "Generated last-moment edit"; };
    const operation = await f.settled((await f.runtime.execute(value, f.finish(value))).id!);
    assert.equal(operation.operation.status, "failed"); assert.equal(operation.operation.dispatched, false); assert.equal(gh.writes.length, 0);
  } finally { await f.close(); }
});

test("PR merge sends the exact captured head SHA and preserves truthful partial outcomes after lost responses", async () => {
  const gh = new GeneratedGithub(), f = await generated({ gh });
  try {
    const action: GithubAction = { kind: "github.pr.merge", repository: "generated/repo", account: gh.login, number: 7, method: "squash" };
    const review = await f.preview(action), value = f.command(review), merged = await f.settled((await f.runtime.execute(value, f.finish(value))).id!);
    assert.equal(merged.operation.status, "completed"); assert.equal(gh.writes[0]?.fields.sha, A); assert.equal(gh.writes[0]?.fields.merge_method, "squash");
    await assert.rejects(() => f.preview(action), { code: "github_pr" });
    gh.pull.merged = false; gh.pull.state = "open"; gh.pull.merge_commit_sha = null; gh.loseResponse = true;
    const partial = await f.settled(await f.start(action)); assert.equal(partial.operation.status, "partial"); assert.equal(gh.pull.merged, true);
    assert.equal(gh.writes.length, 2); assert.match(partial.operation.diagnostic!, /No rebase abort, rollback, input replay/);
  } finally { await f.close(); }
});

test("an observed remote acknowledgement survives failed final verification as independently retained partial evidence", async () => {
  const gh = new GeneratedGithub(), f = await generated({ gh });
  try {
    gh.before = (path, method) => { if (gh.writes.length && path === "user" && method === "GET") throw new MoguriError("program_failed", "Generated final verification HTTP 503"); };
    const result = await f.settled(await f.start({ kind: "github.issue.comment", repository: "generated/repo", account: gh.login, number: 3, body: "Generated acknowledged but not finally verified comment" }));
    assert.equal(result.operation.status, "partial"); assert.ok(result.operation.resultDigest);
    assert.equal(result.result?.outcome, "partial"); assert.equal(result.result?.resource?.body, "Generated acknowledged but not finally verified comment");
    assert.match(result.result!.diagnostic!, /original pre-effect review/);
    f.store.commit([], undefined, { projects: [f.scope.projectId] });
    assert.match(f.store.blob(result.operation.resultDigest), /acknowledged but not finally verified/);
    assert.equal(gh.writes.length, 1);
  } finally { await f.close(); }
});

test("release creation/update/publication bind the reviewed tag and target and reject mismatched pre-existing tags", async () => {
  const gh = new GeneratedGithub(), f = await generated({ gh }), identity = { repository: "generated/repo", account: gh.login };
  try {
    const created = await f.settled(await f.start({ kind: "github.release.create", ...identity, tag: "v1", target: A, name: "Generated release", body: "Generated release body", draft: true, prerelease: false }));
    assert.equal(created.operation.status, "completed"); assert.equal(gh.writes[0]?.fields.target_commitish, A);
    const published = await f.settled(await f.start({ kind: "github.release.publish", ...identity, releaseId: 11 }));
    assert.equal(published.operation.status, "completed"); assert.equal(gh.tag, A); assert.equal(gh.release.draft, false);
    const updated = await f.settled(await f.start({ kind: "github.release.update", ...identity, releaseId: 11, tag: "v1", target: A, name: "Generated changed release", body: "", draft: false, prerelease: true }));
    assert.equal(updated.operation.status, "completed"); assert.equal(gh.release.body, "");
    gh.tag = B; await assert.rejects(() => f.preview({ kind: "github.release.create", ...identity, tag: "v1", target: A, name: "Generated", body: "", draft: false, prerelease: false }), { code: "github_tag" });
  } finally { await f.close(); }
});

test("CI distinguishes no-checks, pending deadline, failure and success at one exact head without inventing clearance", async () => {
  let clock = Date.now(); const gh = new GeneratedGithub(), f = await generated({ gh, now: () => clock, wait: async (ms) => { clock += ms; } });
  try {
    const action: GithubAction = { kind: "github.ci.watch", repository: "generated/repo", account: gh.login, headSha: A, timeoutMs: 100, pollMs: 50 };
    let result = await f.settled(await f.start(action)); assert.equal(result.result?.ci?.state, "no-checks"); assert.equal(result.result?.ci?.deadlineReached, true);
    gh.checks = [{ id: 1, name: "Generated CI", head_sha: A, status: "in_progress", conclusion: null }];
    result = await f.settled(await f.start(action)); assert.equal(result.result?.ci?.state, "pending"); assert.equal(result.operation.status, "completed");
    gh.checks = [{ id: 1, name: "Generated CI", head_sha: A, status: "completed", conclusion: "failure" }];
    result = await f.settled(await f.start(action)); assert.equal(result.result?.ci?.state, "failure");
    gh.checks = [{ id: 1, name: "Generated CI", head_sha: A, status: "completed", conclusion: "success" }];
    result = await f.settled(await f.start(action)); assert.equal(result.result?.ci?.state, "success");
    gh.runs = [{ id: 44, name: "Generated run", head_sha: B, status: "completed", conclusion: "success" }];
    result = await f.settled(await f.start(action)); assert.equal(result.operation.status, "failed"); assert.equal(result.result, null);
    assert.equal(gh.writes.length, 0); assert.equal(githubCiState([]), "no-checks");
  } finally { await f.close(); }
});

test("CI's bounded deadline cancels an actual in-flight generated read and never labels missing observations successful", async () => {
  const gh = new GeneratedGithub(), f = await generated({ gh, runProgram: async (executable, args, options) => {
    if (executable === "gh") {
      if (args.some((value) => value.includes("/check-runs?"))) await new Promise<void>((_resolve, reject) => {
        const abort = () => reject(options.signal.reason); options.signal.addEventListener("abort", abort, { once: true }); if (options.signal.aborted) abort();
      });
      return gh.handle(args);
    }
    return runProgram(executable, args, { ...options, env: { ...options.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  } });
  try {
    const begin = Date.now(), result = await f.settled(await f.start({ kind: "github.ci.watch", repository: "generated/repo", account: gh.login, headSha: A, timeoutMs: 100, pollMs: 50 }));
    assert.equal(result.operation.status, "completed"); assert.equal(result.result?.ci?.deadlineReached, true);
    assert.equal(result.result?.ci?.state, "no-checks"); assert.ok(Date.now() - begin < 5000); assert.equal(gh.writes.length, 0);
  } finally { await f.close(); }
});

test("CI cancellation is acknowledged, root leases serialize clients, and duplicate/lost receipts never replay writes", async () => {
  let entered!: () => void; const waiting = new Promise<void>((resolve) => { entered = resolve; });
  const gh = new GeneratedGithub(), f = await generated({ gh, wait: async (_ms, signal) => {
    entered(); await new Promise<void>((_resolve, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
  } });
  try {
    const action: GithubAction = { kind: "github.ci.watch", repository: "generated/repo", account: gh.login, headSha: A, timeoutMs: 1000, pollMs: 50 };
    const id = await f.start(action); await waiting;
    assert.ok((await f.preview({ kind: "git.push", remote: "origin", branch: "main", forceWithLease: false })).digest);
    const job = f.state().githubOperations.find((value) => value.id === id)!.jobId;
    f.jobs.get(job)!.abort.abort(); const stopped = await f.settled(id);
    assert.equal(stopped.operation.status, "cancelled"); assert.equal(stopped.operation.cancelRequested, true);
    const review = await f.preview({ kind: "github.issue.comment", repository: "generated/repo", account: gh.login, number: 3, body: "Generated exactly once comment" });
    const command = f.command(review), finish = f.finish(command), first = await f.runtime.execute(command, finish); await f.settled(first.id!);
    assert.deepEqual(await f.runtime.execute(command, finish), first); assert.equal(gh.writes.length, 1);
    f.store.db.prepare("DELETE FROM receipts WHERE profile_id=? AND id=?").run("default", finish.intent!.id);
    await assert.rejects(() => f.runtime.execute(command, finish), { code: "github_no_replay" }); assert.equal(gh.writes.length, 1);
  } finally { await f.close(); }
});

test("only an active Git writer leases its exact root across clients, and explicit gh invalidation never switches accounts", async () => {
  const gh = new GeneratedGithub();
  let entered!: () => void, release!: () => void, blockPush = true;
  const writing = new Promise<void>((resolve) => { entered = resolve; }), released = new Promise<void>((resolve) => { release = resolve; });
  const f = await generated({ gh, runProgram: async (executable, args, options) => {
    if (executable === "gh") return gh.handle(args);
    if (blockPush && args.includes("push")) { entered(); await released; options.signal.throwIfAborted(); }
    return runProgram(executable, args, { ...options, env: { ...options.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  } });
  try {
    const review = await f.preview({ kind: "github.issue.comment", repository: "generated/repo", account: gh.login, number: 3, body: "Generated credential epoch input" });
    f.runtime.invalidateGhCredentials();
    const stale = f.command(review); await assert.rejects(() => f.runtime.execute(stale, f.finish(stale)), { code: "github_review" });
    assert.equal(gh.login, "generated-user"); assert.equal(gh.writes.length, 0);
    const id = await f.start({ kind: "git.push", remote: "origin", branch: "main", forceWithLease: false }); await writing;
    await assert.rejects(() => f.preview({ kind: "git.tag.create", tag: "generated-busy", target: f.git(["rev-parse", "HEAD"]), annotated: false, message: "" }), { code: "workspace_busy" });
    blockPush = false; release(); assert.equal((await f.settled(id)).operation.status, "completed");
  } finally { release(); await f.close(); }
});

test("concurrent identical canonical commands produce one remote effect, and provider diagnostics cannot retain secrets", async () => {
  const gh = new GeneratedGithub(), f = await generated({ gh });
  try {
    const review = await f.preview({ kind: "github.issue.comment", repository: "generated/repo", account: gh.login, number: 3, body: "Generated concurrent exactly-once intent" });
    const command = f.command(review), finish = f.finish(command), [left, right] = await Promise.all([f.runtime.execute(command, finish), f.runtime.execute(command, finish)]);
    assert.equal(left.id, right.id); await f.settled(left.id!); assert.equal(gh.writes.length, 1);
    const secret = "ghp_GENERATED_NEVER_RETAIN_THIS_SECRET_123456789";
    gh.before = (path, method) => { if (path.endsWith("/issues/3") && method === "PATCH") throw new MoguriError("program_failed", `Generated unsafe provider diagnostic ${secret} (HTTP 422)`); };
    const failed = await f.settled(await f.start({ kind: "github.issue.update", repository: "generated/repo", account: gh.login, number: 3, title: "Generated rejected change" }));
    assert.equal(failed.operation.status, "partial"); assert.match(failed.operation.diagnostic!, /HTTP 422/);
    assert.equal(JSON.stringify(f.store.events()).includes(secret), false); assert.equal(JSON.stringify(failed).includes(secret), false);
  } finally { await f.close(); }
});

test("restart terminalizes dispatched and undispatched original jobs without replay or inferred Git cleanup", async () => {
  const gh = new GeneratedGithub(), f = await generated({ gh });
  try {
    const completed = await f.settled(await f.start({ kind: "github.issue.comment", repository: "generated/repo", account: gh.login, number: 3, body: "Generated original" }));
    const before = gh.writes.length;
    for (const dispatched of [false, true]) {
      const id = randomUUID(), jobId = randomUUID(), now = new Date().toISOString();
      const initial: GithubOperation = { ...completed.operation, id, commandId: randomUUID(), jobId, status: "running", revision: 0,
        dispatched: false, cancelRequested: false, resultDigest: null, createdAt: now, updatedAt: now, diagnostic: null };
      f.append([{ event_type: "github.operation_recorded", profile_id: "default", project_id: f.scope.projectId, payload: { operation: initial } },
        { event_type: "job.started", profile_id: "default", project_id: f.scope.projectId, payload: { job: { id: jobId, operationId: id, kind: initial.kind,
          projectId: f.scope.projectId, sessionId: null, workspaceId: null, parentTurnId: null, status: "running", resultDigest: null, error: null, progress: "Generated original undispatched intent" } } }]);
      if (dispatched) f.append([{ event_type: "github.operation_recorded", profile_id: "default", project_id: f.scope.projectId, payload: { operation: { ...initial, revision: 1, dispatched: true } } }]);
      new GitHubWorkflows(f.store, f.host).recover();
      const recovered = f.state().githubOperations.find((value) => value.id === id)!;
      assert.equal(recovered.status, dispatched ? "partial" : "cancelled");
      assert.equal(f.state().jobs.find((value) => value.id === jobId)?.status, recovered.status);
    }
    assert.equal(gh.writes.length, before);
  } finally { await f.close(); }
});

test("schema40 upgrades to the current schema without deleting existing generated project state", async () => {
  const f = await generated({ persistent: true });
  try {
    f.store.db.exec("BEGIN IMMEDIATE; DELETE FROM retention_metadata WHERE id IN ('task_progress_schema','document_attachment_schema'); PRAGMA user_version=40; COMMIT;");
    const reopened = new EventStore(f.storePath, f.key);
    try {
      assert.equal(Number(reopened.db.prepare("PRAGMA user_version").get()?.user_version), PROTOCOL_VERSION);
      assert.equal(projectEvents(reopened.events()).projects[0]?.id, f.scope.projectId);
    } finally { reopened.close(); }
  } finally { await f.close(); }
});

test("schema41 retention/projection survives source deletion, immutable ownership and restart without remote replay", async () => {
  const gh = new GeneratedGithub(), f = await generated({ gh, persistent: true });
  try {
    const id = await f.start({ kind: "github.issue.comment", repository: "generated/repo", account: gh.login, number: 3, body: "Generated independently retained comment" });
    const result = await f.settled(id), before = gh.writes.length;
    assert.throws(() => projectGithubOperation(result.operation, { ...result.operation, revision: result.operation.revision + 1, status: "running", commandId: "different" }), { code: "github_corrupt" });
    f.store.commit([{ event_type: "project.removed", profile_id: "default", payload: { deletedProjectId: f.scope.projectId, usage: [] } }], undefined, { projects: [f.scope.projectId] });
    const events = f.store.events(), projected = projectEvents(events);
    assert.equal(projected.githubOperations.find((value) => value.id === id)?.status, "completed");
    assert.equal(events.find((event) => event.event_type === "github.operation_recorded")?.artifact_id, id);
    const retained = f.store.db.prepare("SELECT project_id,session_id FROM retention_keys WHERE scope=?").get(`profile/default/artifact/${id}`);
    assert.equal(retained?.project_id, null); assert.equal(retained?.session_id, null);
    assert.match(f.store.blob(result.operation.inputDigest), /independently retained/);
    assert.equal(JSON.parse(f.store.blob(result.operation.reviewDigest)).action.body, "Generated independently retained comment");
    const reopened = new EventStore(f.storePath, f.key);
    try {
      assert.equal(Number(reopened.db.prepare("PRAGMA user_version").get()?.user_version), PROTOCOL_VERSION);
      assert.equal(projectEvents(reopened.events()).githubOperations[0]?.id, id);
      assert.match(reopened.blob(result.operation.resultDigest!), /Generated independently retained comment/);
    } finally { reopened.close(); }
    new GitHubWorkflows(f.store, f.host).recover(); assert.equal(gh.writes.length, before);
  } finally { await f.close(); }
});
