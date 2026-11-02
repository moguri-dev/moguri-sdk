import { Type, type Static } from "typebox";
import { isRecord, MoguriError } from "./core.ts";

const scalar = Type.Union([Type.String({ maxLength: 4096 }), Type.Number(), Type.Boolean(), Type.Null()]);
const items = Type.Array(Type.Union([scalar, Type.Record(Type.String(), scalar)]), { maxItems: 1000 });
const base = { items, field: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })) };
export const ArrayFindSchema = Type.Object({ ...base, value: scalar }, { additionalProperties: false });
export const ArrayOrderSchema = Type.Object(base, { additionalProperties: false });
export const ArrayCompareSchema = Type.Object({ ...base, threshold: Type.Number() }, { additionalProperties: false });
export type ArrayToolName = "find_in_array" | "order_asc" | "order_desc" | "find_bigger" | "find_smaller";
export type ArrayToolInput = Static<typeof ArrayFindSchema> | Static<typeof ArrayOrderSchema> | Static<typeof ArrayCompareSchema>;

export function arrayTool(name: ArrayToolName, input: ArrayToolInput) {
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 65536) throw new MoguriError("array_limit", "Array tools accept at most 64 KiB of complete JSON. No rows were silently removed.");
  const selected = (item: unknown): unknown => {
    if (!input.field) return item;
    if (!isRecord(item) || !Object.hasOwn(item, input.field)) throw new MoguriError("array_field", "Every row must contain the exact requested own field. Missing/inherited values are not coerced.");
    return item[input.field];
  };
  const rows = input.items.map((item, index) => ({ item, index, value: selected(item) }));
  if (name === "order_asc" || name === "order_desc") {
    const kind = typeof rows[0]?.value;
    if (rows.some((row) => !["string", "number"].includes(typeof row.value) || typeof row.value !== kind ||
      typeof row.value === "number" && !Number.isFinite(row.value))) throw new MoguriError("array_order", "Sort one consistent set of finite numbers or strings. No mixed-type coercion or locale-dependent ordering.");
    rows.sort((a, b) => {
      const order = typeof a.value === "number" && typeof b.value === "number" ? a.value - b.value :
        typeof a.value === "string" && typeof b.value === "string" ? a.value < b.value ? -1 : a.value > b.value ? 1 : 0 : 0;
      return (name === "order_desc" ? -order : order) || a.index - b.index;
    });
    return { items: rows.map((row) => row.item), originalIndices: rows.map((row) => row.index), count: rows.length, order: name === "order_desc" ? "descending" : "ascending", stable: true, stringOrder: "UTF-16 code units, not locale" };
  }
  if (name === "find_in_array") {
    if (!("value" in input)) throw new MoguriError("array_input", "Find requires its exact scalar value.");
    const matches = rows.filter((row) => Object.is(row.value, input.value));
    return { matches: matches.map(({ item, index }) => ({ item, index })), count: matches.length, comparison: "exact scalar equality" };
  }
  if (!("threshold" in input) || !Number.isFinite(input.threshold) || rows.some((row) => typeof row.value !== "number" || !Number.isFinite(row.value))) {
    throw new MoguriError("array_compare", "Comparison requires finite numeric values and a finite threshold. No string, missing value or null was converted.");
  }
  const threshold = input.threshold;
  const matches = rows.filter((row) => typeof row.value === "number" && (name === "find_bigger" ? row.value > threshold : row.value < threshold));
  return { matches: matches.map(({ item, index }) => ({ item, index })), count: matches.length, comparison: name === "find_bigger" ? "strictly greater" : "strictly smaller", threshold };
}
