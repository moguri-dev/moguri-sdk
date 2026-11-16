import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { Value } from "typebox/value";
import { claudeParentMessage, ClaudeApprovalReplySchema, type ClaudeApprovalReply, type ClaudeWorkerMessage, type ClaudeWorkerStart } from "./claude-agent-protocol.ts";
import { CLAUDE_HOOK_ID, ClaudeStreamNormalizer, claudeStreamArgs, claudeUserMessage, preToolUseAsk } from "./claude-agent-stream.ts";

type Json = Record<string, unknown>;
type Outcome = "completed" | "stopped" | "failed" | "partial";
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const send = (message: ClaudeWorkerMessage) => { if (process.connected) process.send?.(message); };
const pending = new Map<string, (reply: { value?: unknown; error?: string }) => void>();
const approvalRequests = new Set<string>();
function request(message: Extract<ClaudeWorkerMessage, { requestId: string }>): Promise<{ value?: unknown; error?: string }> {
  if (!process.connected) return Promise.resolve({ error: "The Moguri control plane disconnected." });
  return new Promise((resolve) => { pending.set(message.requestId, resolve); send(message); });
}
let child: ChildProcess | undefined;
let stopRequested = false, started = false;
let interrupt: (() => Promise<void>) | undefined;
let stderrTail = "";
const escalations: ReturnType<typeof setTimeout>[] = [];

/** The group outlives its leader: tools Claude Code started stay members after it exits. Only ESRCH confirms an empty group. */
function signalGroup(signal: NodeJS.Signals | 0): boolean {
  if (!child?.pid) return false;
  try { process.kill(-child.pid, signal); return true; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    console.error("Claude Code process-group signal failed; cleanup is unconfirmed.");
    return true;
  }
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function settleGroup(): Promise<boolean> {
  if (!signalGroup(0)) return true;
  signalGroup("SIGTERM"); await pause(1000);
  if (!signalGroup(0)) return true;
  signalGroup("SIGKILL"); await pause(500);
  return !signalGroup(0);
}
function exited(owned: ChildProcess | undefined, timeoutMs: number): Promise<boolean> {
  if (!owned || owned.exitCode !== null || owned.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    owned.once("exit", () => { clearTimeout(timer); resolve(true); });
  });
}
function spawnClaude(command: string, args: string[], cwd: string, environment: Record<string, string | undefined>): ChildProcess {
  if (child) throw new Error("Moguri owns exactly one Claude Code process per turn.");
  const owned = spawn(command, args, { cwd, env: environment, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  child = owned;
  if (owned.pid) send({ kind: "claude.process", pid: owned.pid });
  owned.stderr?.on("data", (chunk: Buffer) => { stderrTail = (stderrTail + chunk.toString("utf8")).slice(-4096); });
  return owned;
}
let approvals: Promise<unknown> = Promise.resolve();
function approve(normalizer: ClaudeStreamNormalizer, name: string, input: Json, toolUseId: string): Promise<ClaudeApprovalReply> {
  const decide = async (): Promise<ClaudeApprovalReply> => {
    if (stopRequested) return { allow: false, message: "The Moguri turn is stopping. No tool was approved." };
    const requestId = randomUUID();
    approvalRequests.add(requestId);
    const reply = await request({ kind: "claude.approval", requestId, stepId: normalizer.stepFor(toolUseId),
      call: { id: toolUseId.slice(0, 256) || randomUUID(), name: name.slice(0, 256), arguments: input } }).finally(() => approvalRequests.delete(requestId));
    if (reply.error || !Value.Check(ClaudeApprovalReplySchema, reply.value)) return { allow: false, message: reply.error ?? "Moguri did not authorize this tool call." };
    return reply.value;
  };
  const next = approvals.then(decide, decide);
  approvals = next.catch(() => {});
  return next;
}
const permission = (decision: ClaudeApprovalReply, input: Json) => decision.allow ? { behavior: "allow" as const, updatedInput: input } :
  { behavior: "deny" as const, message: decision.message, interrupt: stopRequested };

async function runStreamJson(start: ClaudeWorkerStart, normalizer: ClaudeStreamNormalizer): Promise<void> {
  const proc = spawnClaude(start.executable, claudeStreamArgs(start), start.root, start.environment);
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
    spawnClaudeCodeProcess: (options) => spawnClaude(options.command, options.args, options.cwd ?? start.root, options.env) as never,
    stderr: (data) => { stderrTail = (stderrTail + data).slice(-4096); },
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
      send({ kind: "claude.result", ...result, outcome: stopRequested && result.outcome !== "completed" ? "stopped" : result.outcome });
      outcome = stopRequested && result.outcome !== "completed" ? "stopped" : result.outcome; diagnostic = result.diagnostic;
    } else {
      outcome = stopRequested ? "stopped" : "failed";
      diagnostic = stopRequested ? "Stopped before Claude Code reported a result." :
        `Claude Code ended without a result (exit ${child?.exitCode ?? child?.signalCode ?? "unknown"}). Run \`claude\` in a terminal to check its configuration; nothing was retried.`;
    }
  } catch (error) {
    outcome = stopRequested ? "stopped" : normalizer.initialized ? "partial" : "failed";
    diagnostic = error instanceof Error ? error.message.slice(0, 2000) : "Claude Agent worker failed.";
  }
  if (stderrTail.trim()) process.stderr.write(`Claude Code stderr tail:\n${stderrTail}\n`);
  const leaderExited = await exited(child, 3000), groupSettled = await settleGroup();
  if (!leaderExited || !groupSettled || !await exited(child, 500)) {
    outcome = "partial";
    diagnostic = `${diagnostic ?? ""} ${groupSettled ? "Claude Code did not exit after its turn; Moguri terminated its process group." :
      "Processes in Claude Code's process group survived termination. Inspect them; cleanup is unconfirmed."}`.trim();
  }
  for (const timer of escalations) clearTimeout(timer);
  const reply = await request({ kind: "finished", requestId: randomUUID(), outcome, diagnostic });
  if (reply.error) console.error("Claude Agent terminal outcome was not acknowledged; the control plane reconciles it.");
  if (process.connected) process.disconnect?.();
}
function stop(): void {
  if (stopRequested) return;
  stopRequested = true; send({ kind: "ack" });
  for (const id of approvalRequests) { pending.get(id)?.({ error: "The Moguri turn is stopping. No tool was approved." }); pending.delete(id); }
  void interrupt?.().catch(() => {});
  escalations.push(setTimeout(() => signalGroup("SIGTERM"), 2500), setTimeout(() => signalGroup("SIGKILL"), 3500));
}
const terminate = () => { signalGroup("SIGKILL"); process.exit(1); };
process.on("SIGTERM", terminate);
process.on("disconnect", () => { signalGroup("SIGKILL"); });
process.on("message", (raw: unknown) => {
  const message = claudeParentMessage(raw);
  if (!message) { console.error("Invalid Claude Agent parent message ignored."); return; }
  if (message.kind === "claude.start") {
    if (started) return;
    started = true; void run(message);
  } else if (message.kind === "reply") {
    const waiter = pending.get(message.requestId);
    pending.delete(message.requestId);
    waiter?.({ ...(message.value !== undefined ? { value: message.value } : {}), ...(message.error !== undefined ? { error: message.error } : {}) });
  } else stop();
});
