import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const revision = Type.Integer({ minimum: 0 });
const keep = Type.Integer({ minimum: 1, maximum: 20 });
export const CompactionCommandSchema = Type.Union([
  object({ type: Type.Literal("compaction.generate"), sessionId: id, modelId: id, keepRecentTurns: keep, expectedDigest: hash, confirmCost: Type.Literal(true) }),
  object({ type: Type.Literal("compaction.apply"), sessionId: id, compactionId: id, expectedRevision: revision }),
  object({ type: Type.Literal("compaction.discard"), sessionId: id, compactionId: id, expectedRevision: revision }),
  object({ type: Type.Literal("compaction.stop"), sessionId: id, compactionId: id }),
  object({ type: Type.Literal("compaction.restore"), sessionId: id, expectedActiveId: id, expectedSourceDigest: hash, confirm: Type.Literal(true) }),
]);
export type CompactionCommand = Static<typeof CompactionCommandSchema>;
export const isCompactionCommand = (value: unknown): value is CompactionCommand => Value.Check(CompactionCommandSchema, value);
export const CompactionQuerySchema = Type.Union([
  object({ type: Type.Literal("compaction.state"), sessionId: id }),
  object({ type: Type.Literal("compaction.preview"), sessionId: id, modelId: Type.Optional(id), keepRecentTurns: Type.Optional(keep) }),
  object({ type: Type.Literal("compaction.read"), sessionId: id, compactionId: id }),
]);
export type CompactionQuery = Static<typeof CompactionQuerySchema>;
export const isCompactionQuery = (value: unknown): value is CompactionQuery => Value.Check(CompactionQuerySchema, value);
export interface ContextCompaction {
  id: string; sessionId: string; projectId: string | null; turnId: string; revision: number; contractVersion: 1;
  status: "running" | "proposed" | "applied" | "superseded" | "restored" | "discarded" | "stopped" | "partial" | "failed";
  env: "Local" | "Sandbox" | "Remote"; modelId: string; modelBindingDigest: string; keepRecentTurns: number;
  sourceDigest: string; throughSeq: number; prefixMessages: number; retainedMessages: number;
  beforeTokens: number; afterTokens: number | null;
  inputDigest: string; resultDigest: string | null; replacementDigest: string | null; stepId: string | null;
  createdAt: string; completedAt: string | null; appliedAt: string | null; diagnostic: string | null;
}
export interface CompactionPreview {
  digest: string; sourceDigest: string; modelId: string; keepRecentTurns: number; activeId: string | null;
  throughSeq: number; prefixMessages: number; retainedMessages: number;
  beforeTokens: number; estimatedInputTokens: number; maxOutputTokens: number;
  systemPrompt: string; warning: string;
}
export type CompactionResponse =
  | { type: "compaction.state"; compactions: ContextCompaction[]; activeId: string | null; sourceDigest: string; estimatedTokens: number; originalEstimatedTokens: number }
  | { type: "compaction.preview"; preview: CompactionPreview }
  | { type: "compaction.read"; compaction: ContextCompaction; text: string | null };
