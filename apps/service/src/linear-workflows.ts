import { randomUUID } from "node:crypto";
import { Value } from "typebox/value";
import { defaultBoard, isRecord, MoguriError, parse, type CommandResult, type EventInput, type IssueBoard, type LocalIssue, type Snapshot } from "../../../packages/protocol/src/index.ts";
import {
  LinearCommandSchema, LinearEntityIdSchema, LinearQuerySchema, LinearWorkflowInputSchema,
  type LinearBinding, type LinearCatalogResource, type LinearCommand, type LinearComment, type LinearCycle, type LinearEntity,
  type LinearIdentity, type LinearIssue, type LinearIssueFields, type LinearLabel, type LinearOperation, type LinearPhaseMapping,
  type LinearPreview, type LinearProject, type LinearProjectFields, type LinearQuery, type LinearRelation, type LinearResponse,
  type LinearResult, type LinearReviewDocument, type LinearScope, type LinearSnapshot, type LinearState, type LinearTeam,
  type LinearUser, type LinearWorkflowInput,
} from "../../../packages/protocol/src/linear-workflows.ts";
import type { CandidateJobLifecycle } from "./candidates.ts";
import { LinearResponseError, ProjectIntegrations, validateLinearCursor, type LinearAccess } from "./project-integrations.ts";
import { sourceRoot, sourceRootSync } from "./repository-source.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import type { ModelAdviceSource } from "../../../packages/protocol/src/questions.ts";
import { digest, EventStore } from "./store.ts";
import type { WorkflowHost } from "./workflow-host.ts";

const PAGE = 50;
const MAX_PAGES = 5;
const PAGE_INFO = "pageInfo { hasNextPage endCursor }";
const TEAM = "id name key updatedAt organization { id }";
const STATE = "id name type updatedAt team { id }";
const PROJECT = `id name description content url updatedAt archivedAt lead { id } startDate targetDate priority teams(first: 50) { nodes { id organization { id } } ${PAGE_INFO} }`;
const CYCLE = "id name number startsAt endsAt updatedAt team { id }";
const LABEL = "id name updatedAt team { id } organization { id }";
const USER = "id name active updatedAt organization { id }";
const ISSUE = `id identifier url title description updatedAt archivedAt team { id } state { id } project { id } cycle { id } priority estimate assignee { id } labels(first: 50) { nodes { id } ${PAGE_INFO} } parent { id } dueDate`;
const COMMENT = "id body updatedAt url user { id } issue { id team { id } }";
const RELATION = "id type updatedAt issue { id team { id } } relatedIssue { id team { id } }";
const SCOPE = `query MoguriLinearScope($team: String!) { viewer { id name organization { id name urlKey } } team(id: $team) { ${TEAM} } }`;
const READS = {
  issue: `query MoguriLinearIssue($id: String!) { issue(id: $id) { ${ISSUE} } }`,
  comment: `query MoguriLinearComment($id: String!) { comment(id: $id) { ${COMMENT} } }`,
  project: `query MoguriLinearProject($id: String!) { project(id: $id) { ${PROJECT} } }`,
  state: `query MoguriLinearState($id: String!) { workflowState(id: $id) { ${STATE} } }`,
  cycle: `query MoguriLinearCycle($id: String!) { cycle(id: $id) { ${CYCLE} } }`,
  label: `query MoguriLinearLabel($id: String!) { issueLabel(id: $id) { ${LABEL} } }`,
  user: `query MoguriLinearMember($team: String!, $id: ID!) { team(id: $team) { id members(first: 2, filter: { id: { eq: $id } }) { nodes { ${USER} } ${PAGE_INFO} } } }`,
  relation: `query MoguriLinearRelation($id: String!) { issueRelation(id: $id) { ${RELATION} } }`,
};
const CATALOGS: Record<LinearCatalogResource, string> = {
  teams: `query MoguriLinearTeams($after: String) { teams(first: 50, after: $after) { nodes { ${TEAM} } ${PAGE_INFO} } }`,
  states: `query MoguriLinearStates($team: String!, $after: String) { team(id: $team) { id states(first: 50, after: $after) { nodes { ${STATE} } ${PAGE_INFO} } } }`,
  projects: `query MoguriLinearProjects($team: String!, $after: String) { team(id: $team) { id projects(first: 50, after: $after) { nodes { ${PROJECT} } ${PAGE_INFO} } } }`,
  cycles: `query MoguriLinearCycles($team: String!, $after: String) { team(id: $team) { id cycles(first: 50, after: $after) { nodes { ${CYCLE} } ${PAGE_INFO} } } }`,
  labels: `query MoguriLinearLabels($team: String!, $after: String) { team(id: $team) { id labels(first: 50, after: $after) { nodes { ${LABEL} } ${PAGE_INFO} } } }`,
  users: `query MoguriLinearUsers($team: String!, $after: String) { team(id: $team) { id members(first: 50, after: $after) { nodes { ${USER} } ${PAGE_INFO} } } }`,
  issues: `query MoguriLinearIssues($team: String!, $after: String) { team(id: $team) { id issues(first: 50, after: $after) { nodes { ${ISSUE} } ${PAGE_INFO} } } }`,
  comments: `query MoguriLinearComments($id: String!, $after: String) { issue(id: $id) { id team { id } comments(first: 50, after: $after) { nodes { ${COMMENT} } ${PAGE_INFO} } } }`,
  relations: `query MoguriLinearRelations($id: String!, $after: String) { issue(id: $id) { id team { id } relations(first: 50, after: $after) { nodes { ${RELATION} } ${PAGE_INFO} } } }`,
};
const MUTATIONS: Record<string, string> = {
  issueCreate: `mutation MoguriLinearIssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${ISSUE} } } }`,
  issueUpdate: `mutation MoguriLinearIssueUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${ISSUE} } } }`,
  issueArchive: `mutation MoguriLinearIssueArchive($id: String!) { issueArchive(id: $id) { success entity { ${ISSUE} } } }`,
  issueUnarchive: `mutation MoguriLinearIssueUnarchive($id: String!) { issueUnarchive(id: $id) { success entity { ${ISSUE} } } }`,
  issueDelete: `mutation MoguriLinearIssueDelete($id: String!) { issueDelete(id: $id, permanentlyDelete: false) { success entity { ${ISSUE} } } }`,
  commentCreate: `mutation MoguriLinearCommentCreate($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { ${COMMENT} } } }`,
  commentUpdate: `mutation MoguriLinearCommentUpdate($id: String!, $input: CommentUpdateInput!) { commentUpdate(id: $id, input: $input) { success comment { ${COMMENT} } } }`,
  commentDelete: "mutation MoguriLinearCommentDelete($id: String!) { commentDelete(id: $id) { success entityId } }",
  projectCreate: `mutation MoguriLinearProjectCreate($input: ProjectCreateInput!) { projectCreate(input: $input) { success project { ${PROJECT} } } }`,
  projectUpdate: `mutation MoguriLinearProjectUpdate($id: String!, $input: ProjectUpdateInput!) { projectUpdate(id: $id, input: $input) { success project { ${PROJECT} } } }`,
  projectArchive: `mutation MoguriLinearProjectArchive($id: String!) { projectArchive(id: $id) { success entity { ${PROJECT} } } }`,
  projectUnarchive: `mutation MoguriLinearProjectUnarchive($id: String!) { projectUnarchive(id: $id) { success entity { ${PROJECT} } } }`,
  issueRelationCreate: `mutation MoguriLinearRelationCreate($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success issueRelation { ${RELATION} } } }`,
  issueRelationDelete: "mutation MoguriLinearRelationDelete($id: String!) { issueRelationDelete(id: $id) { success entityId } }",
};

function invalid(): never { throw new MoguriError("linear_response", "Linear returned an invalid, incomplete or out-of-scope entity. No complete result was acknowledged.", 502); }
function record(value: unknown): Record<string, unknown> { if (!isRecord(value)) invalid(); return value; }
function text(value: unknown, max = 160, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || value.includes("\0")) invalid();
  return value;
}
function entityId(value: unknown): string { if (!Value.Check(LinearEntityIdSchema, value)) invalid(); return value; }
function time(value: unknown): string {
  const result = text(value, 40);
  if (!/^\d{4}-\d\d-\d\dT/.test(result) || !Number.isFinite(Date.parse(result))) invalid();
  return result;
}
function nullableTime(value: unknown): string | null { return value === null ? null : time(value); }
function day(value: unknown): string | null {
  if (value === null) return null;
  const result = text(value, 10);
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (!/^\d{4}-\d\d-\d\d$/.test(result) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) invalid();
  return result;
}
function ref(value: unknown): string | null { return value === null ? null : entityId(record(value).id); }
function link(value: unknown, workspaceKey: string, comment = false): string {
  const input = text(value, 2048);
  let url: URL;
  try { url = new URL(input); } catch { invalid(); }
  if (url.protocol !== "https:" || url.host !== "linear.app" || url.username || url.password || url.search ||
    url.hash && (!comment || !/^#[A-Za-z0-9_-]{1,128}$/.test(url.hash)) ||
    url.pathname.split("/")[1] !== workspaceKey || /[\\\u0000-\u0020]/.test(input) || url.href !== input) invalid();
  return url.href;
}
function connection(value: unknown, after?: string, max = PAGE): { nodes: unknown[]; cursor: string | null } {
  const data = record(value), page = record(data.pageInfo);
  if (!Array.isArray(data.nodes) || data.nodes.length > max || typeof page.hasNextPage !== "boolean" ||
    !(page.endCursor === null || typeof page.endCursor === "string") || page.hasNextPage && (!page.endCursor || page.endCursor === after)) invalid();
  if (page.endCursor !== null) validateLinearCursor(page.endCursor);
  const ids = new Set<string>();
  for (const item of data.nodes) {
    const id = entityId(record(item).id);
    if (ids.has(id)) invalid();
    ids.add(id);
  }
  return { nodes: data.nodes, cursor: page.hasNextPage ? String(page.endCursor) : null };
}
function complete(value: unknown): unknown[] { const page = connection(value); if (page.cursor) invalid(); return page.nodes; }
function workspace(value: unknown, identity: LinearIdentity): void { if (entityId(record(value).id) !== identity.workspaceId) invalid(); }
function team(value: unknown, expected: string): void { if (entityId(record(value).id) !== expected) invalid(); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function parseTeam(value: unknown, identity: LinearIdentity): LinearTeam {
  const data = record(value); workspace(data.organization, identity);
  return { kind: "team", id: entityId(data.id), name: text(data.name), key: text(data.key, 40), workspaceId: identity.workspaceId, updatedAt: time(data.updatedAt) };
}
function parseState(value: unknown, teamId: string): LinearState {
  const data = record(value); team(data.team, teamId);
  return { kind: "state", id: entityId(data.id), name: text(data.name), type: text(data.type, 40), teamId, updatedAt: time(data.updatedAt) };
}
function parseProject(value: unknown, identity: LinearIdentity, teamId: string): LinearProject {
  const data = record(value);
  const teamIds = complete(data.teams).map((entry) => { const current = record(entry); workspace(current.organization, identity); return entityId(current.id); }).sort();
  if (!teamIds.includes(teamId) || !Number.isInteger(data.priority) || Number(data.priority) < 0 || Number(data.priority) > 4) invalid();
  const url = link(data.url, identity.workspaceKey), parts = new URL(url).pathname.split("/");
  if (parts[2] !== "project" || !parts[3]) invalid();
  return { kind: "project", id: entityId(data.id), name: text(data.name), description: text(data.description, 255, true), content: data.content === null ? "" : text(data.content, 64 * 1024, true),
    url, updatedAt: time(data.updatedAt), archivedAt: nullableTime(data.archivedAt),
    teamIds, leadId: ref(data.lead), startDate: day(data.startDate), targetDate: day(data.targetDate), priority: Number(data.priority) };
}
function parseCycle(value: unknown, teamId: string): LinearCycle {
  const data = record(value); team(data.team, teamId);
  if (!Number.isSafeInteger(data.number) || Number(data.number) < 0) invalid();
  return { kind: "cycle", id: entityId(data.id), name: data.name === null ? `Cycle ${data.number}` : text(data.name), number: Number(data.number), teamId,
    startsAt: time(data.startsAt), endsAt: time(data.endsAt), updatedAt: time(data.updatedAt) };
}
function parseLabel(value: unknown, identity: LinearIdentity, teamId: string): LinearLabel {
  const data = record(value); workspace(data.organization, identity);
  const owner = ref(data.team); if (owner !== null && owner !== teamId) invalid();
  return { kind: "label", id: entityId(data.id), name: text(data.name), teamId: owner, workspaceId: identity.workspaceId, updatedAt: time(data.updatedAt) };
}
function parseUser(value: unknown, identity: LinearIdentity): LinearUser {
  const data = record(value); workspace(data.organization, identity);
  if (typeof data.active !== "boolean") invalid();
  return { kind: "user", id: entityId(data.id), name: text(data.name), workspaceId: identity.workspaceId, active: data.active, updatedAt: time(data.updatedAt) };
}
function parseIssue(value: unknown, identity: LinearIdentity, teamId: string): LinearIssue {
  const data = record(value); team(data.team, teamId);
  const priority = Number(data.priority), estimate = data.estimate === null ? null : Number(data.estimate);
  if (typeof data.priority !== "number" || !Number.isInteger(priority) || priority < 0 || priority > 4 ||
    data.estimate !== null && (typeof data.estimate !== "number" || !Number.isFinite(estimate) || estimate! < 0)) invalid();
  const identifier = text(data.identifier, 80), url = link(data.url, identity.workspaceKey);
  if (new URL(url).pathname.split("/")[2] !== "issue" || new URL(url).pathname.split("/")[3] !== identifier) invalid();
  return { kind: "issue", id: entityId(data.id), identifier, url,
    title: text(data.title, 512), description: data.description === null ? "" : text(data.description, 64 * 1024, true),
    updatedAt: time(data.updatedAt), archivedAt: nullableTime(data.archivedAt), teamId, stateId: entityId(record(data.state).id),
    projectId: ref(data.project), cycleId: ref(data.cycle), priority, estimate, assigneeId: ref(data.assignee),
    labelIds: complete(data.labels).map((entry) => entityId(record(entry).id)).sort(), parentId: ref(data.parent), dueDate: day(data.dueDate) };
}
function parseComment(value: unknown, identity: LinearIdentity, teamId: string, issueId?: string): LinearComment {
  const data = record(value), issue = record(data.issue); team(issue.team, teamId);
  const owner = entityId(issue.id); if (issueId && owner !== issueId) invalid();
  const url = link(data.url, identity.workspaceKey, true), parts = new URL(url).pathname.split("/");
  if (parts[2] !== "issue" || !parts[3]) invalid();
  return { kind: "comment", id: entityId(data.id), issueId: owner, body: text(data.body, 64 * 1024, true), updatedAt: time(data.updatedAt),
    url, userId: ref(data.user) };
}
function parseRelation(value: unknown, teamId: string, issueId?: string): LinearRelation {
  const data = record(value), issue = record(data.issue), related = record(data.relatedIssue);
  team(issue.team, teamId); team(related.team, teamId);
  const owner = entityId(issue.id), target = entityId(related.id);
  if (issueId && issueId !== owner && issueId !== target || !["blocks", "duplicate", "related"].includes(String(data.type)) || owner === target) invalid();
  return { kind: "relation", id: entityId(data.id), issueId: owner, relatedIssueId: target, type: data.type as LinearRelation["type"], updatedAt: time(data.updatedAt) };
}
type Prepared = { preview: LinearPreview; access: LinearAccess; current(): void };
interface Context {
  board: IssueBoard; binding: LinearBinding; access: LinearAccess; identity: LinearIdentity; team: LinearTeam;
  signal: AbortSignal; current(): void; request(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>>;
}
export interface LinearWorkflowOptions { reviewTtlMs?: number; maxReviews?: number }

export class LinearWorkflows {
  private readonly reviews = new Map<string, { document: LinearReviewDocument; at: number }>();
  private readonly cursors = new Map<string, { scope: string; page: number; seen: string[]; ids: string[] }>();
  private readonly active = new Map<string, AbortController>();
  private closed = false;
  constructor(private readonly store: EventStore, private readonly host: WorkflowHost, private readonly integrations: ProjectIntegrations, private readonly options: LinearWorkflowOptions = {}) {
    const ttl = options.reviewTtlMs ?? 10 * 60_000, count = options.maxReviews ?? 100;
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 10 * 60_000 || !Number.isSafeInteger(count) || count < 1 || count > 100) {
      throw new MoguriError("linear_limits", "Linear reviews require a bounded positive lifetime (at most ten minutes) and count (at most 100).");
    }
  }
  private operations(): LinearOperation[] { return (this.host.snapshot() as Snapshot & Partial<LinearSnapshot>).linearOperations ?? []; }
  private operation(id: string): LinearOperation {
    const value = this.operations().find((entry) => entry.id === id && entry.profileId === this.host.snapshot().profileId);
    if (!value) throw new MoguriError("linear_operation_missing", "The retained Linear operation is missing or outside this immutable profile.", 404);
    return value;
  }
  private event(operation: LinearOperation): EventInput {
    return { event_type: "linear.operation_recorded", profile_id: operation.profileId, project_id: operation.projectId, session_id: operation.sessionId, payload: { operation } };
  }
  private update(id: string, changes: Partial<LinearOperation>): void {
    const operation = this.operation(id);
    this.host.commit([this.event({ ...operation, ...changes, revision: operation.revision + 1, updatedAt: new Date().toISOString() })]);
  }
  private board(projectId: string): IssueBoard {
    this.host.project(projectId);
    const board = this.host.snapshot().boards.find((entry) => entry.projectId === projectId) ?? defaultBoard(projectId);
    if (!board.linear.enabled || !board.linear.teamId) throw new MoguriError("linear_disabled", "Linear is optional and off by default. Explicitly enable one team on this project board before any workflow request.", 409);
    if (!Value.Check(LinearEntityIdSchema, board.linear.teamId)) throw new MoguriError("linear_team", "Full Linear workflows require the selected team's exact UUID, not an alias.");
    return board;
  }
  private authority(scope: LinearScope, write: boolean): { workspaceId: string | null; digest: string; root: string } {
    const snapshot = this.host.snapshot(), session = scope.sessionId ? snapshot.sessions.find((entry) => entry.id === scope.sessionId) : undefined;
    if (this.closed || this.host.closing(scope.projectId)) throw new MoguriError("linear_closed", "This project/service is closing; no new Linear work was authorized.", 409);
    if (!snapshot.policy.allowedEnvs.includes("Local")) throw new MoguriError("linear_env", "Linear workflows use the explicitly disclosed Local control-plane connection. Current policy excludes Local; no Remote credential fallback was used.", 403);
    if (scope.sessionId && (!session || session.projectId !== scope.projectId || session.controls.env !== "Local" || session.status === "archived" ||
      write && (session.kind !== "agent" || session.mode !== "agent" || session.pendingMode === "read-only"))) {
      throw new MoguriError("linear_scope", "Choose the actual Local project session; read-only and side sessions cannot mutate Linear or local tickets.", 403);
    }
    const workspaceId = session?.workspaceId ?? null, project = this.host.project(scope.projectId, workspaceId ?? undefined);
    const configuration = this.host.configuration(scope.projectId);
    return { workspaceId, root: project.path, digest: digest(canonical({
      profileId: snapshot.profileId, policy: snapshot.policy, permissionRevision: snapshot.settings.permissionRevision,
      configuration, project: { id: project.id, path: project.path },
      session: session ? { id: session.id, workspaceId: session.workspaceId, env: session.controls.env, mode: session.mode, pendingMode: session.pendingMode, kind: session.kind, status: session.status === "archived" ? "archived" : "active" } : null,
    })) };
  }
  private async context(scope: LinearScope, signal: AbortSignal, write: boolean): Promise<Context> {
    const board = this.board(scope.projectId), authority = this.authority(scope, write), profileId = this.host.snapshot().profileId;
    await this.host.assertRoot(scope.projectId, authority.workspaceId ?? undefined, signal);
    const root = await sourceRoot(authority.root), access = await this.integrations.linearAccess(signal, scope.projectId);
    const requested = AbortSignal.any([signal, access.signal]);
    const current = () => {
      requested.throwIfAborted();
      const latest = this.board(scope.projectId), next = this.authority(scope, write), actualRoot = sourceRootSync(authority.root);
      if (profileId !== this.host.snapshot().profileId || board.revision !== latest.revision || board.linear.teamId !== latest.linear.teamId ||
        authority.digest !== next.digest || authority.root !== next.root || actualRoot.device !== root.device || actualRoot.inode !== root.inode || !access.current()) {
        throw new MoguriError("linear_review_stale", "The exact profile, root, team, board, credential or policy changed. Review again; no stale request was authorized.", 409);
      }
    };
    const request = async (query: string, variables: Record<string, unknown>) => {
      current(); const result = await access.request(query, variables, requested); current(); return result;
    };
    const data = await request(SCOPE, { team: board.linear.teamId }), viewer = record(data.viewer), organization = record(viewer.organization);
    const identity: LinearIdentity = { workspaceId: entityId(organization.id), workspaceName: text(organization.name), workspaceKey: text(organization.urlKey, 100), actorId: entityId(viewer.id), actorName: text(viewer.name) };
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(identity.workspaceKey)) invalid();
    const selected = parseTeam(data.team, identity); if (selected.id !== board.linear.teamId) invalid();
    return {
      board, access, identity, team: selected, signal: requested, current, request,
      binding: { profileId, projectId: scope.projectId, root: authority.root, rootDevice: root.device, rootInode: root.inode,
        workspaceId: authority.workspaceId, sessionId: scope.sessionId ?? null, boardRevision: board.revision,
        teamId: board.linear.teamId, credentialGeneration: access.generation, authorityDigest: authority.digest },
    };
  }
  private async read(kind: keyof typeof READS, id: string, context: Context, issueId?: string): Promise<LinearEntity> {
    const result = await context.request(READS[kind], { id, team: context.team.id });
    let value: LinearEntity;
    switch (kind) {
      case "issue": value = parseIssue(result.issue, context.identity, context.team.id); break;
      case "comment": value = parseComment(result.comment, context.identity, context.team.id, issueId); break;
      case "project": value = parseProject(result.project, context.identity, context.team.id); break;
      case "state": value = parseState(result.workflowState, context.team.id); break;
      case "cycle": value = parseCycle(result.cycle, context.team.id); break;
      case "label": value = parseLabel(result.issueLabel, context.identity, context.team.id); break;
      case "relation": value = parseRelation(result.issueRelation, context.team.id, issueId); break;
      case "user": {
        const owner = record(result.team); team(owner, context.team.id);
        const page = connection(owner.members, undefined, 2);
        if (page.cursor || page.nodes.length !== 1) invalid();
        value = parseUser(page.nodes[0], context.identity);
        if (!value.active) throw new MoguriError("linear_member", "Select an active member of the reviewed Linear team.", 409);
        break;
      }
    }
    if (value.id !== id) invalid();
    return value;
  }
  private async selections(fields: LinearIssueFields | LinearProjectFields, context: Context, remote: LinearEntity[]): Promise<void> {
    const selected = fields as LinearIssueFields & LinearProjectFields;
    for (const date of [selected.dueDate, selected.startDate, selected.targetDate]) if (date !== undefined) day(date);
    if (selected.title !== undefined && !selected.title.trim() || selected.name !== undefined && !selected.name.trim()) throw new MoguriError("linear_title", "Use a non-empty issue title or project name.");
    const refs = [
      ["state", selected.stateId], ["project", selected.projectId], ["cycle", selected.cycleId],
      ["user", selected.assigneeId], ["user", selected.leadId], ["issue", selected.parentId],
      ...(selected.labelIds ?? []).map((id) => ["label", id]),
    ] as [keyof typeof READS, string | null | undefined][];
    for (const [kind, id] of refs) if (id && !remote.some((entry) => entry.id === id)) remote.push(await this.read(kind, id, context));
    if (selected.projectId && remote.some((entry) => entry.id === selected.projectId && entry.kind === "project" && entry.archivedAt)) throw new MoguriError("linear_archived", "An archived Linear project cannot be selected for a new issue update.", 409);
  }
  private mapping(mapping: LinearPhaseMapping, board: IssueBoard): void {
    if (new Set(mapping.map((entry) => entry.phaseId)).size !== mapping.length || new Set(mapping.map((entry) => entry.stateId)).size !== mapping.length ||
      mapping.some((entry) => !board.columns.some((column) => column.id === entry.phaseId))) throw new MoguriError("linear_mapping", "Review an unambiguous one-to-one mapping from existing local phases to this team's workflow states.");
  }
  private local(id: string, revision: number, projectId: string): LocalIssue {
    const issue = this.host.snapshot().issues.find((entry) => entry.id === id && entry.projectId === projectId);
    if (!issue || issue.revision !== revision) throw new MoguriError("linear_local_conflict", "The local ticket was removed or changed. Its concurrent edits were preserved; preview its exact current revision.", 409);
    return structuredClone(issue);
  }
  private async prepare(scope: LinearScope, input: LinearWorkflowInput, signal: AbortSignal, reviewId: string = randomUUID()): Promise<Prepared> {
    input = structuredClone(parse(LinearWorkflowInputSchema, input));
    const context = await this.context(scope, signal, true), remote: LinearEntity[] = [];
    context.access.protect(input);
    let local: LocalIssue | null = null, localAfter: LocalIssue | null = null;
    let mutation: LinearReviewDocument["mutation"] = null;
    const readIssue = async (id: string): Promise<LinearIssue> => { const issue = await this.read("issue", id, context) as LinearIssue; remote.push(issue); return issue; };
    const setMutation = (name: string, variables: Record<string, unknown>) => { mutation = { name, variables }; };
    if ("issueId" in input) await readIssue(input.issueId);
    switch (input.action) {
      case "issue.create":
        await this.selections(input.fields, context, remote);
        setMutation("issueCreate", { input: { ...input.fields, teamId: context.team.id, id: reviewId } }); break;
      case "issue.update":
        if (!Object.keys(input.fields).length) throw new MoguriError("linear_fields", "Select at least one exact field to update.");
        if (input.fields.parentId === input.issueId) throw new MoguriError("linear_parent", "An issue cannot be its own parent.");
        await this.selections(input.fields, context, remote);
        setMutation("issueUpdate", { id: input.issueId, input: input.fields }); break;
      case "issue.move":
        await this.selections({ stateId: input.stateId }, context, remote);
        setMutation("issueUpdate", { id: input.issueId, input: { stateId: input.stateId } }); break;
      case "issue.archive": setMutation(input.archived ? "issueArchive" : "issueUnarchive", { id: input.issueId }); break;
      case "issue.delete": setMutation("issueDelete", { id: input.issueId }); break;
      case "comment.create":
        if (!input.body.trim()) throw new MoguriError("linear_comment", "Use a non-empty comment body.");
        setMutation("commentCreate", { input: { issueId: input.issueId, body: input.body, id: reviewId } }); break;
      case "comment.update":
      case "comment.delete": {
        const comment = await this.read("comment", input.commentId, context, input.issueId) as LinearComment; remote.push(comment);
        if (comment.userId !== context.identity.actorId) throw new MoguriError("linear_comment_owner", "Only the actual signed-in author's comments can be edited or deleted by this workflow.", 403);
        if (input.action === "comment.update") {
          if (!input.body.trim()) throw new MoguriError("linear_comment", "Use a non-empty comment body.");
          setMutation("commentUpdate", { id: input.commentId, input: { body: input.body } });
        } else setMutation("commentDelete", { id: input.commentId });
        break;
      }
      case "project.create":
        await this.selections(input.fields, context, remote);
        setMutation("projectCreate", { input: { ...input.fields, teamIds: [context.team.id], id: reviewId } }); break;
      case "project.update":
      case "project.archive": {
        const project = await this.read("project", input.remoteProjectId, context) as LinearProject; remote.push(project);
        if (project.teamIds.length !== 1) throw new MoguriError("linear_project_teams", "This project also affects other teams. This one-team workflow will not silently edit or archive it.", 409);
        if (input.action === "project.update") {
          if (!Object.keys(input.fields).length) throw new MoguriError("linear_fields", "Select at least one exact project field to update.");
          await this.selections(input.fields, context, remote);
          setMutation("projectUpdate", { id: input.remoteProjectId, input: input.fields });
        } else setMutation(input.archived ? "projectArchive" : "projectUnarchive", { id: input.remoteProjectId });
        break;
      }
      case "relation.create":
        if (input.relatedIssueId === input.issueId) throw new MoguriError("linear_relation", "Select two distinct issues in the explicitly enabled team.");
        await readIssue(input.relatedIssueId);
        setMutation("issueRelationCreate", { input: { id: reviewId, issueId: input.issueId, relatedIssueId: input.relatedIssueId, type: input.relationType } }); break;
      case "relation.delete":
        remote.push(await this.read("relation", input.relationId, context, input.issueId));
        setMutation("issueRelationDelete", { id: input.relationId }); break;
      case "ticket.publish":
      case "ticket.sync": {
        local = this.local(input.localIssueId, input.expectedLocalRevision, scope.projectId);
        this.mapping(input.mapping, context.board);
        for (const entry of input.mapping) if (!remote.some((value) => value.id === entry.stateId)) remote.push(await this.read("state", entry.stateId, context));
        const state = input.mapping.find((entry) => entry.phaseId === local!.phaseId);
        if (input.action === "ticket.publish") {
          if (local.linear) throw new MoguriError("linear_linked", "This local ticket already has original Linear provenance. Explicitly preview pull or push instead of publishing a duplicate.", 409);
          if (!state) throw new MoguriError("linear_mapping", "Map the local ticket's current phase explicitly before publishing.");
          await this.selections(input.fields ?? {}, context, remote);
          setMutation("issueCreate", { input: { ...input.fields, title: local.title, description: local.body, stateId: state.stateId, teamId: context.team.id, id: reviewId } });
        } else {
          if (!local.linear) throw new MoguriError("linear_unlinked", "Import or explicitly publish this local ticket first. No remote issue was guessed.");
          const issue = await readIssue(local.linear.id);
          if (issue.url !== local.linear.url || issue.identifier !== local.linear.identifier) throw new MoguriError("linear_provenance", "The linked issue no longer matches this ticket's original canonical provenance.", 409);
          if (input.direction === "push") {
            if (!state) throw new MoguriError("linear_mapping", "Map the local ticket's current phase explicitly before pushing.");
            setMutation("issueUpdate", { id: issue.id, input: { title: local.title, description: local.body, stateId: state.stateId } });
          } else {
            const phase = input.mapping.find((entry) => entry.stateId === issue.stateId);
            if (!phase) throw new MoguriError("linear_mapping", "Map the remote issue's exact current workflow state to a local phase before pulling.");
            if (issue.title.length > 160) throw new MoguriError("linear_local_limit", "The remote title exceeds the local ticket bound. It was not silently truncated or applied.", 409);
            localAfter = { ...local, title: issue.title, body: issue.description, phaseId: phase.phaseId, archived: Boolean(issue.archivedAt),
              revision: local.revision + 1, linear: { ...local.linear, updatedAt: issue.updatedAt } };
          }
        }
        break;
      }
    }
    context.current();
    if (local) this.local(local.id, local.revision, scope.projectId);
    const document: LinearReviewDocument = { format: "moguri-linear-review", version: 1, reviewId, binding: context.binding, identity: context.identity,
      input: structuredClone(input), team: context.team, remote: remote.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)), local, localAfter, mutation };
    const bytes = canonical(document);
    if (Buffer.byteLength(bytes) > 512 * 1024) throw new MoguriError("linear_review_limit", "The complete Linear review exceeds 512 KiB. Nothing was truncated or authorized.");
    return {
      access: context.access, current: () => { context.current(); if (local) this.local(local.id, local.revision, scope.projectId); },
      preview: { document, digest: digest(bytes), destructive: input.action.endsWith(".delete") || input.action.endsWith(".archive"), remoteWrite: mutation !== null,
        limits: { pageSize: 50, maxBytes: 2 * 1024 * 1024 },
        diagnostic: "Only this exact user-reviewed Local/profile/team/account operation is authorized. No automatic export, polling, webhook, OAuth completion or credential fallback. Linear has no conditional updatedAt mutation: bases are re-read immediately before dispatch, not an atomic remote compare-and-swap." },
    };
  }
  private remember(preview: LinearPreview): void {
    for (const [hash, value] of this.reviews) if (Date.now() - value.at > (this.options.reviewTtlMs ?? 10 * 60_000)) this.reviews.delete(hash);
    while (this.reviews.size >= (this.options.maxReviews ?? 100)) this.reviews.delete(this.reviews.keys().next().value!);
    this.reviews.set(preview.digest, { document: structuredClone(preview.document), at: Date.now() });
  }
  private async catalog(query: Extract<LinearQuery, { type: "linear.workflow.catalog" }>): Promise<LinearResponse> {
    validateLinearCursor(query.cursor);
    const context = await this.context({ projectId: query.projectId }, AbortSignal.timeout(30_000), false);
    const scopedIssue = query.resource === "comments" || query.resource === "relations";
    if (scopedIssue !== Boolean(query.issueId)) throw new MoguriError("linear_catalog", "Only comment/relation collections take an exact issue UUID.");
    const scope = digest(canonical({ binding: context.binding, identity: context.identity, resource: query.resource, issueId: query.issueId ?? null }));
    const prior = query.cursor ? this.cursors.get(`${scope}:${query.cursor}`) : undefined;
    if (query.cursor && (!prior || prior.scope !== scope)) throw new MoguriError("linear_cursor_stale", "This cursor was not returned for this exact profile/team/account/collection. Start an explicit first-page read.", 409);
    const result = await context.request(CATALOGS[query.resource], { team: context.team.id, after: query.cursor ?? null, id: query.issueId ?? null });
    let raw: unknown;
    if (query.resource === "teams") raw = result.teams;
    else if (scopedIssue) {
      const owner = record(result.issue); team(owner.team, context.team.id); if (owner.id !== query.issueId) invalid();
      raw = owner[query.resource];
    } else {
      const owner = record(result.team); team(owner, context.team.id);
      raw = owner[query.resource === "users" ? "members" : query.resource];
    }
    const page = connection(raw, query.cursor), ids = [...(prior?.ids ?? [])], seen = [...(prior?.seen ?? [])];
    const items = page.nodes.map((node): LinearEntity => {
      let entity: LinearEntity;
      switch (query.resource) {
        case "teams": entity = parseTeam(node, context.identity); break;
        case "states": entity = parseState(node, context.team.id); break;
        case "projects": entity = parseProject(node, context.identity, context.team.id); break;
        case "cycles": entity = parseCycle(node, context.team.id); break;
        case "labels": entity = parseLabel(node, context.identity, context.team.id); break;
        case "users": entity = parseUser(node, context.identity); break;
        case "issues": entity = parseIssue(node, context.identity, context.team.id); break;
        case "comments": entity = parseComment(node, context.identity, context.team.id, query.issueId); break;
        case "relations": entity = parseRelation(node, context.team.id, query.issueId); break;
      }
      if (ids.includes(entity.id)) invalid();
      ids.push(entity.id); return entity;
    });
    const number = (prior?.page ?? 0) + 1, limitReached = number >= MAX_PAGES && page.cursor !== null;
    if (page.cursor && seen.includes(page.cursor)) invalid();
    if (page.cursor && !limitReached) {
      seen.push(page.cursor);
      while (this.cursors.size >= 500) this.cursors.delete(this.cursors.keys().next().value!);
      this.cursors.set(`${scope}:${page.cursor}`, { scope, page: number, seen, ids });
    }
    context.current();
    return { type: query.type, resource: query.resource, identity: context.identity, team: context.team, items,
      nextCursor: limitReached ? null : page.cursor, page: number, limitReached, credentialGeneration: context.access.generation };
  }
  async query(query: LinearQuery): Promise<LinearResponse> {
    query = structuredClone(parse(LinearQuerySchema, query));
    switch (query.type) {
      case "linear.workflow.catalog": return this.catalog(query);
      case "linear.workflow.issue": {
        const context = await this.context({ projectId: query.projectId }, AbortSignal.timeout(30_000), false);
        const issue = await this.read("issue", query.issueId, context) as LinearIssue;
        return { type: query.type, identity: context.identity, team: context.team, issue, credentialGeneration: context.access.generation };
      }
      case "linear.workflow.preview": {
        const prepared = await this.prepare(query, query.input, AbortSignal.timeout(60_000)); this.remember(prepared.preview);
        return { type: query.type, preview: prepared.preview };
      }
      case "linear.workflow.list": return { type: query.type, operations: this.operations().filter((entry) => query.projectId === undefined || entry.projectId === query.projectId) };
      case "linear.workflow.read": {
        const operation = this.operation(query.operationId);
        const document = JSON.parse(this.store.blob(operation.inputDigest)) as LinearReviewDocument;
        if (document.format !== "moguri-linear-review" || document.version !== 1 || digest(canonical(document)) !== operation.reviewDigest ||
          !Value.Check(LinearWorkflowInputSchema, document.input) ||
          document.binding.profileId !== operation.profileId || document.binding.projectId !== operation.projectId ||
          document.binding.sessionId !== operation.sessionId || document.binding.workspaceId !== operation.workspaceId || document.binding.root !== operation.root ||
          document.binding.credentialGeneration !== operation.credentialGeneration || document.binding.teamId !== operation.teamId ||
          document.identity.workspaceId !== operation.remoteWorkspaceId || document.identity.actorId !== operation.actorId ||
          document.input.action !== operation.action) throw new MoguriError("linear_retained_corrupt", "The original Linear input snapshot or ownership is invalid. State was preserved.", 409);
        const result = operation.resultDigest ? JSON.parse(this.store.blob(operation.resultDigest)) as LinearResult : null;
        if (result && (result.format !== "moguri-linear-result" || result.version !== 1 || result.operationId !== operation.id || result.action !== operation.action)) throw new MoguriError("linear_retained_corrupt", "The retained Linear receipt does not match its original intent.", 409);
        return { type: query.type, operation, document, result, job: this.host.snapshot().jobs.find((entry) => entry.id === operation.jobId) ?? null };
      }
    }
  }
  private observed(data: Record<string, unknown> | null, mutation: string): string[] {
    if (!data || !isRecord(data[mutation])) return [];
    const payload = data[mutation], ids: string[] = [];
    for (const field of ["issue", "entity", "comment", "project", "issueRelation"]) {
      const value = payload[field];
      if (isRecord(value) && Value.Check(LinearEntityIdSchema, value.id) && !ids.includes(value.id)) ids.push(value.id);
    }
    return ids;
  }
  private receipt(id: string, document: LinearReviewDocument, data: Record<string, unknown>): LinearResult {
    const mutation = document.mutation!, payload = record(data[mutation.name]);
    if (payload.success !== true) throw new MoguriError("linear_rejected", "Linear did not acknowledge the exact mutation as successful. Its dispatched outcome remains partial.", 502);
    const result: LinearResult = { format: "moguri-linear-result", version: 1, operationId: id, action: document.input.action, remote: [], deletedIds: [],
      observedIds: this.observed(data, mutation.name), local: null, acknowledgement: "verified" };
    const variables = mutation.variables, expectedId = typeof variables.id === "string" ? variables.id : entityId(record(variables.input).id);
    let entity: LinearEntity | undefined;
    if (mutation.name.startsWith("issueRelation") && mutation.name !== "issueRelationDelete") {
      entity = parseRelation(payload.issueRelation, document.team.id);
      const input = record(variables.input);
      if (entity.issueId !== input.issueId || entity.relatedIssueId !== input.relatedIssueId || entity.type !== input.type) invalid();
    } else if (mutation.name.startsWith("comment") && mutation.name !== "commentDelete") {
      entity = parseComment(payload.comment, document.identity, document.team.id, "issueId" in document.input ? document.input.issueId : undefined);
      if ("body" in document.input && entity.body !== document.input.body) invalid();
    } else if (mutation.name.startsWith("project")) {
      entity = parseProject(payload.project ?? payload.entity, document.identity, document.team.id);
      if (entity.teamIds.length !== 1) invalid();
      if (mutation.name === "projectArchive" && !entity.archivedAt || mutation.name === "projectUnarchive" && entity.archivedAt) invalid();
      if (mutation.name === "projectCreate" || mutation.name === "projectUpdate") this.fieldsAcknowledged(record(variables.input), entity);
    } else if (mutation.name === "issueDelete" && payload.entity === null) {
      // Linear's delete payload permits a null entity after a successful tombstone.
    } else if (!["commentDelete", "issueRelationDelete"].includes(mutation.name)) {
      entity = parseIssue(payload.issue ?? payload.entity, document.identity, document.team.id);
      if (mutation.name === "issueArchive" && !entity.archivedAt || mutation.name === "issueUnarchive" && entity.archivedAt) invalid();
      if (mutation.name === "issueCreate" || mutation.name === "issueUpdate") this.fieldsAcknowledged(record(variables.input), entity);
    }
    if (entity) { if (entity.id !== expectedId) invalid(); result.remote.push(entity); }
    if (["commentDelete", "issueRelationDelete"].includes(mutation.name) && entityId(payload.entityId) !== expectedId) invalid();
    if (["issueDelete", "commentDelete", "issueRelationDelete"].includes(mutation.name)) result.deletedIds.push(expectedId);
    if (document.local && entity?.kind === "issue") {
      const local = document.local;
      result.local = { ...local, revision: local.revision + 1,
        linear: local.linear ? { ...local.linear, updatedAt: entity.updatedAt } : { id: entity.id, identifier: entity.identifier, url: entity.url, updatedAt: entity.updatedAt } };
      if (local.linear && (entity.id !== local.linear.id || entity.url !== local.linear.url || entity.identifier !== local.linear.identifier)) invalid();
    }
    return result;
  }
  private fieldsAcknowledged(input: Record<string, unknown>, entity: LinearIssue | LinearProject): void {
    for (const [key, value] of Object.entries(input)) {
      if (["id", "teamId", "teamIds"].includes(key)) continue;
      const actual = (entity as unknown as Record<string, unknown>)[key];
      if (key === "labelIds" && Array.isArray(value)) { if (canonical([...value].sort()) !== canonical(actual)) invalid(); }
      else if (canonical(value) !== canonical(actual)) invalid();
    }
  }
  private retainResult(id: string, result: LinearResult): void {
    const record = this.operation(id);
    if (record.resultDigest) return;
    this.update(id, { resultDigest: this.store.putBlob(JSON.stringify(result)), remoteIds: [...new Set([...record.remoteIds, ...result.observedIds, ...result.remote.map((entry) => entry.id), ...result.deletedIds])] });
  }
  private lifecycle(id: string, prepared: Prepared): CandidateJobLifecycle {
    return {
      completed: (_result, hash) => {
        const operation = this.operation(id);
        prepared.current();
        if (operation.status !== "running" || operation.stopRequested || operation.resultDigest && operation.resultDigest !== hash) throw new MoguriError("linear_partial", "Linear result/ownership changed before terminal acknowledgement. Inspect the original retained result; nothing was replayed.", 409);
        const result = JSON.parse(this.store.blob(hash)) as LinearResult;
        if (result.acknowledgement !== "verified" || result.operationId !== id) throw new MoguriError("linear_partial", "The complete original Linear result was not verified.", 409);
        const events: EventInput[] = [];
        if (result.local) {
          this.local(result.local.id, result.local.revision - 1, operation.projectId);
          events.push({ event_type: "issue.saved", profile_id: operation.profileId, project_id: operation.projectId,
            payload: { issue: { ...result.local, updatedAt: new Date().toISOString() }, actor: "linear" } });
        }
        return [...events, this.event({ ...operation, revision: operation.revision + 1, updatedAt: new Date().toISOString(), status: "completed", resultDigest: hash,
          remoteIds: [...new Set([...operation.remoteIds, ...result.observedIds, ...result.remote.map((entry) => entry.id), ...result.deletedIds])] })];
      },
      failed: (_error, cancelled) => {
        const operation = this.operation(id), stopped = cancelled || operation.stopRequested || Boolean(this.active.get(id)?.signal.aborted);
        const status = operation.dispatched ? "partial" : stopped ? "cancelled" : "failed";
        const diagnostic = operation.dispatched ?
          "The original user-reviewed Linear request was dispatched but complete ownership/result acknowledgement was not retained. It may have changed Linear. Inspect the original IDs and receipt; no automatic retry, local overwrite or success was inferred." :
          stopped ? "The original Linear workflow was cancelled before any remote mutation or local ticket application. It was not replayed." :
            "The original Linear workflow failed its current account/team/root/policy/base checks before mutation. No local edit was overwritten and no automatic retry occurred.";
        return { events: [this.event({ ...operation, revision: operation.revision + 1, updatedAt: new Date().toISOString(), status, diagnostic })], status, error: diagnostic };
      },
    };
  }
  async execute(command: LinearCommand, finish: WorkspaceFinish, modelSource?: ModelAdviceSource): Promise<CommandResult> {
    command = structuredClone(parse(LinearCommandSchema, command));
    if (modelSource && (command.type !== "linear.workflow.execute" || command.input.action !== "issue.create" || !command.sessionId)) throw new MoguriError("linear_model_scope", "The approved model adapter supports issue creation only, never other mutations, ticket acceptance or cancellation acknowledgement.", 403);
    if (command.type === "linear.workflow.cancel") {
      const operation = this.operation(command.operationId), controller = this.active.get(operation.id);
      if (operation.status !== "running") return finish([], { id: operation.id, revision: operation.revision });
      if (!controller) throw new MoguriError("linear_cancel_unconfirmed", "This retained workflow has no live owned request. Recover/inspect it; no successful cancellation was fabricated.", 409);
      try {
        return finish([this.event({ ...operation, revision: operation.revision + 1, updatedAt: new Date().toISOString(), stopRequested: true })], { id: operation.id, revision: operation.revision + 1 });
      } finally { controller.abort(); }
    }
    const intent = finish.intent ? { ...finish.intent } : undefined;
    if (!intent) throw new MoguriError("linear_intent", "A Linear mutation or ticket sync requires the exact actual-user command identity and reviewed digest before any effect.", 409);
    const original = () => this.operations().find((entry) => entry.commandId === intent.id);
    const duplicate = original();
    if (duplicate) {
      if (duplicate.commandDigest !== intent.digest) throw new MoguriError("idempotency_conflict", "The original Linear command changed; no remote operation was replayed.", 409);
      return finish([], { id: duplicate.id, revision: duplicate.revision });
    }
    const review = this.reviews.get(command.expectedDigest);
    if (!review || Date.now() - review.at > (this.options.reviewTtlMs ?? 10 * 60_000) ||
      review.document.binding.projectId !== command.projectId || review.document.binding.sessionId !== (command.sessionId ?? null) ||
      canonical(review.document.input) !== canonical(command.input)) throw new MoguriError("linear_review_missing", "Preview and explicitly review this exact complete input in the current controller/account. Missing, expired or restarted reviews never authorize a write.", 409);
    const prepared = await this.prepare(command, command.input, AbortSignal.timeout(60_000), review.document.reviewId);
    if (prepared.preview.digest !== command.expectedDigest) throw new MoguriError("linear_review_stale", "The remote updatedAt/base, local revision, selected membership, account or policy changed. Review the exact new diff; no stale remote edit was sent.", 409);
    const repeated = original();
    if (repeated) {
      if (repeated.commandDigest !== intent.digest) throw new MoguriError("idempotency_conflict", "The original Linear command changed.", 409);
      return finish([], { id: repeated.id, revision: repeated.revision });
    }
    const document = prepared.preview.document, binding = document.binding;
    if (!modelSource && this.host.rootBusy(binding.root) || this.operations().some((entry) => entry.status === "running" && entry.root === binding.root)) throw new MoguriError("linear_busy", "The bound root already has owned work. Finish/cancel it before admitting this explicit Linear operation.", 409);
    const id = randomUUID(), controller = new AbortController(); this.active.set(id, controller);
    let response: CommandResult | undefined;
    try {
      this.host.job(`linear.${command.input.action}`, command.projectId, binding.workspaceId ?? undefined, async (requested, progress, jobId) => {
        const signal = AbortSignal.any([requested, controller.signal, prepared.access.signal]);
        signal.throwIfAborted();
        await this.host.assertRoot(binding.projectId, binding.workspaceId ?? undefined, signal);
        const latest = await this.prepare(command, command.input, signal, document.reviewId);
        if (latest.preview.digest !== command.expectedDigest || !modelSource && this.host.rootBusy(binding.root, jobId)) throw new MoguriError("linear_review_stale", "The exact reviewed Linear bases or root ownership changed after admission. No stale mutation was sent.", 409);
        latest.current(); signal.throwIfAborted();
        if (!document.mutation) {
          const result: LinearResult = { format: "moguri-linear-result", version: 1, operationId: id, action: document.input.action,
            remote: document.remote.filter((entry) => entry.kind === "issue"), deletedIds: [], observedIds: [], local: document.localAfter, acknowledgement: "verified" };
          progress("Verified the exact reviewed remote base and local ticket revision; applying only the explicit pull.");
          return result;
        }
        const mutation = document.mutation, query = MUTATIONS[mutation.name];
        if (!query) throw new MoguriError("linear_mutation", "The selected typed Linear mutation is unavailable. No arbitrary GraphQL was executed.");
        let data: Record<string, unknown> | null = null;
        try {
          data = await latest.access.request(query, mutation.variables, signal, () => {
            signal.throwIfAborted(); latest.current();
            const operation = this.operation(id);
            if (operation.status !== "running" || operation.dispatched || operation.stopRequested) throw new MoguriError("linear_replay", "This original Linear request cannot be dispatched twice or after cancellation.", 409);
            this.update(id, { dispatched: true });
          });
          const result = this.receipt(id, document, data);
          this.retainResult(id, result);
          signal.throwIfAborted(); latest.current();
          progress("Received and retained the exact Linear mutation acknowledgement. No unattended follow-up was started.");
          return result;
        } catch (error) {
          const evidence = error instanceof LinearResponseError ? error.evidence : data;
          const ids = this.observed(evidence, mutation.name);
          if (this.operation(id).dispatched && !this.operation(id).resultDigest) this.retainResult(id, {
            format: "moguri-linear-result", version: 1, operationId: id, action: document.input.action,
            remote: [], deletedIds: [], observedIds: ids, local: null, acknowledgement: "unknown",
          });
          throw error;
        }
      }, (job) => {
        prepared.current();
        if (finish.intent?.id !== intent.id || finish.intent.digest !== intent.digest) throw new MoguriError("linear_intent", "The original actual-user intent changed before atomic admission. No mutation was sent.", 409);
        const now = new Date().toISOString();
        const operation: LinearOperation = {
          version: 1, id, profileId: binding.profileId, projectId: command.projectId, sessionId: binding.sessionId, workspaceId: binding.workspaceId,
          root: binding.root, remoteWorkspaceId: document.identity.workspaceId, teamId: document.team.id, actorId: document.identity.actorId,
          credentialGeneration: binding.credentialGeneration, action: command.input.action, commandId: intent.id, commandDigest: intent.digest,
          reviewDigest: command.expectedDigest, inputDigest: this.store.putBlob(canonical(document)), resultDigest: null, jobId: job.id,
          status: "running", revision: 0, createdAt: now, updatedAt: now, dispatched: false, stopRequested: false, remoteIds: [], diagnostic: null,
          ...(modelSource ? { modelSource } : {}),
          acceptance: { actor: modelSource ? "tool-grant" : "user", commandId: intent.id, commandDigest: intent.digest, reviewDigest: command.expectedDigest },
        };
        response = finish([this.event(operation), { event_type: "job.started", profile_id: operation.profileId, project_id: operation.projectId, session_id: operation.sessionId, payload: { job: { ...job, operationId: id } } }], { id, revision: 0 });
        this.reviews.delete(command.expectedDigest);
      }, () => this.active.delete(id), this.lifecycle(id, prepared), binding.sessionId ?? undefined);
    } catch (error) { this.active.delete(id); throw error; }
    if (!response) { this.active.delete(id); throw new MoguriError("linear_intent", "The original Linear operation/job/receipt was not atomically acknowledged. No successful write was inferred.", 409); }
    return response;
  }
  invalidateProject(projectId: string): void {
    this.integrations.invalidateLinearProject(projectId);
    for (const [id, controller] of this.active) if (this.operation(id).projectId === projectId) controller.abort();
    for (const [hash, review] of this.reviews) if (review.document.binding.projectId === projectId) this.reviews.delete(hash);
  }
  recover(): EventInput[] {
    this.reviews.clear(); this.cursors.clear();
    return this.operations().filter((entry) => entry.status === "running").map((operation) =>
      this.event({ ...operation, revision: operation.revision + 1, updatedAt: new Date().toISOString(),
        status: operation.dispatched ? "partial" : "cancelled",
        diagnostic: operation.dispatched ? "Controller restarted after the original Linear dispatch. Retained IDs/results remain independent; the unknown external outcome was not replayed or called successful." :
          "Controller restarted before any acknowledged Linear dispatch or local application. The original intent was not replayed; explicitly preview a new user action." }));
  }
  close(): void {
    this.closed = true; this.reviews.clear(); this.cursors.clear();
    for (const controller of this.active.values()) controller.abort();
  }
}
