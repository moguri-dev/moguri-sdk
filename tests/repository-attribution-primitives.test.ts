import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { EventStore } from "../apps/service/src/store.ts";
import { readWorkspaceGit } from "../apps/service/src/project-git.ts";
import { generatedGit as git, generatedRepository } from "./fixtures/git.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";
import { observedRepository, lookupRepository, type RepositoryReadBinding } from "./fixtures/repository-attribution-prototype.ts";

const repository = "https://github.com/generated/example";
const response = (changes: Record<string, unknown> = {}) => ({
  id: 42, name: "example", full_name: "generated/example", html_url: repository,
  owner: { login: "generated", type: "Organization" }, private: false, visibility: "public", license: { spdx_id: "MIT" },
  description: "GENERATED_PRIVATE_SENTINEL", clone_url: "https://generated-credential@github.com/generated/example.git", ...changes,
});
const binding = (): RepositoryReadBinding => ({ digest: "a".repeat(64), repository });
test("observed repository metadata has exact response identity, real owner kind, visibility and independently sourced OSI evidence", () => {
  const result = observedRepository(repository, response());
  assert.equal(result.fullName, "generated/example"); assert.equal(result.ownerKind, "organization"); assert.equal(result.visibility, "public");
  assert.equal(result.licenseId, "MIT"); assert.equal(result.osiApproved, true); assert.equal(result.publicOsiLicensed, true);
  assert.equal(result.licenseData, "spdx-license-list@6.12.0"); assert.equal(JSON.stringify(result).includes("GENERATED_PRIVATE_SENTINEL"), false);
  assert.equal(JSON.stringify(result).includes("generated-credential"), false);
  const user = observedRepository(repository, response({ owner: { login: "generated", type: "User" } }));
  assert.equal(user.ownerKind, "user");
  const privateRepo = observedRepository(repository, response({ private: true, visibility: "private" }));
  assert.equal(privateRepo.visibility, "private"); assert.equal(privateRepo.publicOsiLicensed, false);
  assert.equal(observedRepository(repository, response({ visibility: "internal", private: true })).visibility, "internal");
  assert.equal(observedRepository(repository, response({ license: null })).publicOsiLicensed, null);
  assert.equal(observedRepository(repository, response({ license: { spdx_id: "NOASSERTION" } })).osiApproved, null);
  assert.equal(observedRepository(repository, response({ license: { spdx_id: "BUSL-1.1" } })).osiApproved, false);
});

test("repository owner/name/URL/visibility disagreement is rejected rather than silently becoming another repository", () => {
  for (const changes of [
    { full_name: "generated/other" }, { name: "other" }, { owner: { login: "different", type: "Organization" } },
    { html_url: "https://github.com/generated/other" }, { private: true, visibility: "public" }, { visibility: "unverified" },
    { id: Number.MAX_SAFE_INTEGER + 1 }, { id: 0 }, { license: { spdx_id: "__proto__" } },
  ]) assert.throws(() => observedRepository(repository, response(changes)), /repository|license/i);
  for (const url of ["https://generated-secret@github.com/generated/example", "https://github.com/generated/example?token=generated-secret", "https://example.invalid/generated/example", "http://github.com/generated/example"]) {
    assert.throws(() => observedRepository(url, response()), /repository/i);
  }
});

test("public lookup is bounded, credential-free, redirect-denying and cannot persist a late result after root/policy change or cancellation", { timeout: 10_000 }, async () => {
  let current = binding(), calls = 0;
  let release = () => {}, held = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const pending = lookupRepository(async () => current, async (url, init) => {
    calls++; assert.equal(url, "https://api.github.com/repos/generated/example");
    assert.equal(new Headers(init?.headers).has("Authorization"), false); assert.equal(init?.redirect, "error");
    held = true; await gate; return Response.json(response());
  }, AbortSignal.timeout(5000));
  while (!held) await new Promise((resolve) => setTimeout(resolve, 1));
  current = { ...current, digest: "b".repeat(64) }; release();
  await assert.rejects(() => pending, /scope.*changed|changed.*scope/i); assert.equal(calls, 1);
  const abort = new AbortController();
  await assert.rejects(() => lookupRepository(async () => binding(), async () => { abort.abort(new Error("Generated metadata stop")); return Response.json(response()); }, abort.signal), /Generated metadata stop/);
  await assert.rejects(() => lookupRepository(async () => binding(), async () => new Response("Generated denied", { status: 403 }), AbortSignal.timeout(5000)), /HTTP 403/);
  const success = await lookupRepository(async () => binding(), async () => Response.json(response()), AbortSignal.timeout(5000));
  assert.equal(success.bindingDigest, binding().digest); assert.equal(success.repository.publicOsiLicensed, true);
});

test("unsupported credentials/aliases cannot trigger a public metadata lookup, and partial/malformed responses never become success", async () => {
  let calls = 0;
  await assert.rejects(() => lookupRepository(async () => ({ ...binding(), repository: null }), async () => { calls++; return Response.json(response()); }, AbortSignal.timeout(5000)), /repository/i);
  assert.equal(calls, 0);
  await assert.rejects(() => lookupRepository(async () => ({ ...binding(), repository: "https://generated-secret@github.com/generated/example" }), async () => { calls++; return Response.json(response()); }, AbortSignal.timeout(5000)), /repository/i);
  assert.equal(calls, 0);
  await assert.rejects(() => lookupRepository(async () => binding(), async () => Response.json({ ...response(), owner: null }), AbortSignal.timeout(5000)), /repository/i);
  await assert.rejects(() => lookupRepository(async () => binding(), async () => new Response("{", { status: 200 }), AbortSignal.timeout(5000)), /invalid JSON/);
  await assert.rejects(() => lookupRepository(async () => binding(), async () => new Response("x".repeat(2 * 1024 * 1024 + 1)), AbortSignal.timeout(5000)), /bounded size limit/);
});

test("actual safe Git reads bind base and per-worktree origins without running configured hooks or filters", async () => {
  const root = await mkdtemp(join(tmpdir(), "moguri-repository-git-")), project = join(root, "project"), child = join(root, "child");
  try {
    await mkdir(project); await writeFile(join(project, "fixture.txt"), "Generated repository fixture.\n"); await generatedRepository(project);
    await git(project, "remote", "add", "origin", "git@github.com:generated/base.git");
    await git(project, "config", "extensions.worktreeConfig", "true"); await git(project, "worktree", "add", "-b", "generated/metadata", child);
    await git(child, "config", "--worktree", "url.https://github.com/generated/child.git.insteadOf", "git@github.com:generated/base.git");
    assert.equal(await git(child, "remote", "get-url", "origin"), "https://github.com/generated/child.git");
    const marker = join(root, "generated-hook-ran");
    await mkdir(join(project, ".git/hooks"), { recursive: true });
    await writeFile(join(project, ".git/hooks/post-index-change"), `#!/bin/sh\nprintf generated > "${marker}"\n`, { mode: 0o700 });
    await git(project, "config", "filter.generated.clean", `printf generated > "${marker}"`);
    await git(project, "config", "filter.generated.required", "true");
    await writeFile(join(project, ".gitattributes"), "fixture.txt filter=generated\n");
    const start = performance.now(), policy = { upstream: "origin", deniedFolders: [] };
    const base = await readWorkspaceGit(project, policy, false, AbortSignal.timeout(5000)), worktree = await readWorkspaceGit(child, policy, false, AbortSignal.timeout(5000));
    assert.equal(base.repository, "https://github.com/generated/base"); assert.equal(worktree.repository, "https://github.com/generated/child");
    await assert.rejects(() => access(marker), { code: "ENOENT" });
    await git(project, "remote", "set-url", "origin", "https://generated-credential@github.com/generated/base.git");
    assert.equal((await readWorkspaceGit(project, policy, false, AbortSignal.timeout(5000))).repository, null);
    console.log(JSON.stringify({ primitive: "repository-safe-git-bindings", durationMs: performance.now() - start, bindings: 2, network: false }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("sanitized attribution remains separate from forgotten source data and foreign profile metadata", () => {
  const store = new EventStore(":memory:");
  try {
    const metadata = observedRepository(repository, response()), controls = { env: "Local", modelId: null, autonomy: "Manual", budget: { kind: "unlimited" } } as const;
    store.commit([{ event_type: "session.created", profile_id: "default", session_id: "generated-attribution-session", payload: { title: "GENERATED_PRIVATE_SENTINEL", controls } },
      { event_type: "job.progress", profile_id: "default", payload: { jobId: "generated-attribution", progress: JSON.stringify(metadata) } },
      { event_type: "job.progress", profile_id: "generated-beta", payload: { jobId: "generated-foreign", progress: "GENERATED_FOREIGN_METADATA" } }]);
    store.commit([{ event_type: "session.deleted", profile_id: "default", payload: { deletedSessionId: "generated-attribution-session", usage: [] } }], undefined, { sessions: ["generated-attribution-session"] });
    const retained = store.events().find((event) => event.event_type === "job.progress");
    assert.ok(retained?.event_type === "job.progress"); assert.equal(JSON.parse(retained.payload.progress).visibility, "public");
    assert.equal(JSON.stringify(store.events()).includes("GENERATED_PRIVATE_SENTINEL"), false); assert.equal(JSON.stringify(store.events()).includes("GENERATED_FOREIGN_METADATA"), false);
  } finally { store.close(); }
});

test("actual pinned SSH Git metadata names only the remote root, never the different host checkout, with zero model calls", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await remoteFixture();
  try {
    const host = initializeGeneratedRepository(fixture.project), remote = initializeGeneratedRepository(fixture.workspace);
    host(["remote", "add", "origin", "https://github.com/generated/host.git"]); remote(["remote", "add", "origin", "git@github.com:generated/remote.git"]);
    await fixture.probe(); await fixture.select();
    const result = await fixture.controller.platform.managed.query({ type: "session.git", sessionId: fixture.session().id, diff: false });
    assert.equal(result.type, "session.git"); if (result.type !== "session.git") return;
    assert.equal(result.repository, "https://github.com/generated/remote"); assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});
