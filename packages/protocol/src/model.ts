import { Type, type Static } from "typebox";
import { MoguriError } from "./core.ts";

export const MIN_WORKING_CONTEXT = 8192;
export interface ModelWindowCapability { contextWindow: number; supportedContextWindows?: readonly number[] }
export interface ModelContextWindows { source: "maximum-and-half" | "provider"; values: number[] }
export function modelContextWindows(model: ModelWindowCapability): ModelContextWindows {
  if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow < 1 || model.contextWindow > 10_000_000) throw new MoguriError("model_context", "The model's context window maximum is invalid.");
  const declared = model.supportedContextWindows;
  if (declared !== undefined && (!Array.isArray(declared) || !declared.length || declared.length > 32 ||
    declared.some((value) => !Number.isSafeInteger(value) || value < 1 || value > model.contextWindow))) {
    throw new MoguriError("model_context", "The provider-declared working windows are invalid. No extra window was inferred.");
  }
  const values = declared ?? [model.contextWindow, Math.floor(model.contextWindow / 2)];
  return { source: declared ? "provider" : "maximum-and-half", values: [...new Set(values)].filter((value) => value >= MIN_WORKING_CONTEXT).sort((a, b) => b - a) };
}
export function supportsModelContextWindow(model: ModelWindowCapability, value: number): boolean {
  const windows = modelContextWindows(model);
  return Number.isSafeInteger(value) && value >= MIN_WORKING_CONTEXT && value <= model.contextWindow &&
    (windows.source !== "provider" || windows.values.includes(value));
}

export const ThinkingEffortSchema = Type.Union([
  Type.Literal("off"), Type.Literal("minimal"), Type.Literal("low"), Type.Literal("medium"),
  Type.Literal("high"), Type.Literal("xhigh"), Type.Literal("max"),
]);
export type ThinkingEffort = Static<typeof ThinkingEffortSchema>;
export function supportedThinkingEffort(preferred: ThinkingEffort, supported: readonly ThinkingEffort[]): ThinkingEffort | undefined {
  const order: readonly ThinkingEffort[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  return supported.includes(preferred) ? preferred :
    order.slice(order.indexOf(preferred) + 1).find((effort) => supported.includes(effort)) ??
    [...order].reverse().find((effort) => supported.includes(effort));
}
export const ModelOptionsSchema = Type.Object({
  contextWindow: Type.Optional(Type.Integer({ minimum: 8192, maximum: 10_000_000 })),
  thinkingEffort: Type.Optional(ThinkingEffortSchema),
}, { additionalProperties: false });
export type ModelOptions = Static<typeof ModelOptionsSchema>;
export const ModelSelectionSchema = Type.Object({
  modelId: Type.String({ minLength: 1, maxLength: 128 }),
  thinkingEffort: Type.Optional(ThinkingEffortSchema),
  preferredThinkingEffort: Type.Optional(ThinkingEffortSchema),
}, { additionalProperties: false });
export type ModelSelection = Static<typeof ModelSelectionSchema>;
export function modelSelection(controls: { modelId: string | null; modelOptions?: ModelOptions; preferredThinkingEffort?: ThinkingEffort }): ModelSelection | null {
  return controls.modelId === null ? null : { modelId: controls.modelId,
    ...(controls.preferredThinkingEffort !== undefined ? { preferredThinkingEffort: controls.preferredThinkingEffort } : {}),
    ...(controls.modelOptions?.thinkingEffort !== undefined ? { thinkingEffort: controls.modelOptions.thinkingEffort } : {}) };
}
export const ModelStreamObservationSchema = Type.Object({
  firstOutputMs: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  streamMs: Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.Null()]),
  outputEvents: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  cacheReadReported: Type.Boolean(), cacheWriteReported: Type.Boolean(),
}, { additionalProperties: false });
export type ModelStreamObservation = Static<typeof ModelStreamObservationSchema>;
export interface ModelContextPreview {
  estimatedTokens: number;
  contextWindow: number | null;
  modelMaximum: number | null;
  source: "estimated";
  windows: ModelContextWindows | null;
}
