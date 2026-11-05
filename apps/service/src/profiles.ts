import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  GLOBAL_PROFILE_ID, PROFILE_ID, MoguriError, projectEvents, type BudgetEntry, type BudgetPlan, type CommandEnvelope, type CommandResult, type ControlDefaults,
  type EventInput, type GlobalBudgetCapacity, type Profile, type ProfileCatalog, type ProfileCommand, type StoredEvent,
  type RuntimeCloseOptions,
} from "../../../packages/protocol/src/index.ts";
import { ControlPlane, type ProfileHooks } from "./controller.ts";
import { localRootsOverlap } from "./project-clone.ts";
import { budgetCharges } from "./budgets.ts";
import { digest, EventStore } from "./store.ts";
import { writeArtifactExport } from "./artifact-export.ts";
import { remoteRootQuarantined } from "./remote.ts";
import { githubRootQuarantined } from "../../../packages/protocol/src/github-workflows.ts";

interface Options {
  controller(store: EventStore, stateDir: string, hooks: ProfileHooks): ControlPlane;
  changed(profileId: string, events: StoredEvent[]): void;
}
export class ProfileRuntime {
  private readonly global: EventStore;
  private readonly stores = new Map<string, EventStore>();
  private readonly controllers = new Map<string, ControlPlane>();
  private readonly loading = new Map<string, Promise<ControlPlane>>();
  private readonly active = new Map<string, { abort: AbortController; done: Promise<void> }>();
  private readonly pending = new Map<string, { digest: string; result: Promise<CommandResult> }>();
  private closed = false;
  private closedBudget?: GlobalBudgetCapacity;
  private budgetCache?: { catalogSequence: number; accountingSequence: number; value: GlobalBudgetCapacity };
  private closeTask?: Promise<void>;
  readonly hooks: ProfileHooks;
  constructor(private readonly initial: EventStore, private readonly stateDir: string, private readonly options: Options) {
    this.global = initial.view(GLOBAL_PROFILE_ID); this.stores.set(PROFILE_ID, initial);
    this.hooks = {
      extendCommit: (id, events) => this.extend(id, events),
      committed: (id, events) => this.committed(id, events),
      globalBudget: () => this.globalBudget(),
      foreignRootBusy: (id, root, includeNested) => this.foreignRootBusy(id, root, includeNested),
      foreignConsoleBusy: (id, root) => this.foreignConsoleBusy(id, root),
    };
  }
  catalog(): ProfileCatalog {
    const profiles = new Map<string, Profile>();
    const catalog: ProfileCatalog = { profiles: [], globalDefaults: { revision: 0, values: {} }, globalBudget: { revision: 0, limit: null }, environmentPolicy: { revision: 0, allowedEnvs: ["Local", "Sandbox", "Remote"] } };
    for (const event of this.global.events()) {
      if (event.event_type === "profile.saved") profiles.set(event.payload.profile.id, structuredClone(event.payload.profile));
      if (event.event_type === "global.controls_changed") catalog.globalDefaults = structuredClone(event.payload);
      if (event.event_type === "global.policy_changed") catalog.environmentPolicy = structuredClone(event.payload.policy);
      if (event.event_type === "global.budget_changed") catalog.globalBudget = structuredClone(event.payload);
    }
    return { ...catalog, profiles: [...profiles.values()] };
  }
  maintenanceFacts() {
    const catalog = this.catalog(), activeOwners: string[] = [], roots: string[] = [];
    for (const profile of catalog.profiles) {
      const state = this.controllers.get(profile.id)?.snapshot() ?? projectEvents(this.store(profile.id).events(), profile.id);
      for (const session of state.sessions) if (session.turnId) activeOwners.push(`turn/${profile.id}/${session.turnId}`);
      for (const job of state.jobs) if (["running", "waiting_input"].includes(job.status)) activeOwners.push(`job/${profile.id}/${job.id}`);
      for (const terminal of state.terminals) if (!["closed", "failed"].includes(terminal.status)) activeOwners.push(`terminal/${profile.id}/${terminal.id}`);
      if (profile.status === "creating") activeOwners.push(`profile-setup/${profile.id}`);
      roots.push(...state.projects.map((project) => project.path), ...state.managedWorkspaces.filter((workspace) => workspace.status !== "removed").map((workspace) => workspace.path));
    }
    return { profiles: catalog.profiles.map((profile) => profile.id), activeOwners, roots };
  }
  async snapshot(id: string) {
    const control = await this.control(id);
    return { ...control.snapshot(), profile: this.profile(id), profileCatalogRevision: this.global.events().at(-1)?.seq ?? 0, globalBudgetPolicy: this.catalog().globalBudget, globalBudgetSequence: this.initial.globalBudgetSequence() };
  }
  async initialize(): Promise<ControlPlane> {
    if (!this.catalog().profiles.length) {
      const legacy = projectEvents(this.initial.events(), PROFILE_ID);
      this.global.commit([
        this.saved({ id: PROFILE_ID, name: "Default", color: null, revision: 0, status: "ready", diagnostic: null, createdAt: new Date().toISOString() }),
        { event_type: "global.controls_changed", profile_id: GLOBAL_PROFILE_ID, payload: { revision: 0, values: legacy.settings.values.startup.global } },
        { event_type: "global.policy_changed", profile_id: GLOBAL_PROFILE_ID, payload: { policy: legacy.policy } },
      ]);
    }
    const interrupted = this.catalog().profiles.filter((profile) => profile.status === "creating");
    if (interrupted.length) this.global.commit(interrupted.map((profile) => this.saved({ ...profile, status: "partial", revision: profile.revision + 1, diagnostic: "Service restarted during profile setup. No directory initialization, account login or effect was replayed. Inspect and explicitly retry." })));
    const initial = await this.control(PROFILE_ID);
    for (const profile of this.catalog().profiles.filter((profile) => profile.id !== PROFILE_ID && profile.status === "ready")) {
      const snapshot = projectEvents(this.store(profile.id).events(), profile.id);
      if (snapshot.terminalOwners.some((owner) => owner.status !== "acknowledged" && owner.cleanup !== "removed")) await this.control(profile.id);
    }
    return initial;
  }
  private saved(profile: Profile): EventInput { return { event_type: "profile.saved", profile_id: GLOBAL_PROFILE_ID, payload: { profile } }; }
  private profile(id: string, ready = true): Profile {
    const profile = this.catalog().profiles.find((profile) => profile.id === id);
    if (!profile || id === GLOBAL_PROFILE_ID) throw new MoguriError("profile_missing", "Choose an existing user profile. No Default fallback was used.", 404);
    if (ready && profile.status !== "ready") throw new MoguriError("profile_unready", profile.diagnostic ?? "Profile setup is incomplete. Inspect and explicitly retry; no fallback was used.", 409);
    return profile;
  }
  private store(id: string): EventStore {
    let store = this.stores.get(id);
    if (!store) { store = this.initial.view(id); this.stores.set(id, store); }
    return store;
  }
  private named(name: string, except?: string): string {
    name = name.trim().normalize("NFC");
    if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new MoguriError("profile_name", "Use a non-empty profile name up to 80 characters without control characters.");
    if (this.catalog().profiles.some((profile) => profile.id !== except && profile.name.toLowerCase() === name.toLowerCase())) throw new MoguriError("profile_name", "This profile name already exists. Choose a distinct name.", 409);
    return name;
  }
  private async resourceDirectory(id: string, create: boolean): Promise<string> {
    if (id === PROFILE_ID) return this.stateDir;
    if (!/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(id)) throw new MoguriError("profile_identity", "This is not an owned profile identity. No arbitrary directory was used.");
    const root = await realpath(this.stateDir), parent = join(root, "profiles");
    await mkdir(parent, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    const owned = async (path: string) => {
      const metadata = await lstat(path);
      if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || metadata.mode & 0o077 || await realpath(path) !== path) throw new MoguriError("profile_directory", "The profile resource directory is not canonical/private/user-owned. Nothing was adopted.", 409);
    };
    await owned(parent);
    const path = join(parent, id), marker = JSON.stringify({ schemaVersion: 1, profileId: id, owner: "moguri" });
    if (create) {
      await mkdir(path, { mode: 0o700 }); await owned(path);
      await writeArtifactExport(join(path, "profile-owner.json"), { filename: "profile-owner.json", mediaType: "application/json", text: marker, digest: digest(marker) });
    } else {
      await owned(path);
      const metadata = await lstat(join(path, "profile-owner.json"));
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || metadata.mode & 0o077 || await readFile(join(path, "profile-owner.json"), "utf8") !== marker) throw new MoguriError("profile_directory", "The exact profile ownership marker is missing/changed. No adoption or replay occurred.", 409);
    }
    return path;
  }
  async control(id: string): Promise<ControlPlane> {
    if (this.closed) throw new MoguriError("shutting_down", "The profile service is closing.", 503);
    this.profile(id);
    const pending = this.loading.get(id); if (pending) return pending;
    const current = this.controllers.get(id); if (current) return current;
    const task = (async () => {
      const directory = await this.resourceDirectory(id, false), control = this.options.controller(this.store(id), directory, this.hooks);
      try {
        control.on("change", (events: StoredEvent[]) => this.options.changed(id, events.filter((event) => event.profile_id === id)));
        await control.initialize();
        if (this.closed) throw new MoguriError("shutting_down", "Profile initialization was interrupted by service shutdown.", 503);
        control.refreshProfile(true);
        this.controllers.set(id, control);
        return control;
      } catch (error) { this.controllers.delete(id); await control.close(); throw error; }
    })().finally(() => this.loading.delete(id));
    this.loading.set(id, task); return task;
  }
  private settingsReplica(id: string, values: ControlDefaults): EventInput {
    const settings = projectEvents(this.store(id).events(), id).settings;
    return { event_type: "settings.updated", profile_id: id, payload: { settings: { ...settings.values, startup: { ...settings.values.startup, global: structuredClone(values) } }, revision: settings.revision + 1, permissionRevision: settings.permissionRevision } };
  }
  private extend(id: string, events: EventInput[]): EventInput[] {
    const result = [...events], catalog = this.catalog();
    for (const event of events) {
      if (event.event_type === "policy.updated") {
        if (event.payload.policy.revision !== catalog.environmentPolicy.revision + 1) throw new MoguriError("global_policy_conflict", "Global policy changed. Reload before applying it; no profile bypass was admitted.", 409);
        result.push({ event_type: "global.policy_changed", profile_id: GLOBAL_PROFILE_ID, payload: { policy: event.payload.policy } });
        for (const profile of catalog.profiles.filter((profile) => profile.id !== id)) {
          const control = this.controllers.get(profile.id), finishingTurnIds = event.payload.policy.allowedEnvs.includes("Local") ? [] :
            control?.snapshot().sessions.filter((session) => session.turnId && session.controls.env === "Local").map((session) => session.turnId!) ?? [];
          result.push({ event_type: "policy.updated", profile_id: profile.id, payload: { policy: event.payload.policy, finishingTurnIds } });
        }
      }
      if (event.event_type === "settings.updated" && JSON.stringify(event.payload.settings.startup.global) !== JSON.stringify(catalog.globalDefaults.values)) {
        result.push({ event_type: "global.controls_changed", profile_id: GLOBAL_PROFILE_ID, payload: { revision: catalog.globalDefaults.revision + 1, values: event.payload.settings.startup.global } });
        for (const profile of catalog.profiles.filter((profile) => profile.id !== id)) result.push(this.settingsReplica(profile.id, event.payload.settings.startup.global));
      }
    }
    return result;
  }
  private committed(id: string, events: StoredEvent[]): void {
    const globalChanged = events.some((event) => event.profile_id === GLOBAL_PROFILE_ID), policyChanged = events.some((event) => event.event_type === "global.policy_changed");
    if (globalChanged) for (const [other, control] of this.controllers) if (other !== id) control.refreshProfile(policyChanged);
    if (globalChanged || this.catalog().globalBudget.limit && events.some((event) => event.event_type === "budget.recorded" || event.event_type === "budget.plan_recorded")) this.options.changed(GLOBAL_PROFILE_ID, []);
    if (events.some((event) => ["turn.finished", "job.finished", "session.resumed", "session.mode_changed", "workspace.saved"].includes(event.event_type))) {
      for (const [other, control] of this.controllers) if (other !== id) control.wake();
    }
  }
  private globalBudget(): GlobalBudgetCapacity {
    if (this.closedBudget) return structuredClone(this.closedBudget);
    const catalog = this.catalog(), limit = catalog.globalBudget.limit;
    if (!limit) return { limit: null, chargedTokens: 0, chargedUsdMicros: 0 };
    const catalogSequence = this.global.events().at(-1)?.seq ?? 0, accountingSequence = this.initial.globalBudgetSequence();
    const writers = [this.global, ...this.stores.values()].filter((store) => store.db.isTransaction);
    const speculative = writers.some((store) => store.globalBudgetSequence() !== accountingSequence);
    if (!speculative && this.budgetCache?.catalogSequence === catalogSequence && this.budgetCache.accountingSequence === accountingSequence) {
      return structuredClone(this.budgetCache.value);
    }
    const entries: BudgetEntry[] = [], plans: BudgetPlan[] = [];
    for (const profile of catalog.profiles) {
      const store = this.store(profile.id), events = store.eventsOfTypes(["budget.recorded", "budget.plan_recorded"]);
      if (events.some((event) => event.event_type === "budget.plan_recorded")) {
        const accounting = projectEvents(store.events(), profile.id);
        entries.push(...accounting.budgetEntries); plans.push(...accounting.budgetPlans); continue;
      }
      const latest = new Map<string, BudgetEntry>();
      for (const event of events) if (event.event_type === "budget.recorded") latest.set(event.payload.entry.id, event.payload.entry);
      entries.push(...latest.values());
    }
    const charges = budgetCharges(entries, plans);
    const value = { limit, chargedTokens: charges.tokens, chargedUsdMicros: charges.usdMicros };
    // Aborted SQLite writes can reuse sequence numbers; never publish speculative capacity into the cache.
    if (!writers.length) this.budgetCache = { catalogSequence, accountingSequence, value: structuredClone(value) };
    return value;
  }
  private foreignRootBusy(id: string, root: string, includeNested = false): boolean {
    for (const profile of this.catalog().profiles) {
      if (profile.id === id) continue;
      const control = this.controllers.get(profile.id);
      if (control?.ownedWriteRoots().some((owned) => includeNested ? localRootsOverlap(root, owned) : owned === root)) return true;
      const state = control?.snapshot() ?? projectEvents(this.store(profile.id).events(), profile.id);
      if (!root.startsWith("remote/") && state.chatWriters.some((writer) => ["active", "unconfirmed"].includes(writer.status) &&
        localRootsOverlap(root, writer.root.root))) return true;
      if (state.jobs.some((job) => job.commandJob && (job.status === "running" || job.status === "waiting_input" || job.status === "partial" && !job.commandJob.inspected) &&
        (includeNested ? localRootsOverlap(root, job.commandJob.root) : root === job.commandJob.root))) return true;
      if (state.jobs.some((job) => job.projectClone && ["running", "waiting_input"].includes(job.status) && localRootsOverlap(root, job.projectClone.path))) return true;
      if (state.repositoryImports.some((batch) => (batch.status === "running" ? batch.leaseRoots : batch.items.filter((item) =>
        item.status === "partial" && !item.inspection).map((item) => item.path)).some((owned) => localRootsOverlap(root, owned)))) return true;
      if (remoteRootQuarantined(state, root) || githubRootQuarantined(state, root) || state.projects.some((project) =>
        state.blockedProjects.includes(project.id) && (includeNested ? localRootsOverlap(project.path, root) : project.path === root)) ||
        state.managedWorkspaces.some((workspace) => state.blockedWorkspaces.includes(workspace.id) &&
          (includeNested ? localRootsOverlap(workspace.path, root) : workspace.path === root))) return true;
    }
    return false;
  }
  private foreignConsoleBusy(id: string, root: string): boolean {
    for (const profile of this.catalog().profiles) {
      if (profile.id === id) continue;
      const state = this.controllers.get(profile.id)?.snapshot() ?? projectEvents(this.store(profile.id).events(), profile.id);
      if (state.terminals.some((terminal) => terminal.binding?.env === "Local" && terminal.binding.root === root &&
        !["closed", "failed", "acknowledged"].includes(terminal.status))) return true;
    }
    return false;
  }
  private setup(profile: Profile, create: boolean): void {
    const abort = new AbortController();
    const done = (async () => {
      try {
        abort.signal.throwIfAborted();
        try { await this.resourceDirectory(profile.id, create); }
        catch (error) {
          if (create || !(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
          await this.resourceDirectory(profile.id, true);
        }
        abort.signal.throwIfAborted();
        const catalog = this.catalog();
        this.store(profile.id).commit([
          { event_type: "policy.updated", profile_id: profile.id, payload: { policy: catalog.environmentPolicy, finishingTurnIds: [] } },
          this.settingsReplica(profile.id, catalog.globalDefaults.values),
        ]);
        abort.signal.throwIfAborted();
        this.global.commit([this.saved({ ...profile, status: "ready", revision: profile.revision + 1, diagnostic: null })]);
      } catch (error) {
        console.error("Profile setup did not complete:", abort.signal.aborted ? "cancelled" : error instanceof MoguriError ? error.code : error instanceof Error && "code" in error ? error.code : "profile_setup");
        this.global.commit([this.saved({ ...profile, status: "partial", revision: profile.revision + 1, diagnostic: abort.signal.aborted ? "Profile setup was stopped. Resources were preserved, not adopted or replayed; inspect and explicitly retry." : error instanceof MoguriError ? error.message : "Profile resource setup failed. Inspect its owned directory before explicitly retrying; no account or data was copied." })]);
      } finally { this.active.delete(profile.id); this.options.changed(GLOBAL_PROFILE_ID, []); }
    })();
    this.active.set(profile.id, { abort, done });
  }
  dispatch(envelope: CommandEnvelope, command: ProfileCommand): Promise<CommandResult> {
    this.profile(envelope.profileId);
    const hash = digest(JSON.stringify({ profileId: envelope.profileId, command })), current = this.pending.get(envelope.id);
    if (current) {
      if (current.digest !== hash) return Promise.reject(new MoguriError("idempotency_conflict", "Root command ID changed arguments or profile.", 409));
      return current.result;
    }
    const existing = this.global.receipt(envelope.id, hash); if (existing) return Promise.resolve(existing);
    const result = this.perform(envelope.id, hash, command).finally(() => this.pending.delete(envelope.id));
    this.pending.set(envelope.id, { digest: hash, result }); return result;
  }
  receipt(envelope: CommandEnvelope): CommandResult | undefined {
    this.profile(envelope.profileId);
    return this.global.receipt(envelope.id, digest(JSON.stringify({ profileId: envelope.profileId, command: envelope.command })));
  }
  private async perform(id: string, hash: string, command: ProfileCommand): Promise<CommandResult> {
    if (this.closed) throw new MoguriError("shutting_down", "No new profile action can start during shutdown.", 503);
    const finish = (events: EventInput[], result: CommandResult) => {
      const appended = this.global.commit(events, { id, digest: hash, result });
      for (const control of this.controllers.values()) control.refreshProfile(appended.some((event) => event.event_type === "global.policy_changed"));
      this.options.changed(GLOBAL_PROFILE_ID, []); return result;
    };
    if (command.type === "profile.create") {
      const profile: Profile = { id: randomUUID(), name: this.named(command.name), color: command.color, revision: 0, status: "creating", diagnostic: null, createdAt: new Date().toISOString() };
      const result = finish([this.saved(profile)], { id: profile.id, revision: 0 }); this.setup(profile, true); return result;
    }
    if (command.type === "profile.global.defaults") {
      const budgets = (await this.control(PROFILE_ID)).platform.budgets;
      const current = this.catalog().globalDefaults;
      if (current.revision !== command.expectedRevision) throw new MoguriError("global_defaults_conflict", "Global startup preferences changed. Reload before saving.", 409);
      if (command.values.budget?.kind === "limited") budgets.validateLimit(command.values.budget);
      return finish([{ event_type: "global.controls_changed", profile_id: GLOBAL_PROFILE_ID, payload: { revision: current.revision + 1, values: command.values } },
        ...this.catalog().profiles.map((profile) => this.settingsReplica(profile.id, command.values))], { revision: current.revision + 1 });
    }
    if (command.type === "profile.global.budget") {
      const budgets = (await this.control(PROFILE_ID)).platform.budgets;
      const current = this.catalog().globalBudget;
      if (current.revision !== command.expectedRevision) throw new MoguriError("global_budget_conflict", "Global budget policy changed. Reload before saving.", 409);
      budgets.validateLimit(command.limit);
      return finish([{ event_type: "global.budget_changed", profile_id: GLOBAL_PROFILE_ID, payload: { revision: current.revision + 1, limit: command.limit } }], { revision: current.revision + 1 });
    }
    const profile = this.profile(command.targetProfileId, false);
    if (command.type === "profile.cancel") {
      const active = this.active.get(profile.id);
      if (!active) throw new MoguriError("profile_setup", "Only an active owned profile setup can be stopped.", 409);
      active.abort.abort(); return finish([], { id: profile.id });
    }
    if (profile.revision !== command.expectedRevision) throw new MoguriError("profile_revision", "Profile metadata changed. Reload before editing or retrying.", 409);
    if (command.type === "profile.retry") {
      if (profile.status !== "partial" || this.active.has(profile.id)) throw new MoguriError("profile_setup", "Inspect and explicitly retry only a partial, inactive profile setup.", 409);
      const creating = { ...profile, status: "creating" as const, revision: profile.revision + 1, diagnostic: "Explicit retry after user inspection." };
      const result = finish([this.saved(creating)], { id: profile.id, revision: creating.revision }); this.setup(creating, false); return result;
    }
    if (!Object.keys(command.changes).length) throw new MoguriError("profile_changes", "Choose an actual profile name/color change.");
    if (profile.status === "creating" || this.active.has(profile.id)) throw new MoguriError("profile_setup", "Finish or stop owned profile setup before editing its metadata. No stale setup snapshot was overwritten.", 409);
    const updated = { ...profile, ...command.changes, ...(command.changes.name !== undefined ? { name: this.named(command.changes.name, profile.id) } : {}), revision: profile.revision + 1 };
    return finish([this.saved(updated)], { id: profile.id, revision: updated.revision });
  }
  close(options: RuntimeCloseOptions = {}): Promise<void> {
    this.closeTask ??= this.shutdown(options).catch((error: unknown) => { this.closeTask = undefined; throw error; });
    return this.closeTask;
  }
  private async shutdown(options: RuntimeCloseOptions): Promise<void> {
    this.closed = true;
    for (const active of this.active.values()) active.abort.abort();
    const closing = Promise.allSettled([...this.controllers.values()].map((controller) => controller.close(options)));
    await Promise.all([...this.active.values()].map((active) => active.done));
    const loaded = await Promise.allSettled([...this.loading.values()]);
    for (const result of loaded) if (result.status === "rejected") console.error("Profile initialization ended during shutdown:", result.reason instanceof MoguriError ? result.reason.code : "profile_initialization");
    const settled = await closing;
    const failed = settled.find((result) => result.status === "rejected");
    for (const result of settled) if (result.status === "rejected") console.error("Profile cleanup failed:", result.reason instanceof MoguriError ? result.reason.code : "profile_cleanup");
    if (failed?.status === "rejected") throw failed.reason;
    this.closedBudget = this.globalBudget();
    for (const [id, store] of this.stores) if (id !== PROFILE_ID) store.close();
    this.global.close();
  }
}
