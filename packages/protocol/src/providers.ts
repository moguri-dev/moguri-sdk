import { Type, type Static } from "typebox";
import type { ModelInfo } from "./index.ts";
import { MoguriError } from "./core.ts";

const providerId = Type.String({ minLength: 1, maxLength: 128 });
const modelKey = Type.String({ minLength: 1, maxLength: 200 });
export const ModelPreferencesSchema = Type.Object({
  disabledProviders: Type.Array(providerId, { maxItems: 32, uniqueItems: true }),
  disabledModels: Type.Array(modelKey, { maxItems: 1024, uniqueItems: true }),
  sources: Type.Array(Type.Object({ apiModelId: modelKey, modelId: providerId }, { additionalProperties: false }), { maxItems: 1024 }),
}, { additionalProperties: false });
export type ModelPreferences = Static<typeof ModelPreferencesSchema>;
export const defaultModelPreferences = (): ModelPreferences => ({ disabledProviders: [], disabledModels: [], sources: [] });
export const ModelPreferenceCommandSchema = Type.Union([
  Type.Object({ type: Type.Literal("models.provider.set"), providerId, enabled: Type.Boolean(), expectedRevision: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("models.model.set"), apiModelId: modelKey, enabled: Type.Boolean(), expectedRevision: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("models.source.select"), apiModelId: modelKey, modelId: providerId, expectedRevision: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
]);

export const LocalEndpointSchema = Type.Object({
  id: Type.String({ pattern: "^[a-z][a-z0-9-]{0,47}$" }),
  name: Type.String({ minLength: 1, maxLength: 100 }),
  enabled: Type.Boolean(),
  baseUrl: Type.String({ minLength: 1, maxLength: 2048 }),
  auth: Type.Union([Type.Literal("none"), Type.Literal("bearer")]),
  models: Type.Array(Type.Object({
    id: Type.String({ minLength: 1, maxLength: 200 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    contextWindow: Type.Integer({ minimum: 8192, maximum: 10_000_000 }),
    maxTokens: Type.Integer({ minimum: 64, maximum: 262144 }),
    imageInput: Type.Boolean(),
    toolInput: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 32 }),
}, { additionalProperties: false });
export type LocalEndpoint = Static<typeof LocalEndpointSchema>;
export interface ProviderConnection {
  id: string; name: string; source: "copilot" | "local";
  status: "disconnected" | "connecting" | "connected" | "error";
  diagnostic: string | null;
}
export interface ModelProvider extends ProviderConnection {
  enabled: boolean; scope: "copilot" | "local" | "remote"; endpointId: string | null;
}
export interface ModelOffering { model: ModelInfo; available: boolean }
export interface ModelCatalogueEntry {
  apiModelId: string; name: string; enabled: boolean; sourceModelId: string | null; offerings: ModelOffering[]; diagnostic: string | null;
}
export interface ModelCatalogue { providers: ModelProvider[]; models: ModelCatalogueEntry[] }
export function modelCatalogue(providers: ModelProvider[], offerings: ModelOffering[], preferences: ModelPreferences): ModelCatalogue {
  const grouped = new Map<string, ModelOffering[]>();
  for (const offering of offerings) {
    const key = offering.model.apiModelId ?? offering.model.id;
    grouped.set(key, [...grouped.get(key) ?? [], offering]);
  }
  const models = [...grouped].map(([apiModelId, variants]): ModelCatalogueEntry => {
    const enabled = !preferences.disabledModels.includes(apiModelId), choice = preferences.sources.find((source) => source.apiModelId === apiModelId);
    const sourceModelId = choice?.modelId ?? (variants.length === 1 ? variants[0]!.model.id : null);
    const selected = variants.find((variant) => variant.model.id === sourceModelId), provider = providers.find((entry) => entry.id === selected?.model.providerId);
    const diagnostic = !enabled ? "Disabled in this profile." : sourceModelId === null ? "Choose one provider for this model." :
      !selected ? "The selected source is unavailable. Choose another source explicitly; no fallback occurred." :
        !provider?.enabled ? "The selected provider is disabled." : !selected.available ? "The selected source is not currently advertised or ready." : null;
    return { apiModelId, name: selected?.model.name ?? variants[0]!.model.name, enabled, sourceModelId, offerings: variants, diagnostic };
  });
  return { providers, models };
}
export function selectableModels(catalogue: ModelCatalogue): ModelInfo[] {
  return catalogue.models.flatMap((entry) => {
    if (entry.diagnostic) return [];
    const selected = entry.offerings.find((offering) => offering.model.id === entry.sourceModelId);
    return selected ? [selected.model] : [];
  });
}
export function validateModelPreferences(preferences: ModelPreferences): void {
  if (new Set(preferences.sources.map((entry) => entry.apiModelId)).size !== preferences.sources.length) throw new MoguriError("model_source", "Choose at most one source for each exact upstream model ID.");
  if (preferences.sources.some((entry) => entry.modelId === "kupo")) throw new MoguriError("model_source", "Kupo is controlled by its routing policy, not a concrete provider preference.");
}
