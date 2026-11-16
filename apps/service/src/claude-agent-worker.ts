import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { Value } from "typebox/value";
import { AgentApprovalReplySchema, type AgentApprovalReply, type ClaudeWorkerStart } from "./agent-harness-protocol.ts";
import { failPending, HarnessProcess, request, send, serveWorker, type Outcome } from "./agent-worker-runtime.ts";
import { CLAUDE_HOOK_ID, ClaudeStreamNormalizer, claudeStreamArgs, claudeUserMessage, preToolUseAsk } from "./claude-agent-stream.ts";

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const approvalRequests = new Set<string>();
const claude = new HarnessProcess("Claude Code");
let stopRequested = false;
let interrupt: (() => Promise<void>) | undefined;
const escalations: ReturnType<typeof setTimeout>[] = [];
let approvals: Promise<unknown> = Promise.resolve();
function approve(normalizer: ClaudeStreamNormalizer, name: string, input: Json, toolUseId: string): Promise<AgentApprovalReply> {
  const decide = async (): Promise<AgentApprovalReply> => {
    if (stopRequested) return { allow: false, message: "The Moguri turn is stopping. No tool was approved." };
    const requestId = randomUUID();
    approvalRequests.add(requestId);
    const reply = await request({ kind: "agent.approval", requestId, stepId: normalizer.stepFor(toolUseId),
      call: { id: toolUseId.slice(0, 256) || randomUUID(), name: name.slice(0, 256), arguments: input } }).finally(() => approvalRequests.delete(requestId));
    if (reply.error || !Value.Check(AgentApprovalReplySchema, reply.value)) return { allow: false, message: reply.error ?? "Moguri did not authorize this tool call." };
    return reply.value;
  };
  const next = approvals.then(decide, decide);
  approvals = next.catch(() => {});
  return next;
}
const permission = (decision: AgentApprovalReply, input: Json) => decision.allow ? { behavior: "allow" as const, updatedInput: input } :
  { behavior: "deny" as const, message: decision.message, interrupt: stopRequested };

async function runStreamJson(start: ClaudeWorkerStart, normalizer: ClaudeStreamNormalizer): Promise<void> {
  const proc = claude.spawn(start.executable, claudeStreamArgs(start), start.root, start.environment);
  const write = (value: unknown) => { if (proc.stdin?.writable) proc.stdin.write(`${JSON.stringify(value)}\n`); };
  const controls = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let counter = 0;
  const control = (body: Json) => new Promise<unknown>((resolve, reject) => {
    const id = `moguri_${++counter}`; controls.set(id, { resolve, reject });
    write({ type: "control_request", request_id: id, request: body });
  });
  interrupt = async () => { await control({ subtype: "interrupt" }); };
  const finished = Promise.withResolvers<void>();
  const exit = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
  proc.once("error", (error) => finished.reject(error));
  const answer = async (message: Json) => {
    const body = isObject(message.request) ? message.request : {}, id = message.request_id;
    let response: Json;
    try {
      if (body.subtype === "can_use_tool" && typeof body.tool_name === "string") {
        const input = isObject(body.input) ? body.input : {};
        response = permission(await approve(normalizer, body.tool_name, input, typeof body.tool_use_id === "string" ? body.tool_use_id : randomUUID()), input);
      } else if (body.subtype === "hook_callback" && body.callback_id === CLAUDE_HOOK_ID) response = preToolUseAsk();
      else throw new Error(`Moguri does not serve the ${String(body.subtype)} control request.`);
      write({ type: "control_response", response: { subtype: "success", request_id: id, response } });
    } catch (error) {
      write({ type: "control_response", response: { subtype: "error", request_id: id, error: error instanceof Error ? error.message : "Control request failed." } });
    }
  };
  createInterface({ input: proc.stdout! }).on("line", (line) => {
    if (!line.trim()) return;
    let message: unknown;
    try { message = JSON.parse(line); } catch { console.error("Claude Code emitted a non-JSON stream line; it was ignored."); return; }
    if (!isObject(message)) return;
    if (message.type === "control_response" && isObject(message.response) && typeof message.response.request_id === "string") {
      const waiter = controls.get(message.response.request_id);
      controls.delete(message.response.request_id);
      if (message.response.subtype === "error") waiter?.reject(new Error(typeof message.response.error === "string" ? message.response.error : "Claude Code rejected a control request."));
      else waiter?.resolve(message.response.response);
      return;
    }
    if (message.type === "control_request") { void answer(message); return; }
    if (message.type === "control_cancel_request" || message.type === "keep_alive") return;
    try { normalizer.handle(message); } catch (error) { finished.reject(error); return; }
    if (message.type === "result") finished.resolve();
  });
  await Promise.race([control({ subtype: "initialize", hooks: { PreToolUse: [{ matcher: null, hookCallbackIds: [CLAUDE_HOOK_ID] }] } }),
    exit.then(() => { throw new Error("Claude Code exited during initialization."); })]);
  write(claudeUserMessage(start));
  await Promise.race([finished.promise, exit]);
  proc.stdin?.end();
  for (const waiter of controls.values()) waiter.reject(new Error("Claude Code stream ended."));
}

async function runSdk(start: ClaudeWorkerStart, normalizer: ClaudeStreamNormalizer): Promise<void> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const input = Promise.withResolvers<void>();
  async function* prompt() { yield claudeUserMessage(start) as never; await input.promise; }
  const session = query({ prompt: prompt(), options: {
    pathToClaudeCodeExecutable: start.executable, cwd: start.root, env: start.environment, model: start.model,
    permissionMode: start.readOnly ? "plan" : "default", settingSources: ["user", "project", "local"], disallowedTools: ["AskUserQuestion"],
    includePartialMessages: true, systemPrompt: { type: "preset", preset: "claude_code", append: start.appendSystemPrompt },
    ...(start.resume ? { resume: start.nativeSessionId } : { sessionId: start.nativeSessionId }),
    canUseTool: async (name, value, options) => permission(await approve(normalizer, name, value, options.toolUseID), value),
    hooks: { PreToolUse: [{ hooks: [async () => preToolUseAsk()] }] },
    spawnClaudeCodeProcess: (options) => claude.spawn(options.command, options.args, options.cwd ?? start.root, options.env) as never,
    stderr: (data) => { claude.stderrTail = (claude.stderrTail + data).slice(-4096); },
  } });
  interrupt = async () => { await session.interrupt(); };
  try {
    for await (const message of session) {
      normalizer.handle(message);
      if (message.type === "result") input.resolve();
    }
  } finally { input.resolve(); }
}

async function run(start: ClaudeWorkerStart): Promise<void> {
  const normalizer = new ClaudeStreamNormalizer(start.nativeSessionId, send);
  let outcome: Outcome = "failed", diagnostic: string | null = null;
  try {
    if (start.transport === "sdk") await runSdk(start, normalizer);
    else await runStreamJson(start, normalizer);
    const result = normalizer.result;
    if (result) {
      send({ kind: "agent.result", ...result, outcome: stopRequested && result.outcome !== "completed" ? "stopped" : result.outcome });
      outcome = stopRequested && result.outcome !== "completed" ? "stopped" : result.outcome; diagnostic = result.diagnostic;
    } else {
      outcome = stopRequested ? "stopped" : "failed";
      diagnostic = stopRequested ? "Stopped before Claude Code reported a result." :
        `Claude Code ended without a result (exit ${claude.child?.exitCode ?? claude.child?.signalCode ?? "unknown"}). Run \`claude\` in a terminal to check its configuration; nothing was retried.`;
    }
  } catch (error) {
    outcome = stopRequested ? "stopped" : normalizer.initialized ? "partial" : "failed";
    diagnostic = error instanceof Error ? error.message.slice(0, 2000) : "Claude Agent worker failed.";
  }
  await claude.finish(outcome, diagnostic, escalations);
}
function stop(): void {
  if (stopRequested) return;
  stopRequested = true; send({ kind: "ack" });
  failPending(approvalRequests, "The Moguri turn is stopping. No tool was approved.");
  void interrupt?.().catch(() => {});
  escalations.push(setTimeout(() => claude.signal("SIGTERM"), 2500), setTimeout(() => claude.signal("SIGKILL"), 3500));
}
serveWorker(claude, (message) => {
  if (message.kind !== "claude.start") return false;
  void run(message); return true;
}, stop);
