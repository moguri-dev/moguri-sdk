import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "../../packages/protocol/src/index.ts";
import { MoguriSdk } from "../../packages/sdk/src/index.ts";
import { envelope } from "../../apps/service/src/controller.ts";
import type { SecretVault } from "../../apps/service/src/gateway.ts";
import type { ProviderAdapter } from "../../apps/service/src/provider.ts";
import { startService } from "../../apps/service/src/server.ts";

export const linearFixtureUuid = (value: number) => `${value.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
export const linearFixtureIds = {
  workspace: linearFixtureUuid(1), actor: linearFixtureUuid(2), team: linearFixtureUuid(3), state: linearFixtureUuid(4),
  done: linearFixtureUuid(5), issue: linearFixtureUuid(6), otherIssue: linearFixtureUuid(7), project: linearFixtureUuid(8),
  cycle: linearFixtureUuid(9), label: linearFixtureUuid(10), user: linearFixtureUuid(11), comment: linearFixtureUuid(12),
  relation: linearFixtureUuid(13), otherTeam: linearFixtureUuid(14),
};
export const LINEAR_FIXTURE_TIME = "2026-10-01T10:00:00.000Z";
export const LINEAR_FIXTURE_TOKEN = "lin_api_generated_linear_workflow_secret_only_for_fixtures";
export const linearFixtureNodes = (values: unknown[], cursor: string | null = null) => ({ nodes: values, pageInfo: { hasNextPage: cursor !== null, endCursor: cursor } });
export const linearFixtureTimestamp = (number: number) => new Date(Date.parse(LINEAR_FIXTURE_TIME) + number * 1000).toISOString();
const ids = linearFixtureIds, T0 = LINEAR_FIXTURE_TIME, nodes = linearFixtureNodes, tick = linearFixtureTimestamp;
const object = (value: unknown) => { assert.ok(isRecord(value)); return value; };
const clone = <T>(value: T): T => structuredClone(value);

export class GeneratedLinearVault implements SecretVault {
  value: string | null = LINEAR_FIXTURE_TOKEN;
  holdWrite?: () => Promise<void>;
  async read() { return this.value; }
  async write(_id: string, value: string) { await this.holdWrite?.(); this.value = value; }
  async remove() { await this.holdWrite?.(); this.value = null; }
}
export interface GeneratedLinearRequest { name: string; query: string; variables: Record<string, unknown>; signal: AbortSignal }
export class GeneratedLinear {
  actorId = ids.actor;
  workspaceId = ids.workspace;
  count = 0;
  requests: GeneratedLinearRequest[] = [];
  hook?: (request: GeneratedLinearRequest) => Promise<Response | undefined> | Response | undefined;
  teams = [{ id: ids.team, name: "Generated team", key: "GEN", updatedAt: T0, organization: { id: ids.workspace } }];
  states = [
    { id: ids.state, name: "Generated backlog", type: "backlog", updatedAt: T0, team: { id: ids.team } },
    { id: ids.done, name: "Generated done", type: "completed", updatedAt: T0, team: { id: ids.team } },
  ];
  cycles = [{ id: ids.cycle, name: "Generated cycle", number: 1, startsAt: T0, endsAt: "2026-10-14T10:00:00.000Z", updatedAt: T0, team: { id: ids.team } }];
  labels = [{ id: ids.label, name: "Generated label", updatedAt: T0, team: { id: ids.team }, organization: { id: ids.workspace } }];
  users = [{ id: ids.user, name: "Generated member", active: true, updatedAt: T0, organization: { id: ids.workspace } }];
  issues = new Map<string, Record<string, unknown>>();
  projects = new Map<string, Record<string, unknown>>();
  comments = new Map<string, Record<string, unknown>>();
  relations = new Map<string, Record<string, unknown>>();
  constructor() {
    this.issues.set(ids.issue, this.issue(ids.issue, { title: "Generated remote ticket" }));
    this.issues.set(ids.otherIssue, this.issue(ids.otherIssue, { title: "Generated second ticket" }));
    this.projects.set(ids.project, this.project(ids.project, { name: "Generated project" }));
    this.comments.set(ids.comment, this.comment(ids.comment, ids.issue, "Generated original comment"));
    this.relations.set(ids.relation, this.relation(ids.relation, ids.issue, ids.otherIssue, "related"));
  }
  private issue(id: string, input: Record<string, unknown>, base?: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = base ? clone(base) : {
      id, identifier: `GEN-${id === ids.issue ? 1 : id === ids.otherIssue ? 2 : 3}`, title: "", description: "", updatedAt: T0, archivedAt: null,
      team: { id: ids.team }, state: { id: ids.state }, project: null, cycle: null, priority: 0, estimate: null,
      assignee: null, labels: nodes([]), parent: null, dueDate: null,
    };
    for (const [field, value] of Object.entries(input)) {
      if (field === "teamId") result.team = { id: value };
      else if (field === "stateId") result.state = { id: value };
      else if (["projectId", "cycleId", "assigneeId", "parentId"].includes(field)) result[field.slice(0, -2)] = value === null ? null : { id: value };
      else if (field === "labelIds") result.labels = nodes((value as string[]).map((id) => ({ id })));
      else result[field] = value;
    }
    result.url = `https://linear.app/generated/issue/${result.identifier}`;
    if (base) result.updatedAt = tick(++this.count);
    return result;
  }
  private project(id: string, input: Record<string, unknown>, base?: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = base ? clone(base) : {
      id, name: "", description: "", content: "", url: `https://linear.app/generated/project/${id}`, updatedAt: T0, archivedAt: null,
      lead: null, startDate: null, targetDate: null, priority: 0, teams: nodes([{ id: ids.team, organization: { id: ids.workspace } }]),
    };
    for (const [key, value] of Object.entries(input)) {
      if (key === "leadId") result.lead = value === null ? null : { id: value };
      else if (key === "teamIds") result.teams = nodes((value as string[]).map((id) => ({ id, organization: { id: ids.workspace } })));
      else result[key] = value;
    }
    if (base) result.updatedAt = tick(++this.count);
    return result;
  }
  private comment(id: string, issueId: string, body: string): Record<string, unknown> {
    return { id, body, updatedAt: tick(++this.count), url: `https://linear.app/generated/issue/GEN-1#comment-${id}`, user: { id: this.actorId }, issue: { id: issueId, team: { id: ids.team } } };
  }
  private relation(id: string, issueId: string, relatedId: string, type: unknown): Record<string, unknown> {
    return { id, type, updatedAt: tick(++this.count), issue: { id: issueId, team: { id: ids.team } }, relatedIssue: { id: relatedId, team: { id: ids.team } } };
  }
  changeIssue(id: string, fields: Record<string, unknown>) { this.issues.set(id, this.issue(id, fields, this.issues.get(id))); }
  fetch: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.linear.app/graphql");
    assert.equal(init?.redirect, "error"); assert.equal(init?.method, "POST");
    assert.ok((init?.headers as Record<string, string>).Authorization);
    const request = object(JSON.parse(String(init?.body))), query = String(request.query);
    const name = query.match(/(?:query|mutation)\s+(Moguri\w+)/)?.[1];
    assert.ok(name);
    const variables = object(request.variables), signal = init!.signal!;
    const input: GeneratedLinearRequest = { name, variables, query, signal }; this.requests.push(input);
    const override = await this.hook?.(input);
    if (override) return override;
    const id = String(variables.id), fields = isRecord(variables.input) ? variables.input : {};
    const outputId = typeof fields.id === "string" ? fields.id : id;
    const response = (data: Record<string, unknown>) => Response.json({ data });
    switch (name) {
      case "MoguriLinearScope": return response({ viewer: { id: this.actorId, name: "Generated author", organization: { id: this.workspaceId, name: "Generated workspace", urlKey: "generated" } }, team: this.teams[0] });
      case "MoguriLinearIssue": return response({ issue: this.issues.get(id) ?? null });
      case "MoguriLinearProject": return response({ project: this.projects.get(id) ?? null });
      case "MoguriLinearState": return response({ workflowState: this.states.find((entry) => entry.id === id) ?? null });
      case "MoguriLinearCycle": return response({ cycle: this.cycles.find((entry) => entry.id === id) ?? null });
      case "MoguriLinearLabel": return response({ issueLabel: this.labels.find((entry) => entry.id === id) ?? null });
      case "MoguriLinearMember": return response({ team: { id: ids.team, members: nodes(this.users.filter((entry) => entry.id === id)) } });
      case "MoguriLinearComment": return response({ comment: this.comments.get(id) ?? null });
      case "MoguriLinearRelation": return response({ issueRelation: this.relations.get(id) ?? null });
      case "MoguriTeamIssues": return response({ team: { id: ids.team, issues: nodes([...this.issues.values()].slice(0, 50)) } });
      case "MoguriLinearTeams": return response({ teams: nodes(this.teams) });
      case "MoguriLinearStates": return response({ team: { id: ids.team, states: nodes(this.states) } });
      case "MoguriLinearProjects": return response({ team: { id: ids.team, projects: nodes([...this.projects.values()]) } });
      case "MoguriLinearCycles": return response({ team: { id: ids.team, cycles: nodes(this.cycles) } });
      case "MoguriLinearLabels": return response({ team: { id: ids.team, labels: nodes(this.labels) } });
      case "MoguriLinearUsers": return response({ team: { id: ids.team, members: nodes(this.users) } });
      case "MoguriLinearIssues": return response({ team: { id: ids.team, issues: nodes([...this.issues.values()]) } });
      case "MoguriLinearComments": return response({ issue: { id, team: { id: ids.team }, comments: nodes([...this.comments.values()]) } });
      case "MoguriLinearRelations": return response({ issue: { id, team: { id: ids.team }, relations: nodes([...this.relations.values()]) } });
      case "MoguriLinearIssueCreate": {
        const issue = this.issue(outputId, fields); this.issues.set(outputId, issue);
        return response({ issueCreate: { success: true, issue } });
      }
      case "MoguriLinearIssueUpdate": {
        const issue = this.issue(id, fields, this.issues.get(id)); this.issues.set(id, issue);
        return response({ issueUpdate: { success: true, issue } });
      }
      case "MoguriLinearIssueArchive":
      case "MoguriLinearIssueUnarchive": {
        const issue = this.issue(id, { archivedAt: name.endsWith("Unarchive") ? null : tick(++this.count) }, this.issues.get(id)); this.issues.set(id, issue);
        return response({ [name.endsWith("Unarchive") ? "issueUnarchive" : "issueArchive"]: { success: true, entity: issue } });
      }
      case "MoguriLinearIssueDelete": this.issues.delete(id); return response({ issueDelete: { success: true, entity: null } });
      case "MoguriLinearCommentCreate": {
        const comment = this.comment(outputId, String(fields.issueId), String(fields.body)); this.comments.set(outputId, comment);
        return response({ commentCreate: { success: true, comment } });
      }
      case "MoguriLinearCommentUpdate": {
        const comment = { ...this.comments.get(id), body: fields.body, updatedAt: tick(++this.count) }; this.comments.set(id, comment);
        return response({ commentUpdate: { success: true, comment } });
      }
      case "MoguriLinearCommentDelete": this.comments.delete(id); return response({ commentDelete: { success: true, entityId: id } });
      case "MoguriLinearProjectCreate": {
        const project = this.project(outputId, fields); this.projects.set(outputId, project); return response({ projectCreate: { success: true, project } });
      }
      case "MoguriLinearProjectUpdate": {
        const project = this.project(id, fields, this.projects.get(id)); this.projects.set(id, project); return response({ projectUpdate: { success: true, project } });
      }
      case "MoguriLinearProjectArchive":
      case "MoguriLinearProjectUnarchive": {
        const project = this.project(id, { archivedAt: name.endsWith("Unarchive") ? null : tick(++this.count) }, this.projects.get(id)); this.projects.set(id, project);
        return response({ [name.endsWith("Unarchive") ? "projectUnarchive" : "projectArchive"]: { success: true, entity: project } });
      }
      case "MoguriLinearRelationCreate": {
        const relation = this.relation(outputId, String(fields.issueId), String(fields.relatedIssueId), fields.type); this.relations.set(outputId, relation);
        return response({ issueRelationCreate: { success: true, issueRelation: relation } });
      }
      case "MoguriLinearRelationDelete": this.relations.delete(id); return response({ issueRelationDelete: { success: true, entityId: id } });
      default: throw new Error(`Unexpected generated Linear operation ${name}.`);
    }
  };
}

export async function linearServiceFixture() {
  const directory = join(process.cwd(), ".linear-workflow-fixtures", randomUUID()); await mkdir(directory, { recursive: true, mode: 0o700 });
  const root = join(directory, "project"), stateDir = join(directory, "state"); await mkdir(root);
  const provider = new GeneratedLinear(), vault = new GeneratedLinearVault(), credentials = new Map<string, string>(), modelCalls: string[] = [];
  const explicitVault: SecretVault = {
    read: async (id) => credentials.get(id) ?? null,
    write: async (id, value) => { credentials.set(id, value); }, remove: async (id) => { credentials.delete(id); },
  };
  const modelProvider: ProviderAdapter = {
    state: { status: "disconnected", models: [], login: null, diagnostic: null }, onChange: () => {},
    refresh: async () => {}, cancel: async () => {}, logout: async () => {},
    login: () => { throw new Error("Generated Linear tests never authorize a personal account."); },
    prepare: async (modelId) => { modelCalls.push(modelId); throw new Error("Generated Linear tests never call a model."); },
  };
  let service: Awaited<ReturnType<typeof startService>> | undefined, sdk: MoguriSdk | undefined, other: MoguriSdk | undefined;
  try {
    service = await startService({
      stateDir, retentionKey: Buffer.alloc(32, 0x7c), provider: modelProvider,
      platform: { vault: explicitVault, terminal: { vault: explicitVault }, integrations: { vault, fetch: provider.fetch } },
    });
    sdk = await new MoguriSdk(service.connection).ready(); other = await new MoguriSdk(service.connection).ready();
    const project = await service.controller.dispatch(envelope({ type: "project.add", path: root }));
    const session = await service.controller.dispatch(envelope({ type: "session.create", projectId: project.id! }));
    await sdk.refresh();
    const connected = sdk, second = other, running = service;
    return {
      directory, root, stateDir, sdk: connected, other: second, provider, vault, modelCalls, service: running, projectId: project.id!, sessionId: session.id!,
      enable: async () => {
        const board = (await connected.issues.board(project.id!)).board;
        await connected.issues.configure(project.id!, { ...board, autoRefreshPrs: false, linear: { enabled: true, teamId: ids.team } }, board.revision);
        await connected.linear.setToken(LINEAR_FIXTURE_TOKEN);
      },
      close: async () => { connected.disconnect(); second.disconnect(); await running.close(); await rm(directory, { recursive: true, force: true }); },
    };
  } catch (error) {
    sdk?.disconnect(); other?.disconnect(); await service?.close(); await rm(directory, { recursive: true, force: true }); throw error;
  }
}
