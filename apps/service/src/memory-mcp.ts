import { Type, type Static } from "typebox";
import { MemoryBindingSchema, MoguriError, parse } from "../../../packages/protocol/src/index.ts";
import { frameDigest } from "./worker-wire.ts";
import { sameDurableIdentity, sourceRoot } from "./repository-source.ts";

const path = Type.String({ minLength: 1, maxLength: 4096 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const hit = Type.Object({
  path, digest: hash, distance: Type.Number(), stale: Type.Boolean(), text: Type.String({ maxLength: 4000 }), source: Type.Literal("lexical-vector"),
}, { additionalProperties: false });
const node = Type.Object({ id: Type.String({ maxLength: 8192 }), path, label: Type.String({ maxLength: 4096 }), kind: Type.Union([Type.Literal("file"), Type.Literal("symbol")]) }, { additionalProperties: false });
const edge = Type.Object({ source: Type.String({ maxLength: 8192 }), target: Type.String({ maxLength: 8192 }), kind: Type.Union([Type.Literal("declares"), Type.Literal("imports")]) }, { additionalProperties: false });
const base = { version: Type.Literal(1), binding: MemoryBindingSchema, sourceDigest: hash, argumentsDigest: hash, scopeDigest: hash };
export const MemoryPreparedSchema = Type.Union([
  Type.Object({ ...base, tool: Type.Literal("search_memory"), result: Type.Object({ items: Type.Array(hit, { maxItems: 20 }) }, { additionalProperties: false }) }, { additionalProperties: false }),
  Type.Object({ ...base, tool: Type.Literal("memory_graph"), result: Type.Object({
    nodes: Type.Array(node, { maxItems: 1000 }), edges: Type.Array(edge, { maxItems: 2000 }), stalePaths: Type.Array(path, { maxItems: 1000 }),
  }, { additionalProperties: false }) }, { additionalProperties: false }),
]);
export type MemoryPrepared = Static<typeof MemoryPreparedSchema>;
export async function checkedMemoryPrepared(input: MemoryPrepared, expected: { root: string; tool: string; arguments: Record<string, unknown>; scopeDigest: string }, signal: AbortSignal) {
  const prepared = parse(MemoryPreparedSchema, input);
  signal.throwIfAborted();
  if (prepared.binding.env !== "Remote" || prepared.binding.root !== expected.root || prepared.tool !== expected.tool ||
    prepared.argumentsDigest !== frameDigest(expected.arguments) || prepared.scopeDigest !== expected.scopeDigest) {
    throw new MoguriError("memory_authorization", "Prepared memory does not own this exact Remote root/tool/query. No cache or connector was used.", 403);
  }
  if (Buffer.byteLength(JSON.stringify(prepared)) > 1024 * 1024) throw new MoguriError("memory_limit", "This memory result exceeds the bounded MCP payload. Narrow the query or graph path.");
  const actual = await sourceRoot(expected.root); signal.throwIfAborted();
  if (!sameDurableIdentity(prepared.binding, actual)) throw new MoguriError("memory_root_changed", "The captured memory root changed before the exact Remote MCP dispatch.", 409);
  return { binding: prepared.binding, sourceDigest: prepared.sourceDigest, ...prepared.result };
}
