import { Type, type Static } from "typebox";
const id = Type.String({ minLength: 1, maxLength: 128 });
const nullableId = Type.Union([id, Type.Null()]);
const object = <T extends Record<string, import("typebox").TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
export const ConfigurationSpecSchema = object({
  target: Type.Union([Type.Literal("global"), Type.Literal("project"), Type.Literal("repo-instructions"), Type.Literal("skill"), Type.Literal("policy")]),
  section: Type.String({ minLength: 1, maxLength: 100 }),
  value: Type.Unknown(),
  reason: Type.String({ minLength: 1, maxLength: 4000 }),
  evidence: Type.Optional(Type.Array(id, { maxItems: 20 })),
});
export type ConfigurationSpec = Static<typeof ConfigurationSpecSchema>;
export interface ConfigurationProposal {
  id: string; projectId: string | null; sessionId: string; actor: "user" | "model";
  target: ConfigurationSpec["target"]; section: string; reason: string;
  contentDigest: string; baseDigest: string; baseRevision: number | null;
  status: "pending" | "applied" | "rejected"; createdAt: string;
  evidence: SuggestionSource[];
  workspaceId?: string | null;
}
export interface SuggestionSource { sessionId: string; messageId: string; title: string; projectId: string | null; text: string }
export interface SuggestionPreview {
  scope: "project" | "project-free" | "all-projects"; digest: string; sources: SuggestionSource[];
  repeated: { text: string; count: number; messageIds: string[] }[];
  gaps: { id: string; title: string; detail: string }[];
  modelId: string | null;
  diagnostic: string;
}
export interface Attention {
  id: string; sessionId: string | null; projectId: string | null; kind: "question" | "bell" | "done";
  reason: "question" | "approval" | "script-review" | "failed" | "completed" | "ci" | "my-work"; source: "state" | "heuristic";
  messageId: string | null; acknowledged: boolean; active: boolean; createdAt: string;
  operationRevision?: number;
  myWork?: { refreshId: string; revision: number; fingerprint: string };
  deleted?: boolean;
}
export const inboxAttention = (entries: readonly Attention[]): Attention[] => entries.filter((entry) => entry.active && !entry.deleted)
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
export const AttentionDeletedSchema = object({
  attentionIds: Type.Array(id, { minItems: 1, maxItems: 100, uniqueItems: true }), actor: Type.Literal("user"),
});
export type AttentionDeleted = Static<typeof AttentionDeletedSchema>;
export const EngagementCommandSchema = Type.Union([
  object({ type: Type.Literal("metachat.create"), projectId: nullableId, parentSessionId: Type.Optional(id), prompt: Type.Optional(Type.String({ maxLength: 32768 })) }),
  object({ type: Type.Literal("suggestions.generate"), sessionId: nullableId, allProjects: Type.Boolean(), expectedDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }), confirmScope: Type.Literal(true) }),
  object({ type: Type.Literal("configuration.propose"), sessionId: id, proposal: ConfigurationSpecSchema }),
  object({ type: Type.Literal("configuration.decide"), proposalId: id, approve: Type.Boolean(), expectedDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }), acknowledgeRisk: Type.Boolean() }),
  object({ type: Type.Literal("attention.acknowledge"), attentionIds: Type.Array(id, { minItems: 1, maxItems: 100 }) }),
  object({ type: Type.Literal("attention.delete"), attentionIds: Type.Array(id, { minItems: 1, maxItems: 100, uniqueItems: true }) }),
]);
export type EngagementCommand = Static<typeof EngagementCommandSchema>;
export const EngagementQuerySchema = Type.Union([
  object({ type: Type.Literal("suggestions.preview"), sessionId: nullableId, allProjects: Type.Boolean() }),
  object({ type: Type.Literal("configuration.review"), proposalId: id }),
]);
export type EngagementQuery = Static<typeof EngagementQuerySchema>;
export type EngagementResponse =
  | { type: "suggestions.preview"; preview: SuggestionPreview }
  | { type: "configuration.review"; proposal: ConfigurationProposal; spec: ConfigurationSpec; before: unknown; warning: string };
