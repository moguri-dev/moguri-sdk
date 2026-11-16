import { Type, type Static } from "typebox";
import type { ModelInfo } from "./index.ts";
import type { PublicMessage } from "./index.ts";

/**
 * Claude Agent runs the user's own installed, unmodified Claude Code as an external harness.
 * Claude Code owns its model calls and tool execution; Moguri owns sessions, approvals,
 * cancellation records and history. See docs/architecture/claude-agent.md.
 */
export const CLAUDE_AGENT_PROVIDER_ID = "claude-agent";
export const CLAUDE_AGENT_HARNESS = "claude-agent";
export const ClaudeAgentTransportSchema = Type.Union([Type.Literal("sdk"), Type.Literal("stream-json")]);
export type ClaudeAgentTransport = Static<typeof ClaudeAgentTransportSchema>;
export const ClaudeAgentSettingsSchema = Type.Object({
  enabled: Type.Boolean(),
  transport: ClaudeAgentTransportSchema,
  executablePath: Type.Union([Type.String({ minLength: 1, maxLength: 4096, pattern: "^/" }), Type.Null()]),
}, { additionalProperties: false });
export type ClaudeAgentSettings = Static<typeof ClaudeAgentSettingsSchema>;
/** Off by default: enabling is the user's explicit consent to run their own Claude Code install. */
export const defaultClaudeAgentSettings = (): ClaudeAgentSettings => ({ enabled: false, transport: "sdk", executablePath: null });

/** Claude Code model aliases always resolve to the account's current model of that tier. */
export const CLAUDE_AGENT_MODELS = [
  { alias: "sonnet", name: "Claude Agent / Sonnet", contextWindow: 200_000, maxTokens: 64_000 },
  { alias: "opus", name: "Claude Agent / Opus", contextWindow: 200_000, maxTokens: 32_000 },
  { alias: "haiku", name: "Claude Agent / Haiku", contextWindow: 200_000, maxTokens: 64_000 },
] as const;
export type ClaudeAgentModelAlias = typeof CLAUDE_AGENT_MODELS[number]["alias"];
export const claudeAgentModelId = (alias: ClaudeAgentModelAlias) => `${CLAUDE_AGENT_PROVIDER_ID}.${alias}`;
export function claudeAgentAlias(modelId: string | null | undefined): ClaudeAgentModelAlias | null {
  if (!modelId?.startsWith(`${CLAUDE_AGENT_PROVIDER_ID}.`)) return null;
  return CLAUDE_AGENT_MODELS.find((model) => claudeAgentModelId(model.alias) === modelId)?.alias ?? null;
}
export const isClaudeAgentModel = (model: Pick<ModelInfo, "id" | "source"> | null | undefined): boolean =>
  Boolean(model && (model.source === "claude-agent" || claudeAgentAlias(model.id)));
export const claudeAgentModelInfo = (alias: ClaudeAgentModelAlias): ModelInfo => {
  const model = CLAUDE_AGENT_MODELS.find((entry) => entry.alias === alias)!;
  return { id: claudeAgentModelId(alias), name: model.name, contextWindow: model.contextWindow, maxTokens: model.maxTokens, imageInput: false, toolInput: true,
    thinkingLevels: [], kupoThinkingLevels: [], providerId: CLAUDE_AGENT_PROVIDER_ID, source: "claude-agent", apiModelId: `${CLAUDE_AGENT_PROVIDER_ID}:${alias}`,
    endpointBoundary: "network", environments: ["Local"] };
};

export const ClaudeAgentAuthMethodSchema = Type.Union([
  Type.Literal("none"), Type.Literal("claude.ai"), Type.Literal("oauth_token"), Type.Literal("api_key"), Type.Literal("api_key_helper"), Type.Literal("third_party"), Type.Literal("unknown"),
]);
export type ClaudeAgentAuthMethod = Static<typeof ClaudeAgentAuthMethodSchema>;
export const ClaudeAgentSessionBindingSchema = Type.Object({
  harness: Type.Literal(CLAUDE_AGENT_HARNESS),
  nativeSessionId: Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" }),
  modelId: Type.String({ minLength: 1, maxLength: 128 }),
  transport: ClaudeAgentTransportSchema,
  executable: Type.Object({ path: Type.String({ minLength: 1, maxLength: 4096 }), version: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false }),
  authMethod: ClaudeAgentAuthMethodSchema,
  root: Type.String({ minLength: 1, maxLength: 4096 }),
  resumed: Type.Boolean(),
}, { additionalProperties: false });
export type ClaudeAgentSessionBinding = Static<typeof ClaudeAgentSessionBindingSchema>;
const tokens = Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]);
/** Claude Code's modelUsage/total_cost_usd are cumulative running totals for the native session, not per-turn deltas. */
export const ClaudeAgentUsageSchema = Type.Object({
  harness: Type.Literal(CLAUDE_AGENT_HARNESS),
  nativeSessionId: Type.String({ minLength: 1, maxLength: 64 }),
  inputTokens: tokens, outputTokens: tokens, cacheReadTokens: tokens, cacheWriteTokens: tokens,
  /** Claude Code's own cumulative estimate. It is neither provider-reported nor billed cost. */
  harnessEstimatedUsd: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  numTurns: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  durationMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  outcome: Type.String({ minLength: 1, maxLength: 64 }),
}, { additionalProperties: false });
export type ClaudeAgentUsage = Static<typeof ClaudeAgentUsageSchema>;
export interface ClaudeAgentEventPayloads {
  "agent.session_bound": { binding: ClaudeAgentSessionBinding };
  "agent.step_started": { harness: typeof CLAUDE_AGENT_HARNESS; modelId: string };
  "agent.message": { harness: typeof CLAUDE_AGENT_HARNESS; message: PublicMessage; contextDigest: string };
  "agent.usage": { usage: ClaudeAgentUsage };
}
export const claudeAgentEventTypes = ["agent.session_bound", "agent.step_started", "agent.message", "agent.usage"] as const;
export function claudeAgentUsageNotice(usage: ClaudeAgentUsage): string {
  const count = (value: number | null) => value === null ? "unknown" : value.toLocaleString("en-US");
  const cost = usage.harnessEstimatedUsd === null ? "no cost estimate" : `Claude Code estimate $${usage.harnessEstimatedUsd.toFixed(4)} (not a bill)`;
  return `Claude Agent session totals reported by Claude Code: ${count(usage.inputTokens)} input, ${count(usage.outputTokens)} output, ${count(usage.cacheReadTokens)} cache-read tokens; ${cost}.`;
}
