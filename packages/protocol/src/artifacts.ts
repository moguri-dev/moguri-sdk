import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import type { CapabilityJob } from "./platform.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const revision = Type.Integer({ minimum: 0 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const name = Type.String({ minLength: 1, maxLength: 160 });
const text = Type.String({ maxLength: 128 * 1024 });
export const ArtifactKindSchema = Type.Union([Type.Literal("plan"), Type.Literal("decision"), Type.Literal("answer"), Type.Literal("research-note"), Type.Literal("report")]);
export type ArtifactKind = Static<typeof ArtifactKindSchema>;
export interface LegacyRetainedArtifact { id: string; projectId: string; originSessionId: string | null; name: string; path: string | null; contentDigest: string; createdAt: string; workspaceId?: string | null }
export interface ArtifactSource {
  eventId: string | null; sessionId: string | null; messageId: string | null;
  actor: "user" | "model" | "decision-provider" | "tool" | "unknown"; modelId: string | null; outcome: string | null; contentDigest: string;
}
export interface RetainedArtifact {
  id: string; projectId: string | null; originSessionId: string | null; workspaceId: string | null;
  folderId: string | null; workItemId: string | null;
  kind: ArtifactKind; name: string; path: string | null; contentDigest: string;
  revision: number; status: "active" | "archived"; createdAt: string; updatedAt: string;
  origin: "manual" | "message" | "tool" | "file" | "question"; edited: boolean; sources: ArtifactSource[];
  questionId?: string;
}
export const legacyArtifact = (artifact: LegacyRetainedArtifact, eventId: string): RetainedArtifact => ({
  ...artifact, workspaceId: artifact.workspaceId ?? null, folderId: null, workItemId: null, kind: "plan", revision: 0, status: "active",
  updatedAt: artifact.createdAt, origin: "file", edited: false,
  sources: [{ eventId, sessionId: artifact.originSessionId, messageId: null, actor: "unknown", modelId: null, outcome: null, contentDigest: artifact.contentDigest }],
});
export type LegacyVersionedArtifact = Omit<RetainedArtifact, "folderId" | "workItemId"> & Partial<Pick<RetainedArtifact, "folderId" | "workItemId">>;
export const normalizeArtifact = (artifact: LegacyVersionedArtifact): RetainedArtifact => ({ ...artifact, folderId: artifact.folderId ?? null, workItemId: artifact.workItemId ?? null });
const source = { sessionId: id, sourceKind: Type.Union([Type.Literal("message"), Type.Literal("tool")]), sourceId: id };
const associations = { folderId: Type.Optional(Type.Union([id, Type.Null()])), workItemId: Type.Optional(Type.Union([id, Type.Null()])) };
export const ArtifactDraftSchema = object({ kind: ArtifactKindSchema, name, text, ...associations });
export const ArtifactChangesSchema = object({ name: Type.Optional(name), text: Type.Optional(text), status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("archived")])), ...associations });
export const ArtifactMaterializeOptionsSchema = { workspaceId: Type.Optional(id), commitBranch: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })) };
export type ArtifactMaterializeOptions = { workspaceId?: string; commitBranch?: string };
const materializationPreview = {
  projectId: id, workspaceId: Type.Union([id, Type.Null()]), root: Type.String({ minLength: 1, maxLength: 4096 }), rootIdentity: hash,
  configurationRevision: revision, path: Type.String({ pattern: "^artifacts/moguri-[a-f0-9]{64}\\.json$" }), setDigest: hash, fileDigest: hash, digest: hash,
  count: Type.Integer({ minimum: 1 }), bytes: Type.Integer({ minimum: 1, maximum: 8 * 1024 * 1024 }),
};
const commit = { branch: Type.String({ minLength: 1, maxLength: 200 }), base: Type.String({ pattern: "^[a-f0-9]{40,64}$" }) };
export const ArtifactMaterializationPreviewSchema = object({ ...materializationPreview, commit: Type.Union([object(commit), Type.Null()]) });
export type ArtifactMaterializationPreview = Static<typeof ArtifactMaterializationPreviewSchema>;
export const ArtifactMaterializationSchema = object({ ...materializationPreview, jobId: id, commit: Type.Union([object({ ...commit, commit: Type.String({ pattern: "^[a-f0-9]{40,64}$" }) }), Type.Null()]) });
export type ArtifactMaterialization = Static<typeof ArtifactMaterializationSchema>;
export const ProjectArtifactChoiceSchema = object({
  action: Type.Union([Type.Literal("retain"), Type.Literal("delete"), Type.Literal("export"), Type.Literal("materialize")]),
  expectedDigest: hash, exportedDigest: Type.Optional(hash), materializationId: Type.Optional(id),
});
export type ProjectArtifactChoice = Static<typeof ProjectArtifactChoiceSchema>;
export const ArtifactCommandSchema = Type.Union([
  object({ type: Type.Literal("artifact.create"), sessionId: Type.Union([id, Type.Null()]), projectId: Type.Optional(Type.Union([id, Type.Null()])), ...ArtifactDraftSchema.properties }),
  object({ type: Type.Literal("artifact.promote"), ...source, kind: ArtifactKindSchema, name, expectedDigest: hash }),
  object({ type: Type.Literal("artifact.update"), artifactId: id, expectedRevision: revision, changes: ArtifactChangesSchema }),
  object({ type: Type.Literal("artifact.delete"), artifactId: id, expectedRevision: revision, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("project.artifacts.materialize"), projectId: id, expectedDigest: hash, confirm: Type.Literal(true), ...ArtifactMaterializeOptionsSchema }),
]);
export type ArtifactCommand = Static<typeof ArtifactCommandSchema>;
export type ArtifactChanges = Extract<ArtifactCommand, { type: "artifact.update" }>["changes"];
export const isArtifactCommand = (value: unknown): value is ArtifactCommand => Value.Check(ArtifactCommandSchema, value);
export const ArtifactQuerySchema = Type.Union([
  object({ type: Type.Literal("artifact.read"), artifactId: id, revision: Type.Optional(revision) }),
  object({ type: Type.Literal("artifact.history"), artifactId: id, offset: Type.Integer({ minimum: 0 }), limit: Type.Integer({ minimum: 1, maximum: 100 }) }),
  object({ type: Type.Literal("artifact.source"), ...source }),
  object({ type: Type.Literal("artifact.export"), artifactId: id }),
  object({ type: Type.Literal("project.artifacts.preview"), projectId: id }),
  object({ type: Type.Literal("project.artifacts.export"), projectId: id }),
  object({ type: Type.Literal("project.artifacts.materialize.preview"), projectId: id, ...ArtifactMaterializeOptionsSchema }),
  object({ type: Type.Literal("artifact.materialization"), jobId: id }),
]);
export type ArtifactQuery = Static<typeof ArtifactQuerySchema>;
export const isArtifactQuery = (value: unknown): value is ArtifactQuery => Value.Check(ArtifactQuerySchema, value);
export interface ArtifactSourcePreview { digest: string; text: string; source: ArtifactSource }
export interface ArtifactExport { filename: string; mediaType: "application/json"; text: string; digest: string }
export interface ProjectArtifactPreview { projectId: string; digest: string; artifacts: Array<{ id: string; name: string; kind: ArtifactKind; revision: number; status: RetainedArtifact["status"] }> }
export type ArtifactResponse =
  | { type: "artifact.read"; text: string; artifact: RetainedArtifact }
  | { type: "artifact.history"; revisions: RetainedArtifact[]; nextOffset: number | null }
  | { type: "artifact.source"; preview: ArtifactSourcePreview }
  | { type: "artifact.export"; export: ArtifactExport }
  | { type: "project.artifacts.preview"; preview: ProjectArtifactPreview }
  | { type: "project.artifacts.export"; export: ArtifactExport; preview: ProjectArtifactPreview }
  | { type: "project.artifacts.materialize.preview"; preview: ArtifactMaterializationPreview }
  | { type: "artifact.materialization"; job: CapabilityJob; result: ArtifactMaterialization | null };
