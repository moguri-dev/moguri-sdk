import { randomUUID } from "node:crypto";
import type { AgentWorkerMessage } from "./agent-harness-protocol.ts";
import { isJson } from "./codex-app-server.ts";

type Json = Record<string, unknown>;
type Call = { id: string; name: string; arguments: Json };
const KINDS = new Set(["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode"]);
const bounded = (value: string, limit: number) => value.length > limit ? `${value.slice(0, limit)}\n[truncated]` : value;
const text = (value: unknown, limit = 4096) => typeof value === "string" ? value.slice(0, limit) : "";
/** Raw tool input stays as structured data up to 64 KiB; anything larger is recorded as truncated text. */
function rawInput(value: unknown): unknown {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value);
  return serialized === undefined ? undefined : serialized.length <= 64 * 1024 ? value : { truncated: true, text: serialized.slice(0, 64 * 1024) };
}
/** The Moguri record of an ACP tool call: its kind as the tool name, plus the title, raw input and disclosed file locations. */
export function acpCall(toolCall: Json): Call | null {
  const id = text(toolCall.toolCallId, 256);
  if (!id) return null;
  const kind = typeof toolCall.kind === "string" && KINDS.has(toolCall.kind) ? toolCall.kind : "other";
  const input = rawInput(toolCall.rawInput);
  const paths = (Array.isArray(toolCall.locations) ? toolCall.locations : []).slice(0, 64).flatMap((location) => isJson(location) && typeof location.path === "string" ?
    [{ path: text(location.path), ...(typeof location.line === "number" ? { line: location.line } : {}) }] : []);
  return { id, name: kind, arguments: { title: text(toolCall.title, 1024), ...(input !== undefined ? { rawInput: input } : {}), locations: paths,
    ...(Array.isArray(toolCall.locations) && toolCall.locations.length > 64 ? { truncated: true } : {}) } };
}
function resultOf(update: Json): { text: string; isError: boolean } {
  const parts: string[] = [];
  for (const block of Array.isArray(update.content) ? update.content : []) {
    if (!isJson(block)) continue;
    if (block.type === "content" && isJson(block.content) && block.content.type === "text") parts.push(text(block.content.text, 256 * 1024));
    else if (block.type === "diff") parts.push(`${block.oldText === null || block.oldText === undefined ? "create" : "update"} ${text(block.path)}`);
    else if (block.type === "terminal") parts.push(`Terminal ${text(block.terminalId, 128)}`);
  }
  if (!parts.length && update.rawOutput !== undefined) parts.push(typeof update.rawOutput === "string" ? update.rawOutput : JSON.stringify(update.rawOutput) ?? "");
  const status = text(update.status, 32) || "completed";
  return { text: bounded(parts.join("\n").trim() || status, 256 * 1024), isError: status === "failed" };
}

/** Groups ACP session updates into Moguri steps: message and thought chunks accumulate until a tool call ends the step. */
export class AcpUpdateNormalizer {
  private step: { stepId: string; text: string; reasoning: string; calls: Call[] } | null = null;
  private readonly calls = new Map<string, { call: Call; reviewed: boolean; done: boolean }>();
  toolsRan = false;
  constructor(private readonly model: string | null, private readonly emit: (message: AgentWorkerMessage) => void) {}
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
  private register(call: Call): void {
    if (this.calls.has(call.id)) return;
    this.open().calls.push(call);
    this.calls.set(call.id, { call, reviewed: false, done: false });
    this.flush();
  }
  /** The call a permission request reviews. A request can precede the `tool_call` notice, so it may introduce the call itself. */
  approvalCall(toolCall: Json): Call | null {
    const call = acpCall(toolCall);
    if (!call) return null;
    this.register(call);
    const owned = this.calls.get(call.id)!;
    owned.reviewed = true;
    return owned.call;
  }
  handle(update: Json): void {
    switch (update.sessionUpdate) {
      case "agent_message_chunk": case "agent_thought_chunk": {
        const chunk = isJson(update.content) && update.content.type === "text" ? text(update.content.text, 512 * 1024) : "";
        if (!chunk) return;
        const step = this.open();
        if (update.sessionUpdate === "agent_thought_chunk") { step.reasoning += chunk; return; }
        step.text += chunk;
        for (let offset = 0; offset < chunk.length; offset += 64 * 1024) this.emit({ kind: "agent.delta", stepId: step.stepId, text: chunk.slice(offset, offset + 64 * 1024) });
        return;
      }
      case "tool_call": case "tool_call_update": {
        const id = text(update.toolCallId, 256);
        if (!id) return;
        if (!this.calls.has(id)) {
          const call = acpCall(update);
          if (!call) return;
          this.register(call);
        }
        const owned = this.calls.get(id)!;
        if (owned.done || (update.status !== "completed" && update.status !== "failed")) return;
        owned.done = true;
        const result = resultOf(update);
        if (!result.isError || owned.reviewed) this.toolsRan = true;
        this.emit({ kind: "agent.tool_result", callId: id, text: result.text, isError: result.isError, ...(owned.reviewed ? {} : { autonomous: true as const }) });
        return;
      }
      default: return;
    }
  }
  /** Calls the agent announced but never finished, for example after a stop. */
  get unfinished(): number { return [...this.calls.values()].filter((entry) => entry.reviewed && !entry.done).length; }
}
export interface AcpUsage { inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null }
/** `PromptResponse.usage` for one prompt. Antigravity excludes cached reads from input; they are reported separately here. */
export function acpPromptUsage(response: unknown): AcpUsage | null {
  const usage = isJson(response) && isJson(response.usage) ? response.usage : null;
  if (!usage) return null;
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  return { inputTokens: count(usage.inputTokens), outputTokens: count(usage.outputTokens), cacheReadTokens: count(usage.cachedReadTokens), cacheWriteTokens: count(usage.cachedWriteTokens) };
}
/** The agent's own USD cost estimate from a `usage_update`, when it reports one. */
export function acpUsdEstimate(update: Json): number | null {
  const cost = isJson(update.cost) ? update.cost : null;
  return cost && cost.currency === "USD" && typeof cost.amount === "number" && Number.isFinite(cost.amount) && cost.amount >= 0 ? cost.amount : null;
}
export const MOGURI_ACP_INSTRUCTIONS = "You are running inside Moguri, which records this session and reviews every tool call you ask permission for. If Moguri rejects a request, do not retry it through another tool or a workaround; explain what you need instead.";
