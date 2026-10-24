import {
  LONG_TASK_MS, MoguriError, planChecklist, type EventInput, type ModelAdviceSource,
  type Session, type StoredEvent, type TaskProgress, type TaskProgressInput,
} from "../../../packages/protocol/src/index.ts";
import { createHash } from "node:crypto";

interface Host {
  profileId: string;
  session(id: string): Session;
  events(): StoredEvent[];
  plan(sessionId: string): Promise<{ path: string; text: string; digest: string; exists: boolean }>;
  binding(session: Session): string;
  commit(events: EventInput[]): void;
}
export class TaskProgressRuntime {
  constructor(private readonly host: Host, private readonly now = Date.now) {}
  reminder(sessionId: string): string {
    const session = this.host.session(sessionId), events = this.host.events().filter((event) => event.profile_id === this.host.profileId && event.session_id === sessionId && event.turn_id === session.turnId);
    const start = events.find((event) => event.event_type === "turn.started"), report = events.findLast((event) => event.event_type === "task.progress_reported");
    if (!start || this.now() - Date.parse(report?.timestamp ?? start.timestamp) < LONG_TASK_MS || session.kind === "metachat" || session.kind === "subagent") return "";
    return "\nTask progress check is due at this safe boundary. Use task_progress read, then report a grounded estimate against the actual plan if useful. Keep working on the user's task; do not launch a separate model, infer acceptance or edit checklist items merely to raise progress. Percentages are untrusted estimates.";
  }
  async read(sessionId: string): Promise<TaskProgress> {
    const session = this.host.session(sessionId), binding = this.host.binding(session);
    const events = this.host.events().filter((event) => event.profile_id === this.host.profileId && event.session_id === sessionId);
    const latestTurn = session.turnId ?? events.findLast((event) => event.event_type === "turn.started")?.turn_id;
    const scope = createHash("sha256").update(this.host.binding({ ...session, turnId: null })).digest("hex");
    const candidate = session.taskPlan;
    const plan = candidate && candidate.turnId === latestTurn && candidate.binding === scope ? structuredClone(candidate) : null;
    let checklist: TaskProgress["checklist"] = { path: null, digest: null, completed: 0, total: 0, percent: null, diagnostic: "This chat has no bound project plan." };
    if (plan) {
      const completed = plan.steps.filter((step) => step.status === "done").length;
      checklist = { path: null, digest: plan.digest, completed, total: plan.steps.length,
        percent: Math.round(completed * 100 / plan.steps.length), diagnostic: "Explicit owning-model checklist. Checked steps are model claims, not acceptance or permission." };
    } else if (session.projectId) {
      const file = await this.host.plan(sessionId);
      checklist = { path: file.path, digest: file.exists ? file.digest : null, ...planChecklist(file.text),
        diagnostic: !file.exists ? "No bound plan exists yet." : null };
      if (!checklist.total && file.exists) checklist.diagnostic = "The bound plan has no Markdown checklist.";
    }
    const current = this.host.session(sessionId);
    if (this.host.binding(current) !== binding || current.taskPlan?.revision !== session.taskPlan?.revision) throw new MoguriError("progress_stale", "The task or plan binding changed during the progress check. No earlier completion was substituted.", 409);
    const started = events.findLast((event) => event.event_type === "turn.started" && event.turn_id === current.turnId);
    const now = this.now(), longRunning = Boolean(started && now - Date.parse(started.timestamp) >= LONG_TASK_MS);
    const reported = events.findLast((event) => event.event_type === "task.progress_reported" && event.turn_id === current.turnId);
    const model = reported?.event_type === "task.progress_reported" ? { ...reported.payload.report, reportedAt: reported.timestamp,
      stale: reported.payload.report.planDigest !== checklist.digest || now - Date.parse(reported.timestamp) > 120_000 } : null;
    return { sessionId, turnId: current.turnId, env: current.controls.env, observedAt: new Date(now).toISOString(), longRunning, plan, checklist, model,
      disagreement: Boolean(model && !model.stale && checklist.percent !== null && Math.abs(model.percent - checklist.percent) >= 20) };
  }
  async tool(sessionId: string, turnId: string, source: ModelAdviceSource, input: TaskProgressInput, signal: AbortSignal): Promise<TaskProgress> {
    signal.throwIfAborted();
    if (input.action === "plan") {
      const session = this.host.session(sessionId);
      if (session.turnId !== turnId || ["stopping", "archived"].includes(session.status)) throw new MoguriError("progress_owner", "The original task no longer owns this plan. No late plan was recorded.", 409);
      if (!input.title.trim() || input.steps.length < 2 || input.steps.length > 50 ||
        [input.title, ...input.steps.map((step) => step.text)].some((text) => !text.trim() || /[\u0000-\u001f\u007f]/.test(text)) ||
        new Set(input.steps.map((step) => step.text.trim())).size !== input.steps.length) {
        throw new MoguriError("plan_input", "Use a readable multi-step plan with two to fifty distinct steps. A simple answer does not need a checklist.");
      }
      const binding = createHash("sha256").update(this.host.binding({ ...session, turnId: null })).digest("hex");
      const plan = { title: input.title, steps: structuredClone(input.steps), revision: (session.taskPlan?.revision ?? -1) + 1,
        turnId, binding, source, digest: createHash("sha256").update(JSON.stringify([turnId, binding, input.title, input.steps])).digest("hex") };
      signal.throwIfAborted();
      this.host.commit([{ event_type: "task.plan_updated", profile_id: this.host.profileId, project_id: session.projectId,
        session_id: sessionId, turn_id: turnId, step_id: source.stepId, payload: { plan } }]);
      return this.read(sessionId);
    }
    const progress = await this.read(sessionId);
    signal.throwIfAborted();
    const session = this.host.session(sessionId);
    if (session.turnId !== turnId || session.status === "stopping" || session.status === "archived") throw new MoguriError("progress_owner", "The original task no longer owns this report. No progress or completion was recorded.", 409);
    if (input.action === "read") return progress;
    if (!progress.longRunning) throw new MoguriError("progress_early", "Model estimates are for tasks running at least one minute. The plan checklist is available without inference.");
    if (input.planDigest !== progress.checklist.digest) throw new MoguriError("progress_plan", "The plan changed. Read the current checklist before reporting another estimate.", 409);
    if (!input.summary.trim() || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(input.summary)) throw new MoguriError("progress_input", "Use a short readable explanation of this estimate, not control characters.");
    this.host.commit([{ event_type: "task.progress_reported", profile_id: this.host.profileId,
      project_id: session.projectId, session_id: sessionId, turn_id: turnId, step_id: source.stepId,
      payload: { report: { percent: input.percent, summary: input.summary, planDigest: input.planDigest, source } } }]);
    return this.read(sessionId);
  }
}
