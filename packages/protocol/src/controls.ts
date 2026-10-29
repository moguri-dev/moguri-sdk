import { Type, type Static } from "typebox";
import { ModelOptionsSchema, supportedThinkingEffort, ThinkingEffortSchema, type ModelSelection, type ThinkingEffort } from "./model.ts";
import { SessionBudgetSchema } from "./budgets.ts";
import { VerbositySchema } from "./preferences.ts";

export const ControlsSchema = Type.Object({
  env: Type.Union([Type.Literal("Local"), Type.Literal("Sandbox"), Type.Literal("Remote")]),
  modelId: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
  autonomy: Type.Union([Type.Literal("Manual"), Type.Literal("Guided"), Type.Literal("Autopilot"), Type.Literal("Autopilot Max")]),
  automaticApprovals: Type.Optional(Type.Boolean()),
  budget: SessionBudgetSchema,
  modelOptions: Type.Optional(ModelOptionsSchema),
  preferredThinkingEffort: Type.Optional(ThinkingEffortSchema),
  verbosity: Type.Optional(VerbositySchema),
}, { additionalProperties: false });
export type Controls = Static<typeof ControlsSchema>;
export const ControlDefaultsSchema = Type.Partial(ControlsSchema);
export type ControlDefaults = Static<typeof ControlDefaultsSchema>;
export type DefaultSource = "factory" | "last-used" | "global" | "profile" | "project" | "session";
export interface DefaultsSnapshot {
  sources: Record<Exclude<keyof Controls, "verbosity" | "automaticApprovals" | "preferredThinkingEffort">, DefaultSource> & { verbosity?: DefaultSource; automaticApprovals?: DefaultSource; preferredThinkingEffort?: DefaultSource };
  settingsRevision: number;
  projectRevision: number | null;
}
export interface ResolvedControls { controls: Controls; defaults: DefaultsSnapshot }
export const controlKeys = ["env", "modelId", "autonomy", "automaticApprovals", "budget", "modelOptions", "preferredThinkingEffort", "verbosity"] as const;
export const factoryControls = (): Controls => ({ env: "Local", modelId: null, autonomy: "Manual", budget: { kind: "unlimited" } });
export function selectModelControls(controls: Controls, model: { id: string; synthetic?: boolean; thinkingLevels?: readonly ThinkingEffort[] } | null): Controls {
  const preferred = controls.preferredThinkingEffort ?? controls.modelOptions?.thinkingEffort;
  const effort = preferred && model && !model.synthetic ? supportedThinkingEffort(preferred, model.thinkingLevels ?? []) : undefined;
  const { modelOptions: _, preferredThinkingEffort: __, ...other } = controls;
  return { ...other, modelId: model?.id ?? null,
    ...(effort !== undefined ? { modelOptions: { thinkingEffort: effort } } : {}),
    ...(preferred !== undefined && preferred !== effort ? { preferredThinkingEffort: preferred } : {}) };
}
export function resolveControls(layers: { source: Exclude<DefaultSource, "factory" | "last-used">; values: ControlDefaults }[], revisions: { settingsRevision: number; projectRevision: number | null }, lastModelSelection?: ModelSelection | null): ResolvedControls {
  const controls = factoryControls();
  const sources: DefaultsSnapshot["sources"] = { env: "factory", modelId: "factory", autonomy: "factory", budget: "factory", modelOptions: "factory" };
  for (const layer of layers) {
    Object.assign(controls, structuredClone(layer.values));
    if (Object.hasOwn(layer.values, "autonomy") && !Object.hasOwn(layer.values, "automaticApprovals")) {
      if (layer.source === "session" && (layer.values.autonomy === "Autopilot" || layer.values.autonomy === "Autopilot Max")) {
        controls.automaticApprovals = true;
        sources.automaticApprovals = layer.source;
      } else { delete controls.automaticApprovals; delete sources.automaticApprovals; }
    }
    for (const key of controlKeys) if (Object.hasOwn(layer.values, key)) sources[key] = layer.source;
  }
  if (sources.modelId === "factory" && lastModelSelection) {
    controls.modelId = lastModelSelection.modelId; sources.modelId = "last-used";
    if (sources.modelOptions === "factory" && lastModelSelection.thinkingEffort !== undefined) {
      controls.modelOptions = { thinkingEffort: lastModelSelection.thinkingEffort }; sources.modelOptions = "last-used";
    }
    if ((sources.modelOptions === "factory" || sources.modelOptions === "last-used") &&
      lastModelSelection.preferredThinkingEffort !== undefined && controls.preferredThinkingEffort === undefined) {
      controls.preferredThinkingEffort = lastModelSelection.preferredThinkingEffort; sources.preferredThinkingEffort = "last-used";
    }
  }
  return { controls, defaults: { sources, ...revisions } };
}
