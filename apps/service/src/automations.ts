import { randomUUID } from "node:crypto";
import {
  AUTOMATION_LIMIT, MoguriError, activeAutomationRun, automationStepText, dueAutomationOccurrences, nextAutomationOccurrence,
  scheduleLocalTime, scheduledInstant, selectAutonomyControls, validateAutomation,
  type Automation, type AutomationCommand, type AutomationItem, type AutomationRun, type AutomationRunStatus, type AutomationSchedule,
  type AutomationStepState, type CommandResult, type ControlDefaults, type Controls, type EventInput, type QueueItem, type ResolvedControls,
  type Snapshot, type StoredEvent, type ToolCall,
} from "../../../packages/protocol/src/index.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import { digest } from "./store.ts";

export interface AutomationScriptStart {
  sessionId: string; call: ToolCall; identity: { id: string; digest: string }; text: string; item: AutomationItem;
  /** Throws when the run no longer owns this step, so no intent is committed. */
  guard(): void;
}
interface Host {
  snapshot(): Snapshot;
  commit(events: EventInput[]): void;
  finish(id: string, digest: string): WorkspaceFinish;
  now(): number;
  startup(projectId: string | null, overrides: ControlDefaults): ResolvedControls;
  /** Current policy, Env readiness and model availability for captured controls; never substitutes another. */
  validate(controls: Controls, projectId: string | null): void;
  /** A null project creates an ordinary project-free chat with the captured Home binding, never an inherited or synthetic project (D58). */
  createSession(command: { type: "session.create"; projectId: string | null; title: string; overrides: Controls }, finish: WorkspaceFinish): Promise<CommandResult>;
  startScript(start: AutomationScriptStart): Promise<void>;
  stop(sessionId: string): void;
  /** False while the chat's worktree is still being created or another owner holds it. */
  startable(sessionId: string): boolean;
  wake(): void;
  closing(projectId: string | null): boolean;
}
/** Transient ownership conflicts: the script step stays queued and starts on a later commit once the chat is idle. */
const busyCodes = new Set(["session_busy", "workspace_busy", "rewind_busy", "checkpoint_reader_wait"]);
const terminalStep = (state: AutomationStepState) => !["pending", "queued", "running"].includes(state.status);
const safeDiagnostic = (error: unknown) => error instanceof MoguriError ? error.message :
  "The automation run could not start. Inspect its project and chat; nothing was replayed.";

export class AutomationRuntime {
  private readonly launching = new Set<string>();
  private readonly scripts = new Set<string>();
  private sweeping = false;
  constructor(private readonly host: Host) {}
  private snapshot() { return this.host.snapshot(); }
  private iso(at = this.host.now()) { return new Date(at).toISOString(); }
  automations(): Automation[] { return this.snapshot().automations; }
  private automation(id: string): Automation {
    const automation = this.snapshot().automations.find((value) => value.id === id);
    if (!automation) throw new MoguriError("automation_missing", "This automation is not in the connected profile.", 404);
    return automation;
  }
  private run(id: string): AutomationRun {
    const run = this.snapshot().automationRuns.find((value) => value.id === id);
    if (!run) throw new MoguriError("automation_run_missing", "This automation run is not in the connected profile.", 404);
    return run;
  }
  private activeRun(automationId: string) { return this.snapshot().automationRuns.find((run) => run.automationId === automationId && activeAutomationRun(run)); }
  private automationEvent(automation: Automation): EventInput {
    return { event_type: "automation.recorded", profile_id: automation.profileId, project_id: automation.projectId, payload: { automation } };
  }
  private runEvent(run: AutomationRun): EventInput {
    return { event_type: "automation.run_recorded", profile_id: run.profileId, project_id: run.projectId, payload: { run } };
  }
  private revision(actual: number, expected: number) {
    if (actual !== expected) throw new MoguriError("revision_conflict", "Another client changed this automation. Reload it before editing.", 409);
  }
  /** A project-free automation (null) needs no project; a project automation needs its exact project, never a substitute. */
  private project(id: string | null): void {
    if (id !== null && !this.snapshot().projects.some((project) => project.id === id)) {
      throw new MoguriError("automation_project", "This automation's project is not in this profile. No other project or project-free chat was used.", 404);
    }
  }
  private next(schedule: AutomationSchedule, anchor: number, now: number): string {
    if (schedule.kind === "once") scheduledInstant({ kind: "at", at: schedule.at, timeZone: schedule.timeZone, localTime: schedule.localTime, offsetMinutes: schedule.offsetMinutes }, now);
    const next = nextAutomationOccurrence(schedule, anchor, now);
    if (next === null) throw new MoguriError("schedule_time", "This one-time automation is already in the past. Choose a future time.");
    return this.iso(next);
  }
  private controls(projectId: string | null, base: Controls | null, overrides: ControlDefaults = {}): Controls {
    let controls: Controls;
    if (!base) controls = this.host.startup(projectId, overrides).controls;
    else {
      controls = { ...base, ...overrides };
      if (overrides.autonomy !== undefined && overrides.autonomy !== base.autonomy) controls = selectAutonomyControls(controls, overrides.autonomy);
      if (overrides.modelId !== undefined && overrides.modelId !== base.modelId && overrides.modelOptions === undefined) delete controls.modelOptions;
    }
    this.host.validate(controls, projectId);
    return controls;
  }
  async execute(command: AutomationCommand, finish: WorkspaceFinish): Promise<CommandResult> {
    const intent = finish.intent;
    if (!intent && command.type !== "automation.pause" && command.type !== "automation.stop_run") {
      throw new MoguriError("automation_owner", "Automations need an actual-user command. No timer or model can create, change or start one.", 403);
    }
    const now = this.host.now(), at = this.iso(now);
    if (command.type === "automation.create") {
      this.project(command.projectId);
      if (this.snapshot().automations.length >= AUTOMATION_LIMIT) throw new MoguriError("automation_limit", `This profile already has ${AUTOMATION_LIMIT} automations. Delete one first.`, 409);
      const controls = this.controls(command.projectId, null, command.controls);
      validateAutomation(command.definition, controls.env, command.projectId !== null);
      const automation: Automation = { id: randomUUID(), revision: 0, profileId: this.snapshot().profileId, projectId: command.projectId,
        name: command.definition.name.trim(), schedule: structuredClone(command.definition.schedule), steps: structuredClone(command.definition.steps), controls,
        status: command.enabled ? "active" : "paused", anchorAt: command.enabled ? at : null,
        nextAt: command.enabled ? this.next(command.definition.schedule, now, now) : null, createdAt: at, updatedAt: at,
        commandId: intent!.id, commandDigest: intent!.digest, diagnostic: null };
      const result = finish([this.automationEvent(automation)], { id: automation.id, revision: 0 });
      return result;
    }
    if (command.type === "automation.stop_run") {
      const run = this.run(command.runId);
      if (!activeAutomationRun(run)) return finish([], { id: run.id, revision: run.revision });
      if (!run.sessionId) throw new MoguriError("automation_starting", "This run is still creating its chat. Stop it once the chat exists; nothing has run yet.", 409);
      finish([], { id: run.id });
      this.host.stop(run.sessionId);
      return { id: run.id };
    }
    const current = this.automation(command.automationId);
    if (current.status === "deleted") throw new MoguriError("automation_missing", "This automation was deleted.", 404);
    this.revision(current.revision, command.expectedRevision);
    const save = (changes: Partial<Automation>, extra: EventInput[] = []) => {
      const automation: Automation = { ...current, ...changes, revision: current.revision + 1, updatedAt: at,
        ...(intent ? { commandId: intent.id, commandDigest: intent.digest } : {}) };
      return finish([...extra, this.automationEvent(automation)], { id: automation.id, revision: automation.revision });
    };
    switch (command.type) {
      case "automation.update": {
        const controls = this.controls(current.projectId, current.controls, command.controls);
        validateAutomation(command.definition, controls.env, current.projectId !== null);
        const active = current.status === "active";
        return save({ name: command.definition.name.trim(), schedule: structuredClone(command.definition.schedule), steps: structuredClone(command.definition.steps),
          controls, anchorAt: active ? at : current.anchorAt, nextAt: active ? this.next(command.definition.schedule, now, now) : null, diagnostic: null });
      }
      case "automation.enable":
        if (current.status === "active") return finish([], { id: current.id, revision: current.revision });
        this.project(current.projectId);
        this.host.validate(current.controls, current.projectId);
        return save({ status: "active", anchorAt: at, nextAt: this.next(current.schedule, now, now), diagnostic: null });
      case "automation.pause":
        if (current.status === "paused") return finish([], { id: current.id, revision: current.revision });
        return save({ status: "paused", nextAt: null });
      case "automation.delete": {
        const active = this.activeRun(current.id);
        if (active && !command.stopRunning) throw new MoguriError("automation_running", "A run of this automation is still active. Stop it first, or confirm stopping it while deleting.", 409);
        if (active && !active.sessionId) throw new MoguriError("automation_starting", "A run is still creating its chat. Delete the automation once the chat exists.", 409);
        const result = save({ status: "deleted", nextAt: null });
        if (active?.sessionId) this.host.stop(active.sessionId);
        return result;
      }
      case "automation.run_now": {
        if (this.activeRun(current.id)) throw new MoguriError("automation_running", "A run of this automation is still active. Open or stop it before running it again.", 409);
        const run = this.newRun(current, "manual", now, 0, intent!.id);
        const result = finish([this.runEvent(run)], { id: run.id, revision: 0 });
        void this.launch(run);
        return result;
      }
      default: throw new MoguriError("automation_command", "Unknown automation command.");
    }
  }
  private newRun(automation: Automation, trigger: AutomationRun["trigger"], occurrence: number, missed: number, commandId: string, status: AutomationRunStatus = "starting", diagnostic: string | null = null): AutomationRun {
    const local = scheduleLocalTime(occurrence, automation.schedule.timeZone), at = this.iso();
    return { id: randomUUID(), revision: 0, profileId: automation.profileId, projectId: automation.projectId, automationId: automation.id,
      automationRevision: automation.revision, name: automation.name, trigger, occurrenceAt: this.iso(occurrence), timeZone: automation.schedule.timeZone,
      localTime: local.localTime, offsetMinutes: local.offsetMinutes, missed, controls: structuredClone(automation.controls),
      steps: structuredClone(automation.steps), progress: automation.steps.map(() => ({ status: status === "skipped" ? "skipped" as const : "pending" as const, itemId: null, turnId: null })),
      step: 0, status, sessionId: null, commandId, createdAt: at, updatedAt: at, diagnostic };
  }
  /** Due instants for the shared intake timer. */
  due(): number[] {
    return this.snapshot().automations.flatMap((automation) => automation.status === "active" && automation.nextAt ? [Date.parse(automation.nextAt)] : []);
  }
  /** Timer delivery: runs the latest due occurrence once, records missed and overlapping occurrences (D50). */
  fire(): void {
    const now = this.host.now();
    for (const automation of this.snapshot().automations.filter((value) => value.status === "active" && value.nextAt && Date.parse(value.nextAt) <= now)
      .sort((a, b) => Date.parse(a.nextAt!) - Date.parse(b.nextAt!) || a.id.localeCompare(b.id))) {
      const due = dueAutomationOccurrences(automation.schedule, Date.parse(automation.anchorAt ?? automation.createdAt), Date.parse(automation.nextAt!), now);
      const advanced: Automation = { ...automation, revision: automation.revision + 1, nextAt: due.next === null ? null : this.iso(due.next), updatedAt: this.iso(now) };
      const active = this.activeRun(automation.id);
      if (active) {
        const skipped = this.newRun(automation, "schedule", due.latest, due.missed, automation.commandId, "skipped",
          `The previous run (${active.id}) was still active, so this occurrence was skipped. Nothing ran.`);
        this.host.commit([this.automationEvent(advanced), this.runEvent(skipped)]);
        continue;
      }
      const run = this.newRun(automation, "schedule", due.latest, due.missed, automation.commandId);
      this.host.commit([this.automationEvent(advanced), this.runEvent(run)]);
      void this.launch(run);
    }
  }
  private update(run: AutomationRun, changes: Partial<AutomationRun>): AutomationRun {
    return { ...run, ...changes, revision: run.revision + 1, updatedAt: this.iso() };
  }
  /** Ends a run with `status`; the current and remaining steps settle without running. */
  private settle(run: AutomationRun, status: AutomationRunStatus, diagnostic: string | null, stepStatus: AutomationStepState["status"] = status === "blocked" ? "blocked" : status === "failed" ? "failed" : status === "partial" ? "partial" : "stopped"): AutomationRun {
    const progress = run.progress.map((state, index) => terminalStep(state) ? state : index === run.step && state.status !== "pending" ? { ...state, status: stepStatus } : { ...state, status: "skipped" as const });
    return this.update(run, { status, progress, diagnostic });
  }
  private async launch(run: AutomationRun): Promise<void> {
    if (this.launching.has(run.id)) return;
    this.launching.add(run.id);
    try {
      if (this.host.closing(run.projectId)) throw new MoguriError("automation_project", run.projectId === null ? "Moguri is shutting down. The run did not start." : "The project is being removed. The run did not start.", 409);
      this.project(run.projectId);
      this.host.validate(run.controls, run.projectId);
      if (run.steps.some((step) => step.kind === "script") && (run.projectId === null || !this.snapshot().repositoryTrusts.some((trust) => trust.projectId === run.projectId && trust.status === "trusted"))) {
        throw new MoguriError("automation_script_trust", "Script steps need this project's repository trust. Review it with /repo-trust, then run again; nothing ran.", 403);
      }
      const first = run.steps[0]!, itemId = randomUUID();
      const finish = this.host.finish(`automation-run-${run.id}`, digest(`automation-run:${run.id}`));
      await this.host.createSession({ type: "session.create", projectId: run.projectId, title: run.name, overrides: run.controls },
        Object.assign((events: EventInput[], result: CommandResult = {}) => {
          const created = events.find((event) => event.event_type === "session.created");
          const current = this.snapshot().automationRuns.find((value) => value.id === run.id);
          if (!created?.session_id || current?.status !== "starting") throw new MoguriError("automation_stopped", "The run ended before its chat was created. No chat or step was started.", 409);
          const progress = current.progress.map((state, index) => index === 0 ? { status: "queued" as const, itemId: first.kind === "prompt" ? itemId : null, turnId: null } : state);
          const next = this.update(current, { status: "running", sessionId: created.session_id, progress });
          const queued: EventInput[] = first.kind === "prompt" ? [this.enqueue(next, created.project_id ?? run.projectId, created.session_id, 0, itemId)] : [];
          return finish([...events, this.runEvent(next), ...queued], result);
        }, { intent: finish.intent }));
      this.host.wake();
      this.changed();
    } catch (error) {
      if (!(error instanceof MoguriError)) console.error("Automation run launch failed:", error);
      const current = this.snapshot().automationRuns.find((value) => value.id === run.id);
      if (current?.status === "starting") {
        try { this.host.commit([this.runEvent(this.settle(current, "blocked", safeDiagnostic(error)))]); }
        catch (persistence) { console.error("Automation run outcome could not be retained:", persistence instanceof Error ? persistence.message : persistence); }
      }
    } finally { this.launching.delete(run.id); }
  }
  private enqueue(run: AutomationRun, projectId: string | null, sessionId: string, step: number, itemId: string): EventInput {
    const prompt = run.steps[step]!;
    const item: QueueItem = { id: itemId, text: prompt.kind === "prompt" ? prompt.text : "", attachments: [], delivery: "queue",
      automation: { automationId: run.automationId, runId: run.id, step } };
    return { event_type: "queue.enqueued", profile_id: run.profileId, project_id: projectId, session_id: sessionId, payload: { item } };
  }
  /** Step progression from committed turn, queue and session events; appended in the same transaction. */
  derived(next: Snapshot, primary: StoredEvent[]): EventInput[] {
    if (!next.automationRuns.some(activeAutomationRun)) return [];
    const runs = new Map(next.automationRuns.filter((run) => run.status === "running").map((run) => [run.id, run]));
    const out: EventInput[] = [];
    const save = (run: AutomationRun, extra: EventInput[] = []) => { runs.set(run.id, run); out.push(this.runEvent(run), ...extra); };
    const owning = (sessionId: string | null | undefined) => [...runs.values()].find((run) => run.status === "running" && run.sessionId === sessionId);
    for (const event of primary) {
      if (event.event_type === "turn.started" && event.payload.item.automation && event.turn_id) {
        const marker = event.payload.item.automation, run = runs.get(marker.runId);
        if (!run || run.status !== "running" || run.step !== marker.step || run.sessionId !== event.session_id || run.progress[run.step]?.status !== "queued") continue;
        const progress = run.progress.map((state, index) => index === run.step ? { ...state, status: "running" as const, turnId: event.turn_id! } : state);
        save(this.update(run, { progress }));
        continue;
      }
      if (event.event_type === "turn.finished") {
        const run = owning(event.session_id), state = run?.progress[run.step];
        if (!run || !state || state.status !== "running" || state.turnId !== event.turn_id) continue;
        const outcome = event.payload.outcome, failure = event.payload.modelFailureId ? next.modelFailures.find((value) => value.id === event.payload.modelFailureId) : undefined;
        // Automatic model recovery retries this same turn; the run settles once that recovery succeeds or gives up.
        if (outcome === "failed" && failure && ["pending", "retrying"].includes(failure.status)) continue;
        if (outcome !== "completed") {
          save(this.settle(run, outcome, event.payload.diagnostic ?? `Step ${run.step + 1} ended ${outcome}. Later steps did not run.`, outcome));
          continue;
        }
        const progress = run.progress.map((value, index) => index === run.step ? { ...value, status: "completed" as const } : value);
        if (run.step + 1 >= run.steps.length) { save(this.update(run, { progress, step: run.steps.length, status: "completed", diagnostic: null })); continue; }
        const step = run.step + 1, itemId = randomUUID(), prompt = run.steps[step]!.kind === "prompt";
        progress[step] = { status: "queued", itemId: prompt ? itemId : null, turnId: null };
        const advanced = this.update(run, { progress, step });
        const session = next.sessions.find((value) => value.id === run.sessionId);
        save(advanced, prompt && session ? [this.enqueue(advanced, session.projectId, session.id, step, itemId)] : []);
        continue;
      }
      if (event.event_type === "queue.removed" || event.event_type === "queue.held") {
        const ids = event.event_type === "queue.removed" ? [event.payload.messageId] : event.payload.messageIds;
        const run = owning(event.session_id), state = run?.progress[run.step];
        if (!run || state?.status !== "queued" || !state.itemId || !ids.includes(state.itemId)) continue;
        save(this.settle(run, "stopped", `Step ${run.step + 1} was removed or held before it started. Later steps did not run.`),
          event.event_type === "queue.held" ? [{ event_type: "queue.removed", profile_id: run.profileId, project_id: event.project_id ?? null, session_id: event.session_id!, payload: { messageId: state.itemId } }] : []);
        continue;
      }
      if (event.event_type === "session.archived" || event.event_type === "session.deleted") {
        const sessionId = event.event_type === "session.deleted" ? event.payload.deletedSessionId : event.session_id;
        const run = owning(sessionId);
        if (!run || run.progress[run.step]?.status === "running") continue;
        save(this.settle(run, "stopped", `The run's chat was ${event.event_type === "session.deleted" ? "deleted" : "archived"} before step ${run.step + 1} started.`));
      }
    }
    for (const run of this.failedRecoveries(next, runs.values())) save(run);
    return out;
  }
  /** Runs whose step turn ended in a model failure that automatic recovery has since given up on. */
  private failedRecoveries(snapshot: Snapshot, runs: Iterable<AutomationRun>): AutomationRun[] {
    return [...runs].flatMap((run) => {
      const state = run.progress[run.step];
      if (run.status !== "running" || state?.status !== "running" || !state.turnId) return [];
      if (snapshot.sessions.find((session) => session.id === run.sessionId)?.turnId === state.turnId) return [];
      const failure = snapshot.modelFailures.findLast((value) => value.sessionId === run.sessionId && value.turnId === state.turnId);
      if (!failure || ["pending", "retrying", "recovered"].includes(failure.status)) return [];
      return [this.settle(run, "failed", failure.diagnostic, "failed")];
    });
  }
  /** Explicit Stop in the run's chat ends a run whose current step has not started. */
  stopSession(sessionId: string): void {
    const run = this.snapshot().automationRuns.find((value) => value.status === "running" && value.sessionId === sessionId);
    const state = run?.progress[run.step];
    if (!run || state?.status !== "queued") return;
    const session = this.snapshot().sessions.find((value) => value.id === sessionId);
    this.host.commit([this.runEvent(this.settle(run, "stopped", `Stopped by the user before step ${run.step + 1} started. Later steps did not run.`)),
      ...(state.itemId && session?.queue.some((item) => item.id === state.itemId) ? [{ event_type: "queue.removed" as const, profile_id: run.profileId,
        project_id: session.projectId, session_id: sessionId, payload: { messageId: state.itemId } }] : [])]);
  }
  /** Starts queued script steps once their chat is idle, and settles runs whose model recovery gave up. */
  changed(): void {
    if (!this.sweeping && this.failedRecoveries(this.snapshot(), this.snapshot().automationRuns).length) {
      this.sweeping = true;
      queueMicrotask(() => {
        this.sweeping = false;
        try {
          const settled = this.failedRecoveries(this.snapshot(), this.snapshot().automationRuns);
          if (settled.length) this.host.commit(settled.map((run) => this.runEvent(run)));
        } catch (error) { console.error("Automation run failure could not be retained:", error instanceof Error ? error.message : error); }
      });
    }
    for (const run of this.snapshot().automationRuns) {
      const step = run.steps[run.step];
      if (run.status !== "running" || step?.kind !== "script" || run.progress[run.step]?.status !== "queued" || !run.sessionId || this.scripts.has(run.id)) continue;
      const session = this.snapshot().sessions.find((value) => value.id === run.sessionId);
      if (!session || session.turnId || session.queue.length || session.pendingApproval || session.pendingQuestionId || !this.host.startable(session.id)) continue;
      void this.startScript(run, session.id);
    }
  }
  private async startScript(run: AutomationRun, sessionId: string): Promise<void> {
    const step = run.steps[run.step];
    if (step?.kind !== "script") return;
    this.scripts.add(run.id);
    const index = run.step, identity = { id: `automation-${run.id}-${index}`, digest: digest(JSON.stringify(["automation-script-v1", run.id, index, step])) };
    const owns = () => {
      const current = this.snapshot().automationRuns.find((value) => value.id === run.id);
      if (current?.status !== "running" || current.step !== index || current.progress[index]?.status !== "queued") {
        throw new MoguriError("automation_stopped", "This automation step no longer owns its run. Nothing was started.", 409);
      }
    };
    try {
      if (this.snapshot().jobs.some((job) => job.toolingIntent?.id === identity.id)) throw new MoguriError("automation_no_replay", "This script step already has a retained intent. It was not started again.", 409);
      owns();
      await this.host.startScript({ sessionId, identity, guard: owns, item: { automationId: run.automationId, runId: run.id, step: index },
        text: automationStepText(run.name, index, run.steps.length, step),
        call: { id: randomUUID(), name: "run_script", arguments: { path: step.path, interpreter: step.interpreter, ...(step.args?.length ? { args: step.args } : {}) } } });
    } catch (error) {
      if (error instanceof MoguriError && busyCodes.has(error.code)) return;
      if (!(error instanceof MoguriError)) console.error("Automation script step admission failed:", error);
      const current = this.snapshot().automationRuns.find((value) => value.id === run.id);
      if (current?.status === "running" && current.step === index && current.progress[index]?.status === "queued") {
        try { this.host.commit([this.runEvent(this.settle(current, "blocked", safeDiagnostic(error)))]); }
        catch (persistence) { console.error("Automation script outcome could not be retained:", persistence instanceof Error ? persistence.message : persistence); }
      }
    } finally { this.scripts.delete(run.id); }
  }
  /** Restart: unfinished chat creation is partial and unstarted script steps are blocked; nothing is replayed. */
  recover(): EventInput[] {
    return this.snapshot().automationRuns.flatMap((run) => {
      if (run.status === "starting") return [this.runEvent(this.settle(run, "partial", run.projectId === null ?
        "Moguri restarted while this run was creating its project-free chat. Nothing was replayed." :
        "Moguri restarted while this run was creating its chat. Check the project for a partial worktree; nothing was replayed."))];
      if (run.status === "running" && run.steps[run.step]?.kind === "script" && run.progress[run.step]?.status === "queued") {
        return [this.runEvent(this.settle(run, "blocked", `Moguri restarted before step ${run.step + 1} started. Nothing ran; use Run now to start a new run.`))];
      }
      return [];
    });
  }
}
