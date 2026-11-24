import { ciTime } from "./fixtures/time-scale.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { remoteFixture } from "./fixtures/remote-service.ts";

const native = { skip: process.platform !== "darwin", timeout: ciTime(25_000) };
async function configure(sdk: MoguriSdk, f: Awaited<ReturnType<typeof remoteFixture>>) {
  await f.probe(); await sdk.sessions.env(f.sessionId, "Remote");
  const preview = (await sdk.mcp.remotePreview(f.sessionId, "builtin")).preview;
  await sdk.mcp.grantRemote(f.sessionId, "builtin", preview.digest, preview.settingsRevision, false, true);
  await f.probe(); await sdk.refresh();
  return (await sdk.mcp.tools("builtin", "grep", 0, f.sessionId)).tools[0]!;
}

test("an actual approved Remote model MCP call stays on the SSH worker and retains result/actor/metrics before continuing", native, async (t) => {
  const call = { serverId: "builtin", tool: "grep_logs", arguments: { path: "fixture.txt", query: "remote source" }, schemaDigest: "0".repeat(64) };
  const f = await remoteFixture({ mcpCall: call }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const selected = await configure(sdk, f); call.schemaDigest = selected.digest;
    const local = t.mock.method(f.controller.platform.gateway, "operate", async () => { throw new Error("Remote MCP must not execute on the Local gateway."); });
    await f.select(); await f.send("generated mcp call");
    await f.terminal();
    assert.equal(f.session().pendingApproval, null);
    assert.equal(f.session().status, "completed", f.session().lastError ?? "Remote MCP turn failed.");
    assert.equal(local.mock.calls.length, 0); assert.equal(f.requests.length, 2);
    await sdk.refresh();
    const calls = (await sdk.mcp.remoteCalls(f.sessionId)).calls; assert.equal(calls.length, 1);
    const recorded = calls[0]!;
    assert.equal(recorded.actor, "model"); assert.equal(recorded.status, "completed"); assert.equal(recorded.root, f.workspace); assert.equal(recorded.accessForwarded, false);
    const result = await sdk.mcp.remoteCall(f.sessionId, recorded.id);
    assert.match(JSON.stringify(result.result), /generated actual remote source/); assert.doesNotMatch(JSON.stringify(result.result), /generated original/);
    const outcomes = await sdk.telemetry.operations({ sessionId: f.sessionId, env: "Remote", family: "mcp" });
    assert.equal(outcomes.totals.completed, 1); assert.equal(outcomes.entries[0]?.actor, "model");
    assert.equal((await sdk.budgets.dashboard({ sessionId: f.sessionId })).totals.knownReportedTokens, 84);
  } finally { sdk.disconnect(); await f.close(); }
});

test("an old or Local MCP digest cannot authorize a Remote model connector under its reviewed peer/root", native, async () => {
  const call = { serverId: "builtin", tool: "grep_logs", arguments: { path: "fixture.txt", query: "remote source" }, schemaDigest: "0".repeat(64) };
  const f = await remoteFixture({ mcpCall: call }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await configure(sdk, f); await f.select(); await f.send("generated mcp call");
    await f.terminal();
    assert.notEqual(f.session().messages.findLast((message) => message.role === "tool")?.outcome, "completed");
    assert.match(f.session().messages.findLast((message) => message.role === "tool")?.text ?? "", /Rediscover|Remote MCP catalog/);
    assert.equal(f.controller.snapshot().remoteMcpCalls.length, 0);
    assert.equal(f.session().processes.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("failed Remote MCP result retention cannot acknowledge success, continue another model step or replay its connector", native, async (t) => {
  const call = { serverId: "builtin", tool: "grep_logs", arguments: { path: "fixture.txt", query: "remote source" }, schemaDigest: "0".repeat(64) };
  const f = await remoteFixture({ mcpCall: call }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    call.schemaDigest = (await configure(sdk, f)).digest;
    const commit = f.service.store.commit.bind(f.service.store);
    let failed = false;
    const mock = t.mock.method(f.service.store, "commit", (...args: Parameters<typeof commit>) => {
      if (!failed && args[0].some((event) => event.event_type === "mcp.remote_recorded" && event.payload.call.phase === "result-retained")) { failed = true; throw new Error("Generated Remote MCP retention failure"); }
      return commit(...args);
    });
    await f.select(); await f.send("generated mcp call"); await f.terminal();
    mock.mock.restore();
    assert.equal(f.session().status, "partial"); assert.equal(f.requests.length, 1);
    const record = f.controller.snapshot().remoteMcpCalls[0]!;
    assert.equal(record.status, "unconfirmed"); assert.equal(record.resultDigest, null); assert.ok(record.executionId);
    const execution = f.controller.snapshot().executions.find((execution) => execution.id === record.executionId)!;
    let retained = false, stopped = false;
    for (let index = 0; index < 100 && (!retained || !stopped); index++) {
      const inspection = await f.controller.remote.inspect(execution);
      retained = inspection.frames.some((frame) => frame.request.kind === "mcp.complete");
      stopped = inspection.status.cleanup === "owned-worker-stopped";
      if (!retained || !stopped) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(retained, true); assert.equal(stopped, true); assert.equal(f.requests.length, 1);
    await sdk.remote.reconcile(execution.id);
    const reconciled = await sdk.mcp.remoteCall(f.sessionId, record.id);
    assert.equal(reconciled.call.status, "partial"); assert.equal(reconciled.call.actor, "model"); assert.ok(reconciled.call.jobId);
    assert.match(JSON.stringify(reconciled.result), /generated actual remote source/);
    assert.equal((await sdk.telemetry.operations({ sessionId: f.sessionId, family: "mcp" })).totals.attempts, 1);
    assert.equal(f.session().status, "partial"); assert.equal(f.requests.length, 1);
  } finally { sdk.disconnect(); await f.close(); }
});
