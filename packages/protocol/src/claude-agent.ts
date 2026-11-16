import { Type, type Static } from "typebox";
import type { ModelInfo } from "./index.ts";

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

