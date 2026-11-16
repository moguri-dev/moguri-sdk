import { randomUUID } from "node:crypto";
import { Value } from "typebox/value";
import { AgentApprovalReplySchema, type AgentApprovalReply, type CodexWorkerStart } from "./agent-harness-protocol.ts";
import { failPending, HarnessProcess, request, send, serveWorker, type Outcome } from "./agent-worker-runtime.ts";
import { CODEX_TOOLS } from "./codex-agent.ts";
import { CodexItemNormalizer, codexTokenTotals, type CodexTokenTotals } from "./codex-agent-stream.ts";
import { CodexAppServer, isJson, type CodexServerRequest } from "./codex-app-server.ts";

type Json = Record<string, unknown>;
const codex = new HarnessProcess("Codex");
const approvalRequests = new Set<string>();
const escalations: ReturnType<typeof setTimeout>[] = [];
let stopRequested = false, server: CodexAppServer | undefined, threadId: string | null = null, turnId: string | null = null;

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
/** Codex approvals map to Moguri reviews; Moguri never answers with a session-wide grant. Everything else Codex asks is declined. */
async function answer(normalizer: CodexItemNormalizer, root: string, owned: CodexServerRequest): Promise<void> {
  const { params } = owned, live = server!;
  try {
    if (owned.method === "item/commandExecution/requestApproval" || owned.method === "item/fileChange/requestApproval") {
      const itemId = typeof params.itemId === "string" ? params.itemId.slice(0, 200) : "";
      if (!itemId || params.threadId !== threadId) { live.respond(owned.id, { decision: "decline" }); return; }
      const command = owned.method === "item/commandExecution/requestApproval";
      const approvalId = command && typeof params.approvalId === "string" && params.approvalId ? params.approvalId.slice(0, 50) : null;
      const reason = typeof params.reason === "string" ? { reason: params.reason.slice(0, 2000) } : {};
      const call = normalizer.approvalCall(itemId, approvalId, command ?
        { id: itemId, name: CODEX_TOOLS.command, arguments: { command: typeof params.command === "string" ? params.command.slice(0, 64 * 1024) : "", cwd: typeof params.cwd === "string" ? params.cwd : root, actions: [], ...reason } } :
        { id: itemId, name: CODEX_TOOLS.fileChange, arguments: { changes: [], ...reason, ...(typeof params.grantRoot === "string" ? { grantRoot: params.grantRoot.slice(0, 4096) } : {}) } });
      const decision = await approve(call);
      live.respond(owned.id, { decision: decision.allow ? "accept" : stopRequested ? "cancel" : "decline" });
    } else if (owned.method === "item/permissions/requestApproval") live.respond(owned.id, { permissions: {}, scope: "turn" });
    else if (owned.method === "mcpServer/elicitation/request") live.respond(owned.id, { action: "decline" });
    else live.error(owned.id, -32601, `Moguri does not serve ${owned.method}. Nothing was granted.`);
  } catch {
    live.respond(owned.id, { decision: "decline" });
  }
}
function race<T>(work: Promise<T>, exit: Promise<void>, label: string): Promise<T> {
  return Promise.race([work, exit.then((): never => { throw new Error(`Codex exited during ${label}.`); })]);
}
async function run(start: CodexWorkerStart): Promise<void> {
  const normalizer = new CodexItemNormalizer(start.model, send);
  let outcome: Outcome = "failed", diagnostic: string | null = null, initialized = false, totals: CodexTokenTotals | null = null, turnError: string | null = null;
  const began = Date.now(), completed = Promise.withResolvers<string>();
  try {
    const live = server = new CodexAppServer(codex.spawn(start.executable, ["app-server"], start.root, start.environment));
    live.onRequest = (owned) => { void answer(normalizer, start.root, owned); };
    live.onNotification = (method, params) => {
      if (typeof params.threadId === "string" && params.threadId !== threadId) return;
      if (method === "thread/tokenUsage/updated") { totals = codexTokenTotals(params) ?? totals; return; }
      if (method === "error" && params.willRetry !== true && isJson(params.error)) { turnError = typeof params.error.message === "string" ? params.error.message.slice(0, 2000) : turnError; return; }
      if (method === "turn/completed" && isJson(params.turn) && (!turnId || params.turn.id === turnId)) {
        if (isJson(params.turn.error) && typeof params.turn.error.message === "string") turnError = params.turn.error.message.slice(0, 2000);
        completed.resolve(String(params.turn.status)); return;
      }
      normalizer.handle(method, params);
    };
    await race(live.initialize(start.clientVersion), live.exit, "initialization");
    const common = { cwd: start.root, model: start.model, approvalPolicy: "untrusted", approvalsReviewer: "user", sandbox: start.readOnly ? "read-only" : "workspace-write",
      developerInstructions: start.developerInstructions, config: { web_search: "disabled" } };
    const opened = await race(start.threadId ? live.request("thread/resume", { ...common, threadId: start.threadId, excludeTurns: true }) :
      live.request("thread/start", { ...common, ephemeral: false }), live.exit, "thread start");
    const thread = isJson(opened) && isJson(opened.thread) && typeof opened.thread.id === "string" ? opened.thread.id : null;
    if (!thread || start.threadId && thread !== start.threadId) throw new Error("Codex did not open the requested thread. Nothing was sent.");
    threadId = thread; initialized = true;
    send({ kind: "agent.initialized", nativeSessionId: thread, model: isJson(opened) && typeof opened.model === "string" ? opened.model.slice(0, 256) : start.model });
    if (stopRequested) throw new Error("Stopped before the Codex turn started.");
    const started = await race(live.request("turn/start", { threadId: thread, input: [{ type: "text", text: start.prompt, text_elements: [] }], cwd: start.root, model: start.model,
      approvalPolicy: "untrusted", approvalsReviewer: "user", sandboxPolicy: start.readOnly ? { type: "readOnly", networkAccess: false } : { type: "workspaceWrite", networkAccess: false } }), live.exit, "turn start");
    turnId = isJson(started) && isJson(started.turn) && typeof started.turn.id === "string" ? started.turn.id : null;
    if (!turnId) throw new Error("Codex did not report the started turn.");
    if (stopRequested) void live.request("turn/interrupt", { threadId: thread, turnId }).catch(() => {});
    const status = await race(completed.promise, live.exit, "the turn");
    normalizer.flush();
    outcome = status === "completed" ? "completed" : status === "interrupted" ? stopRequested ? "stopped" : "partial" : normalizer.toolsRan ? "partial" : "failed";
    diagnostic = status === "completed" ? null : status === "interrupted" ? stopRequested ? "Stopped in Moguri; Codex interrupted the turn." : "Codex interrupted the turn." :
      `Codex reported the turn ${status}${turnError ? `: ${turnError}` : "."}`;
  } catch (error) {
    normalizer.flush();
    outcome = stopRequested ? "stopped" : initialized && normalizer.toolsRan ? "partial" : "failed";
    diagnostic = error instanceof Error ? error.message.slice(0, 2000) : "Codex Agent worker failed.";
  }
  if (threadId) {
    const usage: CodexTokenTotals = totals ?? { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null };
    send({ kind: "agent.result", nativeSessionId: threadId, outcome, diagnostic, ...usage, harnessEstimatedUsd: null, numTurns: null, durationMs: Date.now() - began });
  }
  server?.close();
  await codex.finish(outcome, diagnostic, escalations);
}
function stop(): void {
  if (stopRequested) return;
  stopRequested = true; send({ kind: "ack" });
  failPending(approvalRequests, "The Moguri turn is stopping. No tool was approved.");
  if (server && threadId && turnId) void server.request("turn/interrupt", { threadId, turnId }).catch(() => {});
  escalations.push(setTimeout(() => codex.signal("SIGTERM"), 2500), setTimeout(() => codex.signal("SIGKILL"), 3500));
}
serveWorker(codex, (message) => {
  if (message.kind !== "codex.start") return false;
  void run(message); return true;
}, stop);
