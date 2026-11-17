import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";
import type { SourceIndicatorReport } from "./source-indicators.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const path = Type.String({ minLength: 1, maxLength: 4096 });
const access = Type.Union([Type.Literal("read-only"), Type.Literal("native-files")]);
export const SKILL_INSPECTION_BYTES = 512 * 1024;
export const COMPLETE_SOURCE_ENVELOPE_BYTES = 2 * 1024 * 1024;
export const SkillLoadedSchema = object({
  version: Type.Literal(1), capabilityId: id, name: Type.String({ minLength: 1 }),
  contentDigest: hash, bytes: Type.Integer({ minimum: 0, maximum: COMPLETE_SOURCE_ENVELOPE_BYTES }),
  startedAt: Type.String({ minLength: 1 }), loadMs: Type.Integer({ minimum: 0 }),
  actor: Type.Union([Type.Literal("user"), Type.Literal("model")]), callId: Type.Union([id, Type.Null()]),
});
export type SkillLoaded = Static<typeof SkillLoadedSchema>;
const root = object({ root: path, device: Type.String(), inode: Type.String() });
export const SkillOriginSchema = object({
  kind: Type.Union([Type.Literal("registry"), Type.Literal("local"), Type.Literal("archive")]),
  sourceId: Type.Union([id, Type.Null()]), identityDigest: hash, artifactDigest: hash,
  configurationDigest: Type.Optional(hash),
  entryPath: path,
  version: Type.String({ minLength: 1, maxLength: 80 }),
  root: Type.Union([root, Type.Null()]),
  files: Type.Array(object({ path, digest: hash, bytes: Type.Integer({ minimum: 0, maximum: SKILL_INSPECTION_BYTES }) }), { minItems: 1, maxItems: 128 }),
});
export type SkillOrigin = Static<typeof SkillOriginSchema>;
const publisherIdentity = Type.String({ minLength: 1, maxLength: 200 }), publicKey = Type.String({ minLength: 1, maxLength: 4096 });
const signature = Type.String({ minLength: 1, maxLength: 1024 });
export const SkillPublisherSchema = Type.Union([
  object({ kind: Type.Literal("unverified-local"), acknowledge: Type.Literal("publisher-not-verified") }),
  object({ kind: Type.Literal("pinned-ed25519"), identity: publisherIdentity, publicKey, signature }),
  /** Schema 111: a publisher key the actual user saved once in this profile, named by its SPKI SHA-256 fingerprint. */
  object({ kind: Type.Literal("saved-ed25519"), fingerprint: hash, signature }),
]);
/** Schema 111: a profile-owned Ed25519 publisher key saved by the actual user. Saving is not a reputation or identity check. */
export const SavedSkillPublisherSchema = object({
  version: Type.Literal(1), fingerprint: hash, identity: publisherIdentity, publicKey,
  actor: Type.Literal("user"), commandId: id, createdAt: Type.String({ minLength: 1, maxLength: 40 }),
});
export type SavedSkillPublisher = Static<typeof SavedSkillPublisherSchema>;
/**
 * Schema 111: a monotonic actual-user block. `key` blocks a publisher key fingerprint (saved or pasted); `artifact` blocks one exact
 * skill version by its artifact digest. Blocks stop new admissions and future loads/effects; they cannot recall delivered instructions.
 */
export const SkillTrustBlockSchema = object({
  version: Type.Literal(1), kind: Type.Union([Type.Literal("key"), Type.Literal("artifact")]), digest: hash,
  reason: Type.String({ minLength: 1, maxLength: 2000 }), actor: Type.Literal("user"), commandId: id, createdAt: Type.String({ minLength: 1, maxLength: 40 }),
});
export type SkillTrustBlock = Static<typeof SkillTrustBlockSchema>;
export const SkillPublisherCommandSchema = Type.Union([
  object({ type: Type.Literal("skill.publisher.save"), identity: publisherIdentity, publicKey, confirmTrusted: Type.Literal(true) }),
  object({ type: Type.Literal("skill.trust.block"), kind: Type.Union([Type.Literal("key"), Type.Literal("artifact")]), digest: hash,
    reason: Type.String({ minLength: 1, maxLength: 2000 }), confirm: Type.Literal(true) }),
]);
export type SkillPublisherCommand = Static<typeof SkillPublisherCommandSchema>;
export const isSkillPublisherCommand = (input: unknown): input is SkillPublisherCommand => Value.Check(SkillPublisherCommandSchema, input);
export function projectSkillTrust(publishers: Map<string, SavedSkillPublisher>, blocks: Map<string, SkillTrustBlock>,
  value: { publisher: SavedSkillPublisher } | { block: SkillTrustBlock }): void {
  if ("publisher" in value) {
    if (!Value.Check(SavedSkillPublisherSchema, value.publisher) || publishers.has(value.publisher.fingerprint)) {
      throw new MoguriError("skill_publisher_corrupt", "A saved publisher key is invalid or was saved twice. State was preserved.", 409);
    }
    publishers.set(value.publisher.fingerprint, structuredClone(value.publisher));
    return;
  }
  const key = `${value.block.kind}:${value.block.digest}`;
  if (!Value.Check(SkillTrustBlockSchema, value.block) || blocks.has(key)) throw new MoguriError("skill_publisher_corrupt", "A skill trust block is invalid or duplicated. Blocks are monotonic; state was preserved.", 409);
  blocks.set(key, structuredClone(value.block));
}
export const skillTrustBlocked = (blocks: readonly SkillTrustBlock[], kind: SkillTrustBlock["kind"], digest: string | null | undefined): SkillTrustBlock | undefined =>
  digest ? blocks.find((block) => block.kind === kind && block.digest === digest) : undefined;
export type SkillPublisher = Static<typeof SkillPublisherSchema>;
export interface SkillInspection {
  version: 1; skillId: string; name: string; contentDigest: string; profileId: string; sessionId: string;
  root: Static<typeof root>; policyDigest: string; origin: SkillOrigin; access: "read-only" | "native-files";
  revocationEpoch: string;
  files: { path: string; digest: string; bytes: number; text: string }[];
  externalReferences: string[]; excluded: string[]; complete: boolean; diagnostics: string[]; digest: string;
  /** Files left out of a trusted-source load (binary or beyond the bounded package), disclosed by path and size. */
  omitted?: { path: string; bytes: number; reason: "binary" | "size" }[];
  /** Protocol 111: deterministic indicator findings over every inspected file. Advisory only; never a grant or safety verdict. */
  scan?: SourceIndicatorReport;
}
export const SkillAdmissionSchema = object({
  version: Type.Literal(1), id, revision: Type.Integer({ minimum: 0 }), profileId: id, sessionId: id,
  skillId: id, name: Type.String(), contentDigest: hash, snapshotDigest: hash, inspectionDigest: hash,
  root, policyDigest: hash, origin: SkillOriginSchema, publisher: SkillPublisherSchema,
  keyFingerprint: Type.Union([hash, Type.Null()]), access, paths: Type.Array(path, { minItems: 1, maxItems: 32, uniqueItems: true }),
  createdAt: Type.String(), expiresAt: Type.String(), actor: Type.Literal("user"), commandId: id,
  /** Schema 107: admitted because the user enabled this Local source or imported this registry skill; `commandId` is that settings/capability event. */
  basis: Type.Optional(Type.Literal("trusted-source")),
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
  object({ type: Type.Literal("skill.consume"), sessionId: id, skillId: id, expectedDigest: hash }),
  object({ type: Type.Literal("skill.audit"), sessionId: id }),
]);
export type SkillAdmissionQuery = Static<typeof SkillAdmissionQuerySchema>;
export type SkillAdmissionResponse = { type: "skill.inspect"; inspection: SkillInspection } |
  { type: "skill.consume"; body: string; provenance: SkillConsumption; complete: true; authority: string } |
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
