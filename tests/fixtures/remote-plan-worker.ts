import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { MoguriError, parse, type ToolCall } from "../../packages/protocol/src/index.ts";
import { readProjectFile, writeProjectFile } from "../../apps/service/src/files.ts";
import { assertFolderAccess } from "../../apps/service/src/project-policy.ts";
import { parentMessage, type WorkerReply, type WorkerRequest, type WorkerStart } from "../../apps/service/src/worker-protocol.ts";

const inputSchema = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 4096 }), text: Type.String({ maxLength: 128 * 1024 }),
  expectedDigest: Type.String({ pattern: "^(absent|[a-f0-9]{64})$" }),
}, { additionalProperties: false });
const abort = new AbortController(), pending = new Map<string, { resolve(reply: WorkerReply): void; reject(error: Error): void; interruptible: boolean }>();
let authority = true, started = false;
const send = (message: WorkerRequest) => { if (process.connected) process.send?.(message); };
async function request(message: WorkerRequest & { requestId: string }): Promise<WorkerReply> {
  if (!process.connected) throw new Error("Generated mutation control disconnected.");
  if (!authority) { send(message); throw new Error("Generated result retained without renewed authority."); }
  return new Promise((resolve, reject) => { pending.set(message.requestId, { resolve, reject, interruptible: message.kind === "approval" }); send(message); });
}
async function run(start: WorkerStart): Promise<void> {
  const stepId = randomUUID();
  let call: ToolCall | undefined, attempted = false, written = false, resultSent = false;
  try {
    const source = start.context[0];
    if (!start.root || source?.role !== "user" || typeof source.content !== "string") throw new Error("Generated mutation has no exact root/input.");
    const input = parse(inputSchema, JSON.parse(source.content));
    call = { id: randomUUID(), name: "write_file", arguments: input };
    const permission = await request({ kind: "approval", requestId: randomUUID(), stepId, call });
    if (permission.error || !permission.value || !("allow" in permission.value) || !permission.value.allow || permission.value.mode !== "agent") throw new MoguriError("mutation_denied", "Generated exact write was not authorized.");
    abort.signal.throwIfAborted();
    await assertFolderAccess(start.root, input.path, true, permission.value.folders);
    abort.signal.throwIfAborted(); attempted = true;
    const hash = await writeProjectFile(start.root, input.path, input.text, input.expectedDigest); written = true;
    const current = await readProjectFile(start.root, input.path);
    if (current.digest !== hash || current.text !== input.text) throw new Error("Generated mutation readback changed after the write.");
    resultSent = true;
    const accepted = await request({ kind: "tool.complete", requestId: randomUUID(), stepId, call,
      text: JSON.stringify({ path: input.path, digest: hash, text: current.text, written: true }), isError: false, outcome: "completed" });
    if (accepted.error) throw new Error(accepted.error);
    abort.signal.throwIfAborted();
    await request({ kind: "finished", requestId: randomUUID(), outcome: "completed", diagnostic: null });
  } catch (error) {
    const partial = written || attempted && !(error instanceof MoguriError && error.code === "file_conflict");
    const outcome = partial ? "partial" : abort.signal.aborted ? "stopped" : "failed";
    const diagnostic = partial ? "Generated plan may already be written. No rollback or successful cancellation was inferred." : error instanceof Error ? error.message : "Generated mutation failed.";
    if (call && attempted && !resultSent) {
      resultSent = true;
      try { await request({ kind: "tool.complete", requestId: randomUUID(), stepId, call, text: diagnostic, isError: true, outcome }); }
      catch { console.error("Generated mutation result acknowledgement was lost; retained remote frames remain inspectable."); }
    }
    try { await request({ kind: "finished", requestId: randomUUID(), outcome, diagnostic }); }
    catch { console.error("Generated mutation terminal acknowledgement was lost; no operation was replayed."); }
  } finally {
    for (const waiter of pending.values()) waiter.reject(new Error("Generated mutation settled."));
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
    for (const [id, waiter] of pending) if (waiter.interruptible || !authority) { waiter.reject(new Error("Generated owned mutation stopped.")); pending.delete(id); }
  }
});
process.on("disconnect", () => {
  authority = false; abort.abort();
  for (const waiter of pending.values()) waiter.reject(new Error("Generated mutation disconnected."));
  pending.clear();
});
