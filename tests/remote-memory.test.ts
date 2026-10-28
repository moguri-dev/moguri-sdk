import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { remoteMemoryFixture } from "./fixtures/remote-memory-service.ts";
import { waitFor } from "./fixture.ts";

test("session memory cannot reuse a Local index and a provider-free SSH index retains its actual peer/root across search and graph", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const f = await remoteMemoryFixture();
  try {
    await writeFile(join(f.project, "fixture.txt"), "GENERATED_HOST_KNOWLEDGE_ONLY");
    const local = await f.sdk.memory.index(f.session().projectId);
    assert.equal((await f.sdk.jobs.wait(local.id!)).status, "completed");
    await assert.rejects(() => f.sdk.memory.searchSession(f.sessionId, "knowledge"), { code: "memory_missing" });
    await writeFile(join(f.workspace, "knowledge.ts"), "export function generatedRemoteKnowledge() { return 'generated remote knowledge'; }\n");
    const index = await f.sdk.memory.indexSession(f.sessionId);
    assert.equal((await f.sdk.jobs.wait(index.id!)).status, "completed");
    const state = await f.sdk.memory.state(f.sessionId);
    assert.equal(state.index?.binding.env, "Remote"); assert.equal(state.index?.binding.root, f.workspace);
    assert.equal(state.index?.binding.env === "Remote" ? state.index.binding.remote.port : 0, f.ssh.target.port);
    const result = await f.sdk.memory.searchSession(f.sessionId, "generatedRemoteKnowledge");
    assert.ok(result.items.some((hit) => hit.text.includes("generatedRemoteKnowledge") && !hit.stale));
    assert.equal(JSON.stringify(result).includes("GENERATED_HOST_KNOWLEDGE_ONLY"), false);
    const graph = await f.sdk.memory.graphSession(f.sessionId);
    assert.ok(graph.nodes.some((node) => node.label === "generatedRemoteKnowledge"));
    assert.equal(f.session().controls.modelId, null); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("an original Remote index command cannot replay its capture after a missing command receipt", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const f = await remoteMemoryFixture();
  try {
    const command = { type: "memory.index", sessionId: f.sessionId } as const, commandId = randomUUID();
    const first = await f.sdk.command(command, commandId);
    assert.equal((await f.sdk.jobs.wait(first.id!)).status, "completed");
    const before = (await f.sdk.memory.state(f.sessionId)).index;
    f.service.store.db.prepare("DELETE FROM receipts WHERE profile_id='default' AND id=?").run(commandId);
    assert.equal((await f.sdk.command(command, commandId)).id, first.id);
    assert.equal(f.controller.snapshot().jobs.filter((job) => job.kind === "memory.index").length, 1);
    assert.deepEqual((await f.sdk.memory.state(f.sessionId)).index, before); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("opt-in context injection reads Remote knowledge and never substitutes the attached Local source or adds a provider call", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const f = await remoteMemoryFixture({ exposeModels: true });
  try {
    await writeFile(join(f.project, "fixture.txt"), "GENERATED_LOCAL_CONTEXT_FORBIDDEN");
    await writeFile(join(f.workspace, "knowledge.ts"), "export const generatedRemoteInjectedKnowledge = 'generated remote task knowledge';\n");
    const index = await f.sdk.memory.indexSession(f.sessionId); assert.equal((await f.sdk.jobs.wait(index.id!)).status, "completed");
    const settings = structuredClone(f.sdk.settings.get()!.values); settings.memory.useInContext = true;
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision);
    await f.select(); await f.send("Generated remote task knowledge."); await f.terminal();
    assert.equal(f.requests.length, 1);
    const request = JSON.stringify(f.requests[0]); assert.match(request, /untrusted-repository-memory/); assert.match(request, /generatedRemoteInjectedKnowledge/);
    assert.equal(request.includes("GENERATED_LOCAL_CONTEXT_FORBIDDEN"), false);
    assert.equal((await f.sdk.budgets.calls({ sessionId: f.sessionId })).calls[0]?.env, "Remote");
  } finally { await f.close(); }
});

test("the actual Remote solver can request approved memory_search through the same typed source boundary", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const f = await remoteMemoryFixture({ exposeModels: true });
  try {
    await writeFile(join(f.workspace, "knowledge.ts"), "export const generatedDirectMemoryKnowledge = 'generated remote knowledge';\n");
    const index = await f.sdk.memory.indexSession(f.sessionId); assert.equal((await f.sdk.jobs.wait(index.id!)).status, "completed");
    await f.select(); await f.send("generated memory search for the actual remote knowledge."); await f.terminal();
    assert.equal(f.requests.length, 2);
    const tool = f.session().messages.find((message) => message.role === "tool")!;
    assert.match(tool.text, /generatedDirectMemoryKnowledge/); assert.match(tool.text, /"env":"Remote"/);
    assert.equal((await f.sdk.budgets.calls({ sessionId: f.sessionId })).calls.length, 2);
  } finally { await f.close(); }
});

test("changed and newly ignored Remote sources become stale empty hits and cannot remain in the current graph", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const f = await remoteMemoryFixture();
  try {
    await writeFile(join(f.workspace, "knowledge.ts"), "export function generatedStaleKnowledge() { return 'generated remote knowledge'; }\n");
    const index = await f.sdk.memory.indexSession(f.sessionId); assert.equal((await f.sdk.jobs.wait(index.id!)).status, "completed");
    await writeFile(join(f.workspace, ".gitignore"), "knowledge.ts\n");
    const result = await f.sdk.memory.searchSession(f.sessionId, "generatedStaleKnowledge");
    const hit = result.items.find((item) => item.path === "knowledge.ts")!;
    assert.ok(hit.stale); assert.equal(hit.text, "");
    const graph = await f.sdk.memory.graphSession(f.sessionId);
    assert.equal(graph.nodes.some((node) => node.path === "knowledge.ts"), false); assert.ok(graph.stalePaths?.includes("knowledge.ts"));
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("concurrent and cancelled Remote indexes preserve the previous complete cache and a changed env cannot publish held source", { skip: process.platform !== "darwin", timeout: 25_000 }, async (t) => {
  const f = await remoteMemoryFixture();
  let held = false, release = () => {};
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  try {
    const original = await f.sdk.memory.indexSession(f.sessionId); assert.equal((await f.sdk.jobs.wait(original.id!)).status, "completed");
    const before = (await f.sdk.memory.state(f.sessionId)).index!;
    const capture = f.controller.remote.captureMemory.bind(f.controller.remote);
    t.mock.method(f.controller.remote, "captureMemory", async (...args: Parameters<typeof capture>) => {
      const result = await capture(...args); held = true; await barrier; return result;
    });
    const pending = await f.sdk.memory.indexSession(f.sessionId); await waitFor(() => held);
    await assert.rejects(() => f.sdk.memory.indexSession(f.sessionId), { code: "memory_pending" });
    await f.sdk.sessions.env(f.sessionId, "Local"); await f.sdk.jobs.cancel(pending.id!); release();
    assert.notEqual((await f.sdk.jobs.wait(pending.id!)).status, "completed");
    assert.deepEqual(f.controller.platform.memory.cached(before.binding)!.index, before);
    assert.equal(f.requests.length, 0);
  } finally { release(); await f.close(); }
});

test("stop after atomic cache publication is partial and never reports rollback or a successful cancelled index", { skip: process.platform !== "darwin", timeout: 20_000 }, async (t) => {
  const f = await remoteMemoryFixture();
  try {
    const memory = f.controller.platform.memory, publish = memory.publish.bind(memory);
    t.mock.method(memory, "publish", (...args: Parameters<typeof publish>) => {
      publish(...args);
      void f.controller.platform.execute({ type: "job.cancel", jobId: args[0].jobId! }, () => ({}));
    });
    const index = await f.sdk.memory.indexSession(f.sessionId);
    assert.equal((await f.sdk.jobs.wait(index.id!)).status, "partial");
    assert.equal((await f.sdk.memory.state(f.sessionId)).index?.jobId, index.id); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("a replaced SSH directory cannot receive the old cache and explicit reindex atomically replaces only its captured identity", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const f = await remoteMemoryFixture();
  try {
    const first = await f.sdk.memory.indexSession(f.sessionId); assert.equal((await f.sdk.jobs.wait(first.id!)).status, "completed");
    const before = (await f.sdk.memory.state(f.sessionId)).index!;
    await rename(f.workspace, join(f.directory, "generated-old-remote")); await mkdir(f.workspace);
    await writeFile(join(f.workspace, "replacement.ts"), "export const generatedReplacementKnowledge = true;\n");
    await assert.rejects(() => f.sdk.memory.searchSession(f.sessionId, "generated"), { code: "memory_root_changed" });
    const next = await f.sdk.memory.indexSession(f.sessionId); assert.equal((await f.sdk.jobs.wait(next.id!)).status, "completed");
    const after = (await f.sdk.memory.state(f.sessionId)).index!;
    assert.notEqual(after.binding.inode, before.binding.inode);
    assert.ok((await f.sdk.memory.searchSession(f.sessionId, "generatedReplacementKnowledge")).items.some((item) => item.text.includes("generatedReplacementKnowledge")));
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("current denied folders filter old Remote snippets and graph without turning cache metadata into permissions", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const f = await remoteMemoryFixture();
  try {
    await mkdir(join(f.workspace, "restricted")); await writeFile(join(f.workspace, "restricted/knowledge.ts"), "export const generatedNowDeniedKnowledge = true;\n");
    const index = await f.sdk.memory.indexSession(f.sessionId); assert.equal((await f.sdk.jobs.wait(index.id!)).status, "completed");
    const configuration = (await f.sdk.projects.configuration(f.session().projectId)).configuration;
    await f.sdk.projects.configure(configuration.projectId, { ...configuration.values, deniedFolders: ["restricted"] }, configuration.revision);
    assert.equal((await f.sdk.memory.searchSession(f.sessionId, "generatedNowDeniedKnowledge")).items.some((hit) => hit.path.startsWith("restricted/")), false);
    assert.equal((await f.sdk.memory.graphSession(f.sessionId)).nodes.some((node) => node.path.startsWith("restricted/")), false);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("a second private SDK profile cannot reuse the first profile's SSH cache or session, even on the same physical root", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const f = await remoteMemoryFixture();
  try {
    const initial = await f.sdk.memory.indexSession(f.sessionId); assert.equal((await f.sdk.jobs.wait(initial.id!)).status, "completed");
    const created = await f.sdk.profiles.create("Generated memory isolation"); await f.sdk.profiles.wait(created.id!);
    const beta = await f.sdk.profiles.open(created.id!);
    try {
      await assert.rejects(() => beta.memory.state(f.sessionId), /profile|session/i);
      const local = join(f.directory, "generated-beta-local"); await mkdir(local);
      const project = await beta.command({ type: "project.add", path: local }), session = await beta.sessions.create(project.id!);
      const settings = structuredClone(beta.settings.get()!.values); settings.memory.enabled = true; settings.remote = f.ssh.target;
      await beta.settings.update(settings, beta.settings.get()!.revision);
      const config = (await beta.projects.configuration(project.id!)).configuration;
      await beta.projects.configure(project.id!, { ...config.values, remotePath: f.workspace }, config.revision);
      await beta.remote.probe(); await beta.sessions.env(session.id!, "Remote");
      await assert.rejects(() => beta.memory.searchSession(session.id!, "generated"), { code: "memory_missing" });
      const index = await beta.memory.indexSession(session.id!); assert.equal((await beta.jobs.wait(index.id!)).status, "completed");
      assert.equal((await beta.memory.state(session.id!)).index?.binding.profileId, beta.profileId);
      assert.equal((await f.sdk.memory.state(f.sessionId)).index?.binding.profileId, "default");
      await assert.rejects(() => f.sdk.memory.state(session.id!), /profile|session/i);
      assert.equal(f.requests.length, 0);
    } finally { beta.disconnect(); }
  } finally { await f.close(); }
});

test("failed canonical index intent cannot capture source and a failed completed-job receipt leaves published data explicitly partial", { skip: process.platform !== "darwin", timeout: 25_000 }, async (t) => {
  const f = await remoteMemoryFixture();
  try {
    const commandId = randomUUID(), commit = f.service.store.commit.bind(f.service.store);
    const failed = t.mock.method(f.service.store, "commit", (...args: Parameters<typeof commit>) => {
      if (args[1]?.id === commandId) throw new Error("Generated memory canonical intent append failed");
      return commit(...args);
    });

    let captures = 0; const capture = f.controller.remote.captureMemory.bind(f.controller.remote);
    t.mock.method(f.controller.remote, "captureMemory", async (...args: Parameters<typeof capture>) => { captures++; return capture(...args); });
    await assert.rejects(() => f.sdk.command({ type: "memory.index", sessionId: f.sessionId }, commandId), /failed/i);
    assert.equal(captures, 0); assert.equal(f.controller.snapshot().jobs.length, 0); assert.equal((await f.sdk.memory.state(f.sessionId)).index, null);
    failed.mock.restore();
    let rejected = false;
    t.mock.method(f.service.store, "commit", (...args: Parameters<typeof commit>) => {
      if (!rejected && args[0].some((event) => event.event_type === "job.finished" && event.payload.status === "completed")) {
        rejected = true; throw new Error("Generated completed-memory outcome retention failed");
      }
      return commit(...args);
    });
    const indexed = await f.sdk.memory.indexSession(f.sessionId);
    assert.equal((await f.sdk.jobs.wait(indexed.id!)).status, "partial");
    assert.equal((await f.sdk.memory.state(f.sessionId)).index?.jobId, indexed.id); assert.equal(captures, 1); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("bounded memory context omits whole oversized hits with valid explicit JSON instead of silently slicing source or history", { skip: process.platform !== "darwin", timeout: 20_000 }, async (t) => {
  const f = await remoteMemoryFixture();
  try {
    const requested = await f.sdk.memory.indexSession(f.sessionId); assert.equal((await f.sdk.jobs.wait(requested.id!)).status, "completed");
    const index = (await f.sdk.memory.state(f.sessionId)).index!;
    const settings = structuredClone(f.sdk.settings.get()!.values); settings.memory.useInContext = true;
    await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision);
    t.mock.method(f.controller.platform, "memorySearch", async () => ({
      binding: index.binding, sourceDigest: index.sourceDigest,
      items: Array.from({ length: 4 }, (_, offset) => ({ path: `generated-${offset}.txt`, text: "\u0001".repeat(4000), digest: "a".repeat(64), distance: 0, stale: false, source: "lexical-vector" as const })),
    }));
    const prompt = await f.controller.platform.effectivePrompt(f.session());
    const payload = prompt.split("<untrusted-repository-memory>\n")[1]!.split("\n</untrusted-repository-memory>")[0]!;
    assert.ok(payload.length <= 8000); assert.deepEqual(JSON.parse(payload).items, []); assert.equal(JSON.parse(payload).omittedHits, 4);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
