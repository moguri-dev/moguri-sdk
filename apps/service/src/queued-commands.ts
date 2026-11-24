import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Type } from "typebox";
import { MoguriSdk, ClientError, executeSlash, type SlashResult } from "../../../packages/sdk/src/index.ts";
import {
  AttachmentSchema, CommandBindingSchema, QueuedSlashSchema, QuerySchema, SlashResultSchema, commandViewKey, isRecord, parse, terminalCommandExecution, MoguriError,
  type Command, type CommandBinding, type CommandClient, type CommandEnvelope, type CommandExecution, type CommandResult,
  type Connection, type EventInput, type PlatformQuery, type PlatformResponse, type QueueItem, type QueuedSlash, type Session, type Snapshot, type StoredEvent,
  type QueuedCommandCommand, type QueuedCommandQuery, type QueuedCommandResponse,
} from "../../../packages/protocol/src/index.ts";
import { EventStore, digest } from "./store.ts";
import { frameDigest } from "./worker-wire.ts";
import { durableIdentity } from "./repository-source.ts";

export interface CommandOwner {
  id: string; profileId: string; sessionId: string; item: QueueItem; signal: AbortSignal; guard(): void;
}
export interface CommandEnvironment {
  connection: Connection;
  command(envelope: CommandEnvelope, owner: CommandOwner): Promise<CommandResult>;
  query(profileId: string, query: PlatformQuery, owner: CommandOwner, signal: AbortSignal): Promise<PlatformResponse>;
}
interface Host {
  snapshot(): Snapshot;
  events(): StoredEvent[];
  subscribe(listener: () => void): () => void;
  binding(session: Session): CommandBinding;
  canRun(session: Session): boolean;
  commit(events: EventInput[]): void;
  wake(): void;
  pause(sessionId: string): void;
  environment?: () => Promise<CommandEnvironment>;
}
interface Active { owner: CommandOwner; abort: AbortController; mutationAttempted: boolean; markMutation(): void }
/** A command binding without boot-scoped device numbers, so retained digests survive a reboot. */
export const durableCommandBinding = (binding: CommandBinding) => ({ ...binding, roots: binding.roots.map((root) => durableIdentity(root)) });
export const commandBindingDigest = (binding: CommandBinding) => frameDigest(durableCommandBinding(binding));
/** Also accepts the pre-116 digest, which included the device number. */
export const commandBindingMatches = (digest: string, binding: CommandBinding) => digest === commandBindingDigest(binding) || digest === frameDigest(binding);

class ServiceCommandSdk extends MoguriSdk {
  constructor(private readonly environment: CommandEnvironment, private readonly owner: CommandOwner, private readonly host: Host, private readonly active: Active) {
    super(environment.connection, undefined, owner.profileId);
  }
  override getState = () => ({ snapshot: this.host.snapshot(), status: this.owner.signal.aborted ? "disconnected" as const : "connected" as const,
    error: this.owner.signal.aborted ? "The original queued command owner stopped." : null, events: this.host.events(), disk: null });
  override subscribe = (listener: () => void) => {
    const unsubscribe = this.host.subscribe(listener); let subscribed = true;
    return () => { if (!subscribed) return false; subscribed = false; unsubscribe(); return true; };
  };
  override async refresh(): Promise<void> {
    // State is read from the authoritative controller, not a second client cache.
  }
  override async command(command: Command, id = randomUUID()): Promise<CommandResult> {
    this.owner.guard(); this.active.markMutation();
    return this.environment.command({ id, profileId: this.owner.profileId, command }, this.owner);
  }
  override async query<Q extends PlatformQuery>(query: Q, signal?: AbortSignal): Promise<Extract<PlatformResponse, { type: Q["type"] }>> {
    this.owner.guard(); parse(QuerySchema, query);
    const result = await this.environment.query(this.owner.profileId, query, this.owner, signal ? AbortSignal.any([signal, this.owner.signal]) : this.owner.signal);
    this.owner.guard();
    if (!isRecord(result) || result.type !== query.type) throw new MoguriError("command_response", "The original queued command returned an incompatible capability response. No substitute was used.", 409);
    return result as Extract<PlatformResponse, { type: Q["type"] }>;
  }
  protected override request(): Promise<unknown> {
    return Promise.reject(new ClientError("command_native_ui", "This native client operation needs an acknowledged compatible client. It cannot run through a replacement service transport."));
  }
}

export class QueuedCommands {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly active = new Map<string, Active>();
  private readonly clients = new Map<string, { client: CommandClient; handlers: Set<string> }>();
  constructor(private readonly store: EventStore, private readonly host: Host) {}
  capture(session: Session, parsed: { name: string; argument: string }, client: CommandClient, draftRevision?: number): QueuedSlash {
    if (!this.host.environment) throw new MoguriError("command_transport", "This controller has no qualified shared-SDK command executor. The original draft was preserved.", 409);
    const binding = parse(CommandBindingSchema, this.host.binding(session));
    return parse(QueuedSlashSchema, { version: 1, actor: "user", client, ...parsed, binding, bindingDigest: commandBindingDigest(binding), ...(draftRevision === undefined ? {} : { draftRevision }) });
  }
  busy(sessionId: string): boolean {
    return this.pending.has(sessionId) || this.host.snapshot().commandExecutions.some((entry) => entry.sessionId === sessionId && !terminalCommandExecution(entry.status));
  }
  private record(id: string): CommandExecution | undefined { return this.host.snapshot().commandExecutions.find((entry) => entry.id === id); }
  private event(execution: CommandExecution): EventInput {
    return { event_type: "slash.command_recorded", profile_id: execution.profileId, project_id: execution.projectId,
      session_id: execution.sessionId, payload: { execution } };
  }
  private held(sessionId: string): EventInput[] {
    const session = this.host.snapshot().sessions.find((session) => session.id === sessionId);
    return session?.queue.length ? [{ event_type: "queue.held", profile_id: this.store.profileId, project_id: session.projectId,
      session_id: session.id, payload: { messageIds: session.queue.map((item) => item.id) } }] : [];
  }
  query(query: QueuedCommandQuery): QueuedCommandResponse {
    const execution = this.record(query.executionId);
    if (!execution) throw new MoguriError("command_missing", "This queued command is outside the actual retained profile/session.", 404);
    const input: unknown = JSON.parse(this.store.blob(execution.inputDigest));
    if (!isRecord(input) || input.format !== "moguri-queued-command" || input.version !== 1 || !isRecord(input.item) ||
      typeof input.item.text !== "string" || input.item.id !== execution.queueItemId || input.item.delivery !== "queue") {
      throw new MoguriError("command_input", "The original queued command input is missing or corrupt. No source was reconstructed.", 409);
    }
    const command = parse(QueuedSlashSchema, input.item.command);
    if (command.name !== execution.name || command.client !== execution.client || command.bindingDigest !== execution.bindingDigest ||
      command.binding.profileId !== execution.profileId || command.binding.sessionId !== execution.sessionId || !commandBindingMatches(execution.bindingDigest, command.binding)) {
      throw new MoguriError("command_input", "The original queued command lost its exact immutable input/root binding.", 409);
    }
    const item: QueueItem = { id: execution.queueItemId, text: input.item.text, attachments: parse(Type.Array(AttachmentSchema, { maxItems: 16 }), input.item.attachments),
      command, delivery: "queue", ...(input.item.held === true ? { held: true } : {}) };
    let result: SlashResult | null = null;
    if (execution.resultDigest) {
      const output: unknown = JSON.parse(this.store.blob(execution.resultDigest));
      if (!isRecord(output) || output.format !== "moguri-command-result" || output.version !== 1) throw new MoguriError("command_result", "The original queued command result is corrupt. It was not replayed.", 409);
      result = parse(SlashResultSchema, output.result);
    }
    return { type: query.type, execution, item, result };
  }
  private assertClaim(command: { clientId: string; expectedRevision: number; token: string }, execution: CommandExecution): void {
    if (!this.clients.has(command.clientId)) throw new MoguriError("command_client_missing", "The actual original command client is no longer attached.", 409);
    if (execution.revision !== command.expectedRevision) throw new MoguriError("command_revision", "The original queued claim changed. No choice or action was repeated.", 409);
    const expected = execution.claim ? Buffer.from(execution.claim.tokenDigest, "hex") : null, actual = Buffer.from(digest(command.token), "hex");
    if (execution.status !== "claimed" || execution.claim?.clientId !== command.clientId || !expected || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new MoguriError("command_claim", "This is not the exact original client claim. No result or permission was acknowledged.", 403);
    }
  }
  continuation(command: Extract<QueuedCommandCommand, { type: "slash.client.choose" }>) {
    const read = this.query({ type: "slash.read", executionId: command.executionId }), execution = read.execution;
    this.assertClaim(command, execution);
    const review = read.result?.kind === "continue-work" ? read.result.review : null;
    if (!review || !("command" in review) || execution.name !== "continue-work" || review.profileId !== execution.profileId ||
      review.sessionId !== execution.sessionId || review.text !== read.item.text || review.command.executionId !== execution.id ||
      review.command.inputDigest !== execution.inputDigest || review.command.bindingDigest !== execution.bindingDigest) {
      throw new MoguriError("command_continuation", "Choose only the exact retained original continuation input, not a newer draft or another command.", 409);
    }
    const session = this.host.snapshot().sessions.find((session) => session.id === execution.sessionId);
    if (!session || execution.stopRequested || !commandBindingMatches(execution.bindingDigest, this.host.binding(session))) {
      throw new MoguriError("command_scope", "The original continuation root/profile/Env changed. No replacement source was delegated.", 409);
    }
    return { ...read, session };
  }
  continuationEvents(command: Extract<QueuedCommandCommand, { type: "slash.client.choose" }>): EventInput[] {
    const { execution } = this.continuation(command);
    return [{ event_type: "slash.continuation_chosen", profile_id: execution.profileId, project_id: execution.projectId, session_id: execution.sessionId,
      payload: { choice: { executionId: execution.id, inputDigest: execution.inputDigest, bindingDigest: execution.bindingDigest, choice: command.choice, actor: "user" } } },
    this.event({ ...execution, revision: execution.revision + 1, status: "completed", mutationAttempted: true, updatedAt: new Date().toISOString(), diagnostic: null })];
  }
  execute(command: Exclude<QueuedCommandCommand, { type: "slash.client.choose" | "slash.restore.enqueue" | "slash.prompt.enqueue" | "slash.control.enqueue" }>, finish: (events: EventInput[], result?: CommandResult) => CommandResult): CommandResult {
    if (command.type === "slash.client.attach") {
      if (this.clients.has(command.clientId)) throw new MoguriError("command_client_conflict", "This exact command client is already attached. Do not replace its active claims.", 409);
      const result = finish([], { id: command.clientId });
      this.clients.set(command.clientId, { client: command.client, handlers: new Set(command.handlers) }); return result;
    }
    const client = this.clients.get(command.clientId);
    if (!client) throw new MoguriError("command_client_missing", "The original command client is not attached to this profile. No replacement client inherited it.", 409);
    if (command.type === "slash.client.detach") {
      const claimed = this.host.snapshot().commandExecutions.filter((entry) => entry.status === "claimed" && entry.claim?.clientId === command.clientId);
      const events = claimed.flatMap((entry) => {
        this.host.pause(entry.sessionId);
        return [this.event({ ...entry, revision: entry.revision + 1, status: "partial", stopRequested: true, updatedAt: new Date().toISOString(),
          diagnostic: "The original client detached before acknowledging its UI action. The effect is unknown; no view, copy, export or editor was replayed." }), ...this.held(entry.sessionId)];
      });
      const result = finish(events, { id: command.clientId }); this.clients.delete(command.clientId); return result;
    }
    const read = this.query({ type: "slash.read", executionId: command.executionId }), execution = read.execution;
    if (execution.revision !== command.expectedRevision) throw new MoguriError("command_revision", "Another client changed the exact command result or claim. Reload it; no duplicate action was admitted.", 409);
    if (command.type === "slash.client.claim") {
      if (execution.status !== "waiting-client" || execution.client !== client.client || !read.result || !client.handlers.has(commandViewKey(read.result))) {
        throw new MoguriError("command_client_incompatible", "This client has no exact handler for the original queued UI result. It remains undispatched, not treated as a model prompt.", 409);
      }
      if (this.host.snapshot().commandExecutions.some((entry) => entry.status === "claimed" && entry.claim?.clientId === command.clientId)) {
        throw new MoguriError("command_client_busy", "This client still owns another unacknowledged UI action. No second view took its focus.", 409);
      }
      const session = this.host.snapshot().sessions.find((session) => session.id === execution.sessionId);
      if (!session || !commandBindingMatches(execution.bindingDigest, this.host.binding(session))) throw new MoguriError("command_scope", "The original command source changed before client delivery. No replacement view or source was selected.", 409);
      const token = randomBytes(32).toString("hex"), claim = { id: randomUUID(), clientId: command.clientId, tokenDigest: digest(token) };
      return finish([this.event({ ...execution, revision: execution.revision + 1, status: "claimed", claim, updatedAt: new Date().toISOString(),
        diagnostic: "The exact compatible client owns this UI result; application acknowledgement is still pending." })],
      { commandClaim: { executionId: execution.id, token, revision: execution.revision + 1 } });
    }
    this.assertClaim(command, execution);
    const session = this.host.snapshot().sessions.find((session) => session.id === execution.sessionId);
    if (command.outcome === "completed" && (!session || !commandBindingMatches(execution.bindingDigest, this.host.binding(session)))) {
      throw new MoguriError("command_scope", "The original UI action's root/Env changed before its acknowledgement. Report its actual partial outcome; do not retry the action.", 409);
    }
    const outcome = command.outcome === "cancelled" && execution.mutationAttempted ? "partial" : command.outcome;
    if (command.restoreInput && (command.outcome !== "cancelled" || read.result?.kind !== "continue-work" || execution.mutationAttempted)) {
      throw new MoguriError("command_restore", "Only actual cancellation of an unchanged, non-mutating continuation may restore its original input.", 409);
    }
    const restore: EventInput[] = [];
    let diagnostic = command.diagnostic ?? "The original UI action did not complete. Existing service effects and the exact input were retained; nothing was replayed.";
    if (command.restoreInput) {
      let sameBinding = false;
      try { sameBinding = Boolean(session && commandBindingMatches(execution.bindingDigest, this.host.binding(session))); }
      catch (error) {
        console.error("Cancelled command draft was not restored because its original source could not be verified:", error instanceof Error ? error.message : "unknown source error");
      }
      if (sameBinding && session && read.item.command?.draftRevision !== undefined && session.draft.revision === read.item.command.draftRevision + 1 &&
        !session.draft.text && !session.draft.attachments.length) {
        restore.push({ event_type: "draft.saved", profile_id: execution.profileId, project_id: execution.projectId, session_id: execution.sessionId,
          payload: { text: read.item.text, attachments: read.item.attachments } });
        diagnostic += " The unchanged empty composer received its exact original input.";
      } else diagnostic += " A newer draft or changed source was preserved. The complete original input remains in this command's retained record.";
    }
    if (outcome !== "completed") this.host.pause(execution.sessionId);
    const result = finish([this.event({ ...execution, revision: execution.revision + 1, status: outcome, updatedAt: new Date().toISOString(),
      diagnostic: outcome === "completed" ? null : diagnostic }), ...restore,
    ...(outcome === "completed" ? [] : this.held(execution.sessionId))], { id: execution.id, revision: execution.revision + 1 });
    this.host.wake(); return result;
  }
  pump(session: Session, item: QueueItem): void {
    if (!item.command || this.busy(session.id)) return;
    if (!this.host.environment) throw new MoguriError("command_transport", "This controller has no qualified shared-SDK command executor. The original queue was preserved.", 409);
    const task = this.run(session.id, item, this.host.environment).catch((error: unknown) => {
      this.host.pause(session.id);
      console.error("Queued command persistence/ownership failed:", error instanceof MoguriError ? error.code : "command_persistence");
    }).finally(() => { this.pending.delete(session.id); this.active.delete(session.id); this.host.wake(); });
    this.pending.set(session.id, task);
  }
  private async run(sessionId: string, item: QueueItem, environment: () => Promise<CommandEnvironment>): Promise<void> {
    const transport = await environment();
    const session = this.host.snapshot().sessions.find((session) => session.id === sessionId);
    if (!session || !this.host.canRun(session) || session.status === "archived" && item.command?.name !== "restore" || session.queue.find((entry) => entry.delivery !== "steer" && !entry.held)?.id !== item.id) {
      console.info("Queued command admission ended before dispatch because its original owner/head changed.");
      return;
    }
    const command = parse(QueuedSlashSchema, item.command), now = new Date().toISOString();
    const inputDigest = this.store.putBlob(JSON.stringify({ format: "moguri-queued-command", version: 1, item }));
    const execution: CommandExecution = { version: 1, id: randomUUID(), profileId: this.store.profileId, sessionId, projectId: session.projectId,
      queueItemId: item.id, name: command.name, client: command.client, actor: "user", bindingDigest: command.bindingDigest, inputDigest,
      revision: 0, status: "running", stopRequested: false, mutationAttempted: false, jobIds: [], claim: null, resultDigest: null, diagnostic: null, createdAt: now, updatedAt: now };
    const abort = new AbortController();
    const owner: CommandOwner = { id: execution.id, profileId: this.store.profileId, sessionId, item, signal: abort.signal, guard: () => {
      abort.signal.throwIfAborted();
      const current = this.host.snapshot().sessions.find((session) => session.id === sessionId), retained = this.record(execution.id);
      if (!current || !this.host.canRun(current) || retained?.status !== "running" || retained.stopRequested || !commandBindingMatches(command.bindingDigest, this.host.binding(current))) {
        throw new MoguriError("command_scope", "The original queued command's profile, Env or root changed. No replacement source or execution was used.", 409);
      }
    } };
    const active: Active = { owner, abort, mutationAttempted: false, markMutation: () => {
      if (active.mutationAttempted) return;
      const current = this.record(execution.id);
      if (!current) throw new MoguriError("command_source", "The original queued command ended before mutation admission.", 409);
      this.host.commit([this.event({ ...current, revision: current.revision + 1, mutationAttempted: true, updatedAt: new Date().toISOString() })]);
      active.mutationAttempted = true;
    } };
    this.active.set(sessionId, active);
    this.host.commit([this.event(execution)]);
    try {
      owner.guard();
      const sdk = new ServiceCommandSdk(transport, owner, this.host, active);
      const result: SlashResult = parse(SlashResultSchema, await executeSlash(sdk, sessionId, item.text, command.client,
        { executionId: execution.id, inputDigest, bindingDigest: execution.bindingDigest }));
      abort.signal.throwIfAborted();
      const current = this.record(execution.id);
      if (!current) { console.info("Queued command source was explicitly removed; its result was discarded without recreating session state."); return; }
      const resultDigest = this.store.putBlob(JSON.stringify({ format: "moguri-command-result", version: 1, result }));
      this.host.commit([this.event({ ...current, revision: current.revision + 1, updatedAt: new Date().toISOString(), resultDigest,
        status: result.kind === "ok" || result.kind === "text" ? "completed" : "waiting-client",
        diagnostic: result.kind === "ok" || result.kind === "text" ? null : "The service action finished. Its exact UI result waits for a compatible client acknowledgement." })]);
    } catch (error) {
      const current = this.record(execution.id);
      if (!current) { console.info("Queued command source ended during owned work; no result or session was resurrected."); return; }
      const known = error instanceof MoguriError || error instanceof ClientError;
      const diagnostic = known ? error.message : error instanceof SyntaxError ? "Queued command arguments were not valid JSON. No text was sent to a model." :
        abort.signal.aborted ? "The original queued command was cancelled. Interrupted effects require inspection; nothing was replayed." :
          "Queued command failed. Inspect service diagnostics and its original retained input; no model prompt or fallback was used.";
      if (!known && !abort.signal.aborted && !(error instanceof SyntaxError)) console.error("Queued slash execution failed:", error instanceof Error ? error.name : "unknown_error");
      this.host.pause(sessionId);
      this.host.commit([this.event({ ...current, revision: current.revision + 1, updatedAt: new Date().toISOString(),
        stopRequested: abort.signal.aborted || current.stopRequested, status: active.mutationAttempted ? "partial" : abort.signal.aborted ? "cancelled" : "failed", diagnostic }),
      ...this.held(sessionId)]);
    }
  }
  cancel(sessionId: string, settlingArchiveId?: string): void {
    const active = this.active.get(sessionId);
    if (!active) {
      const pending = this.host.snapshot().commandExecutions.find((entry) => entry.sessionId === sessionId && !terminalCommandExecution(entry.status));
      if (pending && pending.id === settlingArchiveId && pending.name === "archive" && pending.status === "claimed") return;
      if (pending) {
        this.host.pause(sessionId);
        this.host.commit([this.event({ ...pending, revision: pending.revision + 1, stopRequested: true, updatedAt: new Date().toISOString(),
          status: pending.status === "claimed" || pending.mutationAttempted ? "partial" : "cancelled",
          diagnostic: "The actual user stopped this original UI delivery. Claimed or already admitted effects are not replayed or labelled successful." }), ...this.held(sessionId)]);
      }
      return;
    }
    const current = this.record(active.owner.id);
    if (current && !current.stopRequested) this.host.commit([this.event({ ...current, revision: current.revision + 1, stopRequested: true, updatedAt: new Date().toISOString(),
      diagnostic: "Stop requested for the exact queued command. Actual completion or partial effects are not yet acknowledged." })]);
    active.abort.abort(new MoguriError("command_cancelled", "The actual user stopped this original queued command. No later operation may inherit it.", 409));
  }
  recover(): EventInput[] {
    const events: EventInput[] = this.host.snapshot().commandExecutions.filter((entry) => ["running", "claimed"].includes(entry.status)).flatMap((entry) => [
      this.event({ ...entry, revision: entry.revision + 1, status: "partial", stopRequested: true, updatedAt: new Date().toISOString(),
        diagnostic: "The service restarted during original command/client ownership. Completion is unknown; no command or UI effect was replayed." }),
      ...this.held(entry.sessionId),
    ]);
    const lives = new Map<string, Extract<StoredEvent, { event_type: "slash.live_recorded" }>>();
    for (const event of this.host.events()) if (event.event_type === "slash.live_recorded") lives.set(event.payload.control.id, event);
    for (const event of lives.values()) if (event.payload.control.phase === "intent" && this.host.snapshot().sessions.some((session) => session.id === event.session_id)) {
      events.push({ event_type: "slash.live_recorded", profile_id: event.profile_id, project_id: event.project_id, session_id: event.session_id, turn_id: event.turn_id,
        payload: { control: { ...event.payload.control, phase: "partial", diagnostic: "The service restarted after original live-control intent. Existing delegation and actual effects were retained; no approval, stop, answer or paid call was replayed." } } });
    }
    return events;
  }
  async close(): Promise<void> {
    for (const sessionId of this.active.keys()) this.cancel(sessionId);
    for (const entry of this.host.snapshot().commandExecutions.filter((entry) => entry.status === "claimed")) this.cancel(entry.sessionId);
    await Promise.all(this.pending.values());
  }
}
