import { Type, type Static, type TSchema } from "typebox";
import { MoguriError } from "./core.ts";
import type { StoredEvent } from "./index.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 }), hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const path = Type.String({ minLength: 1, maxLength: 4096, pattern: "^[^\\u0000]*$" });
const root = object({ root: path, device: Type.String({ pattern: "^[0-9]+$" }), inode: Type.String({ pattern: "^[0-9]+$" }) });
export const REPOSITORY_TRUST_WARNING = "Trust skips model assessment only for the exact existing repository script entrypoints in this baseline. New, changed, generated, downloaded and third-party package scripts are not included. Dependency input changes require a fresh review. Retained unsafe assessments still require their separate exact actual-user force. Trust is not an execution permission, transitive-code audit or OS isolation; normal approvals and hard denials still apply.";
export const RepositoryTrustBaselineSchema = object({
  profileId: id, projectId: id, root, repository: root, head: Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }),
  files: Type.Array(object({ path, digest: hash, bytes: Type.Integer({ minimum: 0, maximum: 512 * 1024 }) }), { maxItems: 20_000 }),
  dependencies: Type.Array(object({ path, digest: Type.Union([hash, Type.Null()]) }), { maxItems: 20_000 }),
  excluded: Type.Array(object({ path, reason: Type.String({ minLength: 1, maxLength: 200 }) }), { maxItems: 20_000 }),
});
export type RepositoryTrustBaseline = Static<typeof RepositoryTrustBaselineSchema>;
export type RepositoryTrustPreview = RepositoryTrustBaseline & { baselineDigest: string; expectedRevision: number; warning: string };
export const RepositoryTrustRecordSchema = object({
  id, profileId: id, projectId: id, revision: Type.Integer({ minimum: 0 }), baselineDigest: hash,
  root, repository: root, head: Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }), files: Type.Integer({ minimum: 0, maximum: 20_000 }),
  status: Type.Union([Type.Literal("trusted"), Type.Literal("revoked")]),
  actor: Type.Literal("user"), commandId: id, at: Type.String(),
});
export type RepositoryTrustRecord = Static<typeof RepositoryTrustRecordSchema>;
export const TrustedScriptAttemptSchema = object({
  id, trustId: id, trustRevision: Type.Integer({ minimum: 0 }), baselineDigest: hash, profileId: id, projectId: id,
  sessionId: id, workspaceId: Type.Union([id, Type.Null()]), turnId: id, stepId: id,
  callId: Type.String({ minLength: 1, maxLength: 256 }), path, sourceDigest: hash, rootDigest: hash, inputDigest: hash, at: Type.String(),
});
export type TrustedScriptAttempt = Static<typeof TrustedScriptAttemptSchema>;
export const RepositoryTrustCommandSchema = Type.Union([
  object({ type: Type.Literal("repository.trust.approve"), projectId: id, expectedRevision: Type.Integer({ minimum: -1 }),
    baselineDigest: hash, confirmExistingScripts: Type.Literal(true) }),
  object({ type: Type.Literal("repository.trust.revoke"), projectId: id, expectedRevision: Type.Integer({ minimum: 0 }) }),
]);
export const RepositoryTrustQuerySchema = object({ type: Type.Literal("repository.trust.preview"), projectId: id });
export type RepositoryTrustCommand = Static<typeof RepositoryTrustCommandSchema>;
export type RepositoryTrustResponse = { type: "repository.trust.preview"; preview: RepositoryTrustPreview };
export interface RepositoryTrustSnapshot { repositoryTrusts: RepositoryTrustRecord[]; trustedScriptAttempts: TrustedScriptAttempt[] }
export function projectRepositoryTrust(previous: RepositoryTrustRecord | undefined, next: RepositoryTrustRecord): RepositoryTrustRecord {
  if (!previous ? next.revision !== 0 || next.status !== "trusted" :
    next.id !== previous.id || next.projectId !== previous.projectId || next.profileId !== previous.profileId ||
    next.revision !== previous.revision + 1 || next.commandId === previous.commandId ||
    next.status === "revoked" && (previous.status !== "trusted" || next.baselineDigest !== previous.baselineDigest ||
      JSON.stringify(next.root) !== JSON.stringify(previous.root) || JSON.stringify(next.repository) !== JSON.stringify(previous.repository) ||
      next.head !== previous.head || next.files !== previous.files)) {
    throw new MoguriError("repository_trust_corrupt", "Repository trust lost its exact actual-user baseline or monotonic revocation. No model or Git commit may enlarge it.", 409);
  }
  return structuredClone(next);
}
export const hasRepositoryWorkflowHistory = (events: readonly StoredEvent[]) => events.some((event) =>
  event.event_type === "repository.trust_recorded" || event.event_type === "repository.script_reserved" ||
  event.event_type === "turn.recovery_entered" || event.event_type === "tool.completed" && event.payload.cleanupConfirmed !== undefined ||
  event.event_type === "session.created" && event.payload.workspaceOrigin !== undefined ||
  event.event_type === "session.workspace_bound" && event.payload.workspaceOrigin !== undefined ||
  event.event_type === "project.configured" && (event.payload.configuration.values.repo.workspaceMode !== undefined ||
    event.payload.configuration.values.repo.pullRequests !== undefined));
