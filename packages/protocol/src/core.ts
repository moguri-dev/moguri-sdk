import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

export const MAX_TEXT = 128 * 1024;
export class MoguriError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}
export function parse<T extends TSchema>(schema: T, value: unknown): Static<T> {
  if (!Value.Check(schema, value)) throw new MoguriError("invalid_request", "The request does not match the protocol schema.");
  return value;
}
export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
