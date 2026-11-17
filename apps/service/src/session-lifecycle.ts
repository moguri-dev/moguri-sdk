import { unsettledWinddownCommit, type Session, type Snapshot } from "../../../packages/protocol/src/index.ts";

const DAY = 86_400_000;
/** When Moguri first saw this session's pull request merged; observations persist only on change, so checkedAt marks that moment. */
export function sessionMergedAt(session: Session): number | null {
  const pullRequest = session.prObservation?.pullRequest;
  if (pullRequest?.state !== "merged" || !pullRequest.checkedAt) return null;
  const at = Date.parse(pullRequest.checkedAt);
  return Number.isFinite(at) ? at : null;
}
export function canAutoArchive(snapshot: Snapshot, session: Session, now: number): boolean {
  const policy = snapshot.settings.values.retention;
  const completed = Boolean(policy.archiveCompleted && session.status === "completed" && session.completedAt &&
    Number.isFinite(Date.parse(session.completedAt)) && Date.parse(session.completedAt) <= now - (policy.archiveAfterDays ?? 7) * DAY);
  const mergedAt = policy.archiveMerged ? sessionMergedAt(session) : null;
  const merged = mergedAt !== null && ["completed", "stopped", "failed", "idle"].includes(session.status) &&
    mergedAt <= now - (policy.archiveMergedAfterDays ?? 7) * DAY;
  if (!completed && !merged) return false;
  const children = new Map<string, Session[]>();
  for (const value of snapshot.sessions) if (value.parentSessionId) children.set(value.parentSessionId, [...children.get(value.parentSessionId) ?? [], value]);
  const pending = [session], family = new Set<string>();
  while (pending.length) {
    const value = pending.pop()!;
    if (family.has(value.id)) return false;
    family.add(value.id);
    if (value.turnId || value.pendingApproval || value.pendingQuestionId || value.pendingMode ||
      value.draft.text.length || value.draft.attachments.length || value.queue.length ||
      ["queued", "running", "waiting_input", "stopping", "partial"].includes(value.status) ||
      value.processes.some((process) => ["running", "unconfirmed"].includes(process.outcome)) ||
      value.usage.some((usage) => ["running", "unconfirmed"].includes(usage.outcome)) ||
      snapshot.blockedSessions.includes(value.id) || value.workspaceId && snapshot.blockedWorkspaces.includes(value.workspaceId) ||
      value.projectId && !value.workspaceId && snapshot.blockedProjects.includes(value.projectId)) return false;
    pending.push(...children.get(value.id) ?? []);
  }
  return !snapshot.jobs.some((job) => job.sessionId && family.has(job.sessionId) && ["running", "waiting_input"].includes(job.status)) &&
    !snapshot.winddowns.some((record) => family.has(record.sessionId) && unsettledWinddownCommit(record)) &&
    !snapshot.terminals.some((terminal) => terminal.sessionId && family.has(terminal.sessionId) && !["closed", "failed", "acknowledged"].includes(terminal.status));
}
