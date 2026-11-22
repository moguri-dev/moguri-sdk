import { randomUUID } from "node:crypto";
import {
  MoguriError, ROUNDUP_SETTINGS_ID, activeRoundupRun, myWorkItemId, dueAutomationOccurrences, isRoundupAuthor, nextAutomationOccurrence, parse,
  parseDependencyUpdate, roundupGroups, roundupProblem, scheduledInstant, validateRoundupBots, RoundupQuerySchema,
  type AutomationSchedule, type CommandResult, type EventInput, type MyWorkEntry, type MyWorkObservation, type MyWorkRefresh,
  type MyWorkRefreshTrigger, type RoundupCommand, type RoundupQuery, type RoundupResponse, type RoundupRun, type RoundupSettings,
  type RoundupSourceState, type RoundupSummary, type RoundupUpdate, type Snapshot, type StoredEvent,
} from "../../../packages/protocol/src/index.ts";
import type { MyWorkRuntime } from "./my-work.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import { digest } from "./store.ts";

interface Host {
  snapshot(): Snapshot;
  commit(events: EventInput[]): void;
  /** A canonical command identity for timer-started work, like automation runs (D50). */
  finish(id: string, digest: string): WorkspaceFinish;
  now(): number;
  myWork(): MyWorkRuntime;
  /** The existing job cancellation path; it stops only that job's own readers. */
  cancel(jobId: string, finish: WorkspaceFinish): Promise<CommandResult>;
  closing(): boolean;
}
const MAX_BYTES = 8 * 1024 * 1024;
const failingChecks = new Set(["failure", "cancelled", "timed-out"]);
const safeDiagnostic = (error: unknown) => (error instanceof MoguriError ? error.message :
  "The roundup could not start its inbox refresh. Nothing was read; inspect My Work sources and try again.").slice(0, 3900);

/**
 * Dependency update roundups (#8, D66): a read-only, model-free view of update-bot PRs over My Work's retained
 * observations, with manual and scheduled runs that each own exactly one My Work refresh.
 */
export class DependencyRoundupRuntime {
  private readonly launching = new Set<string>();
  constructor(private readonly host: Host) {}
  private snapshot() { return this.host.snapshot(); }
  private iso(at = this.host.now()) { return new Date(at).toISOString(); }
  private settings(): RoundupSettings | null { return this.snapshot().dependencyRoundup ?? null; }
  private settingsEvent(settings: RoundupSettings): EventInput {
    return { event_type: "dependency_roundup.recorded", profile_id: settings.profileId, payload: { settings } };
  }
  private runEvent(run: RoundupRun): EventInput {
    return { event_type: "dependency_roundup.run_recorded", profile_id: run.profileId, payload: { run } };
  }
  private run(id: string): RoundupRun {
    const run = this.snapshot().dependencyRoundupRuns.find((value) => value.id === id);
    if (!run) throw new MoguriError("roundup_run_missing", "This roundup run is not in the connected profile.", 404);
    return run;
  }
  private active(): RoundupRun | undefined { return this.snapshot().dependencyRoundupRuns.find(activeRoundupRun); }
  private next(schedule: AutomationSchedule, anchor: number, now: number): string {
    if (schedule.kind === "once") scheduledInstant({ kind: "at", at: schedule.at, timeZone: schedule.timeZone, localTime: schedule.localTime, offsetMinutes: schedule.offsetMinutes }, now);
    const next = nextAutomationOccurrence(schedule, anchor, now);
    if (next === null) throw new MoguriError("schedule_time", "This one-time roundup is already in the past. Choose a future time.");
    return this.iso(next);
  }
  private sources(ids: readonly string[]): void {
    const state = this.snapshot();
    const missing = ids.filter((id) => !state.myWorkSources.some((source) => source.id === id && source.profileId === state.profileId && source.enabled));
    if (missing.length) throw new MoguriError("roundup_sources", "Choose enabled My Work sources of this profile. Configure repositories in My Work first; no other repository or account was used.", 409);
  }
  /** Wraps a finish so a run attaches only to the refresh, job and receipt admitted in this same transaction. */
  private owned(finish: WorkspaceFinish, run: (refreshId: string) => RoundupRun): WorkspaceFinish {
    return Object.assign((events: EventInput[], result: CommandResult = {}) => {
      const refresh = events.find((event) => event.event_type === "my_work.refresh_recorded");
      if (refresh?.event_type !== "my_work.refresh_recorded" || refresh.payload.refresh.revision !== 0 || refresh.payload.refresh.id !== result.id ||
        !events.some((event) => event.event_type === "job.started")) {
        throw new MoguriError("roundup_busy", "Another My Work refresh of these sources is already running and belongs to someone else. This roundup did not adopt it; wait for it and query again.", 409);
      }
      const owned = run(result.id);
      return finish([...events, this.runEvent(owned)], { id: owned.id });
    }, { intent: finish.intent });
  }
  async execute(command: RoundupCommand, finish: WorkspaceFinish): Promise<CommandResult> {
    const intent = finish.intent;
    if (!intent) throw new MoguriError("roundup_owner", "Dependency roundups need an actual-user command. No timer or model can configure or start one.", 403);
    const now = this.host.now(), at = this.iso(now), current = this.settings();
    if (command.type === "dependency_roundup.configure") {
      if ((current?.revision ?? null) !== command.expectedRevision) throw new MoguriError("revision_conflict", "Another client changed the roundup settings. Reload them before saving.", 409);
      const bots = validateRoundupBots(command.bots);
      this.sources(command.sourceIds);
      const active = command.scheduleEnabled && command.schedule !== null;
      if (command.scheduleEnabled && !command.schedule) throw new MoguriError("roundup_schedule", "Choose a schedule before turning on scheduled roundups.");
      const settings: RoundupSettings = { version: 1, id: ROUNDUP_SETTINGS_ID, revision: (current?.revision ?? -1) + 1, profileId: this.snapshot().profileId,
        bots, sourceIds: [...command.sourceIds], schedule: structuredClone(command.schedule), status: active ? "active" : "paused",
        anchorAt: active ? at : null, nextAt: active ? this.next(command.schedule!, now, now) : null,
        commandId: intent.id, commandDigest: intent.digest, createdAt: current?.createdAt ?? at, updatedAt: at };
      return finish([this.settingsEvent(settings)], { id: settings.id, revision: settings.revision });
    }
    if (command.type === "dependency_roundup.schedule") {
      if (!current) throw new MoguriError("roundup_settings", "Configure dependency roundups first.", 409);
      if (current.revision !== command.expectedRevision) throw new MoguriError("revision_conflict", "Another client changed the roundup settings. Reload them before saving.", 409);
      if (command.enabled && !current.schedule) throw new MoguriError("roundup_schedule", "Choose a schedule before turning on scheduled roundups.");
      const settings: RoundupSettings = { ...current, revision: current.revision + 1, status: command.enabled ? "active" : "paused",
        anchorAt: command.enabled ? at : current.anchorAt, nextAt: command.enabled ? this.next(current.schedule!, now, now) : null,
        commandId: intent.id, commandDigest: intent.digest, updatedAt: at };
      return finish([this.settingsEvent(settings)], { id: settings.id, revision: settings.revision });
    }
    if (command.type === "dependency_roundup.cancel") {
      const run = this.run(command.runId);
      if (!activeRoundupRun(run)) return finish([], { id: run.id, revision: run.revision });
      if (!run.refreshId) throw new MoguriError("roundup_starting", "This run is still admitting its refresh. Stop it once it is reading; nothing has been read yet.", 409);
      const refresh = this.snapshot().myWorkRefreshes.find((value) => value.id === run.refreshId);
      if (!refresh || refresh.status !== "running") return finish([], { id: run.id, revision: run.revision });
      await this.host.cancel(refresh.jobId, finish);
      return { id: run.id };
    }
    const previous = this.snapshot().dependencyRoundupRuns.find((run) => run.commandId === intent.id && run.trigger === "manual");
    if (previous) return { id: previous.id };
    if (!current) throw new MoguriError("roundup_settings", "Configure dependency roundups first: choose My Work sources and update bots.", 409);
    const active = this.active();
    if (active) throw new MoguriError("roundup_busy", `Roundup ${active.id} is still running. Stop it or wait; a second reader was not started.`, 409);
    this.sources(current.sourceIds);
    const id = randomUUID();
    return this.host.myWork().admitOwned(current.sourceIds, command.timeoutMs, this.owned(finish, (refreshId) => ({
      version: 1, id, revision: 0, profileId: current.profileId, settingsRevision: current.revision, trigger: "manual", occurrenceAt: null, missed: 0,
      sourceIds: [...current.sourceIds], refreshId, status: "running", summary: null, commandId: intent.id, createdAt: at, updatedAt: at, diagnostic: null,
    })));
  }
  /** Due instants for the shared intake timer (the #6 timer; no second scheduler). */
  due(): number[] {
    const settings = this.settings();
    return settings?.status === "active" && settings.nextAt ? [Date.parse(settings.nextAt)] : [];
  }
  /** Timer delivery: one run for the latest due occurrence, missed occurrences counted, overlap skipped (D50 semantics). */
  fire(): void {
    const settings = this.settings(), now = this.host.now();
    if (settings?.status !== "active" || !settings.schedule || !settings.nextAt || Date.parse(settings.nextAt) > now) return;
    const due = dueAutomationOccurrences(settings.schedule, Date.parse(settings.anchorAt ?? settings.createdAt), Date.parse(settings.nextAt), now);
    // A one-time schedule that has fired turns itself off, so later edits never re-activate a past time.
    const advanced: RoundupSettings = { ...settings, revision: settings.revision + 1, nextAt: due.next === null ? null : this.iso(due.next),
      ...(due.next === null ? { status: "paused" as const } : {}), updatedAt: this.iso(now) };
    const active = this.active(), at = this.iso(now);
    const run: RoundupRun = { version: 1, id: randomUUID(), revision: 0, profileId: settings.profileId, settingsRevision: advanced.revision, trigger: "schedule",
      occurrenceAt: this.iso(due.latest), missed: due.missed, sourceIds: [...settings.sourceIds], refreshId: null, status: active ? "skipped" : "starting",
      summary: null, commandId: settings.commandId, createdAt: at, updatedAt: at,
      diagnostic: active ? `The previous roundup (${active.id}) was still running, so this occurrence was skipped. Nothing was read.` : null };
    this.host.commit([this.settingsEvent(advanced), this.runEvent(run)]);
    if (!active) this.launch(run.id);
  }
  private update(run: RoundupRun, changes: Partial<RoundupRun>): RoundupRun {
    return { ...run, ...changes, revision: run.revision + 1, updatedAt: this.iso() };
  }
  private launch(runId: string): void {
    if (this.launching.has(runId)) return;
    this.launching.add(runId);
    try {
      const run = this.run(runId), settings = this.settings();
      if (run.status !== "starting") return;
      if (this.host.closing()) throw new MoguriError("roundup_closing", "Moguri is shutting down. The scheduled roundup did not start; nothing was read.", 409);
      if (!settings || settings.revision !== run.settingsRevision) {
        throw new MoguriError("roundup_settings", "The roundup settings changed before this scheduled run started. Nothing was read.", 409);
      }
      this.sources(run.sourceIds);
      const trigger: MyWorkRefreshTrigger = { kind: "dependency-roundup-schedule", runId: run.id, settingsRevision: run.settingsRevision,
        activationCommandId: settings.commandId, activationCommandDigest: settings.commandDigest };
      const finish = this.host.finish(`dependency-roundup-run-${run.id}`, digest(`dependency-roundup-run:${run.id}`));
      this.host.myWork().admitOwned(run.sourceIds, undefined, this.owned(finish, (refreshId) => {
        const current = this.run(run.id);
        if (current.status !== "starting") throw new MoguriError("roundup_stopped", "This scheduled run ended before its refresh was admitted. Nothing was read.", 409);
        return this.update(current, { status: "running", refreshId });
      }), trigger);
    } catch (error) {
      if (!(error instanceof MoguriError)) console.error("Scheduled dependency roundup failed to start:", error);
      const current = this.snapshot().dependencyRoundupRuns.find((value) => value.id === runId);
      if (current?.status === "starting") {
        try { this.host.commit([this.runEvent(this.update(current, { status: "blocked", diagnostic: safeDiagnostic(error) }))]); }
        catch (persistence) { console.error("Dependency roundup outcome could not be retained:", persistence instanceof Error ? persistence.message : persistence); }
      }
    } finally { this.launching.delete(runId); }
  }
  private summary(record: MyWorkRefresh, bots: readonly string[]): RoundupSummary {
    const updates = new Map<string, RoundupUpdate>();
    for (const observation of this.host.myWork().observationsOf(record)) for (const pull of observation.pulls) {
      if (!isRoundupAuthor(pull.item.author, bots)) continue;
      const update = this.observedUpdate(observation, pull);
      if (update) updates.set(update.itemId, update);
    }
    const values = [...updates.values()], open = values.filter((value) => value.state === "open");
    return { updates: open.length, groups: roundupGroups(open).length, security: open.filter((value) => value.security).length,
      likelyBreaking: open.filter((value) => value.breaking.likely).length,
      failingChecks: open.filter((value) => value.ci !== null && failingChecks.has(value.ci)).length, closed: values.length - open.length };
  }
  private observedUpdate(observation: MyWorkObservation, pull: MyWorkObservation["pulls"][number]): RoundupUpdate | null {
    const number = pull.item.number;
    if (!number || !pull.item.url) return null;
    const source = observation.source;
    return this.updateFrom({ id: myWorkItemId(source.repository, number), repository: source.repository, number, url: pull.item.url,
      pull, categories: [], freshness: "fresh", conflicting: false, associations: [] });
  }
  private updateFrom(entry: MyWorkEntry): RoundupUpdate {
    const item = entry.pull.item;
    return {
      ...parseDependencyUpdate(item),
      itemId: entry.id, repository: entry.repository, number: entry.number, url: entry.url, title: item.title, author: item.author ?? "",
      state: item.state, draft: item.draft === true, headSha: item.headSha, observedAt: entry.pull.observedAt, freshness: entry.freshness,
      conflicting: entry.conflicting, ci: entry.pull.ci?.state ?? null, reviewDecision: entry.pull.reviewDecision,
      unresolvedThreads: entry.pull.threads === null ? null : entry.pull.threads.filter((thread) => !thread.resolved).length,
      sources: entry.associations.map((association) => ({ sourceId: association.source.id, accountId: association.source.accountId,
        refreshId: association.refreshId, observationDigest: association.observationDigest })),
    };
  }
  /** Settles a running run in the same transaction as its owned refresh's terminal record. */
  derived(next: Snapshot, primary: StoredEvent[]): EventInput[] {
    const events: EventInput[] = [];
    for (const event of primary) {
      if (event.event_type !== "my_work.refresh_recorded" || event.payload.refresh.status === "running") continue;
      const refresh = event.payload.refresh, run = next.dependencyRoundupRuns.find((value) => value.status === "running" && value.refreshId === refresh.id);
      if (run) events.push(this.runEvent(this.settle(run, refresh, next.dependencyRoundup?.bots ?? [])));
    }
    return events;
  }
  private settle(run: RoundupRun, refresh: MyWorkRefresh, bots: readonly string[]): RoundupRun {
    let summary: RoundupSummary | null = null;
    try { summary = this.summary(refresh, bots); }
    catch (error) { if (!(error instanceof MoguriError)) throw error; }
    if (refresh.status === "completed") {
      if (summary) return this.update(run, { status: "completed", summary, diagnostic: null });
      return this.update(run, { status: "partial", summary: null, diagnostic: "The refresh completed but its retained observations could not be summarized. Inspect them in My Work; nothing was replayed." });
    }
    const status = refresh.status === "cancelled" ? "cancelled" : refresh.status === "failed" ? "failed" : "partial";
    const note = status === "cancelled" || refresh.cancelRequested ? " Only this roundup's own GitHub readers were stopped; no other refresh, CI watch or external operation was." : "";
    return this.update(run, { status, summary, diagnostic: `${refresh.diagnostic ?? "The roundup refresh did not complete."}${note}`.slice(0, 4000) });
  }
  /** Restart: a scheduled run that never admitted its refresh read nothing and is blocked, never replayed. */
  recover(): EventInput[] {
    const state = this.snapshot();
    return state.dependencyRoundupRuns.flatMap((run) => {
      if (run.status === "starting") return [this.runEvent(this.update(run, { status: "blocked",
        diagnostic: "Moguri restarted before this scheduled roundup admitted its refresh. Nothing was read or replayed." }))];
      const refresh = run.status === "running" ? state.myWorkRefreshes.find((value) => value.id === run.refreshId) : undefined;
      return refresh && refresh.status !== "running" ? [this.runEvent(this.settle(run, refresh, state.dependencyRoundup?.bots ?? []))] : [];
    });
  }
  /** The retained, read-only roundup. Never reads GitHub or calls a model. */
  async query(query: RoundupQuery): Promise<RoundupResponse> {
    const filters = parse(RoundupQuerySchema, query).filters, settings = this.settings(), observedAt = this.iso();
    const latestRun = this.snapshot().dependencyRoundupRuns[0] ?? null;
    const empty: RoundupResponse = { type: "dependency_roundup.query", settings, latestRun, updates: [], groups: [], sources: [], complete: false,
      observedAt, boundary: "controller-gh-account-not-ssh", interpretation: "none" };
    if (!settings) return empty;
    const retained = await this.host.myWork().retained(settings.sourceIds);
    const sources: RoundupSourceState[] = retained.sources.map(({ sourceId, source, state, failed }) => {
      const enabled = source?.enabled ?? false, freshness = state?.freshness ?? (source ? "unobserved" : "missing"), complete = state?.complete ?? false;
      return { sourceId, repository: source?.repository ?? null, account: source?.account ?? null, accountId: source?.accountId ?? null, enabled,
        freshness, complete, observedAt: state?.observedAt ?? null, refreshId: state?.refreshId ?? null,
        problem: roundupProblem({ enabled, freshness, complete, failed }),
        diagnostic: state?.diagnostic ?? (!source ? "This My Work source is not in this profile. Nothing was read for it." :
          !source.enabled ? "This My Work source is disabled. Enable it in My Work; nothing was read for it." : null) };
    });
    const state = filters.state ?? "open", text = filters.text?.toLowerCase();
    const updates = retained.entries.filter((entry) => isRoundupAuthor(entry.pull.item.author, settings.bots)).map((entry) => this.updateFrom(entry))
      .filter((update) => (state === "all" || update.state === state) &&
        (filters.security === undefined || Boolean(update.security) === filters.security) &&
        (filters.breaking === undefined || update.breaking.likely === filters.breaking) &&
        (!filters.ecosystem || update.packages.some((entry) => entry.ecosystem === filters.ecosystem)) &&
        (!filters.repository || update.repository.toLowerCase() === filters.repository.toLowerCase()) &&
        (!text || `${update.repository} ${update.number} ${update.title} ${update.packages.map((entry) => entry.name).join(" ")}`.toLowerCase().includes(text)))
      .sort((a, b) => Number(Boolean(b.security)) - Number(Boolean(a.security)) || Number(b.breaking.likely) - Number(a.breaking.likely) ||
        Number(b.ci !== null && failingChecks.has(b.ci)) - Number(a.ci !== null && failingChecks.has(a.ci)) ||
        a.repository.localeCompare(b.repository) || a.number - b.number);
    const response: RoundupResponse = { ...empty, updates, groups: roundupGroups(updates), sources,
      complete: sources.length > 0 && sources.every((source) => source.problem === null && source.freshness === "fresh") };
    if (Buffer.byteLength(JSON.stringify(response)) > MAX_BYTES) throw new MoguriError("roundup_limit", "This complete roundup exceeds 8 MiB. Narrow it with filters; no prefix was returned as complete.", 409);
    return response;
  }
}
