import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { EventStore } from "../../apps/service/src/store.ts";
import { RemoteRuntime } from "../../apps/service/src/remote.ts";
import { frameDigest } from "../../apps/service/src/worker-wire.ts";
import { WorkerRequestSchema, type WorkerRequest } from "../../apps/service/src/worker-protocol.ts";
import { PROTOCOL_VERSION, parse, type EventInput, type McpServerConfig, type RemoteExecution } from "../../packages/protocol/src/index.ts";
import type { McpOperation } from "../../apps/service/src/mcp-worker.ts";
import type { BridgeStatus } from "../../apps/service/src/remote-protocol.ts";
import type { WorkerConnection, WorkerFrame } from "../../apps/service/src/worker-connection.ts";
import { createSshTarget } from "./ssh-target.ts";
import { waitFor } from "../fixture.ts";
import { ciTime } from "./time-scale.ts";

export type PrimitiveMcpInput = Omit<McpOperation, "root" | "token" | "scripts" | "prepared">;
export interface RemoteMcpPrimitiveResult {
  execution: RemoteExecution; frames: WorkerFrame[]; processes: number[]; results: Extract<WorkerRequest, { kind: "tool.complete" }>[];
  terminal: Extract<WorkerRequest, { kind: "finished" }> | null; modelRequests: number; status?: BridgeStatus;
}
export async function remoteMcpPrimitive() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "moguri-remote-mcp-primitive-")));
  const bridge = join(directory, "bridge"), host = join(directory, "host"), sshRoot = join(directory, "ssh"), workspace = join(directory, "remote"), local = join(directory, "local");
  for (const path of [bridge, host, sshRoot, workspace, local]) await mkdir(path, { mode: 0o700 });
  await writeFile(join(workspace, "fixture.txt"), "GENERATED_REMOTE_MCP_ROOT\n");
  await writeFile(join(local, "fixture.txt"), "GENERATED_LOCAL_MCP_MUST_NOT_READ\n");
  await copyFile(resolve("dist/remote-bridge.mjs"), join(bridge, "remote-bridge.mjs"));
  await copyFile(resolve("dist/mcp-worker.mjs"), join(bridge, "mcp-worker.mjs"));
  await symlink(resolve("node_modules"), join(bridge, "node_modules"), "dir");
  const workerPath = join(bridge, "worker.mjs"), helperDigest = createHash("sha256").update(await readFile(join(bridge, "mcp-worker.mjs"))).digest("hex");
  await build({ entryPoints: [resolve("tests/fixtures/remote-mcp-worker.ts")], outfile: workerPath, bundle: true, platform: "node", target: "node26", format: "esm", packages: "external", logLevel: "silent" });
  const accessToken = "generated-remote-mcp-access-not-personal", requests: { authorized: boolean; method: string }[] = [], effects: string[] = [];
  let version = "1", hold = false, release = () => {}, active: WorkerConnection | undefined;
  let observation: { workerPid: number | null; connectorPids: number[] } | null = null;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const http = createServer((request, response) => {
    void (async () => {
      const authorized = request.headers.authorization === `Bearer ${accessToken}`;
      requests.push({ authorized, method: request.method ?? "unknown" });
      if (request.url === "/authenticated" && !authorized) { response.writeHead(401).end(); return; }
      const server = new Server({ name: "generated-remote-http", version }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "remote_echo", description: "Generated Remote MCP echo",
        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } }] }));
      server.setRequestHandler(CallToolRequestSchema, async (call) => {
        effects.push(String(call.params.arguments?.text)); if (hold) await blocked;
        return { content: [{ type: "text", text: `Generated Remote HTTP effect: ${String(call.params.arguments?.text)} ${authorized ? accessToken : "generated-public-result"}` }] };
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      response.on("close", () => { void transport.close(); void server.close(); });
      await server.connect(transport); await transport.handleRequest(request, response);
    })().catch(() => { if (!response.headersSent) response.writeHead(500); response.end("Generated Remote MCP fixture failed."); });
  });
  await new Promise<void>((resolve, reject) => { http.once("error", reject); http.listen(0, "127.0.0.1", resolve); });
  const address = http.address(); if (!address || typeof address === "string") throw new Error("Generated Remote MCP HTTP bind failed.");
  const ssh = await createSshTarget(sshRoot), target = { ...ssh.target, command: [process.execPath, join(bridge, "remote-bridge.mjs")], allowCopilot: false };
  const secrets = new Map<string, string>();
  const runtime = new RemoteRuntime(host, () => target, workerPath, { vault: {
    read: async (id) => secrets.get(id) ?? null, write: async (id, value) => { secrets.set(id, value); }, remove: async (id) => { secrets.delete(id); },
  } });
  const store = new EventStore(join(host, "events.sqlite"), Buffer.alloc(32, 0x74), "generated-remote-mcp-retention-key");
  const server = (authenticated = false): McpServerConfig => ({ id: "generated-remote-http", name: "Generated Remote HTTP", enabled: true,
    transport: { type: "http", url: `http://127.0.0.1:${address.port}/${authenticated ? "authenticated" : "public"}`, auth: authenticated ? "bearer" : "none" } });
  const inspect = async (execution: RemoteExecution) => {
    const key = secrets.get(execution.id); if (!key) throw new Error("Generated Remote MCP inspection key is missing.");
    const result = await runtime.query(target, { action: "inspect", protocol: PROTOCOL_VERSION, workerDigest: execution.workerDigest, root: execution.workspace,
      stateDir: target.stateDir, runId: execution.id, key, after: 0 }, AbortSignal.timeout(8000));
    if (result.kind !== "inspection") throw new Error("Generated Remote MCP inspection returned another response.");
    return result;
  };
  const close = async () => {
    release();
    try { await runtime.close(); }
    finally {
      try { await ssh.close(); }
      finally {
        http.closeAllConnections(); await new Promise<void>((resolve) => http.close(() => resolve()));
        store.close(); await rm(directory, { recursive: true, force: true });
      }
    }
  };
  try {
    await runtime.probe();
    return { directory, bridge, workspace, local, store, target, incorrectHostKey: ssh.incorrectHostKey, accessToken, requests, effects, runtime, server, inspect, close,
      get observation() { return observation && structuredClone(observation); },
      setVersion(value: string) { version = value; }, holdCalls() { hold = true; }, releaseCalls: release,
      stop() { if (!active) throw new Error("No generated Remote MCP operation is active."); active.send({ kind: "stop" }); },
      async duplicate(execution: RemoteExecution) {
        const key = secrets.get(execution.id); if (!key) throw new Error("Generated Remote MCP retained key is missing.");
        return runtime.query(target, { action: "start", protocol: PROTOCOL_VERSION, workerDigest: execution.workerDigest, root: execution.workspace,
          stateDir: target.stateDir, runId: execution.id, key, after: 0 }, AbortSignal.timeout(8000));
      },
      async run(operation: PrimitiveMcpInput, options: { forwardAccess?: boolean; stopBeforeAuthorization?: boolean; loseResultAcknowledgement?: boolean } = {}): Promise<RemoteMcpPrimitiveResult> {
        const id = randomUUID(), input = { ...operation, workerDigest: helperDigest }, frames: WorkerFrame[] = [], processes: number[] = [];
        const results: Extract<WorkerRequest, { kind: "tool.complete" }>[] = [];
        const execution: RemoteExecution = { id, sessionId: "generated-remote-mcp-session", projectId: "generated-remote-mcp-project", turnId: id,
          target: structuredClone(target), workspace, workerDigest: runtime.readiness.workerDigest!, configDigest: frameDigest(target), createdAt: new Date().toISOString(),
          status: "launching", cancellation: "none", cleanup: "pending", diagnostic: null, lastSequence: 0, workerPid: null };
        let status: BridgeStatus | undefined, failure: unknown, disconnected = false, modelRequests = 0;
        let terminal: Extract<WorkerRequest, { kind: "finished" }> | null = null;
        const witness: { workerPid: number | null; connectorPids: number[] } = { workerPid: null, connectorPids: processes }; observation = witness;
        const connection = runtime.launch(execution, (value) => { status = value; witness.workerPid = value.workerPid; });
        active = connection;
        const metadata = { profile_id: "default", session_id: execution.sessionId, project_id: execution.projectId, turn_id: id };
        connection.events.on("error", (error) => { if (!options.loseResultAcknowledgement) failure = error; });
        connection.events.on("exit", () => { disconnected = true; if (active === connection) active = undefined; });
        connection.events.on("message", (raw, frame) => {
          try {
            const request = parse(WorkerRequestSchema, raw);
            if (!frame || frame.executionId !== id) throw new Error("Generated Remote MCP lost its exact owning frame.");
            frames.push(frame);
            const events: EventInput[] = [];
            if (request.kind === "approval") {
              if (request.call.name !== "mcp_gateway" || frameDigest(request.call.arguments) !== frameDigest(input)) throw new Error("Generated Remote MCP arguments changed before authorization.");
              if (options.stopBeforeAuthorization) connection.send({ kind: "stop" });
            } else if (request.kind === "process") processes.push(request.pid);
            else if (request.kind === "tool.complete") {
              results.push(request);
              events.push({ ...metadata, step_id: request.stepId, event_type: "tool.completed", payload: { call: request.call, text: request.text, isError: request.isError, outcome: request.outcome } });
            } else if (request.kind === "finished") terminal = request;
            else if (request.kind === "boundary" || request.kind === "model.complete") { modelRequests++; throw new Error("Generated Remote MCP attempted a model call."); }
            store.commit([...events, { ...metadata, event_type: "execution.frame_recorded", payload: frame }]);
            if (request.kind === "tool.complete" && options.loseResultAcknowledgement) { connection.kill("SIGTERM"); return; }
            if (request.kind === "approval" && !options.stopBeforeAuthorization) {
              const value = { allow: true, mode: "agent" as const, folders: { denied: [], readOnly: [] }, forwardAccess: options.forwardAccess === true,
                ...(options.forwardAccess ? { accessToken } : {}) };
              connection.send({ kind: "reply", requestId: request.requestId, value });
            }
            if (request.kind === "tool.complete" || request.kind === "finished") connection.send({ kind: "reply", requestId: request.requestId, value: { accepted: true } });
            connection.acknowledge?.(frame.sequence);
          } catch (error) { failure = error; connection.kill("SIGTERM"); }
        });
        connection.send({ kind: "start", root: workspace, context: [{ role: "user", content: JSON.stringify(input), timestamp: Date.now() }], readOnly: false });
        await waitFor(() => { if (failure) throw failure; return options.loseResultAcknowledgement ? disconnected : terminal && status?.cleanup === "owned-worker-stopped"; }, 12_000);
        if (options.loseResultAcknowledgement) {
          const deadline = Date.now() + ciTime(8000);
          let settled = false;
          while (Date.now() < deadline) {
            if ((await inspect(execution)).status.cleanup !== "pending") { settled = true; break; }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          if (!settled) throw new Error("Generated Remote MCP cleanup stayed pending; no completion was inferred.");
        }
        return { execution, frames, processes, results, terminal, modelRequests, status };
      },
    };
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Generated Remote MCP setup and cleanup failed."); }
    throw error;
  }
}
