import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";
import type { CandidateRoot } from "./candidates.ts";
import type { StoredEvent, Session } from "./index.ts";
import type { LocalIssue } from "./workspace.ts";
import type { ChangeSet, ManagedWorkspace } from "./worktrees.ts";
import { sessionPullRequestUrl } from "./session-status.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const nullableId = Type.Union([id, Type.Null()]);
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const timestamp = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
export const CandidatePrIdentitySchema = object({
  url: Type.String({ minLength: 1, maxLength: 2048 }), repo: Type.String({ minLength: 3, maxLength: 300 }),
  number: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
});
export type CandidatePrIdentity = Static<typeof CandidatePrIdentitySchema>;
export function candidatePrIdentity(input: string): CandidatePrIdentity {
  const match = input.match(/^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*)\/pull\/([1-9]\d*)\/?$/);
  if (!match || !Number.isSafeInteger(Number(match[2]))) throw new MoguriError("candidate_retention_corrupt", "Candidate PR provenance is not an exact canonical repository/PR identity. Nothing was deleted.", 409);
  return { url: `https://github.com/${match[1]}/pull/${match[2]}`, repo: match[1]!, number: Number(match[2]) };
}
export const sameCandidatePr = (left: CandidatePrIdentity, right: CandidatePrIdentity) =>
  left.url === right.url && left.repo === right.repo && left.number === right.number;
export const CandidateOwnerSchema = object({
  version: Type.Literal(1), id, profileId: id, projectId: id, originSessionId: nullableId,
  kind: Type.Union([Type.Literal("candidate"), Type.Literal("generation")]),
  pullRequest: Type.Union([CandidatePrIdentitySchema, Type.Null()]),
  generationEvidence: Type.Optional(object({ generationId: id, inputDigest: hash, resultDigest: hash, proposalDocumentDigest: hash })),
});
export type CandidateOwner = Static<typeof CandidateOwnerSchema>;
export const CandidateCleanupSchema = object({
  version: Type.Literal(1), id, profileId: id, revision: Type.Integer({ minimum: 0 }),
  reason: Type.Union([
    object({ kind: Type.Literal("session-delete"), sessionId: id }),
    object({ kind: Type.Literal("pr-merged"), pullRequest: CandidatePrIdentitySchema, checkedAt: timestamp }),
  ]),
  targets: Type.Array(id, { uniqueItems: true }),
  status: Type.Union([Type.Literal("pending"), Type.Literal("failed"), Type.Literal("completed")]),
  createdAt: timestamp, updatedAt: timestamp,
  diagnostic: Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()]),
  quarantinedRoots: Type.Array(object({ projectId: id, workspaceId: nullableId })),
});
export type CandidateCleanup = Static<typeof CandidateCleanupSchema>;
function corrupt(message: string): never { throw new MoguriError("candidate_retention_corrupt", `${message} Candidate content and accounting were preserved.`, 409); }
const exactTime = (value: string) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function projectCandidateCleanup(previous: CandidateCleanup | undefined, value: unknown): CandidateCleanup {
  if (!Value.Check(CandidateCleanupSchema, value)) corrupt("Unsupported candidate cleanup metadata.");
  const next = value;
  if (![next.createdAt, next.updatedAt].every(exactTime) || next.reason.kind === "pr-merged" &&
    (!exactTime(next.reason.checkedAt) || !sameCandidatePr(next.reason.pullRequest, candidatePrIdentity(next.reason.pullRequest.url)))) corrupt("Cleanup lost its exact time or PR identity.");
  if ((next.status === "failed") !== (next.diagnostic !== null) || next.status !== "completed" && next.quarantinedRoots.length) corrupt("Cleanup status, failure or retained quarantine disagree.");
  if (!previous) {
    if (next.revision !== 0 || next.status !== "pending" || next.createdAt !== next.updatedAt) corrupt("Cleanup must begin with a durable pending intent.");
  } else if (previous.status === "completed" || next.revision !== previous.revision + 1 ||
    (["version", "id", "profileId", "createdAt"] as const).some((key) => previous[key] !== next[key]) ||
    JSON.stringify(previous.reason) !== JSON.stringify(next.reason) || JSON.stringify(previous.targets) !== JSON.stringify(next.targets)) {
    corrupt("Original cleanup ownership, targets or terminal outcome changed/replayed.");
  }
  return structuredClone(next);
}

// Replay original links, not today's selected session or its last application.
export function projectCandidateOwners(events: readonly StoredEvent[], profileId: string): CandidateOwner[] {
  type Source = { owner: CandidateOwner; source: CandidateRoot; generationId?: string };
  type Link = Pick<Session, "id" | "projectId" | "workspaceId" | "workItemId" | "prUrl">;
  const sources = new Map<string, Source>(), sessions = new Map<string, Link>();
  const issues = new Map<string, LocalIssue>(), workspaces = new Map<string, ManagedWorkspace>(), changes = new Map<string, ChangeSet>();
  const bind = () => {
    for (const { owner, source } of sources.values()) {
      if (owner.pullRequest || !owner.originSessionId) continue;
      const session = sessions.get(owner.originSessionId);
      if (!session || session.projectId !== owner.projectId || session.workspaceId !== source.workspaceId) continue;
      const url = sessionPullRequestUrl(session, { issues: [...issues.values()], managedWorkspaces: [...workspaces.values()], changeSets: [...changes.values()] });
      if (url) owner.pullRequest = candidatePrIdentity(url);
    }
  };
  for (const event of events) {
    if (event.profile_id !== profileId) continue;
    if (event.event_type === "session.created" && event.session_id) sessions.set(event.session_id, { id: event.session_id,
      projectId: event.project_id ?? null, workspaceId: event.payload.workspaceId ?? null, prUrl: event.payload.prUrl ?? null, workItemId: event.payload.workItemId ?? null });
    if (event.event_type === "session.organized" && event.session_id) {
      const session = sessions.get(event.session_id);
      if (session && event.payload.changes.prUrl !== undefined) session.prUrl = event.payload.changes.prUrl;
    }
    if (event.event_type === "session.workspace_bound" && event.session_id) {
      const session = sessions.get(event.session_id); if (session) session.workspaceId = event.payload.workspaceId;
    }
    if (event.event_type === "session.deleted") sessions.delete(event.payload.deletedSessionId);
    if (event.event_type === "issue.saved") issues.set(event.payload.issue.id, event.payload.issue);
    if (event.event_type === "workspace.saved") workspaces.set(event.payload.workspace.id, event.payload.workspace);
    if (event.event_type === "change_set.saved") changes.set(event.payload.changeSet.id, event.payload.changeSet);
    if (event.event_type === "candidate.saved" || event.event_type === "candidate.generation_recorded") {
      const record = event.event_type === "candidate.saved" ? event.payload.candidate : event.payload.generation;
      const kind = event.event_type === "candidate.saved" ? "candidate" : "generation";
      if (sources.has(record.id) && sources.get(record.id)!.owner.kind !== kind) corrupt("One proposal identity cannot adopt another kind of original owner.");
      if (!sources.has(record.id)) sources.set(record.id, { source: record.source, ...("generationId" in record && record.generationId ? { generationId: record.generationId } : {}), owner: { version: 1, id: record.id, profileId,
        projectId: record.projectId, kind,
        originSessionId: "originSessionId" in record ? record.originSessionId : record.sessionId, pullRequest: null } });
      bind();
    }
    if (["session.created", "session.organized", "session.workspace_bound", "issue.saved", "workspace.saved", "change_set.saved"].includes(event.event_type)) bind();
    if (event.event_type === "candidate.owner_bound") {
      const owner = event.payload.owner, source = sources.get(owner.id), original = source?.owner;
      if (!Value.Check(CandidateOwnerSchema, owner) || !original || event.artifact_id !== owner.id ||
        event.project_id || event.session_id || event.turn_id || event.step_id ||
        (["version", "id", "profileId", "projectId", "originSessionId", "kind"] as const).some((key) => owner[key] !== original[key]) ||
        owner.generationEvidence && (owner.kind !== "candidate" || source?.generationId !== owner.generationEvidence.generationId) ||
        original.generationEvidence && JSON.stringify(original.generationEvidence) !== JSON.stringify(owner.generationEvidence) ||
        owner.pullRequest && !sameCandidatePr(owner.pullRequest, candidatePrIdentity(owner.pullRequest.url)) ||
        original.pullRequest && (!owner.pullRequest || !sameCandidatePr(original.pullRequest, owner.pullRequest))) corrupt("Candidate ownership or its first exact PR association changed.");
      original.pullRequest = structuredClone(owner.pullRequest);
      if (owner.generationEvidence) original.generationEvidence = structuredClone(owner.generationEvidence);
    }
    if (event.event_type === "artifact.deleted") sources.delete(event.payload.artifactId);
  }
  return [...sources.values()].map(({ owner }) => owner);
}
export const candidateDeletionPending = (cleanups: readonly CandidateCleanup[], id: string) =>
  cleanups.some((cleanup) => cleanup.status !== "completed" && cleanup.targets.includes(id));
