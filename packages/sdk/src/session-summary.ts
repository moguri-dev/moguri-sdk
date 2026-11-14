import { MoguriError, type CapabilityJob, type Session, type SessionActivity, type Snapshot } from "../../protocol/src/index.ts";
import { sessionIndicator } from "../../protocol/src/session-status.ts";

export type SessionNavigationStatus = "finished" | "error" | "attention" | "progress";
export type SessionPromptOrder = "default" | "newest" | "oldest";
export function sessionNavigationStatus(session: Session, snapshot: Snapshot): SessionNavigationStatus | null {
  const { kind } = sessionIndicator(session, snapshot);
  if (kind === "completed" || kind === "merged") return "finished";
  if (kind === "failed" || kind === "partial") return "error";
  if (kind === "question" || kind === "approval") return "attention";
  return kind === "running" ? "progress" : null;
}
export function compareSessionPrompts(left: Session, right: Session, order: Exclude<SessionPromptOrder, "default">): number {
  const timestamp = (session: Session) => {
    const value = Date.parse(session.messages.findLast((message) => message.role === "user")?.timestamp ?? session.createdAt);
    if (!Number.isFinite(value)) throw new MoguriError("session_prompt_time", "A retained prompt or creation time is invalid. No activity time was substituted for prompt ordering.");
    return value;
  };
  return (timestamp(left) - timestamp(right)) * (order === "newest" ? -1 : 1) || left.id.localeCompare(right.id);
}

export type SessionLocalFolder = { path: string; identity: { device: string; inode: string } | null; diagnostic?: undefined } |
  { path?: undefined; identity?: undefined; diagnostic: string };
export function sessionLocalFolder(session: Session, snapshot: Pick<Snapshot, "projects" | "managedWorkspaces">): SessionLocalFolder {
  if (session.repositories) return { diagnostic: "This folder session keeps several captured repository roots. No first member or common parent was chosen." };
  if (session.controls.env !== "Local") return { diagnostic: `${session.controls.env} work is not a Local folder on this computer. No base checkout or mapped path was substituted.` };
  if (session.projectId) {
    const project = snapshot.projects.find((entry) => entry.id === session.projectId);
    if (!project) return { diagnostic: "This session's original project is no longer registered. No other folder was substituted." };
    if (!session.workspaceId) return { path: project.path, identity: null };
    const workspace = snapshot.managedWorkspaces.find((entry) => entry.id === session.workspaceId);
    if (!workspace || workspace.projectId !== project.id || workspace.status !== "ready" || !workspace.identity) {
      return { diagnostic: "This session's managed worktree is not ready, was removed or belongs to another project. No base checkout was substituted." };
    }
    return { path: workspace.path, identity: workspace.identity };
  }
  if (session.homeRoot && !session.readOnly && (session.kind === "agent" || session.kind === "side")) {
    return { path: session.homeRoot.root, identity: { device: session.homeRoot.device, inode: session.homeRoot.inode } };
  }
  return { diagnostic: "This chat has no captured Local Home folder. No project or state folder was substituted." };
}

export function sessionBackgroundWork(session: Session, snapshot: Pick<Snapshot, "sessions" | "jobs">, activity: SessionActivity | null) {
  const agentSessions = snapshot.sessions.filter((child) => child.createdParentSessionId === session.id &&
    (child.kind === "subagent" || child.kind === "agent" && child.coordinationParentId === session.id) &&
    child.status !== "archived");
  const agents = agentSessions.filter((child) => child.turnId !== null && ["running", "waiting_input", "stopping"].includes(child.status));
  const jobs = snapshot.jobs.filter((job): job is CapabilityJob & { commandJob: NonNullable<CapabilityJob["commandJob"]> } =>
    job.sessionId === session.id && job.commandJob !== undefined && ["running", "waiting_input"].includes(job.status));
  const jobCalls = new Set(jobs.map((job) => JSON.stringify([job.parentTurnId, job.commandJob.callId])));
  const current = activity?.sessionId === session.id ? activity : null;
  const commands = (current?.current ?? []).filter((entry) => entry.sessionId === session.id && session.turnId !== null &&
    entry.turnId === session.turnId && entry.source === "tool" && ["run_command", "run_script"].includes(entry.toolName ?? "") &&
    entry.status === "running" && !jobCalls.has(JSON.stringify([entry.turnId, entry.messageId])));
  return { agentSessions, agents, commands, jobs, count: agents.length + commands.length + jobs.length,
    complete: current !== null && current.currentCount === current.current.length };
}

export interface WorkspaceDiffSummary { additions: number; deletions: number; binaryFiles: number }
export function workspaceDiffSummary(diff: string): WorkspaceDiffSummary {
  const summary: WorkspaceDiffSummary = { additions: 0, deletions: 0, binaryFiles: 0 };
  let oldRemaining = 0, newRemaining = 0, file = false, changed = false, body = false, textHeaders = false;
  const invalid = () => new MoguriError("workspace_diff", "A complete unified diff is required for line counts. Open Changes to inspect the original observation; no totals were guessed.");
  const finish = () => { if (oldRemaining || newRemaining || file && !changed || textHeaders && !body) throw invalid(); };
  const lines = diff.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line === "\\ No newline at end of file") { if (!file || !body) throw invalid(); continue; }
    if (oldRemaining || newRemaining) {
      if (line.startsWith("+")) { summary.additions++; newRemaining--; }
      else if (line.startsWith("-")) { summary.deletions++; oldRemaining--; }
      else if (line.startsWith(" ")) { oldRemaining--; newRemaining--; }
      else throw invalid();
      if (oldRemaining < 0 || newRemaining < 0) throw invalid();
      continue;
    }
    if (line.startsWith("diff --git ")) { finish(); file = true; changed = false; body = false; textHeaders = false; continue; }
    if (!line && index === lines.length - 1) continue;
    if (!file) throw invalid();
    const hunk = line.match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@(?:.*)$/);
    if (hunk) {
      oldRemaining = Number(hunk[1] ?? 1); newRemaining = Number(hunk[2] ?? 1);
      if (!Number.isSafeInteger(oldRemaining) || !Number.isSafeInteger(newRemaining)) throw invalid();
      changed = true; body = true; continue;
    }
    if (/^Binary files .+ differ$/.test(line)) { summary.binaryFiles++; changed = true; body = true; continue; }
    if (/^(?:new mode |new file mode |deleted file mode )\d+$/.test(line)) { changed = true; continue; }
    if (!body && /^(?:--- |\+\+\+ )/.test(line)) { textHeaders = true; continue; }
    if (!body && /^(?:index |old mode )/.test(line)) continue;
    throw invalid();
  }
  finish();
  return summary;
}
