import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { McpServerSchema, MoguriError, parse, isRecord, type ToolCall } from "../../packages/protocol/src/index.ts";
import { parentMessage, type WorkerReply, type WorkerRequest, type WorkerStart } from "../../apps/service/src/worker-protocol.ts";
import { runMcpConnector } from "../../apps/service/src/mcp-process.ts";

const inputSchema = Type.Object({
  action: Type.Union([Type.Literal("tools"), Type.Literal("call")]), server: Type.Union([McpServerSchema, Type.Null()]),
  tool: Type.Optional(Type.String({ maxLength: 160 })), arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  schemaDigest: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })), workerDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
}, { additionalProperties: false });
const abort = new AbortController(), pending = new Map<string, { resolve(reply: WorkerReply): void; reject(error: Error): void; interruptible: boolean }>();
let authority = true, started = false;
const send = (message: WorkerRequest) => { if (process.connected) process.send?.(message); };
const request = (message: WorkerRequest & { requestId: string }): Promise<WorkerReply> => {
  if (!process.connected) return Promise.reject(new Error("Generated Remote MCP control disconnected."));
  if (!authority) { send(message); return Promise.reject(new Error("Generated Remote MCP has no renewed authority.")); }
  return new Promise((resolve, reject) => { pending.set(message.requestId, { resolve, reject, interruptible: message.kind === "approval" }); send(message); });
};
async function run(start: WorkerStart): Promise<void> {
  const stepId = randomUUID();
  let call: ToolCall | undefined, dispatched = false, published = false;
  try {
    const source = start.context[0];
    if (!start.root || start.readOnly || source?.role !== "user" || typeof source.content !== "string") throw new Error("Generated Remote MCP needs its exact approved root/input.");
    const input = parse(inputSchema, JSON.parse(source.content)), workerPath = fileURLToPath(new URL("./mcp-worker.mjs", import.meta.url));
    if (createHash("sha256").update(await readFile(workerPath)).digest("hex") !== input.workerDigest) throw new MoguriError("remote_mcp_build", "The exact MCP helper changed before dispatch. No alternative was started.");
    call = { id: randomUUID(), name: "mcp_gateway", arguments: input };
    const permission = await request({ kind: "approval", requestId: randomUUID(), stepId, call });
    const value: unknown = permission.value;
    if (permission.error || !isRecord(value) || value.allow !== true || value.mode !== "agent") throw new MoguriError("remote_mcp_denied", "Generated Remote MCP needs exact authorization; no credential or process fallback.");
    abort.signal.throwIfAborted();
    const authenticated = input.server?.transport.type === "http" && input.server.transport.auth !== "none";
    if (authenticated && (value.forwardAccess !== true || typeof value.accessToken !== "string" || !value.accessToken)) throw new MoguriError("remote_mcp_credential", "No explicit peer-bound MCP access-token grant. No local credential was selected or forwarded.");
    const { workerDigest: _, ...operation } = input;
    dispatched = true;
    const ownedCall = call;
    const result = await runMcpConnector({ ...operation, root: start.root, ...(authenticated ? { token: String(value.accessToken) } : {}) }, workerPath, abort.signal,
      (pid) => send({ kind: "process", stepId, callId: ownedCall.id, pid }));
    const text = JSON.stringify(result);
    if (Buffer.byteLength(text) > 128 * 1024) throw new MoguriError("remote_mcp_result", "Generated Remote MCP result exceeds the retained tool-frame ceiling. No text was silently truncated.");
    published = true;
    const accepted = await request({ kind: "tool.complete", requestId: randomUUID(), stepId, call, text, isError: false, outcome: "completed" });
    if (accepted.error) throw new Error(accepted.error);
    abort.signal.throwIfAborted();
    await request({ kind: "finished", requestId: randomUUID(), outcome: "completed", diagnostic: null });
  } catch (error) {
    const outcome = dispatched ? "partial" : abort.signal.aborted ? "stopped" : "failed";
    const diagnostic = dispatched ? `${error instanceof MoguriError ? `${error.code}: ${error.message} ` : ""}Generated Remote MCP may have external effects. Owned cleanup/result acknowledgement is not rollback; no operation was replayed.` :
      error instanceof MoguriError ? error.message : "Generated Remote MCP failed before connector dispatch.";
    if (call && dispatched && !published) {
      try { await request({ kind: "tool.complete", requestId: randomUUID(), stepId, call, text: diagnostic, isError: true, outcome }); }
      catch { console.error("Generated Remote MCP result acknowledgement was lost; inspect its retained remote frames."); }
    }
    try { await request({ kind: "finished", requestId: randomUUID(), outcome, diagnostic }); }
    catch { console.error("Generated Remote MCP terminal acknowledgement was lost; no retry or success was inferred."); }
  } finally {
    for (const waiter of pending.values()) waiter.reject(new Error("Generated Remote MCP settled."));
    pending.clear(); if (process.connected) process.disconnect?.();
  }
}
process.on("message", (raw: unknown) => {
  const message = parentMessage(raw);
  if (message.kind === "start" && !started) { started = true; void run(message); }
  else if (message.kind === "reply") { const waiter = pending.get(message.requestId); pending.delete(message.requestId); waiter?.resolve(message); }
  else if (message.kind === "stop" || message.kind === "control-lost") {
    if (message.kind === "control-lost") authority = false;
    send({ kind: "ack" }); abort.abort();
    for (const [id, waiter] of pending) if (waiter.interruptible || !authority) { waiter.reject(new Error("Generated Remote MCP stopped.")); pending.delete(id); }
  }
});
process.on("disconnect", () => {
  authority = false; abort.abort();
  for (const waiter of pending.values()) waiter.reject(new Error("Generated Remote MCP disconnected."));
  pending.clear();
});
