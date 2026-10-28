import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { generatedGit as git, generatedRepository as repository } from "./fixtures/git.ts";

test("reviewed repository defaults publish only missing files and preserve the checkout, index and unrelated edits", { timeout: 20_000 }, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const remote = join(fixture.directory, "generated-remote.git");
    await repository(fixture.project, remote);
    await writeFile(join(fixture.project, "staged.txt"), "Generated unrelated staged change.\n");
    await git(fixture.project, "add", "staged.txt");
    await writeFile(join(fixture.project, "fixture.txt"), "Generated unrelated unstaged change.\n");
    const head = await git(fixture.project, "rev-parse", "HEAD");
    const index = await git(fixture.project, "diff", "--cached", "--binary");
    const projectId = fixture.session().projectId;
    assert.equal((await sdk.projects.sources(projectId)).instructions, null);
    assert.equal(existsSync(join(fixture.project, "AGENTS.md")), false);
    await assert.rejects(() => sdk.projects.initialize(projectId, "main", 0, true).then((job) => sdk.jobs.wait(job.id!).then((job) => { if (job.status !== "completed") throw new Error(job.error!); })), /non-protected/);
    const job = await sdk.projects.initialize(projectId, "generated/defaults", 0, true);
    assert.equal((await sdk.jobs.wait(job.id!)).status, "completed");
    assert.equal(await git(fixture.project, "rev-parse", "HEAD"), head);
    assert.equal(await git(fixture.project, "branch", "--show-current"), "fixture-base");
    assert.equal(await git(fixture.project, "diff", "--cached", "--binary"), index);
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "Generated unrelated unstaged change.\n");
    const pushed = await git(remote, "rev-parse", "refs/heads/generated/defaults");
    assert.notEqual(pushed, head);
    assert.equal(await git(remote, "diff-tree", "--no-commit-id", "--name-only", "-r", pushed), "AGENTS.md\nmcp.json");
    assert.equal(await git(remote, "show", `${pushed}:staged.txt`).then(() => true, () => false), false);
    assert.equal(await git(remote, "show", `${pushed}:fixture.txt`), "generated original");
    assert.match(await readFile(join(fixture.project, "AGENTS.md"), "utf8"), /untrusted/);
    assert.deepEqual(JSON.parse(await readFile(join(fixture.project, "mcp.json"), "utf8")), { mcpServers: {} });
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("failed defaults pushes report partial effects and require workspace inspection rather than claiming success", { timeout: 20_000 }, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const remote = join(fixture.directory, "generated-remote.git");
    await repository(fixture.project, remote);
    await git(fixture.project, "remote", "set-url", "origin", join(fixture.directory, "missing-generated-remote.git"));
    const job = await sdk.projects.initialize(fixture.session().projectId, "generated/partial-defaults", 0, true);
    const result = await sdk.jobs.wait(job.id!);
    assert.equal(result.status, "partial");
    assert.match(result.error!, /Created: AGENTS.md, mcp.json/);
    assert.match(result.error!, /Push.*may have completed/);
    assert.equal(existsSync(join(fixture.project, "AGENTS.md")), true);
    assert.equal(existsSync(join(fixture.project, "mcp.json")), true);
    assert.ok(sdk.getState().snapshot!.blockedProjects.includes(fixture.session().projectId));
    assert.equal(await git(fixture.project, "branch", "--show-current"), "fixture-base");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("project folder policy binds instructions, native writes, memory and reviewed MCP imports", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const id = fixture.session().projectId;
    await mkdir(join(fixture.project, "private"));
    await mkdir(join(fixture.project, "docs"));
    await writeFile(join(fixture.project, "private", "hidden.ts"), "export const generatedPrivateKnowledge = 42;\n");
    await writeFile(join(fixture.project, "visible.ts"), "export const generatedVisibleKnowledge = 7;\n");
    await writeFile(join(fixture.project, "AGENTS.md"), "GENERATED_REPOSITORY_GUIDANCE");
    let configuration = (await sdk.projects.configuration(id)).configuration;
    await sdk.projects.configure(id, { ...configuration.values, deniedFolders: ["private"], readOnlyFolders: ["fixture.txt", "docs"] }, configuration.revision);
    assert.match((await sdk.prompt.preview(fixture.sessionId)).effective, /GENERATED_REPOSITORY_GUIDANCE/);
    await assert.rejects(() => sdk.plans.save(fixture.sessionId, "Generated forbidden plan.", "absent"), /read-only|denied/);
    assert.equal(existsSync(join(fixture.project, "docs", "plan.md")), false);
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, memory: { ...settings.values.memory, enabled: true } }, settings.revision);
    const indexed = await sdk.memory.index(id);
    assert.equal((await sdk.jobs.wait(indexed.id!)).status, "completed");
    assert.equal((await sdk.memory.search(id, "generatedPrivateKnowledge")).items.some((item) => item.path.startsWith("private/")), false);
    assert.equal((await sdk.memory.graph(id)).nodes.some((item) => item.path.startsWith("private/")), false);
    await fixture.configure(); await fixture.send("generated write");
    await fixture.terminal();
    assert.equal(await readFile(join(fixture.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(fixture.service.controller.events(0).some((event) => event.event_type === "tool.started" && event.payload.call.name === "write_file"), false);
    await writeFile(join(fixture.project, "mcp.json"), JSON.stringify({ mcpServers: { generated: { command: "generated-mcp", env: { INVALID_INLINE_SECRET: "generated-only" } } } }));
    configuration = (await sdk.projects.configuration(id)).configuration;
    const reviewed = (await sdk.projects.sources(id)).mcpDigest!;
    await assert.rejects(() => sdk.projects.importMcp(id, configuration.revision, true, reviewed), /inline credentials/);
    await writeFile(join(fixture.project, "mcp.json"), JSON.stringify({ mcpServers: { generated: { command: "generated-mcp", args: ["--fixture"] } } }));
    await assert.rejects(() => sdk.projects.importMcp(id, configuration.revision, true, reviewed), /changed after review/);
    await sdk.projects.importMcp(id, configuration.revision, true, (await sdk.projects.sources(id)).mcpDigest!);
    configuration = (await sdk.projects.configuration(id)).configuration;
    assert.equal(configuration.values.mcpServers[0]?.enabled, false);
    assert.match(configuration.values.mcpServers[0]!.id, new RegExp(`^p-${id.slice(0, 8)}-`));
    await sdk.projects.configure(id, { ...configuration.values, instructionsPath: "private/hidden.ts" }, configuration.revision);
    await assert.rejects(() => sdk.prompt.preview(fixture.sessionId), /denied/);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("project removal deletes historical project credentials, not shared/global credentials", async () => {
  const values = new Map<string, string>([["generated-global", "generated-shared-value"]]);
  const removed: string[] = [];
  const fixture = await setupFixture({ platform: { vault: {
    read: async (id) => values.get(id) ?? null, write: async (id, value) => { values.set(id, value); }, remove: async (id) => { removed.push(id); values.delete(id); },
  } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const projectId = fixture.session().projectId;
    let configuration = (await sdk.projects.configuration(projectId)).configuration;
    const serverId = `p-${projectId.slice(0, 8)}-generated`;
    await sdk.projects.configure(projectId, { ...configuration.values, mcpServers: [{ id: serverId, name: "Generated", enabled: true, projectIds: [projectId], transport: { type: "http", url: "https://mcp.example.invalid", auth: "bearer" } }] }, configuration.revision);
    await sdk.mcp.setToken(serverId, "generated-project-only-value", fixture.sessionId);
    await assert.rejects(() => sdk.mcp.auth(serverId), /enabled/);
    configuration = (await sdk.projects.configuration(projectId)).configuration;
    await sdk.projects.configure(projectId, { ...configuration.values, mcpServers: [] }, configuration.revision);
    configuration = (await sdk.projects.configuration(projectId)).configuration;
    await sdk.projects.remove(projectId, true, configuration.revision);
    assert.deepEqual(removed, [serverId]);
    assert.equal(values.has(serverId), false);
    assert.equal(values.get("generated-global"), "generated-shared-value");
    assert.equal(JSON.stringify(fixture.service.controller.events(0)).includes("generated-project-only-value"), false);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("project reordering is atomic with exact folder membership and optimistic revisions", async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const second = join(fixture.directory, "second"); const third = join(fixture.directory, "third");
    await mkdir(second); await mkdir(third);
    const b = await sdk.command({ type: "project.add", path: second });
    const c = await sdk.command({ type: "project.add", path: third });
    const ids = [c.id!, b.id!, fixture.session().projectId];
    await sdk.projects.reorder(null, ids.map((projectId) => ({ projectId, revision: 0 })));
    assert.deepEqual([...sdk.getState().snapshot!.projectConfigurations].sort((a, b) => a.order - b.order).map((item) => item.projectId), ids);
    await assert.rejects(() => sdk.projects.reorder(null, ids.map((projectId) => ({ projectId, revision: 0 }))), /Another client/);
    await assert.rejects(() => sdk.projects.reorder(null, [{ projectId: ids[0]!, revision: 1 }]), /exactly/);
    const folder = await sdk.projects.folder("Generated folder");
    const current = (await sdk.projects.configuration(ids[0]!)).configuration;
    await sdk.projects.organize(ids[0]!, { folderId: folder.id!, order: 0, color: "#99aabb" }, current.revision);
    await assert.rejects(() => sdk.projects.reorder(null, ids.map((projectId) => ({ projectId, revision: 1 }))), /exactly/);
    assert.equal((await sdk.projects.configuration(ids[0]!)).configuration.folderId, folder.id);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("optional Porto reads only generated inventory, and plan saves retain digest-checked artifacts", async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const id = fixture.session().projectId;
    const program = join(fixture.directory, "generated-porto");
    await writeFile(program, "#!/bin/sh\nprintf 'GENERATED_PORTO_ARGS=%s\\n' \"$*\"\n", { mode: 0o700 }); await chmod(program, 0o700);
    const configuration = (await sdk.projects.configuration(id)).configuration;
    await assert.rejects(() => sdk.projects.porto(id), /Enable/);
    await sdk.projects.configure(id, { ...configuration.values, porto: { enabled: true, project: "generated", executable: program } }, configuration.revision);
    assert.equal((await sdk.projects.porto(id)).output.trim(), "GENERATED_PORTO_ARGS=list");
    const plan = await sdk.plans.read(fixture.sessionId);
    assert.equal(plan.exists, false);
    const artifact = await sdk.plans.save(fixture.sessionId, "Generated digest-checked plan.", plan.digest);
    await assert.rejects(() => sdk.plans.save(fixture.sessionId, "Generated conflicting plan.", plan.digest), /changed since/);
    assert.equal((await sdk.plans.artifact(artifact.id!)).text, "Generated digest-checked plan.");
    await sdk.sessions.delete(fixture.sessionId, true);
    assert.equal((await sdk.plans.artifact(artifact.id!)).text, "Generated digest-checked plan.");
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("work-item and verified merged-PR sessions never change the checkout and can be unarchived", async () => {
  let reads = 0;
  const fixture = await setupFixture({ platform: { integrations: { fetch: async () => { reads++; return Response.json({ number: 9, html_url: "https://github.com/generated/project/pull/9", state: "closed", draft: false, merged: true, merged_at: "2026-01-01T00:00:00Z" }); } } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await repository(fixture.project, join(fixture.directory, "generated-remote.git"));
    const head = await git(fixture.project, "rev-parse", "HEAD");
    const id = fixture.session().projectId;
    const issue = await sdk.issues.create(id, { title: "Generated work item", body: "Generated context only.", kind: "misc", phaseId: "backlog", pullRequestUrl: null });
    const fromIssue = await sdk.sessions.fromWork(id, { issueId: issue.id! });
    assert.match(sdk.getState().snapshot!.sessions.find((session) => session.id === fromIssue.id)!.draft.text, /Generated context only/);
    const fromPr = await sdk.sessions.fromWork(id, { prUrl: "https://github.com/generated/project/pull/9" });
    assert.equal(reads, 1);
    assert.equal(sdk.getState().snapshot!.sessions.find((session) => session.id === fromPr.id)?.prUrl, "https://github.com/generated/project/pull/9");
    assert.equal(sdk.getState().snapshot!.sessions.find((session) => session.id === fromPr.id)?.prObservation?.pullRequest.state, "merged");
    assert.equal(sdk.getState().snapshot!.sessions.find((session) => session.id === fromPr.id)?.prObservation?.pullRequest.draft, false);
    await sdk.command({ type: "session.archive", sessionId: fromPr.id! });
    await sdk.command({ type: "session.restore", sessionId: fromPr.id! });
    assert.equal(sdk.getState().snapshot!.sessions.find((session) => session.id === fromPr.id)?.status, "idle");
    assert.equal(await git(fixture.project, "rev-parse", "HEAD"), head);
    assert.equal(await git(fixture.project, "branch", "--show-current"), "fixture-base");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});

test("changing an attached folder invalidates its derived index without moving or deleting source", async () => {
  const fixture = await setupFixture();
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    const id = fixture.session().projectId;
    await writeFile(join(fixture.project, "old.ts"), "export const generatedOldFolderKnowledge = 1;");
    const settings = sdk.settings.get()!;
    await sdk.settings.update({ ...settings.values, memory: { ...settings.values.memory, enabled: true } }, settings.revision);
    const job = await sdk.memory.index(id); assert.equal((await sdk.jobs.wait(job.id!)).status, "completed");
    assert.ok((await sdk.memory.search(id, "generatedOldFolderKnowledge")).items.length);
    const target = join(fixture.directory, "relocated-generated-folder"); await mkdir(target);
    await writeFile(join(target, "new.ts"), "export const generatedNewFolderKnowledge = 2;");
    await sdk.projects.relocate(id, target, 0);
    assert.equal(sdk.getState().snapshot!.projects.find((project) => project.id === id)?.path, await realpath(target));
    assert.equal((await sdk.memory.search(id, "generatedOldFolderKnowledge")).items.length, 0);
    assert.equal(existsSync(join(fixture.project, "old.ts")), true);
    assert.equal(existsSync(join(target, "new.ts")), true);
  } finally { sdk.disconnect(); await fixture.close(); }
});
