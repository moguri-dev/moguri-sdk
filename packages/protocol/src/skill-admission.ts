import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const path = Type.String({ minLength: 1, maxLength: 4096 });
const access = Type.Union([Type.Literal("read-only"), Type.Literal("native-files")]);
export const SKILL_INSPECTION_BYTES = 512 * 1024;
export const COMPLETE_SOURCE_ENVELOPE_BYTES = 2 * 1024 * 1024;
const root = object({ root: path, device: Type.String(), inode: Type.String() });
export const SkillOriginSchema = object({
  kind: Type.Union([Type.Literal("registry"), Type.Literal("local"), Type.Literal("archive")]),
  sourceId: Type.Union([id, Type.Null()]), identityDigest: hash, artifactDigest: hash,
  entryPath: path,
  version: Type.String({ minLength: 1, maxLength: 80 }),
  root: Type.Union([root, Type.Null()]),
  files: Type.Array(object({ path, digest: hash, bytes: Type.Integer({ minimum: 0, maximum: SKILL_INSPECTION_BYTES }) }), { minItems: 1, maxItems: 128 }),
});
export type SkillOrigin = Static<typeof SkillOriginSchema>;
export const SkillPublisherSchema = Type.Union([
  object({ kind: Type.Literal("unverified-local"), acknowledge: Type.Literal("publisher-not-verified") }),
  object({ kind: Type.Literal("pinned-ed25519"), identity: Type.String({ minLength: 1, maxLength: 200 }),
    publicKey: Type.String({ minLength: 1, maxLength: 4096 }), signature: Type.String({ minLength: 1, maxLength: 1024 }) }),
]);
export type SkillPublisher = Static<typeof SkillPublisherSchema>;
export interface SkillInspection {
  version: 1; skillId: string; name: string; contentDigest: string; profileId: string; sessionId: string;
  root: Static<typeof root>; policyDigest: string; origin: SkillOrigin; access: "read-only" | "native-files";
  revocationEpoch: string;
  files: { path: string; digest: string; bytes: number; text: string }[];
  externalReferences: string[]; excluded: string[]; complete: boolean; diagnostics: string[]; digest: string;
}
export const SkillAdmissionSchema = object({
  version: Type.Literal(1), id, revision: Type.Integer({ minimum: 0 }), profileId: id, sessionId: id,
  skillId: id, name: Type.String(), contentDigest: hash, snapshotDigest: hash, inspectionDigest: hash,
  root, policyDigest: hash, origin: SkillOriginSchema, publisher: SkillPublisherSchema,
  keyFingerprint: Type.Union([hash, Type.Null()]), access, paths: Type.Array(path, { minItems: 1, maxItems: 32, uniqueItems: true }),
  createdAt: Type.String(), expiresAt: Type.String(), actor: Type.Literal("user"), commandId: id,
  state: Type.Union([Type.Literal("active"), Type.Literal("revoked")]),
  revokedAt: Type.Union([Type.String(), Type.Null()]), reason: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
});
export type SkillAdmission = Static<typeof SkillAdmissionSchema>;
export const SkillAdmissionCommandSchema = Type.Union([
  object({ type: Type.Literal("skill.admit"), sessionId: id, skillId: id, expectedDigest: hash, expectedInspectionDigest: hash,
    publisher: SkillPublisherSchema, access, paths: Type.Array(path, { minItems: 1, maxItems: 32, uniqueItems: true }),
    validHours: Type.Integer({ minimum: 1, maximum: 168 }), confirmReviewed: Type.Literal(true) }),
  object({ type: Type.Literal("skill.revoke"), sessionId: id, admissionId: id, expectedRevision: Type.Integer({ minimum: 0 }),
    reason: Type.String({ minLength: 1, maxLength: 2000 }), confirm: Type.Literal(true) }),
]);
export type SkillAdmissionCommand = Static<typeof SkillAdmissionCommandSchema>;
export const SkillAdmissionQuerySchema = Type.Union([
  object({ type: Type.Literal("skill.inspect"), sessionId: id, skillId: id, expectedDigest: hash }),
  object({ type: Type.Literal("skill.audit"), sessionId: id }),
]);
export type SkillAdmissionQuery = Static<typeof SkillAdmissionQuerySchema>;
export type SkillAdmissionResponse = { type: "skill.inspect"; inspection: SkillInspection } |
  { type: "skill.audit"; admissions: SkillAdmission[]; warning: string };
export const isSkillAdmissionCommand = (input: unknown): input is SkillAdmissionCommand => Value.Check(SkillAdmissionCommandSchema, input);
export const isSkillAdmissionQuery = (input: unknown): input is SkillAdmissionQuery => Value.Check(SkillAdmissionQuerySchema, input);
export interface SkillConsumption { admissionId: string; snapshotDigest: string; skillId: string; contentDigest: string; actor: "user" | "model" }
export const SkillConsumptionSchema = object({ admissionId: id, snapshotDigest: hash, skillId: id, contentDigest: hash, actor: Type.Union([Type.Literal("user"), Type.Literal("model")]) });
export function skillSignaturePayload(origin: SkillOrigin): string {
  return JSON.stringify(["moguri-skill-artifact-v1", origin.kind, origin.entryPath, origin.version, origin.artifactDigest, origin.files]);
}
export function projectSkillAdmission(previous: SkillAdmission | undefined, next: SkillAdmission): SkillAdmission {
  if (!Value.Check(SkillAdmissionSchema, next) || !previous && (next.revision !== 0 || next.state !== "active" || next.revokedAt !== null || next.reason !== null) ||
    previous && (previous.state !== "active" || next.state !== "revoked" || next.revision !== previous.revision + 1 || !next.revokedAt || !next.reason ||
      JSON.stringify({ ...previous, revision: next.revision, state: next.state, revokedAt: next.revokedAt, reason: next.reason }) !== JSON.stringify(next))) {
    throw new MoguriError("skill_admission_corrupt", "Skill authority lost its original reviewed source/user owner or monotonic revocation. No grant was reconstructed.", 409);
  }
  return structuredClone(next);
}
