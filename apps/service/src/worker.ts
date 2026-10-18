import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createModels, type Message } from "@earendil-works/pi-ai";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { executeTool } from "./tools.ts";
import { parentMessage, toolCalls, usagePresent, type BoundaryReply, type WorkerReply, type WorkerRequest, type WorkerStart } from "./worker-protocol.ts";

const abort = new AbortController();
const pending = new Map<string, { resolve: (message: WorkerReply) => void; reject: (error: Error) => void; interruptible: boolean }>();
const send = (message: WorkerRequest) => { if (process.connected) process.send?.(message); };
async function request(message: WorkerRequest & { requestId: string }): Promise<WorkerReply> {
  if (!process.connected) throw new Error("The control plane disconnected before recording the outcome.");
  const interruptible = message.kind === "boundary" || message.kind === "approval";
  if (interruptible) abort.signal.throwIfAborted();
  return new Promise((resolve, reject) => { pending.set(message.requestId, { resolve, reject, interruptible }); send(message); });
}
async function finish(outcome: "completed" | "stopped" | "failed" | "partial", diagnostic: string | null): Promise<void> {
  await request({ kind: "finished", requestId: randomUUID(), outcome, diagnostic });
}
async function run(start: WorkerStart): Promise<void> {
  const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
  models.setProvider(githubCopilotProvider());
  const context: Message[] = start.context;
  let incompleteCleanup = false;
  try {
    for (let index = 0; index < 32; index++) {
      abort.signal.throwIfAborted();
      const stepId = randomUUID();
      const reply = await request({ kind: "boundary", requestId: randomUUID(), stepId });
      if (reply.error || !reply.value || !("model" in reply.value)) throw new Error(reply.error ?? "Missing model authorization.");
      const boundary: BoundaryReply = reply.value;
      context.push(...boundary.steers);
      const model = { ...boundary.model, baseUrl: boundary.auth.baseUrl ?? boundary.model.baseUrl };
      let usageReported = false;
      let buffered = "";
      const flush = () => { if (buffered) { send({ kind: "delta", stepId, text: buffered }); buffered = ""; } };
      const timer = setInterval(flush, 50);
      const started = performance.now();
      try {
        const stream = models.streamSimple(model, {
          systemPrompt: boundary.systemPrompt,
          messages: context, tools: start.readOnly ? [] : boundary.tools,
        }, {
          apiKey: boundary.auth.apiKey, headers: boundary.auth.headers, signal: abort.signal,
          maxTokens: Math.min(model.maxTokens, 8192), maxRetries: 0, timeoutMs: 120_000,
          sessionId: process.env.MOGURI_TURN_ID,
          onProviderStreamEvent: (event) => { usageReported ||= usagePresent(event); },
        });
        for await (const event of stream) if (event.type === "text_delta") {
          buffered += event.delta;
          if (buffered.length > 16_384) flush();
        }
        flush();
        const message = await stream.result();
        const accepted = await request({
          kind: "model.complete", requestId: randomUUID(), stepId, message,
          usageReported: usageReported && !["error", "aborted", "pending", "deferred"].includes(message.stopReason), generationMs: performance.now() - started,
        });
        if (accepted.error) throw new Error(accepted.error);
        context.push(message);
        if (message.stopReason === "aborted") throw new Error("Model request cancelled.");
        if (message.stopReason === "error") throw new Error("The provider request failed. Check Copilot access, model availability and context limits.");
        if (message.stopReason === "pending" || message.stopReason === "deferred") {
          await finish("partial", "The provider deferred completion. Deferred continuation is not supported; no result or retry is assumed.");
          return;
        }
        if (message.stopReason === "length") {
          await finish("partial", "The model reached its output limit. Review the partial response before continuing.");
          return;
        }
        const calls = toolCalls(message);
        if (start.readOnly && calls.length) throw new Error("The read-only subagent requested tools. No tools were executed.");
        if (calls.length === 0) {
          await finish("completed", null);
          return;
        }
        for (const call of calls) {
          abort.signal.throwIfAborted();
          const approval = await request({ kind: "approval", requestId: randomUUID(), stepId, call });
          let result: { text: string; isError: boolean; outcome: string };
          if (approval.error || !approval.value || !("allow" in approval.value) || !approval.value.allow) {
            result = { text: approval.error ?? "The user denied this tool request. No operation was executed.", isError: true, outcome: "denied" };
          } else {
            try {
              result = await executeTool(start.root, call, abort.signal, (text) => send({ kind: "output", stepId, callId: call.id, text }),
                (pid) => send({ kind: "process", stepId, callId: call.id, pid }),
                async (call) => {
                  const reply = await request({ kind: "delegate", requestId: randomUUID(), stepId, call });
                  if (reply.error || !reply.value || !("text" in reply.value)) throw new Error(reply.error ?? "Missing delegated result.");
                  return reply.value;
                });
            } catch (error) {
              result = { text: error instanceof Error ? error.message : "Tool execution failed.", isError: true, outcome: abort.signal.aborted ? "stopped" : "failed" };
            }
          }
          incompleteCleanup ||= result.outcome === "partial";
          await request({ kind: "tool.complete", requestId: randomUUID(), stepId, call, ...result });
          context.push({ role: "toolResult", toolCallId: call.id, toolName: call.name, content: [{ type: "text", text: result.text }], isError: result.isError, timestamp: Date.now() });
          if (incompleteCleanup) throw new Error("Owned process cleanup is unconfirmed. Inspect the partial tool result before continuing.");
        }
      } finally { clearInterval(timer); flush(); }
    }
    await finish("partial", "The 32-step safety limit was reached. Review the session before continuing.");
  } catch (error) {
    if (process.connected) await finish(
      incompleteCleanup ? "partial" : abort.signal.aborted ? "stopped" : "failed",
      abort.signal.aborted ? "Turn stopped. No automatic retry will run." : error instanceof Error ? error.message : "Worker failed.",
    );
    else console.error("Worker lost the control plane. Final outcome cannot be confirmed durably; no retry will run.");
  } finally {
    for (const waiter of pending.values()) waiter.reject(new Error("Worker finished."));
    pending.clear();
    if (process.connected) process.disconnect?.();
  }
}
let started = false;
process.on("message", (raw: unknown) => {
  const message = parentMessage(raw);
  if (message.kind === "start" && !started) { started = true; void run(message); }
  else if (message.kind === "reply") {
    const waiter = pending.get(message.requestId);
    pending.delete(message.requestId);
    waiter?.resolve(message);
  } else if (message.kind === "stop") {
    send({ kind: "ack" });
    abort.abort();
    for (const [id, waiter] of pending) if (waiter.interruptible) { waiter.reject(new Error("Turn stopped.")); pending.delete(id); }
  }
});
process.on("disconnect", () => {
  abort.abort();
  for (const waiter of pending.values()) waiter.reject(new Error("Control plane disconnected."));
  pending.clear();
});
process.on("SIGTERM", () => { abort.abort(); });
