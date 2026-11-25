import { randomUUID } from "node:crypto";
import { Value } from "typebox/value";
import { ACP_AGENT_SPECS } from "../../../packages/protocol/src/index.ts";
import { AgentApprovalReplySchema, type AcpWorkerStart, type AgentApprovalReply } from "./agent-harness-protocol.ts";
import { failPending, HarnessProcess, request, send, serveWorker, type Outcome } from "./agent-worker-runtime.ts";
import { acpInitialize } from "./acp-agent.ts";
import { acpPromptUsage, acpUsdEstimate, AcpUpdateNormalizer, type AcpUsage } from "./acp-agent-stream.ts";
import { CodexAppServer, CodexRpcError, isJson, type CodexServerRequest } from "./codex-app-server.ts";

type Json = Record<string, unknown>;
const agent = new HarnessProcess("ACP agent");
const approvalRequests = new Set<string>();
const escalations: ReturnType<typeof setTimeout>[] = [];
let stopRequested = false, server: CodexAppServer | undefined, sessionId: string | null = null, loading = false;

let approvals: Promise<unknown> = Promise.resolve();
function approve(call: { id: string; name: string; arguments: Json }): Promise<AgentApprovalReply> {
  const decide = async (): Promise<AgentApprovalReply> => {
    if (stopRequested) return { allow: false, message: "The Moguri turn is stopping. No tool was approved." };
    const requestId = randomUUID();
    approvalRequests.add(requestId);
    const reply = await request({ kind: "agent.approval", requestId, stepId: null, call }).finally(() => approvalRequests.delete(requestId));
    if (reply.error || !Value.Check(AgentApprovalReplySchema, reply.value)) return { allow: false, message: reply.error ?? "Moguri did not authorize this tool call." };
    return reply.value;
  };
  const next = approvals.then(decide, decide);
  approvals = next.catch(() => {});
  return next;
}
/** Each permission request becomes one Moguri review, answered with a once-only option. Moguri never selects an "always" option. */
async function answer(normalizer: AcpUpdateNormalizer, owned: CodexServerRequest): Promise<void> {
  const live = server!, { params } = owned;
  if (owned.method !== "session/request_permission") { live.error(owned.id, -32601, `Moguri does not serve ${owned.method}. Nothing was granted.`); return; }
  const cancelled = { outcome: { outcome: "cancelled" } };
  try {
    const call = params.sessionId === sessionId && isJson(params.toolCall) ? normalizer.approvalCall(params.toolCall) : null;
    if (!call) { live.respond(owned.id, cancelled); return; }
    const options = (Array.isArray(params.options) ? params.options : []).filter(isJson);
    const option = (kind: string) => options.find((entry) => entry.kind === kind && typeof entry.optionId === "string")?.optionId;
    const decision = await approve(call);
    if (stopRequested) { live.respond(owned.id, cancelled); return; }
    const chosen = decision.allow ? option("allow_once") : option("reject_once");
    live.respond(owned.id, chosen ? { outcome: { outcome: "selected", optionId: chosen } } : cancelled);
  } catch {
    live.respond(owned.id, cancelled);
  }
}
function race<T>(work: Promise<T>, exit: Promise<void>, label: string, product: string): Promise<T> {
  return Promise.race([work, exit.then((): never => { throw new Error(`${product} exited during ${label}.`); })]);
}
async function selectModel(live: CodexAppServer, model: string, current: string | null): Promise<void> {
  if (!model || model === current) return;
  try { await live.request("session/set_model", { sessionId, modelId: model }); return; }
  catch (error) { if (!(error instanceof CodexRpcError && error.code === -32601)) throw error; }
  await live.request("session/set_config_option", { sessionId, configId: "model", value: model });
}
async function run(start: AcpWorkerStart): Promise<void> {
  const spec = ACP_AGENT_SPECS[start.harness];
  agent.label = spec.product;
  const normalizer = new AcpUpdateNormalizer(start.model || null, send);
  let outcome: Outcome = "failed", diagnostic: string | null = null, initialized = false, usage: AcpUsage | null = null, usd: number | null = null;
  const began = Date.now();
  try {
    const live = server = new CodexAppServer(agent.spawn(start.executable, start.args, start.root, start.environment), { label: spec.product, jsonrpc: true });
    live.onRequest = (owned) => { void answer(normalizer, owned); };
    live.onNotification = (method, params) => {
      if (method !== "session/update" || params.sessionId !== sessionId || loading || !isJson(params.update)) return;
      if (params.update.sessionUpdate === "usage_update") { usd = acpUsdEstimate(params.update) ?? usd; return; }
      normalizer.handle(params.update);
    };
    const capabilities = await race(acpInitialize(live, start.clientVersion), live.exit, "initialization", spec.product);
    let current: string | null = null;
    if (start.sessionId) {
      if (!capabilities.loadSession) throw new Error(`${spec.product} no longer offers session loading. Nothing was sent.`);
      sessionId = start.sessionId; loading = true;
      await race(live.request("session/load", { sessionId: start.sessionId, cwd: start.root, mcpServers: [] }), live.exit, "session load", spec.product);
      loading = false;
    } else {
      const opened = await race(live.request("session/new", { cwd: start.root, mcpServers: [] }), live.exit, "session start", spec.product);
      sessionId = isJson(opened) && typeof opened.sessionId === "string" ? opened.sessionId : null;
      if (!sessionId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(sessionId)) throw new Error(`${spec.product} did not open a usable session. Nothing was sent.`);
      const models = isJson(opened) ? opened : {};
      const option = (Array.isArray(models.configOptions) ? models.configOptions : []).find((entry) => isJson(entry) && (entry.category === "model" || entry.id === "model"));
      current = isJson(option) && typeof option.currentValue === "string" ? option.currentValue : isJson(models.models) && typeof models.models.currentModelId === "string" ? models.models.currentModelId : null;
    }
    initialized = true;
    send({ kind: "agent.initialized", nativeSessionId: sessionId, model: start.model || current });
    if (stopRequested) throw new Error(`Stopped before the ${spec.product} prompt started.`);
    await race(selectModel(live, start.model, current), live.exit, "model selection", spec.product).catch((error: unknown) => {
      throw new Error(`${spec.product} could not select ${start.model}${error instanceof Error ? `: ${error.message.slice(0, 300)}` : ""}. Nothing was sent; no other model was substituted.`);
    });
    // ACP has no system prompt, so a new session's first prompt carries Moguri's instructions as labelled context.
    const text = start.sessionId ? start.prompt : `<moguri-instructions>\n${start.instructions}\n</moguri-instructions>\n\n${start.prompt}`;
    const response = await race(live.request("session/prompt", { sessionId, prompt: [{ type: "text", text }] }), live.exit, "the prompt", spec.product);
    normalizer.flush();
    usage = acpPromptUsage(response);
    const reason = isJson(response) && typeof response.stopReason === "string" ? response.stopReason : "unknown";
    outcome = reason === "end_turn" ? "completed" : reason === "cancelled" ? stopRequested ? "stopped" : "partial" : normalizer.toolsRan ? "partial" : "failed";
    diagnostic = reason === "end_turn" ? null : reason === "cancelled" ? stopRequested ? `Stopped in Moguri; ${spec.product} cancelled the prompt.` : `${spec.product} cancelled the prompt.` :
      `${spec.product} ended the prompt with ${reason.slice(0, 64)}.`;
    if (outcome === "completed" && normalizer.unfinished) { outcome = "partial"; diagnostic = `${spec.product} ended the prompt before an approved tool reported its result.`; }
  } catch (error) {
    normalizer.flush();
    outcome = stopRequested ? "stopped" : initialized && normalizer.toolsRan ? "partial" : "failed";
    diagnostic = error instanceof Error ? error.message.slice(0, 2000) : `${spec.name} worker failed.`;
  }
  if (sessionId && initialized) {
    send({ kind: "agent.result", nativeSessionId: sessionId, outcome, diagnostic, ...(usage ?? { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null }),
      harnessEstimatedUsd: usd, numTurns: null, durationMs: Date.now() - began });
  }
  server?.close();
  await agent.finish(outcome, diagnostic, escalations);
}
function stop(): void {
  if (stopRequested) return;
  stopRequested = true; send({ kind: "ack" });
  failPending(approvalRequests, "The Moguri turn is stopping. No tool was approved.");
  if (server && sessionId) server.notify("session/cancel", { sessionId });
  escalations.push(setTimeout(() => agent.signal("SIGTERM"), 2500), setTimeout(() => agent.signal("SIGKILL"), 3500));
}
serveWorker(agent, (message) => {
  if (message.kind !== "acp.start") return false;
  void run(message); return true;
}, stop);
