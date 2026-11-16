import { randomUUID } from "node:crypto";
import type { ClaudeWorkerMessage, ClaudeWorkerStart } from "./claude-agent-protocol.ts";

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const integer = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const bounded = (value: string, limit: number) => value.length > limit ? `${value.slice(0, limit)}\n[truncated by Moguri]` : value;
export const CLAUDE_HOOK_ID = "moguri_pre_tool_use";
/** Every tool call is routed to Moguri's approval path, including calls the user's Claude settings would auto-allow. */
export const preToolUseAsk = () => ({ hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: "ask" as const, permissionDecisionReason: "Moguri records and authorizes every Claude Agent tool call." } });
export const MOGURI_CLAUDE_INSTRUCTIONS = "You are running inside Moguri, which records this session and authorizes every tool call. If Moguri denies a tool, do not retry it through another tool or a workaround; explain what you need instead.";

export function claudeStreamArgs(start: ClaudeWorkerStart): string[] {
  return ["--output-format", "stream-json", "--verbose", "--input-format", "stream-json", "--include-partial-messages",
    "--model", start.model, "--permission-prompt-tool", "stdio", "--permission-mode", start.readOnly ? "plan" : "default",
    "--setting-sources", "user,project,local", "--disallowedTools", "AskUserQuestion",
    "--append-system-prompt", start.appendSystemPrompt,
    ...(start.resume ? ["--resume", start.nativeSessionId] : ["--session-id", start.nativeSessionId])];
}
export const claudeUserMessage = (start: ClaudeWorkerStart) => ({
  type: "user", message: { role: "user", content: start.prompt }, parent_tool_use_id: null, session_id: start.nativeSessionId,
});
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => isObject(block) && block.type === "text" && typeof block.text === "string" ? block.text :
    isObject(block) && block.type === "image" ? "[image]" : "").filter(Boolean).join("\n");
}
export interface ClaudeResultSummary {
  outcome: "completed" | "failed" | "partial"; diagnostic: string | null; nativeSessionId: string;
  inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null;
  harnessEstimatedUsd: number | null; numTurns: number | null; durationMs: number | null;
}
export function summarizeResult(message: Json, nativeSessionId: string): ClaudeResultSummary {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let known = false;
  if (isObject(message.modelUsage)) for (const usage of Object.values(message.modelUsage)) {
    if (!isObject(usage)) continue;
    const input = integer(usage.inputTokens), output = integer(usage.outputTokens), read = integer(usage.cacheReadInputTokens), write = integer(usage.cacheCreationInputTokens);
    if (input === null || output === null) continue;
    known = true; totals.input += input; totals.output += output; totals.cacheRead += read ?? 0; totals.cacheWrite += write ?? 0;
  }
  const errors = Array.isArray(message.errors) ? message.errors.filter((error): error is string => typeof error === "string") : [];
  const success = message.subtype === "success" && message.is_error !== true;
  const limited = message.subtype === "error_max_turns" || message.subtype === "error_max_budget_usd";
  return {
    outcome: success ? "completed" : limited ? "partial" : "failed",
    diagnostic: success ? null : bounded(errors.join("\n") || (typeof message.result === "string" ? message.result : "") ||
      `Claude Code ended the turn with ${typeof message.subtype === "string" ? message.subtype : "an unknown result"}.`, 2000),
    nativeSessionId, inputTokens: known ? totals.input : null, outputTokens: known ? totals.output : null,
    cacheReadTokens: known ? totals.cacheRead : null, cacheWriteTokens: known ? totals.cacheWrite : null,
    harnessEstimatedUsd: typeof message.total_cost_usd === "number" && Number.isFinite(message.total_cost_usd) && message.total_cost_usd >= 0 ? message.total_cost_usd : null,
    numTurns: integer(message.num_turns), durationMs: integer(message.duration_ms),
  };
}

/** Normalizes Claude Code stream-json/Agent SDK messages into Moguri worker frames. */
export class ClaudeStreamNormalizer {
  result?: ClaudeResultSummary;
  initialized = false;
  private readonly steps = new Map<string, { stepId: string; blocks: Json[]; model: string | null }>();
  private readonly toolSteps = new Map<string, string>();
  private current?: string;
  private lastStep: string | null = null;
  constructor(private readonly nativeSessionId: string, private readonly emit: (message: ClaudeWorkerMessage) => void) {}
  stepFor(toolUseId: string): string | null { return this.toolSteps.get(toolUseId) ?? this.lastStep; }
  private begin(messageId: string, model: string | null) {
    let step = this.steps.get(messageId);
    if (!step) {
      step = { stepId: randomUUID(), blocks: [], model };
      this.steps.set(messageId, step);
      this.emit({ kind: "claude.step", stepId: step.stepId });
    }
    this.current = messageId; this.lastStep = step.stepId;
    return step;
  }
  private flush(step: { stepId: string; blocks: Json[]; model: string | null }) {
    const text = step.blocks.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => String(block.text)).join("");
    const reasoning = step.blocks.filter((block) => block.type === "thinking" && typeof block.thinking === "string").map((block) => String(block.thinking)).join("\n");
    const toolCalls = step.blocks.filter((block) => block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string")
      .map((block) => ({ id: String(block.id), name: String(block.name), arguments: isObject(block.input) ? block.input : {} }));
    this.emit({ kind: "claude.message", stepId: step.stepId, text: bounded(text, 500 * 1024), reasoning: bounded(reasoning, 500 * 1024), toolCalls, model: step.model });
  }
  handle(raw: unknown): void {
    if (!isObject(raw)) return;
    const subagent = typeof raw.parent_tool_use_id === "string";
    if (raw.type === "system" && raw.subtype === "init") {
      if (raw.session_id !== this.nativeSessionId) throw new Error("Claude Code started a different native session than Moguri bound. No session was adopted.");
      this.initialized = true;
      this.emit({ kind: "claude.initialized", nativeSessionId: this.nativeSessionId, model: typeof raw.model === "string" ? raw.model.slice(0, 256) : null });
      return;
    }
    if (raw.type === "stream_event" && !subagent && isObject(raw.event)) {
      const event = raw.event;
      if (event.type === "message_start" && isObject(event.message) && typeof event.message.id === "string") {
        this.begin(event.message.id, typeof event.message.model === "string" ? event.message.model : null);
      } else if (event.type === "content_block_delta" && isObject(event.delta) && event.delta.type === "text_delta" &&
        typeof event.delta.text === "string" && event.delta.text && this.current) {
        const step = this.steps.get(this.current)!;
        for (let offset = 0; offset < event.delta.text.length; offset += 64 * 1024) this.emit({ kind: "claude.delta", stepId: step.stepId, text: event.delta.text.slice(offset, offset + 64 * 1024) });
      }
      return;
    }
    if (raw.type === "assistant" && !subagent && isObject(raw.message) && Array.isArray(raw.message.content)) {
      const message = raw.message, id = typeof message.id === "string" ? message.id : randomUUID();
      const step = this.begin(id, typeof message.model === "string" ? message.model : null);
      const incoming = (message.content as unknown[]).filter(isObject);
      const cumulative = step.blocks.length > 0 && incoming.length >= step.blocks.length && JSON.stringify(incoming[0]) === JSON.stringify(step.blocks[0]);
      step.blocks = cumulative ? incoming : [...step.blocks, ...incoming];
      for (const block of incoming) if (block.type === "tool_use" && typeof block.id === "string") this.toolSteps.set(block.id, step.stepId);
      this.flush(step);
      return;
    }
    if (raw.type === "user" && isObject(raw.message) && Array.isArray(raw.message.content)) {
      for (const block of raw.message.content) if (isObject(block) && block.type === "tool_result" && typeof block.tool_use_id === "string") {
        this.emit({ kind: "claude.tool_result", callId: block.tool_use_id, text: bounded(toolResultText(block.content), 256 * 1024), isError: block.is_error === true });
      }
      return;
    }
    if (raw.type === "result") this.result = summarizeResult(raw, this.nativeSessionId);
  }
}
