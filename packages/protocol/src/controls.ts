import { Type, type Static } from "typebox";
import { ModelOptionsSchema } from "./model.ts";

export const ControlsSchema = Type.Object({
  env: Type.Union([Type.Literal("Local"), Type.Literal("Sandbox"), Type.Literal("Remote")]),
  modelId: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
  autonomy: Type.Union([Type.Literal("Manual"), Type.Literal("Guided"), Type.Literal("Autopilot"), Type.Literal("Autopilot Max")]),
  budget: Type.Union([
    Type.Object({ kind: Type.Literal("unlimited") }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal("limited"), tokens: Type.Optional(Type.Integer({ minimum: 1 })), usd: Type.Optional(Type.Number({ exclusiveMinimum: 0 })) }, { additionalProperties: false }),
  ]),
  modelOptions: Type.Optional(ModelOptionsSchema),
}, { additionalProperties: false });
export type Controls = Static<typeof ControlsSchema>;
export const ControlDefaultsSchema = Type.Partial(ControlsSchema);
export type ControlDefaults = Static<typeof ControlDefaultsSchema>;
export type DefaultSource = "factory" | "global" | "profile" | "project" | "session";
export interface DefaultsSnapshot {
  sources: Record<keyof Controls, DefaultSource>;
  settingsRevision: number;
  projectRevision: number | null;
}
export interface ResolvedControls { controls: Controls; defaults: DefaultsSnapshot }
export const controlKeys = ["env", "modelId", "autonomy", "budget", "modelOptions"] as const;
export const factoryControls = (): Controls => ({ env: "Local", modelId: null, autonomy: "Manual", budget: { kind: "unlimited" } });
export function resolveControls(layers: { source: Exclude<DefaultSource, "factory">; values: ControlDefaults }[], revisions: { settingsRevision: number; projectRevision: number | null }): ResolvedControls {
  const controls = factoryControls();
  const sources: DefaultsSnapshot["sources"] = { env: "factory", modelId: "factory", autonomy: "factory", budget: "factory", modelOptions: "factory" };
  for (const layer of layers) {
    Object.assign(controls, structuredClone(layer.values));
    for (const key of controlKeys) if (Object.hasOwn(layer.values, key)) sources[key] = layer.source;
  }
  return { controls, defaults: { sources, ...revisions } };
}
