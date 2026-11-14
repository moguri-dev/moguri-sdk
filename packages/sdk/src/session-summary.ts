import { MoguriError, type CapabilityJob, type Session, type SessionActivity, type Snapshot } from "../../protocol/src/index.ts";

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
  let oldRemaining = 0, newRemaining = 0, file = false, changed = false, body = false;
  const invalid = () => new MoguriError("workspace_diff", "A complete unified diff is required for line counts. Open Changes to inspect the original observation; no totals were guessed.");
  const finish = () => { if (oldRemaining || newRemaining || file && !changed) throw invalid(); };
  const lines = diff.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line === "\\ No newline at end of file") continue;
    if (oldRemaining || newRemaining) {
      if (line.startsWith("+")) { summary.additions++; newRemaining--; }
      else if (line.startsWith("-")) { summary.deletions++; oldRemaining--; }
      else if (line.startsWith(" ")) { oldRemaining--; newRemaining--; }
      else throw invalid();
      if (oldRemaining < 0 || newRemaining < 0) throw invalid();
      continue;
    }
    if (line.startsWith("diff --git ")) { finish(); file = true; changed = false; body = false; continue; }
    if (!line && index === lines.length - 1) continue;
    if (!file) throw invalid();
    const hunk = line.match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@(?:.*)$/);
    if (hunk) {
      oldRemaining = Number(hunk[1] ?? 1); newRemaining = Number(hunk[2] ?? 1);
      if (!Number.isSafeInteger(oldRemaining) || !Number.isSafeInteger(newRemaining)) throw invalid();
      changed = true; body = true; continue;
    }
    if (/^Binary files .+ differ$/.test(line)) { summary.binaryFiles++; changed = true; continue; }
    if (/^(?:new mode |new file mode |deleted file mode )\d+$/.test(line)) { changed = true; continue; }
    if (!body && /^(?:index |old mode |--- |\+\+\+ )/.test(line)) continue;
    throw invalid();
  }
  finish();
  return summary;
}
