import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { remoteMemoryFixture } from "./fixtures/remote-memory-service.ts";
import { checkedMemoryPrepared, type MemoryPrepared } from "../apps/service/src/memory-mcp.ts";
import { frameDigest } from "../apps/service/src/worker-wire.ts";

test("reviewed no-model Remote memory MCP uses the same scoped index and retains real SSH results without a Local gateway", { skip: process.platform !== "darwin", timeout: 25_000 }, async () => {
  const f = await remoteMemoryFixture();
  try {
    await writeFile(join(f.workspace, "memory.ts"), "export function generatedRemoteMcpKnowledge() { return 'generated remote knowledge'; }\n");
    const index = await f.sdk.memory.indexSession(f.sessionId); assert.equal((await f.sdk.jobs.wait(index.id!)).status, "completed");
    const preview = (await f.sdk.mcp.remotePreview(f.sessionId, "builtin")).preview;
    assert.match(preview.server.resource, /search_memory/);
    await f.sdk.mcp.grantRemote(f.sessionId, "builtin", preview.digest, preview.settingsRevision, false, true); await f.sdk.remote.probe();
    const tools = (await f.sdk.mcp.tools("builtin", "memory", 0, f.sessionId)).tools;
    const search = tools.find((tool) => tool.name === "search_memory")!, graph = tools.find((tool) => tool.name === "memory_graph")!;
    assert.ok(search && graph);
    const job = await f.sdk.mcp.call(f.sessionId, "builtin", search.name, { query: "generatedRemoteMcpKnowledge" }, search.digest);
    assert.equal((await f.sdk.jobs.wait(job.id!)).status, "completed");
    const result = await f.sdk.mcp.readResult(job.id!); assert.match(result.text, /generatedRemoteMcpKnowledge/); assert.match(result.text, /sourceDigest/);
    const graphJob = await f.sdk.mcp.call(f.sessionId, "builtin", graph.name, { path: "memory.ts" }, graph.digest);
    assert.equal((await f.sdk.jobs.wait(graphJob.id!)).status, "completed");
    assert.match((await f.sdk.mcp.readResult(graphJob.id!)).text, /generatedRemoteMcpKnowledge/);
    assert.equal(f.controller.snapshot().remoteMcpCalls.length, 2); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("prepared memory cannot change exact scope/query/tool or use a Local binding, even when its source root exists", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const f = await remoteMemoryFixture();
  try {
    const index = await f.sdk.memory.indexSession(f.sessionId); assert.equal((await f.sdk.jobs.wait(index.id!)).status, "completed");
    const args = { query: "generated source" }, scopeDigest = "c".repeat(64);
    const prepared = await f.controller.platform.preparedMemory(f.sessionId, "search_memory", args, scopeDigest, AbortSignal.timeout(10_000));
    await assert.rejects(() => f.controller.platform.preparedMemory(f.sessionId, "search_memory", {}, scopeDigest, AbortSignal.timeout(5000)), { code: "memory_input" });
    await assert.rejects(() => f.controller.platform.preparedMemory(f.sessionId, "memory_graph", { path: "", extra: true }, scopeDigest, AbortSignal.timeout(5000)), { code: "memory_input" });
    const expected = { root: f.workspace, tool: "search_memory", arguments: args, scopeDigest };
    const value = await checkedMemoryPrepared(prepared, expected, AbortSignal.timeout(5000)); assert.equal(value.binding.env, "Remote");
    for (const changed of [{ root: "/generated/other" }, { tool: "memory_graph" }, { arguments: { query: "different" } }, { scopeDigest: "d".repeat(64) }]) {
      await assert.rejects(() => checkedMemoryPrepared(prepared, { ...expected, ...changed }, AbortSignal.timeout(5000)), { code: "memory_authorization" });
    }
    const local: MemoryPrepared = { ...prepared, binding: { profileId: "default", projectId: f.session().projectId, workspaceId: null, env: "Local", root: f.workspace, device: prepared.binding.device, inode: prepared.binding.inode } };
    await assert.rejects(() => checkedMemoryPrepared(local, expected, AbortSignal.timeout(5000)), { code: "memory_authorization" });
    assert.equal(prepared.argumentsDigest, frameDigest(args)); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("retained builtin grants cannot silently authorize expanded memory or file-search limits", { skip: process.platform !== "darwin", timeout: 20_000 }, async () => {
  const f = await remoteMemoryFixture();
  try {
    const preview = (await f.sdk.mcp.remotePreview(f.sessionId, "builtin")).preview, settings = structuredClone(f.sdk.settings.get()!.values);
    if (!settings.remote) throw new Error("Generated SSH target is absent.");
    for (const tools of [["grep_logs", "fetch_page"], ["grep_logs", "fetch_page", "search_memory", "memory_graph"]]) {
      settings.remote.mcpGrants = [{ serverId: "builtin", peerDigest: preview.peerDigest,
        resourceDigest: frameDigest(["moguri-mcp-resource-v1", "builtin", tools]), forwardAccess: false }];
      await f.sdk.settings.update(settings, f.sdk.settings.get()!.revision); await f.sdk.remote.probe();
      assert.equal((await f.sdk.mcp.remotePreview(f.sessionId, "builtin")).preview.granted, false);
      await assert.rejects(() => f.sdk.mcp.tools("builtin", "memory", 0, f.sessionId), { code: "remote_mcp_grant" });
    }
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
