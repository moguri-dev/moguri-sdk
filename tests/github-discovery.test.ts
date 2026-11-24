import assert from "node:assert/strict";
import test from "node:test";
import { githubApplicationFixture, githubServiceFixture } from "./github-workflows-fixture.ts";
import { runProgram } from "../apps/service/src/program.ts";
import { cp, rename } from "node:fs/promises";

const repository = (id: number, owner: string, type = "User", visibility = "private") => ({
  id, name: "fixture", full_name: `${owner}/fixture`, owner: { login: owner, type },
  description: "Generated repository", visibility, private: visibility !== "public",
  html_url: `https://github.com/${owner}/fixture`, ssh_url: `git@github.com:${owner}/fixture.git`,
  clone_url: `https://github.com/${owner}/fixture.git`, default_branch: "main",
  temp_clone_token: "generated-not-a-personal-credential",
});

test("project-specific issue and PR session starts bind the reviewed complete source and never change checkout or start a model", async () => {
  const fixture = await githubApplicationFixture();
  try {
    const project = await fixture.sdk.github.project(fixture.scope);
    assert.equal(project.repository, "generated-owner/fixture");
    assert.equal(project.branch, "generated-feature");
    assert.equal(project.defaultBranch, "main");
    const source = { kind: "issue" as const, repository: project.repository, account: project.account, number: 7 };
    const reviewed = await fixture.sdk.github.source(fixture.scope, source);
    const started = await fixture.sdk.github.startSession(fixture.scope, source, reviewed.digest);
    await fixture.sdk.refresh();
    const session = fixture.sdk.getState().snapshot!.sessions.find((session) => session.id === started.id)!;
    assert.equal(session.workItemUrl, reviewed.item.url);
    assert.equal(session.githubSource?.accountId, "generated-owner:42");
    assert.equal(session.githubSource?.digest, reviewed.digest);
    assert.equal(session.githubSource?.binding.root.root, fixture.root);
    assert.ok(session.draft.text.includes(reviewed.item.body));
    assert.equal(session.turnId, null);
    assert.equal(fixture.git(["branch", "--show-current"]), "generated-feature");
    assert.deepEqual(fixture.writes(), { issues: 0, pulls: 0 });
    fixture.changeSource();
    await assert.rejects(() => fixture.sdk.github.startSession(fixture.scope, source, reviewed.digest), { code: "github_source_stale" });
    await assert.rejects(() => fixture.sdk.github.source(fixture.scope, { ...source, repository: "generated-other/fixture" }), { code: "github_source" });
    await fixture.sdk.sessions.organize(session.id, { workItemUrl: null });
    assert.equal(fixture.sdk.getState().snapshot!.sessions.find((entry) => entry.id === session.id)?.githubSource, undefined);
  } finally { await fixture.close(); }
});

test("a merged pull request reads as merged in lists and exact source reviews instead of failing the identity check", async () => {
  const fixture = await githubApplicationFixture();
  try {
    const project = await fixture.sdk.github.project(fixture.scope);
    fixture.addPull(12); fixture.mergePull(12);
    const listed = await fixture.sdk.github.browse(fixture.scope, { resource: "pulls", repository: project.repository, account: project.account, page: 1, perPage: 30 });
    assert.deepEqual(listed.items.map((item) => [item.number, item.state]), [[11, "open"], [12, "merged"]]);
    await fixture.sdk.github.browse(fixture.scope, { resource: "pulls", repository: project.repository, account: project.account, state: "open", page: 1, perPage: 30 });
    assert.ok(fixture.calls.some((call) => call.path.startsWith("repos/generated-owner/fixture/pulls?state=open&")));
    const source = { kind: "pull" as const, repository: project.repository, account: project.account, number: 12 };
    const reviewed = await fixture.sdk.github.source(fixture.scope, source);
    assert.equal(reviewed.item.state, "merged");
    assert.equal(reviewed.item.headBranch, "exists", "a merged same-repository PR reports its live head branch");
    assert.equal((await fixture.sdk.github.source(fixture.scope, { ...source, number: 11 })).item.headBranch, undefined, "open PRs read no head-branch state");
    fixture.deleteBranch(reviewed.item.head!);
    const deleted = await fixture.sdk.github.source(fixture.scope, source);
    assert.equal(deleted.item.headBranch, "deleted", "an auto-deleted branch is reported, so the PR view hides Delete branch");
    assert.equal(deleted.digest, reviewed.digest, "the live branch state never stales the reviewed source");
    const started = await fixture.sdk.github.startSession(fixture.scope, source, reviewed.digest);
    await fixture.sdk.refresh();
    assert.equal(fixture.sdk.getState().snapshot!.sessions.find((session) => session.id === started.id)?.prUrl, reviewed.item.url);
  } finally { await fixture.close(); }
});

test("a reviewed source digest cannot start a session after the same path is replaced by another actual Git root", async () => {
  const fixture = await githubApplicationFixture();
  try {
    const project = await fixture.sdk.github.project(fixture.scope), source = { kind: "issue" as const, repository: project.repository, account: project.account, number: 7 };
    const reviewed = await fixture.sdk.github.source(fixture.scope, source);
    await rename(fixture.root, `${fixture.root}-original`);
    await cp(`${fixture.root}-original`, fixture.root, { recursive: true });
    await assert.rejects(() => fixture.sdk.github.startSession(fixture.scope, source, reviewed.digest), /changed|binding|identity|root/i);
    assert.equal(fixture.service.controller.snapshot().sessions.length, 1);
    assert.deepEqual(fixture.writes(), { issues: 0, pulls: 0 });
  } finally { await fixture.close(); }
});
test("repository discovery prioritizes the signed-in user and organizations and exposes explicit pagination without credentials", async () => {
  const calls: string[] = [];
  let accountId = 42;
  const fixture = await githubServiceFixture({ runProgram: async (executable, args, options) => {
    if (executable !== "gh") return runProgram(executable, args, options);
    const endpoint = args[args.indexOf("--method") + 2]!;
    calls.push(endpoint);
    const data = endpoint === "user" ? { id: accountId, login: "generated-owner" } :
      endpoint.startsWith("user/repos?") ? [repository(1, "generated-other"), repository(2, "generated-org", "Organization"), repository(3, "generated-owner")] :
      { items: [repository(4, "generated-public", "User", "public")], incomplete_results: false };
    return `HTTP/2.0 200 OK\r\n${endpoint.startsWith("user/repos?") ? 'Link: <https://api.github.com/user/repos?page=2>; rel="next"\r\n' : ""}\r\n${JSON.stringify(data)}`;
  } });
  try {
    const value = await fixture.sdk.github.repositories();
    assert.equal(value.account, "generated-owner");
    assert.deepEqual(value.repositories.map((entry) => entry.relationship), ["owner", "organization", "accessible"]);
    assert.equal(value.nextPage, 2);
    assert.equal(JSON.stringify(value.repositories).includes("generated-not-a-personal-credential"), false);
    accountId = 43;
    await assert.rejects(() => fixture.sdk.github.repositories({ page: 2, account: value.account, accountId: value.accountId }), { code: "github_account" });
    assert.equal(calls.filter((endpoint) => endpoint.startsWith("user/repos?")).length, 1);
    accountId = 42;
    const publicPage = await fixture.sdk.github.repositories({ source: "public", query: "generated" });
    assert.equal(publicPage.repositories[0]?.relationship, "public");
    assert.ok(calls.some((endpoint) => endpoint.startsWith("search/repositories?")));
  } finally { await fixture.close(); }
});

test("an original numeric account change is refused before reading private repository/item metadata", async () => {
  const fixture = await githubApplicationFixture();
  try {
    const project = await fixture.sdk.github.project(fixture.scope);
    const source = { kind: "issue" as const, repository: project.repository, account: project.account, accountId: project.accountId, number: 7 };
    const preview = await fixture.sdk.github.source(fixture.scope, source);
    const count = fixture.calls.length; fixture.changeAccount(43);
    await assert.rejects(() => fixture.sdk.github.startSession(fixture.scope, source, preview.digest), { code: "github_source" });
    assert.deepEqual(fixture.calls.slice(count), [{ method: "GET", path: "user" }]);
    assert.equal(fixture.service.controller.snapshot().sessions.length, 1);
    assert.deepEqual(fixture.writes(), { issues: 0, pulls: 0 });
  } finally { await fixture.close(); }
});
