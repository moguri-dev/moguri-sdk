import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { envelope } from "../apps/service/src/controller.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";
import { generatedOAuthServer } from "./fixtures/oauth.ts";
import { waitFor } from "./fixture.ts";

const native = { skip: process.platform !== "darwin", timeout: 25_000 };
async function configure(sdk: MoguriSdk, f: Awaited<ReturnType<typeof remoteFixture>>, serverId = "builtin", forwardAccess = false) {
  await f.probe(); await sdk.sessions.env(f.sessionId, "Remote");
  const preview = (await sdk.mcp.remotePreview(f.sessionId, serverId)).preview;
  await sdk.mcp.grantRemote(f.sessionId, serverId, preview.digest, preview.settingsRevision, forwardAccess, true);
  await f.probe(); await sdk.refresh();
  return (await sdk.mcp.tools(serverId, serverId === "builtin" ? "grep" : "", 0, f.sessionId)).tools[0]!;
}

test("remembered Remote MCP approvals survive their own settings update and reuse only the same actual tool schema and peer", native, async () => {
  const f = await remoteFixture({ exposeModels: false }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const tool = await configure(sdk, f);
    const first = await sdk.mcp.call(f.sessionId, "builtin", tool.name, { path: "fixture.txt", query: "remote source" }, tool.digest);
    const approval = f.session().pendingApproval; assert.ok(approval);
    await sdk.approvals.respond(f.sessionId, approval.id, true, { scope: "project", match: "exact" });
    const completed = await sdk.jobs.wait(first.id!);
    assert.equal(completed.status, "completed", completed.error ?? "Remembering must not invalidate the originally approved Remote call.");
    const rediscovered = (await sdk.mcp.tools("builtin", "grep", 0, f.sessionId)).tools[0]!;
    const second = await sdk.mcp.call(f.sessionId, "builtin", rediscovered.name, { path: "fixture.txt", query: "generated" }, rediscovered.digest);
    const repeated = await sdk.jobs.wait(second.id!);
    assert.equal(repeated.status, "completed", repeated.error ?? "The same exact MCP tool should use its remembered approval.");
    assert.equal(f.controller.snapshot().remoteMcpCalls.length, 2); assert.equal(f.requests.length, 0);
    assert.equal(f.controller.events(0).filter((event) => event.event_type === "tool.decided" && event.payload.actor === "user").length, 1);
    const original = (await sdk.mcp.remotePreview(f.sessionId, "builtin")).preview;
    await sdk.approvals.revoke(sdk.approvals.list()[0]!.id);
    const revoked = (await sdk.mcp.remotePreview(f.sessionId, "builtin")).preview;
    assert.notEqual(revoked.digest, original.digest);
    await assert.rejects(() => sdk.mcp.call(f.sessionId, "builtin", rediscovered.name, { path: "fixture.txt", query: "generated" }, rediscovered.digest), { code: "remote_mcp_catalog" });
    const changed = structuredClone(sdk.settings.get()!.values); changed.instructions = "Generated changed non-approval setting.";
    await sdk.settings.update(changed, sdk.settings.get()!.revision);
    assert.notEqual((await sdk.mcp.remotePreview(f.sessionId, "builtin")).preview.digest, revoked.digest);
  } finally { sdk.disconnect(); await f.close(); }
});

test("an explicitly approved external Remote MCP call needs no model and settles only after its actual SSH worker stops", native, async (t) => {
  const f = await remoteFixture({ exposeModels: false }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const tool = await configure(sdk, f);
    const local = t.mock.method(f.controller.platform.gateway, "operate", async () => { throw new Error("External Remote MCP must not use Local execution."); });
    assert.equal(f.session().controls.modelId, null);
    const pending = await sdk.mcp.call(f.sessionId, "builtin", tool.name, { path: "fixture.txt", query: "remote source" }, tool.digest);
    const intent = f.controller.snapshot().remoteMcpCalls[0]!;
    assert.equal(intent.actor, "external"); assert.equal(intent.phase, "intent"); assert.equal(intent.status, "waiting_input");
    assert.equal(intent.accessForwarded, false); assert.equal(intent.executionId, null); assert.equal(intent.jobId, pending.id);
    assert.ok(intent.commandId && intent.commandDigest); assert.ok(f.session().pendingApproval);
    assert.equal(f.controller.snapshot().executions.length, 0);
    await f.approve();
    const job = await sdk.jobs.wait(pending.id!);
    assert.equal(job.status, "completed", job.error ?? "External Remote MCP did not complete.");
    const call = (await sdk.mcp.remoteCalls(f.sessionId)).calls[0]!;
    assert.equal(call.phase, "settled"); assert.equal(call.status, "completed"); assert.equal(call.actor, "external");
    const execution = f.controller.snapshot().executions.find((execution) => execution.id === call.executionId)!;
    assert.equal(execution.cleanup, "owned-worker-stopped");
    const result = await sdk.mcp.remoteCall(f.sessionId, call.id);
    assert.match(JSON.stringify(result.result), /generated actual remote source/);
    assert.doesNotMatch(JSON.stringify(result.result), /generated original/);
    assert.match((await sdk.mcp.readResult(pending.id!)).text, /generated actual remote source/);
    assert.equal(f.controller.events(0).filter((event) => event.event_type === "tool.completed" && event.turn_id === call.turnId).length, 1);
    assert.equal(f.session().status, "completed"); assert.equal(f.requests.length, 0); assert.equal(local.mock.calls.length, 0);
    assert.equal(f.controller.snapshot().budgetEntries.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("a lost external MCP command receipt cannot admit or replay the same original SSH operation", native, async (t) => {
  const f = await remoteFixture({ exposeModels: false }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const tool = await configure(sdk, f);
    const original = envelope({ type: "mcp.call", sessionId: f.sessionId, serverId: "builtin", tool: tool.name, arguments: { path: "fixture.txt", query: "remote source" }, schemaDigest: tool.digest });
    const commit = f.service.store.commit.bind(f.service.store);
    const failure = t.mock.method(f.service.store, "commit", (...args: Parameters<typeof commit>) => {
      if (args[1]?.id === original.id) throw new Error("Generated lost external MCP command receipt.");
      return commit(...args);
    });
    await assert.rejects(() => f.controller.dispatch(original), /Generated lost external MCP command receipt/);
    failure.mock.restore();
    const recorded = f.controller.snapshot().remoteMcpCalls[0]!;
    assert.equal(recorded.commandId, original.id); assert.ok(recorded.jobId); assert.ok(f.session().pendingApproval);
    await assert.rejects(() => f.controller.dispatch(original), { code: "remote_mcp_recorded" });
    await f.approve();
    assert.equal((await sdk.jobs.wait(recorded.jobId!)).status, "completed");
    await assert.rejects(() => f.controller.dispatch(original), { code: "remote_mcp_recorded" });
    await assert.rejects(() => f.controller.dispatch({ ...original, command: { ...original.command, arguments: { path: "fixture.txt", query: "changed original command" } } }), { code: "idempotency_conflict" });
    assert.equal(f.controller.snapshot().remoteMcpCalls.length, 1); assert.equal(f.controller.snapshot().executions.length, 1); assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("stopping an actual held external SSH MCP call retains partial effects and stops its exact connector group", native, async () => {
  const f = await remoteFixture({ exposeModels: false }), sdk = await new MoguriSdk(f.service.connection).ready();
  const started = join(f.workspace, "generated-held-mcp-pid"), effect = join(f.workspace, "generated-held-mcp-effect");
  try {
    const settings = structuredClone(sdk.settings.get()!.values);
    settings.mcpServers = [{ id: "generated-held-mcp", name: "Generated owned MCP", enabled: true, transport: { type: "stdio", command: process.execPath,
      args: [resolve("tests/fixtures/mcp-echo.mjs"), "--started-marker", started, "--call-marker", effect, "--hold-call", "--ignore-signals"] } }];
    await sdk.settings.update(settings, sdk.settings.get()!.revision);
    const tool = await configure(sdk, f, "generated-held-mcp");
    const pending = await sdk.mcp.call(f.sessionId, "generated-held-mcp", tool.name, { text: "generated stop ownership" }, tool.digest);
    await f.approve(); await waitFor(() => existsSync(effect));
    const pid = Number(await readFile(started, "utf8")); assert.ok(Number.isSafeInteger(pid) && pid > 1);
    await sdk.jobs.cancel(pending.id!);
    const job = await sdk.jobs.wait(pending.id!);
    assert.equal(job.status, "partial"); assert.equal(f.session().status, "partial");
    const call = (await sdk.mcp.remoteCalls(f.sessionId)).calls[0]!;
    assert.equal(call.status, "partial"); assert.ok(call.resultDigest); assert.equal(call.accessForwarded, false);
    const result = await sdk.mcp.remoteCall(f.sessionId, call.id);
    assert.match(JSON.stringify(result.result), /"dispatched":true/);
    assert.equal(await readFile(effect, "utf8"), "generated call\n");
    await waitFor(() => { try { process.kill(pid, 0); return false; } catch (error) { if (error instanceof Error && "code" in error && error.code === "ESRCH") return true; throw error; } }, 5000);
    const execution = f.controller.snapshot().executions.find((execution) => execution.id === call.executionId)!;
    assert.equal(execution.cleanup, "owned-worker-stopped"); assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("denial and cancellation before external Remote MCP approval retain distinct outcomes without launching any SSH worker", native, async () => {
  const f = await remoteFixture({ exposeModels: false }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const tool = await configure(sdk, f);
    for (const decision of ["deny", "cancel"] as const) {
      const pending = await sdk.mcp.call(f.sessionId, "builtin", tool.name, { path: "fixture.txt", query: "remote source" }, tool.digest);
      const approval = f.session().pendingApproval!;
      if (decision === "deny") await sdk.command({ type: "approval.respond", sessionId: f.sessionId, approvalId: approval.id, allow: false });
      else await sdk.jobs.cancel(pending.id!);
      assert.equal((await sdk.jobs.wait(pending.id!)).status, "cancelled");
      const call = (await sdk.mcp.remoteCalls(f.sessionId)).calls.find((call) => call.jobId === pending.id)!;
      assert.equal(call.status, decision === "deny" ? "denied" : "stopped"); assert.equal(call.phase, "settled");
      assert.equal(call.executionId, null); assert.equal(call.accessForwarded, false); assert.equal(call.resultDigest, null);
    }
    assert.equal(f.controller.snapshot().executions.length, 0); assert.equal(f.requests.length, 0);
    assert.equal(f.controller.events(0).filter((event) => event.event_type === "tool.started").length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("an actual external OAuth MCP call forwards granted access only and retains redacted Remote frames/results", native, async (t) => {
  const oauth = await generatedOAuthServer(), values = new Map<string, string>();
  const f = await remoteFixture({ exposeModels: false, platform: { vault: { read: async (id) => values.get(id) ?? null, write: async (id, value) => { values.set(id, value); }, remove: async (id) => { values.delete(id); } } } });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const settings = structuredClone(sdk.settings.get()!.values);
    settings.mcpServers = [{ id: "generated-external-oauth", name: "Generated external OAuth", enabled: true, transport: { type: "http", url: oauth.url, auth: "oauth" } }];
    await sdk.settings.update(settings, sdk.settings.get()!.revision);
    const login = await sdk.mcp.oauthBegin("generated-external-oauth", f.sessionId), status = await sdk.mcp.oauthStatus(login.id!);
    assert.ok(status.url); assert.equal((await fetch(await oauth.callback(status.url))).status, 200);
    const tool = await configure(sdk, f, "generated-external-oauth", true);
    const launch = f.controller.remote.launch.bind(f.controller.remote), authorizations: string[] = [];
    t.mock.method(f.controller.remote, "launch", (...args: Parameters<typeof launch>) => {
      const connection = launch(...args), send = connection.send.bind(connection);
      t.mock.method(connection, "send", (...args: Parameters<typeof send>) => {
        const message = args[0];
        if (message.kind === "reply" && message.value && "kind" in message.value && message.value.kind === "remote-mcp") authorizations.push(JSON.stringify(message.value));
        return send(...args);
      });
      return connection;
    });
    const pending = await sdk.mcp.call(f.sessionId, "generated-external-oauth", tool.name, {}, tool.digest);
    await f.approve(); assert.equal((await sdk.jobs.wait(pending.id!)).status, "completed");
    assert.equal(authorizations.length, 1); assert.match(authorizations[0]!, /generated-oauth-access/); assert.doesNotMatch(authorizations[0]!, /generated-oauth-refresh/);
    const call = (await sdk.mcp.remoteCalls(f.sessionId)).calls[0]!;
    assert.equal(call.accessForwarded, true); assert.equal(call.actor, "external");
    const result = JSON.stringify(await sdk.mcp.remoteCall(f.sessionId, call.id));
    assert.match(result, /\[redacted\]/); assert.doesNotMatch(result, /generated-oauth-access|generated-oauth-refresh/);
    const execution = f.controller.snapshot().executions.find((execution) => execution.id === call.executionId)!;
    const inspection = await f.controller.remote.inspect({ ...execution, lastSequence: 0 });
    assert.doesNotMatch(JSON.stringify(inspection.frames), /generated-oauth-access|generated-oauth-refresh/);
    assert.doesNotMatch(JSON.stringify(f.controller.events(0)), /generated-oauth-access|generated-oauth-refresh/);
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); await oauth.close(); }
});

test("revoking a Remote MCP grant during an awaited access read prevents credential and connector dispatch", native, async (t) => {
  const f = await remoteFixture({ exposeModels: false }), sdk = await new MoguriSdk(f.service.connection).ready();
  let reading = false, release = () => {};
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  try {
    const tool = await configure(sdk, f);
    t.mock.method(f.controller.platform.gateway, "accessToken", async () => { reading = true; await barrier; return null; });
    const pending = await sdk.mcp.call(f.sessionId, "builtin", tool.name, { path: "fixture.txt", query: "remote source" }, tool.digest);
    await f.approve(); await waitFor(() => reading);
    await sdk.mcp.revokeRemote(f.sessionId, "builtin", sdk.settings.get()!.revision, true);
    release();
    assert.equal((await sdk.jobs.wait(pending.id!)).status, "failed");
    const call = (await sdk.mcp.remoteCalls(f.sessionId)).calls[0]!;
    assert.equal(call.status, "failed"); assert.equal(call.accessForwarded, false); assert.equal(call.resultDigest, null);
    assert.equal(f.session().processes.length, 0); assert.equal(f.requests.length, 0);
  } finally { release(); sdk.disconnect(); await f.close(); }
});

test("failed external MCP result retention preserves one exact late result without promoting the partial job", native, async (t) => {
  const f = await remoteFixture({ exposeModels: false }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const tool = await configure(sdk, f), commit = f.service.store.commit.bind(f.service.store);
    let failed = false;
    const failure = t.mock.method(f.service.store, "commit", (...args: Parameters<typeof commit>) => {
      if (!failed && args[0].some((event) => event.event_type === "mcp.remote_recorded" && event.payload.call.phase === "result-retained")) {
        failed = true; throw new Error("Generated external result-receipt failure.");
      }
      return commit(...args);
    });
    const pending = await sdk.mcp.call(f.sessionId, "builtin", tool.name, { path: "fixture.txt", query: "remote source" }, tool.digest);
    await f.approve(); assert.equal((await sdk.jobs.wait(pending.id!)).status, "partial"); failure.mock.restore();
    const call = (await sdk.mcp.remoteCalls(f.sessionId)).calls[0]!;
    assert.equal(call.status, "partial"); assert.equal(call.resultDigest, null);
    const execution = f.controller.snapshot().executions.find((entry) => entry.id === call.executionId)!;
    let stopped = false;
    for (let index = 0; index < 100 && !stopped; index++) {
      const inspection = await f.controller.remote.inspect(execution);
      stopped = inspection.status.cleanup === "owned-worker-stopped";
      if (!stopped) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(stopped, true);
    await sdk.remote.reconcile(execution.id);
    assert.equal((await sdk.jobs.wait(pending.id!)).status, "partial");
    const late = await sdk.mcp.remoteCall(f.sessionId, call.id);
    assert.equal(late.call.actor, "external"); assert.equal(late.call.status, "partial"); assert.equal(late.call.jobId, pending.id);
    assert.match(JSON.stringify(late.result), /generated actual remote source/);
    assert.match((await sdk.mcp.readResult(pending.id!)).text, /generated actual remote source/);
    assert.equal(f.controller.snapshot().executions.length, 1); assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});
