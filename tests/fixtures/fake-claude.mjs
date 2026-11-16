// Generated Claude Code stand-in for Moguri tests. It speaks the stream-json control protocol only;
// it never contacts Anthropic, reads credentials or runs a model.
import { appendFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";

const args = process.argv.slice(2);
const log = process.env.FAKE_CLAUDE_LOG;
if (log) appendFileSync(log, `${JSON.stringify({ args, cwd: process.cwd(), env: Object.keys(process.env).filter((key) => key.startsWith("MOGURI")) })}\n`);
if (args[0] === "--version") { process.stdout.write("2.1.325 (Claude Code)\n"); process.exit(0); }
if (args[0] === "auth" && args[1] === "status") {
  const method = process.env.FAKE_CLAUDE_AUTH ?? "api_key";
  process.stdout.write(`${JSON.stringify({ loggedIn: method !== "none", authMethod: method, apiProvider: "firstParty", email: "generated@example.invalid" })}\n`);
  process.exit(method === "none" ? 1 : 0);
}
const option = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1); };
const sessionId = option("--resume") ?? option("--session-id") ?? "00000000-0000-4000-8000-000000000000";
const model = option("--model") ?? "sonnet";
const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const pending = new Map();
let counter = 0, hookIds = [], interrupted = false, cost = 0;
const control = (request) => new Promise((resolve) => { const id = `fake_${++counter}`; pending.set(id, resolve); write({ type: "control_request", request_id: id, request }); });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function tool(name, input, id) {
  // Claude Code emits one assistant frame per content block of the same response.
  write({ type: "assistant", parent_tool_use_id: null, session_id: sessionId, message: { id: `msg_tool_${id}`, model, role: "assistant", content: [{ type: "text", text: `Using ${name}.` }] } });
  write({ type: "assistant", parent_tool_use_id: null, session_id: sessionId, message: { id: `msg_tool_${id}`, model, role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
  for (const hook of hookIds) {
    const output = await control({ subtype: "hook_callback", callback_id: hook, input: { hook_event_name: "PreToolUse", tool_name: name, tool_input: input }, tool_use_id: id });
    if (output?.hookSpecificOutput?.permissionDecision !== "ask") throw new Error("Generated fake expected Moguri to force every tool through review.");
  }
  const decision = await control({ subtype: "can_use_tool", tool_name: name, input, tool_use_id: id, permission_suggestions: [] });
  if (decision?.behavior === "allow") {
    if (name === "Write") writeFileSync(join(process.cwd(), String(input.file_path).split("/").at(-1)), String(input.content));
    write({ type: "user", parent_tool_use_id: null, session_id: sessionId, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: name === "Write" ? "File written." : "Generated read result." }] } });
    return true;
  }
  write({ type: "user", parent_tool_use_id: null, session_id: sessionId, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: true, content: decision?.message ?? "denied" }] } });
  return false;
}
function text(id, value) {
  write({ type: "stream_event", parent_tool_use_id: null, session_id: sessionId, event: { type: "message_start", message: { id, model } } });
  for (const part of value.match(/.{1,12}/g) ?? []) write({ type: "stream_event", parent_tool_use_id: null, session_id: sessionId, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: part } } });
  write({ type: "assistant", parent_tool_use_id: null, session_id: sessionId, message: { id, model, role: "assistant", content: [{ type: "text", text: value }] } });
}
function result(subtype = "success") {
  cost += 0.0125;
  write({ type: "result", subtype, is_error: subtype !== "success", session_id: sessionId, duration_ms: 42, duration_api_ms: 40, num_turns: 1, total_cost_usd: cost,
    usage: { input_tokens: 10, output_tokens: 5 }, modelUsage: { [model]: { inputTokens: 120, outputTokens: 30, cacheReadInputTokens: 7, cacheCreationInputTokens: 3, costUSD: cost } },
    errors: subtype === "success" ? [] : ["Generated turn interrupted."], permission_denials: [] });
}
async function turn(full) {
  if (log) appendFileSync(log, `${JSON.stringify({ prompt: full })}\n`);
  const marker = "Current request:\n", prompt = full.includes(marker) ? full.slice(full.lastIndexOf(marker) + marker.length) : full;
  if (prompt.includes("generated claude crash")) process.exit(5);
  write({ type: "system", subtype: "init", session_id: sessionId, model, cwd: process.cwd(), tools: ["Read", "Write", "Bash"], permissionMode: option("--permission-mode") ?? "default" });
  if (prompt.includes("generated claude script")) {
    const allowed = await tool("Bash", { command: "./generated-deploy.sh" }, `toolu_${Date.now()}`);
    text(`msg_done_${Date.now()}`, allowed ? "Generated script approved." : "Generated script denied.");
    result();
  } else if (prompt.includes("generated claude rogue")) {
    const id = `toolu_${Date.now()}`;
    write({ type: "assistant", parent_tool_use_id: null, session_id: sessionId, message: { id: `msg_rogue_${id}`, model, role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command: "true" } }] } });
    write({ type: "user", parent_tool_use_id: null, session_id: sessionId, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ran without asking" }] } });
    text(`msg_done_${Date.now()}`, "Generated rogue tool finished.");
    result();
  } else if (prompt.includes("generated claude orphan")) {
    const orphan = spawn("sleep", ["30"], { stdio: "ignore" });
    if (log) appendFileSync(log, `${JSON.stringify({ orphan: orphan.pid })}\n`);
    orphan.unref();
    text(`msg_done_${Date.now()}`, "Generated orphan started.");
    result();
  } else if (prompt.includes("generated claude write")) {
    const allowed = await tool("Write", { file_path: join(process.cwd(), "claude-output.txt"), content: "generated by fake claude\n" }, `toolu_${Date.now()}`);
    text(`msg_done_${Date.now()}`, allowed ? "Generated Claude write complete." : "Generated Claude write was denied.");
    result();
  } else if (prompt.includes("generated claude hang")) {
    text(`msg_hang_${Date.now()}`, "Generated Claude is working.");
    while (!interrupted) await delay(20);
    result("error_during_execution");
  } else {
    text(`msg_text_${Date.now()}`, `Generated Claude reply: ${prompt.split("\n").at(-1)}`);
    result();
  }
}
createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (log) appendFileSync(log, `${JSON.stringify({ stdin: message.type, subtype: message.request?.subtype ?? message.response?.subtype })}\n`);
  if (message.type === "control_response") { const resolve = pending.get(message.response.request_id); pending.delete(message.response.request_id); resolve?.(message.response.response); return; }
  if (message.type === "control_request") {
    if (message.request.subtype === "initialize") {
      hookIds = (message.request.hooks?.PreToolUse ?? []).flatMap((matcher) => matcher.hookCallbackIds ?? []);
      write({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: { commands: [], models: [], account: {} } } });
    } else if (message.request.subtype === "interrupt") {
      interrupted = true;
      write({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: {} } });
    } else write({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: {} } });
    return;
  }
  if (message.type === "user") {
    const content = message.message?.content;
    void turn(typeof content === "string" ? content : Array.isArray(content) ? content.map((block) => block.text ?? "").join("") : "").catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : "fake failure"}\n`); process.exit(3);
    });
  }
}).on("close", () => setTimeout(() => process.exit(0), 20));
