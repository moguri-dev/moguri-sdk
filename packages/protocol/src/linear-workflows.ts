import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { MoguriError } from "./core.ts";
import type { CapabilityJob } from "./platform.ts";
import type { LocalIssue } from "./workspace.ts";

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
export const LinearEntityIdSchema = Type.String({ pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" });
const remoteId = LinearEntityIdSchema;
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const date = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const timestamp = Type.String({ minLength: 20, maxLength: 40 });
const nullableId = Type.Union([remoteId, Type.Null()]);
const nullableDate = Type.Union([date, Type.Null()]);
const body = Type.String({ maxLength: 64 * 1024 });
const issueFields = {
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  description: Type.Optional(body), stateId: Type.Optional(remoteId),
  projectId: Type.Optional(nullableId), cycleId: Type.Optional(nullableId),
  priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
  estimate: Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: 1000 }), Type.Null()])),
  assigneeId: Type.Optional(nullableId), labelIds: Type.Optional(Type.Array(remoteId, { maxItems: 50, uniqueItems: true })),
  parentId: Type.Optional(nullableId), dueDate: Type.Optional(nullableDate),
};
export const LinearIssueFieldsSchema = object(issueFields);
export type LinearIssueFields = Static<typeof LinearIssueFieldsSchema>;
const projectFields = {
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  description: Type.Optional(Type.String({ maxLength: 255 })), content: Type.Optional(body),
  leadId: Type.Optional(nullableId), startDate: Type.Optional(nullableDate), targetDate: Type.Optional(nullableDate),
  priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
};
export const LinearProjectFieldsSchema = object(projectFields);
export type LinearProjectFields = Static<typeof LinearProjectFieldsSchema>;
export const LinearPhaseMappingSchema = Type.Array(object({ phaseId: id, stateId: remoteId }), { minItems: 1, maxItems: 12 });
export type LinearPhaseMapping = Static<typeof LinearPhaseMappingSchema>;
export const LinearRelationTypeSchema = Type.Union([Type.Literal("blocks"), Type.Literal("duplicate"), Type.Literal("related")]);
export type LinearRelationType = Static<typeof LinearRelationTypeSchema>;

export const LinearWorkflowInputSchema = Type.Union([
  object({ action: Type.Literal("issue.create"), fields: object({ ...issueFields, title: Type.String({ minLength: 1, maxLength: 160 }) }) }),
  object({ action: Type.Literal("issue.update"), issueId: remoteId, fields: LinearIssueFieldsSchema }),
  object({ action: Type.Literal("issue.move"), issueId: remoteId, stateId: remoteId }),
  object({ action: Type.Literal("issue.archive"), issueId: remoteId, archived: Type.Boolean() }),
  object({ action: Type.Literal("issue.delete"), issueId: remoteId }),
  object({ action: Type.Literal("comment.create"), issueId: remoteId, body: Type.String({ minLength: 1, maxLength: 64 * 1024 }) }),
  object({ action: Type.Literal("comment.update"), issueId: remoteId, commentId: remoteId, body: Type.String({ minLength: 1, maxLength: 64 * 1024 }) }),
  object({ action: Type.Literal("comment.delete"), issueId: remoteId, commentId: remoteId }),
  object({ action: Type.Literal("project.create"), fields: object({ ...projectFields, name: Type.String({ minLength: 1, maxLength: 160 }) }) }),
  object({ action: Type.Literal("project.update"), remoteProjectId: remoteId, fields: LinearProjectFieldsSchema }),
  object({ action: Type.Literal("project.archive"), remoteProjectId: remoteId, archived: Type.Boolean() }),
  object({ action: Type.Literal("relation.create"), issueId: remoteId, relatedIssueId: remoteId, relationType: LinearRelationTypeSchema }),
  object({ action: Type.Literal("relation.delete"), issueId: remoteId, relationId: remoteId }),
  object({
    action: Type.Literal("ticket.sync"), direction: Type.Union([Type.Literal("pull"), Type.Literal("push")]),
    localIssueId: id, expectedLocalRevision: Type.Integer({ minimum: 0 }), mapping: LinearPhaseMappingSchema,
  }),
  object({
    action: Type.Literal("ticket.publish"), localIssueId: id, expectedLocalRevision: Type.Integer({ minimum: 0 }),
    mapping: LinearPhaseMappingSchema, fields: Type.Optional(object({
      projectId: issueFields.projectId, cycleId: issueFields.cycleId, priority: issueFields.priority,
      estimate: issueFields.estimate, assigneeId: issueFields.assigneeId, labelIds: issueFields.labelIds,
      parentId: issueFields.parentId, dueDate: issueFields.dueDate,
    })),
  }),
]);
export type LinearWorkflowInput = Static<typeof LinearWorkflowInputSchema>;
export const LinearScopeSchema = object({ projectId: id, sessionId: Type.Optional(id) });
export type LinearScope = Static<typeof LinearScopeSchema>;
export const LinearCommandSchema = Type.Union([
  object({ type: Type.Literal("linear.workflow.execute"), ...LinearScopeSchema.properties, input: LinearWorkflowInputSchema, expectedDigest: hash, confirm: Type.Literal(true) }),
  object({ type: Type.Literal("linear.workflow.cancel"), operationId: id }),
]);
export type LinearCommand = Static<typeof LinearCommandSchema>;
export const LinearCatalogResourceSchema = Type.Union([
  Type.Literal("teams"), Type.Literal("states"), Type.Literal("projects"), Type.Literal("cycles"),
  Type.Literal("labels"), Type.Literal("users"), Type.Literal("issues"), Type.Literal("comments"), Type.Literal("relations"),
]);
export type LinearCatalogResource = Static<typeof LinearCatalogResourceSchema>;
export const LinearQuerySchema = Type.Union([
  object({ type: Type.Literal("linear.workflow.catalog"), projectId: id, resource: LinearCatalogResourceSchema, issueId: Type.Optional(remoteId), cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })) }),
  object({ type: Type.Literal("linear.workflow.issue"), projectId: id, issueId: remoteId }),
  object({ type: Type.Literal("linear.workflow.preview"), ...LinearScopeSchema.properties, input: LinearWorkflowInputSchema }),
  object({ type: Type.Literal("linear.workflow.read"), operationId: id }),
  object({ type: Type.Literal("linear.workflow.list"), projectId: Type.Optional(id) }),
]);
export type LinearQuery = Static<typeof LinearQuerySchema>;
export const isLinearCommand = (value: unknown): value is LinearCommand => Value.Check(LinearCommandSchema, value);
export const isLinearQuery = (value: unknown): value is LinearQuery => Value.Check(LinearQuerySchema, value);

export interface LinearIdentity { workspaceId: string; workspaceName: string; workspaceKey: string; actorId: string; actorName: string }
export interface LinearTeam { kind: "team"; id: string; name: string; key: string; workspaceId: string; updatedAt: string }
export interface LinearState { kind: "state"; id: string; name: string; type: string; teamId: string; updatedAt: string }
export interface LinearProject {
  kind: "project"; id: string; name: string; description: string; content: string; url: string; updatedAt: string;
  archivedAt: string | null; teamIds: string[]; leadId: string | null; startDate: string | null; targetDate: string | null; priority: number;
}
export interface LinearCycle { kind: "cycle"; id: string; name: string; number: number; teamId: string; startsAt: string; endsAt: string; updatedAt: string }
export interface LinearLabel { kind: "label"; id: string; name: string; teamId: string | null; workspaceId: string; updatedAt: string }
export interface LinearUser { kind: "user"; id: string; name: string; workspaceId: string; active: boolean; updatedAt: string }
export interface LinearIssue {
  kind: "issue"; id: string; identifier: string; url: string; title: string; description: string; updatedAt: string; archivedAt: string | null;
  teamId: string; stateId: string; projectId: string | null; cycleId: string | null; priority: number; estimate: number | null;
  assigneeId: string | null; labelIds: string[]; parentId: string | null; dueDate: string | null;
}
export interface LinearComment { kind: "comment"; id: string; issueId: string; body: string; updatedAt: string; url: string; userId: string | null }
export interface LinearRelation { kind: "relation"; id: string; issueId: string; relatedIssueId: string; type: LinearRelationType; updatedAt: string }
export type LinearEntity = LinearTeam | LinearState | LinearProject | LinearCycle | LinearLabel | LinearUser | LinearIssue | LinearComment | LinearRelation;
export interface LinearBinding {
  profileId: string; projectId: string; root: string; workspaceId: string | null; sessionId: string | null;
  rootDevice: string; rootInode: string; boardRevision: number; teamId: string; credentialGeneration: string; authorityDigest: string;
}
export interface LinearReviewDocument {
  format: "moguri-linear-review"; version: 1; reviewId: string; binding: LinearBinding; identity: LinearIdentity; input: LinearWorkflowInput;
  team: LinearTeam; remote: LinearEntity[]; local: LocalIssue | null; localAfter: LocalIssue | null;
  mutation: { name: string; variables: Record<string, unknown> } | null;
}
export interface LinearPreview {
  document: LinearReviewDocument; digest: string; destructive: boolean; remoteWrite: boolean;
  limits: { pageSize: 50; maxBytes: number }; diagnostic: string;
}
export interface LinearResult {
  format: "moguri-linear-result"; version: 1; operationId: string; action: LinearWorkflowInput["action"];
  remote: LinearEntity[]; deletedIds: string[]; observedIds: string[]; local: LocalIssue | null; acknowledgement: "verified" | "unknown";
}
const status = Type.Union([Type.Literal("running"), Type.Literal("completed"), Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("partial")]);
export const LinearOperationSchema = object({
  version: Type.Literal(1), id, profileId: id, projectId: id, sessionId: Type.Union([id, Type.Null()]),
  workspaceId: Type.Union([id, Type.Null()]), root: Type.String({ minLength: 1, maxLength: 4096 }),
  remoteWorkspaceId: remoteId, teamId: remoteId, actorId: remoteId, credentialGeneration: id,
  action: Type.String({ minLength: 1, maxLength: 40 }), commandId: id, commandDigest: hash,
  reviewDigest: hash, inputDigest: hash, resultDigest: Type.Union([hash, Type.Null()]), jobId: id,
  status, revision: Type.Integer({ minimum: 0 }), createdAt: timestamp, updatedAt: timestamp,
  dispatched: Type.Boolean(), stopRequested: Type.Boolean(), remoteIds: Type.Array(remoteId, { maxItems: 10, uniqueItems: true }),
  diagnostic: Type.Union([Type.String({ maxLength: 4000 }), Type.Null()]),
  acceptance: object({ actor: Type.Literal("user"), commandId: id, commandDigest: hash, reviewDigest: hash }),
});
export type LinearOperation = Static<typeof LinearOperationSchema>;
export interface LinearSnapshot { linearOperations: LinearOperation[] }
export interface LinearEventPayloads { "linear.operation_recorded": { operation: LinearOperation } }

export function projectLinearOperation(previous: LinearOperation | undefined, next: LinearOperation): LinearOperation {
  const corrupt = (): never => { throw new MoguriError("linear_corrupt", "Retained Linear ownership or lifecycle is corrupt. State was preserved.", 409); };
  if (!Value.Check(LinearOperationSchema, next) || next.acceptance.commandId !== next.commandId ||
    next.acceptance.commandDigest !== next.commandDigest || next.acceptance.reviewDigest !== next.reviewDigest ||
    next.inputDigest !== next.reviewDigest || !next.root.startsWith("/") || next.root.includes("\0") ||
    !["issue.create", "issue.update", "issue.move", "issue.archive", "issue.delete", "comment.create", "comment.update", "comment.delete", "project.create", "project.update", "project.archive", "relation.create", "relation.delete", "ticket.sync", "ticket.publish"].includes(next.action) ||
    !Number.isFinite(Date.parse(next.createdAt)) || !Number.isFinite(Date.parse(next.updatedAt)) ||
    next.status === "completed" && (next.resultDigest === null || next.stopRequested) ||
    next.status === "completed" && next.action !== "ticket.sync" && !next.dispatched ||
    ["failed", "cancelled"].includes(next.status) && next.dispatched) corrupt();
  if (!previous) {
    if (next.revision !== 0 || next.status !== "running" || next.dispatched || next.stopRequested || next.remoteIds.length || next.resultDigest !== null) corrupt();
  } else {
    const immutable = ["version", "id", "profileId", "projectId", "sessionId", "workspaceId", "root", "remoteWorkspaceId", "teamId", "actorId",
      "credentialGeneration", "action", "commandId", "commandDigest", "reviewDigest", "inputDigest", "jobId", "createdAt"] as const;
    if (previous.status !== "running" && previous.status !== "partial" ||
      next.revision !== previous.revision + 1 || immutable.some((field) => previous[field] !== next[field]) ||
      JSON.stringify(next.acceptance) !== JSON.stringify(previous.acceptance) ||
      previous.status !== "running" && next.status !== previous.status ||
      previous.dispatched && !next.dispatched || previous.stopRequested && !next.stopRequested ||
      previous.resultDigest !== null && previous.resultDigest !== next.resultDigest ||
      previous.remoteIds.some((id) => !next.remoteIds.includes(id))) corrupt();
  }
  return structuredClone(next);
}

export type LinearResponse =
  | { type: "linear.workflow.catalog"; resource: LinearCatalogResource; identity: LinearIdentity; team: LinearTeam; items: LinearEntity[]; nextCursor: string | null; page: number; limitReached: boolean; credentialGeneration: string }
  | { type: "linear.workflow.issue"; identity: LinearIdentity; team: LinearTeam; issue: LinearIssue; credentialGeneration: string }
  | { type: "linear.workflow.preview"; preview: LinearPreview }
  | { type: "linear.workflow.read"; operation: LinearOperation; document: LinearReviewDocument; result: LinearResult | null; job: CapabilityJob | null }
  | { type: "linear.workflow.list"; operations: LinearOperation[] };
