import {
  MoguriError, PERSONA_LIMIT, PERSONA_MENTION_LIMIT, PERSONA_TASK_MAX_BYTES, activePersonaRun, isProjectWorkItem, personaMentions, personaTask,
  validatePersonaDefinition,
  type CommandResult, type Controls, type EventInput, type Persona, type PersonaCommand, type PersonaRun, type QueueItem, type Session,
  type Snapshot, type StoredEvent,
} from "../../../packages/protocol/src/index.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import { digest } from "./store.ts";

export interface PersonaLaunch {
  run: PersonaRun; persona: Persona; parent: Session; controls: Controls; task: string;
  /** The run update committed with the child, its link, task message and queue item. */
  started(childSessionId: string, childItemId: string): EventInput;
}
interface Host {
  snapshot(): Snapshot;
  commit(events: EventInput[]): void;
  finish(id: string, digest: string): WorkspaceFinish;
  now(): number;
  /** The tagged input exactly as its turn started. */
  sourceText(sessionId: string, turnId: string): string | null;
  /** Current policy, allowed Env and model availability for the persona's captured controls; never substitutes. */
  validate(controls: Controls, parent: Session): void;
  /** The parent's controls narrowed for a persona child: its model, the stricter budget and Manual autonomy. */
  controls(parent: Session, persona: Persona): Controls;
  /** Creates the linked child, its user-delegated task and the run update in one transaction. */
  spawn(launch: PersonaLaunch, finish: WorkspaceFinish): CommandResult;
  notice(run: PersonaRun): EventInput[];
  stop(sessionId: string): void;
  closing(): boolean;
}
/**
 * Only the user's own input (typed, held, queued or scheduled) or an automation's saved prompt step can tag a persona.
 * Delegated tasks, lifecycle notices, commands, workflows and service-built prompts (project work items embed
 * untrusted issue text) never do; neither do subagent, side or metachat sessions.
 */
const sourceItem = (item: QueueItem) => !item.origin && !item.lifecycle && !item.command && !item.spawnPromptOrigin && !item.sidePromptOrigin &&
  !item.workflow && item.delivery === "queue" && !isProjectWorkItem(item.id);
const safeDiagnostic = (error: unknown) => (error instanceof MoguriError ? error.message :
  "The persona's chat could not be created. Nothing ran; inspect the tagging chat and try again.").slice(0, 3900);

/**
 * Continuous, taggable personas (#10, D67). A mention of an enabled persona starts one linked subsession under the
 * tagging chat (the orchestrator) with Manual autonomy; the run follows that exact task item and turn.
 */
export class PersonaRuntime {
  private ready = false;
  private sweeping = false;
  private readonly launching = new Set<string>();
  constructor(private readonly host: Host) {}
  private snapshot() { return this.host.snapshot(); }
  private iso(at = this.host.now()) { return new Date(at).toISOString(); }
  private persona(id: string): Persona {
    const persona = this.snapshot().personas.find((value) => value.id === id);
    if (!persona) throw new MoguriError("persona_missing", "This persona is not in the connected profile.", 404);
    return persona;
  }
  private run(id: string): PersonaRun {
    const run = this.snapshot().personaRuns.find((value) => value.id === id);
    if (!run) throw new MoguriError("persona_run_missing", "This persona run is not in the connected profile.", 404);
    return run;
  }
  private personaEvent(persona: Persona): EventInput { return { event_type: "persona.recorded", profile_id: persona.profileId, payload: { persona } }; }
  private runEvent(run: PersonaRun): EventInput { return { event_type: "persona.run_recorded", profile_id: run.profileId, payload: { run } }; }
  private update(run: PersonaRun, changes: Partial<PersonaRun>): PersonaRun { return { ...run, ...changes, revision: run.revision + 1, updatedAt: this.iso() }; }
  private revision(actual: number, expected: number) {
    if (actual !== expected) throw new MoguriError("revision_conflict", "Another client changed this persona. Reload it before editing.", 409);
  }
  private handle(handle: string, except?: string) {
    if (this.snapshot().personas.some((persona) => persona.id !== except && persona.handle === handle)) {
      throw new MoguriError("persona_handle", `@${handle} is already used by another persona. Choose another handle.`, 409);
    }
  }
  private scope(projectId: string | null) {
    if (projectId !== null && !this.snapshot().projects.some((project) => project.id === projectId)) {
      throw new MoguriError("persona_project", "Choose a project of this profile, or no project for every chat.", 404);
    }
  }
  async execute(command: PersonaCommand, finish: WorkspaceFinish): Promise<CommandResult> {
    const intent = finish.intent;
    if (!intent) throw new MoguriError("persona_owner", "Personas need an actual-user command. A mention, model or timer cannot create, enable or change one.", 403);
    const at = this.iso();
    if (command.type === "persona.create") {
      if (this.snapshot().personas.length >= PERSONA_LIMIT) throw new MoguriError("persona_limit", `This profile already has ${PERSONA_LIMIT} personas. Delete one first.`, 409);
      const definition = validatePersonaDefinition(command.definition);
      this.handle(definition.handle); this.scope(definition.projectId);
      const persona: Persona = { version: 1, id: digest(JSON.stringify(["persona", intent.id])), revision: 0, profileId: this.snapshot().profileId,
        preset: command.preset ?? null, ...definition, status: "disabled", commandId: intent.id, commandDigest: intent.digest, createdAt: at, updatedAt: at };
      if (this.snapshot().personas.some((value) => value.id === persona.id)) return { id: persona.id, revision: 0 };
      return finish([this.personaEvent(persona)], { id: persona.id, revision: 0 });
    }
    if (command.type === "persona.run.stop") return this.stopRun(this.run(command.runId), "user", finish);
    const current = this.persona(command.personaId);
    this.revision(current.revision, command.expectedRevision);
    const next = (changes: Partial<Persona>): Persona => ({ ...current, ...changes, revision: current.revision + 1, commandId: intent.id, commandDigest: intent.digest, updatedAt: at });
    if (command.type === "persona.update") {
      const definition = validatePersonaDefinition(command.definition);
      this.handle(definition.handle, current.id); this.scope(definition.projectId);
      const persona = next(definition);
      return finish([this.personaEvent(persona)], { id: persona.id, revision: persona.revision });
    }
    if (command.type === "persona.enable" || command.type === "persona.pause") {
      const status = command.type === "persona.enable" ? "enabled" as const : current.status === "disabled" ? "disabled" as const : "paused" as const;
      if (current.status === status) return finish([], { id: current.id, revision: current.revision });
      const persona = next({ status });
      return finish([this.personaEvent(persona)], { id: persona.id, revision: persona.revision });
    }
    const active = this.snapshot().personaRuns.filter((run) => run.personaId === current.id && activePersonaRun(run));
    if (active.length && !command.stopRunning) throw new MoguriError("persona_running", `@${current.handle} has ${active.length} active run${active.length === 1 ? "" : "s"}. Confirm stopping ${active.length === 1 ? "it" : "them"} to delete the persona.`, 409);
    const persona = next({ status: "deleted" });
    const result = finish([this.personaEvent(persona)], { id: persona.id, revision: persona.revision });
    for (const run of active) {
      try { await this.stopRun(this.run(run.id), "deleted", this.host.finish(`persona-stop-${run.id}`, digest(`persona-stop:${run.id}:deleted`))); }
      catch (error) { console.error("A deleted persona's run could not be stopped:", error instanceof MoguriError ? error.code : error); }
    }
    return result;
  }
  /** Stops only the run's own task: a queued task is removed; a running task's turn is stopped and settles from its actual outcome. */
  private stopRun(run: PersonaRun, reason: "user" | "timeout" | "deleted", finish: WorkspaceFinish): CommandResult {
    if (!activePersonaRun(run)) return finish([], { id: run.id, revision: run.revision });
    const why = reason === "timeout" ? "reached its time limit" : reason === "deleted" ? "was stopped because its persona was deleted" : "was stopped by the user";
    if (run.status === "starting") return finish([this.runEvent(this.update(run, { status: "stopped", stopRequested: reason,
      diagnostic: `The run ${why} before its chat was created. Nothing ran.` }))], { id: run.id });
    const child = this.snapshot().sessions.find((session) => session.id === run.childSessionId);
    if (run.childTurnId === null) {
      const queued = child?.queue.some((item) => item.id === run.childItemId);
      return finish([...(queued && child ? [{ event_type: "queue.removed" as const, profile_id: run.profileId, project_id: child.projectId, session_id: child.id,
        payload: { messageId: run.childItemId! } }] : []),
      this.runEvent(this.update(run, { status: "stopped", stopRequested: reason, diagnostic: `The run ${why} before its task started. Its queued task was removed; nothing ran.` }))], { id: run.id });
    }
    if (run.stopRequested) return finish([], { id: run.id, revision: run.revision });
    // A failed task still open to automatic model recovery has no running turn; stopping the idle chat cancels that retry.
    // A newer turn in the chat (the user's or the orchestrator's) is never stopped for this run.
    const recovering = this.snapshot().modelFailures.some((failure) => failure.sessionId === run.childSessionId && failure.turnId === run.childTurnId &&
      ["pending", "retrying", "exhausted", "blocked"].includes(failure.status));
    const result = finish([this.runEvent(this.update(run, { stopRequested: reason }))], { id: run.id });
    if (child && (child.turnId === run.childTurnId || recovering && child.turnId === null)) this.host.stop(child.id);
    return result;
  }
  /** Run creation from tagged input and progression from the exact child task, in the same transaction. */
  derived(next: Snapshot, primary: StoredEvent[]): EventInput[] {
    const events: EventInput[] = [], runs = new Map(next.personaRuns.map((run) => [run.id, run]));
    const save = (run: PersonaRun) => { runs.set(run.id, run); events.push(this.runEvent(run)); };
    const owning = (predicate: (run: PersonaRun) => boolean) => [...runs.values()].find((run) => run.status === "running" && predicate(run));
    for (const event of primary) {
      if (event.event_type === "turn.started" && event.session_id && event.turn_id) {
        const child = owning((run) => run.childSessionId === event.session_id && run.childTurnId === null && run.childItemId === event.payload.item.id);
        if (child) { save(this.update(child, { childTurnId: event.turn_id })); continue; }
        const item = event.payload.item, session = next.sessions.find((value) => value.id === event.session_id);
        if (!session || session.kind !== "agent" || !sourceItem(item) || !next.personas.some((persona) => persona.status === "enabled")) continue;
        // An automation counts only for its saved prompt steps; a script step's tool turn is service text.
        if (item.automation && next.automationRuns.find((value) => value.id === item.automation!.runId)?.steps[item.automation.step]?.kind !== "prompt") continue;
        const actor = item.automation ? "automation" as const : "user" as const;
        const automationRunId = item.automation?.runId ?? null;
        for (const handle of personaMentions(item.text).slice(0, PERSONA_MENTION_LIMIT)) {
          const persona = next.personas.find((value) => value.handle === handle && value.status === "enabled" && value.mention &&
            (value.projectId === null || value.projectId === session.projectId));
          if (!persona) continue;
          const id = digest(JSON.stringify(["persona-run", event.turn_id, persona.id]));
          if (runs.has(id)) continue;
          const at = event.timestamp;
          save({ version: 1, id, revision: 0, profileId: next.profileId, personaId: persona.id, personaRevision: persona.revision, handle: persona.handle,
            name: persona.name, trigger: actor === "automation" ? "automation" : "mention",
            source: { sessionId: session.id, turnId: event.turn_id, itemId: item.id, actor, automationRunId },
            projectId: session.projectId, childSessionId: null, childItemId: null, childTurnId: null, stopRequested: null, controls: null, deadlineAt: null,
            status: "starting", createdAt: at, updatedAt: at, diagnostic: null });
        }
        continue;
      }
      if (event.event_type === "turn.finished" && event.turn_id) {
        const run = owning((value) => value.childTurnId === event.turn_id && value.childSessionId === event.session_id);
        if (!run) continue;
        const outcome = event.payload.outcome, failure = event.payload.modelFailureId ? next.modelFailures.find((value) => value.id === event.payload.modelFailureId) : undefined;
        // Automatic model recovery retries this same turn; the run settles once recovery succeeds or gives up.
        if (outcome === "failed" && failure && ["pending", "retrying"].includes(failure.status)) continue;
        const status = outcome === "completed" ? "completed" as const : outcome === "failed" ? "failed" as const : outcome === "stopped" ? "stopped" as const : "partial" as const;
        const why = run.stopRequested === "timeout" ? " after reaching its time limit" : run.stopRequested === "deleted" ? " because its persona was deleted" : run.stopRequested === "user" ? " by the user" : "";
        save(this.update(run, { status, diagnostic: status === "completed" ? null :
          (event.payload.diagnostic ?? `The persona's task ended ${outcome}${why}.`).slice(0, 4000) }));
        continue;
      }
      if (event.event_type === "queue.removed" || event.event_type === "queue.held") {
        const ids = event.event_type === "queue.removed" ? [event.payload.messageId] : event.payload.messageIds;
        const run = owning((value) => value.childSessionId === event.session_id && value.childTurnId === null && ids.includes(value.childItemId ?? ""));
        if (!run) continue;
        save(this.update(run, { status: "stopped", diagnostic: event.event_type === "queue.held" ?
          "The persona's chat was stopped before its task started. The task was removed; nothing ran." :
          "The persona's task was removed from its chat before it started. Nothing ran." }));
        if (event.event_type === "queue.held") events.push({ event_type: "queue.removed", profile_id: run.profileId, project_id: event.project_id ?? null,
          session_id: event.session_id!, payload: { messageId: run.childItemId! } });
        continue;
      }
      if (event.event_type === "session.archived" || event.event_type === "session.deleted") {
        const sessionId = event.event_type === "session.deleted" ? event.payload.deletedSessionId : event.session_id;
        const run = owning((value) => value.childSessionId === sessionId);
        if (!run) continue;
        const working = run.childTurnId !== null && event.event_type === "session.deleted";
        if (run.childTurnId === null || working) save(this.update(run, { status: working ? "partial" : "stopped",
          diagnostic: working ? "The persona's chat was deleted while its task was running. Its cleanup follows the chat's own deletion outcome." :
            `The persona's chat was ${event.event_type === "session.deleted" ? "deleted" : "archived"} before its task started. Nothing ran.` }));
      }
    }
    for (const run of this.failedRecoveries(next, runs.values())) save(run);
    return events;
  }
  /**
   * Runs whose task turn failed and whose recovery ended for good (`blocked` or `cancelled`) without another outcome.
   * `exhausted` can return to `pending` when another retry succeeds, so it keeps the run (and its time limit) active.
   */
  private failedRecoveries(snapshot: Snapshot, runs: Iterable<PersonaRun>): PersonaRun[] {
    return [...runs].flatMap((run) => {
      if (run.status !== "running" || !run.childTurnId) return [];
      if (snapshot.sessions.find((session) => session.id === run.childSessionId)?.turnId === run.childTurnId) return [];
      const failure = snapshot.modelFailures.findLast((value) => value.sessionId === run.childSessionId && value.turnId === run.childTurnId);
      if (!failure || !["blocked", "cancelled"].includes(failure.status)) return [];
      return [this.update(run, run.stopRequested ? { status: "stopped", diagnostic: `The persona's task failed and its retry was stopped (${run.stopRequested === "timeout" ? "time limit" : run.stopRequested === "deleted" ? "persona deleted" : "user"}). ${failure.diagnostic}`.slice(0, 4000) } :
        { status: "failed", diagnostic: failure.diagnostic.slice(0, 4000) })];
    });
  }
  /** Called after recovery: launches only from then on, one sweep at a time. */
  start(): void { this.ready = true; this.changed(); }
  changed(): void {
    const state = this.snapshot();
    if (!this.ready || this.sweeping || !state.personaRuns.some((run) => run.status === "starting") && !this.failedRecoveries(state, state.personaRuns).length) return;
    this.sweeping = true;
    queueMicrotask(() => {
      this.sweeping = false;
      try {
        const settled = this.failedRecoveries(this.snapshot(), this.snapshot().personaRuns);
        if (settled.length) this.host.commit(settled.map((run) => this.runEvent(run)));
      } catch (error) { console.error("Persona run failure could not be retained:", error instanceof Error ? error.message : error); }
      for (const run of this.snapshot().personaRuns.filter((value) => value.status === "starting")) this.launch(run.id);
    });
  }
  private launch(runId: string): void {
    if (this.launching.has(runId)) return;
    this.launching.add(runId);
    try {
      const run = this.run(runId);
      if (run.status !== "starting") return;
      if (this.host.closing()) throw new MoguriError("persona_closing", "Moguri is shutting down. The persona did not start; nothing ran.", 409);
      const persona = this.snapshot().personas.find((value) => value.id === run.personaId);
      if (!persona || persona.status !== "enabled" || persona.revision !== run.personaRevision) {
        throw new MoguriError("persona_changed", `@${run.handle} was changed, paused or deleted before its chat was created. Nothing ran.`, 409);
      }
      const parent = this.snapshot().sessions.find((session) => session.id === run.source.sessionId);
      if (!parent || parent.status === "archived") throw new MoguriError("persona_source", "The tagging chat is no longer available. Nothing ran.", 409);
      if (persona.access === "agent" && (parent.kind !== "agent" || parent.mode !== "agent" || parent.pendingMode === "read-only")) {
        throw new MoguriError("persona_read_only", `@${persona.handle} needs a writable agent chat, but the tagging chat is read-only. Nothing ran; tag it from an agent chat or make the persona read-only.`, 409);
      }
      if (parent.controls.env === "Sandbox" || parent.repositories) throw new MoguriError("persona_boundary", "Persona subsessions are not qualified for Sandbox or grouped-repository chats. Nothing ran and nothing fell back to Local.", 409);
      const text = this.host.sourceText(run.source.sessionId, run.source.turnId);
      if (text === null) throw new MoguriError("persona_source", "The tagged message's original turn is unavailable. Nothing ran.", 409);
      const task = personaTask(persona, { title: parent.title, text, actor: run.source.actor });
      if (Buffer.byteLength(task) > PERSONA_TASK_MAX_BYTES) throw new MoguriError("persona_task", `The tagged message plus @${persona.handle}'s brief exceed ${PERSONA_TASK_MAX_BYTES.toLocaleString("en-US")} bytes. Nothing was truncated or started; tag the persona with a shorter message.`, 409);
      const controls = this.host.controls(parent, persona);
      this.host.validate(controls, parent);
      const finish = this.host.finish(`persona-run-${run.id}`, digest(`persona-run:${run.id}`));
      this.host.spawn({ run, persona, parent, controls, task, started: (childSessionId, childItemId) => {
        const current = this.run(run.id);
        if (current.status !== "starting") throw new MoguriError("persona_stopped", "This run ended before its chat was created. Nothing ran.", 409);
        return this.runEvent(this.update(current, { status: "running", childSessionId, childItemId, controls,
          deadlineAt: this.iso(this.host.now() + persona.timeoutMinutes * 60_000) }));
      } }, finish);
      try {
        const notice = this.host.notice(this.run(run.id));
        if (notice.length) this.host.commit(notice);
      } catch (error) { console.error("Persona dispatch notice could not be delivered:", error instanceof MoguriError ? error.code : error); }
    } catch (error) {
      if (!(error instanceof MoguriError)) console.error("Persona run failed to start:", error);
      const current = this.snapshot().personaRuns.find((value) => value.id === runId);
      if (current?.status === "starting") {
        try { this.host.commit([this.runEvent(this.update(current, { status: "blocked", diagnostic: safeDiagnostic(error) }))]); }
        catch (persistence) { console.error("Persona run outcome could not be retained:", persistence instanceof Error ? persistence.message : persistence); }
      }
    } finally { this.launching.delete(runId); }
  }
  /** Time-limit deadlines for the shared intake timer. */
  due(): number[] {
    return this.snapshot().personaRuns.flatMap((run) => run.status === "running" && run.deadlineAt && !run.stopRequested ? [Date.parse(run.deadlineAt)] : []);
  }
  fire(): void {
    const now = this.host.now();
    for (const run of this.snapshot().personaRuns.filter((value) => value.status === "running" && value.deadlineAt && !value.stopRequested && Date.parse(value.deadlineAt) <= now)) {
      try { this.stopRun(run, "timeout", this.host.finish(`persona-stop-${run.id}`, digest(`persona-stop:${run.id}:timeout`))); }
      catch (error) { console.error("A persona run past its time limit could not be stopped:", error instanceof MoguriError ? error.code : error); }
    }
  }
  /** Restart: a run that never created its chat is blocked, never replayed. Started tasks settle through the existing turn recovery. */
  recover(): EventInput[] {
    return this.snapshot().personaRuns.flatMap((run) => run.status === "starting" ? [this.runEvent(this.update(run, { status: "blocked",
      diagnostic: "Moguri restarted before this persona's chat was created. Nothing ran or was replayed; tag the persona again." }))] : []);
  }
}
