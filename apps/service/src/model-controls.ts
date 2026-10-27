import { getSupportedThinkingLevels, hasApi, normalizeContext, type Api, type Context, type Model, type Message } from "@earendil-works/pi-ai";
import { clampMaxTokensToContext } from "@earendil-works/pi-ai/api/simple-options";
import { estimateContextTokens, estimateMessageTokens } from "@earendil-works/pi-ai/utils/estimate";
import { modelContextWindows, MoguriError, type ModelInfo, type ModelOptions, type ModelWindowCapability, type ThinkingEffort } from "../../../packages/protocol/src/index.ts";

const CONTEXT_HEADROOM = 4096;
export function supportedThinking(model: Model<Api>): ThinkingEffort[] {
  if (!model.reasoning || hasApi(model, "openai-completions") && model.compat?.supportsReasoningEffort === false) return [];
  return getSupportedThinkingLevels(model).filter((level) => level !== "off");
}
export function validateModelOptions(model: (ModelWindowCapability & Pick<ModelInfo, "thinkingLevels">) | undefined, options: ModelOptions | undefined): void {
  if (!options) return;
  if (!model) throw new MoguriError("model_options", "Choose an available model before configuring its context or thinking.");
  if (options.contextWindow !== undefined && options.contextWindow > model.contextWindow) throw new MoguriError("model_context", "The working context cannot exceed the selected model's supported maximum.");
  if (options.contextWindow !== undefined && !modelContextWindows(model).values.includes(options.contextWindow)) throw new MoguriError("model_context", "This working window is not offered by the selected model. Choose a supported window explicitly; saved settings and history were not clamped or discarded.", 409);
  if (options.thinkingEffort !== undefined && !model.thinkingLevels?.includes(options.thinkingEffort)) throw new MoguriError("model_thinking", "This thinking effort is not supported by the selected model's actual transport. No fallback was applied.");
}
export const estimateMessageContext = (messages: readonly Message[]): number => messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
// A retained report may describe an older prefix; it cannot lower current request sizing.
const estimateNormalizedContext = (context: ReturnType<typeof normalizeContext>): number => Math.max(estimateContextTokens(context).tokens, estimateMessageContext(context.messages));
export const estimateModelContext = (context: Context): number => estimateNormalizedContext(normalizeContext(context));
export function contextHasImages(messages: Context["messages"]): boolean {
  return messages.some((message) => typeof message.content !== "string" && message.content.some((block) => block.type === "image"));
}
export function validateContextSize(messages: Context["messages"]): void {
  let imageBytes = 0;
  for (const message of messages) if (typeof message.content !== "string") {
    for (const block of message.content) if (block.type === "image") imageBytes += Buffer.byteLength(block.data);
  }
  if (imageBytes > 16 * 1024 * 1024) throw new MoguriError("context_limit", "Approved image data exceeds the 16 MiB image-resource bound. Existing history is preserved; no image was dropped or request sent.", 409);
}
export function modelRequest(model: Model<Api> & Pick<ModelWindowCapability, "supportedContextWindows">, options: ModelOptions | undefined, context: Context, advertised: ModelWindowCapability = model) {
  if (model.contextWindow !== advertised.contextWindow || JSON.stringify(modelContextWindows(model)) !== JSON.stringify(modelContextWindows(advertised))) throw new MoguriError("model_context_changed", "The prepared model's working windows changed from its advertised capabilities. Refresh and choose explicitly; no request was sent.", 409);
  validateContextSize(context.messages);
  if (!model.input.includes("image") && contextHasImages(context.messages)) throw new MoguriError("model_images", "This model cannot receive the approved images. Select an image-capable model or remove the image context; no content was dropped or sent.", 409);
  validateModelOptions({ ...model, thinkingLevels: supportedThinking(model) }, options);
  const window = options?.contextWindow ?? modelContextWindows(model).values[0];
  if (window === undefined) throw new MoguriError("model_context", "This model offers no supported working window at or above 8,192 tokens. No request was sent.", 409);
  const selected = { ...model, contextWindow: window };
  const normalized = normalizeContext(context);
  const estimatedTokens = estimateNormalizedContext(normalized);
  if (estimatedTokens + CONTEXT_HEADROOM >= selected.contextWindow) throw new MoguriError("model_context", "The estimated request exceeds the working context window. Compact context in this session or choose a larger supported window; all conversation history is preserved and no model request was sent.", 409);
  const maxTokens = clampMaxTokensToContext(selected, normalized, Math.min(model.maxTokens, selected.contextWindow - estimatedTokens - CONTEXT_HEADROOM));
  return { model: { ...selected, maxTokens }, maxTokens, estimatedTokens, thinkingEffort: options?.thinkingEffort };
}
