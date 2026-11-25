import { Type, type Static } from "typebox";
import type { ModelInfo } from "./index.ts";

/**
 * Protocol 124 (D79). ACP harnesses run the user's own installed agent CLI over the Agent Client Protocol with the user's own sign-in:
 * Antigravity Agent runs `agy acp` and Gemini CLI Agent runs `gemini --acp`. Moguri never installs them, never signs in for the user and
 * never reads their credentials. See docs/architecture/agent-harnesses.md.
 */
export const ACP_HARNESSES = ["antigravity-agent", "gemini-agent"] as const;
export type AcpHarness = typeof ACP_HARNESSES[number];
export const AcpAgentSettingsSchema = Type.Object({
  enabled: Type.Boolean(),
  executablePath: Type.Union([Type.String({ minLength: 1, maxLength: 4096, pattern: "^/" }), Type.Null()]),
}, { additionalProperties: false });
export type AcpAgentSettings = Static<typeof AcpAgentSettingsSchema>;
/** Off by default: enabling is the user's explicit consent to run their own install. */
export const defaultAcpAgentSettings = (): AcpAgentSettings => ({ enabled: false, executablePath: null });
export const ACP_AGENT_SPECS = {
  "antigravity-agent": { name: "Antigravity Agent", product: "Antigravity CLI", command: "agy", args: ["acp"], signIn: "agy", minimumVersion: "1.5.0",
    install: "https://antigravity.google/docs/cli", settingsKey: "antigravityAgent" },
  "gemini-agent": { name: "Gemini CLI Agent", product: "Gemini CLI", command: "gemini", args: ["--acp"], signIn: "gemini", minimumVersion: null,
    install: "https://github.com/google-gemini/gemini-cli", settingsKey: "geminiAgent" },
} as const satisfies Record<AcpHarness, { name: string; product: string; command: string; args: readonly string[]; signIn: string; minimumVersion: string | null; install: string; settingsKey: string }>;
/** A model the agent offers in its session setup. An empty `model` is the agent's own default when it lists none. */
export interface AcpAgentModel { model: string; displayName: string }
const safe = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
/** Browser-safe FNV-1a label for model IDs that are not already safe; identity stays in apiModelId. */
const label = (value: string) => [0x811c9dc5, 0x01000193].map((seed) => {
  let hash = seed;
  for (const char of value) hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}).join("");
export const acpAgentModelId = (harness: AcpHarness, model: string) => `${harness}.${!model ? "default" : safe.test(model) ? model : label(model)}`;
export const acpAgentModelInfo = (harness: AcpHarness, model: AcpAgentModel): ModelInfo => ({
  id: acpAgentModelId(harness, model.model), name: `${ACP_AGENT_SPECS[harness].name} / ${model.displayName}`.slice(0, 160), contextWindow: 200_000, maxTokens: 32_000,
  imageInput: false, toolInput: true, thinkingLevels: [], kupoThinkingLevels: [], providerId: harness, source: harness,
  apiModelId: `${harness}:${model.model}`, endpointBoundary: "network", environments: ["Local"],
});
/** The agent's model ID behind a selectable model (empty for the agent's default), from the advertised catalogue's apiModelId. */
export const acpAgentModelName = (harness: AcpHarness, model: Pick<ModelInfo, "apiModelId"> | undefined): string | null =>
  model?.apiModelId?.startsWith(`${harness}:`) ? model.apiModelId.slice(harness.length + 1) : null;
export const isAcpHarness = (value: string | null | undefined): value is AcpHarness => (ACP_HARNESSES as readonly string[]).includes(value ?? "");
