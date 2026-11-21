import { randomUUID } from "node:crypto";
import { MoguriError, parse, type CapabilityJob, type CommandResult, type EventInput, type Snapshot } from "../../../packages/protocol/src/index.ts";
import { githubCiOperationMatches, githubSourceOwner, type GithubScope } from "../../../packages/protocol/src/github-workflows.ts";
import {
  MyWorkCommandSchema, MyWorkObservationSchema, MyWorkQuerySchema, myWorkCategories, myWorkItemId,
  type MyWorkAssociation, type MyWorkAttention, type MyWorkCommand, type MyWorkEntry, type MyWorkFilters,
  type MyWorkNavigation, type MyWorkObservation, type MyWorkRefresh, type MyWorkResponse, type MyWorkSource,
  type MyWorkSourcePreview, type MyWorkSourceState, type MyWorkQuery, type MyWorkRefreshTrigger,
} from "../../../packages/protocol/src/my-work.ts";
import { digest, type EventStore } from "./store.ts";
import { sameDurableRoot, sourceRootSync } from "./repository-source.ts";
import { githubObservationText, githubSourceDigest, type GitHubWorkflows } from "./github-workflows.ts";
import type { CandidateJobLifecycle } from "./candidates.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import type { WorkflowHost } from "./workflow-host.ts";

interface Host extends Omit<WorkflowHost, "job"> {
  job(execute: (signal: AbortSignal, progress: (text: string) => void) => Promise<unknown>,
    start: (job: CapabilityJob) => void, lifecycle: CandidateJobLifecycle): string;
  start(navigation: MyWorkNavigation, digest: string, finish: WorkspaceFinish): Promise<CommandResult>;
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const MAX_AGE = 300_000, MAX_BYTES = 8 * 1024 * 1024;
const message = (error: unknown): string => (error instanceof MoguriError ? error.message :
  error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name) ?
    "The original inbox read stopped or exceeded its deadline. Retained observations are incomplete; no request was replayed." :
    "The original inbox reader failed without an acknowledged result. Inspect its retained source; no replacement account or empty result was used.")
  .replace(/(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|Bearer\s+[^\s"']+)/gi, "[redacted]").slice(0, 3900);
const sourceScope = (source: MyWorkSource): GithubScope => ({ env: "Local", projectId: source.binding.projectId,
  ...(source.binding.workspaceId ? { workspaceId: source.binding.workspaceId } : {}) });

export class MyWorkRuntime {
  private readonly active = new Map<string, { abort: AbortController; sourceIds: string[] }>();
  constructor(private readonly store: EventStore, private readonly github: GitHubWorkflows, private readonly host: Host,
    private readonly now: () => number = Date.now) {}
  private snapshot(): Snapshot { return this.host.snapshot(); }
  private source(id: string): MyWorkSource {
    const source = this.snapshot().myWorkSources.find((source) => source.id === id && source.profileId === this.store.profileId);
    if (!source) throw new MoguriError("my_work_source", "This configured source is unavailable in the exact current profile. No other profile/repository was searched.", 404);
    return source;
  }
  private record(id: string): MyWorkRefresh {
    const record = this.snapshot().myWorkRefreshes.find((record) => record.id === id && record.profileId === this.store.profileId);
    if (!record) throw new MoguriError("my_work_missing", "The original inbox refresh is unavailable in this profile. No replacement report was used.", 404);
    return record;
  }
  private sourceEvent(source: MyWorkSource): EventInput {
    return { event_type: "my_work.source_recorded", profile_id: source.profileId, payload: { source } };
  }
  private event(refresh: MyWorkRefresh): EventInput {
    return { event_type: "my_work.refresh_recorded", profile_id: refresh.profileId, payload: { refresh } };
  }
  private next(record: MyWorkRefresh, changes: Partial<MyWorkRefresh>, updatedAt = new Date(this.now()).toISOString()): MyWorkRefresh {
    return { ...record, ...changes, revision: record.revision + 1, updatedAt };
  }
  private update(id: string, changes: Partial<MyWorkRefresh>): void { this.host.commit([this.event(this.next(this.record(id), changes))]); }
  private retain(value: unknown): string {
    const text = githubObservationText(value);
    if (Buffer.byteLength(text) > MAX_BYTES) throw new MoguriError("my_work_limit", "The complete original inbox observation exceeds 8 MiB. Its retained prefix remains partial, not a clean inbox.", 409);
    return this.store.putBlob(text);
  }
  private bounded<T>(value: T): T {
    if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) throw new MoguriError("my_work_limit", "This complete retained response exceeds 8 MiB. Select one original source report or refine the item filters/page size; no prefix was returned as complete.", 409);
    return value;
  }
  private observation(record: MyWorkRefresh, index: number): MyWorkObservation | null {
    const source = record.sources[index];
    if (!source?.observationDigest) return null;
    const observation = parse(MyWorkObservationSchema, JSON.parse(this.store.blob(source.observationDigest)));
    if (!equal(observation.source, source.source) || observation.pulls.some((pull) => !pull.item.number ||
      pull.item.kind !== "pull" || pull.item.url !== `https://github.com/${source.source.repository}/pull/${pull.item.number}` ||
      pull.ci && (!equal(pull.ci.target, { repository: source.source.repository, account: source.source.account,
        accountId: source.source.accountId, number: pull.item.number, headSha: pull.item.headSha }) ||
        pull.ci.items.some((item) => item.headSha !== pull.item.headSha))) ||
      new Set(observation.pulls.map((pull) => pull.item.number)).size !== observation.pulls.length ||
      observation.complete && (observation.diagnostic || observation.pulls.some((pull) => !pull.complete || !pull.ci?.complete ||
        pull.requests === null || pull.threads === null))) {
      throw new MoguriError("my_work_corrupt", "The retained observation lost its original source/account/head or completeness. No replacement was inferred.", 409);
    }
    return observation;
  }
  private assertSource(source: MyWorkSource, allowDisabled = false): void {
    const state = this.snapshot(), current = this.source(source.id);
    this.github.observationPolicy(sourceScope(source));
    if (!allowDisabled && !current.enabled || !equal(current, source) || source.binding.profileId !== state.profileId ||
      state.policy.revision !== source.binding.policyRevision || state.settings.permissionRevision !== source.binding.permissionRevision ||
      this.host.configuration(source.binding.projectId).revision !== source.binding.configurationRevision ||
      !sameDurableRoot(source.binding.root, sourceRootSync(this.host.project(source.binding.projectId, source.binding.workspaceId ?? undefined).path))) {
      throw new MoguriError("my_work_source_changed", "The configured inbox source/root/account policy changed. Review a new source; original results were not retargeted.", 409);
    }
  }
  private invalidate(ids: string[]): void {
    for (const owner of this.active.values()) if (owner.sourceIds.some((id) => ids.includes(id))) {
      owner.abort.abort(new MoguriError("my_work_source_changed", "An actual user changed a source during its original refresh. Prior observations remain partial; no other watch or GitHub job was cancelled.", 409));
    }
  }
  private async preview(scope: GithubScope, signal?: AbortSignal): Promise<MyWorkSourcePreview> {
    const context = await this.github.projectContext(scope, undefined, undefined, undefined, signal);
    const content = { version: 1 as const, profileId: this.store.profileId, actor: "user" as const,
      repository: context.repository, account: context.account, accountId: context.accountId, binding: context.binding, remote: context.remote };
    const id = digest(JSON.stringify(content)), existing = this.snapshot().myWorkSources.find((source) => source.id === id);
    const source = { id, ...content };
    return { source, digest: digest(JSON.stringify([source, existing?.revision ?? null])), expectedRevision: existing?.revision ?? null,
      boundary: context.boundary, warning: `${context.warning} Saving explicitly configures this one source for read-only My Work refresh. Older bindings for this project/workspace/account are disabled, not erased. No recurring work starts.` };
  }
  private clearDisabled(ids: string[]): EventInput[] {
    const state = this.snapshot(), enabled = new Set(state.myWorkSources.filter((source) => source.enabled && !ids.includes(source.id)).map((source) => source.id));
    const attentionIds = state.attention.filter((entry) => {
      if (entry.reason !== "my-work" || !entry.active || !entry.myWork) return false;
      const summary = state.myWorkRefreshes.find((refresh) => refresh.id === entry.myWork!.refreshId)?.attention.find((value) => value.itemId === entry.messageId);
      return summary && !summary.sourceIds.some((id) => enabled.has(id));
    }).map((entry) => entry.id);
    return attentionIds.length ? [{ event_type: "attention.cleared", profile_id: state.profileId, payload: { attentionIds } }] : [];
  }
  async execute(command: MyWorkCommand, finish: WorkspaceFinish): Promise<CommandResult> {
    command = structuredClone(parse(MyWorkCommandSchema, command));
    const intent = finish.intent;
    if (!intent) throw new MoguriError("my_work_intent", "A canonical actual-user command must own this inbox action.", 409);
    const previous = this.snapshot().myWorkRefreshes.find((record) => record.commandId === intent.id);
    if (previous) {
      if (previous.commandDigest !== intent.digest) throw new MoguriError("my_work_command", "This command identity already belongs to different original input.", 409);
      const receipt = this.store.receipt(intent.id, intent.digest);
      if (receipt) return receipt;
      throw new MoguriError("my_work_no_replay", "The original retained refresh has no admission receipt. Missing receipts or restart cannot authorize another read.", 409);
    }
    if (command.type === "my_work.inspect") {
      const record = this.record(command.refreshId);
      if (!this.store.receipt(record.commandId, record.commandDigest)) throw new MoguriError("my_work_no_replay", "The original reader has no admission receipt. An inspection cannot authorize another dispatch.", 409);
      if (record.status !== "partial" || !record.cleanupUnconfirmed || record.inspection) throw new MoguriError("my_work_inspection", "Inspect one original uninspected partial reader. This is not cleanup proof, permission or a refresh.", 409);
      if (record.revision !== command.expectedRevision || record.inputDigest !== command.expectedInputDigest) throw new MoguriError("my_work_inspection", "The exact retained revision/input changed. Read that original report again before inspection.", 409);
      const time = new Date(this.now()).toISOString();
      return finish([this.event(this.next(record, { inspection: { actor: "user", at: time, commandId: intent.id, commandDigest: intent.digest,
        operationId: record.id, observedRevision: record.revision, inputDigest: record.inputDigest } }, time))], { id: record.id, revision: record.revision + 1 });
    }
    if (command.type === "my_work.configure") {
      const preview = await this.preview(command.scope);
      if (preview.digest !== command.expectedDigest || preview.expectedRevision !== command.expectedRevision) throw new MoguriError("my_work_review", "The reviewed source/account/root/configuration changed. Review this exact source again before saving.", 409);
      const time = new Date(this.now()).toISOString(), old = this.snapshot().myWorkSources.find((source) => source.id === preview.source.id);
      const replaced = this.snapshot().myWorkSources.filter((source) => source.enabled && source.id !== preview.source.id &&
        source.binding.projectId === preview.source.binding.projectId && source.binding.workspaceId === preview.source.binding.workspaceId &&
        source.accountId === preview.source.accountId);
      const source: MyWorkSource = old ? { ...old, enabled: true, revision: old.revision + 1, updatedAt: time } :
        { ...preview.source, revision: 0, enabled: true, createdAt: time, updatedAt: time };
      if (this.snapshot().myWorkSources.filter((source) => source.enabled).length - replaced.length + Number(!old?.enabled) > 100) {
        throw new MoguriError("my_work_limit", "Disable an explicitly configured source before exceeding 100 enabled sources.", 409);
      }
      const result = finish([...replaced.map((source) => this.sourceEvent({ ...source, revision: source.revision + 1, enabled: false, updatedAt: time })),
        this.sourceEvent(source), ...this.clearDisabled(replaced.map((source) => source.id))], { id: source.id, revision: source.revision });
      this.invalidate([...replaced.map((source) => source.id), source.id]); return result;
    }
    if (command.type === "my_work.source.toggle") {
      const source = this.source(command.sourceId);
      if (source.revision !== command.expectedRevision) throw new MoguriError("revision_conflict", "The configured source changed in another client. Reload it before changing its enabled state.", 409);
      if (command.enabled) {
        this.assertSource(source, true);
        if (!source.enabled && this.snapshot().myWorkSources.filter((source) => source.enabled).length >= 100) throw new MoguriError("my_work_limit", "Only 100 explicitly configured sources may be enabled.", 409);
      }
      const next = { ...source, enabled: command.enabled, revision: source.revision + 1, updatedAt: new Date(this.now()).toISOString() };
      const result = finish([this.sourceEvent(next), ...(!command.enabled ? this.clearDisabled([source.id]) : [])], { id: source.id, revision: next.revision });
      this.invalidate([source.id]); return result;
    }
    if (command.type === "my_work.start") {
      const result = await this.query({ type: "my_work.followup", itemId: command.itemId, sourceId: command.sourceId });
      if (result.type !== "my_work.followup" || result.digest !== command.expectedDigest) throw new MoguriError("my_work_review", "The exact follow-up PR/account/root review changed. No session or prompt was started.", 409);
      this.assertSource(this.source(command.sourceId));
      return this.host.start(result.navigation, result.digest, finish);
    }
    const sources = command.sourceIds ? command.sourceIds.map((id) => this.source(id)) : this.snapshot().myWorkSources.filter((source) => source.enabled);
    return this.admit(sources, command.timeoutMs, finish, false);
  }
  /**
   * A refresh owned exclusively by its caller (protocol 119, D66): it never adopts an identical running reader, so a
   * dependency roundup run only ever owns, reports and cancels the refresh admitted in its own transaction.
   */
  admitOwned(sourceIds: string[], timeoutMs: number | undefined, finish: WorkspaceFinish, trigger?: MyWorkRefreshTrigger): CommandResult {
    if (!finish.intent) throw new MoguriError("my_work_intent", "A canonical command must own this inbox action.", 409);
    if (this.snapshot().myWorkRefreshes.some((record) => record.commandId === finish.intent!.id)) {
      throw new MoguriError("my_work_no_replay", "This command identity already owns an original refresh. It was not read again.", 409);
    }
    return this.admit(sourceIds.map((id) => this.source(id)), timeoutMs, finish, true, trigger);
  }
  private admit(sources: MyWorkSource[], timeoutMs: number | undefined, finish: WorkspaceFinish, exclusive: boolean, trigger?: MyWorkRefreshTrigger): CommandResult {
    const intent = finish.intent!;
    if (!sources.length || sources.some((source) => !source.enabled)) throw new MoguriError("my_work_sources", "Configure and enable explicit repositories before refreshing. No unconfigured repository was scanned.", 409);
    sources = [...sources].sort((a, b) => a.id.localeCompare(b.id));
    const unconfirmed = this.snapshot().myWorkRefreshes.find((record) => record.status === "partial" && record.cleanupUnconfirmed &&
      !record.inspection && record.sources.some((old) => sources.some((source) =>
        equal(old.source.binding.root, source.binding.root) && old.source.accountId === source.accountId &&
        old.source.repository.toLowerCase() === source.repository.toLowerCase())));
    if (unconfirmed) throw new MoguriError("my_work_inspection", `Inspect original partial refresh ${unconfirmed.id}, revision ${unconfirmed.revision}, input ${unconfirmed.inputDigest} before a new independent read. Its cleanup remains unconfirmed; no reader was duplicated.`, 409);
    const input = { version: 1, profileId: this.store.profileId, sources, timeoutMs: timeoutMs ?? MAX_AGE };
    const text = JSON.stringify(input), running = this.snapshot().myWorkRefreshes.find((record) => record.status === "running");
    if (running) {
      if (!this.store.receipt(running.commandId, running.commandDigest)) throw new MoguriError("my_work_no_replay", "The active original refresh has no admission receipt. A second reader was not started.", 409);
      if (exclusive || running.inputDigest !== digest(text)) throw new MoguriError("my_work_busy", "Another exact source set already owns this profile's refresh. Inspect or stop that original job; overlapping readers were not duplicated.", 409);
      return finish([], { id: running.id });
    }
    const id = randomUUID(), inputDigest = this.retain(input);
    let admitted: CommandResult | undefined;
    this.host.job((signal, progress) => this.perform(id, input.timeoutMs, signal, progress), (job) => {
      const now = new Date(this.now()).toISOString(), record: MyWorkRefresh = {
        version: 1, id, kind: "my_work.refresh", profileId: this.store.profileId, actor: trigger ? "schedule" : "user", ...(trigger ? { trigger } : {}),
        projectId: null, workspaceId: null, sessionId: null, commandId: intent.id, commandDigest: intent.digest, inputDigest,
        resultDigest: null, jobId: job.id, revision: 0, status: "running", dispatched: false, cancelRequested: false,
        cleanupUnconfirmed: false, sources: sources.map((source) => ({ source, observationDigest: null, status: "queued", diagnostic: null })),
        attention: [], createdAt: now, updatedAt: now, diagnostic: null,
      };
      admitted = finish([this.event(record), { event_type: "job.started", profile_id: record.profileId,
        payload: { job: { ...job, operationId: id } } }], { id });
    }, this.lifecycle(id));
    if (!admitted) throw new MoguriError("my_work_intent", "The original refresh/job/receipt was not atomically admitted. No success or replay was inferred.", 409);
    return admitted;
  }
  private async perform(id: string, timeoutMs: number, requested: AbortSignal, progress: (text: string) => void): Promise<unknown> {
    const original = this.record(id), abort = new AbortController(), signal = AbortSignal.any([requested, abort.signal, AbortSignal.timeout(timeoutMs)]);
    this.active.set(id, { abort, sourceIds: original.sources.map((source) => source.source.id) });
    try {
      signal.throwIfAborted();
      this.update(id, { dispatched: true });
      for (const [index, entry] of original.sources.entries()) {
        signal.throwIfAborted();
        const publish = (value: MyWorkObservation) => {
          signal.throwIfAborted(); this.assertSource(entry.source);
          const current = this.record(id);
          if (current.status !== "running" || current.cancelRequested) throw new MoguriError("my_work_owner", "The original refresh no longer owns late observations. No result was replayed.", 409);
          const sources = structuredClone(current.sources);
          sources[index] = { ...sources[index]!, observationDigest: this.retain(value),
            status: value.complete ? "complete" : value.diagnostic ? value.pulls.length ? "partial" : "failed" : "reading",
            diagnostic: value.diagnostic };
          this.update(id, { sources });
        };
        try {
          this.assertSource(entry.source);
          const known = this.snapshot().myWorkRefreshes.filter((record) => record.id !== id).flatMap((record) =>
            record.sources.flatMap((source, index) => source.source.id === entry.source.id ?
              this.observation(record, index)?.pulls.map((pull) => pull.item.number!) ?? [] : []));
          await this.github.observeMyWork(entry.source, known, signal, publish);
        } catch (error) {
          if (signal.aborted || error instanceof MoguriError && error.code === "program_partial") throw error;
          const sources = structuredClone(this.record(id).sources);
          sources[index] = { ...sources[index]!, status: sources[index]!.observationDigest ? "partial" : "failed", diagnostic: message(error) };
          this.update(id, { sources });
        }
        progress(`Observed ${index + 1}/${original.sources.length} explicitly configured sources; failures and old heads remain visible.`);
      }
      signal.throwIfAborted();
      const record = this.record(id);
      if (record.sources.some((source) => source.status !== "complete")) throw new MoguriError("my_work_partial", "The original inbox refresh has incomplete/failed sources. Retained evidence is not a clean inbox.", 409);
      return { version: 1, refreshId: id, sources: record.sources };
    } finally { this.active.delete(id); }
  }
  private summaries(record: MyWorkRefresh): MyWorkAttention[] {
    const entries = new Map<string, { sourceIds: string[]; pull: MyWorkObservation["pulls"][number]; repository: string }>();
    for (const [index, source] of record.sources.entries()) {
      const observation = this.observation(record, index);
      for (const pull of observation?.pulls ?? []) {
        if (!pull.complete && !pull.diagnostic) continue;
        const categories = myWorkCategories(pull).filter((category) => category !== "open-pr");
        if (!categories.length || !pull.item.headSha) continue;
        const id = myWorkItemId(source.source.repository, pull.item.number!), previous = entries.get(id);
        if (previous && previous.pull.item.headSha !== pull.item.headSha) {
          if (previous.pull.observedAt >= pull.observedAt) continue;
          entries.set(id, { sourceIds: [source.source.id], pull, repository: source.source.repository });
        } else entries.set(id, { sourceIds: [...(previous?.sourceIds ?? []), source.source.id], pull,
          repository: source.source.repository });
      }
    }
    return [...entries].map(([itemId, value]) => ({ itemId, sourceIds: [...new Set(value.sourceIds)],
      repository: value.repository, number: value.pull.item.number!, headSha: value.pull.item.headSha!,
      categories: myWorkCategories(value.pull).filter((category) => category !== "open-pr"),
      fingerprint: digest(JSON.stringify([itemId, value.pull.item.headSha, myWorkCategories(value.pull),
        value.pull.requests, value.pull.threads?.map((thread) => [thread.id, thread.resolved, thread.outdated]),
        value.pull.ci?.state, value.sourceIds.sort()])) }));
  }
  private lifecycle(id: string): CandidateJobLifecycle {
    return {
      completed: (_value, resultDigest) => {
        const record = this.record(id);
        for (const source of record.sources) this.assertSource(source.source);
        if (record.cancelRequested) throw new MoguriError("my_work_partial", "The original refresh was stopped before its terminal acknowledgement. No successful refresh was recorded.", 409);
        return [this.event(this.next(record, { status: "completed", resultDigest, attention: this.summaries(record) }))];
      },
      failed: (error, cancelled) => {
        const record = this.record(id), cleanupUnconfirmed = error instanceof MoguriError && error.code === "program_partial";
        const status = cleanupUnconfirmed && record.dispatched || record.dispatched && !cancelled && !record.cancelRequested &&
          (record.sources.some((source) => source.observationDigest) || error instanceof MoguriError && error.code === "my_work_source_changed") ?
          "partial" : cancelled || record.cancelRequested ? "cancelled" : "failed";
        const diagnostic = `${message(error)}${cleanupUnconfirmed ? " Original reader cleanup is unconfirmed." : ""} No CI watch, GitHub job or remote write was cancelled or replayed.`.slice(0, 4000);
        const resultDigest = this.retain({ version: 1, refreshId: id, sources: record.sources });
        return { status, error: diagnostic, events: [this.event(this.next(record, { status, diagnostic, resultDigest,
          cleanupUnconfirmed, attention: this.summaries(record) }))] };
      },
    };
  }
  private attempts(sourceId: string): { record: MyWorkRefresh; index: number }[] {
    return this.snapshot().myWorkRefreshes.flatMap((record) => {
      const index = record.sources.findIndex((source) => source.source.id === sourceId);
      return index >= 0 ? [{ record, index }] : [];
    }).reverse();
  }
  private sourceState(source: MyWorkSource): MyWorkSourceState {
    const attempts = this.attempts(source.id), latest = attempts[0];
    const retained = attempts.find(({ record, index }) => record.sources[index]?.observationDigest), observation = retained ? this.observation(retained.record, retained.index) : null;
    let changed: string | null = null;
    try { this.assertSource(source); } catch (error) { changed = message(error); }
    const complete = Boolean(observation?.complete && retained?.record.id === latest?.record.id &&
      latest?.record.sources[latest.index]?.status === "complete" && !changed && !latest.record.cleanupUnconfirmed);
    const fresh = complete && this.now() - Date.parse(observation!.at) >= 0 && this.now() - Date.parse(observation!.at) <= MAX_AGE;
    return { source, refreshId: retained?.record.id ?? latest?.record.id ?? null, observationDigest: retained?.record.sources[retained.index]?.observationDigest ?? null,
      observedAt: observation?.at ?? null, complete, freshness: !observation ? "unobserved" : changed || retained?.record.id !== latest?.record.id ? "stale" :
        !complete ? "partial" : fresh ? "fresh" : "stale",
      diagnostic: changed ?? latest?.record.sources[latest.index]?.diagnostic ?? latest?.record.diagnostic ??
        (observation && !fresh && complete ? "This complete observation is older than five minutes. Refresh explicitly; no recurring reader was started." : null) };
  }
  private sessionIds(source: MyWorkSource, number: number): string[] {
    const state = this.snapshot(), url = `https://github.com/${source.repository}/pull/${number}`;
    const watches = state.githubOperations.filter((operation) => githubCiOperationMatches(operation, {
      repository: source.repository, accountId: source.accountId, number }, source.binding));
    const matches = (origin: import("../../../packages/protocol/src/github-workflows.ts").GithubSessionOrigin | undefined) =>
      origin?.source.kind === "pull" && origin.source.number === number && origin.source.repository.toLowerCase() === source.repository.toLowerCase() &&
      origin.accountId === source.accountId && equal(githubSourceOwner(origin.binding), githubSourceOwner(source.binding));
    return state.sessions.filter((session) => session.projectId === source.binding.projectId && session.workspaceId === source.binding.workspaceId &&
      (session.prUrl?.toLowerCase() === url.toLowerCase() && matches(session.githubSource) ||
        watches.some((operation) => operation.originSessionId === session.id) ||
        session.prAssociations?.some((association) => association.scope.url.toLowerCase() === url.toLowerCase() && matches(association.source)))).map((session) => session.id);
  }
  private async entries(states: MyWorkSourceState[]): Promise<MyWorkEntry[]> {
    const groups = new Map<string, MyWorkAssociation[]>();
    for (const state of states) {
      const pulls = new Map<number, MyWorkAssociation>();
      for (const { record, index } of this.attempts(state.source.id)) {
        const observation = this.observation(record, index);
        if (!observation) continue;
        for (const pull of observation.pulls) {
          const existing = pulls.get(pull.item.number!);
          if (existing) {
            if (!existing.previous && observation.complete && record.id !== existing.refreshId) existing.previous = {
              refreshId: record.id, observationDigest: record.sources[index]!.observationDigest!, pull,
            };
            continue;
          }
          const latest = record.id === state.refreshId;
          const association: MyWorkAssociation = { ...state, refreshId: record.id, observationDigest: record.sources[index]!.observationDigest,
            observedAt: observation.at, freshness: latest ? state.freshness : "stale", complete: latest && state.complete,
            pull, sessionIds: this.sessionIds(state.source, pull.item.number!), watch: null };
          const watched = this.snapshot().githubOperations.filter((operation) => githubCiOperationMatches(operation, {
            repository: state.source.repository, accountId: state.source.accountId, number: pull.item.number! }, state.source.binding)).reverse()[0];
          if (watched) {
            const retained = await this.github.query({ type: "github.read", operationId: watched.id });
            if (retained.type !== "github.read") throw new MoguriError("my_work_corrupt", "The exact retained CI read changed type.", 409);
            association.watch = { operationId: watched.id, status: watched.status,
              currentHead: watched.ci!.target.headSha === pull.item.headSha,
              cleanupUnconfirmed: watched.ci!.cleanupUnconfirmed, observation: retained.ciObservation ?? null };
          }
          pulls.set(pull.item.number!, association);
        }
        if (observation.complete) break;
      }
      for (const [number, association] of pulls) {
        const id = myWorkItemId(state.source.repository, number);
        groups.set(id, [...(groups.get(id) ?? []), association]);
      }
    }
    return [...groups].map(([id, associations]) => {
      associations.sort((a, b) => b.pull.observedAt.localeCompare(a.pull.observedAt) || a.source.id.localeCompare(b.source.id));
      const primary = associations[0]!, compatible = associations.filter((value) =>
        value.pull.item.headSha === primary.pull.item.headSha && value.pull.item.state === primary.pull.item.state);
      const watch = compatible.map((value) => value.watch).filter((value) => value?.currentHead && value.observation?.complete && !value.cleanupUnconfirmed)
        .sort((a, b) => b!.observation!.at.localeCompare(a!.observation!.at))[0];
      const pull = watch?.observation && (!primary.pull.ci || watch.observation.at > primary.pull.ci.at) ?
        { ...primary.pull, ci: watch.observation, ciWatchId: watch.operationId } : primary.pull;
      const historical = compatible.flatMap((value) => {
        const previous = value.previous?.pull;
        if (!previous || value.freshness === "fresh" || previous.item.headSha !== value.pull.item.headSha || previous.item.state !== value.pull.item.state) return [];
        return myWorkCategories(previous).filter((category) =>
          category === "pending-review" ? value.pull.requests === null :
          category === "unresolved-thread" ? value.pull.threads === null :
          category === "failed-ci" ? !pull.ci || !pull.ci.complete || pull.ci.target.accountId !== value.source.accountId ||
            pull.ci.at < (previous.ci?.at ?? "") : false);
      });
      const categories = [...new Set([myWorkCategories(pull), ...compatible.map((value) => myWorkCategories(value.pull)), historical].flat())];
      const conflicting = compatible.length !== associations.length;
      const freshness = conflicting || associations.some((source) => source.freshness === "stale") ? "stale" as const :
        associations.some((source) => source.freshness === "partial") ? "partial" as const : primary.freshness;
      return { id, repository: primary.source.repository, number: pull.item.number!, url: pull.item.url!, pull, categories,
        freshness, conflicting, associations };
    }).sort((a, b) => Number(b.categories.includes("failed-ci")) - Number(a.categories.includes("failed-ci")) ||
      Number(b.categories.includes("pending-review")) - Number(a.categories.includes("pending-review")) ||
      b.pull.observedAt.localeCompare(a.pull.observedAt) || a.id.localeCompare(b.id));
  }
  private matches(entry: MyWorkEntry, filters: MyWorkFilters): boolean {
    return (!filters.category || entry.categories.includes(filters.category)) &&
      (!filters.itemId || filters.itemId === entry.id) &&
      (!filters.repository || entry.repository.toLowerCase() === filters.repository.toLowerCase()) &&
      (!filters.state || filters.state === "all" || entry.pull.item.state === filters.state) &&
      (!filters.freshness || entry.freshness === filters.freshness) &&
      (!filters.text || `${entry.repository} ${entry.number} ${entry.pull.item.title} ${entry.pull.item.author ?? ""}`.toLowerCase().includes(filters.text.toLowerCase()));
  }
  async query(query: MyWorkQuery, signal?: AbortSignal): Promise<MyWorkResponse> {
    query = structuredClone(parse(MyWorkQuerySchema, query)); signal?.throwIfAborted();
    if (query.type === "my_work.source.preview") return { type: query.type, preview: await this.preview(query.scope, signal) };
    if (query.type === "my_work.status") return { type: query.type, sources: this.snapshot().myWorkSources,
      refreshes: this.snapshot().myWorkRefreshes, active: this.snapshot().myWorkRefreshes.find((record) => record.status === "running") ?? null };
    if (query.type === "my_work.read") {
      const sourceId = query.sourceId;
      const refresh = this.record(query.refreshId), observations = refresh.sources.flatMap((_source, index) => {
        if (query.metadataOnly || sourceId && _source.source.id !== sourceId) return [];
        const observation = this.observation(refresh, index); return observation ? [observation] : [];
      });
      if (sourceId && !refresh.sources.some((source) => source.source.id === sourceId)) throw new MoguriError("my_work_source", "This source does not belong to the exact original refresh/profile.", 404);
      return this.bounded({ type: query.type, refresh, observations, observationsIncluded: !query.metadataOnly });
    }
    if (query.type === "my_work.navigate" || query.type === "my_work.followup") {
      const source = this.source(query.sourceId);
      if (!source.enabled) throw new MoguriError("my_work_source", "Enable/review the original configured source before navigating its work. No other binding was selected.", 409);
      const entries = await this.entries([this.sourceState(source)]), entry = entries.find((entry) => entry.id === query.itemId);
      if (!entry) throw new MoguriError("my_work_item", "This canonical item was not observed through the exact configured source. No repository search or first-session guess was used.", 404);
      const navigation: MyWorkNavigation = { itemId: entry.id, scope: sourceScope(source),
        source: { kind: "pull", repository: source.repository, account: source.account, accountId: source.accountId, number: entry.number },
        sessionIds: this.sessionIds(source, entry.number) };
      if (query.type === "my_work.navigate") return { type: query.type, navigation };
      this.assertSource(source);
      const selected = await this.github.projectItem(navigation.scope, navigation.source, signal, false, source.binding);
      this.assertSource(source);
      return { type: query.type, navigation, item: selected.item, digest: githubSourceDigest(navigation.source, selected), warning:
        "Controller gh account, not SSH credentials. Confirming creates one idle source-bound session with a saved draft under normal project controls. It sends no prompt and authorizes no GitHub/Git write." };
    }
    const filters = query.filters, enabled = this.snapshot().myWorkSources.filter((source) => source.enabled);
    const allStates = enabled.map((source) => this.sourceState(source)), states = allStates.filter(({ source }) =>
      (!filters.accountId || source.accountId === filters.accountId) && (!filters.sourceId || source.id === filters.sourceId) &&
      (!filters.projectId || source.binding.projectId === filters.projectId));
    const all = await this.entries(states), entries = all.filter((entry) => this.matches(entry, { state: "open", ...filters }));
    signal?.throwIfAborted();
    return this.bounded({ type: query.type, entries: entries.slice(query.offset, query.offset + query.limit), total: entries.length, sources: allStates,
      refreshing: this.snapshot().myWorkRefreshes.find((record) => record.status === "running") ?? null,
      counts: { "open-pr": all.filter((entry) => entry.categories.includes("open-pr")).length,
        "pending-review": all.filter((entry) => entry.categories.includes("pending-review")).length,
        "failed-ci": all.filter((entry) => entry.categories.includes("failed-ci")).length,
        "unresolved-thread": all.filter((entry) => entry.categories.includes("unresolved-thread")).length },
      observedAt: new Date(this.now()).toISOString(), boundary: "controller-gh-account-not-ssh" });
  }
  /** Every retained observation of one exact refresh record (protocol 119 roundup summaries); never reads GitHub. */
  observationsOf(record: MyWorkRefresh): MyWorkObservation[] {
    return record.sources.flatMap((_source, index) => { const observation = this.observation(record, index); return observation ? [observation] : []; });
  }
  /**
   * Retained entries (every PR state) and source states for explicitly selected sources (protocol 119). Disabled or
   * missing sources are reported, never read or replaced; nothing here reads GitHub.
   */
  async retained(sourceIds: readonly string[]): Promise<{ sources: { sourceId: string; source: MyWorkSource | null; state: MyWorkSourceState | null; failed: boolean }[]; entries: MyWorkEntry[] }> {
    const known = this.snapshot().myWorkSources.filter((source) => source.profileId === this.store.profileId);
    const sources = sourceIds.map((sourceId) => {
      const source = known.find((value) => value.id === sourceId) ?? null, latest = this.attempts(sourceId)[0];
      return { sourceId, source, state: source?.enabled ? this.sourceState(source) : null,
        failed: latest?.record.sources[latest.index]?.status === "failed" };
    });
    const entries = await this.entries(sources.flatMap((value) => value.state ? [value.state] : []));
    return { sources, entries };
  }
  cancelEvents(jobId: string): EventInput[] {
    const record = this.snapshot().myWorkRefreshes.find((record) => record.jobId === jobId && record.status === "running");
    return record && !record.cancelRequested ? [this.event(this.next(record, { cancelRequested: true }))] : [];
  }
  recover(): void {
    const events: EventInput[] = [];
    for (const record of this.snapshot().myWorkRefreshes.filter((record) => record.status === "running")) {
      const status = record.dispatched ? "partial" : "cancelled";
      const diagnostic = "Service restarted without the original inbox reader's acknowledgement. Prior observations and ownership remain retained; cleanup is unconfirmed after dispatch. No HTTP read, watch, job or input was replayed.";
      events.push(this.event(this.next(record, { status, cancelRequested: true, cleanupUnconfirmed: record.dispatched, diagnostic,
        attention: this.summaries(record) })),
      { event_type: "job.finished", profile_id: record.profileId, payload: {
        jobId: record.jobId, status, resultDigest: null, error: diagnostic, operationId: record.id } });
    }
    if (events.length) this.host.commit(events);
  }
}
