import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

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
  kind: ArtifactKind; name: string; path: string | null; contentDigest: string;
  revision: number; status: "active" | "archived"; createdAt: string; updatedAt: string;
  origin: "manual" | "message" | "tool" | "file" | "question"; edited: boolean; sources: ArtifactSource[];
  questionId?: string;
}
export const legacyArtifact = (artifact: LegacyRetainedArtifact, eventId: string): RetainedArtifact => ({
  ...artifact, workspaceId: artifact.workspaceId ?? null, kind: "plan", revision: 0, status: "active",
  updatedAt: artifact.createdAt, origin: "file", edited: false,
  sources: [{ eventId, sessionId: artifact.originSessionId, messageId: null, actor: "unknown", modelId: null, outcome: null, contentDigest: artifact.contentDigest }],
});
const source = { sessionId: id, sourceKind: Type.Union([Type.Literal("message"), Type.Literal("tool")]), sourceId: id };
export const ArtifactDraftSchema = object({ kind: ArtifactKindSchema, name, text });
export const ArtifactChangesSchema = object({ name: Type.Optional(name), text: Type.Optional(text), status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("archived")])) });
export const ProjectArtifactChoiceSchema = object({
  action: Type.Union([Type.Literal("retain"), Type.Literal("delete"), Type.Literal("export")]),
  expectedDigest: hash, exportedDigest: Type.Optional(hash),
});
export type ProjectArtifactChoice = Static<typeof ProjectArtifactChoiceSchema>;
export const ArtifactCommandSchema = Type.Union([
  object({ type: Type.Literal("artifact.create"), sessionId: Type.Union([id, Type.Null()]), projectId: Type.Optional(Type.Union([id, Type.Null()])), ...ArtifactDraftSchema.properties }),
  object({ type: Type.Literal("artifact.promote"), ...source, kind: ArtifactKindSchema, name, expectedDigest: hash }),
  object({ type: Type.Literal("artifact.update"), artifactId: id, expectedRevision: revision, changes: ArtifactChangesSchema }),
  object({ type: Type.Literal("artifact.delete"), artifactId: id, expectedRevision: revision, confirm: Type.Literal(true) }),
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
  | { type: "project.artifacts.export"; export: ArtifactExport; preview: ProjectArtifactPreview };
