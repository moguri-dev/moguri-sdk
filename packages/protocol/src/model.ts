import { Type, type Static } from "typebox";

export const ThinkingEffortSchema = Type.Union([
  Type.Literal("off"), Type.Literal("minimal"), Type.Literal("low"), Type.Literal("medium"),
  Type.Literal("high"), Type.Literal("xhigh"), Type.Literal("max"),
]);
export type ThinkingEffort = Static<typeof ThinkingEffortSchema>;
export const ModelOptionsSchema = Type.Object({
  contextWindow: Type.Optional(Type.Integer({ minimum: 8192, maximum: 10_000_000 })),
  thinkingEffort: Type.Optional(ThinkingEffortSchema),
}, { additionalProperties: false });
export type ModelOptions = Static<typeof ModelOptionsSchema>;
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
}
