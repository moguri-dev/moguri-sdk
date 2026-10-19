import { getSupportedThinkingLevels, hasApi, normalizeContext, type Api, type Context, type Model } from "@earendil-works/pi-ai";
import { clampMaxTokensToContext } from "@earendil-works/pi-ai/api/simple-options";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { MoguriError, type ModelInfo, type ModelOptions, type ThinkingEffort } from "../../../packages/protocol/src/index.ts";

const CONTEXT_HEADROOM = 4096;
export function supportedThinking(model: Model<Api>): ThinkingEffort[] {
  if (!model.reasoning || hasApi(model, "openai-completions") && model.compat?.supportsReasoningEffort === false) return [];
  return getSupportedThinkingLevels(model).filter((level) => level !== "off");
}
export function validateModelOptions(model: Pick<ModelInfo, "contextWindow" | "thinkingLevels"> | undefined, options: ModelOptions | undefined): void {
  if (!options) return;
  if (!model) throw new MoguriError("model_options", "Choose an available model before configuring its context or thinking.");
  if (options.contextWindow !== undefined && options.contextWindow > model.contextWindow) throw new MoguriError("model_context", "The working context cannot exceed the selected model's supported maximum.");
  if (options.thinkingEffort !== undefined && !model.thinkingLevels?.includes(options.thinkingEffort)) throw new MoguriError("model_thinking", "This thinking effort is not supported by the selected model's actual transport. No fallback was applied.");
}
export const estimateModelContext = (context: Context): number => estimateContextTokens(normalizeContext(context)).tokens;
export function modelRequest(model: Model<Api>, options: ModelOptions | undefined, context: Context) {
  validateModelOptions({ contextWindow: model.contextWindow, thinkingLevels: supportedThinking(model) }, options);
  const selected = { ...model, contextWindow: options?.contextWindow ?? model.contextWindow };
  const normalized = normalizeContext(context);
  const estimatedTokens = estimateContextTokens(normalized).tokens;
  if (estimatedTokens + CONTEXT_HEADROOM >= selected.contextWindow) throw new MoguriError("model_context", "The estimated request exceeds the working context window. Shorten the prompt or start a new session; no history was truncated and no model request was sent.", 409);
  const maxTokens = clampMaxTokensToContext(selected, normalized, Math.min(model.maxTokens, 8192));
  return { model: { ...selected, maxTokens }, maxTokens, estimatedTokens, thinkingEffort: options?.thinkingEffort };
}
