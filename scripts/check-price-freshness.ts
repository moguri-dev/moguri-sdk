import { REFERENCE_PRICES_OBSERVED_AT } from "../apps/service/src/provider-pricing.ts";

/** A release must leave installs this many days before the default 30-day price limit marks the bundled table stale. */
export const MAX_BUNDLED_PRICE_AGE_DAYS = 14;

export function bundledPriceAgeFailure(observedAt: string, today: string, maxAgeDays = MAX_BUNDLED_PRICE_AGE_DAYS): string | null {
  const age = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${observedAt}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(age)) return `Cannot compare the bundled price date ${observedAt} with ${today}.`;
  if (age < 0) return `The bundled provider prices claim ${observedAt}, after today (${today}).`;
  return age > maxAgeDays ? `The bundled provider prices were checked ${observedAt}, ${age} days before ${today} (limit ${maxAgeDays}). `
    + "Refresh the reference table in apps/service/src/provider-pricing.ts from the official pages before releasing." : null;
}

if (import.meta.main) {
  const today = process.argv[2] ?? new Date().toISOString().slice(0, 10), failure = bundledPriceAgeFailure(REFERENCE_PRICES_OBSERVED_AT, today);
  if (failure) { console.error(failure); process.exit(1); }
  console.log(`Bundled provider prices checked ${REFERENCE_PRICES_OBSERVED_AT} are fresh for ${today}.`);
}
