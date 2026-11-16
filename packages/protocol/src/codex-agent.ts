import { Type, type Static } from "typebox";
import type { ModelInfo } from "./index.ts";

/** Codex Agent runs the user's own installed Codex CLI through `codex app-server` with the user's own `codex login`. */
export const CODEX_AGENT_PROVIDER_ID = "codex-agent";
export const CodexAgentSettingsSchema = Type.Object({
  enabled: Type.Boolean(),
  executablePath: Type.Union([Type.String({ minLength: 1, maxLength: 4096, pattern: "^/" }), Type.Null()]),
}, { additionalProperties: false });
export type CodexAgentSettings = Static<typeof CodexAgentSettingsSchema>;
/** Off by default: enabling is the user's explicit consent to run their own Codex install. */
export const defaultCodexAgentSettings = (): CodexAgentSettings => ({ enabled: false, executablePath: null });
export interface CodexAgentModel { model: string; displayName: string; imageInput: boolean; isDefault: boolean }
const safe = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
/** Browser-safe FNV-1a label for model names that are not already safe IDs; identity stays in apiModelId. */
const label = (value: string) => [0x811c9dc5, 0x01000193].map((seed) => {
  let hash = seed;
  for (const char of value) hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}).join("");
export const codexAgentModelId = (model: string) => `${CODEX_AGENT_PROVIDER_ID}.${safe.test(model) ? model : label(model)}`;
export const codexAgentModelInfo = (model: CodexAgentModel): ModelInfo => ({
  id: codexAgentModelId(model.model), name: `Codex Agent / ${model.displayName}`.slice(0, 160), contextWindow: 200_000, maxTokens: 32_000,
  imageInput: false, toolInput: true, thinkingLevels: [], kupoThinkingLevels: [], providerId: CODEX_AGENT_PROVIDER_ID, source: "codex-agent",
  apiModelId: `${CODEX_AGENT_PROVIDER_ID}:${model.model}`, endpointBoundary: "network", environments: ["Local"],
});
/** The Codex model name behind a selectable ID, from the advertised catalogue's apiModelId. */
export const codexAgentModelName = (model: Pick<ModelInfo, "apiModelId"> | undefined): string | null =>
  model?.apiModelId?.startsWith(`${CODEX_AGENT_PROVIDER_ID}:`) ? model.apiModelId.slice(CODEX_AGENT_PROVIDER_ID.length + 1) : null;
