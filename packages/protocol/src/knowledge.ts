import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";
import { ModelAdviceSourceSchema } from "./questions.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const revision = Type.Integer({ minimum: 0 });
const title = Type.String({ minLength: 1, maxLength: 160 });
const text = Type.String({ minLength: 1, maxLength: 32 * 1024 });
export const KnowledgeTierSchema = Type.Union([Type.Literal("Sky"), Type.Literal("Terra"), Type.Literal("Glacier")]);
export type KnowledgeTier = Static<typeof KnowledgeTierSchema>;
export const KnowledgeInputSchema = Type.Union([
  object({ tier: Type.Literal("Sky"), sessionId: id, lifetime: Type.Union([Type.Literal("turn"), Type.Literal("session")]), title, text }),
  object({ tier: Type.Literal("Terra"), projectId: id, workItemId: Type.Optional(id), title, text }),
]);
export type KnowledgeInput = Static<typeof KnowledgeInputSchema>;
export const KnowledgePromotionSchema = object({
  tier: Type.Union([Type.Literal("Terra"), Type.Literal("Glacier")]), title,
  text: Type.String({ minLength: 1, maxLength: 8000 }),
});
export type KnowledgePromotion = Static<typeof KnowledgePromotionSchema>;
export const KnowledgeRecordSchema = object({
  id, profileId: id, tier: KnowledgeTierSchema,
  projectId: Type.Union([id, Type.Null()]), sessionId: Type.Union([id, Type.Null()]),
  workItemId: Type.Union([id, Type.Null()]), expiresTurnId: Type.Union([id, Type.Null()]),
  title, contentDigest: hash, revision,
  intent: object({ id, digest: hash }),
  createdAt: Type.String({ format: "date-time" }), updatedAt: Type.String({ format: "date-time" }),
  origin: Type.Union([object({ sourceId: id, sourceDigest: hash, sourceRevision: revision, actor: Type.Literal("user") }), Type.Null()]),
  modelSource: Type.Optional(ModelAdviceSourceSchema), createdModelSource: Type.Optional(ModelAdviceSourceSchema),
});
export type KnowledgeRecord = Static<typeof KnowledgeRecordSchema>;
export interface KnowledgeEventPayloads {
  "knowledge.saved": { record: KnowledgeRecord };
  "knowledge.forgotten": { id: string; revision: number; reason: "user" | "lifecycle"; creationIntent: { id: string; digest: string } };
}
export interface KnowledgeSnapshot { knowledge: KnowledgeRecord[] }
export const KnowledgeCommandSchema = Type.Union([
  object({ type: Type.Literal("knowledge.save"), input: KnowledgeInputSchema, id: Type.Optional(id), expectedRevision: revision }),
  object({ type: Type.Literal("knowledge.promote"), id, expectedRevision: revision, expectedDigest: hash, input: KnowledgePromotionSchema, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("knowledge.forget"), id, expectedRevision: revision, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("knowledge.rollback"), id, expectedRevision: revision, contentDigest: hash, confirm: Type.Literal(true) }),
]);
export type KnowledgeCommand = Static<typeof KnowledgeCommandSchema>;
export const isKnowledgeCommand = (value: unknown): value is KnowledgeCommand => Value.Check(KnowledgeCommandSchema, value);
export const KnowledgeQuerySchema = Type.Union([
  object({ type: Type.Literal("knowledge.list"), tier: KnowledgeTierSchema, projectId: Type.Optional(id), sessionId: Type.Optional(id), text: Type.String({ maxLength: 4000 }) }),
  object({ type: Type.Literal("knowledge.read"), id }),
  object({ type: Type.Literal("knowledge.history"), id }),
  object({ type: Type.Literal("knowledge.version"), id, contentDigest: hash }),
  object({ type: Type.Literal("containment.status") }),
]);
export type KnowledgeQuery = Static<typeof KnowledgeQuerySchema>;
export const isKnowledgeQuery = (value: unknown): value is KnowledgeQuery => Value.Check(KnowledgeQuerySchema, value);
export interface ContainmentStatus {
  required: boolean;
  qualifiedSandboxReady: boolean;
  boundary: "qualified-sendbox-required" | "native-process-groups-only";
  diagnostic: string;
}
export type KnowledgeResponse =
  | { type: "knowledge.list"; records: KnowledgeRecord[] }
  | { type: "knowledge.read"; record: KnowledgeRecord; text: string }
  | { type: "knowledge.history"; records: KnowledgeRecord[] }
  | { type: "knowledge.version"; record: KnowledgeRecord; text: string }
  | { type: "containment.status"; containment: ContainmentStatus };

export function projectKnowledge(previous: KnowledgeRecord | undefined, next: KnowledgeRecord): KnowledgeRecord {
  if (!Value.Check(KnowledgeRecordSchema, next) ||
    next.tier === "Sky" && (!next.sessionId || next.workItemId) ||
    next.tier === "Terra" && (!next.projectId || next.sessionId || next.expiresTurnId) ||
    next.tier === "Glacier" && (next.projectId || next.sessionId || next.workItemId || next.expiresTurnId || !next.origin) ||
    !previous && next.revision !== 0 ||
    previous && (next.revision !== previous.revision + 1 ||
      (["id", "profileId", "tier", "projectId", "sessionId", "workItemId", "expiresTurnId", "createdAt"] as const).some((key) => previous[key] !== next[key]) ||
      JSON.stringify(previous.intent) !== JSON.stringify(next.intent) || JSON.stringify(previous.createdModelSource) !== JSON.stringify(next.createdModelSource))) {
    throw new MoguriError("knowledge_corrupt", "Tiered knowledge changed its original profile, lifetime or revision. State was preserved.", 409);
  }
  return structuredClone(next);
}
