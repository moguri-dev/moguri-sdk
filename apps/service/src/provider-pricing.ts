import { createHash } from "node:crypto";
import { load } from "cheerio";
import {
  API_EQUIVALENT_NOTICE, MoguriError, PRICE_PROVIDERS, PROVIDER_PRICE_SOURCES, ProviderPriceCatalogSchema, parse,
  type ScheduledProviderPrice,
  type BudgetRate, type ModelCatalogue, type ModelInfo, type ModelPrice, type PriceProvider, type PricingResponse, type ProviderPrice, type ProviderPriceCatalog, type Snapshot,
  isAgentHarnessModel,
} from "../../../packages/protocol/src/index.ts";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const day = 86400000;
const p = (modelId: string, inputUsdPerMillion: number, outputUsdPerMillion: number,
  extra: Omit<Partial<ProviderPrice>, "modelId" | "inputUsdPerMillion" | "outputUsdPerMillion"> = {}): ProviderPrice =>
  ({ modelId, inputUsdPerMillion, outputUsdPerMillion, ...extra });
const claude = (modelId: string, input: number, output: number, read: number, write: number) =>
  p(modelId, input, output, { cacheReadUsdPerMillion: read, cacheWriteUsdPerMillion: write });
const openai = (modelId: string, input: number, output: number, cached: number, longInput?: number, longOutput?: number, longCached?: number,
  writes?: [number, number]) => p(modelId, input, output, { cacheReadUsdPerMillion: cached,
  ...(writes ? { cacheWriteUsdPerMillion: writes[0] } : {}),
  ...(longInput !== undefined && longOutput !== undefined ? { longContext: { aboveInputTokens: 272000,
    inputUsdPerMillion: longInput, outputUsdPerMillion: longOutput, ...(longCached !== undefined ? { cacheReadUsdPerMillion: longCached } : {}),
    ...(writes ? { cacheWriteUsdPerMillion: writes[1] } : {}) } } : {}),
});
/** Bundled standard text prices, checked against each official page on REFERENCE_PRICES_OBSERVED_AT (D77). */
export const REFERENCE_PRICES_OBSERVED_AT = "2026-11-25";
const reference: Record<PriceProvider, ProviderPrice[]> = {
  anthropic: [
    ...["fable", "mythos"].map((name) => claude(`claude-${name}-5.2`, 8, 40, 0.2, 16)),
    claude("claude-fable-5.1", 10, 50, 0.25, 20), claude("claude-mythos-5.1", 10, 50, 0.25, 20),
    claude("claude-fable-5", 10, 50, 1, 20), claude("claude-mythos-5", 10, 50, 1, 20),
    claude("claude-opus-5.5", 4, 20, 0.2, 8), claude("claude-opus-5", 5, 25, 0.5, 10),
    ...["4.8", "4.7", "4.6", "4.5"].map((version) => claude(`claude-opus-${version}`, 5, 25, 0.5, 10)),
    ...["4.1", "4"].map((version) => claude(`claude-opus-${version}`, 15, 75, 1.5, 30)),
    claude("claude-sonnet-5.5", 2, 10, 0.1, 4), claude("claude-sonnet-5", 2, 10, 0.2, 4),
    ...["4.6", "4.5", "4"].map((version) => claude(`claude-sonnet-${version}`, 3, 15, 0.3, 6)),
    p("claude-haiku-5.5", 0.1, 0.5, { cacheReadUsdPerMillion: 0.01, cacheWriteUsdPerMillion: 0.2,
      longContext: { aboveInputTokens: 100000, inputUsdPerMillion: 0.5, outputUsdPerMillion: 2.5, cacheReadUsdPerMillion: 0.05, cacheWriteUsdPerMillion: 1 } }),
    claude("claude-haiku-4.5", 1, 5, 0.1, 2),
  ],
  openai: [
    openai("gpt-6.2-astra", 8, 40, 0.4, 16, 60, 0.8, [20, 40]),
    openai("gpt-6.2-sol", 2, 10, 0.1, 4, 15, 0.2, [5, 10]),
    openai("gpt-6-astra", 10, 50, 1, 20, 75, 2, [25, 50]),
    openai("gpt-6.1-sol", 2, 10, 0.1, 4, 15, 0.2, [5, 10]),
    openai("gpt-6.1-terra", 1, 5, 0.05, 2, 7.5, 0.1, [2.5, 5]),
    openai("gpt-6-luna", 0.1, 0.5, 0.01, 0.2, 0.75, 0.02, [0.25, 0.5]),
    openai("gpt-6-sol", 2, 10, 0.2, 4, 15, 0.4, [5, 10]),
    { ...openai("gpt-5.6-sol", 4, 20, 0.4, 8, 30, 0.8, [10, 20]), validUntil: "2026-11-30" },
    openai("gpt-5.6-terra", 2, 12, 0.2, 4, 18, 0.4, [5, 10]),
    openai("gpt-5.6-luna", 0.2, 1.2, 0.02, 0.4, 1.8, 0.04, [0.5, 1]),
    openai("gpt-5.5", 5, 30, 0.5, 10, 45, 1), p("gpt-5.5-pro", 30, 180, { longContext: { aboveInputTokens: 272000, inputUsdPerMillion: 60, outputUsdPerMillion: 270 } }),
    openai("gpt-5.4", 2.5, 15, 0.25, 5, 22.5, 0.5), p("gpt-5.4-pro", 30, 180, { longContext: { aboveInputTokens: 272000, inputUsdPerMillion: 60, outputUsdPerMillion: 270 } }),
    openai("gpt-5.4-mini", 0.75, 4.5, 0.075), openai("gpt-5.4-nano", 0.2, 1.25, 0.02),
    openai("gpt-5.3-codex", 1.75, 14, 0.175),
    openai("gpt-5.2", 1.75, 14, 0.175), p("gpt-5.2-pro", 21, 168), openai("gpt-5.1", 1.25, 10, 0.125), openai("gpt-5", 1.25, 10, 0.125),
    openai("gpt-5-mini", 0.25, 2, 0.025), openai("gpt-5-nano", 0.05, 0.4, 0.005), p("gpt-5-pro", 15, 120),
    openai("gpt-4.1", 2, 8, 0.5), openai("gpt-4.1-mini", 0.4, 1.6, 0.1),
    openai("gpt-4o", 2.5, 10, 1.25), openai("gpt-4o-mini", 0.15, 0.6, 0.075),
    p("o3-pro", 20, 80), openai("o3", 2, 8, 0.5),
  ],
  google: [
    ...["gemini-4-carbon", "gemini-4-argon"].map((id) => p(id, 2, 10, { cacheReadUsdPerMillion: 0.1, validUntil: "2026-11-30",
      next: { effectiveFrom: "2026-12-01", inputUsdPerMillion: 4, outputUsdPerMillion: 20, cacheReadUsdPerMillion: 0.2 } })),
    p("gemini-4-neon", 3, 15, { cacheReadUsdPerMillion: 0.15 }),
    p("gemini-4-hydrogen", 1.5, 7.5, { cacheReadUsdPerMillion: 0.075 }),
    ...["gemini-3.8-flash", "gemini-3.6-flash"].map((id) => p(id, 0.75, 3.75, { cacheReadUsdPerMillion: 0.075, validUntil: "2026-12-31",
      next: { effectiveFrom: "2027-01-01", inputUsdPerMillion: 1.5, outputUsdPerMillion: 7.5, cacheReadUsdPerMillion: 0.15 } })),
    p("gemini-3.5-flash-lite", 0.3, 2.5, { cacheReadUsdPerMillion: 0.03 }),
    p("gemini-3.1-flash-lite", 0.25, 1.5, { cacheReadUsdPerMillion: 0.025 }),
    p("gemini-3.1-pro-preview", 2, 12, { cacheReadUsdPerMillion: 0.2, longContext: {
      aboveInputTokens: 200000, inputUsdPerMillion: 4, outputUsdPerMillion: 18, cacheReadUsdPerMillion: 0.4 } }),
    p("gemini-3-flash-preview", 0.5, 3, { cacheReadUsdPerMillion: 0.05 }),
    p("gemini-2.5-pro", 1.25, 10, { cacheReadUsdPerMillion: 0.125, longContext: {
      aboveInputTokens: 200000, inputUsdPerMillion: 2.5, outputUsdPerMillion: 15, cacheReadUsdPerMillion: 0.25 } }),
    p("gemini-2.5-flash", 0.3, 2.5, { cacheReadUsdPerMillion: 0.03 }),
    p("gemini-2.5-flash-lite", 0.1, 0.4, { cacheReadUsdPerMillion: 0.01 }),
  ],
  xai: [
    ...["4.7", "4.6"].map((version) => p(`grok-${version}`, 2, 6, { cacheReadUsdPerMillion: 0.5,
      longContext: { aboveInputTokens: 199999, inputUsdPerMillion: 4, outputUsdPerMillion: 12, cacheReadUsdPerMillion: 1 } })),
    p("grok-4.5", 2, 6, { cacheReadUsdPerMillion: 0.3, longContext: { aboveInputTokens: 199999, inputUsdPerMillion: 4, outputUsdPerMillion: 12, cacheReadUsdPerMillion: 0.6 } }),
    ...["grok-4.3", "grok-4.20-0309-reasoning", "grok-4.20-0309-non-reasoning", "grok-4.20-multi-agent-0309"].map((id) => p(id, 1.25, 2.5, { cacheReadUsdPerMillion: 0.2,
      longContext: { aboveInputTokens: 199999, inputUsdPerMillion: 2.5, outputUsdPerMillion: 5, cacheReadUsdPerMillion: 0.4 } })),
  ],
};
export function referencePriceCatalogs(): ProviderPriceCatalog[] {
  return PRICE_PROVIDERS.map((provider) => ({ version: 1, provider, sourceUrl: PROVIDER_PRICE_SOURCES[provider], observedAt: REFERENCE_PRICES_OBSERVED_AT,
    sourceDigest: hash(JSON.stringify(reference[provider])), evidence: "bundled-verified-table", prices: structuredClone(reference[provider]) }));
}
/** Per provider, the newer of the profile's refreshed catalog and the table bundled with this build; a refresh wins a tie. */
export function effectivePriceCatalogs(snapshot: Pick<Snapshot, "providerPriceCatalogs">): ProviderPriceCatalog[] {
  return referencePriceCatalogs().map((bundled) => {
    const recorded = snapshot.providerPriceCatalogs.find((catalog) => catalog.provider === bundled.provider);
    return recorded && recorded.observedAt >= bundled.observedAt ? recorded : bundled;
  });
}
const dayStart = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
/** The price in force at `now`: a dated price's published successor from its effective day, else the listed price. */
export function scheduledPrice(price: ProviderPrice, now: number): { price: ProviderPrice; effectiveFrom: string | null } {
  const next = price.next;
  if (!next || now < dayStart(next.effectiveFrom)) return { price, effectiveFrom: null };
  const { effectiveFrom, ...costs } = next;
  return { price: { modelId: price.modelId, ...costs }, effectiveFrom };
}
const catalogAgeOk = (catalog: ProviderPriceCatalog, maxAgeDays: number, now: number) => {
  const observed = dayStart(catalog.observedAt);
  return Number.isFinite(observed) && observed <= now && now - observed <= maxAgeDays * day;
};
/** Providers whose catalog is too old or future-dated for current estimates. */
export const stalePriceProviders = (catalogs: ProviderPriceCatalog[], maxAgeDays: number, now = Date.now()) =>
  catalogs.filter((catalog) => !catalogAgeOk(catalog, maxAgeDays, now)).map((catalog) => catalog.provider);
const normalize = (value: string) => value.toLowerCase().trim().replace(/\s*\(latest\)\s*$/, "").replace(/^(?:(?:github-copilot|openrouter|anthropic|openai|google|xai|azure)\/)+/, "")
  .replace(/[._\s]+/g, "-");
const aliases = (value: string): string[] => {
  const full = normalize(value), date = full.startsWith("claude-") ? full.replace(/-\d{8}$/, "") : full;
  return [...new Set([full, date, ...date.startsWith("claude-") ? [date.slice("claude-".length)] : []])];
};
type ModelNames = Pick<ModelInfo, "id" | "name"> & Pick<Partial<ModelInfo>, "apiModelId">;
const priceMatches = (model: ModelNames, catalogs: ProviderPriceCatalog[]) => {
  const names = new Set([model.id, model.apiModelId ?? model.id, model.name].flatMap(aliases));
  return catalogs.flatMap((catalog) => catalog.prices.filter((price) => aliases(price.modelId).some((id) => names.has(id))).map((price) => ({ catalog, price })));
};
/** The exact, unambiguous published price entry for a model in force at `now`, regardless of catalog age. Kupo uses it only to class models (D55). */
export function publishedPrice(model: ModelNames, catalogs: ProviderPriceCatalog[], now = Date.now()): { catalog: ProviderPriceCatalog; price: ProviderPrice } | null {
  const matches = priceMatches(model, catalogs);
  return matches.length === 1 ? { catalog: matches[0]!.catalog, price: scheduledPrice(matches[0]!.price, now).price } : null;
}
export function matchProviderRate(model: ModelNames,
  catalogs: ProviderPriceCatalog[], maxAgeDays: number, now = Date.now()): { rate: BudgetRate | null; diagnostic: string | null } {
  const matches = priceMatches(model, catalogs);
  if (matches.length !== 1) return { rate: null, diagnostic: matches.length ? "Ambiguous model ID/name matches; no cheaper provider rate was guessed." : "No exact published API-price match. Missing prices are not zero." };
  const { catalog } = matches[0]!, { price, effectiveFrom } = scheduledPrice(matches[0]!.price, now);
  if (!catalogAgeOk(catalog, maxAgeDays, now) || price.validUntil && now >= dayStart(price.validUntil) + day) {
    return { rate: null, diagnostic: "The official reference rate is stale, future-dated or expired. Refresh provider prices; no free or substitute rate was used." };
  }
  return { rate: { modelId: model.id, inputUsdPerMillion: price.inputUsdPerMillion, outputUsdPerMillion: price.outputUsdPerMillion,
    effectiveAt: effectiveFrom && effectiveFrom > catalog.observedAt ? effectiveFrom : catalog.observedAt, source: "provider-api-equivalent", pricing: { provider: catalog.provider, modelId: price.modelId,
      sourceUrl: catalog.sourceUrl, sourceDigest: catalog.sourceDigest, evidence: catalog.evidence,
      ...(price.cacheReadUsdPerMillion !== undefined ? { cacheReadUsdPerMillion: price.cacheReadUsdPerMillion } : {}),
      ...(price.cacheWriteUsdPerMillion !== undefined ? { cacheWriteUsdPerMillion: price.cacheWriteUsdPerMillion } : {}),
      ...(price.longContext ? { longContext: structuredClone(price.longContext) } : {}), ...(price.validUntil ? { validUntil: price.validUntil } : {}),
      assumption: "standard-api-text; maximum-listed-cache-write; no-region-or-service-surcharges" } }, diagnostic: null };
}
export function estimateRateMicros(rate: BudgetRate, input: number, output: number,
  cache?: { cacheReadTokens?: number | null; cacheWriteTokens?: number | null }, reservation = false): number | null {
  const safe = (value: number) => Number.isSafeInteger(value) && value >= 0;
  if (!safe(input) || !safe(output)) return null;
  const source = rate.source === "provider-api-equivalent" ? rate.pricing : null;
  const tier = source?.longContext && input > source.longContext.aboveInputTokens ? source.longContext : null;
  const inputRate = tier?.inputUsdPerMillion ?? rate.inputUsdPerMillion, outputRate = tier?.outputUsdPerMillion ?? rate.outputUsdPerMillion;
  const readRate = tier ? tier.cacheReadUsdPerMillion ?? inputRate : source?.cacheReadUsdPerMillion ?? inputRate;
  const writeRate = tier ? tier.cacheWriteUsdPerMillion ?? inputRate : source?.cacheWriteUsdPerMillion ?? inputRate;
  const read = source && cache?.cacheReadTokens !== null && cache?.cacheReadTokens !== undefined ? cache.cacheReadTokens : 0;
  const write = source && cache?.cacheWriteTokens !== null && cache?.cacheWriteTokens !== undefined ? cache.cacheWriteTokens : 0;
  if (!safe(read) || !safe(write) || read + write > input) return null;
  const value = Math.ceil((reservation ? input * Math.max(inputRate, readRate, writeRate) :
    (input - read - write) * inputRate + read * readRate + write * writeRate) + output * outputRate);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

const clean = (value: string) => value.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]*>/g, "").replace(/[`*_]/g, "").trim();
function money(value: string): number {
  const match = clean(value).match(/^\$\s*(\d+(?:\.\d+)?)/), amount = match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) throw new MoguriError("pricing_format", "The official pricing table has an absent or invalid USD price. Its previous catalog was preserved.", 502);
  return amount;
}
const optionalMoney = (value?: string) => value && /^\s*\$/.test(clean(value)) ? money(value) : undefined;
function markdownTables(text: string): { header: string[]; rows: string[][] }[] {
  if (/<table(?:\s|>)/i.test(text)) {
    const $ = load(text);
    return $("table").toArray().map((table) => {
      const rows = $(table).find("tr").toArray().map((row) => $(row).find("th,td").toArray().map((cell) => $(cell).text().replace(/\s+/g, " ").trim()));
      return { header: rows[0] ?? [], rows: rows.slice(1) };
    });
  }
  const lines = text.split(/\r?\n/), result: { header: string[]; rows: string[][] }[] = [];
  const cells = (line: string) => line.trim().split("|").slice(1, -1).map(clean);
  for (let index = 0; index + 1 < lines.length; index++) {
    if (!/^\s*\|/.test(lines[index]!) || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[index + 1]!)) continue;
    const header = cells(lines[index]!), rows: string[][] = []; index += 2;
    while (index < lines.length && /^\s*\|/.test(lines[index]!)) { rows.push(cells(lines[index]!)); index++; }
    if (rows.some((row) => row.length !== header.length)) throw new MoguriError("pricing_format", "Official price columns changed. No partial price table was installed.", 502);
    result.push({ header, rows });
  }
  return result;
}
const longDate = (text: string, word: "through" | "starting" | "until"): string | null => {
  const found = text.match(new RegExp(`${word}\\s+([A-Za-z]+\\s+\\d{1,2},\\s+\\d{4})`, "i"));
  if (!found) return null;
  const parsed = Date.parse(`${found[1]} 00:00:00 GMT`);
  if (!Number.isFinite(parsed)) throw new MoguriError("pricing_format", "An official price date is unreadable. The previous catalog was preserved.", 502);
  return new Date(parsed).toISOString().slice(0, 10);
};
type DatedAmount = { amount: number; validUntil?: string; next?: { amount: number; effectiveFrom: string } };
function datedAmount(text: string, observedAt: string): DatedAmount {
  const values = [...text.matchAll(/\$\s*(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  if (!values.length) throw new MoguriError("pricing_format", "A paid standard price is absent; free-tier text was not used as a fallback.", 502);
  const validUntil = longDate(text, "through");
  if (!validUntil) return { amount: values[0]! };
  if (values.length < 2) throw new MoguriError("pricing_format", "The official promotional price has no complete dated successor.", 502);
  const effectiveFrom = longDate(text, "starting");
  if (effectiveFrom && effectiveFrom <= validUntil) throw new MoguriError("pricing_format", "An official successor price starts before its predecessor ends.", 502);
  if (observedAt > validUntil) return { amount: values[1]! };
  return { amount: values[0]!, validUntil, ...(effectiveFrom ? { next: { amount: values[1]!, effectiveFrom } } : {}) };
}
type GoogleSection = { model: string; mode: string; rows: string[][] };
// Markdoc cells hold literal comparisons such as "prompts <= 200k", so unlike `clean` this keeps angle brackets.
const markdocText = (value: string) => value.replace(/\{%\s*sup\s*%\}.*?\{%\s*\/sup\s*%\}/g, "").replace(/\{%[^%]*%\}/g, "")
  .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
/** Sections of the Markdoc pricing page: `## Name {% id="model" %}`, `{% tab title="Standard" %}` and `{% table %}` rows of `* ` cells separated by `---`. */
function googleMarkdocSections(text: string): GoogleSection[] {
  const sections: GoogleSection[] = []; let model = "", mode = "", rows: string[][] | null = null, row: string[] = [];
  const endRow = () => { if (rows && row.length) rows.push(row.map(markdocText)); row = []; };
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^##\s+.*\{%\s*id="([^"]+)"\s*%\}\s*$/);
    if (heading) { model = heading[1]!; mode = ""; continue; }
    const tab = line.match(/^\s*\{%\s*tab\s+title="([^"]+)"\s*%\}/);
    if (tab) { mode = tab[1]!; continue; }
    if (/^\s*\{%\s*table\s*%\}\s*$/.test(line)) { rows = []; row = []; continue; }
    if (!rows) continue;
    if (/^\s*\{%\s*\/table\s*%\}\s*$/.test(line)) { endRow(); sections.push({ model, mode, rows }); rows = null; continue; }
    if (/^\s*---\s*$/.test(line)) { endRow(); continue; }
    const cell = line.match(/^\s{0,4}\*\s+(.*)$/);
    if (cell) row.push(cell[1]!);
    else if (row.length && line.trim()) row[row.length - 1] += ` ${line.trim()}`;
  }
  return sections;
}
function googleHtmlSections(text: string): GoogleSection[] {
  const $ = load(text), sections: GoogleSection[] = []; let model = "", mode = "";
  for (const element of $("h2,h3,table").toArray()) {
    const node = $(element);
    if (element.tagName === "h2") { model = node.attr("id") ?? ""; mode = ""; continue; }
    if (element.tagName === "h3") { mode = node.text().trim(); continue; }
    sections.push({ model, mode, rows: node.find("tr").toArray().map((row) => $(row).find("th,td").toArray().map((cell) => $(cell).text().replace(/\s+/g, " ").trim())) });
  }
  return sections;
}
const GEMINI_TEXT_MODEL = /^gemini-\d+(?:\.\d+)?-(?:argon|carbon|neon|hydrogen|pro|flash|flash-lite)(?:-preview)?$/;
export function parseProviderPriceDocument(provider: PriceProvider, text: string, observedAt: string): ProviderPriceCatalog {
  const prices = new Map<string, ProviderPrice>();
  const add = (price: ProviderPrice) => {
    const previous = prices.get(price.modelId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(price)) throw new MoguriError("pricing_format", "Conflicting official standard-price rows were returned. No cheaper price or partial table was adopted.", 502);
    prices.set(price.modelId, price);
  };
  if (provider === "google") {
    for (const { model, mode, rows } of /\{%\s*table\s*%\}/.test(text) ? googleMarkdocSections(text) : googleHtmlSections(text)) {
      if (mode !== "Standard" || !GEMINI_TEXT_MODEL.test(model)) continue;
      if (!rows[0]?.at(-1)?.includes("Paid Tier") || !rows[0]?.at(-1)?.includes("1M tokens")) continue;
      const input = rows.find((row) => row[0]?.startsWith("Input price"))?.at(-1), output = rows.find((row) => row[0]?.startsWith("Output price"))?.at(-1);
      if (!input || !output) throw new MoguriError("pricing_format", "The standard Gemini input/output table is incomplete.", 502);
      const base = datedAmount(input, observedAt), out = datedAmount(output, observedAt), cache = rows.find((row) => row[0] === "Context caching price")?.at(-1);
      const cached = cache && cache.includes("$") ? datedAmount(cache, observedAt) : null;
      if ((base.validUntil ?? null) !== (out.validUntil ?? null) || (base.next?.effectiveFrom ?? null) !== (out.next?.effectiveFrom ?? null) ||
        cached?.next && cached.next.effectiveFrom !== base.next?.effectiveFrom) {
        throw new MoguriError("pricing_format", "Official Gemini input, output and cache prices change on different dates. No partial dated price was installed.", 502);
      }
      const threshold = input.match(/prompts\s*(?:<=|≤)\s*(\d+)k/i), nextInput = [...input.matchAll(/\$\s*(\d+(?:\.\d+)?)/g)][1]?.[1];
      const nextOutput = [...output.matchAll(/\$\s*(\d+(?:\.\d+)?)/g)][1]?.[1], nextCached = cache ? [...cache.matchAll(/\$\s*(\d+(?:\.\d+)?)/g)][1]?.[1] : undefined;
      const successor: ScheduledProviderPrice | null = base.next && out.next ? { effectiveFrom: base.next.effectiveFrom, inputUsdPerMillion: base.next.amount,
        outputUsdPerMillion: out.next.amount, ...(cached?.next ? { cacheReadUsdPerMillion: cached.next.amount } : {}) } : null;
      add(p(model, base.amount, out.amount, { ...(cached ? { cacheReadUsdPerMillion: cached.amount } : {}),
        ...(base.validUntil ? { validUntil: base.validUntil } : {}), ...(successor ? { next: successor } : {}),
        ...(threshold && nextInput && nextOutput ? { longContext: { aboveInputTokens: Number(threshold[1]) * 1000,
          inputUsdPerMillion: Number(nextInput), outputUsdPerMillion: Number(nextOutput), ...(nextCached ? { cacheReadUsdPerMillion: Number(nextCached) } : {}) } } : {}),
      }));
    }
  } else if (provider === "anthropic") {
    const table = markdownTables(text).find((table) => table.header[0] === "Model" && table.header.includes("Base input tokens") && table.header.includes("Output tokens"));
    if (!table) throw new MoguriError("pricing_format", "The official Anthropic model-price table is missing.", 502);
    for (const row of table.rows) {
      const match = row[0]!.match(/^Claude\s+([A-Za-z]+)\s+(\d+(?:\.\d+)?)/);
      if (!match) throw new MoguriError("pricing_format", "An Anthropic model row changed its exact price identity.", 502);
      const id = `claude-${match[1]!.toLowerCase()}-${match[2]}`, value = claude(id, money(row[1]!), money(row[5]!), money(row[4]!), Math.max(money(row[2]!), money(row[3]!)));
      const above = row[0]!.match(/over\s+([\d,]+)\s+tokens/i);
      if (above) {
        const previous = prices.get(id);
        if (!previous) throw new MoguriError("pricing_format", "A long-context row has no corresponding base price.", 502);
        prices.set(id, { ...previous, longContext: { aboveInputTokens: Number(above[1]!.replaceAll(",", "")), inputUsdPerMillion: value.inputUsdPerMillion,
          outputUsdPerMillion: value.outputUsdPerMillion, cacheReadUsdPerMillion: value.cacheReadUsdPerMillion, cacheWriteUsdPerMillion: value.cacheWriteUsdPerMillion } });
      } else add(value);
    }
  } else if (provider === "openai") {
    const start = text.indexOf("### Standard pricing data"), end = text.indexOf("### Batch pricing data", start + 1);
    if (start < 0) throw new MoguriError("pricing_format", "The official standard OpenAI text-price section is missing.", 502);
    for (const table of markdownTables(text.slice(start, end < 0 ? undefined : end))) {
      if (table.header[0] !== "Model") continue;
      for (const row of table.rows) {
        const id = row[0]!.split(/\s/)[0]!;
        if (!/^(?:gpt-|o[134](?:-|$))/.test(id)) continue;
        const input = table.header.indexOf("Short context input"), out = table.header.indexOf("Short context output");
        if (input >= 0 && out >= 0) {
          const cache = table.header.indexOf("Short context cached input"), longIn = table.header.indexOf("Long context input"), longOut = table.header.indexOf("Long context output");
          const write = optionalMoney(row[table.header.indexOf("Short context 12h write")]), longWrite = optionalMoney(row[table.header.indexOf("Long context 12h write")]);
          add(p(id, money(row[input]!), money(row[out]!), {
            ...(optionalMoney(row[cache]) !== undefined ? { cacheReadUsdPerMillion: money(row[cache]!) } : {}),
            ...(write !== undefined ? { cacheWriteUsdPerMillion: write } : {}),
            ...(longIn >= 0 && longOut >= 0 && optionalMoney(row[longIn]) !== undefined && optionalMoney(row[longOut]) !== undefined ? { longContext: {
              aboveInputTokens: 272000, inputUsdPerMillion: money(row[longIn]!), outputUsdPerMillion: money(row[longOut]!),
              ...(optionalMoney(row[table.header.indexOf("Long context cached input")]) !== undefined ? { cacheReadUsdPerMillion: money(row[table.header.indexOf("Long context cached input")]!) } : {}),
              ...(longWrite !== undefined ? { cacheWriteUsdPerMillion: longWrite } : {}) } } : {}),
          }));
        } else if (table.header.includes("Input") && table.header.includes("Output")) add(p(id, money(row[table.header.indexOf("Input")]!), money(row[table.header.indexOf("Output")]!),
          { ...(optionalMoney(row[table.header.indexOf("Cached input")]) !== undefined ? { cacheReadUsdPerMillion: money(row[table.header.indexOf("Cached input")]!) } : {}) }));
      }
    }
    // Grouped tables repeat per processing tier, each under its tier label (Standard, Batch, Fast); only Standard prices are used.
    for (let grouped = text.indexOf("### Grouped Pricing Table data"); grouped >= 0;) {
      const next = text.indexOf("### Grouped Pricing Table data", grouped + 1), tier = text.slice(0, grouped).trimEnd().split(/\r?\n/).at(-1)?.trim();
      const table = tier === "Standard" ? markdownTables(text.slice(grouped, next < 0 ? undefined : next)).find((table) => table.header[0] === "Category" && table.header[1] === "Model") : undefined;
      grouped = next;
      if (table) for (const row of table.rows.filter((row) => row[0] === "Codex")) {
        add(p(row[1]!, money(row[2]!), money(row[3]!), { ...(optionalMoney(row[4]) !== undefined ? { cacheReadUsdPerMillion: money(row[4]!) } : {}) }));
      }
    }
    for (const note of text.matchAll(/\b(GPT-[\w.]+(?:\s+[A-Z][a-z]+)?)[’']s promotional pricing is available until ([A-Za-z]+\s+\d{1,2},\s+\d{4})/g)) {
      const id = note[1]!.toLowerCase().replace(/\s+/g, "-"), price = prices.get(id), validUntil = longDate(`until ${note[2]}`, "until");
      if (price && validUntil) prices.set(id, { ...price, validUntil });
    }
  } else {
    const table = markdownTables(text).find((table) => table.header[0] === "Model" && table.header.some((value) => value.startsWith("Input /")));
    if (!table) throw new MoguriError("pricing_format", "The official xAI text-price table is missing.", 502);
    for (const row of table.rows) {
      const id = row[0]!.match(/^(grok-[a-z0-9.-]+)/)?.[1];
      if (!id) throw new MoguriError("pricing_format", "An xAI model price identity is missing.", 502);
      const value = p(id, money(row[2]!), money(row[4]!), { cacheReadUsdPerMillion: money(row[3]!) });
      if (/[≥]|>=/.test(row[0]!)) {
        const threshold = row[0]!.match(/(?:≥|>=)\s*(\d+)k/), previous = prices.get(id);
        if (!threshold || !previous) throw new MoguriError("pricing_format", "An xAI long-context price has no exact threshold/base.", 502);
        prices.set(id, { ...previous, longContext: { aboveInputTokens: Number(threshold[1]) * 1000 - 1, inputUsdPerMillion: value.inputUsdPerMillion,
          outputUsdPerMillion: value.outputUsdPerMillion, cacheReadUsdPerMillion: value.cacheReadUsdPerMillion } });
      } else add(value);
    }
  }
  if (!prices.size) throw new MoguriError("pricing_format", "No complete supported standard token prices were found. The old catalog was preserved, not replaced with free models.", 502);
  return parse(ProviderPriceCatalogSchema, { version: 1, provider, sourceUrl: PROVIDER_PRICE_SOURCES[provider], observedAt,
    sourceDigest: hash(text), evidence: "fetched-document", prices: [...prices.values()] });
}

export interface PricingOptions { fetch?: typeof fetch; now?: () => number }
export async function fetchProviderPrices(provider: PriceProvider, signal: AbortSignal, options: PricingOptions = {}): Promise<ProviderPriceCatalog> {
  const url = PROVIDER_PRICE_SOURCES[provider] + (provider === "anthropic" || provider === "openai" ? ".md" : "");
  const response = await (options.fetch ?? fetch)(url, { redirect: "error", credentials: "omit", signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    headers: { Accept: "text/markdown, text/html, text/plain" } });
  if (!response.ok || !response.body) throw new MoguriError("pricing_http", `Official ${provider} pricing returned HTTP ${response.status}. The previous reference was preserved.`, 502);
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new MoguriError("pricing_limit", "The official pricing page exceeded 2 MiB. No incomplete catalog was installed.", 502); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  signal.throwIfAborted();
  return parseProviderPriceDocument(provider, new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    new Date(options.now?.() ?? Date.now()).toISOString().slice(0, 10));
}
export function pricingCatalog(snapshot: Snapshot, now = Date.now()): PricingResponse {
  const catalogs = effectivePriceCatalogs(snapshot);
  return { type: "pricing.catalog", revision: snapshot.providerPriceRevision, catalogs,
    matches: snapshot.provider.models.filter((model) => !model.synthetic).map((model) => ({ modelId: model.id,
      ...matchProviderRate(model, catalogs, snapshot.settings.values.budgets.maxPriceAgeDays, now) })), warning: API_EQUIVALENT_NOTICE,
    stale: stalePriceProviders(catalogs, snapshot.settings.values.budgets.maxPriceAgeDays, now) };
}
/** Known list prices by exact offered model ID (D59): the offering's own declared price, loopback local models, else the exact published table price. */
export function catalogueModelPrices(catalogue: ModelCatalogue | undefined, catalogs: ProviderPriceCatalog[]): Record<string, ModelPrice> {
  const prices: Record<string, ModelPrice> = {};
  for (const offering of catalogue?.models.flatMap((entry) => entry.offerings) ?? []) {
    const model = offering.model;
    if (offering.price) { prices[model.id] = offering.price; continue; }
    if (model.source === "local" && model.endpointBoundary === "loopback") { prices[model.id] = { inputUsdPerMillion: 0, outputUsdPerMillion: 0, basis: "local-no-api-fee" }; continue; }
    const published = isAgentHarnessModel(model) ? null : publishedPrice(model, catalogs);
    if (published) prices[model.id] = { inputUsdPerMillion: published.price.inputUsdPerMillion, outputUsdPerMillion: published.price.outputUsdPerMillion, basis: "published-api-equivalent" };
  }
  return prices;
}
