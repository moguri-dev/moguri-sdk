import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Message } from "@earendil-works/pi-ai";
import { executeTool } from "./tools.ts";
import { assistantMessage, contextMessages, parentMessage, toolCalls, normalizeToolCallIds, isOwnedModelRequest, type BoundaryReply, type DelegatedResult, type WorkerReply, type WorkerRequest, type WorkerStart } from "./worker-protocol.ts";
import { isRecord, type ToolCall } from "../../../packages/protocol/src/index.ts";
import { retainedToolText } from "../../../packages/protocol/src/tooling.ts";
import { streamWorkerModel } from "./worker-model.ts";
import { executeUserPlan } from "./user-plan.ts";
import { executeRemoteMcp } from "./remote-mcp-runtime.ts";
import { executeCompoundValidation } from "./compound-validation.ts";
import { discoverTools } from "./tool-catalog.ts";
import { OwnedDebugRuntime } from "./owned-debug.ts";
import { resolveDirectMcpCall, modelToolName } from "./direct-mcp-tools.ts";
import { executeCandidateOperation } from "./candidate-worker.ts";
import { frameDigest } from "./worker-wire.ts";
import type { CandidateWorkerOperation } from "./candidate-worker-protocol.ts";
import { executeWorkspaceRewind, validateRemoteRewindOperation } from "./workspace-rewind-worker.ts";

const abort = new AbortController();
let authority = true;
let terminalRequested = false;
let debuggerRuntime: OwnedDebugRuntime | undefined;
const pending = new Map<string, { resolve: (message: WorkerReply) => void; reject: (error: Error) => void; interruptible: boolean; kind: WorkerRequest["kind"]; ownerId?: string }>();
let parentStart: WorkerStart | undefined;
let ownedModel: { id: string; abort: AbortController; done: Promise<void> } | undefined;
const ownedModelIds = new Set<string>();
let candidateOperation: { id: string; abort: AbortController; done: Promise<void> } | undefined;
const candidateOperationIds = new Set<string>();
const send = (message: WorkerRequest) => { if (process.connected) process.send?.(message); };
async function request(message: WorkerRequest & { requestId: string }): Promise<WorkerReply> {
  if (!process.connected) throw new Error("The control plane disconnected before recording the outcome.");
  if (!authority) { send(message); throw new Error("Control authority disconnected; this result is retained for reconciliation only."); }
  const interruptible = message.kind === "boundary" || message.kind === "title.boundary" || message.kind === "approval" || message.kind === "hook" || message.kind === "validation.boundary" ||
    message.kind === "owned-model.boundary" || message.kind === "candidate.boundary" && message.phase !== "observed" ||
    message.kind === "workspace.rewind.intent" || message.kind === "workspace.rewind.boundary" && message.phase === "moving";
  if (interruptible) abort.signal.throwIfAborted();
  return new Promise((resolve, reject) => { pending.set(message.requestId, { resolve, reject, interruptible, kind: message.kind,
    ...(isOwnedModelRequest(message) ? { ownerId: message.ownerId } :
      message.kind === "candidate.boundary" || message.kind === "candidate.complete" || message.kind === "candidate.finished" ? { ownerId: message.operationId } : {}) }); send(message); });
}
async function finish(outcome: "completed" | "stopped" | "failed" | "partial", diagnostic: string | null): Promise<void> {
  if (ownedModel) { ownedModel.abort.abort(); await ownedModel.done; }
  if (candidateOperation) { candidateOperation.abort.abort(); await candidateOperation.done; }
  if (debuggerRuntime && !await debuggerRuntime.close()) { outcome = "partial"; diagnostic = "Debugger process cleanup/retention was not acknowledged. Inspect the original target before resuming."; }
  terminalRequested = true;
  await request({ kind: "finished", requestId: randomUUID(), outcome, diagnostic });
}
async function runCandidateOperation(operation: CandidateWorkerOperation, signal: AbortSignal): Promise<void> {
  const operationDigest = frameDigest(operation);
  let outcome: "completed" | "failed" | "partial" = "failed", attempted = false;
  try {
    const boundary = async (phase: "operation" | "attempt" | "observed", path: string | null) => {
      const reply = await request({ kind: "candidate.boundary", requestId: randomUUID(), operationId: operation.operationId, operationDigest, phase, path });
      if (reply.error || reply.halt || !reply.value || !("accepted" in reply.value) || reply.value.accepted !== true) throw new Error("Owned candidate boundary was not durably acknowledged.");
      if (phase === "attempt") attempted = true;
      signal.throwIfAborted();
    };
    await boundary("operation", null);
    const result = await executeCandidateOperation(parentStart!.root!, operation, signal, boundary);
    const reply = await request({ kind: "candidate.complete", requestId: randomUUID(), operationId: operation.operationId, operationDigest, result });
    if (reply.error || reply.halt || !reply.value || !("accepted" in reply.value) || reply.value.accepted !== true) throw new Error("Original candidate result acknowledgement was lost.");
    outcome = signal.aborted ? "partial" : "completed";
  } catch { outcome = attempted || signal.aborted ? "partial" : "failed"; }
  try {
    const reply = await request({ kind: "candidate.finished", requestId: randomUUID(), operationId: operation.operationId, operationDigest, outcome,
      diagnostic: outcome === "completed" ? null : "Original owned candidate operation ended without a complete result. Possible effects remain retained; no replay, fallback or successful cancellation." });
    if (reply.error || !reply.value || !("accepted" in reply.value) || reply.value.accepted !== true) throw new Error("Original candidate terminal acknowledgement was lost.");
    send({ kind: "candidate.released", operationId: operation.operationId, operationDigest, outcome });
  } catch { console.error("Owned candidate operation lost its terminal acknowledgement. No effect replay or complete cleanup was inferred."); }
}
async function runOwnedModel(id: string, signal: AbortSignal): Promise<void> {
  let outcome: "completed" | "stopped" | "failed" | "partial" = "failed", dispatched = false;
  try {
    signal.throwIfAborted();
    const stepId = randomUUID(), reply = await request({ kind: "owned-model.boundary", ownerId: id, requestId: randomUUID(), stepId });
    if (reply.error || reply.halt || !reply.value || !("model" in reply.value)) throw new Error("Original tool-less model admission was not acknowledged.");
    const boundary = reply.value, context = contextMessages(boundary.context);
    if (!["decision", "steering"].includes(boundary.phase ?? "") || boundary.mode !== "read-only" || boundary.tools.length ||
      boundary.steers.length || !Number.isSafeInteger(boundary.maxTokens) || boundary.maxTokens < 1 ||
      boundary.maxTokens > boundary.model.maxTokens || Buffer.byteLength(JSON.stringify({ systemPrompt: boundary.systemPrompt, context })) > 128 * 1024 ||
      context.some((message) => message.role !== "user" || typeof message.content !== "string")) {
      throw new Error("Owned subcall cannot acquire tools, original history, filesystem context or an unbounded model envelope.");
    }
    signal.throwIfAborted(); dispatched = true;
    const result = await streamWorkerModel(boundary, context, [], parentStart?.env, signal);
    const retained = await request({ kind: "owned-model.complete", ownerId: id, requestId: randomUUID(), stepId, ...result });
    if (retained.error || !retained.value || !("accepted" in retained.value) || retained.value.accepted !== true) {
      throw new Error("Original private model result was not durably acknowledged.");
    }
    if (signal.aborted || result.message.stopReason !== "stop" || toolCalls(result.message).length || !result.usageReported ||
      !Number.isSafeInteger(result.message.usage.totalTokens) || !Number.isSafeInteger(result.message.usage.output) ||
      result.message.usage.output < 0 || result.message.usage.output > result.message.usage.totalTokens ||
      result.message.usage.output > boundary.maxTokens) throw new Error("Owned subcall has no complete within-bound metered tool-less result.");
    outcome = "completed";
  } catch {
    outcome = signal.aborted ? "stopped" : dispatched ? "partial" : "failed";
    console.error("Owned tool-less model subcall ended without an accepted complete result:", outcome);
  }
  try {
    const acknowledged = await request({ kind: "owned-model.finished", ownerId: id, requestId: randomUUID(), outcome,
      diagnostic: outcome === "completed" ? null : "The exact tool-less subcall ended incomplete or cancelled. Original result/charges remain retained; no effect, retry or success was inferred." });
    if (acknowledged.error || !acknowledged.value || !("accepted" in acknowledged.value) || acknowledged.value.accepted !== true) {
      throw new Error("Private terminal result was not acknowledged.");
    }
    send({ kind: "owned-model.released", ownerId: id, outcome });
  } catch { console.error("Owned subcall terminal acknowledgement was lost. Its accounting/cleanup remain unconfirmed; no replay."); }
}
async function run(start: WorkerStart): Promise<void> {
  const context: Message[] = start.context;
  const loadedTools = new Set<string>(start.retry?.loadedTools);
  const instructionSources = new Set<string>(start.retry?.instructionSources);
  let kupoDraft: { stepId: string; message: ReturnType<typeof assistantMessage> } | undefined = start.retry?.kupoDraft;
  debuggerRuntime = start.readOnly || start.operation ? undefined : new OwnedDebugRuntime();
  let incompleteCleanup = false, mcpDispatched = false;
  const nameChat = async (): Promise<boolean> => {
    if (!start.chatTitles) return true;
    const stepId = randomUUID(), reply = await request({ kind: "title.boundary", requestId: randomUUID(), stepId });
    if (reply.error || reply.halt || !reply.value) throw new Error(reply.error ?? "Naming admission was not acknowledged.");
    if (!("model" in reply.value)) {
      if (!("accepted" in reply.value) || !reply.value.accepted) throw new Error("The original naming decision was not acknowledged.");
      return true;
    }
    const boundary = reply.value, input = contextMessages(boundary.context);
    if (boundary.phase !== "title" || boundary.mode !== "read-only" || boundary.tools.length || boundary.steers.length ||
      !Number.isSafeInteger(boundary.maxTokens) || boundary.maxTokens < 1 || boundary.maxTokens > 128 ||
      input.length !== 1 || input[0]?.role !== "user" || typeof input[0].content !== "string" ||
      Buffer.byteLength(JSON.stringify({ systemPrompt: boundary.systemPrompt, context: input })) > 128 * 1024) {
      throw new Error("Naming cannot acquire tools, ordinary history, an unbounded envelope or another execution owner.");
    }
    abort.signal.throwIfAborted();
    const result = await streamWorkerModel(boundary, input, [], start.env, AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]));
    const retained = await request({ kind: "model.complete", requestId: randomUUID(), stepId, ...result });
    if (retained.error || !retained.value || !("accepted" in retained.value) || retained.value.accepted !== true) {
      throw new Error("The original naming result and charge were not durably acknowledged.");
    }
    return retained.value.titleStatus !== "partial";
  };
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
    if (start.operation?.kind === "workspace.rewind") {
      const operation = start.operation, operationDigest = frameDigest(operation);
      if (!start.root || start.env !== "Remote" || operation.env !== "Remote" || start.context.length || start.readOnly ||
        operation.plan.root.root !== start.root || operation.operationId !== process.env.MOGURI_TURN_ID ||
        operation.workerDigest !== createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex")) {
        throw new Error("Workspace restoration requires its exact independent model-free SSH worker/root/build owner.");
      }
      validateRemoteRewindOperation(operation);
      const acknowledge = async (message: Parameters<typeof request>[0]) => {
        const reply = await request(message);
        if (reply.error || reply.halt || !reply.value || !("accepted" in reply.value) || reply.value.accepted !== true) {
          throw new Error("Original workspace restoration boundary/result was not durably acknowledged.");
        }
      };
      await acknowledge({ kind: "workspace.rewind.intent", requestId: randomUUID(), operation });
      const result = await executeWorkspaceRewind(start.root, operation, abort.signal, async (index, phase, result) => {
        await acknowledge({ kind: "workspace.rewind.boundary", requestId: randomUUID(), operationId: operation.operationId,
          operationDigest, index, phase, ...(result ? { result } : {}) });
        if (phase === "moving" && operation.plan.files[index]?.choice === "restore-checkpoint") incompleteCleanup = true;
      });
      await acknowledge({ kind: "workspace.rewind.complete", requestId: randomUUID(), operationId: operation.operationId, operationDigest, result });
      await finish(abort.signal.aborted ? "partial" : "completed",
        abort.signal.aborted ? "Stop arrived after workspace effects. Original displaced inodes and results remain retained; no rollback or success was inferred." : null);
      return;
    }
    if (start.operation?.kind === "candidate.operation") {
      const operation = start.operation, operationDigest = frameDigest(operation);
      if (!start.root || operation.scope.env !== start.env || operation.scope.boundary.sourceRoot !== start.root) throw new Error("Owned candidate operation lost its exact parent root/Env.");
      const acknowledged = async (phase: "operation" | "attempt" | "observed", path: string | null) => {
        const reply = await request({ kind: "candidate.boundary", requestId: randomUUID(), operationId: operation.operationId, operationDigest, phase, path });
        if (reply.error || reply.halt || !reply.value || !("accepted" in reply.value) || reply.value.accepted !== true) throw new Error("The original candidate boundary was not durably acknowledged.");
        if (phase === "attempt") incompleteCleanup = true;
      };
      await acknowledged("operation", null);
      const result = await executeCandidateOperation(start.root, operation, abort.signal, acknowledged);
      const reply = await request({ kind: "candidate.complete", requestId: randomUUID(), operationId: operation.operationId, operationDigest, result });
      if (reply.error || reply.halt || !reply.value || !("accepted" in reply.value) || reply.value.accepted !== true) throw new Error("The original candidate result was not durably acknowledged.");
      await finish(abort.signal.aborted ? "partial" : "completed", abort.signal.aborted ? "Stop arrived after candidate effects. Original result remains retained; no success or rollback was inferred." : null);
      return;
    }
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
    if (!start.retry) await lifecycle("turn.start");
    for (let index = 0; index < (start.retry?.remainingSteps ?? 32); index++) {
      if (ownedModel) await ownedModel.done;
      abort.signal.throwIfAborted();
      let stepId: string = randomUUID();
      const reply = await request({ kind: "boundary", requestId: randomUUID(), stepId, loadedTools: [...loadedTools] });
      if (reply.halt && reply.error) { await finish(abort.signal.aborted ? "stopped" : "partial", reply.error); return; }
      if (reply.error || !reply.value || !("model" in reply.value)) throw new Error(reply.error ?? "Missing model authorization.");
      const boundary: BoundaryReply = reply.value;
      if (boundary.phase?.startsWith("kupo-") && start.automaticKupo !== true) throw new Error("This worker does not own automatic Kupo response review. No model call or tool request was dispatched.");
      context.push(...boundary.steers);
      if (start.retainModelRequests && (boundary.phase === undefined || boundary.phase === "solver" || boundary.phase === "router" ||
        boundary.phase.startsWith("kupo-"))) {
        const retained = await request({ kind: "model.dispatch", requestId: randomUUID(), stepId, context: boundary.context ?? context,
          loadedTools: [...loadedTools], instructionSources: [...instructionSources] });
        if (retained.error || !retained.value || !("accepted" in retained.value) || retained.value.accepted !== true) throw new Error(retained.error ?? "The original model request was not durably bound. No inference was dispatched.");
      }
      const model = { ...boundary.model, baseUrl: boundary.auth.baseUrl ?? boundary.model.baseUrl };
      {
        const streamed = await streamWorkerModel(boundary, boundary.context ?? context,
          start.readOnly || boundary.phase === "router" || boundary.phase === "kupo-gate" || boundary.phase === "kupo-critic" ||
          boundary.phase === "compaction" || boundary.phase === "candidate" || boundary.phase === "checkpoint" ? [] : boundary.tools,
          start.env, abort.signal, (text) => send({ kind: "delta", stepId, text }));
        const usageReported = streamed.usageReported;
        let message = normalizeToolCallIds(streamed.message, stepId);
        if (boundary.phase === "kupo-draft" || boundary.phase === "kupo-revision" || boundary.phase === "kupo-escalation") kupoDraft = { stepId, message };
        let accepted = await request({
          kind: "model.complete", requestId: randomUUID(), stepId, message,
          usageReported, generationMs: streamed.generationMs, stream: streamed.stream,
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
          const validation = accepted.value.validation, scope = validation.scope;
          if (start.publicCompound !== true || start.readOnly !== true || boundary.phase !== "candidate" ||
             (start.env === "Local" ? start.root !== null || validation.stage.env !== "Local" :
               !start.root || !scope || scope.env !== start.env ||
               scope.boundary.sourceRoot !== start.root || validation.source?.root !== start.root) ||
            message.stopReason !== "stop" || toolCalls(message).length || !usageReported ||
            !Number.isSafeInteger(message.usage.totalTokens) || !Number.isSafeInteger(message.usage.output) || message.usage.output < 0 ||
            message.usage.output > message.usage.totalTokens || message.usage.output > boundary.maxTokens) throw new Error("Only a complete metered public compound role may enter a separately reviewed validation operation. Private roles and model tools cannot grant it.");
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
          if (boundary.phase === "compaction" && start.automaticCompaction) {
            if (!("contextReplacement" in accepted.value) || !accepted.value.contextReplacement || message.stopReason !== "stop" || toolCalls(message).length ||
              !usageReported || !Number.isSafeInteger(message.usage.totalTokens) || !Number.isSafeInteger(message.usage.output) ||
              message.usage.output < 0 || message.usage.output > message.usage.totalTokens || message.usage.output > boundary.maxTokens) throw new Error("Automatic compaction needs complete bounded metering and an actual acknowledged source-bound replacement. No context was invented.");
            const replacement = contextMessages(accepted.value.contextReplacement);
            context.splice(0, context.length, ...replacement); instructionSources.clear(); kupoDraft = undefined;
          } else if (boundary.phase !== "router" && boundary.phase !== "candidate" && !boundary.phase?.startsWith("kupo-")) throw new Error("Only an owned router, reviewed Kupo response, policy-authorized compaction or tool-less candidate stage may request a continuation.");
          if (boundary.phase === "candidate") {
            const rootedPublic = start.publicCompound === true && (start.env === "Remote" || start.env === "Sandbox") && typeof start.root === "string";
            if (start.readOnly !== true || start.root !== null && !rootedPublic || message.stopReason !== "stop" || toolCalls(message).length) throw new Error("Candidate continuation requires a root-less Local/private owner or its exact rooted public peer/native parent, with a complete read-only tool-less result. No next role was authorized.");
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
        const calls = toolCalls(message).map((call) => resolveDirectMcpCall(call, boundary.directMcpTools ?? []));
        if (message.stopReason === "length") {
          await finish("partial", `The model reached this response's ${boundary.maxTokens}-token output limit.${model.reasoning ? " Reasoning counts toward this limit." : ""}${calls.length ? " No tools from this incomplete response were executed." : ""} Review the partial response before continuing.`);
          return;
        }
        if (start.readOnly && calls.length) throw new Error("The read-only subagent requested tools. No tools were executed.");
        if (calls.length === 0) {
          if (boundary.phase === "solver" || boundary.phase?.startsWith("kupo-") || boundary.phase === undefined) await lifecycle("turn.end");
          if ((boundary.phase === "solver" || boundary.phase?.startsWith("kupo-") || boundary.phase === undefined) && !await nameChat()) {
            await finish("partial", "The original response was retained, but naming completion or accounting is incomplete. No extra model call or retry was authorized."); return;
          }
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
                (call) => delegate(stepId, call), { mode: approval.value.mode, folders: approval.value.folders, env: start.env, homeRoot: approval.value.homeRoot, webAccess: approval.value.webAccess, scriptExecution: approval.value.scriptExecution }, boundary.toolCatalog ?? boundary.tools,
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
          context.push({ role: "toolResult", toolCallId: call.id, toolName: modelToolName(call),
            content: [{ type: "text", text: retained.value.source ? retainedToolText(result.text, retained.value.source) : result.text }],
            isError: result.isError, timestamp: Date.now() });
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
            if (!await nameChat()) { await finish("partial", "Original publication was retained, but naming has incomplete accounting. No next model or title was inferred."); return; }
            await finish("completed", null);
            return;
          }
        }
      }
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
  if (message.kind === "start" && !started) { started = true; parentStart = message; void run(message); }
  else if (message.kind === "candidate.start") {
    const gate = pending.get(message.parentRequestId), operation = message.operation;
    if (!started || !authority || terminalRequested || parentStart?.publicCompound !== true || parentStart.env === "Local" ||
      parentStart.env !== operation.scope.env || parentStart.root !== operation.scope.boundary.sourceRoot ||
      candidateOperation || candidateOperationIds.has(operation.operationId) || candidateOperationIds.size >= 256 ||
      !gate || !["boundary", "model.complete", "validation.boundary", "validation.complete"].includes(gate.kind)) {
      send({ kind: "candidate.released", operationId: operation.operationId, operationDigest: frameDigest(operation), outcome: "failed" });
      return;
    }
    candidateOperationIds.add(operation.operationId);
    const operationAbort = new AbortController(), signal = AbortSignal.any([abort.signal, operationAbort.signal]);
    const done = Promise.resolve().then(() => runCandidateOperation(operation, signal)).finally(() => {
      if (candidateOperation?.id === operation.operationId) candidateOperation = undefined;
    });
    candidateOperation = { id: operation.operationId, abort: operationAbort, done };
  } else if (message.kind === "candidate.stop") {
    if (candidateOperation?.id === message.operationId) {
      candidateOperation.abort.abort();
      for (const [id, waiter] of pending) if (waiter.ownerId === message.operationId && waiter.interruptible) {
        waiter.reject(new Error("Original candidate operation stopped before its next acknowledged boundary.")); pending.delete(id);
      }
    }
  }
  else if (message.kind === "owned-model.start") {
    const gate = pending.get(message.parentRequestId);
    if (!started || !authority || terminalRequested || !parentStart?.ownedModelCalls || ownedModel || ownedModelIds.has(message.ownerId) ||
      ownedModelIds.size >= 16 || !gate || !["boundary", "approval", "delegate"].includes(gate.kind)) {
      console.error("Owned model subcall rejected: no exact waiting parent, bounded original owner or transport authority.");
      void request({ kind: "owned-model.finished", ownerId: message.ownerId, requestId: randomUUID(), outcome: "failed",
        diagnostic: "The exact parent gate ended, changed or did not authorize this tool-less subcall. No inference or replay was dispatched." }).then((reply) => {
        if (reply.error || !reply.value || !("accepted" in reply.value) || reply.value.accepted !== true) throw new Error("Rejected subcall terminal result was not acknowledged.");
        send({ kind: "owned-model.released", ownerId: message.ownerId, outcome: "failed" });
      }).catch(() => { console.error("Rejected owned subcall terminal acknowledgement was lost; no replay."); });
      return;
    }
    ownedModelIds.add(message.ownerId);
    const roleAbort = new AbortController(), signal = AbortSignal.any([abort.signal, roleAbort.signal]);
    const done = Promise.resolve().then(() => runOwnedModel(message.ownerId, signal)).finally(() => {
      if (ownedModel?.id === message.ownerId) ownedModel = undefined;
    });
    ownedModel = { id: message.ownerId, abort: roleAbort, done };
  } else if (message.kind === "owned-model.stop") {
    if (ownedModel?.id === message.ownerId) {
      ownedModel.abort.abort(); send({ kind: "owned-model.ack", ownerId: message.ownerId });
      for (const [id, waiter] of pending) if (waiter.ownerId === message.ownerId) {
        waiter.reject(new Error("The original private model operation was cancelled without inferring a result acknowledgement.")); pending.delete(id);
      }
    }
  }
  else if (message.kind === "reply") {
    const waiter = pending.get(message.requestId);
    pending.delete(message.requestId);
    waiter?.resolve(message);
  } else if (message.kind === "stop" || message.kind === "control-lost") {
    if (message.kind === "control-lost") authority = false;
    send({ kind: "ack" });
    abort.abort();
    for (const [id, waiter] of pending) if (waiter.interruptible || waiter.ownerId || !authority) { waiter.reject(new Error("Turn stopped or control authority disconnected.")); pending.delete(id); }
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
