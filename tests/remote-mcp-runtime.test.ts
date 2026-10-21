import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runMcpConnector } from "../apps/service/src/mcp-process.ts";
import { executeRemoteMcp, type RemoteMcpAuthorization } from "../apps/service/src/remote-mcp-runtime.ts";
import { localWorker } from "../apps/service/src/worker-connection.ts";
import { WorkerRequestSchema, type WorkerRequest } from "../apps/service/src/worker-protocol.ts";
import { frameDigest } from "../apps/service/src/worker-wire.ts";
import { isRecord, parse, type ToolCall } from "../packages/protocol/src/index.ts";
import { waitFor } from "./fixture.ts";

async function runtimeInput() {
  const root = await mkdtemp(join(tmpdir(), "moguri-mcp-runtime-")); await mkdir(join(root, "project"));
  const workspace = join(root, "project"), helper = resolve("apps/service/src/mcp-worker.ts");
  await writeFile(join(workspace, "fixture.txt"), "Generated owned MCP runtime bytes.\n");
  const catalog = await runMcpConnector({ action: "tools", root: workspace, server: null }, helper, AbortSignal.timeout(5000));
  assert.ok(Array.isArray(catalog));
  const selected: unknown = catalog.find((tool: unknown) => isRecord(tool) && tool.name === "grep_logs"); assert.ok(isRecord(selected) && typeof selected.digest === "string");
  const call: ToolCall = { id: randomUUID(), name: "mcp_gateway", arguments: { action: "call", serverId: "builtin", tool: "grep_logs", arguments: { path: "fixture.txt", query: "runtime" }, schemaDigest: "a".repeat(64) } };
  const authorization: RemoteMcpAuthorization = { kind: "remote-mcp", operationId: randomUUID(), scopeDigest: "b".repeat(64), stepId: randomUUID(),
    callDigest: frameDigest(call), env: "Remote", root: workspace, helperDigest: createHash("sha256").update(await readFile(helper)).digest("hex"),
    server: null, tool: "grep_logs", arguments: { path: "fixture.txt", query: "runtime" }, schemaDigest: selected.digest, reviewedDigest: String(call.arguments.schemaDigest) };
  return { root, workspace, call, authorization, close: () => rm(root, { recursive: true, force: true }) };
}

test("the shared MCP executor runs only its exact step/root/arguments and returns the actual bounded result after child closure", async () => {
  const f = await runtimeInput(), pids: number[] = [];
  try {
    const result = await executeRemoteMcp(f.authorization, { call: f.call, stepId: f.authorization.stepId, root: f.workspace, env: "Remote" },
      AbortSignal.timeout(5000), (pid) => pids.push(pid));
    assert.equal(result.outcome, "completed"); assert.equal(result.dispatched, true); assert.equal(result.accessReceived, false);
    assert.match(JSON.stringify(result.result), /Generated owned MCP runtime bytes/); assert.equal(pids.length, 1);
    const pid = pids[0]!; assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally { await f.close(); }
});

test("mismatched authorization, helper, env or credentials fail before a shared connector can start", async () => {
  const f = await runtimeInput();
  let started = 0;
  try {
    const expected = { call: f.call, stepId: f.authorization.stepId, root: f.workspace, env: "Remote" };
    const cases = [
      { authorization: f.authorization, expected: { ...expected, env: "Local" } },
      { authorization: f.authorization, expected: { ...expected, root: join(f.root, "unapproved") } },
      { authorization: { ...f.authorization, helperDigest: "0".repeat(64) }, expected },
      { authorization: { ...f.authorization, arguments: { path: "fixture.txt", query: "changed" } }, expected },
      { authorization: { ...f.authorization, accessToken: "generated-token-for-wrong-resource" }, expected },
    ];
    for (const item of cases) {
      const result = await executeRemoteMcp(item.authorization, item.expected, AbortSignal.timeout(5000), () => { started++; });
      assert.equal(result.outcome, "failed"); assert.equal(result.dispatched, false); assert.ok(result.diagnostic);
    }
    assert.equal(started, 0);
  } finally { await f.close(); }
});

test("an already-cancelled MCP authorization is stopped without an effect or child", async () => {
  const f = await runtimeInput(), abort = new AbortController();
  try {
    abort.abort();
    const result = await executeRemoteMcp(f.authorization, { call: f.call, stepId: f.authorization.stepId, root: f.workspace, env: "Remote" }, abort.signal,
      () => { throw new Error("Cancelled MCP must not start a child."); });
    assert.equal(result.outcome, "stopped"); assert.equal(result.dispatched, false);
  } finally { await f.close(); }
});

test("the actual owned worker uses the new provider-free MCP operation and retains a result before its terminal acknowledgement", async () => {
  const f = await runtimeInput(), connection = localWorker(resolve("apps/service/src/worker.ts"), randomUUID());
  const requests: WorkerRequest[] = []; let failure: unknown, terminal: Extract<WorkerRequest, { kind: "finished" }> | undefined;
  const exited = new Promise<void>((resolve) => connection.events.once("exit", () => resolve()));
  try {
    connection.events.on("error", (error) => { failure = error; });
    connection.events.on("message", (raw) => {
      try {
        const request = parse(WorkerRequestSchema, raw); requests.push(request);
        if (request.kind === "delegate") connection.send({ kind: "reply", requestId: request.requestId, value: f.authorization });
        else if (request.kind === "mcp.complete") {
          assert.equal(request.result.outcome, "completed"); assert.match(JSON.stringify(request.result.result), /owned MCP runtime bytes/);
          connection.send({ kind: "reply", requestId: request.requestId, value: { text: "Generated result retained by the owner.", isError: false, outcome: "completed" } });
        } else if (request.kind === "finished") { terminal = request; connection.send({ kind: "reply", requestId: request.requestId, value: { accepted: true } }); }
        else if (request.kind === "boundary" || request.kind === "model.complete") throw new Error("The owned MCP operation attempted a model call.");
      } catch (error) { failure = error; connection.kill("SIGTERM"); }
    });
    connection.send({ kind: "start", root: f.workspace, env: "Remote", context: [], readOnly: false,
      operation: { kind: "mcp.call", stepId: f.authorization.stepId, call: f.call } });
    await waitFor(() => { if (failure) throw failure; return terminal; }, 8000);
    await exited;
    assert.equal(terminal?.outcome, "completed"); assert.equal(requests.filter((request) => request.kind === "mcp.complete").length, 1);
    assert.ok(requests.findIndex((request) => request.kind === "mcp.complete") < requests.findIndex((request) => request.kind === "finished"));
  } finally { if (connection.connected) { connection.kill("SIGTERM"); await exited; } await f.close(); }
});
