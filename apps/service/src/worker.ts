import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createModels, type Message } from "@earendil-works/pi-ai";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { executeTool } from "./tools.ts";
import { assistantMessage, parentMessage, toolCalls, usagePresent, type BoundaryReply, type WorkerReply, type WorkerRequest, type WorkerStart } from "./worker-protocol.ts";
import { localProvider, localModelFetch } from "./local-provider.ts";
import { redactSecrets, SecretStreamRedactor } from "./secret-redactor.ts";
import { streamMetrics } from "./stream-metrics.ts";
import { executeUserPlan } from "./user-plan.ts";

const abort = new AbortController();
let authority = true;
let terminalRequested = false;
const pending = new Map<string, { resolve: (message: WorkerReply) => void; reject: (error: Error) => void; interruptible: boolean }>();
const send = (message: WorkerRequest) => { if (process.connected) process.send?.(message); };
async function request(message: WorkerRequest & { requestId: string }): Promise<WorkerReply> {
  if (!process.connected) throw new Error("The control plane disconnected before recording the outcome.");
  if (!authority) { send(message); throw new Error("Control authority disconnected; this result is retained for reconciliation only."); }
  const interruptible = message.kind === "boundary" || message.kind === "approval";
  if (interruptible) abort.signal.throwIfAborted();
  return new Promise((resolve, reject) => { pending.set(message.requestId, { resolve, reject, interruptible }); send(message); });
}
async function finish(outcome: "completed" | "stopped" | "failed" | "partial", diagnostic: string | null): Promise<void> {
  terminalRequested = true;
  await request({ kind: "finished", requestId: randomUUID(), outcome, diagnostic });
}
async function run(start: WorkerStart): Promise<void> {
  const context: Message[] = start.context;
  let incompleteCleanup = false;
  try {
    if (start.operation) {
      const operation = start.operation;
      if (!start.root) throw new Error("Owned user plan operation has no exact workspace.");
      const call = { id: operation.callId, name: "write_file", arguments: operation.input };
      const permission = await request({ kind: "approval", requestId: randomUUID(), stepId: operation.stepId, call });
      if (permission.error || !permission.value || !("allow" in permission.value) || !permission.value.allow) throw new Error(permission.error ?? "This exact user plan write was not authorized.");
      const result = await executeUserPlan(start.root, operation.input, abort.signal, { mode: permission.value.mode, folders: permission.value.folders });
      incompleteCleanup = result.fileOutcome !== "not-started" || result.createdDirectories.length > 0;
      const accepted = await request({ kind: "user-plan.complete", requestId: randomUUID(), stepId: operation.stepId, call, result });
      if (accepted.error) throw new Error(accepted.error);
      await finish(abort.signal.aborted && incompleteCleanup ? "partial" : result.outcome,
        abort.signal.aborted && incompleteCleanup ? "Stop arrived after filesystem work. Actual effects were retained; no rollback or complete save was inferred." : result.diagnostic);
      return;
    }
    const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
    models.setProvider(githubCopilotProvider());
    models.setProvider(localProvider());
    for (let index = 0; index < 32; index++) {
      abort.signal.throwIfAborted();
      const stepId = randomUUID();
      const reply = await request({ kind: "boundary", requestId: randomUUID(), stepId });
      if (reply.halt && reply.error) { await finish(abort.signal.aborted ? "stopped" : "partial", reply.error); return; }
      if (reply.error || !reply.value || !("model" in reply.value)) throw new Error(reply.error ?? "Missing model authorization.");
      const boundary: BoundaryReply = reply.value;
      const secrets = [...new Set([
        ...(boundary.auth.apiKey && boundary.auth.headers?.Authorization !== null ? [boundary.auth.apiKey] : []),
        ...Object.entries(boundary.auth.headers ?? {}).filter(([name, value]) => value && /authorization|api[-_]?key|auth[-_]?token/i.test(name)).flatMap(([, value]) => value ? [value, value.replace(/^Bearer\s+/i, "")] : []),
      ])];
      const redactor = new SecretStreamRedactor(secrets);
      context.push(...boundary.steers);
      const model = { ...boundary.model, baseUrl: boundary.auth.baseUrl ?? boundary.model.baseUrl };
      let usageReported = false;
      let buffered = "";
      const flush = () => { if (buffered) { const text = redactor.push(buffered); if (text) send({ kind: "delta", stepId, text }); buffered = ""; } };
      const timer = setInterval(flush, 50);
      const started = performance.now();
      const metrics = streamMetrics(started);
      try {
        const stream = models.streamSimple(model, {
          systemPrompt: boundary.systemPrompt,
          messages: boundary.context ?? context, tools: start.readOnly || boundary.phase === "router" || boundary.phase === "compaction" ? [] : boundary.tools,
        }, {
          apiKey: boundary.auth.apiKey, headers: boundary.auth.headers, signal: abort.signal,
          maxTokens: boundary.maxTokens, maxRetries: 0, timeoutMs: 120_000,
          ...(model.provider === "moguri-local" ? { fetch: localModelFetch } : {}),
          ...(boundary.thinkingEffort && boundary.thinkingEffort !== "off" ? { reasoning: boundary.thinkingEffort } : {}),
          sessionId: process.env.MOGURI_TURN_ID,
          onProviderStreamEvent: (event) => { usageReported ||= usagePresent(event); metrics.provider(event); },
        });
        for await (const event of stream) {
          metrics.output(event);
          if (event.type === "text_delta") {
            buffered += event.delta;
            if (buffered.length > 16_384) flush();
          }
        }
        flush();
        const tail = redactor.finish(); if (tail) send({ kind: "delta", stepId, text: tail });
        const message = assistantMessage(redactSecrets(await stream.result(), secrets));
        const accepted = await request({
          kind: "model.complete", requestId: randomUUID(), stepId, message,
          usageReported: usageReported && !["error", "aborted", "pending", "deferred"].includes(message.stopReason), generationMs: performance.now() - started, stream: metrics.snapshot(),
        });
        if (accepted.halt && accepted.error) { await finish(abort.signal.aborted ? "stopped" : "partial", accepted.error); return; }
        if (accepted.error) throw new Error(accepted.error);
        if (accepted.value && "accepted" in accepted.value && "continue" in accepted.value && accepted.value.continue === true) {
          if (boundary.phase !== "router") throw new Error("Only an owned router stage may request a solver continuation.");
          continue;
        }
        context.push(message);
        abort.signal.throwIfAborted();
        if (message.stopReason === "aborted") throw new Error("Model request cancelled.");
        if (message.stopReason === "error") throw new Error("The provider request failed. Check the selected provider, model availability and context limits.");
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
                }, { mode: approval.value.mode, folders: approval.value.folders });
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
    if (process.connected && authority) {
      try {
        await finish(incompleteCleanup ? "partial" : abort.signal.aborted ? "stopped" : "failed",
          abort.signal.aborted ? "Turn stopped. No automatic retry will run." : error instanceof Error ? error.message : "Worker failed.");
      } catch { console.error("Worker terminal acknowledgement was lost. Its outcome must be reconciled; no retry will run."); }
    }
    else {
      if (process.connected && !terminalRequested) send({ kind: "finished", requestId: randomUUID(), outcome: "partial", diagnostic: "Control disconnected. Owned cancellation settled or remains partial; no further effect was authorized. Reconcile retained remote results without replay." });
      console.error("Worker lost the control plane. Final outcome cannot be confirmed durably; no retry will run.");
    }
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
  } else if (message.kind === "stop" || message.kind === "control-lost") {
    if (message.kind === "control-lost") authority = false;
    send({ kind: "ack" });
    abort.abort();
    for (const [id, waiter] of pending) if (waiter.interruptible || !authority) { waiter.reject(new Error("Turn stopped or control authority disconnected.")); pending.delete(id); }
  }
});
process.on("disconnect", () => {
  abort.abort();
  for (const waiter of pending.values()) waiter.reject(new Error("Control plane disconnected."));
  pending.clear();
});
process.on("SIGTERM", () => {
  authority = false;
  abort.abort();
  for (const waiter of pending.values()) waiter.reject(new Error("Worker termination cancelled the unacknowledged exchange. Its outcome remains unconfirmed."));
  pending.clear();
  if (!started && process.connected) process.disconnect?.();
});
