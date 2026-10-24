import { Type, type Static } from "typebox";
import type { Session, Snapshot } from "./index.ts";
import { PullRequestLinkSchema, type PullRequestLink } from "./workspace.ts";
import { defaultProjectConfiguration } from "./sessions.ts";
import { colorContrast } from "./preferences.ts";

const nullableId = Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]);
export const SessionPrScopeSchema = Type.Object({
  url: Type.String({ minLength: 1, maxLength: 2048 }), projectId: nullableId, workspaceId: nullableId,
  root: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
  workspaceRevision: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  access: Type.Union([Type.Literal("public"), Type.Literal("gh-cli")]),
  configurationRevision: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
}, { additionalProperties: false });
export type SessionPrScope = Static<typeof SessionPrScopeSchema>;
export const SessionPrObservationSchema = Type.Object({
  version: Type.Literal(1), profileId: Type.String({ minLength: 1, maxLength: 128 }),
  sessionId: Type.String({ minLength: 1, maxLength: 128 }), scope: SessionPrScopeSchema, pullRequest: PullRequestLinkSchema,
}, { additionalProperties: false });
export type SessionPrObservation = Static<typeof SessionPrObservationSchema>;
type PrSources = Pick<Snapshot, "issues" | "managedWorkspaces" | "changeSets" | "projects" | "projectConfigurations">;
type PrOwner = Pick<Session, "projectId" | "workspaceId" | "workItemId" | "prUrl">;
export function sessionPullRequestUrl(session: PrOwner, snapshot: Pick<PrSources, "issues" | "managedWorkspaces" | "changeSets">): string | null {
  const workspace = snapshot.managedWorkspaces.find((workspace) => workspace.id === session.workspaceId && workspace.projectId === session.projectId && workspace.status !== "removed");
  return session.prUrl ??
    snapshot.issues.find((issue) => issue.id === session.workItemId && issue.projectId === session.projectId)?.pullRequest?.url ??
    (workspace ? snapshot.changeSets.find((change) => change.id === workspace.changeSetId && change.workspaceId === workspace.id && change.projectId === session.projectId)?.prUrl : null) ?? null;
}
export function sessionPrScope(session: PrOwner, snapshot: PrSources): SessionPrScope | null {
  const url = sessionPullRequestUrl(session, snapshot);
  if (!url) return null;
  if (session.projectId === null) return session.workspaceId === null ?
    { url, projectId: null, workspaceId: null, root: null, workspaceRevision: null, access: "public", configurationRevision: null } : null;
  const project = snapshot.projects.find((project) => project.id === session.projectId);
  const workspace = session.workspaceId === null ? null :
    snapshot.managedWorkspaces.find((workspace) => workspace.id === session.workspaceId && workspace.projectId === session.projectId && workspace.status !== "removed");
  if (!project || session.workspaceId !== null && !workspace) return null;
  const configuration = snapshot.projectConfigurations.find((value) => value.projectId === project.id) ?? defaultProjectConfiguration(project.id);
  return { url, projectId: project.id, workspaceId: session.workspaceId, root: workspace?.path ?? project.path, workspaceRevision: workspace?.revision ?? null,
    access: configuration.values.repo.githubAccess, configurationRevision: configuration.revision };
}
export const sameSessionPrScope = (left: SessionPrScope, right: SessionPrScope): boolean =>
  left.url === right.url && left.projectId === right.projectId && left.workspaceId === right.workspaceId &&
  left.root === right.root && left.workspaceRevision === right.workspaceRevision && left.access === right.access && left.configurationRevision === right.configurationRevision;
export function sessionPullRequest(session: Session, snapshot: PrSources & Pick<Snapshot, "profileId">): PullRequestLink | null {
  const scope = sessionPrScope(session, snapshot), observed = session.prObservation;
  if (!scope) return null;
  const workItem = snapshot.issues.find((issue) => issue.id === session.workItemId && issue.projectId === session.projectId &&
    issue.pullRequest?.url === scope.url)?.pullRequest;
  if (workItem) return workItem;
  if (observed?.profileId === snapshot.profileId && observed.sessionId === session.id &&
    sameSessionPrScope(observed.scope, scope) && observed.pullRequest.url === scope.url) return observed.pullRequest;
  return null;
}
export type SessionIndicatorKind = "running" | "question" | "approval" | "completed" | "merged" | "failed" | "partial" | "stopped" | "queued" | "idle" | "archived";
export type SessionPrIndicatorKind = "unknown" | "open" | "draft" | "closed" | "merged";
export function sessionIndicator(session: Session, snapshot: Snapshot): {
  kind: SessionIndicatorKind; label: string; pr: PullRequestLink | null; prUrl: string | null; prState: SessionPrIndicatorKind; prLabel: string;
} {
  const pr = sessionPullRequest(session, snapshot), prUrl = sessionPullRequestUrl(session, snapshot);
  const prState: SessionPrIndicatorKind = !pr || pr.diagnostic || pr.state === "unknown" || pr.state === "open" && pr.draft == null ? "unknown" :
    pr.state === "open" ? pr.draft ? "draft" : "open" : pr.state;
  const prLabel = prState === "draft" ? "Attached pull request is draft" : prState === "open" ? "Attached pull request is open" :
    prState === "merged" ? "Attached pull request merged" : prState === "closed" ? "Attached pull request is closed, not merged" :
    `Attached pull request status is not verified${pr?.diagnostic ? `: ${pr.diagnostic}` : ""}`;
  const result = (kind: SessionIndicatorKind, label: string) => ({
    kind, label: kind === "completed" && prUrl ? `${label}; ${prLabel}` : label, pr, prUrl, prState, prLabel,
  });
  if (session.pendingQuestionId) return result("question", "Question needs your answer");
  if (session.pendingApproval) return result("approval", "Permission or approval needed");
  if (session.status === "waiting_input") return result("approval", "Waiting for your input");
  if (session.turnId !== null && ["running", "stopping"].includes(session.status)) return result("running", session.status === "stopping" ? "Stopping active work" : "Session in progress");
  const question = snapshot.settings.values.notifications.inApp && snapshot.attention.findLast((entry) =>
    entry.sessionId === session.id && entry.active && entry.kind === "question" && entry.source === "heuristic");
  if (question) return result("question", "Possible question; no structured answer requested");
  if (pr?.state === "merged" && !pr.diagnostic) return result("merged", "Attached pull request merged");
  if (session.status === "completed") return result("completed", "Session completed");
  if (session.status === "failed") return result("failed", "Session failed");
  if (session.status === "partial") return result("partial", "Session partially completed");
  if (session.status === "stopped") return result("stopped", "Session stopped");
  if (session.status === "queued" || session.queue.length) return result("queued", session.queue.length && session.queue.every((item) => item.held) ? "Prompts held; no work running" : "Session queued");
  return result(session.status === "archived" ? "archived" : "idle", session.status === "archived" ? "Session archived" : "Session idle");
}
export function sessionIndicatorColors(background: string) {
  const choices = {
    running: ["#60a5fa", "#2563eb", "#bfdbfe", "#172554"],
    attention: ["#facc15", "#a16207", "#fef08a", "#422006"],
    completed: ["#4ade80", "#15803d", "#bbf7d0", "#052e16"],
    merged: ["#c084fc", "#7e22ce", "#e9d5ff", "#3b0764"],
    draft: ["#94a3b8", "#475569", "#e2e8f0", "#0f172a"],
  };
  const select = (values: string[]) => {
    const value = values.find((value) => colorContrast(value, background) >= 3);
    if (!value) throw new Error("Session indicator palette cannot meet non-text contrast for this background.");
    return value;
  };
  return { running: select(choices.running), attention: select(choices.attention), completed: select(choices.completed),
    merged: select(choices.merged), draft: select(choices.draft) };
}
