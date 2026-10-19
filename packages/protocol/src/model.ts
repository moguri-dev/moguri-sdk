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
export interface ModelContextPreview {
  estimatedTokens: number;
  contextWindow: number | null;
  modelMaximum: number | null;
  source: "estimated";
}
