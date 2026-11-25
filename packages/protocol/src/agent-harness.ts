import { Type, type Static } from "typebox";
import type { PublicMessage } from "./index.ts";

/**
 * External agent harnesses (Claude Code, Codex) run the user's own installed CLI. The harness owns its
 * model calls and tool execution; Moguri owns sessions, approvals, cancellation records and history.
 * See docs/architecture/agent-harnesses.md.
 */
export const AGENT_HARNESSES = ["claude-agent", "codex-agent", "antigravity-agent", "gemini-agent"] as const;
export type AgentHarness = typeof AGENT_HARNESSES[number];
export const AgentHarnessSchema = Type.Union([Type.Literal("claude-agent"), Type.Literal("codex-agent"), Type.Literal("antigravity-agent"), Type.Literal("gemini-agent")]);
export const AgentTransportSchema = Type.Union([Type.Literal("sdk"), Type.Literal("stream-json"), Type.Literal("app-server"), Type.Literal("acp")]);
export type AgentTransport = Static<typeof AgentTransportSchema>;
export const AgentAuthMethodSchema = Type.Union([
  Type.Literal("none"), Type.Literal("claude.ai"), Type.Literal("oauth_token"), Type.Literal("api_key"), Type.Literal("api_key_helper"),
  Type.Literal("third_party"), Type.Literal("chatgpt"), Type.Literal("unknown"),
]);
export type AgentAuthMethod = Static<typeof AgentAuthMethodSchema>;
export const AgentSessionBindingSchema = Type.Object({
  harness: AgentHarnessSchema,
  nativeSessionId: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" }),
  modelId: Type.String({ minLength: 1, maxLength: 128 }),
  transport: AgentTransportSchema,
  executable: Type.Object({ path: Type.String({ minLength: 1, maxLength: 4096 }), version: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false }),
  authMethod: AgentAuthMethodSchema,
  root: Type.String({ minLength: 1, maxLength: 4096 }),
  resumed: Type.Boolean(),
}, { additionalProperties: false });
export type AgentSessionBinding = Static<typeof AgentSessionBindingSchema>;
const tokens = Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]);
/** Claude Code and Codex usage totals are cumulative for the native session; ACP agents report the prompt's own usage. */
export const AgentUsageSchema = Type.Object({
  harness: AgentHarnessSchema,
  nativeSessionId: Type.String({ minLength: 1, maxLength: 128 }),
  inputTokens: tokens, outputTokens: tokens, cacheReadTokens: tokens, cacheWriteTokens: tokens,
  /** The harness's own estimate when it reports one. It is neither provider-reported nor billed cost. */
  harnessEstimatedUsd: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  numTurns: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  durationMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  outcome: Type.String({ minLength: 1, maxLength: 64 }),
}, { additionalProperties: false });
export type AgentUsage = Static<typeof AgentUsageSchema>;
export interface AgentEventPayloads {
  "agent.session_bound": { binding: AgentSessionBinding };
  "agent.step_started": { harness: AgentHarness; modelId: string };
  "agent.message": { harness: AgentHarness; message: PublicMessage; contextDigest: string };
  "agent.usage": { usage: AgentUsage };
}
export const agentEventTypes = ["agent.session_bound", "agent.step_started", "agent.message", "agent.usage"] as const;
const HARNESS_LABELS: Record<AgentHarness, { name: string; product: string; cumulativeUsage: boolean }> = {
  "claude-agent": { name: "Claude Agent", product: "Claude Code", cumulativeUsage: true },
  "codex-agent": { name: "Codex Agent", product: "Codex", cumulativeUsage: true },
  "antigravity-agent": { name: "Antigravity Agent", product: "Antigravity CLI", cumulativeUsage: false },
  "gemini-agent": { name: "Gemini CLI Agent", product: "Gemini CLI", cumulativeUsage: false },
};
export const agentHarnessName = (harness: AgentHarness) => HARNESS_LABELS[harness].name;
export const agentHarnessOf = (modelId: string | null | undefined): AgentHarness | null =>
  AGENT_HARNESSES.find((harness) => modelId?.startsWith(`${harness}.`)) ?? null;
export function agentUsageNotice(usage: AgentUsage): string {
  const count = (value: number | null) => value === null ? "unknown" : value.toLocaleString("en-US");
  const product = agentHarnessProduct(usage.harness);
  const cost = usage.harnessEstimatedUsd === null ? "no cost estimate" : `${product} estimate $${usage.harnessEstimatedUsd.toFixed(4)} (not a bill)`;
  // ACP agents report usage per prompt; Claude Code and Codex report native-session totals.
  return `${agentHarnessName(usage.harness)} ${HARNESS_LABELS[usage.harness].cumulativeUsage ? "session totals" : "usage for this prompt"} reported by ${product}: ${count(usage.inputTokens)} input, ${count(usage.outputTokens)} output, ${count(usage.cacheReadTokens)} cache-read tokens; ${cost}.`;
}
/** Harness models are selectable chat sessions only, never naming, compaction, routing or helper models. */
export const isAgentHarnessModel = (model: { id: string; source?: string } | null | undefined): boolean =>
  Boolean(model && ((AGENT_HARNESSES as readonly string[]).includes(model.source ?? "") || agentHarnessOf(model.id)));
export const agentHarnessProduct = (harness: AgentHarness) => HARNESS_LABELS[harness].product;
