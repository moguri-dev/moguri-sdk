import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import type { KupoSettings } from "./routing.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const revision = Type.Integer({ minimum: 0 });
const keep = Type.Integer({ minimum: 1, maximum: 20 });
/** Smart compaction defaults (D31 revision). Absent settings mean these factory values, with automatic compaction on. */
export const CompactionSettingsSchema = object({
  automatic: Type.Boolean(),
  triggerFraction: Type.Number({ minimum: 0.5, maximum: 0.9 }),
  /** Absolute ceiling for the trigger, so very large windows compact before cost grows quadratically. Null means the fraction alone. */
  triggerTokens: Type.Union([Type.Integer({ minimum: 16384, maximum: 10_000_000 }), Type.Null()]),
  keepRecentTurns: keep,
  maxCallsPerTurn: Type.Integer({ minimum: 1, maximum: 4 }),
  outputTokens: Type.Integer({ minimum: 256, maximum: 4096 }),
});
export type CompactionSettings = Static<typeof CompactionSettingsSchema>;
export const defaultCompactionSettings = (): CompactionSettings => ({
  automatic: true, triggerFraction: 0.75, triggerTokens: 200_000, keepRecentTurns: 2, maxCallsPerTurn: 1, outputTokens: 4096,
});
export const effectiveCompactionSettings = (values: { compaction?: CompactionSettings }): CompactionSettings => values.compaction ?? defaultCompactionSettings();
export interface AutomaticCompactionPolicy {
  modelId: string | null; triggerFraction: number; triggerTokens: number | null; keepRecentTurns: number; maxCallsPerTurn: number; outputTokens: number;
  /** `default-policy` means the factory default applied because the user never saved a compaction choice. */
  actor: "user-policy" | "default-policy";
  scope: "kupo" | "session-model";
}
/**
 * The authoritative automatic compaction policy for a session, or null when it is off.
 * Kupo keeps its explicit reviewed policy when one exists and otherwise inherits the shared smart compaction setting.
 */
export function automaticCompactionPolicy(values: { kupo: KupoSettings; compaction?: CompactionSettings }, kupo: boolean): AutomaticCompactionPolicy | null {
  const shared = effectiveCompactionSettings(values), actor = values.compaction ? "user-policy" as const : "default-policy" as const;
  if (kupo) {
    if (values.kupo.workflow !== "auto") return null;
    const explicit = values.kupo.autoCompaction;
    if (explicit) return explicit.enabled ? { modelId: explicit.modelId, triggerFraction: explicit.triggerFraction, triggerTokens: null, keepRecentTurns: explicit.keepRecentTurns,
      maxCallsPerTurn: explicit.maxCallsPerTurn, outputTokens: explicit.outputTokens, actor: "user-policy", scope: "kupo" } : null;
  }
  if (!shared.automatic) return null;
  return { modelId: null, triggerFraction: shared.triggerFraction, triggerTokens: shared.triggerTokens, keepRecentTurns: shared.keepRecentTurns,
    maxCallsPerTurn: shared.maxCallsPerTurn, outputTokens: shared.outputTokens, actor, scope: kupo ? "kupo" : "session-model" };
}
/**
 * The estimated request size at which automatic compaction starts for a working window. `headroom` is the request
 * admission reserve: compaction must start an eighth of the window before admission would refuse the request.
 */
export const compactionTrigger = (policy: Pick<AutomaticCompactionPolicy, "triggerFraction" | "triggerTokens">, window: number, headroom = 0): number =>
  Math.max(1, Math.min(Math.floor(window * policy.triggerFraction), window - headroom - Math.floor(window / 8), policy.triggerTokens ?? Number.POSITIVE_INFINITY));
export const AutomaticCompactionOriginSchema = object({
  actor: Type.Union([Type.Literal("user-policy"), Type.Literal("default-policy")]), ownerTurnId: id, policyDigest: hash,
  settingsRevision: revision, permissionRevision: revision, policyRevision: revision,
  /** Present for a fixed-model session compacted under smart compaction; absent for Kupo. */
  scope: Type.Optional(Type.Literal("session-model")),
});
export const CompactionCommandSchema = Type.Union([
  object({ type: Type.Literal("compaction.generate"), sessionId: id, modelId: id, keepRecentTurns: keep, expectedDigest: hash, confirmCost: Type.Literal(true),
    /** `/compact`: the actual user asked to apply a complete valid result without a second review step. */
    apply: Type.Optional(Type.Literal("on-success")) }),
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
  automatic?: Static<typeof AutomaticCompactionOriginSchema>;
  /** Set by `/compact`: the requesting user applies a complete valid result on settlement. */
  applyOnSuccess?: true;
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
