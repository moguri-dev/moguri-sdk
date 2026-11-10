import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { join, relative, resolve } from "node:path";
import {
  CHECKPOINT_SESSION_BYTES, CHECKPOINT_SESSION_COUNT, CHECKPOINT_STATE_BYTES, CHECKPOINT_FILE_BYTES,
  CheckpointStateSchema, CheckpointWorkspaceSchema, CheckpointRestorePlansSchema, MoguriError, parse,
  type CheckpointCommand, type CheckpointQuery, type CheckpointResponse, type CheckpointState, type CheckpointWorkspace,
  type CommandResult, type EventInput, type RewindFilePreview, type RewindMode, type RewindPreview, type RewindRecord,
  checkpointRootKey, type Session, type SessionRewind, type Snapshot, type StoredEvent, type TurnCheckpoint, type CheckpointCapture, type CheckpointCaptureSource,
  type CheckpointRestorePlan, type CheckpointRestoreResult, type RewindFileDecision, type RemoteExecution, type ProjectSettings,
} from "../../../packages/protocol/src/index.ts";
import { digest, type EventStore } from "./store.ts";
import type { WorkspaceFinish } from "./session-workspace.ts";
import { checkpointFileVersion, checkpointReviewDigest, checkpointWorkspace, type CheckpointRootInput } from "./checkpoint-files.ts";
import { bytesDigest, readRegularFileSync, scopedPathSync } from "./files.ts";
import { publishRewindFile } from "./rewind-files.ts";
import type { SkillAdmissions } from "./skill-admission.ts";
import { localRootsOverlap } from "./project-clone.ts";
import type { WorkerFrame } from "./worker-connection.ts";
import type { WorkerRequest } from "./worker-protocol.ts";

export interface CheckpointTransportCallbacks {
  execution(execution: RemoteExecution, frame?: WorkerFrame, request?: WorkerRequest): Promise<void>;
  moving(index: number): Promise<void>;
  observed(index: number): Promise<void>;
  result(results: CheckpointRestoreResult[]): Promise<void>;
}
interface Host {
  snapshot(): Snapshot; events(): StoredEvent[]; context(sessionId: string): unknown[]; parentContextMessages(sessionId: string): number;
  roots(session: Session): CheckpointRootInput[]; identity(session: Session): unknown; policy(session: Session): unknown;
  blockers(session: Session, mode: RewindMode, exceptOperationId?: string): string[]; rootBusy(root: string, exceptOperationId?: string): boolean;
  settle(sessionId: string, ownerId?: string): Promise<void>; commit(events: EventInput[]): void; wake(): void;
  assertWrite(session: Session, root: string, path: string, repositoryId?: string | null): void;
  capture(session: Session, capture: CheckpointCapture, signal: AbortSignal, check: () => void): Promise<CheckpointWorkspace>;
  captureLeases(session: Session): string[];
  captureBusy(session: Session, capture: CheckpointCapture): boolean;
  validateCapture(session: Session, capture: CheckpointCapture, workspace: CheckpointWorkspace, signal: AbortSignal, check: () => void): Promise<void>;
  restoreTransport?(session: Session, record: RewindRecord, plans: CheckpointRestorePlan[], current: CheckpointWorkspace, target: CheckpointWorkspace,
    decisions: RewindFileDecision[], signal: AbortSignal, check: () => void, callbacks: CheckpointTransportCallbacks):
    Promise<{ events: EventInput[]; results: CheckpointRestoreResult[]; nativeWorkspaceId?: string }>;
  inspectTransport?(session: Session, record: RewindRecord, plans: CheckpointRestorePlan[], signal: AbortSignal):
    Promise<{ effects: { root: string; path: string; currentDigest: string | null; backupDigest: string | null }[]; operationSettled: boolean; diagnostic: string }>;
  transportSettings?(session: Session): ProjectSettings | undefined;
}
const message = (error: unknown) => error instanceof Error ? error.message : "The exact checkpoint source could not be captured.";
const key = (root: string, path: string) => JSON.stringify([root, path]);
export class TurnCheckpoints {
  private readonly active = new Map<string, { sessionId: string; abort: AbortController; roots: string[]; done: Promise<void> }>();
  private readonly captures = new Map<string, { sessionId: string; abort: AbortController; done: Promise<void> }>();
  private readonly admissionScope = new AsyncLocalStorage<ReadonlyMap<string, string>>();
  private recovering = true;
  private closing = false;
  constructor(private readonly store: EventStore, private readonly host: Host, private readonly skills: SkillAdmissions) {}
  ready() { this.recovering = false; }
  async close() {
    this.closing = true;
    const owners = [...this.active.values()];
    for (const owner of owners) owner.abort.abort(new MoguriError("rewind_closing", "Service is closing; original rewind effects must be inspected, never replayed.", 409));
    const captures = [...this.captures.values()];
    for (const capture of captures) capture.abort.abort(new MoguriError("checkpoint_closing", "Service closed during original checkpoint capture. No read, stage or turn was replayed.", 409));
    await Promise.all([...owners.map((owner) => owner.done), ...captures.map((capture) => capture.done)]);
  }
  busy(sessionId: string) {
    return [...this.active.values()].some((owner) => owner.sessionId === sessionId) || [...this.captures.values()].some((capture) => capture.sessionId === sessionId) ||
      this.host.snapshot().checkpointCaptures.some((capture) => capture.sessionId === sessionId && capture.phase === "before" && capture.status === "captured");
  }
  restoring(sessionId: string) { return [...this.active.values()].some((owner) => owner.sessionId === sessionId); }
  capturing(sessionId: string) { return [...this.captures.values()].some((capture) => capture.sessionId === sessionId); }
  cancelCaptures(sessionId: string, includeAfter = false) {
    for (const [id, owner] of this.captures) if (owner.sessionId === sessionId &&
      (includeAfter || this.host.snapshot().checkpointCaptures.find((capture) => capture.id === id)?.phase !== "after")) owner.abort.abort(new MoguriError("checkpoint_stopped", "The original capture was stopped. Its input/private data was preserved and no turn was admitted or replayed.", 409));
    const prepared = this.host.snapshot().checkpointCaptures.filter((capture) => capture.sessionId === sessionId && capture.phase === "before" && capture.status === "captured");
    if (prepared.length) this.host.commit(prepared.map((capture) => this.captureEvent({ ...capture, revision: capture.revision + 1, status: "partial",
      updatedAt: new Date().toISOString(), diagnostic: "Actual user stopped this original captured-but-undispatched source. No turn, model, stage or tool was replayed." })));
  }
  async settleCaptures(sessionId: string): Promise<void> {
    const deadline = Date.now() + 30000;
    while (this.capturing(sessionId) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    if (this.capturing(sessionId)) throw new MoguriError("checkpoint_cleanup_unconfirmed", "The original bounded capture/reader has not settled. No writer boundary or successful rewind was inferred.", 409);
  }
  ownedAdmissionCapture(sessionId: string): string | undefined {
    const id = this.admissionScope.getStore()?.get(sessionId);
    const capture = id ? this.host.snapshot().checkpointCaptures.find((capture) => capture.id === id) : undefined;
    return capture?.sessionId === sessionId && capture.profileId === this.store.profileId && capture.phase === "before" &&
      ["capturing", "captured"].includes(capture.status) ? capture.id : undefined;
  }
  writeRoots(exceptOperationId?: string, includeCaptures = true, exceptCaptureId?: string): string[] {
    return [...new Set([...this.active.entries()].filter(([id]) => id !== exceptOperationId).flatMap(([, owner]) => owner.roots)
      .concat(this.host.snapshot().rewinds.filter((record) => record.id !== exceptOperationId && (record.quarantined || record.status === "running")).flatMap((record) => record.leaseRoots ?? record.roots))
      .concat(includeCaptures ? this.host.snapshot().checkpointCaptures.filter((capture) => capture.id !== exceptOperationId && capture.id !== exceptCaptureId &&
        (capture.status === "capturing" || capture.phase === "before" && capture.status === "captured")).flatMap((capture) => capture.leaseRoots) : []))];
  }
  assertDeletable(sessionId: string) {
    if (this.restoring(sessionId) || this.host.snapshot().rewinds.some((record) => record.sessionId === sessionId && (record.status === "running" || record.quarantined))) {
      throw new MoguriError("rewind_inspection", "Inspect and acknowledge the original partial/running rewind before deleting its owner. Exact roots, displaced files and history were preserved.", 409);
    }
  }
  private session(id: string) {
    const session = this.host.snapshot().sessions.find((session) => session.id === id);
    if (!session) throw new MoguriError("checkpoint_scope", "This checkpoint owner is outside the actual profile.", 404);
    return session;
  }
  private checkpoint(sessionId: string, id: string) {
    this.session(sessionId);
    const checkpoint = this.host.snapshot().checkpoints.find((checkpoint) => checkpoint.id === id && checkpoint.sessionId === sessionId);
    if (!checkpoint) throw new MoguriError("checkpoint_missing", "This exact retained checkpoint is unavailable. Historical files were not fabricated.", 404);
    return checkpoint;
  }
  private operation(sessionId: string, id: string) {
    this.session(sessionId);
    const record = this.host.snapshot().rewinds.find((record) => record.id === id && record.sessionId === sessionId);
    if (!record) throw new MoguriError("rewind_missing", "The original rewind is outside this exact session/profile.", 404);
    return record;
  }
  private identity(session: Session) { return digest(JSON.stringify([this.store.retentionIdentity(), this.store.profileId, session.id, this.host.identity(session)])); }
  private policy(session: Session) { return digest(JSON.stringify(this.host.policy(session))); }
  private event(checkpoint: TurnCheckpoint): EventInput {
    return { event_type: "checkpoint.recorded", profile_id: checkpoint.profileId, project_id: checkpoint.projectId,
      session_id: checkpoint.sessionId, turn_id: checkpoint.turnId, payload: { checkpoint } };
  }
  private rewindEvent(record: RewindRecord): EventInput {
    const session = this.session(record.sessionId);
    return { event_type: "rewind.recorded", profile_id: this.store.profileId, project_id: session.projectId, session_id: session.id, payload: { record } };
  }
  private captureEvent(capture: CheckpointCapture): EventInput {
    const session = this.session(capture.sessionId);
    return { event_type: "checkpoint.capture_recorded", profile_id: this.store.profileId, project_id: session.projectId, session_id: session.id,
      ...(capture.turnId ? { turn_id: capture.turnId } : {}), payload: { capture } };
  }
  private captureRecord(id: string) {
    const capture = this.host.snapshot().checkpointCaptures.find((capture) => capture.id === id);
    if (!capture) throw new MoguriError("checkpoint_capture_missing", "The original canonical capture owner is unavailable; no replacement was created.", 409);
    return capture;
  }
  private newCapture(session: Session, checkpointId: string, turnId: string | null, phase: CheckpointCapture["phase"], source: CheckpointCaptureSource): CheckpointCapture {
    const now = new Date().toISOString();
    return { version: 1, id: phase === "before" ? checkpointId : randomUUID(), checkpointId, profileId: this.store.profileId, sessionId: session.id,
      turnId, phase, source, identityDigest: this.identity(session), policyDigest: this.policy(session),
      contextDigest: digest(JSON.stringify(this.host.context(session.id))), leaseRoots: this.host.captureLeases(session), revision: 0,
      status: "capturing", workspaceDigest: null, storageBytes: 0, consumedByEventId: null, createdAt: now, updatedAt: now, diagnostic: null };
  }
  private captureBytes(sessionId: string): number {
    const snapshot = this.host.snapshot(), checkpoints = snapshot.checkpoints.filter((checkpoint) => checkpoint.sessionId === sessionId);
    return checkpoints.reduce((bytes, checkpoint) => bytes + checkpoint.storageBytes, 0) +
      snapshot.checkpointCaptures.filter((capture) => capture.sessionId === sessionId && !capture.forgotten &&
        !checkpoints.some((checkpoint) => checkpoint.id === capture.checkpointId)).reduce((bytes, capture) => bytes + (capture.storageBytes ?? 0), 0);
  }
  private captureOverlap(left: CheckpointCapture, right: CheckpointCapture): boolean {
    return left.leaseRoots.some((root) => right.leaseRoots.some((other) =>
      root.startsWith("remote/") || other.startsWith("remote/") ? root === other : localRootsOverlap(root, other)));
  }
  private async upgradeCapture(captureId: string, signal: AbortSignal, guard: () => void): Promise<void> {
    const deadline = Date.now() + 30000;
    while (true) {
      signal.throwIfAborted(); guard();
      const capture = this.captureRecord(captureId), readers = this.host.snapshot().checkpointCaptures.filter((other) => other.id !== capture.id &&
        !(capture.source.batchId && capture.source.batchId === other.source.batchId) &&
        (other.status === "capturing" || other.phase === "before" && other.status === "captured") && this.captureOverlap(capture, other));
      if (capture.status !== "captured") throw new MoguriError("checkpoint_stopped", "The actual original source was cancelled, pruned or superseded before admission.", 409);
      const order = new Map(this.host.events().flatMap((event) => event.event_type === "checkpoint.capture_recorded" && event.payload.capture.revision === 0 ? [[event.payload.capture.id, event.seq] as const] : []));
      const winner = [capture, ...readers.filter((reader) => reader.phase === "before")].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) || a.id.localeCompare(b.id))[0]!;
      if (winner.id !== capture.id) throw new MoguriError("checkpoint_reader_wait", "An earlier source capture owns this root's next admission. This input remains queued; fresh capture will follow the actual writer boundary.", 409);
      if (!readers.length) return;
      if (Date.now() >= deadline) throw new MoguriError("checkpoint_reader_unconfirmed", "Another original reader/capture has not settled. No writer or historical source was inferred.", 409);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  private async runCapture(capture: CheckpointCapture, requested: AbortSignal, guard: () => void): Promise<CheckpointWorkspace> {
    const abort = new AbortController(), done = Promise.withResolvers<void>(), signal = AbortSignal.any([requested, abort.signal]);
    if (this.captures.has(capture.id)) throw new MoguriError("checkpoint_capture_busy", "This exact capture is already running. No read or stage was repeated.", 409);
    this.captures.set(capture.id, { sessionId: capture.sessionId, abort, done: done.promise });
    const check = () => {
      signal.throwIfAborted(); guard();
      if (this.closing) throw new MoguriError("checkpoint_closing", "No new capture can be published while the actual service owner is closing.", 409);
      const current = this.session(capture.sessionId), record = this.captureRecord(capture.id);
      if (record.status !== "capturing" || this.identity(current) !== capture.identityDigest ||
        this.policy(current) !== capture.policyDigest || this.host.captureBusy(current, capture)) {
        throw new MoguriError("checkpoint_capture_stale", "The original root/peer/build, policy or actual writer boundary changed during capture. No partial source or Local fallback was accepted.", 409);
      }
    };
    try {
      check();
      const workspace = await this.host.capture(this.session(capture.sessionId), capture, signal, check);
      check();
      if (!workspace.boundary || workspace.boundary.env !== this.session(capture.sessionId).controls.env ||
        workspace.boundary.profileId !== capture.profileId || workspace.boundary.sessionId !== capture.sessionId ||
        workspace.boundary.identityDigest !== capture.identityDigest) throw new MoguriError("checkpoint_capture_provenance", "The exact execution-machine snapshot has no matching actual owner/boundary evidence.", 409);
      const text = JSON.stringify(workspace), current = this.captureRecord(capture.id);
      if (capture.phase !== "current" && this.captureBytes(capture.sessionId) + Buffer.byteLength(text) > CHECKPOINT_SESSION_BYTES) throw new MoguriError("checkpoint_quota", "Complete retained captures would exceed the 512 MiB session quota. Prune an exact unneeded checkpoint/capture; no prefix was stored or admitted.", 413);
      const next: CheckpointCapture = { ...current, revision: current.revision + 1, status: "captured",
        workspaceDigest: capture.phase === "current" ? null : this.store.putBlob(text), storageBytes: capture.phase === "current" ? 0 : Buffer.byteLength(text),
        leaseRoots: this.host.captureLeases(this.session(capture.sessionId)), updatedAt: new Date().toISOString() };
      const events: EventInput[] = [this.captureEvent(next)];
      if (capture.phase === "after") {
        const checkpoint = this.checkpoint(capture.sessionId, capture.checkpointId);
        if (!checkpoint.terminal || checkpoint.terminal.afterCaptureId !== capture.id || checkpoint.terminal.afterDigest || !next.workspaceDigest) throw new MoguriError("checkpoint_terminal_owner", "The original terminal capture changed or was already retained; no historical snapshot was reconstructed.", 409);
        events.push(this.event({ ...checkpoint, revision: checkpoint.revision + 1, storageBytes: checkpoint.storageBytes + (next.storageBytes ?? 0),
          terminal: { ...checkpoint.terminal, afterDigest: next.workspaceDigest, capturedAt: next.updatedAt },
          diagnostics: checkpoint.diagnostics.filter((diagnostic) => !diagnostic.startsWith("Terminal capture pending:")) }),
        this.captureEvent({ ...next, revision: next.revision + 1, status: "consumed", consumedByEventId: checkpoint.terminal.eventId }));
      }
      this.host.commit(events); return workspace;
    } catch (error) {
      const current = this.captureRecord(capture.id);
      if (current.status === "capturing") {
        const next: CheckpointCapture = { ...current, revision: current.revision + 1, status: "failed", diagnostic: message(error), updatedAt: new Date().toISOString() };
        this.host.commit([this.captureEvent(next)]);
      }
      throw error;
    } finally { this.captures.delete(capture.id); done.resolve(); this.host.wake(); }
  }
  async withAdmission<T>(sessionId: string, turnId: string, source: CheckpointCaptureSource, signal: AbortSignal, guard: () => void, admit: () => T | Promise<T>): Promise<T> {
    if (this.closing) throw new MoguriError("checkpoint_closing", "No original turn was admitted while the service owner was closing.", 409);
    let session = this.session(sessionId);
    if (session.controls.env === "Local") { guard(); return admit(); }
    if (this.capturing(sessionId)) { await this.settleCaptures(sessionId); signal.throwIfAborted(); guard(); session = this.session(sessionId); }
    if (this.host.snapshot().checkpointCaptures.some((capture) => capture.sessionId === sessionId && capture.phase === "before" &&
      ["capturing", "captured"].includes(capture.status))) throw new MoguriError("checkpoint_admission_busy", "Another original pre-admission capture owns this session. No competing turn was admitted.", 409);
    const capture = this.newCapture(session, randomUUID(), turnId, "before", source);
    this.host.commit([this.captureEvent(capture)]);
    const owned = new Map([[sessionId, capture.id]]), check = () => this.admissionScope.run(owned, guard);
    try {
      await this.runCapture(capture, signal, check); signal.throwIfAborted(); check();
      await this.upgradeCapture(capture.id, signal, check);
      const retained = this.captureRecord(capture.id), workspace = this.workspace(retained.workspaceDigest);
      if (!workspace) throw new MoguriError("checkpoint_capture_missing", "The actual pre-admission source grant was deleted before dispatch.", 409);
      await this.host.validateCapture(this.session(session.id), retained, workspace, signal, check);
      signal.throwIfAborted(); check();
      return await this.admissionScope.run(owned, admit);
    } finally {
      const current = this.captureRecord(capture.id);
      if (current.status === "captured") this.host.commit([this.captureEvent({ ...current, revision: current.revision + 1, status: "partial",
        updatedAt: new Date().toISOString(), diagnostic: "The original source was captured but its turn was not admitted. No history, model call or effects were replayed." })]);
    }
  }
  async withAdmissionBatch<T>(requests: { sessionId: string; turnId: string; source: CheckpointCaptureSource; guard(): void }[],
    batchId: string, signal: AbortSignal, guard: () => void, admit: () => T | Promise<T>): Promise<T> {
    const captures: { capture: CheckpointCapture; request: (typeof requests)[number] }[] = [];
    const owned = new Map<string, string>();
    const check = (request: (typeof requests)[number]) => this.admissionScope.run(owned, () => { guard(); request.guard(); });
    try {
      for (const request of requests) {
        signal.throwIfAborted(); guard(); request.guard();
        const session = this.session(request.sessionId);
        if (session.controls.env === "Local") continue;
        if (this.capturing(session.id)) { await this.settleCaptures(session.id); signal.throwIfAborted(); guard(); request.guard(); }
        if (this.host.snapshot().checkpointCaptures.some((capture) => capture.sessionId === session.id && capture.phase === "before" &&
          ["capturing", "captured"].includes(capture.status))) throw new MoguriError("checkpoint_admission_busy", "Another original capture owns this retry session. No competing attempt was admitted.", 409);
        const capture = this.newCapture(session, randomUUID(), request.turnId, "before", { ...request.source, batchId });
        this.host.commit([this.captureEvent(capture)]); captures.push({ capture, request });
        owned.set(session.id, capture.id);
        await this.runCapture(capture, signal, () => { check(request); });
      }
      for (const { capture, request } of captures) {
        await this.upgradeCapture(capture.id, signal, () => { check(request); });
        const retained = this.captureRecord(capture.id), workspace = this.workspace(retained.workspaceDigest);
        if (!workspace) throw new MoguriError("checkpoint_capture_missing", "One original retry capture grant disappeared. No partial batch was admitted.", 409);
        await this.host.validateCapture(this.session(request.sessionId), retained, workspace, signal, () => { check(request); });
      }
      signal.throwIfAborted(); guard(); for (const request of requests) check(request);
      return await this.admissionScope.run(owned, admit);
    } finally {
      const abandoned = captures.flatMap(({ capture }): EventInput[] => {
        const current = this.captureRecord(capture.id);
        return current.status === "captured" ? [this.captureEvent({ ...current, revision: current.revision + 1, status: "partial",
          updatedAt: new Date().toISOString(), diagnostic: "This original retry-batch source was captured but not admitted. No partial batch, paid call or effect was replayed." })] : [];
      });
      if (abandoned.length) this.host.commit(abandoned);
    }
  }
  bindAdmissions(events: EventInput[]): EventInput[] {
    return events.map((event): EventInput => {
      if (!["turn.started", "turn.control_started", "turn.retry_started"].includes(event.event_type) || !event.session_id || !event.turn_id) return event;
      const session = this.session(event.session_id);
      if (this.restoring(session.id)) throw new MoguriError("rewind_busy", "The actual user-owned rewind owns this session. No concurrent model/control/retry turn was admitted.", 409);
      if (session.controls.env === "Local") return event;
      const capture = this.host.snapshot().checkpointCaptures.findLast((capture) => capture.sessionId === session.id && capture.turnId === event.turn_id && capture.phase === "before" && capture.status === "captured");
      if (!capture || capture.identityDigest !== this.identity(session) || capture.policyDigest !== this.policy(session) ||
        capture.contextDigest !== digest(JSON.stringify(this.host.context(session.id))) || !capture.workspaceDigest) {
        throw new MoguriError("checkpoint_before_required", "This exact non-Local turn has no complete current pre-admission capture. No model/tool or alternate root was admitted.", 409);
      }
      if (event.event_type === "turn.started") return { ...event, payload: { ...event.payload, checkpointCaptureId: capture.id } };
      if (event.event_type === "turn.control_started") return { ...event, payload: { ...event.payload, checkpointCaptureId: capture.id } };
      if (event.event_type === "turn.retry_started") return { ...event, payload: { ...event.payload, checkpointCaptureId: capture.id } };
      return event;
    });
  }
  changed(events: StoredEvent[]) {
    if (this.recovering || this.closing) return;
    for (const event of events) if (event.event_type === "checkpoint.capture_recorded" && event.payload.capture.phase === "after" && event.payload.capture.status === "capturing") {
      const capture = event.payload.capture;
      queueMicrotask(() => { void this.runCapture(capture, AbortSignal.timeout(30000), () => {
        const terminal = this.host.events().find((event) => event.id === capture.source.id);
        if (terminal?.event_type !== "turn.finished" || terminal.turn_id !== capture.turnId || terminal.session_id !== capture.sessionId) throw new MoguriError("checkpoint_terminal_owner", "The actual original terminal event is unavailable. No current files were relabeled as historical.", 409);
      }).catch((error: unknown) => console.error("Terminal checkpoint capture unavailable:", message(error))); });
    }
  }
  private state(checkpoint: TurnCheckpoint): CheckpointState | null {
    if (!checkpoint.stateDigest) return null;
    const state = parse(CheckpointStateSchema, JSON.parse(this.store.blob(checkpoint.stateDigest)));
    if (state.parentMessages !== undefined && state.parentMessages > state.context.length) throw new MoguriError("checkpoint_context", "The captured parent/own conversation boundary exceeds the exact retained source. No context was inferred.", 409);
    return state;
  }
  private workspace(hash: string | null): CheckpointWorkspace | null {
    if (!hash) return null;
    const workspace = parse(CheckpointWorkspaceSchema, JSON.parse(this.store.blob(hash))), { digest: expected, ...source } = workspace;
    if (digest(JSON.stringify(source)) !== expected || workspace.roots.some((root) => new Set(root.files.map((file) => file.path)).size !== root.files.length ||
      root.files.some((file) => bytesDigest(Buffer.from(file.content, "base64")) !== file.digest || Buffer.from(file.content, "base64").length !== file.bytes))) {
      throw new MoguriError("checkpoint_source", "The complete retained workspace failed its exact manifest/byte verification. No replacement was used.", 409);
    }
    return workspace;
  }
  derived(before: Snapshot, primary: StoredEvent[]): EventInput[] {
    const events: EventInput[] = [];
    for (const admission of primary) if (["turn.started", "turn.control_started", "turn.retry_started"].includes(admission.event_type) && admission.session_id && admission.turn_id) {
      const session = before.sessions.find((session) => session.id === admission.session_id);
      if (!session) throw new MoguriError("checkpoint_owner", "An admitted turn lost its exact before-turn session.", 409);
      const preparedId = admission.event_type === "turn.started" || admission.event_type === "turn.control_started" || admission.event_type === "turn.retry_started" ? admission.payload.checkpointCaptureId : undefined;
      const prepared = preparedId ? before.checkpointCaptures.find((capture) => capture.id === preparedId && capture.sessionId === session.id && capture.turnId === admission.turn_id &&
        capture.phase === "before" && capture.status === "captured") : undefined;
      if (session.controls.env !== "Local" && (!prepared?.workspaceDigest || prepared.identityDigest !== this.identity(session))) throw new MoguriError("checkpoint_before_required", "The actual non-Local turn lost its original completed pre-admission capture.", 409);
      const diagnostics: string[] = [], retained = before.checkpoints.filter((checkpoint) => checkpoint.sessionId === session.id && !checkpoint.forgotten);
      const quota = retained.length >= CHECKPOINT_SESSION_COUNT || retained.reduce((bytes, checkpoint) => bytes + checkpoint.storageBytes, 0) >= CHECKPOINT_SESSION_BYTES;
      if (prepared && quota) throw new MoguriError("checkpoint_quota", "Prune an exact unneeded checkpoint before admitting another non-Local turn. Existing input, captures and budgets were preserved.", 409);
      let stateDigest: string | null = null, beforeDigest: string | null = null, storageBytes = 0, identityDigest: string;
      try { identityDigest = this.identity(session); }
      catch (error) { identityDigest = digest(JSON.stringify([session.id, session.projectId, session.workspaceId, session.controls.env])); diagnostics.push(`Workspace identity unavailable: ${message(error)}`); }
      if (quota) diagnostics.push("Checkpoint storage reached 64 retained captures or 512 MiB for this session. Prune an exact unneeded checkpoint; no historical snapshot was invented.");
      else {
        try {
          const state: CheckpointState = { version: 1, context: this.host.context(session.id), parentMessages: this.host.parentContextMessages(session.id), messages: session.messages, draft: session.draft,
            queue: session.queue, controls: session.controls, skillConsumptions: this.skills.consumptions(session.id),
            artifacts: before.artifacts.filter((artifact) => artifact.originSessionId === session.id).map((artifact) => ({ id: artifact.id, revision: artifact.revision, digest: artifact.contentDigest })) };
          const text = JSON.stringify(state);
          if (Buffer.byteLength(text) > CHECKPOINT_STATE_BYTES) throw new MoguriError("checkpoint_limit", "Complete conversation/state exceeds the 32 MiB checkpoint bound. Nothing was truncated.", 413);
          stateDigest = this.store.putBlob(text); storageBytes += Buffer.byteLength(text);
        } catch (error) {
          if (prepared) throw error;
          diagnostics.push(`Conversation capture unavailable: ${message(error)}`); console.error("Checkpoint conversation capture unavailable:", message(error));
        }
        try {
          const workspace = prepared ? this.workspace(prepared.workspaceDigest) : checkpointWorkspace(this.host.roots(session));
          if (!workspace) throw new MoguriError("checkpoint_capture_missing", "The exact pre-admission snapshot grant is unavailable.", 409);
          const text = JSON.stringify(workspace);
          if (storageBytes + Buffer.byteLength(text) + retained.reduce((bytes, checkpoint) => bytes + checkpoint.storageBytes, 0) > CHECKPOINT_SESSION_BYTES) throw new MoguriError("checkpoint_limit", "The complete workspace would exceed the 512 MiB session checkpoint quota.", 413);
          beforeDigest = this.store.putBlob(text); storageBytes += Buffer.byteLength(text);
        } catch (error) { if (prepared) throw error; diagnostics.push(`Workspace capture unavailable: ${message(error)}`); }
      }
      const checkpoint: TurnCheckpoint = { version: 1, id: prepared?.checkpointId ?? randomUUID(), revision: 0, profileId: this.store.profileId, sessionId: session.id,
        projectId: session.projectId, turnId: admission.turn_id, admissionEventId: admission.id, startSequence: admission.seq, throughSequence: admission.seq - 1,
        createdAt: admission.timestamp, summary: admission.event_type === "turn.started" ? admission.payload.item.text.slice(0, 240) : admission.event_type,
        env: session.controls.env, identityDigest, stateDigest, beforeDigest, storageBytes, diagnostics, forgotten: false, terminal: null,
        ...(prepared ? { beforeCaptureId: prepared.id } : {}) };
      events.push(this.event(checkpoint));
      if (prepared) events.push(this.captureEvent({ ...prepared, revision: prepared.revision + 1, status: "consumed", consumedByEventId: admission.id, updatedAt: new Date().toISOString() }));
    }
    for (const terminal of primary) if (terminal.event_type === "turn.finished" && terminal.session_id && terminal.turn_id) {
      const checkpoint = [...before.checkpoints, ...events.flatMap((event) => event.event_type === "checkpoint.recorded" ? [event.payload.checkpoint] : [])]
        .findLast((checkpoint) => checkpoint.sessionId === terminal.session_id && checkpoint.turnId === terminal.turn_id && !checkpoint.terminal && !checkpoint.forgotten);
      if (!checkpoint) continue;
      const diagnostics = [...checkpoint.diagnostics], session = before.sessions.find((session) => session.id === terminal.session_id);
      let afterDigest: string | null = null, storageBytes = checkpoint.storageBytes;
      let sameIdentity = false;
      try { sameIdentity = Boolean(!this.recovering && session && this.identity(session) === checkpoint.identityDigest); }
      catch (error) { diagnostics.push(`Terminal identity unavailable: ${message(error)}`); }
      if (!this.recovering && !this.closing && session && session.controls.env !== "Local" && checkpoint.beforeDigest && sameIdentity) {
        const capture = this.newCapture(session, checkpoint.id, terminal.turn_id, "after", { kind: "terminal", id: terminal.id, digest: digest(JSON.stringify([terminal.id, terminal.seq, terminal.payload])) });
        diagnostics.push("Terminal capture pending: waiting for the actual owned transport/guest boundary and exact after snapshot.");
        events.push(this.event({ ...checkpoint, revision: checkpoint.revision + 1, diagnostics,
          terminal: { sequence: terminal.seq, eventId: terminal.id, at: terminal.timestamp, outcome: terminal.payload.outcome,
            diagnostic: terminal.payload.diagnostic, afterDigest: null, afterCaptureId: capture.id } }), this.captureEvent(capture));
        continue;
      }
      try {
        if (this.recovering || !session || !checkpoint.beforeDigest || !sameIdentity) throw new MoguriError("checkpoint_terminal_unavailable", "The original terminal workspace boundary is incomplete, changed or recovered after restart; today's files were not relabeled as its historical result.", 409);
        const text = JSON.stringify(checkpointWorkspace(this.host.roots(session)));
        if (before.checkpoints.filter((value) => value.sessionId === session.id).reduce((bytes, value) => bytes + value.storageBytes, 0) + Buffer.byteLength(text) > CHECKPOINT_SESSION_BYTES) throw new MoguriError("checkpoint_limit", "The complete terminal snapshot would exceed the session storage quota.", 413);
        afterDigest = this.store.putBlob(text); storageBytes += Buffer.byteLength(text);
      } catch (error) { diagnostics.push(`Terminal workspace capture unavailable: ${message(error)}`); }
      events.push(this.event({ ...checkpoint, revision: checkpoint.revision + 1, diagnostics, storageBytes,
        terminal: { sequence: terminal.seq, eventId: terminal.id, at: terminal.timestamp, outcome: terminal.payload.outcome, diagnostic: terminal.payload.diagnostic, afterDigest,
          ...(afterDigest ? { capturedAt: terminal.timestamp } : {}) } }));
    }
    return events;
  }
  recover(): EventInput[] {
    const captures = this.host.snapshot().checkpointCaptures.filter((capture) => ["capturing", "captured"].includes(capture.status)).map((capture) => this.captureEvent({ ...capture,
      revision: capture.revision + 1, status: "partial", updatedAt: new Date().toISOString(),
      diagnostic: "Service restarted before the original capture/admission settled. No read, private staging or historical filesystem capture was replayed." }));
    return [...captures, ...this.host.snapshot().rewinds.filter((record) => record.status === "running").map((record) => this.rewindEvent({ ...record,
      revision: record.revision + 1, status: "partial", quarantined: record.mode === "workspace", updatedAt: new Date().toISOString(),
      diagnostic: "Service restarted during the original rewind. Actual filesystem effects and private displaced inodes need explicit inspection. Nothing was replayed; conversation/accounting history was preserved." }))];
  }
  private nativeWrite(session: Session, root: string, path: string, before: CheckpointWorkspace["roots"][number]["files"][number] | undefined,
    after: CheckpointWorkspace["roots"][number]["files"][number] | undefined, from: number, through: number): boolean {
    if (!after || before && before.mode !== after.mode) return false;
    let expected = before?.digest ?? "absent", writes = 0;
    for (const event of this.host.events()) if (event.session_id === session.id && event.seq > from && event.seq < through &&
      event.event_type === "tool.completed" && event.payload.outcome === "completed" && !event.payload.isError &&
      event.payload.call.name === "write_file" && typeof event.payload.call.arguments.path === "string" &&
      relative(root, resolve(root, event.payload.call.arguments.path)) === path) {
      const input = event.payload.call.arguments;
      if (typeof input.text !== "string" || input.expectedDigest !== expected) return false;
      writes++; expected = digest(input.text);
    }
    return writes > 0 && expected === after.digest;
  }
  private async prepare(sessionId: string, checkpointId: string, mode: RewindMode, exceptOperationId?: string, requested: AbortSignal = AbortSignal.timeout(30000)) {
    const session = this.session(sessionId), checkpoint = this.checkpoint(sessionId, checkpointId), state = this.state(checkpoint), target = this.workspace(checkpoint.beforeDigest);
    const blockers = this.host.blockers(session, mode), snapshot = this.host.snapshot();
    if (snapshot.rewinds.some((record) => record.id !== exceptOperationId && record.sessionId === sessionId && (record.status === "running" || record.quarantined))) blockers.push("An original rewind still owns unsettled effects. Inspect its actual boundary before another restoration.");
    let identityDigest: string;
    try { identityDigest = this.identity(session); }
    catch (error) { identityDigest = digest(JSON.stringify([session.id, session.projectId, session.workspaceId, session.controls.env])); blockers.push(message(error)); }
    if (checkpoint.forgotten || !state) blockers.push("The exact before-turn conversation/state snapshot is unavailable or was pruned.");
    if (state && session.kind === "side" && state.parentMessages === undefined) blockers.push("The original side checkpoint lacks a provable parent/own conversation boundary. No inherited context was duplicated or inferred.");
    if (identityDigest !== checkpoint.identityDigest) blockers.push("The actual profile/store/Env/root/peer/workspace identity differs from this checkpoint. No alternate root can be restored.");
    if (state) try { this.skills.assertContext(session, state.skillConsumptions); } catch (error) { blockers.push(`Target source authority is no longer valid: ${message(error)}`); }
    const context = this.host.context(sessionId), files: RewindFilePreview[] = [];
    let current: CheckpointWorkspace | null = null;
    if (mode === "workspace") {
      if (!target) blockers.push("This checkpoint has no complete qualified workspace snapshot. Another root or Env cannot substitute it.");
      if (target?.boundary?.env === "Remote" && !target.roots.length) blockers.push("This exact root-less SSH session has no filesystem workspace. Choose conversation-only restoration; no controller, Home or previous peer root can substitute it.");
      if (session.mode !== "agent" || session.pendingMode === "read-only") blockers.push("Read-only/side mode cannot restore workspace files.");
      if (snapshot.rewinds.some((record) => record.id !== exceptOperationId && record.sessionId === sessionId && (record.status === "running" || record.quarantined))) blockers.push("An original rewind still owns unsettled effects. Inspect it before another restoration.");
      if (target) {
        for (const lease of this.host.captureLeases(session)) if (this.host.rootBusy(lease, exceptOperationId)) blockers.push(`An actual competing writer/console owns ${lease}.`);
        if (!blockers.length) try {
          if (session.controls.env === "Local") current = checkpointWorkspace(this.host.roots(session));
          else {
            const capture = this.newCapture(session, randomUUID(), null, "current", { kind: "review", id: checkpoint.id,
              digest: checkpoint.beforeDigest ?? checkpoint.stateDigest ?? digest(JSON.stringify(checkpoint)) });
            this.host.commit([this.captureEvent(capture)]);
            current = await this.runCapture(capture, requested, () => {
              const actual = this.session(sessionId);
              if (actual.turnId || actual.revision !== session.revision) throw new MoguriError("rewind_review_changed", "The actual session changed during current workspace review. No stale preview was published.", 409);
            });
          }
        } catch (error) { blockers.push(`Current workspace capture unavailable: ${message(error)}`); }
        const changed = new Set<string>(), external = new Set<string>(), unproven = new Set<string>(), expected = new Map<string, string | null>();
        const previous = new Map<string, CheckpointWorkspace["roots"][number]>();
        const laterStarts = this.host.events().filter((event) => event.session_id === session.id && event.seq >= checkpoint.startSequence &&
          ["turn.started", "turn.control_started", "turn.retry_started"].includes(event.event_type));
        if (laterStarts.some((event) => !snapshot.checkpoints.some((checkpoint) => checkpoint.admissionEventId === event.id))) blockers.push("A later admitted turn has no provable original checkpoint. Missing history cannot be labelled a complete workspace rewind.");
        for (const later of snapshot.checkpoints.filter((value) => value.sessionId === sessionId && value.startSequence >= checkpoint.startSequence)
          .sort((a, b) => a.startSequence - b.startSequence)) {
          const before = this.workspace(later.beforeDigest), after = this.workspace(later.terminal?.afterDigest ?? null);
          if (!before || !after || !later.terminal) { blockers.push(`Turn ${later.turnId} has no complete proven before/terminal workspace capture.`); continue; }
          for (const root of before.roots) {
            const end = after.roots.find((value) => checkpointRootKey(value) === checkpointRootKey(root));
            if (!end || later.env !== "Sandbox" && JSON.stringify(end.binding) !== JSON.stringify(root.binding)) { blockers.push("A later turn changed its original root identity."); continue; }
            const last = previous.get(checkpointRootKey(root));
            if (last) for (const path of new Set([...last.files, ...root.files].map((file) => file.path))) {
              if (checkpointFileVersion(last.files.find((file) => file.path === path)) !== checkpointFileVersion(root.files.find((file) => file.path === path))) external.add(key(checkpointRootKey(root), path));
            }
            const paths = new Set([...root.files, ...end.files].map((file) => file.path));
            for (const path of paths) {
              const prior = root.files.find((file) => file.path === path), next = end.files.find((file) => file.path === path), id = key(checkpointRootKey(root), path);
              if (checkpointFileVersion(prior) !== checkpointFileVersion(next)) {
                changed.add(id);
                if (!this.nativeWrite(session, root.binding.root, path, prior, next, later.startSequence, later.terminal.sequence)) unproven.add(id);
              }
              expected.set(id, next?.digest ?? null);
            }
            previous.set(checkpointRootKey(root), end);
          }
        }
        if (current) for (const root of target.roots) {
          const actual = current.roots.find((value) => checkpointRootKey(value) === checkpointRootKey(root));
          if (!actual || session.controls.env !== "Sandbox" && JSON.stringify(actual.binding) !== JSON.stringify(root.binding)) { blockers.push("The current workspace no longer contains the exact captured root."); continue; }
          for (const path of new Set([...root.files, ...actual.files].map((file) => file.path))) {
            const id = key(checkpointRootKey(root), path), wanted = root.files.find((file) => file.path === path), live = actual.files.find((file) => file.path === path);
            if (!changed.has(id) || checkpointFileVersion(wanted) === checkpointFileVersion(live)) continue;
            if (actual.excluded.some((excluded) => path === excluded || path.startsWith(`${excluded}/`))) {
              blockers.push(`The current path ${path} is excluded/unavailable, not absent. No restore can bypass its current protection or ignore scope.`); continue;
            }
            const expectedDigest = expected.get(id) ?? null;
            const conflict = external.has(id) ? "External inter-turn bytes/modes changed between separately captured boundaries." :
              (live?.digest ?? null) !== expectedDigest ? "External bytes differ from the last captured terminal state." :
              target.roots.length !== 1 || unproven.has(id) ?
                "Observed changes are not proven to be an exact owned native-file write; external/command authorship needs an explicit decision." : null;
            try { this.host.assertWrite(session, actual.binding.root, path, actual.repositoryId); } catch (error) { blockers.push(message(error)); }
            files.push({ root: actual.binding.root, path, currentDigest: live?.digest ?? null, targetDigest: wanted?.digest ?? null,
              expectedDigest, currentMode: live?.mode ?? null, targetMode: wanted?.mode ?? null, conflict });
          }
        }
      }
    }
    const value = { version: 1 as const, sessionId, checkpointId, mode, identityDigest, policyDigest: this.policy(session),
      sessionRevision: session.revision, draftRevision: session.draft.revision, queueRevision: session.queueRevision,
      currentContextDigest: digest(JSON.stringify(context)), currentWorkspaceDigest: current ? checkpointReviewDigest(current) : null, throughSequence: checkpoint.throughSequence,
      contextMessages: state?.context.length ?? 0, currentContextMessages: context.length, files, blockers: [...new Set(blockers)],
      warnings: ["Pushes, merges, deployments and external MCP effects are not undone. Tools and paid calls are never replayed.",
        "Current Git HEAD/index, drafts, controls, hard policy, artifacts, source revocations and spent/unknown budgets are preserved. Queued work is held, not replayed.",
        "Workspace scope is unprotected, non-ignored regular files. Empty directories, ignored/generated files and credential/control/Git paths are not restored.",
        ...(session.controls.env === "Sandbox" ? ["Sandbox restoration binds a new owned private stage. Complete original stages, signed results and a separate private backup are retained; the Local source checkout is not published or changed."] :
          ["Every displaced original file is retained at the exact Local or pinned peer root as a private .moguri/rewinds backup, including writes through an already-open inode. No automatic backup deletion occurs."])],
      preserved: ["later append-only conversation/history", "current draft and held queue", "current model/Env/autonomy/budget/policy", "Git HEAD and staged index", "unrelated/untracked external files", "independent artifacts and accounting"],
      sourceAdmissions: state?.skillConsumptions ?? [] };
    const { draftRevision: _draft, queueRevision: _queue, ...bound } = value;
    const preview: RewindPreview = { ...value, digest: digest(JSON.stringify(bound)) };
    return { preview, checkpoint, state, target, current };
  }
  async query(query: CheckpointQuery, signal?: AbortSignal): Promise<CheckpointResponse> {
    const session = this.session(query.sessionId);
    if (query.type === "rewind.preview") return { type: query.type, preview: (await this.prepare(session.id, query.checkpointId, query.mode, undefined, signal)).preview };
    if (query.type === "rewind.inspect") return this.inspect(session.id, query.rewindId);
    if (query.type === "checkpoints.read") {
      const checkpoint = this.checkpoint(session.id, query.checkpointId);
      return { type: query.type, checkpoint, state: this.state(checkpoint), before: this.workspace(checkpoint.beforeDigest), after: this.workspace(checkpoint.terminal?.afterDigest ?? null) };
    }
    const checkpoints = this.host.snapshot().checkpoints.filter((checkpoint) => checkpoint.sessionId === session.id).sort((a, b) => b.startSequence - a.startSequence);
    const starts = this.host.events().filter((event) => event.session_id === session.id && ["turn.started", "turn.control_started", "turn.retry_started"].includes(event.event_type));
    return { type: query.type, checkpoints: checkpoints.slice(query.offset, query.offset + query.limit),
      captures: this.host.snapshot().checkpointCaptures.filter((capture) => capture.sessionId === session.id && capture.status !== "consumed"),
      rewinds: this.host.snapshot().rewinds.filter((record) => record.sessionId === session.id),
      nextOffset: query.offset + query.limit < checkpoints.length ? query.offset + query.limit : null,
      historicalTurnsUnavailable: starts.filter((event) => !checkpoints.some((checkpoint) => checkpoint.admissionEventId === event.id)).length };
  }
  private plans(operationId: string, current: CheckpointWorkspace | null, target: CheckpointWorkspace | null, preview: RewindPreview, decisions: Map<string, RewindFileDecision["choice"]>): CheckpointRestorePlan[] {
    if (!current || !target) return [];
    return current.roots.flatMap((root): CheckpointRestorePlan[] => {
      const original = target.roots.find((value) => checkpointRootKey(value) === checkpointRootKey(root));
      if (!original) throw new MoguriError("rewind_source", "The exact reviewed target lost an original logical root. No first-root substitute was used.", 409);
      const selected = preview.files.filter((file) => file.root === root.binding.root &&
        [...root.files, ...original.files].some((entry) => entry.path === file.path));
      if (!selected.length) return [];
      return [{ version: 1, operationId, root: root.binding, expectedWorkspaceDigest: current.boundary?.sourceDigest ?? current.digest, expectedGit: root.git,
        files: selected.map((file) => {
          const current = root.files.find((value) => value.path === file.path), target = original.files.find((value) => value.path === file.path);
          if ((current?.digest ?? null) !== file.currentDigest || (target?.digest ?? null) !== file.targetDigest) throw new MoguriError("rewind_source", "Reviewed path bytes changed before original plan retention.", 409);
          let descriptor: Omit<NonNullable<typeof current>, "content"> | null = null;
          if (current) { const { content: _, ...metadata } = current; descriptor = metadata; }
          return { path: file.path, current: descriptor, target: target ?? null, choice: decisions.get(key(file.root, file.path)) ?? "restore-checkpoint" };
        }) }];
    });
  }
  private async inspect(sessionId: string, rewindId: string): Promise<Extract<CheckpointResponse, { type: "rewind.inspect" }>> {
    const record = this.operation(sessionId, rewindId), session = this.session(sessionId);
    if (record.env && record.env !== "Local" && record.mode === "workspace") {
      if (!this.host.inspectTransport || !record.planDigest) throw new MoguriError("rewind_inspection", "The original transport/plan inspection owner is unavailable; no operation was replayed.", 409);
      const plans = parse(CheckpointRestorePlansSchema, JSON.parse(this.store.blob(record.planDigest)));
      const observed = await this.host.inspectTransport(session, record, plans, AbortSignal.timeout(30000));
      return { type: "rewind.inspect", record, ...observed, digest: digest(JSON.stringify([record, observed, this.policy(session)])) };
    }
    if (this.identity(session) !== record.identityDigest) throw new MoguriError("rewind_scope", "Inspect only the original exact profile/store/root/peer owner.", 409);
    const read = (path: string) => {
      try { return bytesDigest(readRegularFileSync(path, CHECKPOINT_FILE_BYTES)); }
      catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return null; throw error; }
    };
    const effects = record.files.map((file, index) => {
      if (!record.roots.includes(file.root) || file.backup !== null && file.backup !== join(file.root, ".moguri", "rewinds", record.id, `${index}.displaced`)) throw new MoguriError("rewind_scope", "The retained effect/backup path lost its original reviewed owner.", 409);
      return { root: file.root, path: file.path, currentDigest: read(scopedPathSync(file.root, file.path, true)), backupDigest: file.backup ? read(file.backup) : null };
    });
    return { type: "rewind.inspect", record, effects, operationSettled: !this.active.has(record.id), digest: digest(JSON.stringify([record, effects, this.policy(session)])) };
  }
  async execute(command: CheckpointCommand, finish: WorkspaceFinish): Promise<CommandResult> {
    const session = this.session(command.sessionId);
    if (command.type === "rewind.settle") {
      if (this.busy(session.id)) throw new MoguriError("rewind_busy", "The original rewind already owns this session. Stop or inspect that operation.", 409);
      const id = `settle/${finish.intent?.id ?? randomUUID()}`, done = Promise.withResolvers<void>();
      this.active.set(id, { sessionId: session.id, roots: [], abort: new AbortController(), done: done.promise });
      try { await this.host.settle(session.id, finish.ownerId); return finish([], { revision: this.session(session.id).revision }); }
      finally { this.active.delete(id); done.resolve(); }
    }
    if (command.type === "rewind.stop") {
      this.operation(session.id, command.rewindId);
      const owner = this.active.get(command.rewindId);
      if (!owner) throw new MoguriError("rewind_recorded", "The original rewind is terminal or lost its live owner. Inspect it; effects were not replayed.", 409);
      owner.abort.abort(new MoguriError("rewind_stopped", "Actual-user Stop interrupted the original rewind. Inspect any displaced files; no rollback success was inferred.", 409));
      return finish([], { id: command.rewindId });
    }
    if (command.type === "rewind.acknowledge") {
      const inspected = await this.inspect(session.id, command.rewindId), record = inspected.record;
      if (this.active.has(record.id) || inspected.operationSettled !== true || record.status !== "partial" || !record.quarantined || record.revision !== command.expectedRevision || inspected.digest !== command.expectedDigest) throw new MoguriError("rewind_inspection_stale", "Review the exact terminal partial effects and actual worker/guest fence before acknowledging them. No failed rewind became successful.", 409);
      const next = { ...record, revision: record.revision + 1, quarantined: false, updatedAt: new Date().toISOString(),
        inspection: { actor: "user" as const, digest: inspected.digest, at: new Date().toISOString() } };
      return finish([this.rewindEvent(next)], { id: record.id, revision: next.revision });
    }
    if (command.type === "checkpoint.prune") {
      const checkpoint = this.checkpoint(session.id, command.checkpointId);
      if (checkpoint.revision !== command.expectedRevision || checkpoint.forgotten || !checkpoint.terminal ||
        this.host.snapshot().rewinds.some((record) => record.checkpointId === checkpoint.id && (record.status === "running" || record.quarantined))) throw new MoguriError("checkpoint_retention", "The exact checkpoint changed or still owns active/unconfirmed work. Its grants were preserved.", 409);
      const forgotten: TurnCheckpoint = { ...checkpoint, revision: checkpoint.revision + 1, forgotten: true, stateDigest: null, beforeDigest: null, storageBytes: 0,
        terminal: { ...checkpoint.terminal, afterDigest: null }, diagnostics: [...checkpoint.diagnostics, "Actual user pruned this checkpoint's encrypted snapshot compartment. History/accounting and independent artifacts remain."] };
      const captureWitnesses: EventInput[] = this.host.snapshot().checkpointCaptures.filter((capture) => capture.checkpointId === checkpoint.id).map((capture) => ({
        event_type: "checkpoint.capture_forgotten", profile_id: this.store.profileId, project_id: session.projectId, session_id: session.id,
        payload: { actor: "user", capture: { ...capture, revision: capture.revision + 1, workspaceDigest: null, storageBytes: 0, forgotten: true,
          status: capture.status === "consumed" ? "consumed" : "partial", updatedAt: new Date().toISOString(),
          diagnostic: "Actual user pruned encrypted checkpoint data. Original admission/terminal ownership remains historical evidence, never fresh authority." } },
      }));
      return finish([...captureWitnesses, { event_type: "checkpoint.forgotten", profile_id: this.store.profileId, project_id: session.projectId, session_id: session.id, payload: { checkpoint: forgotten, actor: "user" } }],
        { id: checkpoint.id, revision: forgotten.revision }, { checkpoints: [{ sessionId: session.id, id: checkpoint.id }] });
    }
    if (command.type === "checkpoint.capture.prune") {
      const capture = this.captureRecord(command.captureId);
      if (capture.sessionId !== session.id || capture.revision !== command.expectedRevision || this.captures.has(capture.id) ||
        this.host.snapshot().checkpoints.some((checkpoint) => checkpoint.id === capture.checkpointId) ||
        !["partial", "failed", "captured"].includes(capture.status)) throw new MoguriError("checkpoint_capture_retention", "This exact capture changed or still owns active/admitted work. Its grants were preserved.", 409);
      if (capture.forgotten) throw new MoguriError("checkpoint_capture_retention", "This capture's encrypted source was already pruned.", 409);
      const forgotten: CheckpointCapture = { ...capture, revision: capture.revision + 1, workspaceDigest: null, storageBytes: 0, forgotten: true,
        status: "partial", updatedAt: new Date().toISOString(), diagnostic: "Actual user pruned this unadmitted/preview capture's encrypted source. No turn, stage, model call or effects were replayed." };
      return finish([{ event_type: "checkpoint.capture_forgotten", profile_id: this.store.profileId, project_id: session.projectId,
        session_id: session.id, payload: { capture: forgotten, actor: "user" } }], { id: capture.id }, { checkpoints: [{ sessionId: session.id, id: capture.checkpointId }] });
    }
    if (!finish.intent) throw new MoguriError("rewind_owner", "Rewind requires the original actual-user command identity.", 409);
    const previous = this.host.snapshot().rewinds.find((record) => record.commandId === finish.intent!.id);
    if (previous) throw new MoguriError("rewind_recorded", `Original rewind ${previous.id} is already retained. Missing receipts never authorize replay.`, 409);
    const prepared = await this.prepare(session.id, command.checkpointId, command.mode), { preview, checkpoint, state, target, current } = prepared;
    if (preview.digest !== command.expectedDigest || preview.blockers.length || !state) throw new MoguriError("rewind_preview_stale", preview.blockers.join(" ") || "The target-bound context/files/root/policy preview changed. Nothing was restored.", 409);
    const decisions = new Map(command.decisions.map((decision) => [key(decision.root, decision.path), decision.choice]));
    if (decisions.size !== command.decisions.length || command.decisions.some((decision) => !preview.files.some((file) => file.root === decision.root && file.path === decision.path)) ||
      preview.files.some((file) => file.conflict && !decisions.has(key(file.root, file.path)))) throw new MoguriError("rewind_conflict_decision", "Every real conflict needs one explicit keep-current or restore-checkpoint decision bound to this exact preview. No external edit was discarded.", 409);
    const id = randomUUID(), roots = command.mode === "workspace" ? current!.roots.map((root) => root.binding.root) : [];
    const plans = this.plans(id, current, target, preview, decisions), leaseRoots = command.mode === "workspace" ? this.host.captureLeases(session) : [];
    const contextDigest = this.store.putBlob(JSON.stringify(state.context.slice(state.parentMessages ?? 0)));
    const parentContextDigest = session.kind === "side" ? this.store.putBlob(JSON.stringify(state.context.slice(0, state.parentMessages!))) : undefined;
    const now = new Date().toISOString(), transportSettings = this.host.transportSettings?.(session);
    let record: RewindRecord = { version: 1, id, revision: 0, profileId: this.store.profileId, sessionId: session.id, checkpointId: checkpoint.id,
      commandId: finish.intent.id, mode: command.mode, identityDigest: preview.identityDigest, previewDigest: preview.digest,
      ...(parentContextDigest ? { parentContextDigest } : {}),
      inputDigest: this.store.putBlob(JSON.stringify({ version: 1, preview, decisions: command.decisions,
        current: current ? { ...current, roots: current.roots.map((root) => ({ ...root, files: root.files.map(({ content: _, ...file }) => file) })) } : null })), contextDigest,
      planDigest: this.store.putBlob(JSON.stringify(plans)), resultDigest: null, env: session.controls.env, leaseRoots,
      policyDigest: preview.policyDigest, ...(current ? { currentSnapshotDigest: current.digest } : {}), ...(target ? { targetSnapshotDigest: target.digest } : {}),
      ...(transportSettings ? { transportSettings } : {}),
      status: "running", createdAt: now, updatedAt: now, actor: "user", diagnostic: null, quarantined: command.mode === "workspace", roots,
      files: preview.files.map((file, index) => ({ root: file.root, path: file.path,
        backup: session.controls.env !== "Sandbox" && file.currentDigest && decisions.get(key(file.root, file.path)) !== "keep-current" ? join(file.root, ".moguri", "rewinds", id, `${index}.displaced`) : null,
        phase: decisions.get(key(file.root, file.path)) === "keep-current" ? "kept" : "planned" })), inspection: null };
    const abort = new AbortController(), done = Promise.withResolvers<void>();
    this.active.set(id, { sessionId: session.id, abort, roots: leaseRoots, done: done.promise });
    let retained = false, effects = false;
    const check = () => {
      abort.signal.throwIfAborted();
      const actual = this.session(session.id);
      if (this.identity(actual) !== preview.identityDigest || this.policy(actual) !== preview.policyDigest || actual.revision !== preview.sessionRevision ||
        actual.draft.revision !== preview.draftRevision || actual.queueRevision !== preview.queueRevision ||
        digest(JSON.stringify(this.host.context(session.id))) !== preview.currentContextDigest || this.host.blockers(actual, command.mode, id).length ||
        leaseRoots.some((root) => this.host.rootBusy(root, id))) throw new MoguriError("rewind_race", "The exact owner, current state, policy or writer boundary changed during restoration. Partial effects and displaced files were preserved.", 409);
      this.skills.assertContext(actual, state.skillConsumptions);
    };
    const update = (changes: Partial<RewindRecord>) => {
      const next = { ...record, ...changes, revision: record.revision + 1, updatedAt: new Date().toISOString() };
      this.host.commit([this.rewindEvent(next)]); record = next;
    };
    try {
      check(); this.host.commit([this.rewindEvent(record)]); retained = true;
      let transportEvents: EventInput[] = [];
      let nativeWorkspaceId: string | undefined;
      if (command.mode === "workspace" && session.controls.env !== "Local" && preview.files.some((file) => decisions.get(key(file.root, file.path)) !== "keep-current")) {
        if (!this.host.restoreTransport || !current || !target) throw new MoguriError("rewind_transport", "The exact selected transport has no restoration owner. No Local fallback or alternate root was used.", 409);
        effects = true;
        const result = await this.host.restoreTransport(session, record, plans, current, target, command.decisions, abort.signal, check, {
          execution: async (execution, frame, request) => {
            check(); update({ remoteExecution: execution, ...(frame ? { remoteFrame: { sequence: frame.sequence, digest: frame.digest, kind: request?.kind ?? "status" } } : {}) });
          },
          moving: async (index) => { check(); update({ files: record.files.map((file, offset) => offset === index ? { ...file, phase: "moving" } : file) }); },
          observed: async (index) => {
            check(); const plan = plans.flatMap((plan) => plan.files)[index];
            if (!plan) throw new MoguriError("rewind_receipt", "A transport result changed its original reviewed file index.", 409);
            update({ files: record.files.map((file, offset) => offset === index ? { ...file, phase: plan.choice === "keep-current" ? "kept" : plan.target ? "written" : "removed" } : file) });
          },
          result: async (results) => { check(); update({ resultDigest: this.store.putBlob(JSON.stringify(results)) }); },
        });
        transportEvents = result.events; nativeWorkspaceId = result.nativeWorkspaceId;
        check();
      } else if (command.mode === "workspace" && session.controls.env === "Local") {
        if (!target || !current || checkpointWorkspace(this.host.roots(this.session(session.id))).digest !== current.digest) throw new MoguriError("rewind_race", "Workspace bytes/index changed after the exact preview. No file was restored.", 409);
        for (let index = 0; index < record.files.length; index++) {
          const file = record.files[index]!;
          if (file.phase === "kept") continue;
          this.host.assertWrite(this.session(session.id), file.root, file.path);
          check(); update({ files: record.files.map((value, offset) => offset === index ? { ...value, phase: "moving" } : value) }); effects = true;
          const live = current.roots.find((root) => root.binding.root === file.root)?.files.find((value) => value.path === file.path);
          const wanted = target.roots.find((root) => root.binding.root === file.root)?.files.find((value) => value.path === file.path);
          await publishRewindFile(file.root, id, index, file.path, live, wanted, check);
          update({ files: record.files.map((value, offset) => offset === index ? { ...value, phase: wanted ? "written" : "removed" } : value) });
        }
        const after = checkpointWorkspace(this.host.roots(this.session(session.id)));
        for (const root of current.roots) {
          const observed = after.roots.find((value) => value.binding.root === root.binding.root);
          if (!observed || JSON.stringify(observed.git) !== JSON.stringify(root.git)) throw new MoguriError("rewind_git_race", "Git HEAD/index changed during restoration. It was never reset; complete rewind was not claimed.", 409);
          for (const file of record.files.filter((file) => file.root === root.binding.root && file.phase !== "kept")) {
            const wanted = target.roots.find((value) => value.binding.root === file.root)?.files.find((value) => value.path === file.path);
            const live = observed.files.find((value) => value.path === file.path);
            if (checkpointFileVersion(wanted) !== checkpointFileVersion(live)) throw new MoguriError("rewind_conflict", "A restored path changed before final verification. Displaced files and actual partial outcome remain inspectable.", 409);
          }
        }
      }
      check();
      const completed: RewindRecord = { ...record, revision: record.revision + 1, status: "completed", quarantined: false, operationSettled: true,
        ...(nativeWorkspaceId ? { nativeWorkspaceId } : {}), updatedAt: new Date().toISOString() };
      const rewind: SessionRewind = { version: 1, operationId: id, checkpointId: checkpoint.id, contextDigest, throughSequence: checkpoint.throughSequence,
        ...(parentContextDigest ? { parentContextDigest } : {}),
        discardedThroughSequence: this.host.events().at(-1)?.seq ?? 0, actor: "user", skillConsumptions: state.skillConsumptions };
      const ownerInput = finish.ownerId ? this.host.snapshot().commandExecutions.find((execution) => execution.id === finish.ownerId)?.queueItemId : undefined;
      const held = session.queue.filter((item) => item.id !== ownerInput).map((item) => item.id);
      return finish([...transportEvents, this.rewindEvent(completed),
        { event_type: "session.rewound", profile_id: this.store.profileId, project_id: session.projectId, session_id: session.id, payload: rewind },
        ...(held.length ? [{ event_type: "queue.held" as const, profile_id: this.store.profileId, project_id: session.projectId, session_id: session.id, payload: { messageIds: held } }] : [])], { id, revision: completed.revision });
    } catch (error) {
      if (retained) try { update({ status: effects ? "partial" : "failed", quarantined: effects, diagnostic: `${message(error)} Original intent/data retained; no paid/tool replay, budget refund or external-effect undo.` }); }
      catch (persistence) { console.error("Rewind outcome persistence failed; original intent remains unconfirmed:", message(persistence)); }
      throw new MoguriError(effects ? "rewind_partial" : "rewind_failed", `${message(error)} Original rewind ${id}; inspect retained effects/backups before any new review.`, 409);
    } finally { this.active.delete(id); done.resolve(); }
  }
}
