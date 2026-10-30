import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

export async function qualifyKanbanObservation({ packageRoot, directory }) {
  const root = resolve(packageRoot), source = join(directory, "checkout"), stateDir = join(directory, "state"), started = performance.now();
  await mkdir(source, { recursive: true, mode: 0o700 });
  const checkout = await realpath(source);
  const { createRuntime } = await import(pathToFileURL(join(root, "dist/sdk/node.mjs")).href);
  const { MoguriSdk } = await import(pathToFileURL(join(root, "dist/sdk/index.mjs")).href);
  const git = (args) => promisify(execFile)("git", ["--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", ...args],
    { cwd: checkout, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  await git(["init", "--initial-branch=main"]);
  await writeFile(join(checkout, "generated.txt"), "Generated packed Kanban fixture.\n");
  await git(["add", "--", "generated.txt"]);
  await git(["-c", "user.name=Generated fixture", "-c", "user.email=fixture@example.invalid", "commit", "--no-gpg-sign", "-m", "Generated board base"]);
  await git(["remote", "add", "origin", "git@github.com:generated-owner/fixture.git"]);
  let accountId = 42, closed = false, runtime, sdk;
  const reads = [], calls = [];
  const repository = { id: 41, name: "fixture", full_name: "generated-owner/fixture", html_url: "https://github.com/generated-owner/fixture",
    owner: { login: "generated-owner", type: "User" }, private: true, visibility: "private", license: { spdx_id: "MIT" }, default_branch: "main" };
  const provider = { state: { status: "disconnected", models: [], login: null, diagnostic: null }, onChange() {},
    async refresh() {}, async logout() {}, async cancel() {},
    login() { throw new Error("Generated Kanban qualification forbids personal login."); },
    async prepare() { throw new Error("Generated Kanban qualification forbids inference."); } };
  const options = { stateDir, retentionKey: Buffer.alloc(32, 0x62), provider, platform: {
    github: { runProgram: async (executable, args, request) => {
      if (executable === "git") return (await promisify(execFile)(executable, args, { cwd: request.cwd, signal: request.signal,
        timeout: request.timeoutMs, maxBuffer: request.maxBytes, env: { ...process.env, ...request.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } })).stdout;
      assert.equal(executable, "gh"); assert.equal(args[args.indexOf("--method") + 1], "GET");
      const endpoint = args[args.indexOf("--method") + 2]; calls.push(endpoint);
      assert.ok(["user", "repos/generated-owner/fixture"].includes(endpoint));
      return `HTTP/2.0 200 OK\r\n\r\n${JSON.stringify(endpoint === "user" ? { login: "generated-owner", id: accountId } : repository)}`;
    } },
    integrations: { githubGraphqlRead: async (query, _variables, requestedRoot, signal) => {
      signal.throwIfAborted(); assert.equal(requestedRoot, checkout); assert.match(query, /^query MoguriKanban/); assert.doesNotMatch(query, /\bmutation\b/);
      reads.push(query);
      const issue = { id: "I_generated_7", databaseId: 107, number: 7, title: "Generated packed card", body: "Generated immutable source.",
        url: `${repository.html_url}/issues/7`, state: closed ? "CLOSED" : "OPEN", stateReason: closed ? "COMPLETED" : null,
        updatedAt: "2026-01-02T00:00:00Z", repository: { nameWithOwner: repository.full_name },
        closedByPullRequestsReferences: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } };
      const cards = Object.fromEntries([...query.matchAll(/card(\d+):\s*issue\(number:\s*7\)/g)].map((match) => [`card${match[1]}`, issue]));
      return { data: { viewer: { login: "generated-owner", databaseId: accountId }, repository: { databaseId: 41,
        nameWithOwner: repository.full_name, url: repository.html_url, ...cards,
        ...(query.includes("issues(") ? { issues: { nodes: closed ? [] : [issue], pageInfo: { hasNextPage: false, endCursor: null } } } : {}) } } };
    } },
  } };
  try {
    runtime = await createRuntime(options); sdk = await new MoguriSdk(runtime.connection).ready();
    const project = await sdk.projects.add(checkout), board = (await sdk.issues.board(project.id)).board;
    await sdk.issues.configure(project.id, { ...board, autoRefreshPrs: true, githubAccess: "gh-cli",
      githubSync: { importIssues: true, phases: { backlog: "backlog", inProgress: "in-progress", review: "review", done: "done" } } }, board.revision);
    const refresh = async () => sdk.jobs.wait((await sdk.issues.refresh(project.id)).id);
    assert.equal((await refresh()).status, "completed");
    const original = await sdk.issues.board(project.id), configuration = (await sdk.projects.configuration(project.id)).configuration;
    await sdk.projects.organize(project.id, { color: "#3b82f6", folderId: configuration.folderId, order: configuration.order }, configuration.revision);
    const settings = sdk.settings.get();
    await sdk.settings.update({ ...settings.values, permissions: { ...settings.values.permissions, tools: [...settings.values.permissions.tools,
      { id: "generated-packed-read-policy", tool: "read_file", pathPrefix: "", decision: "ask" }] } }, settings.revision);
    closed = true; assert.equal((await refresh()).status, "completed");
    const updated = await sdk.issues.board(project.id);
    assert.equal(updated.issues[0].phaseId, "done"); assert.equal(updated.issues[0].id, original.issues[0].id);
    assert.deepEqual(updated.board.githubSource, original.board.githubSource);
    assert.equal(updated.issues[0].github.sourceDigest, original.issues[0].github.sourceDigest);
    const previousReads = reads.length, previousRepositoryReads = calls.filter((path) => path.startsWith("repos/")).length;
    accountId = 99; const failed = await refresh(); assert.equal(failed.status, "failed");
    assert.equal(reads.length, previousReads); assert.equal(calls.filter((path) => path.startsWith("repos/")).length, previousRepositoryReads);
    accountId = 42; sdk.disconnect(); await runtime.close(); runtime = await createRuntime(options); sdk = await new MoguriSdk(runtime.connection).ready();
    assert.equal((await refresh()).status, "completed");
    const reopened = await sdk.issues.board(project.id);
    assert.deepEqual(reopened.board.githubSource, original.board.githubSource); assert.equal(reopened.issues.length, 1);
    assert.equal(sdk.getState().snapshot.jobs.find((job) => job.id === failed.id).status, "failed");
    assert.equal((await sdk.budgets.calls()).calls.length, 0);
    return { status: "PASS", primitive: "Installed SDK/CLI-shared Kanban observation preserves original source across presentation/policy updates and restart, rejects foreign accounts and never rewrites failed jobs",
      ms: performance.now() - started, modelCalls: 0, githubWrites: 0, accountBoundary: "generated captured controller account only" };
  } finally { sdk?.disconnect(); await runtime?.close(); }
}
