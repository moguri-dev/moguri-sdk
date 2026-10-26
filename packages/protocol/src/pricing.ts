import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import type { BudgetRate } from "./budgets.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const usd = Type.Number({ minimum: 0, maximum: 1000000 });
const date = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
export const PRICE_PROVIDERS = ["anthropic", "openai", "google", "xai"] as const;
export const PriceProviderSchema = Type.Union([Type.Literal("anthropic"), Type.Literal("openai"), Type.Literal("google"), Type.Literal("xai")]);
export type PriceProvider = Static<typeof PriceProviderSchema>;
export const PROVIDER_PRICE_SOURCES: Readonly<Record<PriceProvider, string>> = {
  anthropic: "https://platform.claude.com/docs/en/about-claude/pricing",
  openai: "https://developers.openai.com/api/docs/pricing",
  google: "https://ai.google.dev/gemini-api/docs/pricing",
  xai: "https://docs.x.ai/developers/models",
};
export const API_EQUIVALENT_NOTICE = "API-equivalent estimates use the originating provider's published API rates, including name-matched Copilot/reseller models. They are not subscription charges, provider-reported spend or invoices.";
const costs = { inputUsdPerMillion: usd, outputUsdPerMillion: usd,
  cacheReadUsdPerMillion: Type.Optional(usd), cacheWriteUsdPerMillion: Type.Optional(usd) };
export const LongContextPriceSchema = object({ aboveInputTokens: Type.Integer({ minimum: 0, maximum: 10000000 }), ...costs });
export const ProviderPriceSchema = object({
  modelId: Type.String({ minLength: 1, maxLength: 128 }), ...costs,
  longContext: Type.Optional(LongContextPriceSchema), validUntil: Type.Optional(date),
});
export type ProviderPrice = Static<typeof ProviderPriceSchema>;
export const ProviderPriceCatalogSchema = object({
  version: Type.Literal(1), provider: PriceProviderSchema, sourceUrl: Type.String({ minLength: 1, maxLength: 2048 }),
  observedAt: date, sourceDigest: hash,
  evidence: Type.Union([Type.Literal("bundled-verified-table"), Type.Literal("fetched-document")]),
  prices: Type.Array(ProviderPriceSchema, { minItems: 1, maxItems: 200 }),
});
export type ProviderPriceCatalog = Static<typeof ProviderPriceCatalogSchema>;
export const ProviderRateSourceSchema = object({
  provider: PriceProviderSchema, modelId: Type.String({ minLength: 1, maxLength: 128 }),
  sourceUrl: Type.String({ minLength: 1, maxLength: 2048 }), sourceDigest: hash,
  evidence: ProviderPriceCatalogSchema.properties.evidence,
  cacheReadUsdPerMillion: Type.Optional(usd), cacheWriteUsdPerMillion: Type.Optional(usd),
  longContext: Type.Optional(LongContextPriceSchema), validUntil: Type.Optional(date),
  assumption: Type.Literal("standard-api-text; maximum-listed-cache-write; no-region-or-service-surcharges"),
});
export const PricingCommandSchema = object({
  type: Type.Literal("pricing.refresh"), providers: Type.Array(PriceProviderSchema, { minItems: 1, maxItems: 4, uniqueItems: true }),
  expectedRevision: Type.Integer({ minimum: 0 }),
});
export type PricingCommand = Static<typeof PricingCommandSchema>;
export const isPricingCommand = (value: unknown): value is PricingCommand => Value.Check(PricingCommandSchema, value);
export const PricingQuerySchema = object({ type: Type.Literal("pricing.catalog") });
export type PricingQuery = Static<typeof PricingQuerySchema>;
export const isPricingQuery = (value: unknown): value is PricingQuery => Value.Check(PricingQuerySchema, value);
export type PricingResponse = { type: "pricing.catalog"; revision: number; catalogs: ProviderPriceCatalog[];
  matches: Array<{ modelId: string; rate: BudgetRate | null; diagnostic: string | null }>; warning: string };
export interface PricingSnapshot { providerPriceCatalogs: ProviderPriceCatalog[]; providerPriceRevision: number }
export interface PricingEventPayloads { "pricing.catalog_recorded": { actor: "user"; revision: number; catalogs: ProviderPriceCatalog[] } }
