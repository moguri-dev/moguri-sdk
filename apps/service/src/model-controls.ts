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
export function contextHasImages(messages: Context["messages"]): boolean {
  return messages.some((message) => typeof message.content !== "string" && message.content.some((block) => block.type === "image"));
}
export function validateContextSize(messages: Context["messages"]): void {
  const text = messages.map((message) => message.role === "assistant" || typeof message.content === "string" ? message :
    { ...message, content: message.content.map((block) => block.type === "image" ? { ...block, data: "" } : block) });
  if (Buffer.byteLength(JSON.stringify(text)) > 1024 * 1024) throw new MoguriError("context_limit", "Conversation text exceeds 1 MiB. Existing history is preserved; start a new session before inference.", 409);
  if (Buffer.byteLength(JSON.stringify(messages)) > 16 * 1024 * 1024) throw new MoguriError("context_limit", "Conversation including approved image data exceeds 16 MiB. Existing history is preserved; no image was dropped or request sent.", 409);
}
export function modelRequest(model: Model<Api>, options: ModelOptions | undefined, context: Context) {
  validateContextSize(context.messages);
  if (!model.input.includes("image") && contextHasImages(context.messages)) throw new MoguriError("model_images", "This model cannot receive the approved images. Select an image-capable model or remove the image context; no content was dropped or sent.", 409);
  validateModelOptions({ contextWindow: model.contextWindow, thinkingLevels: supportedThinking(model) }, options);
  const selected = { ...model, contextWindow: options?.contextWindow ?? model.contextWindow };
  const normalized = normalizeContext(context);
  const estimatedTokens = estimateContextTokens(normalized).tokens;
  if (estimatedTokens + CONTEXT_HEADROOM >= selected.contextWindow) throw new MoguriError("model_context", "The estimated request exceeds the working context window. Shorten the prompt or start a new session; no history was truncated and no model request was sent.", 409);
  const maxTokens = clampMaxTokensToContext(selected, normalized, Math.min(model.maxTokens, 8192));
  return { model: { ...selected, maxTokens }, maxTokens, estimatedTokens, thinkingEffort: options?.thinkingEffort };
}
