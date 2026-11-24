import { ciTime } from "./fixtures/time-scale.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { isRecord, type McpServerConfig } from "../packages/protocol/src/index.ts";
import { remoteMcpPrimitive, type RemoteMcpPrimitiveResult } from "./fixtures/remote-mcp-prototype.ts";
import { waitFor } from "./fixture.ts";
import { RemoteConsoles } from "../apps/service/src/remote-terminals.ts";

const native = { skip: process.platform !== "darwin", timeout: ciTime(20_000) };
const tool = (result: RemoteMcpPrimitiveResult, name: string) => {
  assert.equal(result.terminal?.outcome, "completed"); assert.equal(result.modelRequests, 0);
  const tools: unknown = JSON.parse(result.results[0]!.text);
  assert.ok(Array.isArray(tools));
  const selected: unknown = tools.find((item: unknown) => isRecord(item) && item.name === name);
  assert.ok(isRecord(selected) && typeof selected.digest === "string");
  return { name, digest: selected.digest };
};
const text = (result: RemoteMcpPrimitiveResult) => {
  const value = CallToolResultSchema.parse(JSON.parse(result.results[0]!.text)).content.find((item) => item.type === "text");
  assert.ok(value?.type === "text"); return value.text;
};

test("real SSH MCP discovery/call reads the exact Remote root, not the Local counterpart, without a model request", native, async () => {
  const f = await remoteMcpPrimitive();
  try {
    assert.equal(f.runtime.readiness.ready, true);
    assert.equal(f.runtime.readiness.terminalBuild, undefined);
    assert.match(f.runtime.readiness.terminalDiagnostic ?? "", /helpers are missing or inaccessible/);
    assert.throws(() => new RemoteConsoles(f.runtime).admission(), { code: "terminal_remote_unready" });
    const selected = tool(await f.run({ action: "tools", server: null }), "grep_logs");
    const result = await f.run({ action: "call", server: null, tool: selected.name, schemaDigest: selected.digest, arguments: { path: "fixture.txt", query: "MCP_ROOT" } });
    assert.equal(result.terminal?.outcome, "completed"); assert.match(text(result), /GENERATED_REMOTE_MCP_ROOT/);
    assert.doesNotMatch(text(result), /MUST_NOT_READ/);
    assert.equal(await readFile(join(f.local, "fixture.txt"), "utf8"), "GENERATED_LOCAL_MCP_MUST_NOT_READ\n");
    assert.ok(result.processes.length === 1 && result.processes[0] !== process.pid);
    assert.equal(result.modelRequests, 0); assert.equal(f.requests.length, 0);
    assert.ok(result.frames.every((frame) => f.store.events().some((event) => event.event_type === "execution.frame_recorded" && event.payload.sequence === frame.sequence && event.payload.digest === frame.digest)));
  } finally { await f.close(); }
});

test("an actual stdio MCP runs under the Remote connector's process and approved cwd", native, async () => {
  const f = await remoteMcpPrimitive();
  try {
    const server: McpServerConfig = { id: "generated-root-stdio", name: "Generated root stdio", enabled: true,
      transport: { type: "stdio", command: process.execPath, args: [resolve("tests/fixtures/mcp-root-echo.mjs")] } };
    const selected = tool(await f.run({ action: "tools", server }), "root_echo");
    const result = await f.run({ action: "call", server, tool: selected.name, schemaDigest: selected.digest, arguments: { text: "Generated actual Remote stdio." } });
    assert.equal(result.terminal?.outcome, "completed");
    const witness: unknown = JSON.parse(text(result));
    assert.ok(isRecord(witness)); assert.equal(witness.root, f.workspace); assert.equal(witness.marker, "GENERATED_REMOTE_MCP_ROOT\n");
    assert.equal(witness.parentPid, result.processes[0]); assert.notEqual(witness.parentPid, process.pid); assert.equal(result.modelRequests, 0);
  } finally { await f.close(); }
});

test("an authenticated Remote MCP cannot obtain an implicit local token or run its connector without a new explicit grant", native, async () => {
  const f = await remoteMcpPrimitive();
  try {
    const result = await f.run({ action: "tools", server: f.server(true) });
    assert.equal(result.terminal?.outcome, "failed"); assert.match(result.terminal!.diagnostic!, /peer-bound|credential/);
    assert.equal(result.processes.length, 0); assert.equal(f.requests.length, 0); assert.equal(result.modelRequests, 0);
    assert.equal(JSON.stringify(f.store.events()).includes(f.accessToken), false);
  } finally { await f.close(); }
});

test("explicit generated access reaches HTTP on the selected host and echoed credentials never enter retained frames", native, async () => {
  const f = await remoteMcpPrimitive();
  try {
    const selected = tool(await f.run({ action: "tools", server: f.server(true) }, { forwardAccess: true }), "remote_echo");
    const result = await f.run({ action: "call", server: f.server(true), tool: selected.name, schemaDigest: selected.digest,
      arguments: { text: "Generated scoped Remote HTTP." } }, { forwardAccess: true });
    assert.equal(result.terminal?.outcome, "completed"); assert.match(text(result), /Generated scoped Remote HTTP/); assert.match(text(result), /\[redacted\]/);
    assert.ok(f.requests.length > 0 && f.requests.every((request) => request.authorized));
    assert.deepEqual(f.effects, ["Generated scoped Remote HTTP."]); assert.equal(result.modelRequests, 0);
    assert.equal(JSON.stringify(f.store.events()).includes(f.accessToken), false);
    assert.equal(JSON.stringify((await f.inspect(result.execution)).frames).includes(f.accessToken), false);
  } finally { await f.close(); }
});

test("a changed exact Remote MCP schema/server version cannot execute under the old discovered digest", native, async () => {
  const f = await remoteMcpPrimitive();
  try {
    const selected = tool(await f.run({ action: "tools", server: f.server() }), "remote_echo");
    f.setVersion("2");
    const result = await f.run({ action: "call", server: f.server(), tool: selected.name, schemaDigest: selected.digest, arguments: { text: "Generated stale schema must not run." } });
    assert.notEqual(result.terminal?.outcome, "completed"); assert.match(result.results[0]!.text, /schema or server version changed|Rediscover/);
    assert.equal(f.effects.length, 0); assert.equal(result.modelRequests, 0);
  } finally { await f.close(); }
});

test("pre-authorization Remote MCP stop creates no connector or network request", native, async () => {
  const f = await remoteMcpPrimitive();
  try {
    const result = await f.run({ action: "tools", server: f.server() }, { stopBeforeAuthorization: true });
    assert.equal(result.terminal?.outcome, "stopped"); assert.equal(result.processes.length, 0); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("in-flight HTTP cancellation is partial and the connector's actual parent is the SSH worker, not the Local controller", native, async () => {
  const f = await remoteMcpPrimitive();
  try {
    const selected = tool(await f.run({ action: "tools", server: f.server() }), "remote_echo");
    f.holdCalls();
    const pending = f.run({ action: "call", server: f.server(), tool: selected.name, schemaDigest: selected.digest, arguments: { text: "Generated effect happened before stop." } });
    await waitFor(() => f.effects.length === 1);
    const witness = f.observation; assert.ok(witness?.workerPid && witness.connectorPids[0]);
    const parent = await promisify(execFile)("ps", ["-p", String(witness.connectorPids[0]), "-o", "ppid="], { encoding: "utf8" });
    assert.equal(Number(parent.stdout.trim()), witness.workerPid); assert.notEqual(witness.workerPid, process.pid);
    f.stop();
    const result = await pending;
    assert.equal(result.terminal?.outcome, "partial"); assert.equal(result.status?.cleanup, "owned-worker-stopped");
    assert.throws(() => process.kill(witness.connectorPids[0]!, 0), { code: "ESRCH" });
    assert.equal(f.effects.length, 1); assert.equal(result.modelRequests, 0);
  } finally { await f.close(); }
});

test("lost SSH result acknowledgement retains one inspectable MCP result and duplicate recovery cannot replay the tool", native, async () => {
  const f = await remoteMcpPrimitive();
  try {
    const selected = tool(await f.run({ action: "tools", server: f.server() }), "remote_echo");
    const result = await f.run({ action: "call", server: f.server(), tool: selected.name, schemaDigest: selected.digest,
      arguments: { text: "Generated one Remote effect." } }, { loseResultAcknowledgement: true });
    assert.equal(f.effects.length, 1); assert.equal(result.results.length, 1);
    const inspection = await f.inspect(result.execution);
    assert.equal(inspection.status.status, "unconfirmed"); assert.equal(inspection.status.cleanup, "owned-worker-stopped");
    assert.ok(inspection.frames.some((frame) => frame.sequence > inspection.status.acknowledged && frame.request.kind === "tool.complete"));
    await assert.rejects(() => f.duplicate(result.execution), /already exists|second worker|remote_duplicate/);
    assert.equal(f.effects.length, 1); assert.equal(result.modelRequests, 0);
  } finally { await f.close(); }
});

test("changed MCP helper bytes fail before any connector, credential or tool dispatch", native, async () => {
  const f = await remoteMcpPrimitive();
  try {
    await writeFile(join(f.bridge, "mcp-worker.mjs"), "throw new Error('Generated changed helper must not execute');\n");
    const result = await f.run({ action: "tools", server: f.server() });
    assert.equal(result.terminal?.outcome, "failed"); assert.match(result.terminal!.diagnostic!, /helper changed/);
    assert.equal(result.processes.length, 0); assert.equal(f.requests.length, 0); assert.equal(result.modelRequests, 0);
  } finally { await f.close(); }
});

test("a changed SSH host key cannot launch the MCP worker or make a discovery request", native, async () => {
  const f = await remoteMcpPrimitive(), original = f.target.hostKey;
  try {
    f.target.hostKey = f.incorrectHostKey;
    await assert.rejects(() => f.runtime.probe(), /host-key verification/);
    assert.equal(f.runtime.readiness.ready, false); assert.equal(f.requests.length, 0); assert.equal(f.effects.length, 0);
  } finally { f.target.hostKey = original; await f.close(); }
});
