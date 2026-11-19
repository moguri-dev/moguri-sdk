import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";
import type { Snapshot } from "./index.ts";
import type { ToolSuggestion } from "./tool-suggestions.ts";
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
  /** Protocol 114: repeated requests a reviewed script tool could handle. Local phrase matches, not a model verdict. */
  tools: ToolSuggestion[];
  modelId: string | null;
  diagnostic: string;
}
export const AttentionReasonSchema = Type.Union([
  Type.Literal("question"), Type.Literal("approval"), Type.Literal("script-review"), Type.Literal("failed"),
  Type.Literal("completed"), Type.Literal("ci"), Type.Literal("my-work"),
  /** Protocol 114: the repeated-task automation found a request a script tool could handle. Sessionless; messageId is the suggested tool name. */
  Type.Literal("tool-suggestion"),
]);
export interface Attention {
  id: string; sessionId: string | null; projectId: string | null; kind: "question" | "bell" | "done";
  reason: Static<typeof AttentionReasonSchema>; source: "state" | "heuristic";
  messageId: string | null; acknowledged: boolean; active: boolean; createdAt: string;
  operationRevision?: number;
  myWork?: { refreshId: string; revision: number; fingerprint: string };
  deleted?: boolean;
}
export const inboxAttention = (entries: readonly Attention[]): Attention[] => entries.filter((entry) => entry.active && !entry.deleted)
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
export const attentionTypeLabels = {
  question: "Questions", failed: "Errors", "script-review": "Script reviews", approval: "Tool approvals",
  completed: "Completed work", ci: "PR checks", "my-work": "GitHub work", "tool-suggestion": "Tool suggestions",
} satisfies Record<Attention["reason"], string>;
export const AttentionFiltersSchema = object({
  query: Type.Optional(Type.String({ maxLength: 200 })),
  type: Type.Optional(Type.Union([Type.Literal("all"), AttentionReasonSchema])),
  state: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("unread"), Type.Literal("read")])),
});
export type AttentionFilters = Static<typeof AttentionFiltersSchema>;
type AttentionSources = Pick<Snapshot, "profileId" | "attention" | "sessions" | "questions" | "scriptReviews" | "githubOperations" | "myWorkRefreshes">;
export function attentionDescription(entry: Attention, snapshot: AttentionSources): string {
  const session = snapshot.sessions.find((session) => session.id === entry.sessionId);
  if (entry.reason === "script-review") {
    const review = snapshot.scriptReviews.find((review) => review.profileId === snapshot.profileId &&
      review.id === entry.messageId && review.sessionId === entry.sessionId);
    return review ? [review.source.path, review.advice?.verdict, review.advice?.summary, ...(review.advice?.findings ?? [])].filter(Boolean).join(" ") :
      "Original script assessment unavailable.";
  }
  if (entry.reason === "question") {
    const question = entry.source === "state" ? snapshot.questions.find((question) => question.id === entry.messageId && question.sessionId === entry.sessionId) : undefined;
    const message = entry.source === "heuristic" ? session?.messages.find((message) => message.id === entry.messageId && message.role === "assistant") : undefined;
    return question?.question ?? (message ? `Possible question: ${message.text}` : "Possible question");
  }
  if (entry.reason === "failed") {
    const message = session?.messages.find((message) => message.id === entry.messageId &&
      (message.role === "notice" || message.role === "tool") && ["failed", "partial"].includes(message.outcome ?? ""));
    return message?.text || "Inspect incomplete or failed work";
  }
  if (entry.reason === "ci") {
    const operation = snapshot.githubOperations.find((operation) => operation.id === entry.messageId && operation.originSessionId === entry.sessionId);
    return operation?.ci ? `PR #${operation.ci.target.number} / watch ${operation.status} / CI ${operation.ci.state ?? "unobserved"} / head ${operation.ci.target.headSha.slice(0, 12)}` :
      "Original CI report unavailable; no replacement result was inferred.";
  }
  if (entry.reason === "my-work") {
    const work = snapshot.myWorkRefreshes.find((refresh) => refresh.id === entry.myWork?.refreshId)?.attention.find((value) => value.itemId === entry.messageId);
    return work ? `${work.repository}#${work.number} / ${work.categories.join(", ")} / original head ${work.headSha.slice(0, 12)}` : "Original GitHub observation unavailable.";
  }
  if (entry.reason === "tool-suggestion") return `A repeated request could become the script tool ${entry.messageId ?? "unnamed"}. Review it in Skills / Tools.`;
  if (entry.reason === "approval") {
    const approval = session?.pendingApproval?.id === entry.messageId ? session.pendingApproval : undefined;
    return approval ? `Exact tool approval needed: ${approval.call.name}` : "Exact tool approval needed";
  }
  return "Agent done and waiting";
}
export function filterInboxAttention(snapshot: AttentionSources, filters: AttentionFilters = {}): Attention[] {
  if (!Value.Check(AttentionFiltersSchema, filters)) throw new MoguriError("attention_filters", "Use a notification type, all/read/unread state and a search query up to 200 characters.");
  const terms = filters.query?.normalize("NFKC").trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  return inboxAttention(snapshot.attention).filter((entry) => {
    if (filters.type && filters.type !== "all" && entry.reason !== filters.type ||
      filters.state === "read" && !entry.acknowledged || filters.state === "unread" && entry.acknowledged) return false;
    if (!terms.length) return true;
    const session = snapshot.sessions.find((session) => session.id === entry.sessionId);
    const text = `${session?.title ?? ""} ${attentionTypeLabels[entry.reason]} ${attentionDescription(entry, snapshot)}`.normalize("NFKC").toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
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
