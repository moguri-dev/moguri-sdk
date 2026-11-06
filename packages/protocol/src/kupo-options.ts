import { Type, type Static } from "typebox";
import { ModelOptionsSchema, type ModelContextWindows, type ModelOptions, type ThinkingEffort } from "./model.ts";

export const KupoOptionsQuerySchema = Type.Object({
  type: Type.Literal("routing.options"),
  sessionId: Type.String({ minLength: 1, maxLength: 128 }),
  options: Type.Optional(ModelOptionsSchema),
}, { additionalProperties: false });
export type KupoOptionsQuery = Static<typeof KupoOptionsQuerySchema>;
export interface KupoOptionsReport {
  sessionId: string;
  env: "Local" | "Remote" | "Sandbox";
  options: ModelOptions;
  available: boolean;
  diagnostic: string | null;
  modelIds: string[];
  windows: ModelContextWindows;
  thinkingLevels: ThinkingEffort[];
}
export type KupoOptionsResponse = { type: "routing.options"; report: KupoOptionsReport };
