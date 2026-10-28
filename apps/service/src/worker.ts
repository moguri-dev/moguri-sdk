import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createModels, type Message } from "@earendil-works/pi-ai";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { executeTool } from "./tools.ts";
import { assistantMessage, parentMessage, toolCalls, usagePresent, type BoundaryReply, type DelegatedResult, type WorkerReply, type WorkerRequest, type WorkerStart } from "./worker-protocol.ts";
import { isRecord, type ToolCall } from "../../../packages/protocol/src/index.ts";
import { localProvider, localModelFetch } from "./local-provider.ts";
import { redactSecrets, SecretStreamRedactor } from "./secret-redactor.ts";
import { streamMetrics } from "./stream-metrics.ts";
import { executeUserPlan } from "./user-plan.ts";
import { executeRemoteMcp } from "./remote-mcp-runtime.ts";
import { executeCompoundValidation } from "./compound-validation.ts";
import { discoverTools } from "./tool-catalog.ts";
import { OwnedDebugRuntime } from "./owned-debug.ts";

const abort = new AbortController();
let authority = true;
let terminalRequested = false;
let debuggerRuntime: OwnedDebugRuntime | undefined;
const pending = new Map<string, { resolve: (message: WorkerReply) => void; reject: (error: Error) => void; interruptible: boolean }>();
const send = (message: WorkerRequest) => { if (process.connected) process.send?.(message); };
async function request(message: WorkerRequest & { requestId: string }): Promise<WorkerReply> {
  if (!process.connected) throw new Error("The control plane disconnected before recording the outcome.");
  if (!authority) { send(message); throw new Error("Control authority disconnected; this result is retained for reconciliation only."); }
  const interruptible = message.kind === "boundary" || message.kind === "approval" || message.kind === "hook" || message.kind === "validation.boundary";
  if (interruptible) abort.signal.throwIfAborted();
  return new Promise((resolve, reject) => { pending.set(message.requestId, { resolve, reject, interruptible }); send(message); });
}
async function finish(outcome: "completed" | "stopped" | "failed" | "partial", diagnostic: string | null): Promise<void> {
  if (debuggerRuntime && !await debuggerRuntime.close()) { outcome = "partial"; diagnostic = "Debugger process cleanup/retention was not acknowledged. Inspect the original target before resuming."; }
  terminalRequested = true;
  await request({ kind: "finished", requestId: randomUUID(), outcome, diagnostic });
}
async function run(start: WorkerStart): Promise<void> {
  const context: Message[] = start.context;
  const loadedTools = new Set<string>();
  const instructionSources = new Set<string>();
  let kupoDraft: { stepId: string; message: ReturnType<typeof assistantMessage> } | undefined;
  debuggerRuntime = start.readOnly ? undefined : new OwnedDebugRuntime();
  let incompleteCleanup = false, mcpDispatched = false;
  const lifecycle = async (trigger: "turn.start" | "turn.end") => {
    for (const hook of start.hooks?.filter((hook) => hook.definition.trigger === trigger) ?? []) {
      abort.signal.throwIfAborted();
      const stepId = randomUUID(), call: ToolCall = { id: randomUUID(), name: "run_command",
        arguments: { command: hook.definition.command, timeoutMs: hook.definition.timeoutMs },
        hook: { id: hook.id, revision: hook.revision, contentDigest: hook.contentDigest, trigger, actor: "user-configured-hook" } };
      const permission = await request({ kind: "hook", requestId: randomUUID(), stepId, call });
      if (permission.halt && permission.error) throw new Error(permission.error);
      let result: DelegatedResult;
      if (permission.error || !permission.value || !("allow" in permission.value) || !permission.value.allow) result = {
        text: permission.error ?? "The user denied the lifecycle hook. No command was executed.", isError: true, outcome: "denied",
      };
      else {
        try {
          result = await executeTool(start.root, call, abort.signal,
            (text) => send({ kind: "output", stepId, callId: call.id, text }),
            (pid) => send({ kind: "process", stepId, callId: call.id, pid }), undefined,
            { mode: permission.value.mode, folders: permission.value.folders });
        } catch (error) {
          result = { text: error instanceof Error ? error.message : "Lifecycle hook failed.", isError: true, outcome: abort.signal.aborted ? "partial" : "failed" };
        }
      }
      incompleteCleanup ||= result.outcome === "partial";
      const retained = await request({ kind: "tool.complete", requestId: randomUUID(), stepId, call, ...result });
      if (retained.error || !retained.value || !("accepted" in retained.value) || retained.value.accepted !== true) throw new Error(retained.error ?? "The exact lifecycle-hook result was not durably acknowledged.");
      if (result.isError || result.outcome !== "completed") throw new Error(`Lifecycle hook ${hook.definition.name} did not complete: ${result.text}`);
    }
  };
  const delegate = async (stepId: string, call: ToolCall): Promise<DelegatedResult> => {
    const reply = await request({ kind: "delegate", requestId: randomUUID(), stepId, call, quiescent: debuggerRuntime?.quiescent ?? true });
    if (reply.error || !reply.value) throw new Error(reply.error ?? "Missing delegated authorization.");
    if ("kind" in reply.value && reply.value.kind === "remote-mcp") {
      const result = await executeRemoteMcp(reply.value, { call, stepId, root: start.root, env: start.env }, abort.signal,
        (pid) => send({ kind: "process", stepId, callId: call.id, pid }));
      mcpDispatched ||= result.dispatched;
      try {
        const retained = await request({ kind: "mcp.complete", requestId: randomUUID(), stepId, call, result });
        if (retained.error || !retained.value || !("text" in retained.value)) throw new Error(retained.error ?? "Remote MCP result retention was not acknowledged.");
        incompleteCleanup ||= result.outcome === "partial";
        return retained.value;
      } catch (error) { incompleteCleanup ||= result.dispatched; throw error; }
    }
    if (!("text" in reply.value)) throw new Error("Missing delegated result.");
    return reply.value;
  };
  try {
    if (start.operation?.kind === "mcp.call") {
      const result = await delegate(start.operation.stepId, start.operation.call);
      incompleteCleanup ||= result.outcome === "partial" || abort.signal.aborted && mcpDispatched;
      await finish(incompleteCleanup ? "partial" : abort.signal.aborted ? "stopped" : result.isError ? "failed" : "completed",
        incompleteCleanup ? "Remote MCP may already have external effects. Actual results were retained; stop/control loss is not rollback." : result.isError ? result.text : null);
      return;
    }
    if (start.operation?.kind === "plan.save") {
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
    await lifecycle("turn.start");
    const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
    models.setProvider(githubCopilotProvider());
    models.setProvider(localProvider());
    for (let index = 0; index < 32; index++) {
      abort.signal.throwIfAborted();
      let stepId: string = randomUUID();
      const reply = await request({ kind: "boundary", requestId: randomUUID(), stepId, loadedTools: [...loadedTools] });
      if (reply.halt && reply.error) { await finish(abort.signal.aborted ? "stopped" : "partial", reply.error); return; }
      if (reply.error || !reply.value || !("model" in reply.value)) throw new Error(reply.error ?? "Missing model authorization.");
      const boundary: BoundaryReply = reply.value;
      if (boundary.phase?.startsWith("kupo-") && start.automaticKupo !== true) throw new Error("This worker does not own automatic Kupo response review. No model call or tool request was dispatched.");
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
          messages: boundary.context ?? context, tools: start.readOnly || boundary.phase === "router" || boundary.phase === "kupo-gate" || boundary.phase === "kupo-critic" || boundary.phase === "compaction" || boundary.phase === "candidate" || boundary.phase === "checkpoint" ? [] : boundary.tools,
        }, {
          apiKey: boundary.auth.apiKey, headers: boundary.auth.headers, signal: abort.signal,
          maxTokens: boundary.maxTokens, maxRetries: 0, timeoutMs: 120_000,
          ...(model.provider === "moguri-local" || start.env === "Sandbox" ? { fetch: localModelFetch } : {}),
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
        let message = assistantMessage(redactSecrets(await stream.result(), secrets));
        if (boundary.phase === "kupo-draft") kupoDraft = { stepId, message };
        let accepted = await request({
          kind: "model.complete", requestId: randomUUID(), stepId, message,
          usageReported: usageReported && !["error", "aborted", "pending", "deferred"].includes(message.stopReason), generationMs: performance.now() - started, stream: metrics.snapshot(),
        });
        if (accepted.halt && accepted.error) { await finish(abort.signal.aborted ? "stopped" : "partial", accepted.error); return; }
        if (accepted.error) throw new Error(accepted.error);
        if (!accepted.value || !("accepted" in accepted.value) || accepted.value.accepted !== true) throw new Error("Model completion was not durably acknowledged. No success or next role was inferred.");
        if (boundary.phase?.startsWith("kupo-") && (!usageReported || !["stop", "toolUse"].includes(message.stopReason) ||
          !Number.isSafeInteger(message.usage.totalTokens) || !Number.isSafeInteger(message.usage.output) ||
          message.usage.output < 0 || message.usage.output > message.usage.totalTokens || message.usage.output > boundary.maxTokens ||
          (boundary.phase === "kupo-gate" || boundary.phase === "kupo-critic") && (message.stopReason !== "stop" || toolCalls(message).length))) {
          throw new Error("Automatic Kupo continuation requires a complete metered response and tool-less review inside the actual output bound.");
        }
        if ("validation" in accepted.value && accepted.value.validation) {
          if (start.publicCompound !== true || start.readOnly !== true || start.root !== null || boundary.phase !== "candidate" ||
            message.stopReason !== "stop" || toolCalls(message).length || !usageReported ||
            !Number.isSafeInteger(message.usage.totalTokens) || !Number.isSafeInteger(message.usage.output) || message.usage.output < 0 ||
            message.usage.output > message.usage.totalTokens || message.usage.output > boundary.maxTokens) throw new Error("Only a complete metered public compound role may enter a separately reviewed validation operation. Private roles and model tools cannot grant it.");
          const validation = accepted.value.validation;
          const permission = await request({ kind: "validation.boundary", requestId: randomUUID(), stepId, validationId: validation.validationId });
          if (permission.error || !permission.value || !("accepted" in permission.value) || permission.value.accepted !== true) throw new Error(permission.error ?? "The exact actual-user validation was not durably admitted.");
          const result = await executeCompoundValidation(validation, abort.signal,
            (text) => send({ kind: "output", stepId, callId: validation.validationId, text }),
            (pid) => send({ kind: "process", stepId, callId: validation.validationId, pid }));
          incompleteCleanup ||= result.outcome === "partial";
          accepted = await request({ kind: "validation.complete", requestId: randomUUID(), stepId, validationId: validation.validationId, result });
          if (accepted.halt && accepted.error) { await finish(abort.signal.aborted ? "stopped" : "partial", accepted.error); return; }
          if (accepted.error || !accepted.value || !("accepted" in accepted.value) || accepted.value.accepted !== true) throw new Error(accepted.error ?? "Actual validation was not durably acknowledged. No candidate, successful test or next role was inferred.");
        }
        if ("continue" in accepted.value && accepted.value.continue === true) {
          abort.signal.throwIfAborted();
          if (boundary.phase !== "router" && boundary.phase !== "candidate" && !boundary.phase?.startsWith("kupo-")) throw new Error("Only an owned router, reviewed Kupo response or tool-less candidate stage may request a continuation.");
          if (boundary.phase === "candidate") {
            if (start.readOnly !== true || start.root !== null || message.stopReason !== "stop" || toolCalls(message).length) throw new Error("Candidate continuation requires a root-less read-only owner and a complete tool-less result. No next role was authorized.");
            if (!usageReported || !Number.isSafeInteger(boundary.maxTokens) || boundary.maxTokens < 1 || boundary.maxTokens > model.maxTokens ||
              !Number.isSafeInteger(message.usage.totalTokens) || !Number.isSafeInteger(message.usage.output) ||
              message.usage.output < 0 || message.usage.output > message.usage.totalTokens || message.usage.output > boundary.maxTokens) throw new Error("Candidate continuation requires valid reported usage within its actual output bound. No unknown/free next role was authorized.");
          }
          continue;
        }
        if (boundary.phase?.startsWith("kupo-")) {
          if (!("selectedResponse" in accepted.value) || !accepted.value.selectedResponse) throw new Error("No original Kupo response was selected. Unselected tool requests cannot execute.");
          const selected = accepted.value.selectedResponse, original = boundary.phase === "kupo-gate" || boundary.phase === "kupo-critic" ? kupoDraft : { stepId, message };
          const exact = (message: ReturnType<typeof assistantMessage>) => JSON.stringify({ api: message.api, provider: message.provider, model: message.model,
            content: message.content, stopReason: message.stopReason, timestamp: message.timestamp, usage: message.usage });
          const selectedMessage = assistantMessage(selected.message);
          if (!original || selected.stepId !== original.stepId || exact(selectedMessage) !== exact(original.message)) throw new Error("Kupo selection changed the original response identity or bytes. No tools were executed.");
          stepId = selected.stepId; message = selectedMessage; kupoDraft = undefined;
        } else if ("selectedResponse" in accepted.value) throw new Error("Only automatic Kupo may select an original reviewed response.");
        context.push(message);
        abort.signal.throwIfAborted();
        if (message.stopReason === "aborted") throw new Error("Model request cancelled.");
        if (message.stopReason === "error") throw new Error("The provider request failed. Check the selected provider, model availability and context limits.");
        if (message.stopReason === "pending" || message.stopReason === "deferred") {
          await finish("partial", "The provider deferred completion. Deferred continuation is not supported; no result or retry is assumed.");
          return;
        }
        const calls = toolCalls(message);
        if (message.stopReason === "length") {
          await finish("partial", `The model reached this response's ${boundary.maxTokens}-token output limit.${model.reasoning ? " Reasoning counts toward this limit." : ""}${calls.length ? " No tools from this incomplete response were executed." : ""} Review the partial response before continuing.`);
          return;
        }
        if (start.readOnly && calls.length) throw new Error("The read-only subagent requested tools. No tools were executed.");
        if (calls.length === 0) {
          if (boundary.phase === "solver" || boundary.phase?.startsWith("kupo-") || boundary.phase === undefined) await lifecycle("turn.end");
          await finish("completed", null);
          return;
        }
        for (const [callIndex, call] of calls.entries()) {
          abort.signal.throwIfAborted();
          const approval = await request({ kind: "approval", requestId: randomUUID(), stepId, call });
          let result: DelegatedResult;
          if (approval.error || !approval.value || !("allow" in approval.value) || !approval.value.allow) {
            result = { text: approval.error ?? "The user denied this tool request. No operation was executed.", isError: true, outcome: "denied" };
          } else {
            try {
              result = await executeTool(approval.value.root === undefined ? start.root : approval.value.root, call, abort.signal, (text) => send({ kind: "output", stepId, callId: call.id, text }),
                (pid) => send({ kind: "process", stepId, callId: call.id, pid }),
                (call) => delegate(stepId, call), { mode: approval.value.mode, folders: approval.value.folders, env: start.env, homeRoot: approval.value.homeRoot, webAccess: approval.value.webAccess }, boundary.toolCatalog ?? boundary.tools,
                debuggerRuntime ? { runtime: debuggerRuntime, ended: async (pid, outcome) => {
                  const reply = await request({ kind: "process.ended", requestId: randomUUID(), stepId, callId: call.id, pid, outcome });
                  if (reply.error || !reply.value || !("accepted" in reply.value) || reply.value.accepted !== true) throw new Error(reply.error ?? "Process cleanup observation was not retained.");
                } } : undefined);
            } catch (error) {
              result = { text: error instanceof Error ? error.message : "Tool execution failed.", isError: true, outcome: incompleteCleanup || error instanceof Error && "code" in error && error.code === "tool_partial" ? "partial" : abort.signal.aborted ? "stopped" : "failed" };
            }
          }
          if (call.name === "discover_tools" && !result.isError) {
            for (const tool of discoverTools(boundary.toolCatalog ?? boundary.tools, String(call.arguments.query), Number(call.arguments.offset ?? 0)).tools) loadedTools.add(tool.name);
          }
          if (["read_file", "inspect_document"].includes(call.name) && !result.isError) {
            const view: unknown = JSON.parse(result.text);
            if (isRecord(view) && Array.isArray(view.instructions)) {
              const prefix = `${String(call.arguments.repository ?? "")}:`;
              const refs = view.instructions.filter(isRecord).map((source) => `${prefix}${String(source.path)}:${String(source.digest)}`);
              view.instructions = view.instructions.filter((source) => isRecord(source) && !instructionSources.has(`${prefix}${String(source.path)}:${String(source.digest)}`));
              for (const ref of refs) instructionSources.add(ref);
              result.text = JSON.stringify(view);
            }
          }
          if (result.rawText !== undefined) {
            if (result.rawText.length > 2 * 1024 * 1024) throw new Error("The original result exceeds its retained-output bound. No complete source or next step was inferred.");
            const view: unknown = JSON.parse(result.text);
            if (!isRecord(view)) throw new Error("A retained result needs an explicit structured view.");
            result.text = JSON.stringify({ ...view, retainedSource: { stepId, callId: call.id, rawComplete: result.rawComplete === true } });
          }
          incompleteCleanup ||= result.outcome === "partial";
          const retained = await request({ kind: "tool.complete", requestId: randomUUID(), stepId, call, ...result });
          if (retained.error || !retained.value || !("accepted" in retained.value) || retained.value.accepted !== true) throw new Error(retained.error ?? "The original tool result was not durably acknowledged; no continuation was authorized.");
          context.push({ role: "toolResult", toolCallId: call.id, toolName: call.name, content: [{ type: "text", text: result.text }], isError: result.isError, timestamp: Date.now() });
          if (incompleteCleanup) throw new Error("Tool side effects are partial or cleanup is unconfirmed. Inspect the partial tool result before continuing.");
          if (result.endTurn) {
            if (call.name !== "project_work" || call.arguments.action !== "publish" || result.isError || result.outcome !== "completed") throw new Error("Only an acknowledged project-work publication can end this turn.");
            for (const skipped of calls.slice(callIndex + 1)) {
              const retained = await request({ kind: "tool.complete", requestId: randomUUID(), stepId, call: skipped,
                text: "Not executed: the user-delegated task reached its verified PR endpoint. No remaining tool was approved or run.",
                isError: true, outcome: "denied" });
              if (retained.error || !retained.value || !("accepted" in retained.value) || retained.value.accepted !== true) throw new Error("Unexecuted post-publication tool results were not retained.");
            }
            await lifecycle("turn.end");
            await finish("completed", null);
            return;
          }
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
    await debuggerRuntime?.close();
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
