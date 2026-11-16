import { randomUUID } from "node:crypto";
import type { AgentWorkerMessage } from "./agent-harness-protocol.ts";
import { CODEX_TOOLS } from "./codex-agent.ts";
import { isJson } from "./codex-app-server.ts";

type Json = Record<string, unknown>;
type Call = { id: string; name: string; arguments: Json };
const bounded = (value: string, limit: number) => value.length > limit ? `${value.slice(0, limit)}\n[truncated]` : value;
const text = (value: unknown, limit = 4096) => typeof value === "string" ? value.slice(0, limit) : "";
const toolItems = new Set(["commandExecution", "fileChange", "mcpToolCall", "webSearch", "dynamicToolCall", "collabAgentToolCall", "imageGeneration"]);

export function codexCall(item: Json): Call | null {
  const id = text(item.id, 256);
  if (!id || !toolItems.has(String(item.type))) return null;
  switch (item.type) {
    case "commandExecution": return { id, name: CODEX_TOOLS.command, arguments: { command: text(item.command, 64 * 1024), cwd: text(item.cwd),
      actions: (Array.isArray(item.commandActions) ? item.commandActions : []).slice(0, 32).flatMap((action) => isJson(action) ?
        [{ type: text(action.type, 32), ...(typeof action.path === "string" ? { path: text(action.path) } : {}), ...(typeof action.query === "string" ? { query: text(action.query, 1024) } : {}) }] : []) } };
    case "fileChange": {
      let budget = 128 * 1024;
      const changes = (Array.isArray(item.changes) ? item.changes : []).slice(0, 256).flatMap((change) => {
        if (!isJson(change) || typeof change.path !== "string") return [];
        const kind = isJson(change.kind) ? text(change.kind.type, 16) : "update", diff = text(change.diff, Math.max(0, Math.min(16 * 1024, budget)));
        budget -= diff.length;
        return [{ path: text(change.path), kind, ...(isJson(change.kind) && typeof change.kind.move_path === "string" ? { movePath: text(change.kind.move_path) } : {}), diff }];
      });
      return { id, name: CODEX_TOOLS.fileChange, arguments: { changes } };
    }
    case "mcpToolCall": return { id, name: `mcp:${text(item.server, 100)}/${text(item.tool, 100)}`, arguments: isJson(item.arguments) ? item.arguments : {} };
    case "webSearch": return { id, name: CODEX_TOOLS.webSearch, arguments: { query: text(item.query, 2048) } };
    default: return { id, name: String(item.type), arguments: {} };
  }
}
function resultOf(item: Json): { text: string; isError: boolean } {
  const status = String(item.status ?? "completed");
  const failed = status === "failed" || status === "declined";
  switch (item.type) {
    case "commandExecution": {
      const exit = typeof item.exitCode === "number" ? item.exitCode : null;
      return { text: bounded(`${text(item.aggregatedOutput, 512 * 1024)}${exit === null ? "" : `\n(exit ${exit})`}${status === "declined" ? "\nDeclined." : ""}`.trim() || status, 256 * 1024),
        isError: failed || exit !== null && exit !== 0 };
    }
    case "fileChange": return { text: bounded((Array.isArray(item.changes) ? item.changes : []).flatMap((change) => isJson(change) ?
      [`${isJson(change.kind) ? text(change.kind.type, 16) : "update"} ${text(change.path)}`] : []).join("\n") || status, 64 * 1024), isError: failed };
    case "mcpToolCall": {
      const error = isJson(item.error) ? text(item.error.message, 4096) : "";
      const content = isJson(item.result) && Array.isArray(item.result.content) ? item.result.content.flatMap((block) => isJson(block) && block.type === "text" ? [text(block.text, 256 * 1024)] : []).join("\n") : "";
      return { text: bounded(error || content || status, 256 * 1024), isError: failed || Boolean(error) };
    }
    case "webSearch": return { text: `Searched: ${text(item.query, 2048)}`, isError: false };
    default: return { text: status, isError: failed };
  }
}

/** Groups Codex thread items into Moguri steps: text and reasoning accumulate until a tool call ends the step. */
export class CodexItemNormalizer {
  private step: { stepId: string; text: string; reasoning: string; calls: Call[] } | null = null;
  private readonly calls = new Map<string, { call: Call; reviewed: boolean; done: boolean; subcalls: string[] }>();
  toolsRan = false;
  constructor(private readonly model: string, private readonly emit: (message: AgentWorkerMessage) => void) {}
  private open() {
    if (!this.step) { this.step = { stepId: randomUUID(), text: "", reasoning: "", calls: [] }; this.emit({ kind: "agent.step", stepId: this.step.stepId }); }
    return this.step;
  }
  flush(): void {
    const step = this.step;
    if (!step) return;
    this.step = null;
    this.emit({ kind: "agent.response", stepId: step.stepId, text: bounded(step.text, 500 * 1024), reasoning: bounded(step.reasoning, 500 * 1024), toolCalls: step.calls, model: this.model });
  }
  private register(call: Call): string {
    const known = this.calls.get(call.id);
    if (known) return known.call.id;
    const step = this.open();
    step.calls.push(call);
    this.calls.set(call.id, { call, reviewed: false, done: false, subcalls: [] });
    this.flush();
    return call.id;
  }
  /** The call an approval reviews. A Codex approval can precede `item/started`, so the request alone may introduce it. */
  approvalCall(itemId: string, approvalId: string | null, fallback: Call): Call {
    const parent = this.calls.get(itemId);
    if (!approvalId) {
      if (!parent) this.register(fallback);
      const owned = this.calls.get(itemId)!;
      owned.reviewed = true;
      return owned.call;
    }
    const sub = { ...fallback, id: `${itemId}:${approvalId}`.slice(0, 256) };
    if (!parent) this.register({ ...fallback, id: itemId });
    const owner = this.calls.get(itemId)!;
    owner.reviewed = true;
    if (!this.calls.has(sub.id)) { this.register(sub); this.calls.get(sub.id)!.reviewed = true; owner.subcalls.push(sub.id); }
    return this.calls.get(sub.id)!.call;
  }
  handle(method: string, params: Json): void {
    const item = isJson(params.item) ? params.item : null;
    if (method === "item/started" && item) {
      if (item.type === "agentMessage" || item.type === "reasoning") this.open();
      const call = codexCall(item);
      if (call) this.register(call);
    } else if (method === "item/agentMessage/delta" && typeof params.delta === "string" && params.delta) {
      const step = this.open();
      for (let offset = 0; offset < params.delta.length; offset += 64 * 1024) this.emit({ kind: "agent.delta", stepId: step.stepId, text: params.delta.slice(offset, offset + 64 * 1024) });
    } else if (method === "item/completed" && item) {
      if (item.type === "agentMessage" && typeof item.text === "string" && item.text) { const step = this.open(); step.text += `${step.text ? "\n\n" : ""}${item.text}`; return; }
      if (item.type === "reasoning") {
        const parts = [...(Array.isArray(item.summary) ? item.summary : []), ...(Array.isArray(item.content) ? item.content : [])].filter((part): part is string => typeof part === "string");
        if (parts.length) { const step = this.open(); step.reasoning += `${step.reasoning ? "\n\n" : ""}${parts.join("\n")}`; }
        return;
      }
      const call = codexCall(item);
      if (!call) return;
      this.register(call);
      const owned = this.calls.get(call.id)!;
      if (owned.done) return;
      owned.done = true;
      const result = resultOf(item);
      if (item.status !== "declined") this.toolsRan = true;
      this.emit({ kind: "agent.tool_result", callId: call.id, text: result.text, isError: result.isError, ...(owned.reviewed ? {} : { autonomous: true as const }) });
      for (const id of owned.subcalls) {
        const sub = this.calls.get(id)!;
        if (sub.done) continue;
        sub.done = true;
        this.emit({ kind: "agent.tool_result", callId: id, text: `Part of Codex command ${call.id}; its output is recorded on that command.`, isError: result.isError });
      }
    }
  }
}
export interface CodexTokenTotals { inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null }
export function codexTokenTotals(params: Json): CodexTokenTotals | null {
  const total = isJson(params.tokenUsage) && isJson(params.tokenUsage.total) ? params.tokenUsage.total : null;
  if (!total) return null;
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  return { inputTokens: count(total.inputTokens), outputTokens: count(total.outputTokens), cacheReadTokens: count(total.cachedInputTokens), cacheWriteTokens: count(total.cacheWriteInputTokens) };
}
export const MOGURI_CODEX_INSTRUCTIONS = "You are running inside Moguri, which records this session and reviews every command and file change Codex asks to make. If Moguri declines a request, do not retry it through another tool or a workaround; explain what you need instead.";
